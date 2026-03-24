'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { getTimetableSummary, getSlotOccurrences, getDayOrderStats, type DayOrderStats, type SlotOccurrence, type TimetableData, type CalendarEvent, type TimetableDayOrder } from '@/lib/timetableUtils';
import { AttendancePredictionModal } from '@/components/AttendancePredictionModal';
import { ODMLModal } from '@/components/ODMLModal';
import { calculatePredictedAttendance, calculateODMLAdjustedAttendance, calculateSubjectHoursInDateRange, getDayOrderStatsForDateRange, type PredictionResult, type LeavePeriod } from '@/lib/attendancePrediction';
import { markSaturdaysAsHolidays } from '@/lib/calendarHolidays';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { DateRange } from 'react-day-picker';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { DEFAULT_RANDOM_FACT, getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import { trackFeatureClick } from "@/lib/analytics";
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import { deduplicateRequest } from "@/lib/requestDeduplication";
import { useErrorTracking } from "@/lib/useErrorTracking";
import { trackPostRequest } from "@/lib/postAnalytics";
import { fetchOdmlRecords, saveOdmlRecord, deleteOdmlRecord, aggregateOdmlHours, type OdmlRecord } from '@/lib/odmlStorage';
import { normalizeAttendanceData } from '@/lib/dataTransformers';
import { fetchCalendarFromSupabase } from '@/lib/calendarFetcher';
import { canMakeRequest, recordRequest, RateLimitError } from '@/lib/backendRequestLimiter';
import { isDataFresh } from '@/lib/dataExpiry';
import type { AttendanceData, AttendanceSubject } from '@/lib/apiTypes';
import TopAppBar from '@/components/sdash/TopAppBar';
import PillNav from '@/components/sdash/PillNav';
import GlassCard from '@/components/sdash/GlassCard';
import StatChip from '@/components/sdash/StatChip';
import SwipeableCards from '@/components/sdash/SwipeableCards';
import BottomSheet from '@/components/sdash/BottomSheet';

interface AttendanceApiResponse {
  success: boolean;
  data?: AttendanceData;
  error?: string;
  count?: number;
}

// Component for displaying remaining hours (using proven utility functions)
const RemainingHoursDisplay = ({ courseTitle, category, dayOrderStats, slotOccurrences }: {
  courseTitle: string;
  category: string;
  dayOrderStats: DayOrderStats | null;
  slotOccurrences: SlotOccurrence[];
}) => {
  console.log(`[RemainingHoursDisplay] Calculating for: "${courseTitle}" (${category})`);
  console.log(`[RemainingHoursDisplay] Available slot occurrences:`, slotOccurrences.map(s => `"${s.courseTitle}" (${s.category}) - Slots: ${s.slot} - DO: ${s.dayOrders.join(',')} - Hours: ${JSON.stringify(s.dayOrderHours)}`));

  // Use the EXACT SAME matching logic as the working prediction code
  const findSlotData = (courseTitle: string, category: string, slotOccurrences: SlotOccurrence[]): SlotOccurrence | null => {
    console.log(`[RemainingHoursDisplay] Finding slot data for: "${courseTitle}" (${category})`);
    console.log(`[RemainingHoursDisplay] Available slot occurrences:`, slotOccurrences.map(s => `"${s.courseTitle}" (${s.category})`));

    // Normalize category function (same as working code)
    const normalizeCategory = (cat: string): string => {
      const normalized = cat.toLowerCase().trim();
      if (normalized.includes('lab')) return 'practical';
      if (normalized.includes('practical')) return 'practical';
      if (normalized.includes('theory')) return 'theory';
      return normalized;
    };

    // Try exact match first
    let slotData = slotOccurrences.find(occurrence =>
      occurrence.courseTitle.toLowerCase().trim() === courseTitle.toLowerCase().trim() &&
      normalizeCategory(occurrence.category) === normalizeCategory(category)
    );

    if (slotData) {
      console.log(`[RemainingHoursDisplay] Exact match found: "${slotData.courseTitle}" (${slotData.category})`);
      return slotData;
    }

    // For subjects that might have both Theory and Lab versions, be EXTRA strict
    const subjectTitle = courseTitle.toLowerCase().trim();
    const subjectCategory = normalizeCategory(category);

    // Check if this subject has both Theory and Lab versions
    const hasBothVersions = slotOccurrences.some(occ =>
      occ.courseTitle.toLowerCase().trim() === subjectTitle &&
      normalizeCategory(occ.category) !== subjectCategory
    );

    if (hasBothVersions) {
      console.log(`[RemainingHoursDisplay] Subject "${courseTitle}" has both Theory and Lab versions - requiring EXACT match`);
      // For subjects with both versions, require EXACT title match
      slotData = slotOccurrences.find(occurrence =>
        occurrence.courseTitle.toLowerCase().trim() === subjectTitle &&
        normalizeCategory(occurrence.category) === subjectCategory
      );

      if (slotData) {
        console.log(`[RemainingHoursDisplay] Exact match for dual-version subject: "${slotData.courseTitle}" (${slotData.category})`);
        return slotData;
      }

      // If no exact match found for dual-version subject, return null to prevent wrong matches
      console.warn(`[RemainingHoursDisplay] No exact match found for dual-version subject "${courseTitle}" (${category}) - returning null`);
      return null;
    }

    // Try fuzzy matching with EXTREMELY strict criteria (only if no exact match and no dual versions)
    slotData = slotOccurrences.find(occurrence => {
      // Require exact category match for fuzzy matching
      if (normalizeCategory(occurrence.category) !== subjectCategory) {
        return false;
      }

      // EXTREMELY strict title matching - require at least 90% character overlap
      const occurrenceTitle = occurrence.courseTitle.toLowerCase().trim();

      // Calculate character overlap percentage
      const longerTitle = subjectTitle.length > occurrenceTitle.length ? subjectTitle : occurrenceTitle;
      const shorterTitle = subjectTitle.length > occurrenceTitle.length ? occurrenceTitle : subjectTitle;

      let overlapCount = 0;
      for (let i = 0; i < shorterTitle.length; i++) {
        if (longerTitle.includes(shorterTitle[i])) {
          overlapCount++;
        }
      }

      const overlapPercentage = (overlapCount / longerTitle.length) * 100;
      const courseTitleMatch = overlapPercentage >= 90 && Math.abs(subjectTitle.length - occurrenceTitle.length) <= 1;

      if (courseTitleMatch) {
        console.log(`[RemainingHoursDisplay] Fuzzy match found: "${occurrence.courseTitle}" (${occurrence.category}) - ${overlapPercentage.toFixed(1)}% overlap`);
      }

      return courseTitleMatch;
    });

    if (!slotData) {
      console.warn(`[RemainingHoursDisplay] No slot data found for: "${courseTitle}" (${category})`);
      console.warn(`[RemainingHoursDisplay] Searched ${slotOccurrences.length} occurrences`);
    }

    return slotData || null;
  };

  const slotData = findSlotData(courseTitle, category, slotOccurrences);

  if (!slotData || !dayOrderStats) {
    console.log(`[RemainingHoursDisplay] No match found for: ${courseTitle} (${category})`);
    console.log(`[RemainingHoursDisplay] slotData: ${!!slotData}, dayOrderStats: ${!!dayOrderStats}`);
    return <span className="text-red-400">0 hours (no match)</span>;
  }

  console.log(`[RemainingHoursDisplay] Matched: ${courseTitle} (${category}) -> ${slotData.courseTitle} (${slotData.category})`);
  console.log(`[RemainingHoursDisplay] Using slot: ${slotData.slot}`);
  console.log(`[RemainingHoursDisplay] Day order stats:`, dayOrderStats);
  console.log(`[RemainingHoursDisplay] Slot data day order hours:`, slotData.dayOrderHours);

  // Use the EXACT SAME calculation method as calculateSubjectHoursInDateRange (proven working)
  let totalRemainingHours = 0;
  if (!slotData || !slotData.dayOrderHours || typeof slotData.dayOrderHours !== 'object') {
    return <span className="text-red-400">0 hours (no slot data)</span>;
  }
  Object.entries(slotData.dayOrderHours).forEach(([dayOrder, hoursPerDay]) => {
    const doNumber = parseInt(dayOrder);
    const dayCount = dayOrderStats[doNumber] || 0;
    totalRemainingHours += dayCount * hoursPerDay;
    console.log(`[RemainingHoursDisplay] DO${doNumber}: ${dayCount} days × ${hoursPerDay} hours = ${dayCount * hoursPerDay} hours`);
  });

  console.log(`[RemainingHoursDisplay] Total remaining hours calculated: ${totalRemainingHours}`);

  if (totalRemainingHours === 0) {
    return <span className="text-yellow-400">0 hours (no remaining days)</span>;
  }

  return <span className="text-blue-400">{totalRemainingHours} hours</span>;
};

const loadDayOrderStatsFromLocalStorage = (): DayOrderStats | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = localStorage.getItem('sdash_dayOrderStats');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        return parsed as DayOrderStats;
      }
    }
  } catch (error) {
    console.warn('[Attendance] Failed to parse day order stats from localStorage:', error);
  }

  return null;
};

