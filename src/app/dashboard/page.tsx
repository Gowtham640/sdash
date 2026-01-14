'use client';
import React, { useState, useEffect } from "react";
import { getSlotOccurrences, getDayOrderStats, SlotOccurrence, DayOrderStats, TimetableData } from "@/lib/timetableUtils";
import Link from "next/link";
import PillNav from '../../components/PillNav';
import StaggeredMenu from '../../components/StaggeredMenu';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { setStorageItem, getStorageItem, removeStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import NavigationButton from "@/components/NavigationButton";
import { useErrorTracking } from "@/lib/useErrorTracking";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { SkeletonLoader } from "@/components/ui/loading";
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import { Calendar, BookOpen, BarChart3, Calculator, User, Settings } from 'lucide-react';

// Import types
interface CalendarEvent {
  date: string;
  day_name: string;
  content: string;
  day_order: string;
  month?: string;
  month_name?: string;
  year?: number;
}

interface AttendanceSubject {
  course_title: string;
  category: string;
  hours_conducted: string;
  hours_absent: string;
  hours_required: string;
  attendance_percentage: string;
}

interface AttendanceData {
  all_subjects: AttendanceSubject[];
}

interface MarksCourse {
  course_code: string;
  course_title: string;
  subject_type: string;
  assessments: Array<{
    assessment_name: string;
    marks_obtained: string;
    total_marks: string;
    percentage: string;
  }>;
}

interface MarksData {
  all_courses: MarksCourse[];
}

interface TimeSlot {
  time: string;
  course_title: string;
  category: string;
}

export default function Dashboard() {
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [marksData, setMarksData] = useState<MarksData | null>(null);
  const [timetableData, setTimetableData] = useState<{
    timetable?: Record<string, { do_name?: string; time_slots?: Record<string, unknown> }>;
    slot_mapping?: Record<string, string>;
  } | null>(null);
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>([]);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [hasCache, setHasCache] = useState(false);
  
  // Track errors
  useErrorTracking(error, '/dashboard');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const menuItems = [
    { label: 'Home', ariaLabel: 'Go to home page', link: '/' },
    { label: 'About', ariaLabel: 'Learn about us', link: '/about' },
    { label: 'Services', ariaLabel: 'View our services', link: '/services' },
    { label: 'Contact', ariaLabel: 'Get in touch', link: '/contact' }
  ];
  
  const socialItems = [
    { label: 'Twitter', link: 'https://twitter.com' },
    { label: 'GitHub', link: 'https://github.com' },
    { label: 'LinkedIn', link: 'https://linkedin.com' }
  ];

  // Get current date in DD/MM/YYYY format
  const getCurrentDateString = () => {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Convert calendar event date from "DD/Month 'YY" format to "DD/MM/YYYY" format
  const normalizeCalendarDate = (dateStr: string): string => {
    if (!dateStr) return dateStr;

    // Check if date is already in DD/MM/YYYY format
    const ddMMYYYYRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (ddMMYYYYRegex.test(dateStr)) {
      return dateStr;
    }

    // Handle "DD/Month 'YY" format (e.g., "19/Jul '25")
    const parts = dateStr.split('/');
    if (parts.length === 2) {
      const [day, monthYear] = parts;
      const [monthName, yearStr] = monthYear.split(' ');
      
      const monthNames: { [key: string]: number } = {
        'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
        'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
      };
      
      const monthNum = monthNames[monthName];
      if (monthNum && yearStr) {
        // Extract year from "'YY" format
        const shortYear = yearStr.replace("'", "");
        const fullYear = 2000 + parseInt(shortYear);
        const month = monthNum.toString().padStart(2, '0');
        const dayPadded = day.padStart(2, '0');
        return `${dayPadded}/${month}/${fullYear}`;
      }
    }

    // Return original if unable to parse
    return dateStr;
  };

  // Get yesterday, today, and tomorrow dates
  const getThreeDayDates = () => {
    const today = new Date();
    const dates = [];
    
    for (let i = -1; i <= 1; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      dates.push({
        dateStr: `${day}/${month}/${year}`,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dateObj: date
      });
    }
    
    return dates;
  };

  // Get current day's day order
  const getCurrentDayOrder = () => {
    if (!calendarData || !Array.isArray(calendarData) || calendarData.length === 0) {
      return null;
    }
    const currentDate = getCurrentDateString();
    const currentEvent = calendarData.find(event => event && event.date === currentDate);
    return currentEvent?.day_order || null;
  };

  // Get current day's day order number
  const getCurrentDayOrderNumber = () => {
    const dayOrder = getCurrentDayOrder();
    if (dayOrder && dayOrder.startsWith('DO ')) {
      return parseInt(dayOrder.split(' ')[1]);
    }
    // Handle non-working days (day_order: "-")
    if (dayOrder === '-') {
      return null;
    }
    return null;
  };

  // Get today's timetable based on day order
  const getTodaysTimetable = () => {
    console.log('[Dashboard] 🔍 getTodaysTimetable called');

    // Ensure calendar data is loaded before computing timetable
    if (!calendarData || !Array.isArray(calendarData) || calendarData.length === 0) {
      console.log('[Dashboard] ❌ getTodaysTimetable returning empty - calendar data not loaded yet');
      return [];
    }

    // Find today's event
    const currentDate = getCurrentDateString();
    const today = calendarData.find(event => event && event.date === currentDate);

    // Normalize the day order ONCE
    const doNumber = Number(today?.day_order);

    // Add guard for invalid day order
    if (Number.isNaN(doNumber)) {
      console.error("Invalid day order:", today?.day_order);
      return [];
    }

    console.log('[Dashboard] 📊 Timetable data exists:', !!timetableData);
    console.log('[Dashboard] 📊 Timetable data has timetable property:', !!timetableData?.timetable);
    console.log('[Dashboard] 📊 Available DO keys:', timetableData?.timetable ? Object.keys(timetableData.timetable) : 'no timetable data');

    if (!timetableData?.timetable) {
      console.log('[Dashboard] ❌ getTodaysTimetable returning empty - missing timetable data');
      return [];
    }

    // Use the correct timetable key
    const timetableForToday = timetableData.timetable[`DO ${doNumber}`];

    // Add ONE definitive log
    console.log("FINAL LOOKUP KEY:", `DO ${doNumber}`);
    console.log("FOUND TIMETABLE:", timetableForToday);

    const dayTimetable = timetableForToday;

    if (!dayTimetable?.time_slots) {
      console.log('[Dashboard] ❌ getTodaysTimetable returning empty - no time_slots for DO', doNumber);
      return [];
    }

    // Convert to array of {time, course_title, category}
    const timeSlots: TimeSlot[] = [];
    if (!dayTimetable || !dayTimetable.time_slots || typeof dayTimetable.time_slots !== 'object') {
      return timeSlots;
    }
    Object.entries(dayTimetable.time_slots).forEach(([time, slot]: [string, unknown]) => {
      const typedSlot = slot as { slot_code?: string; slot_type?: string };
      if (typedSlot?.slot_code) {
        // Find course title from slot mapping
        const slotCode = typedSlot.slot_code;
        const slotMapping = timetableData?.slot_mapping || {};
        const courseTitle = slotMapping[slotCode] || '';
        
        timeSlots.push({
          time,
          course_title: courseTitle,
          category: typedSlot.slot_type || ''
        });
      }
    });

    // Sort by start time of the time slot
    return timeSlots.sort((a, b) => {
      // Extract start time from "HH:MM-HH:MM" format
      const getStartTime = (timeStr: string): number => {
        const startTime = timeStr.split('-')[0]; // Get "HH:MM"
        const timeParts = startTime.split(':').map(Number);
        let hours = timeParts[0];
        const minutes = timeParts[1];
        
        // Convert 12-hour format to 24-hour for proper sorting
        // Times 01:xx through 07:xx are PM (13:xx to 19:xx in 24-hour)
        // Times 08:xx onwards are AM (keep as is)
        // Times 12:xx stay as 12:xx (noon)
        if (hours < 8 && hours !== 0) {
          hours += 12; // Convert 1PM-7PM to 13-19
        }
        
        const minutesValue = hours * 60 + minutes;
        return minutesValue;
      };
      return getStartTime(a.time) - getStartTime(b.time);
    });
  };

  useEffect(() => {
    checkAdminStatus();
    fetchUnifiedData();
  }, []);

  const checkAdminStatus = async () => {
    try {
      const access_token = getStorageItem('access_token');
      if (!access_token) {
        setIsAdmin(false);
        return;
      }

      const response = await fetch('/api/admin/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token })
      });

      const result = await response.json();
      setIsAdmin(result.success === true && result.isAdmin === true);
    } catch (err) {
      console.error('[Dashboard] Error checking admin status:', err);
      setIsAdmin(false);
    }
  };

  // Handle skeleton display with 2s delay when no cache found
  useEffect(() => {
    if (!loading) {
      setShowSkeleton(false);
      return;
    }

    // Check if we have any cache
    const cachedAttendance = getClientCache('attendance');
    const cachedMarks = getClientCache('marks');
    const cachedTimetable = getClientCache('timetable');
    const hasAnyCache = !!(cachedAttendance || cachedMarks || cachedTimetable);
    
    setHasCache(hasAnyCache);

    if (!hasAnyCache) {
      // Wait 2 seconds before showing skeleton
      const timer = setTimeout(() => {
        setShowSkeleton(true);
      }, 2000);

      return () => clearTimeout(timer);
    } else {
      // If cache exists, show skeleton immediately
      setShowSkeleton(true);
    }
  }, [loading]);

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
  };

  /**
   * Wait for password to be available in storage (handles race condition after login)
   * Retries with exponential backoff up to 5 attempts
   */
  const waitForPassword = async (maxAttempts = 5): Promise<string | null> => {
    const getPortalPassword = async () => {
      const { getPortalPassword } = await import('@/lib/passwordStorage');
      return getPortalPassword();
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const password = await getPortalPassword();
      
      if (password) {
        if (attempt > 1) {
          console.log(`[Dashboard] ✅ Password available after ${attempt} attempt(s)`);
        }
        return password;
      }
      
      if (attempt < maxAttempts) {
        // Exponential backoff: 200ms, 400ms, 800ms, 1600ms
        const delay = 200 * Math.pow(2, attempt - 1);
        console.log(`[Dashboard] ⏳ Password not available yet, retrying in ${delay}ms... (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    console.error('[Dashboard] ❌ Password not available after all retry attempts');
    return null;
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);

      const access_token = getStorageItem('access_token');
      
      if (!access_token) {
        console.error('[Dashboard] No access token found');
        setError('Please sign in to view dashboard');
        setLoading(false);
        return;
      }

      // Check individual client-side caches first (unless force refresh)
      // Note: Calendar is always fetched fresh from public.calendar table, not from cache
      // Remove any old calendar cache that might exist
      removeClientCache('calendar');
      console.log('[Dashboard] 🗑️ Removed any existing calendar cache (calendar is always fresh)');

      // Ensure timetable data is available for today's timetable display
      // If timetable is not cached, we need to fetch it along with calendar
      const hasTimetableCache = !!getClientCache('timetable');
      console.log(`[Dashboard] 📋 Timetable cache status: ${hasTimetableCache ? 'available' : 'missing'}`);
      
      // Also check and clean unified cache if it contains calendar data
      const unifiedCache = getClientCache('unified');
      if (unifiedCache && typeof unifiedCache === 'object' && 'data' in unifiedCache) {
        const unifiedData = unifiedCache as { data?: { calendar?: unknown } };
        if (unifiedData.data?.calendar) {
          console.log('[Dashboard] 🗑️ Found calendar in unified cache, removing it');
          // Remove calendar from unified cache data
          if (unifiedData.data) {
            delete unifiedData.data.calendar;
            setClientCache('unified', unifiedCache);
            console.log('[Dashboard] ✅ Cleaned calendar from unified cache');
          }
        }
      }
      
      let cachedAttendance: AttendanceData | null = null;
      let cachedMarks: MarksData | null = null;
      let cachedTimetable: unknown | null = null;
      let needsBackgroundRefresh = false;
      
      if (!forceRefresh) {
        // Check client-side cache first
        cachedAttendance = getClientCache<AttendanceData>('attendance');
        cachedMarks = getClientCache<MarksData>('marks');
        cachedTimetable = getClientCache('timetable');
        
        // If client cache is expired, fetch Supabase cache (even if expired)
        if (!cachedAttendance || !cachedMarks || !cachedTimetable) {
          console.log('[Dashboard] 🔍 Client cache expired/missing, fetching Supabase cache (even if expired)...');
          
          // Fetch Supabase cache for missing data types
          const supabaseCachePromises: Promise<void>[] = [];
          
          if (!cachedAttendance) {
            supabaseCachePromises.push(
              fetch('/api/data/cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token, data_type: 'attendance' })
              })
                .then(res => res.json())
                .then(result => {
                  if (result.success && result.data) {
                    console.log(`[Dashboard] ✅ Found Supabase cache for attendance (expired: ${result.isExpired})`);
                    cachedAttendance = result.data as AttendanceData;
                    setAttendanceData(cachedAttendance);
                    if (result.isExpired) {
                      needsBackgroundRefresh = true;
                      console.log('[Dashboard] ⚠️ Attendance cache is expired, will refresh in background');
                    }
                  }
                })
                .catch(err => console.error('[Dashboard] ❌ Error fetching Supabase attendance cache:', err))
            );
          }
          
          if (!cachedMarks) {
            supabaseCachePromises.push(
              fetch('/api/data/cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token, data_type: 'marks' })
              })
                .then(res => res.json())
                .then(result => {
                  if (result.success && result.data) {
                    console.log(`[Dashboard] ✅ Found Supabase cache for marks (expired: ${result.isExpired})`);
                    cachedMarks = result.data as MarksData;
                    setMarksData(cachedMarks);
                    if (result.isExpired) {
                      needsBackgroundRefresh = true;
                      console.log('[Dashboard] ⚠️ Marks cache is expired, will refresh in background');
                    }
                  }
                })
                .catch(err => console.error('[Dashboard] ❌ Error fetching Supabase marks cache:', err))
            );
          }
          
          if (!cachedTimetable) {
            supabaseCachePromises.push(
              fetch('/api/data/cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token, data_type: 'timetable' })
              })
                .then(res => res.json())
                .then(result => {
                  if (result.success && result.data) {
                    console.log(`[Dashboard] ✅ Found Supabase cache for timetable (expired: ${result.isExpired})`);
                    cachedTimetable = result.data;
                    // Process timetable data
                    let timetableDataToUse: typeof timetableData | null = null;
                    if (typeof cachedTimetable === 'object' && cachedTimetable !== null) {
                      if ('data' in cachedTimetable && typeof (cachedTimetable as { data?: unknown }).data === 'object' && (cachedTimetable as { data?: unknown }).data !== null) {
                        const cachedData = (cachedTimetable as { data?: typeof timetableData }).data;
                        if (cachedData && ('timetable' in cachedData || 'time_slots' in cachedData)) {
                          timetableDataToUse = cachedData;
                        }
                      } else if ('timetable' in cachedTimetable || 'time_slots' in cachedTimetable) {
                        timetableDataToUse = cachedTimetable as typeof timetableData;
                      }
                    }
                    if (timetableDataToUse) {
                      setTimetableData(timetableDataToUse);
                      try {
                        const timetableForUtils = {
                          timetable: (timetableDataToUse.timetable || {}) as TimetableData['timetable'],
                          slot_mapping: timetableDataToUse.slot_mapping,
                        } as TimetableData;
                        const occurrences = getSlotOccurrences(timetableForUtils);
                        setSlotOccurrences(occurrences);
                      } catch (err) {
                        console.error('[Dashboard] ❌ Error processing cached timetable:', err);
                      }
                    }
                    if (result.isExpired) {
                      needsBackgroundRefresh = true;
                      console.log('[Dashboard] ⚠️ Timetable cache is expired, will refresh in background');
                    }
                  }
                })
                .catch(err => console.error('[Dashboard] ❌ Error fetching Supabase timetable cache:', err))
            );
          }
          
          // Wait for all Supabase cache fetches to complete
          await Promise.all(supabaseCachePromises);
        }
        
        // Use client-side cached data if available (highest priority)
        if (cachedAttendance) {
          console.log('[Dashboard] ✅ Using client-side cache for attendance');
          setAttendanceData(cachedAttendance);
        }
        if (cachedMarks) {
          console.log('[Dashboard] ✅ Using client-side cache for marks');
          setMarksData(cachedMarks);
        }
        if (cachedTimetable) {
          console.log('[Dashboard] ✅ Using client-side cache for timetable');
          console.log('[Dashboard] 📊 Cached timetable structure:', {
            type: typeof cachedTimetable,
            isNull: cachedTimetable === null,
            keys: cachedTimetable && typeof cachedTimetable === 'object' ? Object.keys(cachedTimetable) : 'not an object',
            hasDataProperty: cachedTimetable && typeof cachedTimetable === 'object' && 'data' in cachedTimetable,
            dataKeys: cachedTimetable && typeof cachedTimetable === 'object' && 'data' in cachedTimetable && typeof (cachedTimetable as any).data === 'object' ? Object.keys((cachedTimetable as any).data) : 'no data property',
            hasTimetable: cachedTimetable && typeof cachedTimetable === 'object' && ('timetable' in cachedTimetable || ('data' in cachedTimetable && typeof (cachedTimetable as any).data === 'object' && 'timetable' in (cachedTimetable as any).data)),
            hasTimeSlots: cachedTimetable && typeof cachedTimetable === 'object' && ('time_slots' in cachedTimetable || ('data' in cachedTimetable && typeof (cachedTimetable as any).data === 'object' && 'time_slots' in (cachedTimetable as any).data))
          });
          let timetableDataToUse: typeof timetableData | null = null;

          if (typeof cachedTimetable === 'object' && cachedTimetable !== null) {
            if ('data' in cachedTimetable && typeof (cachedTimetable as { data?: unknown }).data === 'object' && (cachedTimetable as { data?: unknown }).data !== null) {
              const cachedData = (cachedTimetable as { data?: typeof timetableData }).data;
              if (cachedData && ('timetable' in cachedData || 'time_slots' in cachedData)) {
                timetableDataToUse = cachedData;
                console.log('[Dashboard] ✅ Extracted timetable from wrapped format (data property)');
                console.log('[Dashboard] 📊 Extracted data structure:', {
                  hasTimetable: 'timetable' in cachedData,
                  hasSlotMapping: 'slot_mapping' in cachedData,
                  timetableKeys: cachedData.timetable ? Object.keys(cachedData.timetable) : 'no timetable',
                  slotMappingKeys: cachedData.slot_mapping ? Object.keys(cachedData.slot_mapping) : 'no slot_mapping'
                });
              }
            } else if ('timetable' in cachedTimetable || 'time_slots' in cachedTimetable) {
              timetableDataToUse = cachedTimetable as typeof timetableData;
              console.log('[Dashboard] ✅ Using timetable in direct format');
              console.log('[Dashboard] 📊 Direct format structure:', {
                hasTimetable: 'timetable' in cachedTimetable,
                hasSlotMapping: 'slot_mapping' in cachedTimetable,
                timetableKeys: (cachedTimetable as any).timetable ? Object.keys((cachedTimetable as any).timetable) : 'no timetable',
                slotMappingKeys: (cachedTimetable as any).slot_mapping ? Object.keys((cachedTimetable as any).slot_mapping) : 'no slot_mapping'
              });
            }
          }
          
          if (timetableDataToUse) {
            setTimetableData(timetableDataToUse);
            try {
              const timetableForUtils = {
                timetable: (timetableDataToUse.timetable || {}) as TimetableData['timetable'],
                slot_mapping: timetableDataToUse.slot_mapping,
              } as TimetableData;
              const occurrences = getSlotOccurrences(timetableForUtils);
              setSlotOccurrences(occurrences);
              console.log('[Dashboard] ✅ Timetable slot occurrences loaded:', occurrences.length);
            } catch (err) {
              console.error('[Dashboard] ❌ Error processing cached timetable:', err);
            }
          } else {
            console.warn('[Dashboard] ⚠️ Cached timetable has unexpected structure');
            console.warn('[Dashboard] 📊 Failed to extract timetable from cache - will use fresh data from API');
          }
        }
        
        // Update cache status for skeleton display
        const hasAnyCache = !!(cachedAttendance || cachedMarks || cachedTimetable);
        setHasCache(hasAnyCache);
      } else {
        // Force refresh: clear client caches
        removeClientCache('attendance');
        removeClientCache('marks');
        removeClientCache('timetable');
        removeClientCache('unified');
        console.log('[Dashboard] 🗑️ Cleared client caches for force refresh');
      }
      
      // Determine what needs to be fetched
      // If Supabase cache is expired, we still need to fetch fresh data
      const needAttendance = !cachedAttendance || forceRefresh || needsBackgroundRefresh;
      const needMarks = !cachedMarks || forceRefresh || needsBackgroundRefresh;
      const needTimetable = !cachedTimetable || forceRefresh || needsBackgroundRefresh;
      const missingCount = [needAttendance, needMarks, needTimetable].filter(Boolean).length;
      
      console.log('[Dashboard] 📊 Cache status:');
      console.log(`[Dashboard]   - Attendance: ${cachedAttendance ? '✓ Cached' : '✗ Need fetch'}`);
      console.log(`[Dashboard]   - Marks: ${cachedMarks ? '✓ Cached' : '✗ Need fetch'}`);
      console.log(`[Dashboard]   - Timetable: ${cachedTimetable ? '✓ Cached' : '✗ Need fetch'}`);
      console.log(`[Dashboard]   - Missing count: ${missingCount}/3`);
      
      // Always use unified API endpoint with request deduplication
      // This ensures only one page calls the backend at a time
      // Ensure password is available (handles race condition after login redirect)
      const password = await waitForPassword();
      
      if (!password) {
        console.warn('[Dashboard] ⚠️ Password not available - API request may fail, but will retry on session_expired');
      }

      // Declare result at function scope so it's accessible in all branches
      let result: any = null;
      let response: Response | null = null;
      
      if (missingCount > 0 || forceRefresh || needsBackgroundRefresh) {
        // Fetch from API with automatic retry on password-related session_expired
        let apiStartTime = Date.now();
        const fetchType = forceRefresh ? '(force refresh all)' : needsBackgroundRefresh ? '(background refresh - cache expired)' : '(fetching all data)';
        
        // Use request deduplication for unified API calls - ensures only ONE call at a time
        const requestKey = `fetch_unified_all_${access_token.substring(0, 10)}`;
        const apiResult = await deduplicateRequest(requestKey, async () => {
          // First attempt
          let attempt = 1;
          const maxRetries = 3;
          let shouldRetry = true;
          let finalResponse: Response | null = null;
          let finalResult: any = null;
          
          while (shouldRetry && attempt <= maxRetries) {
            console.log(`[Dashboard] 🚀 Fetching from API ${fetchType} (attempt ${attempt}/${maxRetries})`);
            apiStartTime = Date.now();
            
            finalResponse = await fetch('/api/data/all', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh))
            });

            const apiDuration = Date.now() - apiStartTime;
            
            // Check if response is OK and has content before parsing JSON
            if (!finalResponse.ok) {
              const errorText = await finalResponse.text().catch(() => 'Unknown error');
              console.error(`[Dashboard] ❌ API error response (${finalResponse.status}):`, errorText);
              throw new Error(`API request failed with status ${finalResponse.status}: ${errorText}`);
            }
            
            // Check if response has content
            const contentType = finalResponse.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              const text = await finalResponse.text();
              console.error(`[Dashboard] ❌ Invalid response content type:`, contentType);
              console.error(`[Dashboard]   - Response body:`, text.substring(0, 200));
              throw new Error(`Invalid response format. Expected JSON, got ${contentType}`);
            }
            
            // Parse JSON with error handling
            try {
              const responseText = await finalResponse.text();
              if (!responseText || responseText.trim().length === 0) {
                console.error(`[Dashboard] ❌ Empty response body`);
                throw new Error('Empty response from server');
              }
              finalResult = JSON.parse(responseText);
            } catch (jsonError) {
              console.error(`[Dashboard] ❌ JSON parse error:`, jsonError);
              console.error(`[Dashboard]   - Response status: ${finalResponse.status}`);
              throw new Error(`Failed to parse JSON response: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`);
            }
            
            console.log(`[Dashboard] 📡 API response received: ${apiDuration}ms`);
            console.log(`[Dashboard]   - Success: ${finalResult.success}`);
            console.log(`[Dashboard]   - Status: ${finalResponse.status}`);
            console.log(`[Dashboard]   - Error: ${finalResult.error || 'none'}`);
            
            // Check if session_expired is due to missing password (retryable)
            const isSessionExpiredDueToPassword = 
              (finalResult.error === 'session_expired' || !finalResponse.ok) && 
              attempt < maxRetries && 
              !password; // Only retry if password wasn't available initially
            
            if (isSessionExpiredDueToPassword) {
              console.log(`[Dashboard] 🔄 session_expired detected, waiting for password to be stored...`);
              // Wait a bit longer for password storage to complete
              const retryDelay = 500 * attempt; // 500ms, 1000ms, 1500ms
              await new Promise(resolve => setTimeout(resolve, retryDelay));
              
              // Check if password is now available
              const retryPassword = await waitForPassword(3); // Quick check with fewer attempts
              if (retryPassword) {
                console.log(`[Dashboard] ✅ Password now available, retrying API call...`);
                attempt++;
                continue; // Retry the API call
              } else {
                console.warn(`[Dashboard] ⚠️ Password still not available after wait`);
              }
            }
            
            shouldRetry = false; // Exit retry loop
          }
          
          // Ensure response and result are set
          if (!finalResponse || !finalResult) {
            throw new Error('Failed to fetch data from API');
          }

          // Only show session_expired error if all retries failed and password is confirmed unavailable
          if (!finalResponse.ok || (finalResult.error === 'session_expired')) {
            const finalPasswordCheck = await waitForPassword(2); // Quick final check
            if (!finalPasswordCheck) {
              // Password is definitely not available - legitimate session expired
              console.error('[Dashboard] ❌ Session expired - password not available after all retries');
              throw new Error('Your session has expired. Please re-enter your password.');
            } else {
              // Password became available - retry one more time
              console.log('[Dashboard] 🔄 Password available on final check, retrying...');
              const retryResponse = await fetch('/api/data/all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh))
              });
              const retryResult = await retryResponse.json();
              
              if (!retryResponse.ok || (retryResult.error === 'session_expired')) {
                throw new Error('Your session has expired. Please re-enter your password.');
              }
              // Success on final retry - update result and continue processing
              finalResponse = retryResponse;
              finalResult = retryResult;
            }
          }

          if (!finalResult.success) {
            throw new Error(finalResult.error || 'Failed to fetch data');
          }

          return { response: finalResponse, result: finalResult };
        });
        
        response = apiResult.response;
        result = apiResult.result;
        
        processUnifiedData(result);
        
        // Save individual caches from unified response
        if (result.data) {
          if (result.data.attendance) {
            setClientCache('attendance', result.data.attendance);
          }
          if (result.data.marks) {
            setClientCache('marks', result.data.marks);
          }
          if (result.data.timetable) {
            setClientCache('timetable', result.data.timetable);
          }
        }
      } else if (missingCount === 0) {
        // Check if we need timetable data for today's timetable display
        const needsTimetable = !hasTimetableCache;
        const dataToFetch = needsTimetable ? ['calendar', 'timetable'] : ['calendar'];

        console.log(`[Dashboard] ✅ All other data cached, fetching: ${dataToFetch.join(', ')}...`);
        const requestKey = `fetch_${dataToFetch.join('_')}_${access_token.substring(0, 10)}`;
        const calendarResult = await deduplicateRequest(requestKey, async () => {
          const response = await fetch('/api/data/all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getRequestBodyWithPassword(access_token, false, dataToFetch))
          });
          const result = await response.json();
          if (result.success && result.data?.calendar) {
            processUnifiedData(result);
          }
          return result;
        });
        
        // Assign to outer result variable so it can be used later (e.g., in registerAttendanceFetch check)
        result = calendarResult;
      }
      
      // Register attendance/marks fetch for smart prefetch scheduling
      // Only register if we fetched unified data (result is defined)
      const allMissing = missingCount === 3;
      if (missingCount > 1 || allMissing) {
        if (result && result.success && (result.data?.attendance?.success || result.data?.marks?.success)) {
          registerAttendanceFetch();
        }
      }

    } catch (err) {
      console.error('[Dashboard] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const processUnifiedData = (result: {
    data: {
      calendar?: { data?: Array<unknown>; success?: { data?: Array<unknown> } } | null;
      attendance?: { data?: { all_subjects: unknown[]; metadata?: { semester?: number } }; success?: { data?: { all_subjects: unknown[]; metadata?: { semester?: number } } }; semester?: number } | null;
      marks?: { data?: { all_courses: unknown[] }; success?: { data?: { all_courses: unknown[] } } } | null;
      timetable?: { data?: unknown; success?: { data?: unknown } } | null;
    };
    metadata?: { semester?: number; [key: string]: unknown };
    semester?: number;
  }) => {
    console.log('[Dashboard] Processing unified data:', result);
    console.log('[Dashboard] Attendance data:', result.data.attendance);
    console.log('[Dashboard] Marks data:', result.data.marks);
    
    // Process calendar data - handle both direct format and wrapped format
    console.log('[Dashboard] 📋 ========================================');
    console.log('[Dashboard] 📋 CALENDAR PROCESSING - Starting calendar data processing');
    console.log('[Dashboard] 📋   - result.data.calendar exists:', !!result.data.calendar);
    console.log('[Dashboard] 📋   - result.data.calendar type:', typeof result.data.calendar);
    console.log('[Dashboard] 📋   - result.data.calendar is array:', Array.isArray(result.data.calendar));
    if (result.data.calendar && Array.isArray(result.data.calendar)) {
      console.log('[Dashboard] 📋   - Calendar array length:', result.data.calendar.length);
      if (result.data.calendar.length > 0) {
        console.log('[Dashboard] 📋   - First event sample:', JSON.stringify(result.data.calendar[0], null, 2).substring(0, 200));
        console.log('[Dashboard] 📋   - Last event sample:', JSON.stringify(result.data.calendar[result.data.calendar.length - 1], null, 2).substring(0, 200));
      }
    }
    console.log('[Dashboard] 📋 ========================================');
    
    let calendarEvents: CalendarEvent[] | null = null;
    
    if (Array.isArray(result.data.calendar)) {
      // Check if it's the new nested format: [{month: "Jan '26", dates: [{day, date, event, day_order}, ...]}, ...]
      const firstItem = result.data.calendar[0];
      if (firstItem && typeof firstItem === 'object' && 'month' in firstItem && 'dates' in firstItem) {
        // New nested format: [{month: "Jan '26", dates: [{day, date, event, day_order}, ...]}, ...]
        console.log('[Dashboard] 🔄 Detected new nested calendar format - flattening...');
        calendarEvents = [];
        result.data.calendar.forEach((monthData: any) => {
          if (monthData.month && Array.isArray(monthData.dates)) {
            monthData.dates.forEach((dateData: any) => {
              calendarEvents!.push({
                date: dateData.date?.toString() || '',
                day_name: dateData.day || '',
                content: dateData.event || '',
                day_order: dateData.day_order || '',
                month: monthData.month,
                month_name: monthData.month?.split(' ')[0] || '',
                year: monthData.month?.split(' ')[1] || ''
              });
            });
          }
        });
        console.log(`[Dashboard] ✅ Flattened ${calendarEvents.length} calendar events from nested format`);
      } else {
        // Direct array format (legacy)
        calendarEvents = result.data.calendar;
        console.log('[Dashboard] ✅ Calendar data is direct array format');
        console.log('[Dashboard]   - Total events:', calendarEvents.length);
      }
    } else if (result.data.calendar && typeof result.data.calendar === 'object') {
      // Check if it's wrapped format: {success: true, data: [...]}
      if ('success' in result.data.calendar && 'data' in result.data.calendar) {
        const calendarWrapper = result.data.calendar as { success?: boolean | { data?: CalendarEvent[] }; data?: CalendarEvent[] };
        const successValue = calendarWrapper.success;
        const isSuccess = typeof successValue === 'boolean' ? successValue : successValue !== undefined;
        if (isSuccess && Array.isArray(calendarWrapper.data)) {
          calendarEvents = calendarWrapper.data;
          console.log('[Dashboard] ✅ Calendar data is wrapped format');
          console.log('[Dashboard]   - Total events:', calendarEvents.length);
        }
      }
      // Check legacy nested format: {data: [...]}
      else if ('data' in result.data.calendar && Array.isArray((result.data.calendar as { data?: CalendarEvent[] }).data)) {
        calendarEvents = (result.data.calendar as { data: CalendarEvent[] }).data;
        console.log('[Dashboard] ✅ Calendar data is legacy nested format');
        console.log('[Dashboard]   - Total events:', calendarEvents.length);
      }
    }
    
    if (calendarEvents && calendarEvents.length > 0) {
      // Extract semester from multiple sources with fallbacks
      let extractedSemester: number | null = null;
      
      // 1. Try attendance data first - handle both direct and wrapped formats
      if (result.data.attendance && typeof result.data.attendance === 'object') {
        // Direct format: {metadata: {semester: ...}, ...}
        if ('metadata' in result.data.attendance && result.data.attendance.metadata && typeof result.data.attendance.metadata === 'object' && 'semester' in result.data.attendance.metadata) {
          extractedSemester = (result.data.attendance.metadata as { semester?: number }).semester || null;
          console.log('[Dashboard] Semester from attendance.metadata.semester (direct):', extractedSemester);
        }
        // Wrapped format: {data: {metadata: {semester: ...}}, ...}
        else if ('data' in result.data.attendance && result.data.attendance.data && typeof result.data.attendance.data === 'object' && 'metadata' in result.data.attendance.data) {
          const attendanceData = result.data.attendance.data as { metadata?: { semester?: number } };
          if (attendanceData.metadata?.semester) {
            extractedSemester = attendanceData.metadata.semester;
            console.log('[Dashboard] Semester from attendance.data.metadata.semester (wrapped):', extractedSemester);
          }
        }
        // Legacy: direct semester property
        else if ('semester' in result.data.attendance) {
          extractedSemester = (result.data.attendance as { semester?: number }).semester || null;
          console.log('[Dashboard] Semester from attendance.semester (legacy):', extractedSemester);
        }
      } 
      // 2. Try response metadata
      else if (result.metadata?.semester) {
        extractedSemester = result.metadata.semester;
        console.log('[Dashboard] Semester from metadata.semester:', extractedSemester);
      }
      // 3. Try response root
      else if ((result as { semester?: number }).semester) {
        extractedSemester = (result as { semester?: number }).semester!;
        console.log('[Dashboard] Semester from root.semester:', extractedSemester);
      }
      // 4. Try storage cache
      else {
        const cachedSemester = getStorageItem('user_semester');
        if (cachedSemester) {
          extractedSemester = parseInt(cachedSemester, 10);
          console.log('[Dashboard] Semester from storage cache:', extractedSemester);
        }
      }
      
      // Default to 1 if no semester found
      const finalSemester = extractedSemester || 1;
      
      // Store semester in storage if found
      if (extractedSemester) {
          setStorageItem('user_semester', extractedSemester.toString());
        console.log('[Dashboard] 💾 Stored semester in storage:', extractedSemester);
      }
      
      console.log('[Dashboard] 📋 Calendar events count:', calendarEvents.length);
      if (calendarEvents.length > 0) {
        console.log('[Dashboard] 📋   - First event:', JSON.stringify(calendarEvents[0], null, 2).substring(0, 200));
        console.log('[Dashboard] 📋   - Sample dates range:', calendarEvents[0]?.date, 'to', calendarEvents[calendarEvents.length - 1]?.date);
      }
      
      // Normalize calendar event dates from "DD/Month 'YY" to "DD/MM/YYYY" format for proper matching
      const normalizedCalendarEvents = calendarEvents.map(event => ({
        ...event,
        date: normalizeCalendarDate(event.date)
      }));
      
      console.log('[Dashboard] 📋 Normalized calendar dates:');
      if (normalizedCalendarEvents.length > 0) {
        console.log('[Dashboard] 📋   - First normalized date:', normalizedCalendarEvents[0]?.date);
        console.log('[Dashboard] 📋   - Last normalized date:', normalizedCalendarEvents[normalizedCalendarEvents.length - 1]?.date);
      }
      
      // Display calendar data with normalized dates
      setCalendarData(normalizedCalendarEvents);
      console.log('[Dashboard] ✅ ✅ ✅ Calendar data loaded and set:', normalizedCalendarEvents.length, 'events');
    } else {
      console.warn('[Dashboard] ⚠️ No calendar data found');
      console.warn('[Dashboard] Calendar data type:', typeof result.data.calendar);
      console.warn('[Dashboard] Calendar data is array:', Array.isArray(result.data.calendar));
      setCalendarData([]);
    }

    // Process attendance data - handle both direct format and wrapped format
    let attendanceDataObj: AttendanceData | null = null;
    
    if (result.data.attendance && typeof result.data.attendance === 'object') {
      // Check if it's direct format (has all_subjects, summary, metadata at root)
      if ('all_subjects' in result.data.attendance || 'summary' in result.data.attendance) {
        // Direct format
        attendanceDataObj = result.data.attendance as AttendanceData;
        console.log('[Dashboard] Attendance data is direct format');
      } 
      // Check if it's wrapped format: {success: true, data: {...}}
      else if ('success' in result.data.attendance && 'data' in result.data.attendance) {
        const attendanceWrapper = result.data.attendance as { success?: boolean | { data?: AttendanceData }; data?: AttendanceData };
        const successValue = attendanceWrapper.success;
        const isSuccess = typeof successValue === 'boolean' ? successValue : successValue !== undefined;
        if (isSuccess && attendanceWrapper.data) {
          attendanceDataObj = attendanceWrapper.data;
          console.log('[Dashboard] Attendance data is wrapped format');
        }
      }
      // Check legacy nested format: {data: {...}} or {success: {data: {...}}}
      else if ('data' in result.data.attendance) {
        const legacyData = (result.data.attendance as { data?: AttendanceData }).data;
        if (legacyData && ('all_subjects' in legacyData || 'summary' in legacyData)) {
          attendanceDataObj = legacyData;
          console.log('[Dashboard] Attendance data is legacy nested format');
        }
      }
    }
    
    if (attendanceDataObj && (attendanceDataObj.all_subjects || (attendanceDataObj as { summary?: unknown }).summary)) {
      setAttendanceData(attendanceDataObj);
      console.log('[Dashboard] ✅ Attendance data loaded:', attendanceDataObj.all_subjects?.length || 0);
    } else if (result.data.attendance !== undefined && result.data.attendance !== null) {
      // Only overwrite if attendance was explicitly provided in result (not undefined/null)
      // This prevents overwriting cached data when only calendar is fetched
      console.warn('[Dashboard] ⚠️ No attendance data found');
      console.warn('[Dashboard] Attendance data type:', typeof result.data.attendance);
      console.warn('[Dashboard] Attendance data value:', result.data.attendance);
      setAttendanceData(null);
    } else {
      // result.data.attendance is undefined/null - don't overwrite existing state (likely from cache)
      console.log('[Dashboard] ℹ️ Attendance not in API response, keeping existing state (likely from cache)');
    }

    // Process marks data - handle both direct format and wrapped format
    let marksDataObj: MarksData | null = null;
    
    if (result.data.marks && typeof result.data.marks === 'object') {
      // Check if it's direct format (has all_courses, summary, metadata at root)
      if ('all_courses' in result.data.marks || 'summary' in result.data.marks) {
        // Direct format
        marksDataObj = result.data.marks as MarksData;
        console.log('[Dashboard] Marks data is direct format');
      } 
      // Check if it's wrapped format: {success: true, data: {...}}
      else if ('success' in result.data.marks && 'data' in result.data.marks) {
        const marksWrapper = result.data.marks as { success?: boolean | { data?: MarksData }; data?: MarksData };
        const successValue = marksWrapper.success;
        const isSuccess = typeof successValue === 'boolean' ? successValue : successValue !== undefined;
        if (isSuccess && marksWrapper.data) {
          marksDataObj = marksWrapper.data;
          console.log('[Dashboard] Marks data is wrapped format');
        }
      }
      // Check legacy nested format: {data: {...}} or {success: {data: {...}}}
      else if ('data' in result.data.marks) {
        const legacyData = (result.data.marks as { data?: MarksData }).data;
        if (legacyData && ('all_courses' in legacyData || 'summary' in legacyData)) {
          marksDataObj = legacyData;
          console.log('[Dashboard] Marks data is legacy nested format');
        }
      }
    }
    
    if (marksDataObj && (marksDataObj.all_courses || (marksDataObj as { summary?: unknown }).summary)) {
      setMarksData(marksDataObj);
      console.log('[Dashboard] ✅ Marks data loaded:', marksDataObj.all_courses?.length || 0);
    } else if (result.data.marks !== undefined && result.data.marks !== null) {
      // Only overwrite if marks was explicitly provided in result (not undefined/null)
      // This prevents overwriting cached data when only calendar is fetched
      console.warn('[Dashboard] ⚠️ No marks data found');
      console.warn('[Dashboard] Marks data type:', typeof result.data.marks);
      console.warn('[Dashboard] Marks data value:', result.data.marks);
      setMarksData(null);
    } else {
      // result.data.marks is undefined/null - don't overwrite existing state (likely from cache)
      console.log('[Dashboard] ℹ️ Marks not in API response, keeping existing state (likely from cache)');
    }

    // Process timetable data
    let timetableDataObj: typeof timetableData | null = null;

    if (result.data.timetable && typeof result.data.timetable === 'object') {
      const timetableObj = result.data.timetable as Record<string, unknown>;

      // Check if it's backend schedule format and transform it
      if (timetableObj.schedule && Array.isArray(timetableObj.schedule)) {
        console.log('[Dashboard] 🔄 Transforming backend schedule format...');

        const timeSlots = [
          "08:00-08:50", "08:50-09:40", "09:45-10:35", "10:40-11:30", "11:35-12:25",
          "12:30-01:20", "01:25-02:15", "02:20-03:10", "03:10-04:00", "04:00-04:50"
        ];

        const schedule = timetableObj.schedule as Array<{ day: number; table: Array<unknown> }> | undefined;
        if (!schedule || !Array.isArray(schedule)) {
          console.warn('[Dashboard] Invalid schedule format');
          timetableDataObj = {
            slot_mapping: {},
            timetable: {}
          };
        } else {
          const timetable: Record<string, { do_name?: string; time_slots?: Record<string, unknown> }> = {};
          const slotMapping: Record<string, string> = {};

          // Map day numbers (1-5) to DO names
          const dayToDO: Record<number, string> = {
            1: 'DO 1',
            2: 'DO 2',
            3: 'DO 3',
            4: 'DO 4',
            5: 'DO 5'
          };

          schedule.forEach((daySchedule) => {
            const doName = dayToDO[daySchedule.day];
            if (!doName) return;

            const timeSlotsMap: Record<string, unknown> = {};

            daySchedule.table.forEach((entry, index) => {
              if (entry && typeof entry === 'object' && entry !== null) {
                const course = entry as { code?: string; name?: string; slot?: string; courseType?: string; slotType?: string; online?: boolean };
                if (course.code && course.name && course.slot) {
                  const timeSlot = timeSlots[index] || `Slot ${index + 1}`;
                  const slotCode = course.slot;
                  const courseTitle = course.name;
                  const courseType = course.courseType || 'Theory';
                  const slotType = course.slotType || (courseType === 'Practical' ? 'Lab' : 'Theory');

                  timeSlotsMap[timeSlot] = {
                    slot_code: slotCode,
                    course_title: courseTitle,
                    slot_type: slotType,
                    is_alternate: false
                  };

                  // Build slot mapping
                  if (!slotMapping[slotCode]) {
                    slotMapping[slotCode] = courseTitle;
                  }
                }
              }
            });

            if (Object.keys(timeSlotsMap).length > 0) {
              timetable[doName] = {
                do_name: doName,
                time_slots: timeSlotsMap
              };
            }
          });

          timetableDataObj = {
            slot_mapping: slotMapping,
            timetable: timetable
          };
        }
        console.log('[Dashboard] ✅ Transformed backend schedule format');
        console.log('[Dashboard] 📊 Fresh timetable structure after transformation:', {
          hasTimetable: !!timetableDataObj?.timetable,
          hasSlotMapping: !!timetableDataObj?.slot_mapping,
          timetableKeys: timetableDataObj?.timetable ? Object.keys(timetableDataObj.timetable) : 'no timetable',
          slotMappingKeys: timetableDataObj?.slot_mapping ? Object.keys(timetableDataObj.slot_mapping) : 'no slot_mapping',
          sampleSlotMapping: timetableDataObj?.slot_mapping ? Object.entries(timetableDataObj.slot_mapping).slice(0, 3) : 'no slot_mapping'
        });
      }
    }

    if (timetableDataObj) {
      console.log('[Dashboard] 📊 Setting timetable data in state');
      setTimetableData(timetableDataObj);

      try {
        // Convert to TimetableData format for getSlotOccurrences
        const timetableForUtils = {
          timetable: (timetableDataObj.timetable || {}) as TimetableData['timetable'],
          slot_mapping: timetableDataObj.slot_mapping,
        } as TimetableData;
        const occurrences = getSlotOccurrences(timetableForUtils);
        setSlotOccurrences(occurrences);
        console.log('[Dashboard] ✅ Timetable data loaded:', occurrences.length);
      } catch (err) {
        console.error('[Dashboard] ❌ Error processing timetable:', err);
      }
    } else if (result.data.timetable !== undefined && result.data.timetable !== null) {
      // Only overwrite if timetable was explicitly provided in result (not undefined/null)
      // This prevents overwriting cached data when only calendar is fetched
      console.warn('[Dashboard] ⚠️ No timetable data found');
      console.warn('[Dashboard] Timetable data type:', typeof result.data.timetable);
      console.warn('[Dashboard] Timetable data value:', result.data.timetable);
      setTimetableData(null);
    } else {
      // result.data.timetable is undefined/null - don't overwrite existing state (likely from cache)
      console.log('[Dashboard] ℹ️ Timetable not in API response, keeping existing state (likely from cache)');
    }

    // Process day order stats using calendar data (whether direct array or wrapped)
    let calendarForStats: any[] | null = null;

    if (result.data.calendar) {
      if (Array.isArray(result.data.calendar)) {
        // Direct array format
        calendarForStats = result.data.calendar;
      } else if (result.data.calendar.data && Array.isArray(result.data.calendar.data)) {
        // Wrapped format: {data: [...]}
        calendarForStats = result.data.calendar.data;
      } else if (result.data.calendar.success?.data && Array.isArray(result.data.calendar.success.data)) {
        // Wrapped format: {success: {data: [...]}}
        calendarForStats = result.data.calendar.success.data;
      }
    }

    if (calendarForStats && Array.isArray(calendarForStats)) {
      try {
        // Extract semester using same logic as above
        let extractedSemester: number | null = null;
        
        if (result.data.attendance?.semester) {
          extractedSemester = result.data.attendance.semester;
        } else if (result.data.attendance?.data?.metadata?.semester) {
          extractedSemester = result.data.attendance.data.metadata.semester;
        } else if (result.metadata?.semester) {
          extractedSemester = result.metadata.semester;
        } else if ((result as { semester?: number }).semester) {
          extractedSemester = (result as { semester?: number }).semester!;
        } else {
          const cachedSemester = getStorageItem('user_semester');
          if (cachedSemester) {
            extractedSemester = parseInt(cachedSemester, 10);
          }
        }
        
        // Process calendar data to match CalendarEvent interface (map 'event' to 'content')
        const processedCalendarForStats = (calendarForStats as any[]).map((e: any) => ({
          date: e.date,
          day_name: e.day_name,
          content: e.event ?? '',
          day_order: e.day_order,
          month: e.month,
          month_name: e.month,
          year: e.year
        }));

        // Calculate day order stats from processed calendar data
        const stats = getDayOrderStats(processedCalendarForStats);
        setDayOrderStats(stats);
        console.log('[Dashboard] ✅ Day order stats loaded:', stats);
      } catch (err) {
        console.error('[Dashboard] ❌ Error processing day order stats:', err);
      }
    }

    // Save to client-side cache (1 hour TTL)
    // Note: Calendar is NOT cached - it's always fetched fresh from public.calendar table
    const cacheData = {
      data: {
        attendance: attendanceDataObj || attendanceData,
        marks: marksDataObj || marksData,
        timetable: timetableDataObj || timetableData,
      },
    };
    setClientCache('unified', cacheData);
    console.log('[Dashboard] 💾 Saved to client-side cache (1 hour TTL) - calendar excluded (always fresh)');
  };

  const calculatePresentHours = (conducted: string, absent: string): number => {
    const conductedNum = parseInt(conducted) || 0;
    const absentNum = parseInt(absent) || 0;
    return conductedNum - absentNum;
  };

  if (loading && !showSkeleton) {
    // Show minimal loading state for first 2 seconds if no cache
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8 justify-center overflow-hidden py-6 sm:py-8 md:py-9 lg:py-10">
        <PillNav
          logo=""
          logoAlt=""
          items={[
            { label: 'Attendance', href: '/attendance' },
            { label: 'Timetable', href: '/timetable' },
            { label: 'Marks', href: '/marks' },
            { label: 'Calendar', href: '/calender' },
            { label: 'SPGA Calculator', href: '/spga-calculator' },
            ...(isAdmin ? [{ label: 'Admin', href: '/admin' }] : [])
          ]}
          activeHref="/dashboard"
          className="custom-nav"
          ease="power2.easeOut"
          pillColor="#000000"
          baseColor="#ffffff"
          hoveredPillTextColor="#000000"
          pillTextColor="#ffffff"
        />
      </div>
    );
  }

  if (loading && showSkeleton) {
    // Show skeleton UI after 2s delay or immediately if cache exists
    const threeDayDates = getThreeDayDates();
    
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8 justify-center overflow-hidden py-6 sm:py-8 md:py-9 lg:py-10">
        <PillNav
          logo=""
          logoAlt=""
          items={[
            { label: 'Attendance', href: '/attendance' },
            { label: 'Timetable', href: '/timetable' },
            { label: 'Marks', href: '/marks' },
            { label: 'Calendar', href: '/calender' },
            { label: 'SPGA Calculator', href: '/spga-calculator' },
            ...(isAdmin ? [{ label: 'Admin', href: '/admin' }] : [])
          ]}
          activeHref="/dashboard"
          className="custom-nav"
          ease="power2.easeOut"
          pillColor="#000000"
          baseColor="#ffffff"
          hoveredPillTextColor="#000000"
          pillTextColor="#ffffff"
        />
        <div className="mt-10 sm:mt-12 md:mt-14 lg:mt-16 mb-6 sm:mb-7 md:mb-8 lg:mb-8 flex flex-col items-center gap-4">
          <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
            Welcome to your Dashboard
          </div>
        </div>

        {/* Calendar Section - Show actual calendar if available */}
        <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
            Upcoming Calendar
          </div>
          <div className="flex flex-col gap-3 w-full">
            {threeDayDates.map((dayInfo) => {
              const event = Array.isArray(calendarData) ? calendarData.find(e => e && e.date === dayInfo.dateStr) : null;
              const isToday = dayInfo.dateStr === getCurrentDateString();
              const isHoliday = event?.day_order === "-" || event?.day_order === "DO -" || (event?.content && event.content.toLowerCase().includes('holiday'));
              
              let bgColor = 'bg-white/10';
              let textColor = 'text-white';
              
              if (isToday) {
                bgColor = 'bg-white';
                textColor = 'text-black';
              } else if (isHoliday) {
                bgColor = 'bg-green-500/80';
                textColor = 'text-white';
              }
              
              return (
                <div 
                  key={dayInfo.dateStr}
                  className={`relative p-2 sm:p-2 md:p-2.5 lg:p-2.5 z-10 w-full h-auto backdrop-blur ${bgColor} border border-white/20 rounded-2xl ${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora flex flex-col sm:flex-row gap-1.5 sm:gap-3 md:gap-4 lg:gap-4 justify-between items-center`}
                >
                  <div className="flex gap-1.5 sm:gap-2 md:gap-3 lg:gap-3 items-center">
                    <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora font-bold min-w-[60px] sm:min-w-[70px] md:min-w-[80px] lg:min-w-[85px]`}>
                      {dayInfo.dayName}
                    </p>
                    <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora`}>
                      {dayInfo.dateStr}
                    </p>
                  </div>
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora flex-1 text-center`}>
                    {event?.content || 'No events'}
                  </p>
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora font-bold min-w-[50px] sm:min-w-[60px] md:min-w-[65px] lg:min-w-[70px] text-right`}>
                    {event?.day_order || '-'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Today's Timetable Section - Skeleton */}
        <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
          <SkeletonLoader className="w-full h-8 mb-2" />
          <div className="flex flex-col gap-3 w-full">
            {[1, 2, 3].map((i) => (
              <SkeletonLoader key={i} className="w-full h-16 rounded-2xl" />
            ))}
          </div>
        </div>

        {/* Attendance Section - Skeleton */}
        <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
          <SkeletonLoader className="w-full h-8 mb-2" />
          <div className="flex flex-col gap-3 w-full">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonLoader key={i} className="w-full h-20 rounded-2xl" />
            ))}
          </div>
        </div>

        {/* Marks Section - Skeleton */}
        <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
          <SkeletonLoader className="w-full h-8 mb-2" />
          <div className="flex flex-col gap-3 w-full">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonLoader key={i} className="w-full h-20 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-6 sm:gap-7 md:gap-7 lg:gap-8 justify-center overflow-hidden">
        <div className="text-red-400 text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center px-4">{error}</div>
          {error.includes('session') && (
            <NavigationButton
              path="/auth"
              onClick={handleReAuthenticate}
              className="px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm sm:text-base"
            >
              Sign In Again
            </NavigationButton>
          )}
      </div>
    );
  }

  const threeDayDates = getThreeDayDates();
  const todaysTimetable = getTodaysTimetable();
  const currentDayOrder = getCurrentDayOrder();

  console.log('[Dashboard] 🎯 Rendering dashboard with timetable info:', {
    currentDayOrder,
    todaysTimetableLength: todaysTimetable.length,
    timetableDataExists: !!timetableData,
    timetableDataKeys: timetableData ? Object.keys(timetableData) : 'no timetable data'
  });

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8 justify-center overflow-hidden py-6 sm:py-8 md:py-9 lg:py-10">
      <PillNav
        logo=""
        logoAlt=""
        items={[
          { label: 'Attendance', href: '/attendance' },
          { label: 'Timetable', href: '/timetable' },
          { label: 'Marks', href: '/marks' },
          { label: 'Calendar', href: '/calender' },
          ...(isAdmin ? [{ label: 'Admin', href: '/admin' }] : [])
        ]}
        activeHref="/dashboard"
        className="custom-nav"
        ease="power2.easeOut"
        pillColor="#000000"
        baseColor="#ffffff"
        hoveredPillTextColor="#000000"
        pillTextColor="#ffffff"
      />


      {/* Sidebar - Only visible on medium and larger screens */}
      <div className="hidden md:fixed md:top-20 md:left-6  md:flex md:flex-col md:space-y-6 md:z-[1000]">
        <nav className="flex flex-col space-y-4">
          <Link
            href="/attendance"
            className="flex items-center space-x-3 text-white hover:text-blue-300 transition-all duration-300 hover:scale-110 group"
          >
            <User className="w-5 h-5 group-hover:w-6 group-hover:h-6 transition-all duration-300" />
            <span className="font-sora text-sm group-hover:text-base transition-all duration-300">Attendance</span>
          </Link>

          <Link
            href="/timetable"
            className="flex items-center space-x-3 text-white hover:text-blue-300 transition-all duration-300 hover:scale-110 group"
          >
            <BookOpen className="w-5 h-5 group-hover:w-6 group-hover:h-6 transition-all duration-300" />
            <span className="font-sora text-sm group-hover:text-base transition-all duration-300">Timetable</span>
          </Link>

          <Link
            href="/marks"
            className="flex items-center space-x-3 text-white hover:text-blue-300 transition-all duration-300 hover:scale-110 group"
          >
            <BarChart3 className="w-5 h-5 group-hover:w-6 group-hover:h-6 transition-all duration-300" />
            <span className="font-sora text-sm group-hover:text-base transition-all duration-300">Marks</span>
          </Link>

          <Link
            href="/calender"
            className="flex items-center space-x-3 text-white hover:text-blue-300 transition-all duration-300 hover:scale-110 group"
          >
            <Calendar className="w-5 h-5 group-hover:w-6 group-hover:h-6 transition-all duration-300" />
            <span className="font-sora text-sm group-hover:text-base transition-all duration-300">Calendar</span>
          </Link>

          <Link
            href="/sgpa-calculator"
            className="flex items-center space-x-3 text-white hover:text-green-300 transition-all duration-300 hover:scale-110 group"
          >
            <Calculator className="w-5 h-5 group-hover:w-6 group-hover:h-6 transition-all duration-300" />
            <span className="font-sora text-sm group-hover:text-base transition-all duration-300">SGPA Calculator</span>
          </Link>

          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center space-x-3 text-red-300 hover:text-red-200 transition-all duration-300 hover:scale-110 group"
            >
              <Settings className="w-5 h-5 group-hover:w-6 group-hover:h-6 transition-all duration-300" />
              <span className="font-sora text-sm group-hover:text-base transition-all duration-300">Admin</span>
            </Link>
          )}
        </nav>
      </div>


      <div className="mt-10 sm:mt-12 md:mt-14 lg:mt-16 mb-6 sm:mb-7 md:mb-8 lg:mb-8 flex flex-col items-center gap-4">
        <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
          Welcome to your Dashboard
        </div>
      </div>

      {/* Calendar Section - Show 3 days (Yesterday, Today, Tomorrow) */}
      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Upcoming Calendar
        </div>
        <div className="flex flex-col gap-3 w-full">
          {threeDayDates.map((dayInfo) => {
            const event = Array.isArray(calendarData) ? calendarData.find(e => e && e.date === dayInfo.dateStr) : null;
            const isToday = dayInfo.dateStr === getCurrentDateString();
            
            // Enhanced holiday detection: check day_order and content
            const dayOrder = event?.day_order || '';
            const content = event?.content || '';
            const isHoliday = 
              dayOrder === "-" || 
              dayOrder === "DO -" || 
              dayOrder.toLowerCase() === "holiday" ||
              dayOrder.toLowerCase().includes('holiday') ||
              (content && content.toLowerCase().includes('holiday'));
            
            let bgColor = 'bg-white/10';
            let textColor = 'text-white';
            
            if (isToday) {
              bgColor = 'bg-white';
              textColor = 'text-black';
            } else if (isHoliday) {
              bgColor = 'bg-green-500/80';
              textColor = 'text-white';
            }
            
            // Display content (handle empty string as 'No events')
            const displayContent = content && content.trim() !== '' ? content : 'No events';
            
            return (
              <div 
                key={dayInfo.dateStr}
                className={`relative p-2 sm:p-2 md:p-2.5 lg:p-2.5 z-10 w-full h-auto backdrop-blur ${bgColor} border border-white/20 rounded-2xl ${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora flex flex-col sm:flex-row gap-1.5 sm:gap-3 md:gap-4 lg:gap-4 justify-between items-center`}
              >
                <div className="flex gap-1.5 sm:gap-2 md:gap-3 lg:gap-3 items-center">
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora font-bold min-w-[60px] sm:min-w-[70px] md:min-w-[80px] lg:min-w-[85px]`}>
                    {dayInfo.dayName}
                  </p>
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora`}>
                    {dayInfo.dateStr}
                  </p>
                </div>
                <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora flex-1 text-center`}>
                  {displayContent}
                </p>
                <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora font-bold min-w-[50px] sm:min-w-[60px] md:min-w-[65px] lg:min-w-[70px] text-right`}>
                  {dayOrder || '-'}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Today's Timetable Section */}
      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Today&apos;s Timetable {currentDayOrder && `- ${currentDayOrder}`}
        </div>
        {todaysTimetable.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {todaysTimetable.map((slot, index) => (
              <div 
                key={index}
                className="relative p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-auto backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col sm:flex-row gap-2 sm:gap-4 md:gap-6 lg:gap-8 justify-start items-center"
              >
                <div className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-light min-w-[100px] sm:min-w-[120px] md:min-w-[130px] lg:min-w-[150px] whitespace-nowrap">
                  {slot.time}
                </div>
                <div className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold flex-1">
                  {slot.course_title || 'No class'}
                </div>
                {slot.category && (
                  <div className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">
                    {slot.category}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-white/70 text-lg font-sora">
            {currentDayOrder ? 'No classes today' : 'Unable to determine day order'}
          </div>
        )}
      </div>

      {/* Attendance Section */}
      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Attendance Overview
        </div>
        {attendanceData?.all_subjects && Array.isArray(attendanceData.all_subjects) && attendanceData.all_subjects.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {attendanceData.all_subjects.map((subject, index) => {
              if (!subject || !subject.attendance_percentage) return null; // Skip null/invalid subjects
              const attendancePercent = parseFloat(subject.attendance_percentage.replace('%', ''));
              
              return (
                <div 
                  key={index}
                  className="relative p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-auto backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-row gap-3 sm:gap-4 md:gap-5 lg:gap-6 justify-between items-center"
                >
                  <div className="flex-1">
                    <p className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold">
                      {subject.course_title}
                    </p>
                    <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">
                      {subject.category}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className={`text-lg sm:text-xl md:text-2xl lg:text-2xl font-bold ${attendancePercent >= 75 ? 'text-green-400' : 'text-red-400'}`}>
                      {subject.attendance_percentage}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-white/70 text-lg font-sora">
            No attendance data available
          </div>
        )}
      </div>

      {/* Marks Section */}
      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Marks Overview
        </div>
        {marksData?.all_courses && Array.isArray(marksData.all_courses) && marksData.all_courses.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {marksData.all_courses
              .filter(course => course && course.assessments && Array.isArray(course.assessments) && course.assessments.length > 0)
              .filter((course, index, self) => 
                course && index === self.findIndex(c => 
                  c && c.course_code === course.course_code && c.subject_type === course.subject_type
                )
              )
              .map((course, index) => {
                if (!course) return null;
                
                const getCourseTitle = (course: MarksCourse): string => {
                  return course.course_title || course.course_code;
                };

                const getTotalMarks = () => {
                  if (!course.assessments || !Array.isArray(course.assessments) || course.assessments.length === 0) return { obtained: 0, total: 0 };
                  const obtained = course.assessments.reduce((sum, a) => sum + (a ? (parseFloat(a.marks_obtained) || 0) : 0), 0);
                  const total = course.assessments.reduce((sum, a) => sum + (a ? (parseFloat(a.total_marks) || 0) : 0), 0);
                  return { obtained, total };
                };

              const { obtained, total } = getTotalMarks();
              
              return (
                <div 
                  key={`${course.course_code}-${course.subject_type}-${index}`}
                  className="relative p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-auto backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col sm:flex-row gap-3 sm:gap-4 md:gap-5 lg:gap-6 justify-between items-center"
                >
                  <div className="flex-1">
                    <p className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold">
                      {getCourseTitle(course)}
                    </p>
                    <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">
                      {course.course_code} • {course.subject_type}
                    </p>
                  </div>
                  <div className="flex gap-4 sm:gap-5 md:gap-6 lg:gap-6 items-center">
                    <div className="text-center">
                      <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">Obtained</p>
                      <p className="text-green-400 text-lg sm:text-xl md:text-xl lg:text-xl font-bold">{obtained.toFixed(1)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">Total</p>
                      <p className="text-white text-lg sm:text-xl md:text-xl lg:text-xl font-bold">{total.toFixed(1)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-white/70 text-lg font-sora">
            No marks data available
          </div>
        )}
      </div>

      {/* Re-auth Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-white mb-4">Session Expired</h2>
            <p className="text-gray-300 mb-6">
              Your portal session has expired. Please sign in again to continue.
            </p>
            <NavigationButton
              path="/auth"
              onClick={handleReAuthenticate}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold"
            >
              Sign In
            </NavigationButton>
      </div>
      </div>
      )}
    </div>
  );
}
