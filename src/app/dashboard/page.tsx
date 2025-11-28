'use client';
import React, { useState, useEffect } from "react";
import { getSlotOccurrences, getDayOrderStats, SlotOccurrence, DayOrderStats, TimetableData } from "@/lib/timetableUtils";
import Link from "next/link";
import PillNav from '../../components/PillNav';
import StaggeredMenu from '../../components/StaggeredMenu';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { setStorageItem, getStorageItem, removeStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import NavigationButton from "@/components/NavigationButton";
import { useErrorTracking } from "@/lib/useErrorTracking";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { SkeletonLoader } from "@/components/ui/loading";

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [hasCache, setHasCache] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [expandedButton, setExpandedButton] = useState<'marks' | 'attendance' | null>(null);

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

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Debug: Log state changes
  useEffect(() => {
    console.log('[Dashboard] 📊 State update:');
    console.log('[Dashboard]   - calendarData length:', Array.isArray(calendarData) ? calendarData.length : 'not array');
    console.log('[Dashboard]   - attendanceData:', attendanceData ? `has ${attendanceData.all_subjects?.length || 0} subjects` : 'null');
    console.log('[Dashboard]   - marksData:', marksData ? `has ${marksData.all_courses?.length || 0} courses` : 'null');
    console.log('[Dashboard]   - timetableData:', timetableData ? 'exists' : 'null');
    console.log('[Dashboard]   - loading:', loading);
    console.log('[Dashboard]   - error:', error);
  }, [calendarData, attendanceData, marksData, timetableData, loading, error]);

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

      if (!forceRefresh) {
        cachedAttendance = getClientCache<AttendanceData>('attendance');
        cachedMarks = getClientCache<MarksData>('marks');
        cachedTimetable = getClientCache('timetable');

        // Update cache status for skeleton display
        const hasAnyCache = !!(cachedAttendance || cachedMarks || cachedTimetable);
        setHasCache(hasAnyCache);

        // Use cached data immediately (stale-while-revalidate)
        // Only use cached attendance if it has actual data
        if (cachedAttendance) {
          const hasSubjects = cachedAttendance.all_subjects && Array.isArray(cachedAttendance.all_subjects) && cachedAttendance.all_subjects.length > 0;
          if (hasSubjects) {
            console.log('[Dashboard] ✅ Using client-side cache for attendance');
            setAttendanceData(cachedAttendance);
          } else {
            console.log('[Dashboard] ⚠️ Cached attendance has no subjects, will fetch fresh');
            cachedAttendance = null; // Force fetch
          }
        }
        // Only use cached marks if it has actual data
        if (cachedMarks) {
          const hasCourses = cachedMarks.all_courses && Array.isArray(cachedMarks.all_courses) && cachedMarks.all_courses.length > 0;
          if (hasCourses) {
            console.log('[Dashboard] ✅ Using client-side cache for marks');
            setMarksData(cachedMarks);
          } else {
            console.log('[Dashboard] ⚠️ Cached marks has no courses, will fetch fresh');
            cachedMarks = null; // Force fetch
          }
        }
        if (cachedTimetable) {
          console.log('[Dashboard] ✅ Using client-side cache for timetable');
          // Handle cached timetable structure: {data: {timetable: {...}, time_slots: [...], ...}, type: 'timetable', ...}
          let timetableDataToUse: typeof timetableData | null = null;

          if (typeof cachedTimetable === 'object' && cachedTimetable !== null) {
            // Check if cached data has 'data' property (wrapped API response format)
            if ('data' in cachedTimetable && typeof (cachedTimetable as { data?: unknown }).data === 'object' && (cachedTimetable as { data?: unknown }).data !== null) {
              const cachedData = (cachedTimetable as { data?: typeof timetableData }).data;
              if (cachedData && ('timetable' in cachedData || 'time_slots' in cachedData || 'slot_mapping' in cachedData)) {
                timetableDataToUse = cachedData;
                console.log('[Dashboard] ✅ Extracted timetable from wrapped format (data property)');
              }
            }
            // Check if cached data is already in direct format (has timetable property at root)
            else if ('timetable' in cachedTimetable || 'time_slots' in cachedTimetable || 'slot_mapping' in cachedTimetable) {
              timetableDataToUse = cachedTimetable as typeof timetableData;
              console.log('[Dashboard] ✅ Using timetable in direct format');
            }
            // Try to extract from nested structures
            else {
              // Log the structure for debugging
              console.log('[Dashboard] 🔍 Cached timetable structure:', Object.keys(cachedTimetable));
              console.log('[Dashboard] 🔍 Cached timetable sample:', JSON.stringify(cachedTimetable).substring(0, 500));
            }
          }

          if (timetableDataToUse) {
            // Verify timetable has actual data
            const hasTimetableData = timetableDataToUse.timetable && Object.keys(timetableDataToUse.timetable).length > 0;
            if (hasTimetableData) {
              setTimetableData(timetableDataToUse);
              // Also set slot occurrences for day order stats
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
              console.warn('[Dashboard] ⚠️ Cached timetable has no data, will fetch fresh');
              cachedTimetable = null; // Force fetch
            }
          } else {
            console.warn('[Dashboard] ⚠️ Cached timetable has unexpected structure, will fetch fresh');
            cachedTimetable = null; // Force fetch
          }
        }
      } else {
        // Force refresh: clear client caches
        removeClientCache('attendance');
        removeClientCache('marks');
        removeClientCache('timetable');
        removeClientCache('unified');
        console.log('[Dashboard] 🗑️ Cleared client caches for force refresh');
      }

      // Determine what needs to be fetched
      const needAttendance = !cachedAttendance || forceRefresh;
      const needMarks = !cachedMarks || forceRefresh;
      const needTimetable = !cachedTimetable || forceRefresh;
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

      if (missingCount > 0 || forceRefresh) {
        // Fetch from API with automatic retry on password-related session_expired
        let apiStartTime = Date.now();
        const fetchType = forceRefresh ? '(force refresh all)' : '(fetching all data)';

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
        // All cached, but still need calendar - fetch only calendar
        // Also check if cached data is actually valid (has items)
        const needsRefresh =
          (cachedAttendance && (!cachedAttendance.all_subjects || cachedAttendance.all_subjects.length === 0)) ||
          (cachedMarks && (!cachedMarks.all_courses || cachedMarks.all_courses.length === 0)) ||
          (cachedTimetable && (!cachedTimetable || typeof cachedTimetable !== 'object'));

        if (needsRefresh) {
          console.log('[Dashboard] ⚠️ Cached data is empty/invalid, fetching all data...');
          // Fetch all data to refresh empty caches
          const requestKey = `fetch_unified_all_${access_token.substring(0, 10)}`;
          const apiResult = await deduplicateRequest(requestKey, async () => {
            const response = await fetch('/api/data/all', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(getRequestBodyWithPassword(access_token, true)) // Force refresh
            });
            const result = await response.json();
            if (result.success) {
              processUnifiedData(result);
            }
            return { response, result };
          });
          result = apiResult.result;
        } else {
          console.log('[Dashboard] ✅ All data cached, fetching only calendar...');
          const requestKey = `fetch_calendar_${access_token.substring(0, 10)}`;
          const calendarResult = await deduplicateRequest(requestKey, async () => {
            const response = await fetch('/api/data/all', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(getRequestBodyWithPassword(access_token, false, ['calendar']))
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
      // Direct array format
      calendarEvents = result.data.calendar;
      console.log('[Dashboard] ✅ Calendar data is direct array format');
      console.log('[Dashboard]   - Total events:', calendarEvents.length);
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
        console.log('[Dashboard] 📋   - Last event:', JSON.stringify(calendarEvents[calendarEvents.length - 1], null, 2).substring(0, 200));
        console.log('[Dashboard] 📋   - Sample dates range:', calendarEvents[0]?.date, 'to', calendarEvents[calendarEvents.length - 1]?.date);

        // Check if current date is in range
        const currentDate = getCurrentDateString();
        const hasCurrentDate = calendarEvents.some(e => e && e.date === currentDate);
        console.log('[Dashboard] 📋   - Current date:', currentDate);
        console.log('[Dashboard] 📋   - Current date in calendar:', hasCurrentDate ? 'YES' : 'NO');
        if (!hasCurrentDate) {
          // Find closest dates
          const today = new Date();
          const todayStr = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`;
          const nearbyDates = calendarEvents
            .filter(e => e && e.date)
            .map(e => ({ date: e.date, event: e }))
            .sort((a, b) => {
              // Simple string comparison for dates in DD/MM/YYYY format
              return a.date.localeCompare(b.date);
            })
            .slice(0, 5);
          console.log('[Dashboard] 📋   - Nearby dates in calendar:', nearbyDates.map(d => d.date));
        }
      }
      // Display calendar data as-is without holiday modifications
      setCalendarData(calendarEvents);
      console.log('[Dashboard] ✅ ✅ ✅ Calendar data loaded and set:', calendarEvents.length, 'events');
    } else {
      console.warn('[Dashboard] ⚠️ No calendar data found');
      console.warn('[Dashboard] Calendar data type:', typeof result.data.calendar);
      console.warn('[Dashboard] Calendar data is array:', Array.isArray(result.data.calendar));
      if (result.data.calendar) {
        console.warn('[Dashboard] Calendar data value:', JSON.stringify(result.data.calendar).substring(0, 500));
      }
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
      console.log('[Dashboard] ✅ Attendance data loaded:', attendanceDataObj.all_subjects?.length || 0, 'subjects');
      if (attendanceDataObj.all_subjects && attendanceDataObj.all_subjects.length > 0) {
        console.log('[Dashboard]   - First subject:', JSON.stringify(attendanceDataObj.all_subjects[0], null, 2).substring(0, 300));
      }
    } else if (result.data.attendance !== undefined && result.data.attendance !== null) {
      // Only overwrite if attendance was explicitly provided in result (not undefined/null)
      // This prevents overwriting cached data when only calendar is fetched
      console.warn('[Dashboard] ⚠️ No attendance data found in processed result');
      console.warn('[Dashboard] Attendance data type:', typeof result.data.attendance);
      console.warn('[Dashboard] Attendance data value:', JSON.stringify(result.data.attendance).substring(0, 500));

      // Try to extract data directly if structure is unexpected
      if (typeof result.data.attendance === 'object') {
        const rawAttendance = result.data.attendance as Record<string, unknown>;
        if ('all_subjects' in rawAttendance && Array.isArray(rawAttendance.all_subjects)) {
          console.log('[Dashboard] 🔄 Found all_subjects in unexpected location, extracting...');
          setAttendanceData({ all_subjects: rawAttendance.all_subjects as AttendanceSubject[] });
          console.log('[Dashboard] ✅ Attendance data extracted from unexpected structure');
        } else {
          setAttendanceData(null);
        }
      } else {
        setAttendanceData(null);
      }
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
      console.log('[Dashboard] ✅ Marks data loaded:', marksDataObj.all_courses?.length || 0, 'courses');
      if (marksDataObj.all_courses && marksDataObj.all_courses.length > 0) {
        console.log('[Dashboard]   - First course:', JSON.stringify(marksDataObj.all_courses[0], null, 2).substring(0, 300));
      }
    } else if (result.data.marks !== undefined && result.data.marks !== null) {
      // Only overwrite if marks was explicitly provided in result (not undefined/null)
      // This prevents overwriting cached data when only calendar is fetched
      console.warn('[Dashboard] ⚠️ No marks data found in processed result');
      console.warn('[Dashboard] Marks data type:', typeof result.data.marks);
      console.warn('[Dashboard] Marks data value:', JSON.stringify(result.data.marks).substring(0, 500));

      // Try to extract data directly if structure is unexpected
      if (typeof result.data.marks === 'object') {
        const rawMarks = result.data.marks as Record<string, unknown>;
        if ('all_courses' in rawMarks && Array.isArray(rawMarks.all_courses)) {
          console.log('[Dashboard] 🔄 Found all_courses in unexpected location, extracting...');
          setMarksData({ all_courses: rawMarks.all_courses as MarksCourse[] });
          console.log('[Dashboard] ✅ Marks data extracted from unexpected structure');
        } else {
          setMarksData(null);
        }
      } else {
        setMarksData(null);
      }
    } else {
      // result.data.marks is undefined/null - don't overwrite existing state (likely from cache)
      console.log('[Dashboard] ℹ️ Marks not in API response, keeping existing state (likely from cache)');
    }

    // Process timetable data - handle both direct format and wrapped format
    let timetableDataObj: typeof timetableData | null = null;

    if (result.data.timetable && typeof result.data.timetable === 'object') {
      // Check if it's direct format (has timetable, time_slots, metadata at root)
      if ('timetable' in result.data.timetable || 'time_slots' in result.data.timetable) {
        // Direct format
        timetableDataObj = result.data.timetable as typeof timetableData;
        console.log('[Dashboard] Timetable data is direct format');
      }
      // Check if it's wrapped format: {success: true, data: {...}}
      else if ('success' in result.data.timetable && 'data' in result.data.timetable) {
        const timetableWrapper = result.data.timetable as { success?: boolean | { data?: unknown }; data?: unknown };
        const successValue = timetableWrapper.success;
        const isSuccess = typeof successValue === 'boolean' ? successValue : successValue !== undefined;
        if (isSuccess && timetableWrapper.data && typeof timetableWrapper.data === 'object' && timetableWrapper.data !== null) {
          const wrappedData = timetableWrapper.data as Record<string, unknown>;
          if (wrappedData && ('timetable' in wrappedData || 'time_slots' in wrappedData)) {
            timetableDataObj = wrappedData as typeof timetableData;
            console.log('[Dashboard] Timetable data is wrapped format');
          }
        }
      }
      // Check legacy nested format: {data: {...}}
      else if ('data' in result.data.timetable) {
        const legacyData = (result.data.timetable as { data?: unknown }).data;
        if (legacyData && typeof legacyData === 'object' && legacyData !== null && ('timetable' in legacyData || 'time_slots' in legacyData)) {
          timetableDataObj = legacyData as typeof timetableData;
          console.log('[Dashboard] Timetable data is legacy nested format');
        }
      }
    }

    if (timetableDataObj) {
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

        // Use calendar data as-is without holiday modifications
        const stats = getDayOrderStats(calendarForStats as CalendarEvent[]);
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

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (loading && !showSkeleton) {
    // Show minimal loading state for first 2 seconds if no cache
    return (
      <div className="relative bg-black min-h-screen flex items-center justify-center">
        <div className="text-white text-xl font-sora">Loading...</div>
      </div>
    );
  }

  if (loading && showSkeleton) {
    // Show skeleton UI after 2s delay or immediately if cache exists
    return (
      <div className="relative bg-black min-h-screen flex overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-64 bg-white/5 backdrop-blur-md border-r border-white/10 flex flex-col p-6">
          {/* Logo Section */}
          <div className="mb-8">
            <h1 className="text-white text-2xl font-sora font-bold">SDash</h1>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 space-y-2">
            <div className="block px-4 py-3 text-white/70 rounded-lg font-sora text-sm">TimeTable</div>
            <div className="block px-4 py-3 text-white/70 rounded-lg font-sora text-sm">Attendance</div>
            <div className="block px-4 py-3 text-white/70 rounded-lg font-sora text-sm">Marks</div>
            <div className="block px-4 py-3 text-white/70 rounded-lg font-sora text-sm">Calendar</div>
          </nav>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-8 flex flex-col">
          <SkeletonLoader className="w-64 h-16 mb-2" />
          <SkeletonLoader className="w-96 h-8 mb-8" />
          <SkeletonLoader className="w-full h-32 mb-8 rounded-2xl" />
          <div className="flex gap-4 items-end mt-auto">
            <div className="w-[65%] grid grid-cols-2 gap-4 items-end transition-all duration-500 ease-in-out">
              <SkeletonLoader className="h-56 rounded-2xl" />
              <SkeletonLoader className="h-56 rounded-2xl" />
              <SkeletonLoader className="h-56 rounded-2xl" />
              <SkeletonLoader className="h-56 rounded-2xl" />
            </div>
            <div className="flex-1 flex flex-col gap-4 h-[29rem] transition-all duration-500 ease-in-out">
              <SkeletonLoader className="flex-1 rounded-2xl" />
              <SkeletonLoader className="flex-1 rounded-2xl" />
              <SkeletonLoader className="flex-1 rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative bg-black min-h-screen flex items-center justify-center flex-col gap-6">
        <div className="text-red-400 text-xl font-sora text-center px-4">{error}</div>
        {error.includes('session') && (
          <NavigationButton
            path="/auth"
            onClick={handleReAuthenticate}
            className="px-6 py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
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
    <div className="relative bg-black min-h-screen flex overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-64 bg-white/5 backdrop-blur-md border-r border-white/10 flex flex-col p-6">
        {/* Logo Section */}
        <div className="mb-8 ml-3.5  mt-3">
          <h1 className="text-white text-5xl font-sora font-bold">SDash</h1>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-2">
          <Link
            href="/timetable"
            className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
          >
            TimeTable
          </Link>
          <Link
            href="/attendance"
            className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
          >
            Attendance
          </Link>
          <Link
            href="/marks"
            className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
          >
            Marks
          </Link>
          <Link
            href="/calender"
            className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
          >
            Calendar
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
            >
              Admin
            </Link>
          )}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 flex flex-col">
        {/* Clock, Date, Day Section */}
        <div className="mb-8">
          <div className="text-white text-5xl font-sora font-bold mb-2">
            {formatTime(currentTime)}
          </div>
          <div className="text-white/70 text-lg font-sora">
            {formatDate(currentTime)}
          </div>
        </div>

        {/* Day Order Timetable Section - Placeholder */}
        <div className="mb-8 p-6 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl">
          <div className="text-white text-xl font-sora font-bold mb-4">
            Today&apos;s Schedule {currentDayOrder && `- ${currentDayOrder}`}
          </div>
          <div className="text-white/50 text-sm font-sora">
            {/* Placeholder for day order timetable */}
            Day order timetable will be displayed here
          </div>
        </div>

        {/* Button Layout - 2x2 Grid + 3 Side Buttons */}
        <div className="flex gap-4 items-end mt-auto">
          {/* Left Side - 2x2 Grid */}
          <div className="w-[65%] grid grid-cols-2 gap-4 items-end transition-all duration-500 ease-in-out">
            {/* Marks Button */}
            <div
              onClick={(e) => {
                if (expandedButton !== 'marks') {
                  e.preventDefault();
                  setExpandedButton('marks');
                }
              }}
              className={`relative bg-gradient-to-br from-purple-600/20 to-pink-600/20 backdrop-blur-md border border-white/10 rounded-2xl p-8 hover:scale-[1.02] transition-all duration-500 ease-in-out flex flex-col justify-end items-center group cursor-pointer ${
                expandedButton === 'marks'
                  ? 'col-span-2 row-span-2 h-[29rem] self-end'
                  : expandedButton
                    ? 'opacity-0 scale-50 h-0 overflow-hidden'
                    : 'h-56 opacity-100 scale-100'
              }`}
            >
              {/* Four-way arrow icon */}
              {expandedButton === 'marks' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedButton(null);
                  }}
                  className="absolute top-4 right-4 text-white/70 hover:text-white hover:scale-110 transition-all duration-200 z-10"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </button>
              )}
              {!expandedButton && (
                <div
                  className="absolute top-4 right-4 text-white/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </div>
              )}
              <div className="text-white text-3xl font-sora font-bold mb-2 group-hover:scale-110 transition-transform">
                Marks
              </div>
              <div className="text-white/70 text-sm font-sora text-center">
                View your academic performance
              </div>
            </div>

            {/* Attendance Button */}
            <div
              onClick={(e) => {
                if (expandedButton !== 'attendance') {
                  e.preventDefault();
                  setExpandedButton('attendance');
                }
              }}
              className={`relative bg-gradient-to-br from-blue-600/20 to-cyan-600/20 backdrop-blur-md border border-white/10 rounded-2xl p-8 hover:scale-[1.02] transition-all duration-500 ease-in-out flex flex-col justify-end items-center group cursor-pointer ${
                expandedButton === 'attendance'
                  ? 'col-span-2 row-span-2 h-[29rem] self-end'
                  : expandedButton
                    ? 'opacity-0 scale-50 h-0 overflow-hidden'
                    : 'h-56 opacity-100 scale-100'
              }`}
            >
              {/* Four-way arrow icon */}
              {expandedButton === 'attendance' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedButton(null);
                  }}
                  className="absolute top-4 right-4 text-white/70 hover:text-white hover:scale-110 transition-all duration-200 z-10"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </button>
              )}
              {!expandedButton && (
                <div
                  className="absolute top-4 right-4 text-white/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </div>
              )}
              <div className="text-white text-3xl font-sora font-bold mb-2 group-hover:scale-110 transition-transform">
                Attendance
              </div>
              <div className="text-white/70 text-sm font-sora text-center">
                Check attendance
              </div>
            </div>

            {/* TimeTable Button */}
            <Link
              href="/timetable"
              className={`bg-gradient-to-br from-green-600/20 to-emerald-600/20 backdrop-blur-md border border-white/10 rounded-2xl p-8 hover:scale-[1.02] transition-all duration-500 ease-in-out flex flex-col justify-end items-center group ${
                expandedButton
                  ? 'opacity-0 scale-50 h-0 overflow-hidden pointer-events-none'
                  : 'h-56 opacity-100 scale-100'
              }`}
            >
              <div className="text-white text-3xl font-sora font-bold mb-2 group-hover:scale-110 transition-transform">
                TimeTable
              </div>
              <div className="text-white/70 text-sm font-sora text-center">
                View schedule
              </div>
            </Link>

            {/* Calendar Button */}
            <Link
              href="/calender"
              className={`bg-gradient-to-br from-orange-600/20 to-red-600/20 backdrop-blur-md border border-white/10 rounded-2xl p-8 hover:scale-[1.02] transition-all duration-500 ease-in-out flex flex-col justify-end items-center group ${
                expandedButton
                  ? 'opacity-0 scale-50 h-0 overflow-hidden pointer-events-none'
                  : 'h-56 opacity-100 scale-100'
              }`}
            >
              <div className="text-white text-3xl font-sora font-bold mb-2 group-hover:scale-110 transition-transform">
                Calendar
              </div>
              <div className="text-white/70 text-sm font-sora text-center">
                View calendar
              </div>
            </Link>
          </div>

          {/* Right Side - 3 Extra Buttons */}
          <div className="flex-1 flex flex-col gap-4 h-[29rem] transition-all duration-500 ease-in-out">
            {/* Meal Chart Button */}
            <Link
              href="/mealchart"
              className="flex-1 bg-gradient-to-br from-yellow-600/20 to-amber-600/20 backdrop-blur-md border border-white/10 rounded-2xl p-6 hover:scale-[1.02] transition-transform duration-300 flex flex-col justify-end items-center group"
            >
              <div className="text-white text-xl font-sora font-bold mb-1 group-hover:scale-110 transition-transform">
                Meal Chart
              </div>
            </Link>

            {/* Faculty Button */}
            <Link
              href="/faculty"
              className="flex-1 bg-gradient-to-br from-indigo-600/20 to-violet-600/20 backdrop-blur-md border border-white/10 rounded-2xl p-6 hover:scale-[1.02] transition-transform duration-300 flex flex-col justify-end items-center group"
            >
              <div className="text-white text-xl font-sora font-bold mb-1 group-hover:scale-110 transition-transform">
                Faculty
              </div>
            </Link>

            {/* Grade Calc Button */}
            <Link
              href="/gradecalc"
              className="flex-1 bg-gradient-to-br from-rose-600/20 to-red-600/20 backdrop-blur-md border border-white/10 rounded-2xl p-6 hover:scale-[1.02] transition-transform duration-300 flex flex-col justify-end items-center group"
            >
              <div className="text-white text-xl font-sora font-bold mb-1 group-hover:scale-110 transition-transform">
                Grade Calc
              </div>
            </Link>
          </div>
        </div>
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
