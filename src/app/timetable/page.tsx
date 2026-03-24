'use client';
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from 'next/link';
import {
  getSlotOccurrences,
  getDayOrderStats,
  getCurrentDateString,
  normalizeCalendarDayOrder,
  type SlotOccurrence,
  type DayOrderStats,
  type TimetableDayOrder,
} from "@/lib/timetableUtils";
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import { useErrorTracking } from "@/lib/useErrorTracking";
import type html2canvas from 'html2canvas';
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import TopAppBar from "@/components/sdash/TopAppBar";
import PillNav from "@/components/sdash/PillNav";
import GlassCard from "@/components/sdash/GlassCard";
import StatChip from "@/components/sdash/StatChip";
import { trackPostRequest } from "@/lib/postAnalytics";

interface TimeSlotCell {
  course: string;
  courseType?: string;
  online?: boolean;
}

interface TimeSlot {
  time: string;
  do1: string | TimeSlotCell;
  do2: string | TimeSlotCell;
  do3: string | TimeSlotCell;
  do4: string | TimeSlotCell;
  do5: string | TimeSlotCell;
}

interface TimetableData {
  metadata: {
    generated_at: string;
    source: string;
    academic_year: string;
    format: string;
  };
  time_slots: string[];
  slot_mapping: { [key: string]: string };
  timetable: {
    [doName: string]: {
      do_name: string;
      time_slots: {
        [timeSlot: string]: {
          slot_code: string;
          course_title: string;
          slot_type: string;
          is_alternate: boolean;
        };
      };
    };
  };
}

interface CalendarEvent {
  date: string;
  day_name: string;
  content: string;
  day_order: string;
  month?: string;
  month_name?: string;
  year?: number;
}

const normalizeCalendarDate = (dateStr: string): string => {
  if (!dateStr) return dateStr;

  const ddMMYYYYRegex = /^\d{2}\/\d{2}\/\d{4}$/;
  if (ddMMYYYYRegex.test(dateStr)) {
    return dateStr;
  }

  // Handle "DD/Month 'YY" format, e.g. "19/Jul '25"
  const parts = dateStr.split('/');
  if (parts.length === 2) {
    const [day, monthYear] = parts;
    const [monthName, yearStr] = monthYear.split(' ');

    const monthNames: Record<string, number> = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
      Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
    };

    const monthNum = monthNames[monthName];
    if (monthNum && yearStr) {
      const shortYear = yearStr.replace("'", "");
      const fullYear = 2000 + parseInt(shortYear, 10);
      const month = monthNum.toString().padStart(2, '0');
      const dayPadded = day.padStart(2, '0');
      return `${dayPadded}/${month}/${fullYear}`;
    }
  }

  return dateStr;
};

const normalizeCalendarEvents = (events: CalendarEvent[]): CalendarEvent[] =>
  events.map((event) => ({
    ...event,
    date: normalizeCalendarDate(event.date),
  }));

const extractCalendarEvents = (input: unknown): CalendarEvent[] | null => {
  // Direct array format
  if (Array.isArray(input)) {
    const firstItem = input[0] as Record<string, unknown> | undefined;

    // New nested format: [{ month, dates: [...] }, ...]
    if (firstItem && typeof firstItem === 'object' && 'month' in firstItem && 'dates' in firstItem) {
      const flattened: CalendarEvent[] = [];
      (input as Array<Record<string, unknown>>).forEach((monthData) => {
        const month = typeof monthData.month === 'string' ? monthData.month : '';
        const dates = Array.isArray(monthData.dates) ? monthData.dates : [];
        dates.forEach((dateData) => {
          const dateRow = dateData as Record<string, unknown>;
          flattened.push({
            date: String(dateRow.date ?? ''),
            day_name: String(dateRow.day ?? ''),
            content: String(dateRow.event ?? ''),
            day_order: String(dateRow.day_order ?? ''),
            month,
            month_name: month.split(' ')[0] || undefined,
            year: undefined,
          });
        });
      });
      return flattened;
    }

    // Legacy flat format
    return input as CalendarEvent[];
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const obj = input as Record<string, unknown>;

  // Wrapped: { data: [...] }
  if (Array.isArray(obj.data)) {
    return extractCalendarEvents(obj.data);
  }

  // Wrapped: { success: true, data: [...] } or { success: { data: [...] } }
  if ('success' in obj) {
    const successValue = obj.success;
    if (successValue && typeof successValue === 'object' && Array.isArray((successValue as Record<string, unknown>).data)) {
      return extractCalendarEvents((successValue as Record<string, unknown>).data);
    }
  }

  // Unified: { calendar: ... }
  if ('calendar' in obj) {
    return extractCalendarEvents(obj.calendar);
  }

  return null;
};

/** Day order labels and row keys for grid + DO tabs */
const TIMETABLE_DAY_LABELS = ["DO 1", "DO 2", "DO 3", "DO 4", "DO 5"] as const;
const TIMETABLE_DAY_KEYS = ["do1", "do2", "do3", "do4", "do5"] as const;

const normalizeDayKey = (value: string): string => value.replace(/\s+/g, '').toLowerCase();

const findDayOrderEntry = (
  timetable: TimetableData['timetable'],
  dayName: string
): TimetableDayOrder | null => {
  const normalizedTarget = normalizeDayKey(dayName);
  const directMatch = timetable[dayName];
  if (directMatch) {
    return directMatch;
  }

  const normalizedEntry = Object.entries(timetable).find(([key]) => normalizeDayKey(key) === normalizedTarget);
  return normalizedEntry ? (normalizedEntry[1] as TimetableDayOrder) : null;
};

function convertTimetableDataToTimeSlots(data: TimetableData): TimeSlot[] {
  const timeSlots: TimeSlot[] = [];

  if (!data || !data.timetable || typeof data.timetable !== 'object') {
    console.warn('[Timetable] ⚠️ Invalid timetable data structure:', data);
    return timeSlots;
  }

  const timeSlotKeys = data.time_slots || [
    "08:00-08:50", "08:50-09:40", "09:45-10:35", "10:40-11:30", "11:35-12:25",
    "12:30-01:20", "01:25-02:15", "02:20-03:10", "03:10-04:00", "04:00-04:50"
  ];

  timeSlotKeys.forEach(timeSlot => {
    const timeSlotEntry: TimeSlot = {
      time: timeSlot,
      do1: "",
      do2: "",
      do3: "",
      do4: "",
      do5: ""
    };

    ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'].forEach((doName, index) => {
      const timetableRecord = data.timetable && typeof data.timetable === 'object' ? (data.timetable as TimetableData['timetable']) : {};
      const doData = findDayOrderEntry(timetableRecord, doName);
      if (doData && typeof doData === 'object' && doData !== null) {
        const doDataTyped = doData as { time_slots?: Record<string, { course_title?: string; courseType?: string; online?: boolean }> };
        if (doDataTyped.time_slots && doDataTyped.time_slots[timeSlot]) {
          const slotInfo = doDataTyped.time_slots[timeSlot];
          const courseTitle = slotInfo.course_title || "";
          const courseType = slotInfo.courseType;
          const online = slotInfo.online;

          const doKey = `do${index + 1}` as keyof TimeSlot;
          if (courseType || online !== undefined) {
            (timeSlotEntry as unknown as Record<string, string | TimeSlotCell>)[doKey] = {
              course: courseTitle,
              courseType: courseType,
              online: online
            };
          } else {
            timeSlotEntry[doKey] = courseTitle;
          }
        }
      }
    });

    timeSlots.push(timeSlotEntry);
  });

  return timeSlots;
}

