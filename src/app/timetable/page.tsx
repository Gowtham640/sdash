'use client';
import React, { useState, useEffect, useMemo } from "react";
import Link from 'next/link';
import { getSlotOccurrences, getDayOrderStats, type SlotOccurrence, type DayOrderStats } from "@/lib/timetableUtils";
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import NavigationButton from "@/components/NavigationButton";
import { useErrorTracking } from "@/lib/useErrorTracking";
import type html2canvas from 'html2canvas';
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import Particles from "@/components/Particles";
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
      const doData = data.timetable && typeof data.timetable === 'object' ? (data.timetable as Record<string, unknown>)[doName] : null;
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
  const initialTimetableSnapshot = useMemo(() => getInitialTimetableSnapshot(), []);
  const [timetableData, setTimetableData] = useState<TimeSlot[]>(initialTimetableSnapshot.timetableSlots);
  const [rawTimetableData, setRawTimetableData] = useState<TimetableData | null>(initialTimetableSnapshot.rawTimetableData);
  const [loading, setLoading] = useState(!initialTimetableSnapshot.hasTimetableCache);
  const [error, setError] = useState<string | null>(null);

  // Track errors
  useErrorTracking(error, '/timetable');
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>(initialTimetableSnapshot.slotOccurrences);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(initialTimetableSnapshot.dayOrderStats);
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>(initialTimetableSnapshot.calendarData);
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentFact, setCurrentFact] = useState(getRandomFact());

  const renderParticleLayer = () => (
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
        pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
      />
    </div>
  );

  useEffect(() => {
    fetchUnifiedData();
  }, []);

  // Rotate facts every 8 seconds while loading
  useEffect(() => {
    if (!loading) return;

    const interval = setInterval(() => {
      setCurrentFact(getRandomFact());
    }, 8000);

    return () => clearInterval(interval);
  }, [loading]);

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

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
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
            setCalendarData(calendarArray);
            const stats = getDayOrderStats(calendarArray);
            setDayOrderStats(stats);
            // Cache day order stats in localStorage
            try {
              localStorage.setItem('sdash_dayOrderStats', JSON.stringify(stats));
            } catch (e) {
              console.warn('[Timetable] Failed to cache day order stats:', e);
            }
            console.log('[Timetable] ✅ Day order stats calculated:', stats);
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
              setCalendarData(calendarArray);
              const stats = getDayOrderStats(calendarArray);
              setDayOrderStats(stats);
              console.log('[Timetable] ✅ Day order stats calculated from unified cache:', stats);
            }
          }
        } else {
          // Fetch calendar data separately if not in cache
          console.log('[Timetable] 📅 Fetching calendar data for day order stats...');
          try {
            const calendarResponse = await trackPostRequest('/api/data/all', {
              action: 'data_unified_fetch',
              dataType: 'calendar',
              payload: getRequestBodyWithPassword(access_token, false, ['calendar']),
              omitPayloadKeys: ['password', 'access_token'],
            });
            const calendarResult = await calendarResponse.json();
            if (calendarResult.success && calendarResult.data?.calendar) {
              let calendarArray: CalendarEvent[] | null = null;
              const calendarData = calendarResult.data.calendar;

              if (Array.isArray(calendarData)) {
                // Map JSON format to CalendarEvent interface
                calendarArray = calendarData.map((e: any) => ({
                  date: e.date,
                  day_name: e.day_name,
                  content: e.event ?? '',
                  day_order: e.day_order,
                  month: e.month,
                  year: e.year
                }));
              } else if (calendarData && typeof calendarData === 'object') {
                const calendarObj = calendarData as Record<string, unknown>;
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
                setCalendarData(calendarArray);
                const stats = getDayOrderStats(calendarArray);
                setDayOrderStats(stats);
                console.log('[Timetable] ✅ Day order stats calculated from calendar fetch:', stats);
              }
            }
          } catch (calendarErr) {
            console.error('[Timetable] ❌ Error fetching calendar for stats:', calendarErr);
          }
        }
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

    try {
      // Dynamically import html2canvas
      const html2canvas = (await import('html2canvas')).default;

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

  const days = ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'];
  const dayKeys = ['do1', 'do2', 'do3', 'do4', 'do5'] as const;

  if (loading) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
        <div className="w-[90vw] h-[90vh] bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-6 justify-center items-center">
          <div className="text-white text-4xl font-sora font-bold">Timetable</div>
          <div className="text-white text-2xl font-sora">Loading timetable data...</div>
          <div className="max-w-2xl px-6">
            <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4 text-center">
              Meanwhile, here are some interesting facts:
            </div>
            <div className="text-gray-300 text-sm sm:text-base md:text-lg lg:text-xl font-sora text-center italic">
              {currentFact}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden">
        <div className="w-[90vw] h-[90vh] bg-white/10 border border-white/20 rounded-3xl text-white text-3xl font-sora flex flex-col gap-10 justify-center items-center">
          <div className="text-white text-4xl font-sora font-bold">Timetable</div>
          <div className="text-red-400 text-2xl font-sora text-center px-4">{error}</div>
          <div className="flex gap-4">
            <button
              onClick={() => fetchUnifiedData()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
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
        </div>
      </div>
    );
  }

  // Show empty state if no timetable data but no error (allows refresh button to work)
  if (!rawTimetableData || !timetableData || timetableData.length === 0) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden pt-10 pb-10 gap-8">
        {/* Home Icon */}
        {renderParticleLayer()}
        <Link
          href="/dashboard"
          className="absolute top-4 left-4 text-white hover:text-white/80 transition-colors z-50"
          aria-label="Go to Dashboard"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-8 h-8"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        </Link>

        <div className="flex flex-col items-center gap-4 mb-4 sm:mb-5 md:mb-5.5 lg:mb-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-6xl font-sora font-bold">Timetable</div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadTimetable}
                className="text-white hover:text-green-400 transition-colors"
                aria-label="Download timetable as JPG"
                title="Download timetable as JPG"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
              <button
                onClick={refreshTimetableData}
                disabled={loading}
                className="text-white hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Refresh timetable data"
                title="Refresh timetable data"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className={`w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 ${loading ? 'animate-spin' : ''}`}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="w-[95vw] sm:w-[95vw] md:w-[95vw] lg:w-[95vw] h-auto bg-white/10 border border-white/20 rounded-3xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col gap-6 justify-center items-center p-8">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center">
            No timetable data available
          </div>
          <div className="text-gray-400 text-sm sm:text-base md:text-lg font-sora text-center">
            Click the refresh button above to fetch timetable data
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col justify-center overflow-hidden pt-10 pb-10 gap-8">
      {renderParticleLayer()}
      {/* Home Icon */}
      <Link
        href="/dashboard"
        className="absolute top-4 left-4 text-white hover:text-white/80 transition-colors z-50"
        aria-label="Go to Dashboard"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-8 h-8"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      </Link>

      <div className="flex flex-col items-center gap-4 mb-4 sm:mb-5 md:mb-5.5 lg:mb-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-6xl font-sora font-bold">Timetable</div>
          <button
            onClick={refreshTimetableData}
            disabled={loading}
            className="text-white hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Refresh timetable data"
            title="Refresh timetable data"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className={`w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 ${loading ? 'animate-spin' : ''}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        </div>

      </div>
      <div className="absolute top-20 right-4 z-20">
        <button
          onClick={handleDownloadTimetable}
          className="bg-blue-600 hover:bg-blue-700 text-white font-sora font-bold py-2 px-4 rounded-lg transition-colors flex items-center gap-2 text-sm"
          aria-label="Download timetable"
          title="Download timetable as image"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Download
        </button>
      </div>
      <div className="w-full max-w-full bg-white/10 border border-white/20 rounded-3xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora overflow-hidden relative">

        <div className="w-full overflow-x-auto">
          <div
            className="timetable-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: `120px repeat(${timetableData.length}, 1fr)`,
              gridTemplateRows: `auto repeat(${days.length}, 1fr)`,
              minWidth: `${120 + (timetableData.length * 140)}px`,
              gap: '1px',
              backgroundColor: 'rgba(255, 255, 255, 0.2)'
            }}
          >
            {/* Header Row - Day Order + Time Slots */}
            <div className="bg-white/20 border border-white/30 p-2 sm:p-2.5 md:p-3 lg:p-3 text-center font-bold text-[10px] sm:text-xs md:text-sm lg:text-base sticky top-0 z-10">
              Day Order
            </div>
            {timetableData.map((slot) => (
              <div
                key={slot.time}
                className="bg-white/20 border border-white/30 p-2 sm:p-2.5 md:p-3 lg:p-3 text-center font-bold text-[10px] sm:text-xs md:text-sm lg:text-base sticky top-0 z-10"
              >
                {slot.time}
              </div>
            ))}

            {/* Data Rows */}
            {days.map((day, dayIndex) => (
              <React.Fragment key={day}>
                {/* Day Order Column */}
                <div className="bg-white/10 border border-white/30 p-2 sm:p-2.5 md:p-3 lg:p-3 text-center font-bold text-[10px] sm:text-xs md:text-sm lg:text-base">
                  {day}
                </div>

                {/* Time Slot Cells */}
                {timetableData.map((slot) => {
                  const dayKey = dayKeys[dayIndex];
                  const cellData = slot[dayKey];
                  const isObject = typeof cellData === 'object' && cellData !== null;
                  const courseName = isObject ? (cellData as { course: string }).course : (cellData as string) || "";

                  // Get slot type from raw timetable data if available
                  let slotType = '';
                  if (rawTimetableData && rawTimetableData.timetable) {
                    const dayOrderData = rawTimetableData.timetable[day];
                    if (dayOrderData && dayOrderData.time_slots[slot.time]) {
                      slotType = dayOrderData.time_slots[slot.time].slot_type || '';
                    }
                  }

                  // Determine background color based on slotType
                  let bgColor = 'bg-white/10';
                  if (slotType) {
                    const typeLower = slotType.toLowerCase();
                    if (typeLower === 'lab') {
                      bgColor = 'bg-green-500/30';
                    } else {
                      bgColor = 'bg-blue-500/30';
                    }
                  }

                  return (
                    <div
                      key={`${day}-${slot.time}`}
                      className={`border border-white/30 p-2 sm:p-2.5 md:p-3 lg:p-3 text-center text-[10px] sm:text-xs md:text-sm lg:text-base ${bgColor} min-h-[60px] flex items-center justify-center`}
                    >
                      {courseName}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Stats Section */}
      <div className="w-[95vw] bg-white/10 border border-white/20 rounded-3xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora overflow-hidden">
        <div className="p-4 sm:p-5 md:p-5.5 lg:p-6">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4 sm:mb-5 md:mb-5.5 lg:mb-6 text-center">Quick Stats</div>

          {/* Day Order Statistics */}
          {dayOrderStats && (
            <div className="mb-6 sm:mb-7 md:mb-8 lg:mb-8">
              <div className="text-white text-sm sm:text-base md:text-lg lg:text-lg font-sora font-bold mb-3 sm:mb-4">Day Order Distribution</div>
              <div className="grid grid-cols-5 gap-2 sm:gap-3 md:gap-4">
                {[1, 2, 3, 4, 5].map((doNumber) => (
                  <div
                    key={doNumber}
                    className="bg-white/10 border border-white/20 rounded-xl p-3 sm:p-4 text-center"
                  >
                    <div className="text-white/70 text-xs sm:text-sm md:text-base mb-1">DO {doNumber}</div>
                    <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-bold">
                      {dayOrderStats[doNumber] || 0}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subject Occurrences */}
          <div>
            <div className="text-white text-sm sm:text-base md:text-lg lg:text-lg font-sora font-bold mb-3 sm:mb-4">Subject Schedule Overview</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {slotOccurrences.map((occurrence, index) => (
                <div key={index} className="bg-white/10 border border-white/20 rounded-2xl p-3 sm:p-3.5 md:p-4 lg:p-4">
                  <div className="flex flex-col gap-2">
                    <div className="text-white text-xs sm:text-sm font-sora font-bold">
                      {occurrence.courseTitle}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`text-[10px] sm:text-xs font-sora px-1.5 sm:px-2 py-0.5 sm:py-1 rounded ${occurrence.category === 'Theory'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-green-500/20 text-green-400'
                        }`}>
                        {occurrence.category}
                      </div>
                      <div className="text-white/70 text-[10px] sm:text-xs font-sora">
                        Slots: {occurrence.slot}
                      </div>
                    </div>
                    <div className="text-white/80 text-[10px] sm:text-xs font-sora">
                      Day Orders: {occurrence.dayOrders.sort().map((doNum: number) =>
                        `DO${doNum}(${occurrence.dayOrderHours[doNum]})`
                      ).join(', ')}
                    </div>
                    <div className="text-white/80 text-[10px] sm:text-xs font-sora">
                      Total Sessions: {occurrence.totalOccurrences}
                    </div>
                  </div>
                </div>
              ))}
            </div>
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