const loadSlotOccurrencesFromLocalStorage = (): SlotOccurrence[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = localStorage.getItem('sdash_slotOccurrences');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed as SlotOccurrence[];
      }
    }
  } catch (error) {
    console.warn('[Attendance] Failed to parse slot occurrences from localStorage:', error);
  }

  return [];
};

interface AttendanceCacheSnapshot {
  attendanceData: AttendanceData | null;
  calendarData: CalendarEvent[];
  slotOccurrences: SlotOccurrence[];
  dayOrderStats: DayOrderStats | null;
}

const getInitialAttendanceCacheSnapshot = (): AttendanceCacheSnapshot => {
  const attendanceData = getClientCache<AttendanceData>('attendance');
  const calendarData = getClientCache<CalendarEvent[]>('calendar') ?? [];
  const timetableCache = getClientCache<TimetableData>('timetable');
  const slotOccurrencesFromTimetable = timetableCache ? getSlotOccurrences(timetableCache) : [];
  const slotOccurrences =
    slotOccurrencesFromTimetable.length > 0 ? slotOccurrencesFromTimetable : loadSlotOccurrencesFromLocalStorage();
  const dayOrderStats =
    calendarData.length > 0 ? getDayOrderStats(calendarData) : loadDayOrderStatsFromLocalStorage();

  return {
    attendanceData: attendanceData ?? null,
    calendarData,
    slotOccurrences,
    dayOrderStats,
  };
};

