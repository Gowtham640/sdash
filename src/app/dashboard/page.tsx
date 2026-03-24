'use client';
import React, { useState, useEffect, useMemo } from "react";
import { getSlotOccurrences, getDayOrderStats, SlotOccurrence, DayOrderStats, TimetableData } from "@/lib/timetableUtils";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { RotateCw, Settings, BadgeCheck, Clock3 } from "lucide-react";
import { getRequestBodyWithPassword, clearPortalPassword } from "@/lib/passwordStorage";
import { setStorageItem, getStorageItem, removeStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import { useErrorTracking } from "@/lib/useErrorTracking";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { SkeletonLoader } from "@/components/ui/loading";
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import { normalizeAttendanceData, normalizeMarksData } from "@/lib/dataTransformers";
import PwaInstallPrompt from '@/components/PwaInstallPrompt';
import { useRouter } from "next/navigation";
import type { AttendanceData, MarksData } from "@/lib/apiTypes";
import { trackPostRequest } from "@/lib/postAnalytics";
import GlassCard from "@/components/sdash/GlassCard";
import StatChip from "@/components/sdash/StatChip";
import SwipeableCards from "@/components/sdash/SwipeableCards";
import PillNav from "@/components/sdash/PillNav";

const DASHBOARD_CACHE_STORAGE_KEY = 'sdash_dashboard_unified_cache';

type DashboardTimetableState = {
  timetable?: Record<string, { do_name?: string; time_slots?: Record<string, unknown> }>;
  slot_mapping?: Record<string, string>;
} | null;

interface DashboardStoragePayload {
  attendanceData?: AttendanceData | null;
  marksData?: MarksData | null;
  timetableData?: DashboardTimetableState;
  slotOccurrences?: SlotOccurrence[];
}

function loadDashboardStorageSnapshot(): DashboardStoragePayload | null {
  const serialized = getStorageItem(DASHBOARD_CACHE_STORAGE_KEY);
  if (!serialized) {
    return null;
  }

  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      attendanceData: parsed.attendanceData ?? null,
      marksData: parsed.marksData ?? null,
      timetableData: parsed.timetableData ?? null,
      slotOccurrences: Array.isArray(parsed.slotOccurrences) ? parsed.slotOccurrences : [],
    };
  } catch (error) {
    console.warn('[Dashboard] Failed to parse stored dashboard snapshot:', error);
    return null;
  }
}

function persistDashboardStorageSnapshot(payload: DashboardStoragePayload): void {
  try {
    setStorageItem(DASHBOARD_CACHE_STORAGE_KEY, JSON.stringify(payload));
    console.log('[Dashboard] ✅ Persisted dashboard cache to storage');
  } catch (error) {
    console.error('[Dashboard] ❌ Failed to persist dashboard cache to storage:', error);
  }
}

interface DashboardCacheSnapshot {
  attendanceData: AttendanceData | null;
  marksData: MarksData | null;
  timetableData: DashboardTimetableState;
  slotOccurrences: SlotOccurrence[];
  hasCache: boolean;
}

function getInitialDashboardCacheSnapshot(): DashboardCacheSnapshot {
  const storedSnapshot = loadDashboardStorageSnapshot();
  if (storedSnapshot) {
    const { attendanceData, marksData, timetableData, slotOccurrences } = storedSnapshot;
    return {
      attendanceData: attendanceData ?? null,
      marksData: marksData ?? null,
      timetableData: timetableData ?? null,
      slotOccurrences: slotOccurrences ?? [],
      hasCache: Boolean(
        attendanceData ||
        marksData ||
        (timetableData && (Object.keys(timetableData.timetable || {}).length || Object.keys(timetableData.slot_mapping || {}).length))
      ),
    };
  }

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
  room?: string;
}

type CachePayloadType = 'attendance' | 'marks' | 'timetable';

