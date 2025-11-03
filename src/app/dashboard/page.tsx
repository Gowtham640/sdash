'use client';
import React, { useState, useEffect } from "react";
import { getSlotOccurrences, getDayOrderStats, SlotOccurrence, DayOrderStats } from "@/lib/timetableUtils";
import Link from "next/link";
import PillNav from '../../components/PillNav';
import StaggeredMenu from '../../components/StaggeredMenu';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { markSaturdaysAsHolidays } from "@/lib/calendarHolidays";
import { setStorageItem, getStorageItem, removeStorageItem } from "@/lib/browserStorage";
import { 
  getCachedTimetable,
  isTimetableCacheValid,
  storeTimetableCache,
  getTimetableCacheAge,
  getTimetableCacheDaysRemaining 
} from '@/lib/timetableCache';
import {
  getCachedCalendar,
  isCalendarCacheValid,
  storeCalendarCache,
  getCalendarCacheAge,
  getCalendarCacheDaysRemaining
} from '@/lib/calendarCache';
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import NavigationButton from "@/components/NavigationButton";

// Import types
interface CalendarEvent {
  date: string;
  day_name: string;
  content: string;
  day_order: string;
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
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentFact, setCurrentFact] = useState(getRandomFact());
  const [factOpacity, setFactOpacity] = useState(1);
  const [dots, setDots] = useState('.');
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
    const currentDate = getCurrentDateString();
    const currentEvent = calendarData.find(event => event.date === currentDate);
    return currentEvent?.day_order || null;
  };

  // Get current day's day order number
  const getCurrentDayOrderNumber = () => {
    const dayOrder = getCurrentDayOrder();
    if (dayOrder && dayOrder.startsWith('DO ')) {
      return parseInt(dayOrder.split(' ')[1]);
    }
    return null;
  };

  // Get today's timetable based on day order
  const getTodaysTimetable = () => {
    const doNumber = getCurrentDayOrderNumber();
    if (!doNumber || !timetableData?.timetable) {
      return [];
    }

    const doKey = `DO ${doNumber}`;
    const dayTimetable = timetableData?.timetable?.[doKey];
    
    if (!dayTimetable?.time_slots) {
      return [];
    }

    // Convert to array of {time, course_title, category}
    const timeSlots: TimeSlot[] = [];
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
    fetchUnifiedData();
  }, []);

  // Animate dots (. .. ... .. . .. ... .. .)
  useEffect(() => {
    if (!loading) return;
    
    const dotSequence = ['.', '..', '...', '..', '.', '..', '...', '..', '.'];
    let dotIndex = 0;
    
    const dotInterval = setInterval(() => {
      setDots(dotSequence[dotIndex]);
      dotIndex = (dotIndex + 1) % dotSequence.length;
    }, 300); // Change dots every 300ms
    
    return () => clearInterval(dotInterval);
  }, [loading]);

  // Rotate facts every 8 seconds while loading with smooth transitions
  useEffect(() => {
    if (!loading) return;
    
    const interval = setInterval(() => {
      // Fade out
      setFactOpacity(0);
      
      // Change fact and fade in after transition
      setTimeout(() => {
      setCurrentFact(getRandomFact());
        setFactOpacity(1);
      }, 300); // Half of transition duration
    }, 8000);

    return () => clearInterval(interval);
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

      // Ensure password is available (handles race condition after login redirect)
      const password = await waitForPassword();
      
      if (!password) {
        console.warn('[Dashboard] ⚠️ Password not available - API request may fail, but will retry on session_expired');
      }

      // Check browser cache first
      const cacheKey = 'unified_data_cache';
      const cachedTimestampKey = 'unified_data_cache_timestamp';
      const cacheMaxAge = 6 * 60 * 60 * 1000; // 6 hours (matching attendance/marks pages)
      
      // Check if cache is from before login (stale cache)
      const loginTimestamp = getStorageItem('login_timestamp');
      const cachedTimestamp = getStorageItem(cachedTimestampKey);
      
      if (loginTimestamp && cachedTimestamp) {
        const loginTime = parseInt(loginTimestamp);
        const cacheTime = parseInt(cachedTimestamp);
        
        if (cacheTime < loginTime) {
          console.log('[Dashboard] 🔄 Cache is from before login, clearing stale cache');
          console.log(`[Dashboard]   - Login time: ${new Date(loginTime).toISOString()}`);
          console.log(`[Dashboard]   - Cache time: ${new Date(cacheTime).toISOString()}`);
          removeStorageItem(cacheKey);
          removeStorageItem(cachedTimestampKey);
        }
      }
      
      if (!forceRefresh) {
        const cachedData = getStorageItem(cacheKey);
        const updatedCachedTimestamp = getStorageItem(cachedTimestampKey);
        
        if (cachedData && updatedCachedTimestamp) {
          const age = Date.now() - parseInt(updatedCachedTimestamp);
          
          if (age < cacheMaxAge) {
            console.log('[Dashboard] ✅ Using browser cache');
            const result = JSON.parse(cachedData);
            
            if (result.success) {
              processUnifiedData(result);
              
              // Register attendance/marks fetch for smart prefetch scheduling
              if (result.data?.attendance?.success || result.data?.marks?.success) {
                registerAttendanceFetch();
              }
              
              setLoading(false);
              return;
            }
          }
        }
      }

      // Check split cache for timetable/calendar
      console.log("[Dashboard] 🔍 Checking static cache...");
      const cachedTimetable = !forceRefresh ? getCachedTimetable() : null;
      const cachedCalendar = !forceRefresh ? getCachedCalendar() : null;
      const hasValidTimetable = isTimetableCacheValid() && cachedTimetable;
      const hasValidCalendar = isCalendarCacheValid() && cachedCalendar;
      const hasLongTermCache = hasValidTimetable && hasValidCalendar;

      if (hasLongTermCache) {
        const timetableDaysLeft = getTimetableCacheDaysRemaining();
        const timetableCacheAge = getTimetableCacheAge();
        const calendarDaysLeft = getCalendarCacheDaysRemaining();
        const calendarCacheAge = getCalendarCacheAge();
        console.log(`[Dashboard] ✅ Static cache FOUND`);
        console.log(`[Dashboard]   - Timetable: ${timetableCacheAge} days old, ${timetableDaysLeft} days remaining`);
        console.log(`[Dashboard]   - Calendar: ${calendarCacheAge} days old, ${calendarDaysLeft} days remaining`);
      } else {
        console.log(`[Dashboard] ❌ Static cache NOT FOUND or EXPIRED`);
        if (!hasValidTimetable) console.log(`[Dashboard]   - Timetable: missing or expired`);
        if (!hasValidCalendar) console.log(`[Dashboard]   - Calendar: missing or expired`);
      }

      // Fetch from API with automatic retry on password-related session_expired
      let response: Response | null = null;
      let result: any = null;
      let apiStartTime = Date.now();
      const fetchType = forceRefresh ? '(force refresh all)' : (hasLongTermCache ? '(fetching attendance/marks only - optimized)' : '(fetching all data)');
      
      // First attempt
      let attempt = 1;
      const maxRetries = 3;
      let shouldRetry = true;
      
      while (shouldRetry && attempt <= maxRetries) {
        console.log(`[Dashboard] 🚀 Fetching from API ${fetchType} (attempt ${attempt}/${maxRetries})`);
        apiStartTime = Date.now();
        
        response = await fetch('/api/data/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh, hasLongTermCache))
      });

      const apiDuration = Date.now() - apiStartTime;
        result = await response.json();
      
      console.log(`[Dashboard] 📡 API response received: ${apiDuration}ms`);
      console.log(`[Dashboard]   - Success: ${result.success}`);
      console.log(`[Dashboard]   - Status: ${response.status}`);
        console.log(`[Dashboard]   - Error: ${result.error || 'none'}`);
        
        // Check if session_expired is due to missing password (retryable)
        const isSessionExpiredDueToPassword = 
          (result.error === 'session_expired' || !response.ok) && 
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
      if (!response || !result) {
        throw new Error('Failed to fetch data from API');
      }
      
      console.log(`[Dashboard]   - Partial data: ${result.metadata?.partial_data || false}`);

      // Merge split cache with API response if needed
      if (hasLongTermCache && result.metadata?.partial_data && !forceRefresh) {
        console.log('[Dashboard] 🔗 Merging static cache with fresh attendance/marks');
        const resultWithCache = {
          ...result,
          data: {
            ...result.data,
            timetable: hasValidTimetable ? {
              success: true,
              data: cachedTimetable,
              cached: true,
              age_days: getTimetableCacheAge()
            } : result.data.timetable,
            calendar: hasValidCalendar ? {
              success: true,
              data: cachedCalendar,
              cached: true,
              age_days: getCalendarCacheAge()
            } : result.data.calendar
          },
          metadata: {
            ...result.metadata,
            timetable_cached: hasValidTimetable,
            calendar_cached: hasValidCalendar,
            timetable_cache_days_remaining: hasValidTimetable ? getTimetableCacheDaysRemaining() : 0,
            calendar_cache_days_remaining: hasValidCalendar ? getCalendarCacheDaysRemaining() : 0
          }
        };
        result = resultWithCache;
      }

      // Store timetable/calendar in split cache if fresh data received
      if (result.success) {
        // Store timetable separately (30-day cache)
        if (result.data?.timetable?.success && result.data?.timetable?.data &&
            (!hasValidTimetable || forceRefresh)) {
          console.log('[Dashboard] 💾 Storing timetable in cache...');
          storeTimetableCache(result.data.timetable.data);
          console.log('[Dashboard] ✅ Stored timetable (valid for 30 days)');
        }
        
        // Store calendar separately (7-day cache)
        if (result.data?.calendar?.success && result.data?.calendar?.data &&
            (!hasValidCalendar || forceRefresh)) {
          console.log('[Dashboard] 💾 Storing calendar in cache...');
          storeCalendarCache(result.data.calendar.data);
          console.log('[Dashboard] ✅ Stored calendar (valid for 7 days)');
        }
      }

      // Store in browser cache
      if (result.success) {
        setStorageItem(cacheKey, JSON.stringify(result));
        setStorageItem(cachedTimestampKey, Date.now().toString());
      }

      // Only show session_expired error if all retries failed and password is confirmed unavailable
      if (!response.ok || (result.error === 'session_expired')) {
        const finalPasswordCheck = await waitForPassword(2); // Quick final check
        if (!finalPasswordCheck) {
          // Password is definitely not available - legitimate session expired
          console.error('[Dashboard] ❌ Session expired - password not available after all retries');
          setError('Your session has expired. Please re-enter your password.');
          setShowPasswordModal(true);
          setLoading(false);
          return;
        } else {
          // Password became available - retry one more time
          console.log('[Dashboard] 🔄 Password available on final check, retrying...');
          const finalResponse = await fetch('/api/data/all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh, hasLongTermCache))
          });
          const finalResult = await finalResponse.json();
          
          if (!finalResponse.ok || (finalResult.error === 'session_expired')) {
        setError('Your session has expired. Please re-enter your password.');
        setShowPasswordModal(true);
        setLoading(false);
        return;
          }
          // Success on final retry - update result and continue processing
          response = finalResponse;
          result = finalResult;
        }
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch data');
      }

      processUnifiedData(result);
      
      // Register attendance/marks fetch for smart prefetch scheduling
      if (result.success && (result.data?.attendance?.success || result.data?.marks?.success)) {
        registerAttendanceFetch();
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
    
    // Process calendar data - handle both nested structures
    const calendar = result.data.calendar?.data || result.data.calendar?.success?.data;
    if (calendar && Array.isArray(calendar)) {
      // Extract semester from multiple sources with fallbacks
      let extractedSemester: number | null = null;
      
      // 1. Try attendance data first
      if (result.data.attendance?.semester) {
        extractedSemester = result.data.attendance.semester;
        console.log('[Dashboard] Semester from attendance.semester:', extractedSemester);
      } else if (result.data.attendance?.data?.metadata?.semester) {
        extractedSemester = result.data.attendance.data.metadata.semester;
        console.log('[Dashboard] Semester from attendance.data.metadata.semester:', extractedSemester);
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
      
      const modifiedCalendarData = markSaturdaysAsHolidays(calendar as CalendarEvent[], finalSemester);
      console.log('[Dashboard] Applied holiday logic for semester:', finalSemester);
      setCalendarData(modifiedCalendarData);
      console.log('[Dashboard] ✅ Calendar data loaded:', modifiedCalendarData.length);
    } else {
      console.warn('[Dashboard] ⚠️ No calendar data found');
    }

    // Process attendance data - handle both nested structures
    const attendance = result.data.attendance?.data || result.data.attendance?.success?.data;
    if (attendance && attendance.all_subjects) {
      setAttendanceData(attendance as AttendanceData);
      console.log('[Dashboard] ✅ Attendance data loaded:', attendance.all_subjects.length);
    } else {
      console.warn('[Dashboard] ⚠️ No attendance data found', attendance);
    }

    // Process marks data - handle both nested structures
    const marks = result.data.marks?.data || result.data.marks?.success?.data;
    if (marks && marks.all_courses) {
      setMarksData(marks as MarksData);
      console.log('[Dashboard] ✅ Marks data loaded:', marks.all_courses.length);
    } else {
      console.warn('[Dashboard] ⚠️ No marks data found', marks);
    }

    // Process timetable data - handle both nested structures
    const timetable = result.data.timetable?.data || result.data.timetable?.success?.data;
    if (timetable) {
      setTimetableData(timetable);
      
      try {
        const occurrences = getSlotOccurrences(timetable);
        setSlotOccurrences(occurrences);
        console.log('[Dashboard] ✅ Timetable data loaded:', occurrences.length);
      } catch (err) {
        console.error('[Dashboard] ❌ Error processing timetable:', err);
      }
    } else {
      console.warn('[Dashboard] ⚠️ No timetable data found');
    }

    // Process day order stats using modified calendar data
    const calendarForStats = result.data.calendar?.data || result.data.calendar?.success?.data;
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
        
        const finalSemester = extractedSemester || 1;
        const modifiedCalendarForStats = markSaturdaysAsHolidays(calendarForStats as CalendarEvent[], finalSemester);
        const stats = getDayOrderStats(modifiedCalendarForStats);
        setDayOrderStats(stats);
        console.log('[Dashboard] ✅ Day order stats loaded:', stats);
      } catch (err) {
        console.error('[Dashboard] ❌ Error processing day order stats:', err);
      }
    }
  };

  const calculatePresentHours = (conducted: string, absent: string): number => {
    const conductedNum = parseInt(conducted) || 0;
    const absentNum = parseInt(absent) || 0;
    return conductedNum - absentNum;
  };

  if (loading) {
  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-6 sm:gap-7 md:gap-7 lg:gap-8 justify-center overflow-hidden">
      <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
          Loading your Dashboard<span className="inline-block w-8 sm:w-12 md:w-16 lg:w-20 text-left">{dots}</span>
        </div>
        <div className="max-w-2xl px-6">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4 text-center">
            This could take a minute or two so meanwhile here are some facts to keep you entertained:
          </div>
          <div 
            className="text-gray-300 text-sm sm:text-base md:text-lg lg:text-xl font-sora text-center italic transition-opacity duration-500 ease-in-out"
            style={{ opacity: factOpacity }}
          >
            {currentFact}
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

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8 justify-center overflow-hidden py-6 sm:py-8 md:py-9 lg:py-10">
      <PillNav
        logo=""
        logoAlt=""
        items={[
          { label: 'Attendance', href: '/attendance' },
          { label: 'Timetable', href: '/timetable' },
          { label: 'Marks', href: '/marks' },
          { label: 'Calendar', href: '/calender' }
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

      {/* Calendar Section - Show 3 days (Yesterday, Today, Tomorrow) */}
      <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Upcoming Calendar
        </div>
        <div className="flex flex-col gap-3 w-full">
          {threeDayDates.map((dayInfo) => {
            const event = calendarData.find(e => e.date === dayInfo.dateStr);
            const isToday = dayInfo.dateStr === getCurrentDateString();
            const isHoliday = event?.day_order === "-" || event?.day_order === "DO -" || event?.content.toLowerCase().includes('holiday');
            
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
        {attendanceData?.all_subjects && attendanceData.all_subjects.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {attendanceData.all_subjects.map((subject, index) => {
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
        {marksData?.all_courses && marksData.all_courses.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {marksData.all_courses
              .filter(course => course.assessments && course.assessments.length > 0)
              .filter((course, index, self) => 
                index === self.findIndex(c => 
                  c.course_code === course.course_code && c.subject_type === course.subject_type
                )
              )
              .map((course, index) => {
              const getCourseTitle = (course: MarksCourse): string => {
                return course.course_title || course.course_code;
              };

              const getTotalMarks = () => {
                if (!course.assessments || course.assessments.length === 0) return { obtained: 0, total: 0 };
                const obtained = course.assessments.reduce((sum, a) => sum + (parseFloat(a.marks_obtained) || 0), 0);
                const total = course.assessments.reduce((sum, a) => sum + (parseFloat(a.total_marks) || 0), 0);
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