const parseTimetableCandidate = (obj: unknown): TimetableData | null => {
  if (!obj || typeof obj !== 'object') {
    return null;
  }

  const candidate = obj as Partial<TimetableData>;
  const metadata =
    typeof candidate.metadata === 'object' && candidate.metadata !== null
      ? (candidate.metadata as TimetableData['metadata'])
      : {
        generated_at: '',
        source: '',
        academic_year: '',
        format: ''
      };
  const time_slots = Array.isArray(candidate.time_slots) ? (candidate.time_slots as string[]) : [];
  const slot_mapping =
    typeof candidate.slot_mapping === 'object' && candidate.slot_mapping !== null
      ? (candidate.slot_mapping as TimetableData['slot_mapping'])
      : {};
  const timetable =
    typeof candidate.timetable === 'object' && candidate.timetable !== null
      ? (candidate.timetable as TimetableData['timetable'])
      : {};

  return {
    metadata,
    time_slots,
    slot_mapping,
    timetable
  };
};

const resolveCachedTimetable = (value: unknown): TimetableData | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if ('data' in candidate) {
    const nested = parseTimetableCandidate(candidate.data);
    if (nested) {
      return nested;
    }
  }

  return parseTimetableCandidate(candidate);
};

interface TimetableInitialSnapshot {
  rawTimetableData: TimetableData | null;
  timetableSlots: TimeSlot[];
  slotOccurrences: SlotOccurrence[];
  calendarData: CalendarEvent[];
  dayOrderStats: DayOrderStats | null;
  hasTimetableCache: boolean;
}

const getInitialTimetableSnapshot = (): TimetableInitialSnapshot => {
  const cachedTimetable = resolveCachedTimetable(getClientCache('timetable'));
  const calendarData = getClientCache<CalendarEvent[]>('calendar') ?? [];
  const dayOrderStats = calendarData.length ? getDayOrderStats(calendarData) : null;
  const timetableSlots = cachedTimetable ? convertTimetableDataToTimeSlots(cachedTimetable) : [];
  const slotOccurrences = cachedTimetable ? getSlotOccurrences(cachedTimetable) : [];
  return {
    rawTimetableData: cachedTimetable,
    timetableSlots,
    slotOccurrences,
    calendarData,
    dayOrderStats,
    hasTimetableCache: Boolean(cachedTimetable),
  };
};