export default function Dashboard() {
  // SSR + first client paint must match: do not read storage until mount (see mount effect)
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [marksData, setMarksData] = useState<MarksData | null>(null);
  const [timetableData, setTimetableData] = useState<DashboardTimetableState>(null);
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>([]);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const router = useRouter();

  // Track errors
  useErrorTracking(error, '/dashboard');
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const [mounted, setMounted] = useState(false);
  const [liveTime, setLiveTime] = useState<string>("--:--");
  const [todayParts, setTodayParts] = useState<{ day: string; month: string; date: string }>({
    day: "",
    month: "",
    date: "",
  });
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);

  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      const time = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(d);

      const day = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(d);
      const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(d);
      const date = new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(d);

      setLiveTime(time);
      setTodayParts({ day, month, date });
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    };

    setMounted(true);
    updateTime();
    const id = setInterval(updateTime, 15_000);
    return () => clearInterval(id);
  }, []);

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

  const normalizeDayOrderValue = (value?: string | null) => {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
  };

  const isHolidayDayOrder = (dayOrder?: string | null) => {
    const normalized = normalizeDayOrderValue(dayOrder);
    if (!normalized) {
      return false;
    }
    return normalized === '-' || normalized.toLowerCase().includes('holiday');
  };

  // Get current day's day order
  const getCurrentDayOrder = () => {
    if (!calendarData || !Array.isArray(calendarData) || calendarData.length === 0) {
      return null;
    }
    const currentDate = getCurrentDateString();
    const currentEvent = calendarData.find(event => event && event.date === currentDate);
    return normalizeDayOrderValue(currentEvent?.day_order);
  };

  // Get current day's day order number
  const getCurrentDayOrderNumber = () => {
    const dayOrder = getCurrentDayOrder();
    if (!dayOrder || isHolidayDayOrder(dayOrder)) {
      return null;
    }

    const match = dayOrder.match(/\d+/);
    if (!match) {
      return null;
    }

    const parsed = parseInt(match[0], 10);
    return Number.isNaN(parsed) || parsed < 1 || parsed > 5 ? null : parsed;
  };

  // Get today's timetable based on day order
  const getTodaysTimetable = () => {
    console.log('[Dashboard] 🔍 getTodaysTimetable called');

    const currentDayOrder = getCurrentDayOrder();
    if (isHolidayDayOrder(currentDayOrder)) {
      console.log('[Dashboard] ℹ️ Today is marked as holiday - skipping timetable rendering');
      return [];
    }

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
      const typedSlot = slot as {
        slot_code?: string;
        slot_type?: string;
        room?: string;
        roomNo?: string;
        room_number?: string;
      };
      if (typedSlot?.slot_code) {
        // Find course title from slot mapping
        const slotCode = typedSlot.slot_code;
        const slotMapping = timetableData?.slot_mapping || {};
        const courseTitle = slotMapping[slotCode] || '';

        const roomValue = (typedSlot.room || typedSlot.roomNo || typedSlot.room_number || '').toString().trim();
        timeSlots.push({
          time,
          course_title: courseTitle,
          category: typedSlot.slot_type || '',
          room: roomValue || undefined
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
    const snap = getInitialDashboardCacheSnapshot();
    setAttendanceData(snap.attendanceData);
    setMarksData(snap.marksData);
    setTimetableData(snap.timetableData);
    setSlotOccurrences(snap.slotOccurrences);
    setLoading(!snap.hasCache);
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

      let access_token = getStorageItem('access_token');

      if (!access_token) {
        console.warn('[Dashboard] Access token missing. Attempting recovery via /api/auth/refresh...');
        try {
          const refreshResponse = await fetch('/api/auth/refresh', { method: 'POST' });
          if (refreshResponse.ok) {
            const refreshPayload = await refreshResponse.json();
            if (refreshPayload?.access_token) {
              setStorageItem('access_token', refreshPayload.access_token);
              access_token = refreshPayload.access_token;
            }
            if (refreshPayload?.refresh_token) {
              setStorageItem('refresh_token', refreshPayload.refresh_token);
            }
          }
        } catch (refreshError) {
          console.error('[Dashboard] Token recovery via refresh failed:', refreshError);
        }
      }

      if (!access_token) {
        console.error('[Dashboard] No access token found after recovery attempt');
        setError('Please sign in to view dashboard');
        setLoading(false);
        router.push('/auth');
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

    let occurrencesForStorage = slotOccurrences;

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
        occurrencesForStorage = occurrences;
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
    const storedAttendance = normalizedAttendance ?? attendanceData;
    const storedMarks = normalizedMarks ?? marksData;
    const storedTimetable = timetableDataObj ?? timetableData;
    persistDashboardStorageSnapshot({
      attendanceData: storedAttendance,
      marksData: storedMarks,
      timetableData: storedTimetable,
      slotOccurrences: occurrencesForStorage ?? [],
    });
    console.log('[Dashboard] 💾 Saved to client-side cache (1 hour TTL) - calendar excluded (always fresh)');
  };

  const renderDashboardSkeleton = () => (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col gap-6 px-4 pt-6">
      <div className="flex items-center gap-3">
        <SkeletonLoader className="h-9 w-9 rounded-lg" />
        <SkeletonLoader className="h-6 flex-1 rounded-lg max-w-[140px]" />
      </div>
      <SkeletonLoader className="h-8 w-2/3 rounded-lg" />
      <div className="flex gap-3 overflow-x-auto">
        <SkeletonLoader className="h-10 w-28 shrink-0 rounded-full" />
        <SkeletonLoader className="h-10 w-28 shrink-0 rounded-full" />
        <SkeletonLoader className="h-10 w-28 shrink-0 rounded-full" />
      </div>
      <SkeletonLoader className="h-40 w-full rounded-[20px]" />
      <SkeletonLoader className="h-48 w-full rounded-[20px]" />
    </div>
  );

  if (loading) {
    return renderDashboardSkeleton();
  }

  const isSessionError = error ? /(session|sign in)/i.test(error) : false;

  if (error) {
    if (!isSessionError) {
      return renderDashboardSkeleton();
    }

    return (
      <div className="min-h-screen bg-sdash-bg flex flex-col items-center justify-center gap-6 px-6">
        <p className="text-sdash-danger text-center font-sora text-sm">{error}</p>
        {isSessionError && (
          <Link
            href="/auth"
            onClick={handleReAuthenticate}
            className="bg-sdash-accent text-sdash-text-primary font-sora font-medium text-sm rounded-full px-8 py-3 touch-target"
          >
            Sign in again
          </Link>
        )}
      </div>
    );
  }

  const threeDayDates = getThreeDayDates();
  const todaysTimetable = getTodaysTimetable();
  const currentDayOrder = getCurrentDayOrder();
  const isHolidayToday = isHolidayDayOrder(currentDayOrder);

  const parseSlotRangeToMinutes = (timeRange: string): { start: number; end: number } | null => {
    const parts = timeRange.split("-");
    if (parts.length !== 2) return null;

    const parsePart = (s: string): number | null => {
      const [hh, mm] = s.split(":").map((x) => Number(x));
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;

      // Match getTodaysTimetable sorting: times 01:xx-07:xx represent PM in the dataset.
      const hours = hh < 8 && hh !== 0 ? hh + 12 : hh;
      return hours * 60 + mm;
    };

    const start = parsePart(parts[0].trim());
    const end = parsePart(parts[1].trim());
    if (start == null || end == null) return null;
    return { start, end };
  };

  const isClassesFinishedToday = (() => {
    if (!mounted || nowMinutes == null || todaysTimetable.length === 0) return false;
    const slotRanges = todaysTimetable
      .map((slot) => parseSlotRangeToMinutes(slot.time))
      .filter((range): range is { start: number; end: number } => range != null);
    if (slotRanges.length === 0) return false;
    const lastEnd = Math.max(...slotRanges.map((r) => r.end));
    return nowMinutes >= lastEnd;
  })();

  const visibleTodaysTimetableSlots = (() => {
    if (!todaysTimetable.length) return [];
    if (isClassesFinishedToday) return [];
    if (!mounted || nowMinutes == null) {
      return todaysTimetable.slice(0, 2).map((slot, i) => ({
        slot,
        status: i === 0 ? "current" : "upcoming",
      }));
    }

    const idxCurrent = todaysTimetable.findIndex((slot) => {
      const range = parseSlotRangeToMinutes(slot.time);
      if (!range) return false;
      return nowMinutes >= range.start && nowMinutes < range.end;
    });

    const idx =
      idxCurrent !== -1
        ? idxCurrent
        : todaysTimetable.findIndex((slot) => {
            const range = parseSlotRangeToMinutes(slot.time);
            if (!range) return false;
            return nowMinutes < range.start;
          });

    const safeIdx = idx !== -1 ? idx : Math.max(0, todaysTimetable.length - 2);

    const first = todaysTimetable[safeIdx];
    const second = todaysTimetable[safeIdx + 1] ?? null;
    const items = second ? [first, second] : first ? [first] : [];
    return items.map((slot, i) => ({
      slot,
      status: i === 0 ? "current" : "upcoming",
    }));
  })();

  const attendanceSubjects = attendanceData?.all_subjects?.filter(Boolean) ?? [];
  const normalizeSubjectTitle = (value: string | undefined | null): string =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const todaysTimetableSubjectKeys = new Set(
    todaysTimetable
      .map((slot) => normalizeSubjectTitle(slot.course_title))
      .filter((key) => key.length > 0)
  );

  const todaysAttendanceSubjects = attendanceSubjects.filter((subject) =>
    todaysTimetableSubjectKeys.has(normalizeSubjectTitle(subject?.course_title))
  );

  const sortedAttendanceSubjects = [...todaysAttendanceSubjects].sort((a, b) => {
    const aPct = Math.round(parseFloat(String(a?.attendance_percentage || "0").replace("%", "")) || 0);
    const bPct = Math.round(parseFloat(String(b?.attendance_percentage || "0").replace("%", "")) || 0);
    const aCritical = aPct < 75;
    const bCritical = bPct < 75;

    if (aCritical === bCritical) return 0;
    return aCritical ? -1 : 1;
  });
  const avgAttendance =
    attendanceSubjects.length > 0
      ? Math.round(
          attendanceSubjects.reduce((s, a) => {
            const p = parseFloat(String(a?.attendance_percentage || "0").replace("%", ""));
            return s + (Number.isFinite(p) ? p : 0);
          }, 0) / attendanceSubjects.length
        )
      : 0;

  const marksCoursesForAvg = (marksData?.all_courses || []).filter(
    (c) => c && c.assessments && c.assessments.length > 0
  );
  let marksAvgPct = 0;
  if (marksCoursesForAvg.length > 0) {
    let sum = 0;
    marksCoursesForAvg.forEach((course) => {
      const obtained = course!.assessments!.reduce(
        (acc, x) => acc + (parseFloat(String(x.marks_obtained)) || 0),
        0
      );
      const total = course!.assessments!.reduce(
        (acc, x) => acc + (parseFloat(String(x.total_marks)) || 0),
        0
      );
      sum += total > 0 ? (obtained / total) * 100 : 0;
    });
    marksAvgPct = Math.round(sum / marksCoursesForAvg.length);
  }

  const handleHeaderRefresh = () => {
    setIsRefreshing(true);
    void fetchUnifiedData(true).finally(() => setIsRefreshing(false));
  };

  const renderMarksAssessmentRows = (
    assessments: Array<{ assessment_name?: string; marks_obtained?: string | number; total_marks?: string | number }>
  ): React.ReactNode => {
    if (!assessments.length) {
      return <div className="text-xs text-sdash-text-muted font-sora">No exam components yet.</div>;
    }

    const rows: Array<typeof assessments> = [];
    for (let i = 0; i < assessments.length; i += 3) {
      rows.push(assessments.slice(i, i + 3));
    }

    return (
      <div className="flex flex-col gap-2">
        {rows.map((row, rowIndex) => (
          <div key={`dashboard-marks-row-${rowIndex}`} className="grid grid-cols-3 gap-2">
            {row.map((assessment, colIndex) => (
              <div
                key={`${assessment.assessment_name || 'exam'}-${rowIndex}-${colIndex}`}
                className="bg-sdash-surface-1 border border-white/[0.07] rounded-[8px] px-3 py-2 min-w-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-sdash-text-muted font-sora truncate">
                    {assessment.assessment_name || `Exam ${colIndex + 1}`}
                  </p>
                  <p className="stat-number text-[12px] text-sdash-text-primary whitespace-nowrap">
                    {assessment.marks_obtained ?? "—"}/{assessment.total_marks ?? "—"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  console.log('[Dashboard] 🎯 Rendering dashboard with timetable info:', {
    currentDayOrder,
    todaysTimetableLength: todaysTimetable.length,
    timetableDataExists: !!timetableData,
    timetableDataKeys: timetableData ? Object.keys(timetableData) : 'no timetable data'
  });

  return (
    <div className="min-h-screen bg-sdash-bg pb-28">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-sdash-bg/80 border-b border-white/[0.06] px-4 py-3 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0 overflow-hidden">
            <Image
              src="/sdashTransparentLogo.png"
              alt="SDash logo"
              width={28}
              height={28}
              className="w-7 h-7 object-contain"
              priority
            />
          </div>
          <span className="font-sora font-bold text-lg text-sdash-text-primary truncate">SDash</span>
        </div>
        <button
          type="button"
          onClick={handleHeaderRefresh}
          aria-label="Refresh dashboard"
          className="touch-target text-sdash-text-secondary shrink-0"
        >
          <RotateCw size={18} className={isRefreshing ? "animate-spin-slow" : ""} />
        </button>
        {isAdmin && (
          <Link
            href="/admin"
            aria-label="Admin"
            className="touch-target text-sdash-text-secondary shrink-0"
          >
            <Settings size={18} />
          </Link>
        )}
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="shrink-0 rounded-full border border-white/[0.1] px-3 py-1.5 text-xs font-sora font-semibold text-sdash-danger hover:bg-sdash-danger/10 disabled:opacity-50"
        >
          {isLoggingOut ? "…" : "Log out"}
        </button>
      </header>

      <main className="px-4 pt-2 space-y-2">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-start justify-between gap-4"
        >
          <div>
            <h1 className="font-sora font-semibold text-[25px] text-sdash-text-primary tracking-[-0.02em]">
              {todayParts.day ? <span className="text-sdash-text-primary">{todayParts.day}, </span> : "—"}
              {todayParts.month ? <span className="text-sdash-text-primary">{todayParts.month}</span> : "—"}{" "}
              {todayParts.date ? <span className="text-sdash-text-primary">{todayParts.date}</span> : ""}
            </h1>
          </div>
          <div className="text-right">
            <p className="font-sora font-semibold text-[25px] text-sdash-text-primary tabular-nums">
              {mounted ? liveTime : "--:--"}
            </p>
          </div>
        </motion.div>

        <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-2">
          <StatChip>
            <span className="w-2 h-2 rounded-full bg-sdash-accent shrink-0" />
            <span className="stat-number text-[13px] text-sdash-text-primary">{avgAttendance || "—"}%</span>
            <span className="text-[13px] text-sdash-text-secondary whitespace-nowrap">Attendance</span>
          </StatChip>
          <StatChip>
            <span className="stat-number text-[13px] text-sdash-text-primary truncate max-w-[100px]">
              {"0"+currentDayOrder || "—"}
            </span>
            <span className="text-[13px] text-sdash-text-secondary whitespace-nowrap">Day Order</span>
          </StatChip>
        </div>

        <section>
          <div className="flex items-center justify-between gap-4 mb-3">
            <p className="section-label mb-0 !text-white !text-[15px]">TODAY&apos;S SCHEDULE</p>
            <Link href="/timetable" className="text-sdash-accent text-[13px] font-sora font-medium">
              View full schedule
            </Link>
          </div>
          {todaysTimetable.length > 0 ? (
            <div className="space-y-2">
              {isClassesFinishedToday ? (
                <GlassCard className="p-4 border border-dashed border-white/20 !rounded-[12px]">
                  <p className="text-sm text-sdash-text-secondary font-sora text-center">Today&apos;s classes finished</p>
                </GlassCard>
              ) : (
                visibleTodaysTimetableSlots.map(({ slot, status }, i) => {
                  const range = parseSlotRangeToMinutes(slot.time);
                  let remainingPct = 100;
                  if (mounted && nowMinutes != null && range && range.end > range.start) {
                    const now = nowMinutes;
                    const remainingFraction =
                      now <= range.start
                        ? 1
                        : now >= range.end
                          ? 0
                          : (range.end - now) / (range.end - range.start);
                    remainingPct = Math.max(0, Math.min(1, remainingFraction)) * 100;
                  }

                  return (
                    <GlassCard
                      key={`${slot.time}-${i}`}
                      subjectCategory={slot.category}
                      className={`p-4 ${i === 0 ? "!bg-sdash-accent-subtle !border-sdash-accent/20" : ""}`}
                    >
                      {/* Same as timetable: green bar depletes from bottom as the slot progresses */}
                      <div className="pointer-events-none absolute left-0 top-0 bottom-0 z-[1] w-[3px]">
                        <div
                          className="absolute bottom-0 left-0 w-[3px] rounded-r-full bg-sdash-success transition-[height] duration-500 ease-linear"
                          style={{ height: `${remainingPct}%` }}
                        />
                      </div>
                      <div className="absolute top-3 right-3 z-[2]">
                        {status === "current" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sdash-success/15 border border-sdash-success/35 px-2 py-1 text-[10px] font-sora font-medium text-sdash-success">
                            <BadgeCheck size={12} />
                            Current
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 border border-blue-500/30 px-2 py-1 text-[10px] font-sora font-medium text-blue-500">
                            <Clock3 size={12} />
                            Upcoming
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-sora font-semibold text-[15px] text-sdash-text-primary">
                          {slot.course_title || "No class"}
                        </p>
                        <p className="font-geist-mono text-[13px] text-sdash-text-secondary mt-0.5">{slot.time}</p>
                        <p className="caption mt-1">
                          {slot.category}
                          {slot.room ? ` · ${slot.room}` : ""}
                        </p>
                      </div>
                    </GlassCard>
                  );
                })
              )}
            </div>
          ) : (
            <GlassCard className="p-4">
              <p className="text-sm text-sdash-text-secondary font-sora">
                {isHolidayToday
                  ? "Today is marked as a holiday."
                  : currentDayOrder
                    ? "No classes today."
                    : "Unable to determine day order."}
              </p>
            </GlassCard>
          )}
        </section>

        <section>
          <p className="section-label mb-3 pt-2 !text-white !text-[15px]">ATTENDANCE</p>
          {sortedAttendanceSubjects.length > 0 ? (
            <SwipeableCards>
              {sortedAttendanceSubjects.map((subject) => {
                if (!subject?.attendance_percentage) return null;
                const pctRaw = parseFloat(String(subject.attendance_percentage).replace("%", ""));
                const pct = Math.round(Number.isFinite(pctRaw) ? pctRaw : 0);
                const conducted = parseInt(String(subject.hours_conducted), 10) || 0;
                const absent = parseInt(String(subject.hours_absent), 10) || 0;
                const present = Math.max(0, conducted - absent);
                const hasSafeAttendance = pct >= 75;
                const marginClasses = Math.max(0, Math.floor((present / 0.75) - conducted));
                const requiredClasses = Math.max(0, Math.ceil(((0.75 * conducted) - present) / 0.25));
                return (
                  <GlassCard
                    key={`${subject.subject_code}-${subject.category}`}
                    subjectCategory={subject.category}
                    className="p-3"
                  >
                    <p className="font-sora font-semibold text-lg text-sdash-text-primary">{subject.course_title}</p>
                    <p className="text-md text-sdash-text-secondary mt-1">{subject.faculty_name}</p>
                    <p
                      className={`font-geist-mono font-bold text-[56px] tabular-nums leading-none mt-4 ${
                        pct >= 75 ? "text-sdash-success" : "text-sdash-danger"
                      }`}
                    >
                      {pct}%
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-full bg-sdash-surface-1 border border-white/[0.08] px-1 py-1">
                        <span
                          className="inline-flex items-center rounded-full bg-sdash-surface-2 border border-white/[0.08] overflow-hidden"
                          title="Present | Absent"
                        >
                          <span className="stat-number text-md text-sdash-text-primary !text-green-500 px-2 py-0.5">{present}</span>
                          <span className="w-px h-5 bg-white/[0.14]" />
                          <span className="stat-number text-md text-sdash-text-primary !text-red-500 px-2 py-0.5">{absent}</span>
                        </span>
                        <span className="stat-number text-md text-sdash-text-primary mr-2" title="Conducted">
                          {conducted}
                        </span>
                      </div>
                      <p className="text-lg font-sora text-sdash-text-primary shrink-0">
                        {hasSafeAttendance ? "Margin: " : "Required: "}
                        <span className={hasSafeAttendance ? "text-green-500 text-2xl" : "text-red-500 text-2xl"} >
                          {hasSafeAttendance ? marginClasses : requiredClasses}
                        </span>
                      </p>
                    </div>
                  </GlassCard>
                );
              })}
            </SwipeableCards>
          ) : (
            <GlassCard className="p-4">
              <p className="text-sm text-sdash-text-secondary font-sora">No attendance cards for today.</p>
            </GlassCard>
          )}
        </section>

        <section>
          <p className="section-label mb-3 !text-white !text-[15px]">MARKS</p>
          {marksData?.all_courses && marksData.all_courses.length > 0 ? (
            <SwipeableCards>
              {marksData.all_courses
                .filter((course) => course && course.assessments?.length)
                .filter(
                  (course, index, self) =>
                    course &&
                    index ===
                      self.findIndex(
                        (c) =>
                          c &&
                          c.course_code === course.course_code &&
                          c.subject_type === course.subject_type
                      )
                )
                .map((course, courseIndex) => {
                  if (!course) return null;
                  const obtained = course.assessments.reduce(
                    (s, a) => s + (parseFloat(String(a.marks_obtained)) || 0),
                    0
                  );
                  const total = course.assessments.reduce(
                    (s, a) => s + (parseFloat(String(a.total_marks)) || 0),
                    0
                  );
                  const pct = total > 0 ? Math.round((obtained / total) * 100) : 0;
                  return (
                    <GlassCard
                      key={`${course.course_code}-${course.subject_type}-${courseIndex}`}
                      subjectCategory={course.subject_type}
                      className="p-3"
                    >
                      <p className="font-sora font-semibold text-lg text-sdash-text-primary">
                        {course.course_title || course.course_code}
                      </p>
                      <p className="text-md text-sdash-text-secondary mt-1">
                        {course.course_code} · {course.subject_type}
                      </p>
                      <div className="flex items-baseline gap-1 mt-4">
                        <span className="display-stat text-sdash-text-primary">{obtained.toFixed(1)}</span>
                        <span className="font-geist-mono text-2xl text-sdash-text-secondary">/{total.toFixed(1)}</span>
                      </div>
                      <div className="mt-4">
                        {renderMarksAssessmentRows(course.assessments)}
                      </div>
                      <p className="text-xs font-sora text-sdash-text-secondary mt-1">Overall: {pct}%</p>
                    </GlassCard>
                  );
                })}
            </SwipeableCards>
          ) : (
            <GlassCard className="p-4">
              <p className="text-sm text-sdash-text-secondary font-sora">No marks data yet.</p>
            </GlassCard>
          )}
        </section>

        <p className="text-center text-[11px] text-sdash-text-muted font-sora pb-4">
          SDash · Gowtham & Anas
        </p>
      </main>

      <PillNav />
      <PwaInstallPrompt />

      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4">
          <GlassCard className="p-6 max-w-md w-full">
            <h2 className="heading-1 text-sdash-text-primary mb-3">Session expired</h2>
            <p className="text-sm text-sdash-text-secondary mb-6">Please sign in again to continue.</p>
            <Link
              href="/auth"
              onClick={handleReAuthenticate}
              className="block w-full text-center bg-sdash-accent text-sdash-text-primary font-sora font-medium text-sm rounded-full py-3 touch-target"
            >
              Sign in
            </Link>
          </GlassCard>
        </div>
      )}
    </div>
  );
}