export default function AttendancePage() {
  const initialAttendanceCache = useMemo(() => getInitialAttendanceCacheSnapshot(), []);
  console.log('[Attendance][Cache] Initial cache snapshot:', {
    hasAttendance: !!initialAttendanceCache.attendanceData,
    slotOccurrences: initialAttendanceCache.slotOccurrences.length,
    dayOrderStats: initialAttendanceCache.dayOrderStats,
  });
  const isCacheRenderable = (data: AttendanceData | null): boolean =>
    Boolean(data && data.all_subjects && data.all_subjects.length > 0);
  const initialRenderable = isCacheRenderable(initialAttendanceCache.attendanceData);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(
    initialRenderable ? initialAttendanceCache.attendanceData : null
  );
  const [cacheRenderable, setCacheRenderable] = useState(initialRenderable);
  const [loading, setLoading] = useState(!initialRenderable);
  const [error, setError] = useState<string | null>(null);

  // Track errors
  useErrorTracking(error, '/attendance');
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  /** Index in all_subjects for BottomSheet detail (academic-compass style) */
  const [detailSubjectIndex, setDetailSubjectIndex] = useState<number | null>(null);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(initialAttendanceCache.dayOrderStats);
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>(initialAttendanceCache.slotOccurrences);
  const [subjectRemainingHours, setSubjectRemainingHours] = useState<Array<Record<string, unknown>>>([]);
  const [showPredictionModal, setShowPredictionModal] = useState(false);
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>(initialAttendanceCache.calendarData);
  const [semester, setSemester] = useState<number>(1); // Default to semester 1
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [predictionResults, setPredictionResults] = useState<PredictionResult[]>([]);
  const [isPredictionMode, setIsPredictionMode] = useState(false);
  const [leavePeriods, setLeavePeriods] = useState<LeavePeriod[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [showODMLModal, setShowODMLModal] = useState(false);
  const [odmlPeriods, setOdmlPeriods] = useState<LeavePeriod[]>([]);
  const [isOdmlMode, setIsOdmlMode] = useState(false);
  const [currentFact, setCurrentFact] = useState(DEFAULT_RANDOM_FACT);
  const [savedOdmlRecords, setSavedOdmlRecords] = useState<OdmlRecord[]>([]);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);
  const [attendanceViewMode, setAttendanceViewMode] = useState<'cards' | 'list'>('cards');
  const [showOdmlApplied, setShowOdmlApplied] = useState(true); // Toggle to show with/without ODML
  const [originalAttendanceData, setOriginalAttendanceData] = useState<AttendanceData | null>(
    initialRenderable ? initialAttendanceCache.attendanceData : null
  ); // Store original data
  const showOdmlAppliedRef = useRef(showOdmlApplied);
  const fetchUnifiedDataRef = useRef<((forceRefresh?: boolean) => Promise<void>) | null>(null);
  const clampAttendance = (value: number) => Math.max(0, Math.min(100, value));
  // Refs to prevent duplicate button clicks
  const isOpeningPredictionModal = useRef(false);
  const isOpeningOdmlModal = useRef(false);
  const isEnsuringCalendarRef = useRef(false);
  const applyAttendanceDataPayload = (payload: AttendanceData, options?: { expiresAt?: string | null }) => {
    setAttendanceData(payload);
    setOriginalAttendanceData(payload);
    setSemester(payload.metadata?.semester || 1);
    setClientCache('attendance', payload, { expiresAt: options?.expiresAt ?? null });
    setCacheRenderable(isCacheRenderable(payload));
    console.log('[Attendance][Cache] Applied normalized attendance payload:', {
      subjects: payload.all_subjects?.length,
      metadata: payload.metadata,
      expiresAt: options?.expiresAt ?? null,
    });
  };

  const ensureNormalizedAttendanceCache = async (
    access_token: string,
    options: { maxRetries?: number; retryDelayMs?: number } = {}
  ): Promise<AttendanceCacheFetchResult> => {
    console.log('[Attendance][Cache] Ensuring normalized attendance cache before UI render');
    const supabaseCache = await fetchAttendanceDataFromSupabase(access_token, options);
    console.log('[Attendance][Cache] Normalized cache response', {
      hasData: !!supabaseCache.data,
      isExpired: supabaseCache.isExpired,
      source: supabaseCache.source,
    });
    applyAttendanceDataPayload(supabaseCache.data, { expiresAt: supabaseCache.expiresAt });
    console.log('[Attendance][Cache] Final render source:', supabaseCache.source);
    return supabaseCache;
  };

  type AttendanceCacheFetchResult = {
    data: AttendanceData;
    isExpired: boolean;
    expiresAt: string | null;
    source: 'cache' | 'fallback';
  };

  const fetchAttendanceDataFromSupabase = async (
    access_token: string,
    options: { maxRetries?: number; retryDelayMs?: number } = {}
  ): Promise<AttendanceCacheFetchResult> => {
    const { maxRetries = 1, retryDelayMs = 0 } = options;
    let reason: string | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        console.log(`[Attendance][API] Supabase cache fetch attempt ${attempt}/${maxRetries}`);
        const response = await trackPostRequest('/api/data/cache', {
          action: 'cache_fetch',
          dataType: 'attendance',
          primary: false,
          payload: { access_token, data_type: 'attendance' },
          omitPayloadKeys: ['access_token'],
        });

        if (!response.ok) {
          reason = `HTTP ${response.status}`;
          console.warn('[Attendance] Supabase cache request failed:', response.status, response.statusText);
        } else {
          const cacheResult = await response.json();

          console.log('[Attendance][API] Supabase cache response keys:', Object.keys(cacheResult || {}));

          const validation = validateAttendanceCache(cacheResult);
          if (validation.valid && validation.normalized) {
            console.log('[Attendance][Cache] Cache hit - using normalized data');
            return {
              data: validation.normalized,
              isExpired: !!cacheResult.isExpired,
              expiresAt: cacheResult.expiresAt ?? null,
              source: 'cache',
            };
          }

          reason = validation.reason ?? 'cache validation failed';
          console.warn('[Attendance][Cache] Cache invalid -', reason);
          break;
        }
      } catch (error) {
        reason = error instanceof Error ? error.message : 'unknown error';
        console.error('[Attendance][API] ❌ Error fetching attendance cache from Supabase:', error);
      }

      if (attempt < maxRetries && retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    console.log(
      `[Attendance][Cache] Cache miss (reason: ${reason ?? 'unknown'}) — executing fallback fetch`
    );

    const fallback = await fetchAttendanceDataDirectlyFromSupabase(access_token);
    return {
      ...fallback,
      source: 'fallback',
    };
  };

  const validateAttendanceCache = (
    cacheResult: unknown
  ): { valid: boolean; normalized?: AttendanceData; reason?: string } => {
    if (!cacheResult || typeof cacheResult !== 'object' || Array.isArray(cacheResult)) {
      const reason = 'Cache response missing or malformed';
      console.warn('[Attendance][Cache] ' + reason);
      return { valid: false, reason };
    }

    const { success, data } = cacheResult as { success?: boolean; data?: unknown };

    if (!success) {
      const reason = 'Cache responded with success=false';
      console.warn('[Attendance][Cache] ' + reason);
      return { valid: false, reason };
    }

    if (!data) {
      const reason = 'Cache returned empty data payload';
      console.warn('[Attendance][Cache] ' + reason);
      return { valid: false, reason };
    }

    const normalized = normalizeAttendanceData(data);
    if (!normalized) {
      const reason = 'Normalization failed for cached attendance payload';
      console.warn('[Attendance][Cache] ' + reason);
      return { valid: false, reason };
    }

    if (!normalized.all_subjects || normalized.all_subjects.length === 0) {
      const reason = 'Normalized cache contains no subjects';
      console.warn('[Attendance][Cache] ' + reason);
      return { valid: false, reason };
    }

    return { valid: true, normalized };
  };

  const requireApiField = (name: string, value: unknown): unknown => {
    if (value === undefined) {
      const error = new Error(`[Attendance] API response missing "${name}"`);
      console.error(error.message);
      throw error;
    }
    return value;
  };

  const extractAttendancePayload = (payload: unknown): unknown | null => {
    if (!payload) {
      return null;
    }

    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const candidate = payload as { data?: unknown };
      if ('data' in candidate && candidate.data !== undefined) {
        return candidate.data;
      }
    }

    return payload;
  };

  const rebuildAttendanceCache = async (
    access_token: string,
    normalizedData: AttendanceData
  ): Promise<{ expiresAt: string | null }> => {
    const response = await trackPostRequest('/api/data/cache', {
      action: 'cache_rebuild',
      dataType: 'attendance',
      primary: false,
      payload: {
        access_token,
        data_type: 'attendance',
        normalized_data: normalizedData,
        expires_in_minutes: 10,
      },
      omitPayloadKeys: ['access_token'],
      payloadSummary: { subjects: normalizedData.all_subjects.length },
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      console.error('[Attendance][Cache] Failed to rebuild normalized cache:', result.error);
      throw new Error(result.error || 'Failed to rebuild attendance cache');
    }

    console.log(
      `[Attendance][Cache] Rebuilt normalized attendance cache with ${normalizedData.all_subjects.length} subjects`
    );

    return { expiresAt: result.expiresAt ?? null };
  };

  const fetchAttendanceDataDirectlyFromSupabase = async (
    access_token: string
  ): Promise<{ data: AttendanceData; isExpired: boolean; expiresAt: string | null }> => {
    console.log('[Attendance][Cache] Triggering direct Supabase attendance fetch (fallback)');
    const response = await trackPostRequest('/api/data/all', {
      action: 'attendance_direct_fetch',
      dataType: 'attendance',
      primary: false,
      payload: {
        access_token,
        types: ['attendance'],
      },
      omitPayloadKeys: ['access_token'],
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      console.warn('[Attendance][Cache] Direct fetch failed:', result.error);
      throw new Error(result.error || 'Failed to fetch attendance from Supabase directly');
    }

    const attendancePayload = extractAttendancePayload(result.data?.attendance);
    if (!attendancePayload) {
      throw new Error('Attendance payload missing from fallback fetch');
    }

    const normalized = normalizeAttendanceData(attendancePayload);
    if (!normalized) {
      throw new Error('Failed to normalize attendance payload from fallback fetch');
    }

    const rebuildResult = await rebuildAttendanceCache(access_token, normalized);
    return {
      data: normalized,
      isExpired: false,
      expiresAt: rebuildResult.expiresAt,
    };
  };

  const hydrateCalendarAndTimetableFromCache = () => {
    if (!calendarData.length) {
      const cachedCalendar = getClientCache<CalendarEvent[]>('calendar');
      if (cachedCalendar && cachedCalendar.length) {
        setCalendarData(cachedCalendar);
        setDayOrderStats(getDayOrderStats(cachedCalendar));
      }
    }

    if (!slotOccurrences.length) {
      const cachedTimetable = getClientCache<TimetableData>('timetable');
      if (cachedTimetable && cachedTimetable.timetable && Object.keys(cachedTimetable.timetable).length > 0) {
        const occurrences = getSlotOccurrences(cachedTimetable);
        if (occurrences.length) {
          setSlotOccurrences(occurrences);
        }
      } else if (cachedTimetable) {
        console.warn('[Attendance] ❌ Invalid cached timetable data detected, clearing entry');
        removeClientCache('timetable');
      }
    }

    if (!dayOrderStats) {
      const storedStats = loadDayOrderStatsFromLocalStorage();
      if (storedStats) {
        setDayOrderStats(storedStats);
        console.log('[Attendance] ✅ Loaded day order stats from localStorage');
      }
    }

    if (!slotOccurrences.length) {
      const storedOccurrences = loadSlotOccurrencesFromLocalStorage();
      if (storedOccurrences.length) {
        setSlotOccurrences(storedOccurrences);
        console.log('[Attendance] ✅ Loaded slot occurrences from localStorage');
      }
    }
  };

  useEffect(() => {
    fetchUnifiedDataRef.current = fetchUnifiedData;
  });

  useEffect(() => {
    void fetchUnifiedDataRef.current?.();
  }, []);

  useEffect(() => {
    showOdmlAppliedRef.current = showOdmlApplied;
  }, [showOdmlApplied]);

  // Load and apply saved ODML when attendance data is available
  useEffect(() => {
    const loadSavedOdml = async () => {
      if (!attendanceData || !originalAttendanceData || !slotOccurrences.length || !calendarData.length) {
        return;
      }

      const access_token = getStorageItem('access_token');
      if (!access_token) {
        return;
      }

      try {
        const savedRecords = await fetchOdmlRecords(access_token);
        setSavedOdmlRecords(savedRecords);
        const currentShowOdmlApplied = showOdmlAppliedRef.current;

        if (savedRecords.length > 0 && currentShowOdmlApplied) {
          applySavedOdml(savedRecords);
        } else if (savedRecords.length === 0 && currentShowOdmlApplied && isOdmlMode) {
          // No saved records but was in ODML mode, restore original
          setAttendanceData(originalAttendanceData);
          setPredictionResults([]);
          setIsOdmlMode(false);
        }
      } catch (error) {
        console.error('[Attendance] Error loading saved ODML:', error);
      }
    };

    loadSavedOdml();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceData, originalAttendanceData, slotOccurrences, calendarData, showOdmlApplied]);

  // Apply saved ODML to attendance data
  const applySavedOdml = (records: OdmlRecord[]) => {
    if (!attendanceData || !originalAttendanceData || records.length === 0) {
      return;
    }

    // Aggregate hours across all periods
    const aggregatedHours = aggregateOdmlHours(records);

    // Create adjusted attendance data
    const adjustedData: AttendanceData = {
      ...originalAttendanceData,
      all_subjects: originalAttendanceData.all_subjects.map(subject => {
        if (!subject) return subject;

        const odmlHours = aggregatedHours[subject.subject_code] || 0;
        const currentConducted = parseInt(subject.hours_conducted) || 0;
        const currentAbsent = parseInt(subject.hours_absent) || 0;
        const currentPresent = currentConducted - currentAbsent;

        // Apply ODML adjustments
        const adjustedAbsent = Math.max(0, currentAbsent - odmlHours);
        const adjustedPresent = currentPresent + odmlHours;
        const adjustedAttendance = currentConducted > 0 ? (adjustedPresent / currentConducted) * 100 : 0;
        const clampedAttendance = clampAttendance(adjustedAttendance);

        return {
          ...subject,
          hours_absent: adjustedAbsent.toString(),
          attendance: clampedAttendance.toFixed(2),
          attendance_percentage: clampedAttendance.toFixed(2)
        };
      })
    };

    // Calculate prediction results for display
    const results: PredictionResult[] = adjustedData.all_subjects.map(subject => {
      if (!subject) return null as any;

      const odmlHours = aggregatedHours[subject.subject_code] || 0;
      const currentConducted = parseInt(originalAttendanceData.all_subjects.find(s => s?.subject_code === subject.subject_code)?.hours_conducted || '0') || 0;
      const currentAbsent = parseInt(originalAttendanceData.all_subjects.find(s => s?.subject_code === subject.subject_code)?.hours_absent || '0') || 0;
      const currentPresent = currentConducted - currentAbsent;
      const currentAttendance = currentConducted > 0 ? (currentPresent / currentConducted) * 100 : 0;

      const adjustedAbsent = Math.max(0, currentAbsent - odmlHours);
      const adjustedPresent = currentPresent + odmlHours;
      const adjustedAttendance = currentConducted > 0 ? (adjustedPresent / currentConducted) * 100 : 0;
      const clampedPredictedAttendance = clampAttendance(adjustedAttendance);

      return {
        subject,
        currentAttendance,
        predictedAttendance: clampedPredictedAttendance,
        totalHoursTillEndDate: 0,
        presentHoursTillStartDate: adjustedPresent,
        absentHoursDuringLeave: adjustedAbsent,
        leavePeriods: [],
        leavePeriod: 'OD/ML Adjusted',
        odmlPeriods: [],
        odmlReductionHours: odmlHours
      };
    }).filter(r => r !== null);

    setAttendanceData(adjustedData);
    setPredictionResults(results);
    setIsOdmlMode(true);
    setIsPredictionMode(false);
  };

  // Rotate facts every 8 seconds while loading
  useEffect(() => {
    if (!loading) return;
    setCurrentFact(getRandomFact());

    const interval = setInterval(() => {
      setCurrentFact(getRandomFact());
    }, 8000);

    return () => clearInterval(interval);
  }, [loading]);

  // Use ref to prevent duplicate calls
  const isCalculatingRef = useRef(false);
  const ensureUnifiedCalendarCache = async () => {
    if (isEnsuringCalendarRef.current) {
      return;
    }

    const access_token = getStorageItem('access_token');
    if (!access_token) {
      throw new Error('No access token available for calendar refresh');
    }

    isEnsuringCalendarRef.current = true;

    try {
      const requestKey = `fetch_unified_all_${access_token.substring(0, 10)}_calendar`;
      const apiResult = await deduplicateRequest(requestKey, async () => {
        const response = await trackPostRequest('/api/data/all', {
          action: 'data_unified_fetch',
          dataType: 'attendance',
          payload: getRequestBodyWithPassword(access_token, true, ['calendar', 'timetable']),
          omitPayloadKeys: ['password', 'access_token'],
        });
        const result = await response.json();
        return { response, result };
      });

      const { response, result } = apiResult;

      if (!response.ok || result.error === 'session_expired') {
        throw new Error('Session expired while refreshing calendar cache');
      }

      if (!result.success) {
        throw new Error(result.error || 'Unified fetch failed while refreshing calendar cache');
      }

      console.log('[Attendance] ✅ Unified fetch refreshed calendar + timetable cache');

      const calendarCandidate = (result.data as { calendar?: unknown })?.calendar;
      let calendarArray: CalendarEvent[] | null = null;

      if (Array.isArray(calendarCandidate)) {
        calendarArray = calendarCandidate as CalendarEvent[];
      } else if (
        calendarCandidate &&
        typeof calendarCandidate === 'object' &&
        'data' in (calendarCandidate as Record<string, unknown>) &&
        Array.isArray((calendarCandidate as { data?: unknown }).data)
      ) {
        calendarArray = (calendarCandidate as { data?: CalendarEvent[] }).data || null;
      }

      if (calendarArray && calendarArray.length > 0) {
        setCalendarData(calendarArray);
        const stats = getDayOrderStats(calendarArray);
        setDayOrderStats(stats);
        setClientCache('calendar', calendarArray, { expiresAt: null });
        try {
          localStorage.setItem('sdash_dayOrderStats', JSON.stringify(stats));
        } catch (e) {
          console.warn('[Attendance] Failed to cache day order stats', e);
        }
      } else {
        console.warn('[Attendance] Unified fetch returned empty calendar');
      }

      const timetableCandidate = (result.data as { timetable?: unknown })?.timetable;
      let parsedTimetable: TimetableData | null = null;

      if (timetableCandidate && typeof timetableCandidate === 'object') {
        let candidate = timetableCandidate as Record<string, unknown>;

        if ('schedule' in candidate && Array.isArray(candidate.schedule)) {
          parsedTimetable = transformGoBackendTimetableToOldFormat(candidate);
        } else {
          if ('data' in candidate && typeof candidate.data === 'object' && candidate.data !== null) {
            candidate = candidate.data as Record<string, unknown>;
          }

          if ('timetable' in candidate || 'time_slots' in candidate) {
            parsedTimetable = candidate as unknown as TimetableData;
          }
        }
      }

      if (parsedTimetable) {
        setClientCache('timetable', parsedTimetable, { expiresAt: null });
        const occurrences = getSlotOccurrences(parsedTimetable);
        setSlotOccurrences(occurrences);
        try {
          localStorage.setItem('sdash_slotOccurrences', JSON.stringify(occurrences));
        } catch (e) {
          console.warn('[Attendance] Failed to cache slot occurrences', e);
        }
      } else {
        console.warn('[Attendance] Unified fetch returned empty timetable');
      }
    } finally {
      isEnsuringCalendarRef.current = false;
    }
  };

  const transformGoBackendTimetableToOldFormat = (goData: Record<string, unknown>): TimetableData => {
    const timeSlots = [
      "08:00-08:50", "08:50-09:40", "09:45-10:35", "10:40-11:30", "11:35-12:25",
      "12:30-01:20", "01:25-02:15", "02:20-03:10", "03:10-04:00", "04:00-04:50"
    ];

    const schedule = Array.isArray(goData.schedule) ? goData.schedule as Array<{ day: number; table: Array<unknown> }> : undefined;
    if (!schedule) {
      console.warn('[Attendance] Invalid Go backend timetable structure');
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

    const dayToDO: Record<number, string> = {
      1: 'DO 1',
      2: 'DO 2',
      3: 'DO 3',
      4: 'DO 4',
      5: 'DO 5'
    };

    schedule.forEach(daySchedule => {
      const doName = dayToDO[daySchedule.day];
      if (!doName) {
        return;
      }

      const timeSlotsMap: Record<string, { slot_code: string; course_title: string; slot_type: string; is_alternate: boolean; courseType?: string; online?: boolean }> = {};

      daySchedule.table.forEach((entry, index) => {
        if (entry && typeof entry === 'object') {
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
              courseType,
              online: course.online || false
            };

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

  const handlePredictionCalculate = async (periods: LeavePeriod[]) => {
    // Prevent duplicate calls
    if (isCalculatingRef.current) {
      console.log('[Attendance] Prediction calculation already in progress, skipping duplicate call');
      return;
    }

    if (!attendanceData) {
      return;
    }

    // Mark as calculating
    isCalculatingRef.current = true;
    setIsCalculating(true);

    try {
      await ensureUnifiedCalendarCache();
      const results = await calculatePredictedAttendance(
        attendanceData,
        slotOccurrences,
        periods,
        odmlPeriods
      );
      setPredictionResults(results);
      setIsPredictionMode(true);
      setShowPredictionModal(false);
    } catch (err) {
      console.error('Prediction calculation error:', err);
    } finally {
      setIsCalculating(false);
      isCalculatingRef.current = false;
    }
  };

  // Use ref to prevent duplicate calls for ODML
  const isOdmlCalculatingRef = useRef(false);

  const handleODMLCalculate = async (periods: LeavePeriod[]) => {
    // Prevent duplicate calls
    if (isOdmlCalculatingRef.current) {
      console.log('[Attendance] OD/ML calculation already in progress, skipping duplicate call');
      return;
    }

    if (!attendanceData) {
      return;
    }

    // Mark as calculating
    isOdmlCalculatingRef.current = true;
    setIsCalculating(true);

    try {
      await ensureUnifiedCalendarCache();
      const calendarForOdml = await fetchCalendarFromSupabase();
      const results = await calculateODMLAdjustedAttendance(
        attendanceData,
        slotOccurrences,
        periods
      );

      // Save each period to database
      const access_token = getStorageItem('access_token');
      if (access_token) {
        for (const period of periods) {
          // Calculate subject hours for this specific period
          const subjectHours: Record<string, number> = {};

          if (attendanceData && attendanceData.all_subjects) {
            attendanceData.all_subjects.forEach(subject => {
              if (!subject) return;
              const periodHours = calculateSubjectHoursInDateRange(
                subject,
                slotOccurrences,
                getDayOrderStatsForDateRange(calendarForOdml, period.from, period.to)
              );
              if (periodHours > 0) {
                subjectHours[subject.subject_code] = periodHours;
              }
            });
          }

          // Save to database
          await saveOdmlRecord(
            access_token,
            period.from,
            period.to,
            subjectHours
          );
        }

        // Reload saved ODML records
        const savedRecords = await fetchOdmlRecords(access_token);
        setSavedOdmlRecords(savedRecords);
        if (savedRecords.length > 0) {
          applySavedOdml(savedRecords);
          setShowOdmlApplied(true);
        }
      }

      setPredictionResults(results);
      setIsOdmlMode(true);
      setIsPredictionMode(false);
      setShowODMLModal(false);
    } catch (err) {
      console.error('OD/ML calculation error:', err);
    } finally {
      setIsCalculating(false);
      isOdmlCalculatingRef.current = false;
    }
  };

  const handleCancelPrediction = () => {
    setShowOdmlApplied(false);
    setIsPredictionMode(false);
    setIsOdmlMode(false);
    setPredictionResults([]);
    setLeavePeriods([]);
    setOdmlPeriods([]);
    setShowODMLModal(false);
    // Restore original attendance data
    if (originalAttendanceData) {
      setAttendanceData(originalAttendanceData);
    }
  };

  const formatOdmlDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const handleDeleteOdmlRecord = async (recordId: string) => {
    const access_token = getStorageItem('access_token');
    if (!access_token) {
      console.warn('[Attendance] Cannot delete OD/ML record without access token');
      return;
    }

    setDeletingRecordId(recordId);
    try {
      const success = await deleteOdmlRecord(access_token, recordId);
      if (!success) {
        return;
      }

      const updatedRecords = await fetchOdmlRecords(access_token);
      setSavedOdmlRecords(updatedRecords);

      if (updatedRecords.length > 0 && showOdmlApplied) {
        applySavedOdml(updatedRecords);
      } else if (updatedRecords.length === 0) {
        setShowOdmlApplied(false);
        if (originalAttendanceData) {
          setAttendanceData(originalAttendanceData);
          setPredictionResults([]);
          setIsOdmlMode(false);
        }
      }
    } catch (error) {
      console.error('[Attendance] Failed to delete OD/ML record:', error);
    } finally {
      setDeletingRecordId(null);
    }
  };

  const handleActivateOdmlPrediction = () => {
    if (isOdmlMode || savedOdmlRecords.length === 0) {
      return;
    }

    setShowOdmlApplied(true);
    applySavedOdml(savedOdmlRecords);
    setIsOdmlMode(true);
    setIsPredictionMode(false);
  };

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
  };

  const refreshAttendanceData = async () => {
    try {
      setIsRefreshing(true);
      setLoading(true);
      setError(null);

      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Attendance] No access token found');
        setError('Please sign in to view attendance');
        setLoading(false);
        return;
      }

      await ensureNormalizedAttendanceCache(access_token, {
        maxRetries: 3,
        retryDelayMs: 500,
      });

      const supabaseCache = await fetchAttendanceDataFromSupabase(access_token, { maxRetries: 5, retryDelayMs: 700 });
      applyAttendanceDataPayload(supabaseCache.data, { expiresAt: supabaseCache.expiresAt });
      console.log('[Attendance] Refresh fetched normalized cache source:', supabaseCache.source);

      console.log('[Attendance] 🔄 Force refreshing attendance data...');

      const response = await trackPostRequest('/api/data/refresh', {
        action: 'data_refresh',
        dataType: 'attendance',
        payload: {
          ...getRequestBodyWithPassword(access_token, false),
          data_type: 'attendance'
        },
        omitPayloadKeys: ['password', 'access_token'],
      });

      const result = await response.json();
      console.log('[Attendance] Refresh API response:', result);
      console.log('[Attendance] Refresh API response data:', result.data);
      console.log('[Attendance] Refresh API response data type:', typeof result.data);

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to refresh attendance data');
      }

      // Refresh API returns data directly from Supabase
      // Update local state with the returned data
      console.log('[Attendance] ✅ Refresh completed, updating local state...');

      const supabaseRefreshCache = await fetchAttendanceDataFromSupabase(access_token, { maxRetries: 5, retryDelayMs: 700 });

      applyAttendanceDataPayload(supabaseRefreshCache.data, { expiresAt: supabaseRefreshCache.expiresAt });
      console.log('[Attendance] ✅ Updated local state with refreshed attendance data from Supabase');
      console.log('[Attendance] Refresh fetch source:', supabaseRefreshCache.source);
    } catch (err) {
      console.error('[Attendance] Error refreshing data:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh attendance data');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);

      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Attendance] No access token found');
        setError('Please sign in to view attendance');
        setLoading(false);
        return;
      }

      const supabaseCache = await ensureNormalizedAttendanceCache(access_token, {
        maxRetries: forceRefresh ? 3 : 1,
        retryDelayMs: forceRefresh ? 500 : 0,
      });

      if (!supabaseCache.data || !supabaseCache.data.all_subjects?.length) {
        throw new Error('Normalized attendance cache returned empty subject list');
      }

      const supabaseSourceDescription = supabaseCache.source === 'cache' ? 'normalized cache' : 'fallback fetch';
      let cachedAttendance: AttendanceData | null = null;
      let needsBackgroundRefresh = supabaseCache.isExpired;

      if (!forceRefresh) {
        cachedAttendance = getClientCache<AttendanceData>('attendance');
        if (cachedAttendance) {
          console.log('[Attendance] ✅ Using client-side cache for attendance');
          setAttendanceData(cachedAttendance);
          setOriginalAttendanceData(cachedAttendance);
          setSemester(cachedAttendance.metadata?.semester || 1);
        } else {
          cachedAttendance = supabaseCache.data;
          console.log(`[Attendance] ⚡ Client cache empty, using ${supabaseSourceDescription}`);
        }
      } else {
        removeClientCache('attendance');
        console.log('[Attendance] 🗑️ Cleared client cache for force refresh');
        cachedAttendance = supabaseCache.data;
      }

      if (!cachedAttendance) {
        throw new Error('Attendance data is missing after cache validation');
      }

      hydrateCalendarAndTimetableFromCache();
      const calendarNeedsFetch = calendarData.length === 0;
      const timetableNeedsFetch = slotOccurrences.length === 0;
      const shouldFetchUnifiedData = forceRefresh || needsBackgroundRefresh || calendarNeedsFetch || timetableNeedsFetch;

      if (shouldFetchUnifiedData) {
        console.log('[Attendance] Fetching from API...', forceRefresh ? '(force refresh)' : '(fetching fresh data)');

        // Use request deduplication - ensures only ONE page calls backend at a time
        const requestKey = `fetch_unified_all_${access_token.substring(0, 10)}`;
        console.log('[Attendance][API] Unified fetch calling /api/data/all', { forceRefresh });
        const apiResult = await deduplicateRequest(requestKey, async () => {
          const response = await trackPostRequest('/api/data/all', {
            action: 'data_unified_fetch',
            dataType: 'attendance',
            payload: getRequestBodyWithPassword(access_token, forceRefresh),
            omitPayloadKeys: ['password', 'access_token'],
          });

          const result = await response.json();
          return { response, result };
        });

        const response = apiResult.response;
        const result = apiResult.result;
        console.log('[Attendance][API] Unified fetch response status:', response.status, 'payload keys:', Object.keys(result || {}));
        console.log('[Attendance] API response:', result);

        // Handle session expiry
        if (!response.ok || (result.error === 'session_expired')) {
          console.error('[Attendance] Session expired');
          setError('Your session has expired. Please re-enter your password.');
          setShowPasswordModal(true);
          setLoading(false);
          return;
        }

        if (!result.success) {
          console.error('[Attendance][API] Unified fetch failed:', result.error);
          throw new Error(result.error || 'Failed to fetch data');
        }

        console.log('[Attendance] Processing calendar/timetable from API response only (attendance data served via normalized cache).');
        const calendarCandidate = requireApiField('calendar', (result.data as { calendar?: unknown })?.calendar);
        const normalizeCalendarPayload = (payload: unknown): CalendarEvent[] | null => {
          if (!payload) return null;
          if (Array.isArray(payload)) {
            return payload as CalendarEvent[];
          }
          if (typeof payload === 'object' && payload !== null && 'data' in payload && Array.isArray((payload as { data?: unknown }).data)) {
            return (payload as { data?: CalendarEvent[] }).data || null;
          }
          return null;
        };
        const calendarPayload = normalizeCalendarPayload(calendarCandidate);
        if (!calendarPayload) {
          throw new Error('Calendar payload invalid after normalization');
        }
        console.log('[Attendance] ✅ Calendar data loaded from API payload:', calendarPayload.length, 'events');
        if (calendarPayload.length > 0) {
          setCalendarData(calendarPayload);
          const stats = getDayOrderStats(calendarPayload);
          setDayOrderStats(stats);
          setClientCache('calendar', calendarPayload);
        }

        // Extract timetable data for slot occurrences
        const timetableCandidate = requireApiField('timetable', (result.data as { timetable?: unknown })?.timetable);
        const normalizeTimetablePayload = (payload: unknown): TimetableData | null => {
          if (!payload) return null;
          if (typeof payload !== 'object' || Array.isArray(payload)) {
            return null;
          }

          let candidate = payload as Record<string, unknown>;
          if ('data' in candidate && typeof candidate.data === 'object' && candidate.data !== null) {
            candidate = candidate.data as Record<string, unknown>;
          }

          if ('schedule' in candidate && Array.isArray(candidate.schedule)) {
            return transformGoBackendTimetableToOldFormat(candidate);
          }

          if ('timetable' in candidate || 'time_slots' in candidate) {
            return candidate as unknown as TimetableData;
          }

          return null;
        };

        const timetablePayload = normalizeTimetablePayload(timetableCandidate);
        if (!timetablePayload) {
          throw new Error('Timetable payload invalid after normalization');
        }
        console.log('[Attendance] ✅ Timetable data loaded from API payload');
        if (timetablePayload) {
          setClientCache('timetable', timetablePayload);
          const occurrences = getSlotOccurrences(timetablePayload);
          if (occurrences.length > 0) {
            setSlotOccurrences(occurrences);
          }
        }

        console.log('[Attendance] Attendance rendered from normalized cache; skipping raw payload analysis.');
        if (result.success) {
          registerAttendanceFetch();
        }
      } else {
        console.log('[Attendance] ✅ Skipping unified fetch – cache and derived data are fresh');
      }

    } catch (err) {
      console.error('[Attendance] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const calculatePresentHours = (conducted: string, absent: string): number => {
    const conductedNum = parseInt(conducted) || 0;
    const absentNum = parseInt(absent) || 0;
    return conductedNum - absentNum;
  };

  const getAttendancePercentage = (attendanceStr: string): number => {
    const match = attendanceStr.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : 0;
  };

  const createPieChartData = (subject: AttendanceSubject) => {
    const conducted = parseInt(subject.hours_conducted) || 0;
    const absent = parseInt(subject.hours_absent) || 0;
    const present = conducted - absent;

    return [
      { name: 'Present', value: present, color: '#10B981' },
      { name: 'Absent', value: absent, color: '#EF4444' }
    ];
  };

  const calculateRequiredMargin = (subject: AttendanceSubject) => {
    const conducted = parseInt(subject.hours_conducted) || 0;
    const absent = parseInt(subject.hours_absent) || 0;
    const present = conducted - absent;
    const currentAttendance = conducted > 0 ? (present / conducted) * 100 : 0;

    if (currentAttendance >= 75) {
      // Calculate how many hours can be missed while staying above 75%
      let tempConducted = conducted;
      let tempAbsent = absent;
      let margin = 0;

      while (tempConducted > 0 && ((tempConducted - tempAbsent) / tempConducted) * 100 >= 75) {
        tempConducted += 1;
        tempAbsent += 1;
        margin += 1;
      }

      return {
        type: 'margin',
        value: margin - 1, // Subtract 1 because the last iteration would go below 75%
        text: `${margin - 1}`
      };
    } else {
      // Calculate how many more hours need to be attended to reach 75%
      let tempConducted = conducted;
      let tempPresent = present;
      let required = 0;

      while (tempConducted > 0 && (tempPresent / tempConducted) * 100 < 75) {
        tempConducted += 1;
        tempPresent += 1;
        required += 1;
      }

      return {
        type: 'required',
        value: required,
        text: ` ${required}`
      };
    }
  };

  // Calculate predicted margin: simply subtract absent hours during leave from current margin
  const getPredictedMargin = useCallback((
    subject: AttendanceSubject,
    prediction: PredictionResult,
    requiredMargin: { type: string; value: number; text: string }
  ) => {
    // Get current margin value (positive for margin, negative for required)
    const currentMarginValue = requiredMargin.type === 'margin' ? requiredMargin.value : -requiredMargin.value;

    // Get absent hours during leave period
    const absentHoursDuringLeave = prediction.absentHoursDuringLeave || 0;

    // For OD/ML mode, we might have reduction hours (absences reduced), so adjust accordingly
    let adjustment = absentHoursDuringLeave;
    if (isOdmlMode && prediction.odmlReductionHours) {
      // OD/ML reduces absences, so margin should increase
      adjustment = -prediction.odmlReductionHours;
    }

    // Calculate new margin: current margin minus absent hours
    const newMargin = currentMarginValue - adjustment;

    if (newMargin < 0) {
      // Margin went negative, now it's required hours
      return {
        type: 'required',
        value: Math.abs(newMargin),
        text: ` ${Math.abs(newMargin)} hours`
      };
    } else {
      // Still has margin
      return {
        type: 'margin',
        value: newMargin,
        text: `${newMargin} hours`
      };
    }
  }, [isOdmlMode]);

  const attendanceChipStats = useMemo(() => {
    const list = attendanceData?.all_subjects?.filter(Boolean) ?? [];
    if (!list.length) {
      return { avg: 0, below75: 0, count: 0 };
    }
    let sum = 0;
    let below = 0;
    list.forEach((sub) => {
      const prediction =
        isPredictionMode || isOdmlMode
          ? predictionResults.find(
              (p) =>
                p.subject.subject_code === sub.subject_code &&
                p.subject.category === sub.category
            )
          : null;
      const pct = prediction
        ? prediction.predictedAttendance
        : getAttendancePercentage(sub.attendance);
      sum += pct;
      if (pct < 75) {
        below++;
      }
    });
    return {
      avg: Math.round(sum / list.length),
      below75: below,
      count: list.length,
    };
  }, [attendanceData, isPredictionMode, isOdmlMode, predictionResults]);

  const sortedAttendanceSubjects = useMemo(() => {
    if (!attendanceData?.all_subjects?.length) {
      return [];
    }

    const withIndex = attendanceData.all_subjects
      .map((subject, originalIndex) => ({ subject, originalIndex }))
      .filter((item): item is { subject: AttendanceSubject; originalIndex: number } => Boolean(item.subject));

    return withIndex.sort((a, b) => {
      const aPrediction = (isPredictionMode || isOdmlMode)
        ? predictionResults.find(
            (p) =>
              p.subject.subject_code === a.subject.subject_code &&
              p.subject.category === a.subject.category
          )
        : null;
      const bPrediction = (isPredictionMode || isOdmlMode)
        ? predictionResults.find(
            (p) =>
              p.subject.subject_code === b.subject.subject_code &&
              p.subject.category === b.subject.category
          )
        : null;

      const aRequiredMargin = calculateRequiredMargin(a.subject);
      const bRequiredMargin = calculateRequiredMargin(b.subject);
      const aPredictedMargin = aPrediction ? getPredictedMargin(a.subject, aPrediction, aRequiredMargin) : null;
      const bPredictedMargin = bPrediction ? getPredictedMargin(b.subject, bPrediction, bRequiredMargin) : null;

      const aMarginMeta = aPredictedMargin ?? aRequiredMargin;
      const bMarginMeta = bPredictedMargin ?? bRequiredMargin;

      if (aMarginMeta.type !== bMarginMeta.type) {
        return aMarginMeta.type === 'required' ? -1 : 1;
      }

      if (aMarginMeta.type === 'required' && bMarginMeta.type === 'required' && aMarginMeta.value !== bMarginMeta.value) {
        return bMarginMeta.value - aMarginMeta.value;
      }

      const aPct = Math.round(aPrediction ? aPrediction.predictedAttendance : getAttendancePercentage(a.subject.attendance));
      const bPct = Math.round(bPrediction ? bPrediction.predictedAttendance : getAttendancePercentage(b.subject.attendance));
      if (aPct !== bPct) {
        return aPct - bPct;
      }

      return a.subject.course_title.localeCompare(b.subject.course_title);
    });
  }, [attendanceData, isPredictionMode, isOdmlMode, predictionResults, getPredictedMargin]);

  const subjectDisplayRows = useMemo(() => {
    return sortedAttendanceSubjects.map(({ subject, originalIndex }) => {
      const prediction = (isPredictionMode || isOdmlMode)
        ? predictionResults.find(
            (p) =>
              p.subject.subject_code === subject.subject_code &&
              p.subject.category === subject.category
          )
        : null;

      const attendancePercentage = prediction ? prediction.predictedAttendance : getAttendancePercentage(subject.attendance);
      const currentAttendance = prediction ? prediction.currentAttendance : getAttendancePercentage(subject.attendance);
      const requiredMargin = calculateRequiredMargin(subject);
      const predictedMargin = prediction ? getPredictedMargin(subject, prediction, requiredMargin) : null;
      const displayedPct = Math.round(attendancePercentage);

      const baseConducted = parseInt(String(subject.hours_conducted), 10) || 0;
      const baseAbsent = parseInt(String(subject.hours_absent), 10) || 0;
      const basePresent = Math.max(0, baseConducted - baseAbsent);

      const displayConducted = prediction
        ? (isOdmlMode ? baseConducted : baseConducted + prediction.totalHoursTillEndDate)
        : baseConducted;
      const displayAbsent = prediction
        ? (isOdmlMode ? prediction.absentHoursDuringLeave : baseAbsent + prediction.absentHoursDuringLeave)
        : baseAbsent;
      const displayPresent = prediction
        ? (isOdmlMode
            ? prediction.presentHoursTillStartDate
            : (baseConducted + prediction.totalHoursTillEndDate) - (baseAbsent + prediction.absentHoursDuringLeave))
        : basePresent;

      const marginLabel = predictedMargin
        ? (predictedMargin.type === "required" ? "Required" : "Margin")
        : (requiredMargin.type === "required" ? "Required" : "Margin");
      const marginValue = predictedMargin ? predictedMargin.value : requiredMargin.value;
      const marginValueClass = (predictedMargin ? predictedMargin.type : requiredMargin.type) === "required"
        ? "text-red-500"
        : "text-green-500";

      return {
        subject,
        originalIndex,
        prediction,
        displayedPct,
        currentAttendance,
        displayPresent,
        displayAbsent,
        displayConducted,
        marginLabel,
        marginValue,
        marginValueClass,
      };
    });
  }, [sortedAttendanceSubjects, isPredictionMode, isOdmlMode, predictionResults, getPredictedMargin]);

  const criticalSubjectRows = useMemo(
    () => subjectDisplayRows.filter((row) => row.marginLabel === "Required" && row.marginValue > 0),
    [subjectDisplayRows]
  );
  const nonCriticalSubjectRows = useMemo(
    () => subjectDisplayRows.filter((row) => !(row.marginLabel === "Required" && row.marginValue > 0)),
    [subjectDisplayRows]
  );

  const renderListSubjectCard = ({
    subject,
    originalIndex,
    displayedPct,
    displayPresent,
    displayAbsent,
    displayConducted,
    marginLabel,
    marginValue,
    marginValueClass,
  }: (typeof subjectDisplayRows)[number]): React.ReactNode => (
    <GlassCard
      key={`${subject.subject_code}-${originalIndex}`}
      subjectCategory={subject.category}
      className="w-full p-4"
    >
      <button
        type="button"
        onClick={() => setDetailSubjectIndex(originalIndex)}
        className="w-full text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-sora font-semibold text-base text-sdash-text-primary leading-snug">
            {subject.course_title}
          </p>
          <p className={`font-sora text-2xl font-bold shrink-0 ${displayedPct < 75 ? "text-sdash-danger" : "text-sdash-success"}`}>
            {displayedPct}%
          </p>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-sdash-surface-1 border border-white/[0.08] px-1 py-1">
            <span
              className="inline-flex items-center rounded-full bg-sdash-surface-2 border border-white/[0.08] overflow-hidden"
              title="Present | Absent"
            >
              <span className="stat-number text-sm text-sdash-text-primary !text-green-500 px-2 py-0.5">{displayPresent}</span>
              <span className="w-px h-4 bg-white/[0.14]" />
              <span className="stat-number text-sm text-sdash-text-primary !text-red-500 px-2 py-0.5">{displayAbsent}</span>
            </span>
            <span className="stat-number text-sm text-sdash-text-primary mr-2" title="Conducted">
              {displayConducted}
            </span>
          </div>
          <p className="text-sm font-sora text-sdash-text-primary shrink-0">
            {marginLabel}: <span className={marginValueClass}>{marginValue}</span>
          </p>
        </div>
      </button>
    </GlassCard>
  );

  const renderAttendanceDetailSheet = (): React.ReactNode => {
    if (detailSubjectIndex === null || !attendanceData?.all_subjects?.[detailSubjectIndex]) {
      return null;
    }
    const subject = attendanceData.all_subjects[detailSubjectIndex];
    const prediction =
      isPredictionMode || isOdmlMode
        ? predictionResults.find(
            (p) =>
              p.subject.subject_code === subject.subject_code &&
              p.subject.category === subject.category
          )
        : null;
    const pieChartData = createPieChartData(subject);
    const attendancePercentage = prediction
      ? prediction.predictedAttendance
      : getAttendancePercentage(subject.attendance);

    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-sora font-semibold text-sdash-text-primary">{subject.course_title}</h2>
          <p className="text-md text-sdash-text-secondary mt-1">{subject.subject_code}</p>
          <p className="text-md text-sdash-text-muted font-sora mt-1">
            {subject.faculty_name} · {subject.category} · Slot {subject.slot} · Room {subject.room}
          </p>
        </div>

        <div className="relative mx-auto h-[220px] w-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieChartData || []}
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={5}
                dataKey="value"
              >
                {(pieChartData || []).map((entry, cellIndex) => (
                  <Cell key={`sheet-pie-${cellIndex}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="font-sora text-2xl font-bold text-sdash-text-primary">
                {attendancePercentage.toFixed(1)}%
              </div>
              <div className="font-sora text-xs text-sdash-text-muted">
                {prediction ? (isOdmlMode ? "OD/ML adjusted" : "Predicted") : "Attendance"}
              </div>
            </div>
          </div>
        </div>

        <GlassCard className="border border-white/[0.08] p-4">
          <p className="mb-2 font-sora text-base font-semibold text-sdash-text-primary">Hours remaining</p>
          <div className="font-sora text-xl font-bold text-sdash-accent">
            {prediction ? (
              (() => {
                const futureHours = prediction.totalHoursTillEndDate;
                const findSlotData = (
                  courseTitle: string,
                  category: string,
                  occ: SlotOccurrence[]
                ): SlotOccurrence | null => {
                  const normalizeCategory = (cat: string): string => {
                    const normalized = cat.toLowerCase().trim();
                    if (normalized.includes("lab")) return "practical";
                    if (normalized.includes("practical")) return "practical";
                    if (normalized.includes("theory")) return "theory";
                    return normalized;
                  };
                  let slotData = occ.find(
                    (occurrence) =>
                      occurrence.courseTitle.toLowerCase().trim() === courseTitle.toLowerCase().trim() &&
                      normalizeCategory(occurrence.category) === normalizeCategory(category)
                  );
                  if (!slotData) {
                    const subjectTitle = courseTitle.toLowerCase().trim();
                    const subjectCategory = normalizeCategory(category);
                    const hasBothVersions = occ.some(
                      (o) =>
                        o.courseTitle.toLowerCase().trim() === subjectTitle &&
                        normalizeCategory(o.category) !== subjectCategory
                    );
                    if (hasBothVersions) {
                      slotData = occ.find(
                        (occurrence) =>
                          occurrence.courseTitle.toLowerCase().trim() === subjectTitle &&
                          normalizeCategory(occurrence.category) === subjectCategory
                      );
                    }
                  }
                  return slotData || null;
                };
                const slotData = findSlotData(subject.course_title, subject.category, slotOccurrences);
                if (!slotData || !dayOrderStats) {
                  return <span className="text-sdash-danger">0 hours (no timetable data)</span>;
                }
                let originalRemainingHours = 0;
                if (slotData.dayOrderHours && typeof slotData.dayOrderHours === "object") {
                  Object.entries(slotData.dayOrderHours).forEach(([dayOrder, hoursPerDay]) => {
                    const doNumber = parseInt(dayOrder, 10);
                    const dayCount = dayOrderStats[doNumber] || 0;
                    originalRemainingHours += dayCount * hoursPerDay;
                  });
                }
                const newRemainingHours = originalRemainingHours - futureHours;
                if (newRemainingHours <= 0) {
                  return <span className="text-sdash-warning">0 hours (completed)</span>;
                }
                return <span>{newRemainingHours} hours</span>;
              })()
            ) : (
              <RemainingHoursDisplay
                courseTitle={subject.course_title}
                category={subject.category}
                dayOrderStats={dayOrderStats}
                slotOccurrences={slotOccurrences}
              />
            )}
          </div>
        </GlassCard>
      </div>
    );
  };


  if (loading) {
    return (
      <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col">
        <TopAppBar title="Attendance" showBack onRefresh={() => void refreshAttendanceData()} isRefreshing={loading || isRefreshing} />
        <main className="flex flex-col justify-center flex-1 gap-6 px-4 py-8">
          <div className="text-sdash-text-primary font-sora text-xl font-bold text-center">Loading attendance data...</div>
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

  if (!attendanceData) {
    return (
      <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col overflow-y-auto">
        <TopAppBar title="Attendance" showBack onRefresh={() => void refreshAttendanceData()} isRefreshing={loading || isRefreshing} />
        <main className="flex flex-col items-center flex-1 gap-8 px-4 py-8">
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="text-sdash-text-primary text-base sm:text-lg md:text-xl font-sora text-center">
              {loading ? 'Fetching fresh attendance from Supabase...' : 'No attendance data available'}
            </div>
            {!loading && (
              <div className="text-sdash-text-secondary text-sm sm:text-base font-sora text-center">
                Use the refresh button in the header to fetch attendance data
              </div>
            )}
          </div>
        </main>
        <PillNav />
      </div>
    );
  }

  // Debug logging
  console.log('[Attendance] Component render state:', {
    slotOccurrencesCount: slotOccurrences.length,
    dayOrderStats: dayOrderStats,
    attendanceDataCount: attendanceData?.all_subjects?.length || 0,
    hasPrediction: predictionResults.length > 0
  });

  return (
    <div className="min-h-screen bg-sdash-bg pb-28 flex flex-col justify-start overflow-y-auto">
      <TopAppBar title="Attendance" showBack onRefresh={() => void refreshAttendanceData()} isRefreshing={loading || isRefreshing} />

      <main className="w-full max-w-lg mx-auto flex flex-col py-3 px-4">
      {/* View switch + summary chips */}
      <div className="flex items-center justify-between gap-3 -mx-4 px-4">
        <div className="flex gap-3 overflow-x-auto hide-scrollbar">
          <StatChip>
            <span className="stat-number text-[13px] text-red-500">{attendanceChipStats.below75}</span>
            <span className="text-[13px] text-sdash-text-secondary whitespace-nowrap">below 75%</span>
          </StatChip>
        </div>
        <div className="inline-flex items-center rounded-[8px] border border-white/[0.12] bg-sdash-surface-1 p-1">
          <button
            type="button"
            onClick={() => setAttendanceViewMode('cards')}
            className={`rounded-[5px] px-3 py-1.5 text-sm font-sora transition-colors ${              attendanceViewMode === 'cards'
                ? 'bg-sdash-accent text-sdash-text-primary'
                : 'text-sdash-text-secondary'
            }`}
          >
            Cards
          </button>
          <button
            type="button"
            onClick={() => setAttendanceViewMode('list')}
            className={`rounded-[5px] px-3 py-1.5 text-sm font-sora transition-colors ${
              attendanceViewMode === 'list'
                ? 'bg-sdash-accent text-sdash-text-primary'
                : 'text-sdash-text-secondary'
            }`}
          >
            List
          </button>
        </div>
      </div>

      {/* ODML Banner */}
      {savedOdmlRecords.length > 0 && (
        <GlassCard className="w-full border border-sdash-success/30 bg-sdash-success/5 p-4 sm:p-5 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-row gap-2">
            <div className="text-white font-sora text-xs md:text-lg lg:text-lg font-normal lg:font-bold">
              {showOdmlApplied ? 'Attendance shown with OD/ML applied' : 'Showing attendance without OD/ML'}
            </div>
            {savedOdmlRecords.length > 0 && (
              <button
                onClick={handleActivateOdmlPrediction}
                className="bg-white/20 border w-1/2 lg:w-1/4 border-white/40 text-white font-sora px-3 py-2 sm:px-4 sm:py-2.5 md:px-5 md:py-2.5 lg:px-6 lg:py-3 rounded-2xl transition-colors duration-200 text-xs sm:text-sm md:text-base lg:text-base"
              >
                Use saved OD/ML
              </button>
            )}
            </div>
            <div className="text-green-300/80 font-sora text-xs md:text-lg lg:text-[15px] lg:font-normal font-thin">
              {savedOdmlRecords.length} OD/ML period{savedOdmlRecords.length !== 1 ? 's' : ''} saved
            </div>
          </div>
          <details className="bg-white/5 border border-white/20 rounded-2xl p-3 text-sm text-white/80 font-sora">
            <summary className="cursor-pointer font-semibold text-xs md:text-lg lg:text-lg">
              OD/ML Records ({savedOdmlRecords.length})
            </summary>
            <div className="mt-3 flex flex-col gap-2 max-h-48 overflow-y-auto">
              {savedOdmlRecords.map(record => (
                <div
                  key={record.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-black/20 border border-white/10 px-3 py-2 text-[11px] sm:text-xs"
                >
                  <div>
                    <div className="font-sora text-white">
                      {formatOdmlDate(record.period_from)} → {formatOdmlDate(record.period_to)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteOdmlRecord(record.id)}
                    disabled={deletingRecordId === record.id}
                    className="flex-shrink-0 rounded-xl bg-red-500/80 hover:bg-red-600 disabled:bg-red-500/40 transition-colors px-3 py-1 text-[10px] uppercase tracking-[0.2em]"
                  >
                    {deletingRecordId === record.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              ))}
            </div>
          </details>
        </GlassCard>
      )}

      {/* Subject cards — swipeable glass (compass-style); full stats in BottomSheet */}
      <div className="w-full mt-3 flex flex-col items-stretch">
        {attendanceData && attendanceData.all_subjects && Array.isArray(attendanceData.all_subjects) && attendanceData.all_subjects.length > 0 ? (
          attendanceViewMode === 'cards' ? (
            <SwipeableCards>
              {subjectDisplayRows.map(
                ({
                  subject,
                  originalIndex,
                  prediction,
                  displayedPct,
                  currentAttendance,
                  displayPresent,
                  displayAbsent,
                  displayConducted,
                  marginLabel,
                  marginValue,
                  marginValueClass,
                }) => (
                  <GlassCard
                    key={`${subject.subject_code}-${originalIndex}`}
                    subjectCategory={subject.category}
                    className="p-3 flex flex-col gap-4 w-full"
                  >
                    <div>
                      <p className="font-sora font-semibold text-lg text-sdash-text-primary leading-snug">
                        {subject.course_title}
                      </p>
                      <p className="text-md text-sdash-text-secondary mt-1">{subject.subject_code}</p>
                      <p className="text-md text-sdash-text-muted mt-1 font-sora">
                        {subject.faculty_name} · {subject.category} · Slot {subject.slot} · Room {subject.room}
                      </p>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className={`display-stat ${displayedPct < 75 ? "text-sdash-danger" : "text-sdash-success"}`}>
                        {displayedPct}%
                      </span>
                    </div>
                    {prediction && (
                      <p className="text-xl font-sora text-sdash-text-primary shrink-0">
                        Current: {Math.round(currentAttendance)}%
                      </p>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-full bg-sdash-surface-1 border border-white/[0.08] px-1 py-1">
                        <span
                          className="inline-flex items-center rounded-full bg-sdash-surface-2 border border-white/[0.08] overflow-hidden"
                          title="Present | Absent"
                        >
                          <span className="stat-number text-md text-sdash-text-primary !text-green-500 px-2 py-0.5">{displayPresent}</span>
                          <span className="w-px h-4 bg-white/[0.14]" />
                          <span className="stat-number text-md text-sdash-text-primary !text-red-500 px-2 py-0.5">{displayAbsent}</span>
                        </span>
                        <span className="stat-number text-md text-sdash-text-primary mr-2" title="Conducted">
                          {displayConducted}
                        </span>
                      </div>
                      <p className="text-xl font-sora text-sdash-text-primary shrink-0">
                        {marginLabel}: <span className={marginValueClass}>{marginValue}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDetailSubjectIndex(originalIndex)}
                      className="w-full rounded-full border border-white/[0.12] bg-sdash-surface-1 py-2.5 text-sm font-sora text-sdash-text-primary touch-target"
                    >
                      Full details
                    </button>
                  </GlassCard>
                )
              )}
            </SwipeableCards>
          ) : (
            <div className="flex flex-col gap-3">
              {criticalSubjectRows.length > 0 && (
                <div className="rounded-2xl border-2 border-dashed border-red-500/30 bg-transparent p-2">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-500 text-lg font-bold text-red-500">
                      !
                    </span>
                    <p className="font-sora text-md font-semibold uppercase tracking-wide text-red-500">
                      Critical subjects
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    {criticalSubjectRows.map((row) => renderListSubjectCard(row))}
                  </div>
                </div>
              )}
              {nonCriticalSubjectRows.map((row) => renderListSubjectCard(row))}
            </div>
          )
        ) : (
          <GlassCard className="w-full p-2 text-center">
            <p className="text-sm text-sdash-text-secondary font-sora">
              No attendance data available. Refresh from the header to fetch your attendance.
            </p>
          </GlassCard>
        )}
      </div>

      <BottomSheet open={detailSubjectIndex !== null} onClose={() => setDetailSubjectIndex(null)}>
        {renderAttendanceDetailSheet()}
      </BottomSheet>

      {/* Attendance Prediction Modal */}
      {attendanceData && (
        <AttendancePredictionModal
          attendanceData={attendanceData}
          slotOccurrences={slotOccurrences}
          calendarData={calendarData}
          isOpen={showPredictionModal}
          onClose={() => setShowPredictionModal(false)}
          onCalculate={handlePredictionCalculate}
          leavePeriods={leavePeriods}
          setLeavePeriods={setLeavePeriods}
          isCalculating={isCalculating}
        />
      )}

      {/* OD/ML Modal */}
      {attendanceData && (
        <ODMLModal
          attendanceData={attendanceData}
          slotOccurrences={slotOccurrences}
          calendarData={calendarData}
          isOpen={showODMLModal}
          onClose={() => setShowODMLModal(false)}
          onCalculate={handleODMLCalculate}
          odmlPeriods={odmlPeriods}
          setOdmlPeriods={setOdmlPeriods}
          isCalculating={isCalculating}
          savedOdmlRecords={savedOdmlRecords}
          onDeleteSaved={async (recordId: string) => {
            const access_token = getStorageItem('access_token');
            if (access_token) {
              await deleteOdmlRecord(access_token, recordId);
              const savedRecords = await fetchOdmlRecords(access_token);
              setSavedOdmlRecords(savedRecords);
              // Re-apply if showing with ODML
              if (showOdmlApplied && savedRecords.length > 0 && originalAttendanceData) {
                applySavedOdml(savedRecords);
              } else if (showOdmlApplied && savedRecords.length === 0 && originalAttendanceData) {
                // No more saved records, show without ODML
                setAttendanceData(originalAttendanceData);
                setPredictionResults([]);
                setIsOdmlMode(false);
              }
            }
          }}
          onRefreshSaved={async () => {
            const access_token = getStorageItem('access_token');
            if (access_token) {
              const savedRecords = await fetchOdmlRecords(access_token);
              setSavedOdmlRecords(savedRecords);
            }
          }}
        />
      )}


      </main>

      <PillNav />

      {/* Re-auth Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-sdash-surface-1 border border-white/[0.08] rounded-[20px] p-8 max-w-md w-full mx-4">
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