export default function TimetablePage() {
  // Important: keep the initial server/client render deterministic to avoid hydration mismatches.
  // We'll fetch/cache in effects after mount.
  const [timetableData, setTimetableData] = useState<TimeSlot[]>([]);
  const [rawTimetableData, setRawTimetableData] = useState<TimetableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track errors
  useErrorTracking(error, '/timetable');
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>([]);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [currentFact, setCurrentFact] = useState<string>("");
  const fetchUnifiedDataRef = useRef<((forceRefresh?: boolean) => Promise<void>) | null>(null);
  /** Active day order tab for compass-style slot list */
  const [activeDayOrder, setActiveDayOrder] = useState<string>("DO 1");
  const [hasUserSelectedDayOrder, setHasUserSelectedDayOrder] = useState(false);

  // For the left "day meter" depletion bar.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [mounted]);

  useEffect(() => {
    fetchUnifiedDataRef.current = fetchUnifiedData;
  });

  useEffect(() => {
    void fetchUnifiedDataRef.current?.();
  }, []);

  const todayDayOrderNumber = useMemo(() => {
    if (!mounted) return null;
    const todayKey = getCurrentDateString();
    const todayEvent = calendarData.find((e) => e.date === todayKey);
    return normalizeCalendarDayOrder(todayEvent?.day_order);
  }, [calendarData, mounted]);

  const todayDayOrderLabel = todayDayOrderNumber ? `DO ${todayDayOrderNumber}` : null;

  // Default the DO tab to today's day order (from calendar), but don't override once user clicks.
  useEffect(() => {
    if (hasUserSelectedDayOrder) return;
    if (!todayDayOrderLabel) return;
    setActiveDayOrder(todayDayOrderLabel);
  }, [todayDayOrderLabel, hasUserSelectedDayOrder]);

  // Rotate facts every 8 seconds while loading
  useEffect(() => {
    if (!mounted) return;
    if (!loading) return;

    // Set an initial fact once hydration is complete
    setCurrentFact(getRandomFact());
    const interval = setInterval(() => {
      setCurrentFact(getRandomFact());
    }, 8000);

    return () => clearInterval(interval);
  }, [loading, mounted]);

  const refreshTimetableData = async () => {
    try {
      setLoading(true);
      setError(null);
      setIsRefreshing(true);

      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Timetable] No access token found');
        setError('Please sign in to view your timetable');
        setLoading(false);
        setIsRefreshing(false);
        return;
      }

      console.log('[Timetable] 🔄 Force refreshing timetable data...');

      const response = await trackPostRequest('/api/data/refresh', {
        action: 'data_refresh',
        dataType: 'timetable',
        payload: {
          ...getRequestBodyWithPassword(access_token, false),
          data_type: 'timetable'
        },
        omitPayloadKeys: ['password', 'access_token'],
      });

      const result = await response.json();
      console.log('[Timetable] Refresh API response:', result);
      console.log('[Timetable] Refresh API response data:', result.data);
      console.log('[Timetable] Refresh API response data type:', typeof result.data);

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to refresh timetable data');
      }

      // Refresh API returns data directly from Supabase
      // Update local state with the returned data
      console.log('[Timetable] ✅ Refresh completed, updating local state...');

      // After successful refresh, re-fetch data from Supabase cache
      console.log('[Timetable] ✅ Refresh completed, now fetching fresh data from Supabase...');
      await fetchUnifiedData(false);
    } catch (err) {
      console.error('[Timetable] Error refreshing data:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh timetable data');
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const fetchCalendarFallback = async (access_token: string): Promise<boolean> => {
    try {
      const calendarResponse = await trackPostRequest('/api/data/all', {
        action: 'data_unified_fetch',
        dataType: 'calendar',
        payload: getRequestBodyWithPassword(access_token, false, ['calendar']),
        omitPayloadKeys: ['password', 'access_token'],
      });

      const calendarResult = await calendarResponse.json();
      if (!calendarResult?.success) {
        return false;
      }

      const parsedCalendar = extractCalendarEvents(calendarResult.data?.calendar ?? calendarResult.data);
      if (!parsedCalendar || parsedCalendar.length === 0) {
        return false;
      }

      const normalizedCalendar = normalizeCalendarEvents(parsedCalendar);
      setCalendarData(normalizedCalendar);
      setClientCache('calendar', normalizedCalendar);
      const stats = getDayOrderStats(normalizedCalendar);
      setDayOrderStats(stats);
      console.log('[Timetable] ✅ Calendar fallback loaded');
      return true;
    } catch (calendarErr) {
      console.error('[Timetable] ❌ Error in calendar fallback fetch:', calendarErr);
      return false;
    }
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      let hasResolvedCalendarInThisRun = false;
      const applyCalendarData = (events: CalendarEvent[], source: string): DayOrderStats => {
        const normalizedCalendar = normalizeCalendarEvents(events);
        setCalendarData(normalizedCalendar);
        setClientCache('calendar', normalizedCalendar);
        const stats = getDayOrderStats(normalizedCalendar);
        setDayOrderStats(stats);
        hasResolvedCalendarInThisRun = true;
        console.log(`[Timetable] ✅ Day order stats calculated from ${source}:`, stats);
        return stats;
      };

      const hasDisplayCache = timetableData.length > 0 || slotOccurrences.length > 0;
      const shouldShowLoading = forceRefresh || !hasDisplayCache;
      setLoading(shouldShowLoading);
      setError(null);
      if (forceRefresh) {
        setIsRefreshing(true);
      }

      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Timetable] No access token found');
        setError('Please sign in to view your timetable');
        setLoading(false);
        return;
      }

      // Check client-side cache first (unless force refresh)
      let cachedTimetable: TimetableData | null = null;
      let hasValidCache = false;
      let needsBackgroundRefresh = false;

      if (!forceRefresh) {
        const cachedTimetableRaw = getClientCache('timetable');

        // Handle cached timetable structure: {data: {timetable: {...}, time_slots: [...], ...}, type: 'timetable', ...}
        if (cachedTimetableRaw) {
          let timetableDataToUse: TimetableData | null = null;

          if (typeof cachedTimetableRaw === 'object' && cachedTimetableRaw !== null) {
            // Check if cached data has 'data' property (wrapped API response format)
            if ('data' in cachedTimetableRaw && typeof (cachedTimetableRaw as { data?: unknown }).data === 'object' && (cachedTimetableRaw as { data?: unknown }).data !== null) {
              const cachedData = (cachedTimetableRaw as { data?: TimetableData }).data;
              if (cachedData && 'timetable' in cachedData) {
                timetableDataToUse = cachedData;
                console.log('[Timetable] ✅ Using client-side cache for timetable (extracted from data property)');
              }
            }
            // Check if cached data is already in TimetableData format (has timetable property at root)
            else if ('timetable' in cachedTimetableRaw || 'time_slots' in cachedTimetableRaw) {
              timetableDataToUse = cachedTimetableRaw as TimetableData;
              console.log('[Timetable] ✅ Using client-side cache for timetable (direct format)');
            }
          }

          if (timetableDataToUse) {
            cachedTimetable = timetableDataToUse;
            hasValidCache = true;
            setRawTimetableData(timetableDataToUse);
            const convertedData = convertTimetableDataToTimeSlots(timetableDataToUse);
            setTimetableData(convertedData);

            // Calculate quick stats from cached timetable data
            const occurrences = getSlotOccurrences(timetableDataToUse);
            setSlotOccurrences(occurrences);

            // Cache the calculated occurrences in localStorage
            try {
              localStorage.setItem('sdash_slotOccurrences', JSON.stringify(occurrences));
            } catch (e) {
              console.warn('[Timetable] Failed to cache slot occurrences:', e);
            }

            // Try to load cached calendar data first so current DO can render immediately.
            try {
              const cachedCalendar = getClientCache<CalendarEvent[]>('calendar');
              if (cachedCalendar && Array.isArray(cachedCalendar)) {
                applyCalendarData(cachedCalendar, 'calendar cache');
                console.log('[Timetable] ✅ Loaded cached calendar data');
              }
            } catch (e) {
              console.warn('[Timetable] Failed to load cached calendar data:', e);
            }

            // Try to load cached day order stats from localStorage
            try {
              const cachedDayOrderStatsStr = localStorage.getItem('sdash_dayOrderStats');
              if (cachedDayOrderStatsStr) {
                const cachedDayOrderStats = JSON.parse(cachedDayOrderStatsStr);
                setDayOrderStats(cachedDayOrderStats);
                console.log('[Timetable] ✅ Loaded cached day order stats');
              }
            } catch (e) {
              console.warn('[Timetable] Failed to load cached day order stats:', e);
            }

            // Try to load cached slot occurrences from localStorage
            try {
              const cachedSlotOccurrencesStr = localStorage.getItem('sdash_slotOccurrences');
              if (cachedSlotOccurrencesStr) {
                const cachedSlotOccurrences = JSON.parse(cachedSlotOccurrencesStr);
                setSlotOccurrences(cachedSlotOccurrences);
                console.log('[Timetable] ✅ Loaded cached slot occurrences');
              }
            } catch (e) {
              console.warn('[Timetable] Failed to load cached slot occurrences:', e);
            }

            console.log('[Timetable] ✅ Quick stats calculated from cached timetable data');
          } else {
            console.warn('[Timetable] ⚠️ Cached timetable has unexpected structure, will fetch fresh data');
          }
        } else {
          // Client cache expired, fetch Supabase cache (even if expired)
          console.log('[Timetable] 🔍 Client cache expired/missing, fetching Supabase cache (even if expired)...');
          try {
            const result = await trackPostRequest('/api/data/cache', {
              action: 'cache_fetch',
              dataType: 'timetable',
              primary: false,
              payload: { access_token, data_type: 'timetable' },
              omitPayloadKeys: ['access_token'],
            });
            const cacheResult = await result.json();
            if (cacheResult.success && cacheResult.data) {
              console.log(`[Timetable] ✅ Found Supabase cache (expired: ${cacheResult.isExpired})`);
              let timetableDataToUse: TimetableData | null = null;
              const cachedData = cacheResult.data;

              if (typeof cachedData === 'object' && cachedData !== null) {
                if ('data' in cachedData && typeof (cachedData as { data?: unknown }).data === 'object' && (cachedData as { data?: unknown }).data !== null) {
                  const wrappedData = (cachedData as { data?: TimetableData }).data;
                  if (wrappedData && 'timetable' in wrappedData) {
                    timetableDataToUse = wrappedData;
                  }
                } else if ('timetable' in cachedData || 'time_slots' in cachedData) {
                  timetableDataToUse = cachedData as TimetableData;
                }
              }

              if (timetableDataToUse) {
                cachedTimetable = timetableDataToUse;
                hasValidCache = true;
                setRawTimetableData(timetableDataToUse);
                const convertedData = convertTimetableDataToTimeSlots(timetableDataToUse);
                setTimetableData(convertedData);
                if (cacheResult.isExpired) {
                  needsBackgroundRefresh = true;
                  console.log('[Timetable] ⚠️ Cache is expired, will refresh in background');
                }
              }
            }
          } catch (err) {
            console.error('[Timetable] ❌ Error fetching Supabase cache:', err);
          }
        }
      } else {
        // Force refresh: clear client cache
        removeClientCache('timetable');
        console.log('[Timetable] 🗑️ Cleared client cache for force refresh');
      }

      // Only fetch if cache is missing or force refresh or expired
      if (!hasValidCache || forceRefresh || needsBackgroundRefresh) {
        const apiStartTime = Date.now();
        const fetchType = forceRefresh ? '(force refresh)' : needsBackgroundRefresh ? '(background refresh - cache expired)' : '(fetching fresh data)';
        console.log(`[Timetable] 🚀 Fetching from API ${fetchType}`);

        // Use request deduplication - ensures only ONE page calls backend at a time
        const requestKey = `fetch_unified_all_${access_token.substring(0, 10)}`;
        const apiResult = await deduplicateRequest(requestKey, async () => {
          const response = await trackPostRequest('/api/data/all', {
            action: 'data_unified_fetch',
            dataType: 'user',
            payload: getRequestBodyWithPassword(access_token, forceRefresh),
            omitPayloadKeys: ['password', 'access_token'],
          });

          const result = await response.json();
          return { response, result };
        });

        const response = apiResult.response;
        const result = apiResult.result;
        const apiDuration = Date.now() - apiStartTime;

        console.log(`[Timetable] 📡 API response received: ${apiDuration}ms`);
        console.log(`[Timetable]   - Success: ${result.success}`);
        console.log(`[Timetable]   - Status: ${response.status}`);

        // Handle session expiry
        if (!response.ok || (result.error === 'session_expired')) {
          console.error('[Timetable] Session expired or invalid');
          setError('Your session has expired. Please re-enter your password.');
          setShowPasswordModal(true);
          setLoading(false);
          return;
        }

        if (!result.success) {
          throw new Error(result.error || 'Failed to fetch data');
        }

        // Process calendar data for day order stats (do this first, before timetable processing)
        // Handle multiple formats: direct array, {success: true, data: [...]}, or {data: [...]}
        if (result.data && typeof result.data === 'object' && 'calendar' in result.data) {
          const calendarDataFromResult = (result.data as { calendar?: unknown }).calendar;
          let calendarArray: CalendarEvent[] | null = null;

          if (Array.isArray(calendarDataFromResult)) {
            // Map JSON format to CalendarEvent interface
            calendarArray = calendarDataFromResult.map((e: any) => ({
              date: e.date,
              day_name: e.day_name,
              content: e.event ?? '',
              day_order: e.day_order,
              month: e.month,
              year: e.year
            }));
            console.log('[Timetable] ✅ Calendar data processed');
            console.log('[Timetable]   - Total events:', calendarArray?.length ?? 0);
          } else if (calendarDataFromResult && typeof calendarDataFromResult === 'object') {
            const calendarObj = calendarDataFromResult as Record<string, unknown>;
            // Handle {success: true, data: [...]} format (old API format)
            if ('success' in calendarObj && calendarObj.success && 'data' in calendarObj && Array.isArray(calendarObj.data)) {
              calendarArray = calendarObj.data as CalendarEvent[];
            }
            // Handle {data: [...]} format
            else if ('data' in calendarObj && Array.isArray(calendarObj.data)) {
              calendarArray = calendarObj.data as CalendarEvent[];
            }
            // Handle nested {success: {data: [...]}} format
            else if ('success' in calendarObj && typeof calendarObj.success === 'object' && calendarObj.success !== null) {
              const successObj = calendarObj.success as { data?: CalendarEvent[] };
              if (Array.isArray(successObj.data)) {
                calendarArray = successObj.data;
              }
            }
          }

          if (calendarArray) {
            const parsedCalendar = extractCalendarEvents(calendarArray);
            if (!parsedCalendar) {
              console.warn('[Timetable] ⚠️ Calendar array parsing failed');
            } else {
              const stats = applyCalendarData(parsedCalendar, 'API response');
              // Cache day order stats in localStorage
              try {
                localStorage.setItem('sdash_dayOrderStats', JSON.stringify(stats));
              } catch (e) {
                console.warn('[Timetable] Failed to cache day order stats:', e);
              }
            }
          } else {
            console.warn('[Timetable] ⚠️ Calendar data format not recognized');
          }
        }

        // Process timetable data from unified endpoint
        // Unified endpoint returns: { success: boolean, data: { timetable: TimetableData, ... }, error?: string }
        let timetableDataObj: TimetableData | null = null;

        console.log('[Timetable] Processing timetable data from API response');
        console.log('[Timetable] result.data type:', typeof result.data);
        console.log('[Timetable] result.data keys:', result.data ? Object.keys(result.data) : 'null/undefined');

        // Extract timetable from unified response: { data: { timetable: TimetableData, ... } }
        if (result.data && typeof result.data === 'object' && 'timetable' in result.data) {
          const timetableData = (result.data as { timetable?: unknown }).timetable;

          if (timetableData && typeof timetableData === 'object' && timetableData !== null) {
            // Check if it's the new Go backend format (has schedule array)
            const dataObj = timetableData as Record<string, unknown>;
            if ('schedule' in dataObj && Array.isArray(dataObj.schedule)) {
              console.log('[Timetable] 🔄 Detected new Go backend format (schedule array) - transforming...');
              // Transform new format to old format
              timetableDataObj = transformGoBackendTimetableToOldFormat(dataObj);
              console.log('[Timetable] ✅ Transformed Go backend timetable format');
            } else {
              // Handle wrapped format: {data: {timetable: {...}, time_slots: [...], ...}, type: 'timetable', ...}
              let dataToProcess: unknown = timetableData;

              // Check if data is wrapped in a 'data' property (API response format from cache)
              const dataToProcessObj = dataToProcess as Record<string, unknown>;
              if ('data' in dataToProcessObj && typeof dataToProcessObj.data === 'object' && dataToProcessObj.data !== null) {
                console.log('[Timetable] 🔄 Unwrapping nested data structure (extracting from data property)');
                const wrappedData = dataToProcessObj.data as TimetableData;
                if (wrappedData && 'timetable' in wrappedData) {
                  dataToProcess = wrappedData;
                }
              }
              // Check if it's already in TimetableData format (has timetable property at root)
              else if ('timetable' in dataToProcessObj || 'time_slots' in dataToProcessObj) {
                // Already in correct format
                dataToProcess = dataToProcess;
              }

              // Verify it's the expected TimetableData format
              if (dataToProcess && typeof dataToProcess === 'object' && dataToProcess !== null) {
                const dataObj2 = dataToProcess as Record<string, unknown>;
                if ('timetable' in dataObj2 || 'time_slots' in dataObj2) {
                  timetableDataObj = dataToProcess as TimetableData;
                  console.log('[Timetable] ✅ Timetable data loaded');
                } else {
                  console.warn('[Timetable] ⚠️ Timetable data doesn\'t match expected format');
                  console.warn('[Timetable] Available keys:', Object.keys(dataObj2));
                }
              } else {
                console.warn('[Timetable] ⚠️ Timetable data doesn\'t match expected format');
                console.warn('[Timetable] dataToProcess is not an object');
              }
            }
          }
        } else {
          console.warn('[Timetable] ⚠️ result.data.timetable is not available');
          console.warn('[Timetable] result.data structure:', result.data);
        }

        if (timetableDataObj && timetableDataObj.timetable) {
          console.log('[Timetable] Timetable response data:', timetableDataObj);
          console.log('[Timetable] DO 1 time_slots sample:', timetableDataObj.timetable['DO 1']?.time_slots);

          setRawTimetableData(timetableDataObj);
          const convertedData = convertTimetableDataToTimeSlots(timetableDataObj);
          console.log('[Timetable] Converted time slots:', convertedData);

          // Save to client cache
          setClientCache('timetable', timetableDataObj);

          setTimetableData(convertedData);

          const occurrences = getSlotOccurrences(timetableDataObj);
          console.log('[Timetable] Slot occurrences:', occurrences);

          setSlotOccurrences(occurrences);
          // Cache slot occurrences in localStorage
          try {
            localStorage.setItem('sdash_slotOccurrences', JSON.stringify(occurrences));
          } catch (e) {
            console.warn('[Timetable] Failed to cache slot occurrences:', e);
          }
          console.log('[Timetable] Loaded timetable with', occurrences.length, 'courses');
        } else {
          // Keep page visible even when timetable data is unavailable
          // User can use refresh button to fetch data
          console.warn('[Timetable] Timetable data unavailable - keeping page visible for refresh');
          if (result && result.data) {
            console.warn('[Timetable] Timetable data type:', typeof result.data);
            console.warn('[Timetable] Timetable data value:', result.data);
          }
          setRawTimetableData(null);
          setTimetableData([]);
          // Don't throw error, just log it so page remains visible
        }
      } else {
        // Timetable was cached, but we still need calendar data for stats
        // Try to get calendar from unified cache or fetch it
        const cachedUnified = getClientCache('unified');
        if (cachedUnified && typeof cachedUnified === 'object' && cachedUnified !== null && 'data' in cachedUnified) {
          const unifiedData = (cachedUnified as { data?: { calendar?: unknown } }).data;
          if (unifiedData && typeof unifiedData === 'object' && 'calendar' in unifiedData) {
            const calendarDataFromCache = (unifiedData as { calendar?: unknown }).calendar;
            let calendarArray: CalendarEvent[] | null = null;

            if (Array.isArray(calendarDataFromCache)) {
              calendarArray = calendarDataFromCache;
            } else if (calendarDataFromCache && typeof calendarDataFromCache === 'object') {
              const calendarObj = calendarDataFromCache as Record<string, unknown>;
              // Handle {success: true, data: [...]} format
              if ('success' in calendarObj && calendarObj.success && 'data' in calendarObj && Array.isArray(calendarObj.data)) {
                calendarArray = calendarObj.data as CalendarEvent[];
              }
              // Handle {data: [...]} format
              else if ('data' in calendarObj && Array.isArray(calendarObj.data)) {
                calendarArray = calendarObj.data as CalendarEvent[];
              }
            }

            if (calendarArray) {
              const parsedCalendar = extractCalendarEvents(calendarArray);
              if (!parsedCalendar) {
                console.warn('[Timetable] ⚠️ Calendar parsing failed from unified cache');
              } else {
                applyCalendarData(parsedCalendar, 'unified cache');
              }
            }
          }
        } else {
          // Fetch calendar data separately if not in cache
          console.log('[Timetable] 📅 Fetching calendar data for day order stats...');
          try {
            await fetchCalendarFallback(access_token);
          } catch (calendarErr) {
            console.error('[Timetable] ❌ Error fetching calendar for stats:', calendarErr);
          }
        }
      }

      // Safety net for route-navigation edge cases:
      // if calendar is still empty after main flow, fetch it once directly.
      if (!hasResolvedCalendarInThisRun) {
        await fetchCalendarFallback(access_token);
      }

    } catch (err) {
      console.error('[Timetable] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');

      // Fallback to empty timetable
      const emptyTimetable: TimeSlot[] = [
        { time: "08:00-08:50", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "08:50-09:40", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "09:45-10:35", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "10:40-11:30", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "11:35-12:25", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "12:30-01:20", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "01:25-02:15", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "02:20-03:10", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "03:10-04:00", do1: "", do2: "", do3: "", do4: "", do5: "" },
        { time: "04:00-04:50", do1: "", do2: "", do3: "", do4: "", do5: "" },
      ];
      setTimetableData(emptyTimetable);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
  };

  const handleDownloadTimetable = async () => {
    if (typeof window === 'undefined') return;

    const detailsEl = document.querySelector(
      "[data-sdash-timetable-download]"
    ) as HTMLDetailsElement | null;
    const wasDetailsOpen = detailsEl?.open ?? false;

    try {
      // Dynamically import html2canvas
      const html2canvas = (await import('html2canvas')).default;

      // Grid lives inside <details>; open it so layout paints for capture
      if (detailsEl) {
        detailsEl.open = true;
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      // Find the timetable grid element
      const tableElement = document.querySelector('.timetable-grid') as HTMLElement;
      if (!tableElement) {
        console.error('Timetable table not found');
        return;
      }

      // Create canvas from the table
      const canvas = await html2canvas(tableElement, {
        backgroundColor: '#000000',
        scale: 2, // Higher resolution
        useCORS: true,
        allowTaint: true,
      });

      // Convert to JPG blob
      canvas.toBlob((blob: Blob | null) => {
        if (blob) {
          // Create download link
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'sdash-timetable.jpg';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }
      }, 'image/jpeg', 0.95);
    } catch (error) {
      console.error('Error downloading timetable:', error);
    } finally {
      if (detailsEl && !wasDetailsOpen) {
        detailsEl.open = false;
      }
    }
  };

  // Transform new Go backend format to old format
  const transformGoBackendTimetableToOldFormat = (goData: Record<string, unknown>): TimetableData => {
    const timeSlots = [
      "08:00-08:50", "08:50-09:40", "09:45-10:35", "10:40-11:30", "11:35-12:25",
      "12:30-01:20", "01:25-02:15", "02:20-03:10", "03:10-04:00", "04:00-04:50"
    ];

    const schedule = goData.schedule as Array<{ day: number; table: Array<unknown> }> | undefined;
    if (!schedule || !Array.isArray(schedule)) {
      console.warn('[Timetable] Invalid schedule format');
      return {
        metadata: {
          generated_at: new Date().toISOString(),
          source: 'go_backend',
          academic_year: '',
          format: 'go_backend'
        },
        time_slots: timeSlots,
        slot_mapping: {},
        timetable: {}
      };
    }

    const timetable: Record<string, TimetableDayOrder> = {};
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

      const timeSlotsMap: Record<string, { slot_code: string; course_title: string; slot_type: string; is_alternate: boolean; courseType?: string; online?: boolean }> = {};

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
              is_alternate: false,
              courseType: courseType,
              online: course.online || false
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

    return {
      metadata: {
        generated_at: new Date().toISOString(),
        source: 'go_backend',
        academic_year: '',
        format: 'go_backend'
      },
      time_slots: timeSlots,
      slot_mapping: slotMapping,
      timetable
    };
  };

  interface TimetableDayOrder {
    do_name: string;
    time_slots: {
      [timeSlot: string]: {
        slot_code: string;
        course_title: string;
        slot_type: string;
        is_alternate: boolean;
        courseType?: string;
        online?: boolean;
      };
    };
  }

  const slotTimeToMinutes = useCallback((timeStr: string): number | null => {
    const [h, m] = timeStr.split(":");
    const hours = Number(h);
    const minutes = Number(m);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    // Portal time uses 12-hour-ish slots; the original project converts hours < 8 to PM.
    const normalizedHours = hours < 8 && hours !== 0 ? hours + 12 : hours;
    return normalizedHours * 60 + minutes;
  }, []);

  const parseSlotRangeToMinutes = useCallback((range: string): { start: number; end: number } | null => {
    const [startStr, endStr] = range.split("-");
    if (!startStr || !endStr) return null;
    const start = slotTimeToMinutes(startStr.trim());
    const end = slotTimeToMinutes(endStr.trim());
    if (start == null || end == null) return null;
    return { start, end };
  }, [slotTimeToMinutes]);

  const slotsForActiveDo = useMemo(() => {
    if (!timetableData.length) {
      return [];
    }
    const dayIndex = TIMETABLE_DAY_LABELS.indexOf(
      activeDayOrder as (typeof TIMETABLE_DAY_LABELS)[number]
    );
    if (dayIndex < 0) {
      return [];
    }
    const dayKey = TIMETABLE_DAY_KEYS[dayIndex];
    return timetableData.map((slot) => {
      const cellData = slot[dayKey];
      const isObject = typeof cellData === "object" && cellData !== null;
      const courseName = isObject
        ? (cellData as TimeSlotCell).course
        : (cellData as string) || "";

      let slotType = "";
      let slotCode = "";
      const dayOrderData = rawTimetableData?.timetable?.[activeDayOrder];
      const ts = dayOrderData?.time_slots?.[slot.time];
      if (ts) {
        slotType = ts.slot_type || "";
        slotCode = ts.slot_code || "";
      }

      const typeLower = slotType.toLowerCase();
      const badgeType: "theory" | "lab" | null =
        !courseName
          ? null
          : typeLower.includes("lab") || typeLower.includes("practical")
            ? "lab"
            : "theory";

      const minutes = parseSlotRangeToMinutes(slot.time);
      return {
        timeKey: slot.time,
        timeLabel: slot.time.replace(/-/g, " – "),
        subject: courseName.trim() || null,
        code: slotCode,
        type: badgeType,
        slotStartMinutes: minutes?.start ?? null,
        slotEndMinutes: minutes?.end ?? null,
      };
    });
  }, [timetableData, rawTimetableData, activeDayOrder, parseSlotRangeToMinutes]);

  const nowMinutes = now
    ? now.getHours() * 60 + now.getMinutes()
    : null;
  const shouldDepleteMeter =
    Boolean(mounted && todayDayOrderLabel && activeDayOrder === todayDayOrderLabel && nowMinutes != null);

  const timetableDownloadButton = (
    <button
      type="button"
      onClick={() => void handleDownloadTimetable()}
      className="touch-target text-sdash-text-secondary"
      aria-label="Download timetable as image"
      title="Download timetable as image"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        className="w-[18px] h-[18px]"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col">
        <TopAppBar title="Timetable" showBack />
        <main className="flex flex-col justify-center flex-1 gap-6 px-4 py-8">
          <div className="text-sdash-text-primary font-sora text-lg font-bold text-center">Loading timetable data...</div>
          <div className="max-w-2xl mx-auto w-full">
            <div className="text-sdash-text-primary text-base font-sora font-bold mb-4 text-center">
              Meanwhile, here are some interesting facts:
            </div>
            <div className="text-sdash-text-secondary text-sm font-sora text-center italic">
              {currentFact}
            </div>
          </div>
        </main>
        <PillNav />
      </div>
    );
  }

  // Show empty state if no timetable data but no error (allows refresh button to work)
  if (!rawTimetableData || !timetableData || timetableData.length === 0) {
    return (
      <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col">
        <TopAppBar
          title="Timetable"
          showBack
          onRefresh={() => void refreshTimetableData()}
          isRefreshing={loading || isRefreshing}
          rightAction={timetableDownloadButton}
        />
        <main className="flex flex-col flex-1 items-center justify-center gap-6 px-4 py-8">
          <div className="w-full max-w-xl rounded-[12px] border border-white/[0.08] bg-white/[0.05] p-8 text-center font-sora">
            <div className="text-sdash-text-primary text-base sm:text-lg">
              No timetable data available
            </div>
            <div className="text-sdash-text-secondary text-sm mt-3">
              Use the refresh control in the header to fetch timetable data
            </div>
          </div>
        </main>
        <PillNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col overflow-x-hidden">
      <TopAppBar
        title="Timetable"
        showBack
        onRefresh={() => void refreshTimetableData()}
        isRefreshing={loading || isRefreshing}
        rightAction={timetableDownloadButton}
      />

      <main className="w-full max-w-lg mx-auto flex flex-col gap-6 px-4 pt-4 pb-2">
        {/* DO 1–5 tabs (academic-compass style) */}
        <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
          {TIMETABLE_DAY_LABELS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setHasUserSelectedDayOrder(true);
                setActiveDayOrder(d);
              }}
              className={`shrink-0 rounded-[6px] px-2 py-0 text-md font-sora font-medium transition-colors h-7 min-h-0 leading-none !touch-manipulation ${
                activeDayOrder === d
                  ? "bg-sdash-accent text-sdash-text-primary"
                  : "bg-sdash-surface-1 border border-white/[0.08] text-sdash-text-secondary"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {slotsForActiveDo.map((row) => {
            let remainingFraction = 1;
            if (
              shouldDepleteMeter &&
              nowMinutes != null &&
              row.slotStartMinutes != null &&
              row.slotEndMinutes != null &&
              row.slotEndMinutes > row.slotStartMinutes
            ) {
              remainingFraction =
                nowMinutes <= row.slotStartMinutes
                  ? 1
                  : nowMinutes >= row.slotEndMinutes
                    ? 0
                    : (row.slotEndMinutes - nowMinutes) /
                      (row.slotEndMinutes - row.slotStartMinutes);
            }

            const remainingPct = Math.max(0, Math.min(1, remainingFraction)) * 100;

            return (
              <GlassCard
                key={row.timeKey}
                subjectCategory={
                  row.type === "lab" ? "Lab" : row.type === "theory" ? "Theory" : undefined
                }
                className={`p-4 ${
                  row.subject ? "flex flex-col gap-2" : "border border-dashed border-white/20 !rounded-[12px]"
                }`}
              >
                {/* Day depletion meter (green): shrinks as time goes on */}
                <div className="absolute left-0 top-0 bottom-0 w-[3px]">
                  <div
                    className="absolute left-0 bottom-0 w-[3px] bg-sdash-success rounded-r-full transition-[height] duration-500 ease-linear"
                    style={{ height: `${remainingPct}%` }}
                  />
                </div>

                {row.subject ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-geist-mono text-sm text-sdash-text-secondary">
                        {row.timeLabel}
                      </span>
                      {row.type ? (
                        <span className="text-[11px] font-sora text-sdash-text-muted capitalize">
                          {row.type}
                        </span>
                      ) : null}
                    </div>
                    <p className="font-sora font-semibold text-base text-sdash-text-primary leading-snug">
                      {row.subject}
                    </p>
                    {row.code ? (
                      <p className="text-xs text-sdash-text-muted font-sora uppercase tracking-wider">
                        {row.code}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-geist-mono text-sm text-sdash-text-secondary">
                      {row.timeLabel}
                    </span>
                    <span className="text-sm text-sdash-text-muted font-sora">No class</span>
                  </div>
                )}
              </GlassCard>
            );
          })}
        </div>

        {/* Quick stats (sdash tokens) */}
        <GlassCard className="p-4 sm:p-5">
          <p className="font-sora font-semibold text-base text-sdash-text-primary text-center mb-4">Quick stats</p>

          {dayOrderStats ? (
            <div className="mb-6">
              <p className="section-label mb-3">Day order distribution</p>
              <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-1 px-1">
                {[1, 2, 3, 4, 5].map((doNumber) => (
                  <StatChip key={doNumber}>
                    <span className="stat-number text-[13px] text-sdash-text-primary">
                      {dayOrderStats[doNumber] ?? 0}
                    </span>
                    <span className="text-[13px] text-sdash-text-secondary whitespace-nowrap">DO {doNumber}</span>
                  </StatChip>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="section-label mb-3">Subject schedule</p>
            <div className="flex flex-col gap-3">
              {slotOccurrences.map((occurrence, index) => (
                <GlassCard
                  key={index}
                  subjectCategory={occurrence.category}
                  className="p-3 border border-white/[0.06]"
                >
                  <p className="font-sora font-semibold text-sm text-sdash-text-primary">{occurrence.courseTitle}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-[11px] text-sdash-text-secondary font-sora">{occurrence.category}</span>
                    <span className="text-[11px] text-sdash-text-muted font-sora">Slots: {occurrence.slot}</span>
                  </div>
                  <p className="text-[11px] text-sdash-text-secondary font-sora mt-2 leading-relaxed">
                    Day orders:{" "}
                    {occurrence.dayOrders
                      .sort()
                      .map((doNum: number) => `DO${doNum}(${occurrence.dayOrderHours[doNum]})`)
                      .join(", ")}
                  </p>
                  <p className="text-[11px] text-sdash-text-muted font-sora mt-1">
                    Total sessions: {occurrence.totalOccurrences}
                  </p>
                </GlassCard>
              ))}
            </div>
          </div>
        </GlassCard>
      </main>

      <PillNav />

      {/* Re-auth Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-sdash-surface-1 border border-white/[0.08] rounded-[12px] p-8 max-w-md w-full mx-4">
            <h2 className="text-xl font-sora font-semibold text-sdash-text-primary mb-4">Session expired</h2>
            <p className="text-sdash-text-secondary text-sm mb-6">
              Your portal session has expired. Please sign in again to continue.
            </p>
            <Link
              href="/auth"
              onClick={handleReAuthenticate}
              className="block w-full text-center bg-sdash-accent text-sdash-text-primary font-sora font-medium text-sm rounded-full py-3 touch-target"
            >
              Sign in
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
