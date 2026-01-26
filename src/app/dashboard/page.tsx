'use client';
import React, { useState, useEffect, useMemo } from "react";
import { getSlotOccurrences, getDayOrderStats, SlotOccurrence, DayOrderStats, TimetableData } from "@/lib/timetableUtils";
import Link from "next/link";
import PillNav from '../../components/PillNav';
import StaggeredMenu from '../../components/StaggeredMenu';
import { getRequestBodyWithPassword, clearPortalPassword } from "@/lib/passwordStorage";
import { setStorageItem, getStorageItem, removeStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import NavigationButton from "@/components/NavigationButton";
import { useErrorTracking } from "@/lib/useErrorTracking";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { SkeletonLoader } from "@/components/ui/loading";
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import { normalizeAttendanceData, normalizeMarksData } from "@/lib/dataTransformers";
import { Calendar, BookOpen, BarChart3, Calculator, User, Settings, Github, Linkedin } from 'lucide-react';
import ShinyText from '@/components/ShinyText';
import PwaInstallPrompt from '@/components/PwaInstallPrompt';
import { useRouter } from "next/navigation";
import type { AttendanceData, AttendanceSubject, MarksData, MarksCourse } from "@/lib/apiTypes";
import Particles from "@/components/Particles";
import { trackPostRequest } from "@/lib/postAnalytics";

interface DashboardCacheSnapshot {
  attendanceData: AttendanceData | null;
  marksData: MarksData | null;
  timetableData: {
    timetable?: TimetableData['timetable'];
    slot_mapping?: TimetableData['slot_mapping'];
  } | null;
  slotOccurrences: SlotOccurrence[];
  hasCache: boolean;
}

function getInitialDashboardCacheSnapshot(): DashboardCacheSnapshot {
  const attendanceData = getClientCache<AttendanceData>('attendance');
  const marksData = getClientCache<MarksData>('marks');
  const timetableCache = getClientCache<TimetableData>('timetable');
  let timetableData = null;
  let slotOccurrences: SlotOccurrence[] = [];

  if (timetableCache) {
    timetableData = {
      timetable: timetableCache.timetable,
      slot_mapping: timetableCache.slot_mapping,
    };
    const timetableForUtils: TimetableData = {
      metadata: timetableCache.metadata ?? {
        generated_at: '',
        source: '',
        academic_year: '',
        format: ''
      },
      time_slots: timetableCache.time_slots ?? [],
      slot_mapping: timetableCache.slot_mapping ?? {},
      timetable: timetableCache.timetable ?? {},
    };
    try {
      slotOccurrences = getSlotOccurrences(timetableForUtils);
    } catch (error) {
      console.error('[Dashboard] ⚠️ Failed to derive slot occurrences from cached timetable:', error);
    }
  }

  return {
    attendanceData: attendanceData ?? null,
    marksData: marksData ?? null,
    timetableData,
    slotOccurrences,
    hasCache: Boolean(
      attendanceData ||
      marksData ||
      (timetableCache && (Object.keys(timetableCache.timetable || {}).length || Object.keys(timetableCache.slot_mapping || {}).length))
    ),
  };
}

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

interface TimeSlot {
  time: string;
  course_title: string;
  category: string;
}

type CachePayloadType = 'attendance' | 'marks' | 'timetable';

export default function Dashboard() {
  const initialCacheSnapshot = useMemo(() => getInitialDashboardCacheSnapshot(), []);
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(initialCacheSnapshot.attendanceData);
  const [marksData, setMarksData] = useState<MarksData | null>(initialCacheSnapshot.marksData);
  const [timetableData, setTimetableData] = useState<{
    timetable?: Record<string, { do_name?: string; time_slots?: Record<string, unknown> }>;
    slot_mapping?: Record<string, string>;
  } | null>(initialCacheSnapshot.timetableData);
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>(initialCacheSnapshot.slotOccurrences);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [loading, setLoading] = useState(!initialCacheSnapshot.hasCache);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const router = useRouter();

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

  const ensureSupabaseData = async ({
    access_token,
    password,
  }: {
    access_token: string;
    password?: string;
  }) => {
    const dataTypes: CachePayloadType[] = ['attendance', 'marks', 'timetable'];
    for (const dataType of dataTypes) {
      try {
        const cacheResponse = await trackPostRequest('/api/data/cache', {
          action: 'cache_fetch',
          dataType,
          primary: false,
          payload: { access_token, data_type: dataType },
          omitPayloadKeys: ['access_token'],
        });
        const cacheResult = await cacheResponse.json();

        const needsRefresh =
          !cacheResult.success ||
          cacheResult.data == null ||
          cacheResult.isExpired === true;

        if (!needsRefresh) {
          continue;
        }

        if (!password) {
          console.warn(`[Dashboard] ⚠️ Cannot refresh ${dataType} without password`);
          continue;
        }

        const refreshResponse = await trackPostRequest('/api/data/refresh', {
          action: 'data_refresh',
          dataType,
          payload: { access_token, data_type: dataType, password },
          omitPayloadKeys: ['password', 'access_token'],
        });
        const refreshResult = await refreshResponse.json();

        if (refreshResult.success) {
          console.log(`[Dashboard] ✅ Refreshed ${dataType} via backend`);
        } else {
          console.warn(`[Dashboard] ⚠️ Refresh for ${dataType} failed:`, refreshResult.error);
        }
      } catch (error) {
        console.error(`[Dashboard] ❌ Error ensuring ${dataType} cache:`, error);
      }
    }
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

    const doNumber = getCurrentDayOrderNumber();
    if (doNumber == null) {
      console.log('[Dashboard] ℹ️ Day order unavailable or non-working day, skipping timetable');
      return [];
    }

    if (!timetableData?.timetable) {
      console.log('[Dashboard] ❌ getTodaysTimetable returning empty - missing timetable data');
      return [];
    }

    const key = `DO ${doNumber}`;
    console.log('[Dashboard] 📊 Timetable data lookup key:', key);
    const timetableForToday = timetableData.timetable[key];

    if (!timetableForToday?.time_slots) {
      console.log('[Dashboard] ❌ getTodaysTimetable returning empty - no time_slots for', key);
      return [];
    }

    // Convert to array of {time, course_title, category}
    const timeSlots: TimeSlot[] = [];
    if (!timetableForToday.time_slots || typeof timetableForToday.time_slots !== 'object') {
      return timeSlots;
    }
    Object.entries(timetableForToday.time_slots).forEach(([time, slot]: [string, unknown]) => {
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

      const response = await trackPostRequest('/api/admin/check', {
        action: 'admin_access_check',
        dataType: 'user',
        payload: { access_token },
        omitPayloadKeys: ['access_token'],
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

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await trackPostRequest('/api/auth/logout', {
        action: 'logout',
        dataType: 'user',
      });
    } catch (err) {
      console.error('[Dashboard] Logout failed:', err);
    } finally {
      clearPortalPassword();
      removeStorageItem('access_token');
      removeStorageItem('refresh_token');
      removeStorageItem('user');
      removeStorageItem('user_semester');
      setIsLoggingOut(false);
      router.push('/auth');
    }
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
      const cacheAvailable =
        !!getClientCache<AttendanceData>('attendance') ||
        !!getClientCache<MarksData>('marks') ||
        !!getClientCache<TimetableData>('timetable');
      setLoading(forceRefresh || !cacheAvailable);
      setError(null);

      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Dashboard] No access token found');
        setError('Please sign in to view dashboard');
        setLoading(false);
        return;
      }

      removeClientCache('calendar');
      console.log('[Dashboard] 🗑️ Removed any existing calendar cache (calendar is always fresh)');

      const hasTimetableCache = !!getClientCache('timetable');
      console.log(`[Dashboard] 📋 Timetable cache status: ${hasTimetableCache ? 'available' : 'missing'}`);

      const unifiedCache = getClientCache('unified');
      if (unifiedCache && typeof unifiedCache === 'object' && 'data' in unifiedCache) {
        const unifiedData = unifiedCache as { data?: { calendar?: unknown } };
        if (unifiedData.data?.calendar) {
          console.log('[Dashboard] 🗑️ Found calendar in unified cache, removing it');
          if (unifiedData.data) {
            delete unifiedData.data.calendar;
            setClientCache('unified', unifiedCache);
            console.log('[Dashboard] ✅ Cleaned calendar from unified cache');
          }
        }
      }

      const dataToFetch = ['calendar', 'timetable', 'attendance', 'marks'];
      const requestBody = getRequestBodyWithPassword(access_token, forceRefresh, dataToFetch);

      const ensurePromise = !forceRefresh
        ? ensureSupabaseData({
          access_token,
          password: requestBody.password,
        }).catch(error => {
          console.error('[Dashboard] ❌ Error ensuring Supabase data:', error);
        })
        : Promise.resolve();

      const missingCount = 3;
      const needsBackgroundRefresh = false;

      console.log('[Dashboard] 📊 Cache status: checking user_cache entries for attendance/marks/timetable');

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

            finalResponse = await trackPostRequest('/api/data/all', {
              action: 'data_unified_fetch',
              dataType: 'user',
              payload: requestBody,
              omitPayloadKeys: ['password', 'access_token'],
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
              const retryResponse = await trackPostRequest('/api/data/all', {
                action: 'data_unified_fetch',
                dataType: 'user',
                payload: requestBody,
                omitPayloadKeys: ['password', 'access_token'],
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

      await ensurePromise;

    } catch (err) {
      console.error('[Dashboard] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  function processUnifiedData(result: {
    data: {
      calendar?: { data?: Array<unknown>; success?: { data?: Array<unknown> } } | null;
      attendance?: { data?: { all_subjects: unknown[]; metadata?: { semester?: number } }; success?: { data?: { all_subjects: unknown[]; metadata?: { semester?: number } } }; semester?: number } | null;
      marks?: { data?: { all_courses: unknown[] }; success?: { data?: { all_courses: unknown[] } } } | null;
      timetable?: { data?: unknown; success?: { data?: unknown } } | null;
    };
    metadata?: { semester?: number;[key: string]: unknown };
    semester?: number;
  }) {
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
    const normalizedAttendance = normalizeAttendanceData(result.data.attendance);
    if (normalizedAttendance) {
      setAttendanceData(normalizedAttendance);
      console.log('[Dashboard] ✅ Attendance data normalized and loaded:', normalizedAttendance.all_subjects?.length || 0);
    } else if (result.data.attendance !== undefined && result.data.attendance !== null) {
      console.warn('[Dashboard] ⚠️ No attendance data found after normalization');
      setAttendanceData(null);
    } else {
      console.log('[Dashboard] ℹ️ Attendance not in API response, keeping existing state (likely from cache)');
    }

    // Process marks data - handle both direct format and wrapped format
    const normalizedMarks = normalizeMarksData(result.data.marks);
    if (normalizedMarks) {
      setMarksData(normalizedMarks);
      console.log('[Dashboard] ✅ Marks data normalized and loaded:', normalizedMarks.all_courses?.length || 0);
    } else if (result.data.marks !== undefined && result.data.marks !== null) {
      console.warn('[Dashboard] ⚠️ No marks data found after normalization');
      setMarksData(null);
    } else {
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
        attendance: attendanceData,
        marks: marksData,
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

  const renderDashboardSkeleton = () => {
    const threeDayDates = getThreeDayDates();

    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8 justify-center overflow-hidden py-6 sm:py-8 md:py-9 lg:py-10">

        <div className="mt-10 sm:mt-12 md:mt-14 lg:mt-16 mb-6 sm:mb-7 md:mb-8 lg:mb-8 flex flex-col items-center gap-4">
          <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
            Welcome to your Dashboard
          </div>
        </div>
        <div className="space-y-6">
          <SkeletonLoader className="w-[90vw] h-8 rounded-full" />
          <SkeletonLoader className="w-[90vw] h-16 rounded-2xl" />
          <SkeletonLoader className="w-[90vw] h-16 rounded-2xl" />
          <SkeletonLoader className="w-[90vw] h-16 rounded-2xl" />
        </div>
      </div>
    );
  };

  if (loading) {
    return renderDashboardSkeleton();
  }

  const isSessionError = error ? /(session|sign in)/i.test(error) : false;

  if (error) {
    if (!isSessionError) {
      return renderDashboardSkeleton();
    }

    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-6 sm:gap-7 md:gap-7 lg:gap-8 justify-center overflow-hidden">
        <div className="text-red-400 text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center px-4">{error}</div>
        {isSessionError && (
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
      <div className="fixed inset-0 z-10 pointer-events-none">
        <Particles
          particleColors={["#ffffff"]}
          particleCount={500}
          particleSpread={20}
          speed={0.1}
          particleBaseSize={200}
          moveParticlesOnHover
          alphaParticles={false}
          disableRotation={false}
          pixelRatio={window.devicePixelRatio || 1}
        />
      </div>
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
      <button
        onClick={handleLogout}
        disabled={isLoggingOut}
        className="absolute top-5 right-5 z-[1005] px-3 py-1.5 rounded-full bg-red-600/95 hover:bg-red-500 border border-white/20 text-white font-sora text-xs sm:text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoggingOut ? "Signing out..." : "Log Out"}
      </button>


      {/* Expandable Sidebar - Only visible on medium and larger screens */}
      <div className="hidden md:block">
        {/* Sidebar Toggle Button */}
        <button
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          className={`fixed top-14 left-4 z-[1001] bg-white/10 backdrop-blur border border-white/20 rounded-full p-2 transition-all duration-300 hover:bg-white/20 ${sidebarExpanded ? 'left-64' : 'left-4'
            }`}
          aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg
            className={`w-5 h-5 text-white transition-transform duration-300 ${sidebarExpanded ? 'rotate-180' : 'rotate-0'
              }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Sidebar */}
        <div
          className={`fixed left-0 top-0 h-full z-[1000] transition-all duration-300 ease-in-out ${sidebarExpanded ? 'w-64' : 'w-16'
            }`}
        >
          {/* Glass Background - only visible when expanded */}
          <div
            className={`absolute inset-0 backdrop-blur bg-black/80 border-r border-white/20 transition-opacity duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0'
              }`}
          />

          {/* Sidebar Content */}
          <div className="relative h-full flex flex-col">
            {/* Header - only visible when expanded */}
            <div
              className={`p-6 border-b border-white/10 transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0'
                }`}
            >
              <h2 className="text-xl font-sora font-bold text-white">Navigation</h2>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 p-4 space-y-4">
              {/* Attendance */}
              <div className="relative group">
                <Link
                  href="/attendance"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-blue-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "Attendance"}
                >
                  <User className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    Attendance
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute font-sora left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    Attendance
                  </div>
                )}
              </div>

              {/* Timetable */}
              <div className="relative group">
                <Link
                  href="/timetable"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-blue-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "Timetable"}
                >
                  <BookOpen className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    Timetable
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute font-sora left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    Timetable
                  </div>
                )}
              </div>

              {/* Marks */}
              <div className="relative group">
                <Link
                  href="/marks"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-blue-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "Marks"}
                >
                  <BarChart3 className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    Marks
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute font-sora left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    Marks
                  </div>
                )}
              </div>

              {/* Calendar */}
              <div className="relative group">
                <Link
                  href="/calender"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-blue-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "Calendar"}
                >
                  <Calendar className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    Calendar
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute font-sora left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    Calendar
                  </div>
                )}
              </div>

              {/* SGPA Calculator */}
              <div className="relative group">
                <Link
                  href="/sgpa-calculator"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-green-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "SGPA Calculator"}
                >
                  <Calculator className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    SGPA Calculator
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute left-full ml-2 px-2 py-1 font-sora bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    SGPA Calculator
                  </div>
                )}
              </div>

              {/* Admin - only show if admin */}
              {isAdmin && (
                <div className="relative group">
                  <Link
                    href="/admin"
                    className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-red-300 hover:text-red-200 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                    title={sidebarExpanded ? "" : "Admin"}
                  >
                    <Settings className="w-6 h-6 flex-shrink-0" />
                    <span
                      className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                        }`}
                    >
                      Admin
                    </span>
                  </Link>
                  {!sidebarExpanded && (
                    <div className="absolute left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                      Admin
                    </div>
                  )}
                </div>
              )}
            </nav>
          </div>
        </div>
      </div>


      <div className={`mt-10 sm:mt-12 md:mt-14 lg:mt-16 mb-6 sm:mb-7 md:mb-8 lg:mb-8 flex flex-col items-center gap-4 transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
        <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
          Welcome to your Dashboard
        </div>
      </div>

      {/* Calendar Section - Show 3 days (Yesterday, Today, Tomorrow) */}
      <div className={`relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
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
      <div className={`relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
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
      <div className={`relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
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
      <div className={`relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
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

      {/* Attribution & Links */}
      <div className="relative z-[200] flex flex-col items-center gap-2 py-6 text-white">
        <span className="text-white/60 md:text-sm lg:text-base text-[10px] uppercase font-sora tracking-[0.3em]">Made by</span>
        <div className="grid grid-cols-3 mt-2 text-sm font-sora font-semibold">
          {/* Gowtham */}
          <div className="flex flex-col items-center gap-2">
            <ShinyText text="Gowtham " speed={2} className="text-white lg:text-xl" disabled={false} />
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/Gowtham640"
                target="_blank"
                rel="noreferrer"
                className="text-white/80 hover:text-white"
              >
                <Github className="h-5 w-5" />
              </a>
              <a
                href="https://www.linkedin.com/in/gowtham-ramakrishna-rayapureddi-aaa60532a/"
                target="_blank"
                rel="noreferrer"
                className="text-white/80 hover:text-white"
              >
                <Linkedin className="h-5 w-5" />
              </a>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ShinyText text="&" speed={2} className="text-white " disabled={false} />
          </div>
          {/* Anas */}
          <div className="flex flex-col items-center gap-2">
            <ShinyText text="Anas" speed={2} className="text-white lg:text-xl" disabled={false} />
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/SyedMohammadAnas"
                target="_blank"
                rel="noreferrer"
                className="text-white/80 hover:text-white"
              >
                <Github className="h-5 w-5" />
              </a>
              <a
                href="https://www.linkedin.com/in/syed-mohammad-anas-a6a8642b7/"
                target="_blank"
                rel="noreferrer"
                className="text-white/80 hover:text-white"
              >
                <Linkedin className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
        <span className="text-white/60 md:text-sm lg:text-base text-[10px] uppercase font-sora tracking-[0.3em]">With hope that this will help you</span>

      </div>
      <PwaInstallPrompt />
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
