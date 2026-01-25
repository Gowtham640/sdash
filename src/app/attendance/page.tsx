'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { getTimetableSummary, getSlotOccurrences, getDayOrderStats, type DayOrderStats, type SlotOccurrence, type TimetableData, type CalendarEvent } from '@/lib/timetableUtils';
import { AttendancePredictionModal } from '@/components/AttendancePredictionModal';
import { ODMLModal } from '@/components/ODMLModal';
import { calculatePredictedAttendance, calculateODMLAdjustedAttendance, calculateSubjectHoursInDateRange, getDayOrderStatsForDateRange, type PredictionResult, type LeavePeriod } from '@/lib/attendancePrediction';
import { markSaturdaysAsHolidays } from '@/lib/calendarHolidays';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { DateRange } from 'react-day-picker';
import ShinyText from '../../components/ShinyText';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";
import { getRandomFact } from "@/lib/randomFacts";
import { setStorageItem, getStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import NavigationButton from "@/components/NavigationButton";
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
import Particles from '@/components/Particles';

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
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(initialAttendanceCache.attendanceData);
  const [loading, setLoading] = useState(!initialAttendanceCache.attendanceData);
  const [error, setError] = useState<string | null>(null);

  // Track errors
  useErrorTracking(error, '/attendance');
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
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
  const [currentFact, setCurrentFact] = useState(getRandomFact());
  const [savedOdmlRecords, setSavedOdmlRecords] = useState<OdmlRecord[]>([]);
  const [showOdmlApplied, setShowOdmlApplied] = useState(true); // Toggle to show with/without ODML
  const [originalAttendanceData, setOriginalAttendanceData] = useState<AttendanceData | null>(initialAttendanceCache.attendanceData); // Store original data
  // Refs to prevent duplicate button clicks
  const isOpeningPredictionModal = useRef(false);
  const isOpeningOdmlModal = useRef(false);
  const applyAttendanceDataPayload = (payload: AttendanceData, options?: { expiresAt?: string | null }) => {
    setAttendanceData(payload);
    setOriginalAttendanceData(payload);
    setSemester(payload.metadata?.semester || 1);
    setClientCache('attendance', payload, { expiresAt: options?.expiresAt ?? null });
  };

  const fetchAttendanceDataFromSupabase = async (
    access_token: string,
    options: { maxRetries?: number; retryDelayMs?: number } = {}
  ): Promise<{ data: AttendanceData | null; isExpired: boolean; expiresAt: string | null }> => {
    const { maxRetries = 1, retryDelayMs = 0 } = options;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await trackPostRequest('/api/data/cache', {
          action: 'cache_fetch',
          dataType: 'attendance',
          primary: false,
          payload: { access_token, data_type: 'attendance' },
          omitPayloadKeys: ['access_token'],
        });

        if (!response.ok) {
          console.warn('[Attendance] Supabase cache request failed:', response.status, response.statusText);
        } else {
          const cacheResult = await response.json();

          if (cacheResult.success && cacheResult.data) {
            const normalized = normalizeAttendanceData(cacheResult.data);
            if (normalized) {
              return {
                data: normalized,
                isExpired: !!cacheResult.isExpired,
                expiresAt: cacheResult.expiresAt ?? null,
              };
            }
          }
        }
      } catch (error) {
        console.error('[Attendance] ❌ Error fetching attendance cache from Supabase:', error);
      }

      if (attempt < maxRetries && retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    return { data: null, isExpired: false, expiresAt: null };
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
    fetchUnifiedData();
  }, []);

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

        if (savedRecords.length > 0 && showOdmlApplied) {
          applySavedOdml(savedRecords);
        } else if (savedRecords.length === 0 && showOdmlApplied && isOdmlMode) {
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
    if (!attendanceData || !originalAttendanceData) {
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

        return {
          ...subject,
          hours_absent: adjustedAbsent.toString(),
          attendance: adjustedAttendance.toFixed(2),
          attendance_percentage: adjustedAttendance.toFixed(2)
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

      return {
        subject,
        currentAttendance,
        predictedAttendance: adjustedAttendance,
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

    const interval = setInterval(() => {
      setCurrentFact(getRandomFact());
    }, 8000);

    return () => clearInterval(interval);
  }, [loading]);

  // Use ref to prevent duplicate calls
  const isCalculatingRef = useRef(false);

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
    setIsPredictionMode(false);
    setIsOdmlMode(false);
    setPredictionResults([]);
    setLeavePeriods([]);
    setOdmlPeriods([]);
    // Restore original attendance data
    if (originalAttendanceData) {
      setAttendanceData(originalAttendanceData);
    }
  };

  // Toggle ODML view
  const toggleOdmlView = () => {
    const newShowOdmlApplied = !showOdmlApplied;
    setShowOdmlApplied(newShowOdmlApplied);

    if (newShowOdmlApplied) {
      // Show with ODML
      if (savedOdmlRecords.length > 0 && originalAttendanceData) {
        applySavedOdml(savedOdmlRecords);
      }
    } else {
      // Show without ODML
      if (originalAttendanceData) {
        setAttendanceData(originalAttendanceData);
        setPredictionResults([]);
        setIsOdmlMode(false);
      }
    }
  };

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
  };

  const refreshAttendanceData = async () => {
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

      const supabaseCache = await fetchAttendanceDataFromSupabase(access_token, { maxRetries: 5, retryDelayMs: 700 });

      if (supabaseCache.data) {
        applyAttendanceDataPayload(supabaseCache.data, { expiresAt: supabaseCache.expiresAt });
        console.log('[Attendance] ✅ Updated local state with refreshed attendance data from Supabase');
      } else {
        const fallbackNormalized = result.data ? normalizeAttendanceData(result.data) : null;
        if (fallbackNormalized) {
          applyAttendanceDataPayload(fallbackNormalized);
          console.log('[Attendance] ✅ Applied fallback refresh data (supabase cache empty but backend returned payload)');
        } else {
          console.warn('[Attendance] ⚠️ No attendance data available after refresh');
          setError('No attendance data available');
          setLoading(false);
          setIsRefreshing(false);
          return;
        }
      }

      setLoading(false);
      setIsRefreshing(false);
      return;
    } catch (err) {
      console.error('[Attendance] Error refreshing data:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh attendance data');
      setLoading(false);
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

      // Check client-side cache first (unless force refresh)
      let cachedAttendance: AttendanceData | null = null;
      let needsBackgroundRefresh = false;

      if (!forceRefresh) {
        cachedAttendance = getClientCache<AttendanceData>('attendance');

        // If client cache is expired, fetch Supabase cache (even if expired)
        if (!cachedAttendance) {
          console.log('[Attendance] 🔍 Client cache expired/missing, fetching Supabase cache (even if expired)...');
          const supabaseCache = await fetchAttendanceDataFromSupabase(access_token);
          if (supabaseCache.data) {
            console.log(`[Attendance] ✅ Found Supabase cache (expired: ${supabaseCache.isExpired})`);
            cachedAttendance = supabaseCache.data;
            applyAttendanceDataPayload(supabaseCache.data, { expiresAt: supabaseCache.expiresAt });
            if (supabaseCache.isExpired) {
              needsBackgroundRefresh = true;
              console.log('[Attendance] ⚠️ Cache is expired, will refresh in background');
            }
          } else {
            console.warn('[Attendance] ⚠️ Supabase cache could not be normalized or is unavailable');
          }
        } else {
          // Use client-side cached data
          console.log('[Attendance] ✅ Using client-side cache for attendance');
          setAttendanceData(cachedAttendance);
          setOriginalAttendanceData(cachedAttendance);
          setSemester(cachedAttendance.metadata?.semester || 1);
        }
      } else {
        // Force refresh: clear client cache
        removeClientCache('attendance');
        console.log('[Attendance] 🗑️ Cleared client cache for force refresh');
      }

      hydrateCalendarAndTimetableFromCache();

      // Only fetch if cache is missing or force refresh or expired
      if (!cachedAttendance || forceRefresh || needsBackgroundRefresh) {
        console.log('[Attendance] Fetching from API...', forceRefresh ? '(force refresh)' : '(fetching fresh data)');

        // Use request deduplication - ensures only ONE page calls backend at a time
        const requestKey = `fetch_unified_all_${access_token.substring(0, 10)}`;
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
          throw new Error(result.error || 'Failed to fetch data');
        }

        // Process attendance data from unified endpoint
        // Unified endpoint returns: { success: boolean, data: { attendance: AttendanceData, ... }, error?: string }
        let attendanceDataObj: AttendanceData | null = null;
        let extractedSemester: number = 1;

        console.log('[Attendance] Processing attendance data from API response');
        console.log('[Attendance] result.data type:', typeof result.data);
        console.log('[Attendance] result.data keys:', result.data ? Object.keys(result.data) : 'null/undefined');

        // Extract calendar data for day order stats
        const calendarCandidate = (result.data as { calendar?: unknown })?.calendar;
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
        if (calendarPayload && calendarPayload.length > 0) {
          setCalendarData(calendarPayload);
          const stats = getDayOrderStats(calendarPayload);
          setDayOrderStats(stats);
          setClientCache('calendar', calendarPayload);
        }

        // Extract timetable data for slot occurrences
        const timetableCandidate = (result.data as { timetable?: unknown })?.timetable;
        const normalizeTimetablePayload = (payload: unknown): TimetableData | null => {
          if (!payload) return null;
          if (typeof payload !== 'object' || Array.isArray(payload)) {
            return null;
          }
          if ('data' in (payload as { data?: unknown }) && typeof (payload as { data?: unknown }).data === 'object' && (payload as { data?: TimetableData }).data) {
            return (payload as { data?: TimetableData }).data || null;
          }
          return payload as TimetableData;
        };

        const timetablePayload = normalizeTimetablePayload(timetableCandidate);
        if (timetablePayload) {
          setClientCache('timetable', timetablePayload);
          const occurrences = getSlotOccurrences(timetablePayload);
          if (occurrences.length > 0) {
            setSlotOccurrences(occurrences);
          }
        }

        // Extract attendance from unified response: { data: { attendance: AttendanceData, ... } }
        if (result.data && typeof result.data === 'object' && 'attendance' in result.data) {
          const attendanceData = (result.data as { attendance?: unknown }).attendance;

          if (attendanceData && typeof attendanceData === 'object') {
            // Handle both unwrapped and wrapped data structures within attendance
            let dataToProcess = attendanceData;

            // Check if data is wrapped in an extra 'data' property (legacy format)
            if ('data' in dataToProcess && typeof (dataToProcess as { data: unknown }).data === 'object') {
              console.log('[Attendance] 🔄 Unwrapping nested data structure in frontend');
              dataToProcess = (dataToProcess as { data: unknown }).data as typeof attendanceData;
            }

            const normalizedAttendance = normalizeAttendanceData(dataToProcess);
            if (normalizedAttendance) {
              attendanceDataObj = normalizedAttendance;
              extractedSemester = normalizedAttendance.metadata?.semester || extractedSemester;
              console.log('[Attendance] ✅ Attendance data loaded via transformer');
              console.log('[Attendance]   - all_subjects count:', attendanceDataObj.all_subjects?.length || 0);
              console.log('[Attendance]   - summary exists:', !!attendanceDataObj.summary);
            } else if ('all_subjects' in dataToProcess || 'summary' in dataToProcess) {
              attendanceDataObj = dataToProcess as AttendanceData;
              extractedSemester = (dataToProcess as { metadata?: { semester?: number } }).metadata?.semester || extractedSemester;
              console.log('[Attendance] ✅ Attendance data already in frontend format');
              console.log('[Attendance]   - all_subjects count:', attendanceDataObj.all_subjects?.length || 0);
            } else {
              console.warn('[Attendance] ⚠️ Attendance data doesn\'t match expected format');
              console.warn('[Attendance] Available keys:', Object.keys(dataToProcess));
            }
          }
        } else {
          console.warn('[Attendance] ⚠️ result.data.attendance is not available');
          console.warn('[Attendance] result.data structure:', result.data);
        }

        if (attendanceDataObj && (attendanceDataObj.all_subjects || attendanceDataObj.summary)) {
          setAttendanceData(attendanceDataObj);
          setOriginalAttendanceData(attendanceDataObj); // Store original
          console.log('[Attendance] Loaded attendance with', attendanceDataObj.all_subjects?.length || 0, 'subjects');
          console.log('[Attendance] Extracted semester:', extractedSemester);
          setSemester(extractedSemester);

          // Save to client cache
          setClientCache('attendance', attendanceDataObj);
        } else {
          // Keep page visible even when attendance data is unavailable
          // User can use refresh button to fetch data
          console.warn('[Attendance] Attendance data unavailable - keeping page visible for refresh');
          if (result && result.data) {
            console.warn('[Attendance] Attendance data type:', typeof result.data);
            console.warn('[Attendance] Attendance data value:', result.data);
          }
          setAttendanceData(null);
          // Don't throw error, just log it so page remains visible
        }

        // Register attendance fetch for smart prefetch scheduling
        if (result.success && attendanceDataObj) {
          registerAttendanceFetch();
        }
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
  const getPredictedMargin = (
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
  };


  const toggleExpanded = (subjectCode: string) => {
    const newExpanded = new Set(expandedSubjects);
    if (newExpanded.has(subjectCode)) {
      newExpanded.delete(subjectCode);
    } else {
      newExpanded.add(subjectCode);
    }
    setExpandedSubjects(newExpanded);
  };

  if (loading) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col justify-center overflow-hidden gap-6 sm:gap-8 md:gap-9 lg:gap-9">
        <div className="text-white font-sora text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-bold justify-center items-center">Attendance</div>
        <div className="text-white font-sora text-base sm:text-lg md:text-xl lg:text-xl">Loading attendance data...</div>
        <div className="max-w-2xl px-6">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-4 text-center">
            Meanwhile, here are some interesting facts:
          </div>
          <div className="text-gray-300 text-sm sm:text-base md:text-lg lg:text-xl font-sora text-center italic">
            {currentFact}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative bg-black items-center min-h-screen flex flex-col justify-center overflow-hidden gap-6 sm:gap-8 md:gap-9 lg:gap-9">
        <div className="text-white font-sora text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-bold justify-center items-center">Attendance</div>
        <div className="text-red-400 font-sora text-base sm:text-lg md:text-xl lg:text-xl text-center px-4">{error}</div>
        <div className="flex gap-3 sm:gap-4">
          <button
            onClick={() => fetchUnifiedData()}
            className="bg-blue-500 hover:bg-blue-600 text-white font-sora px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 rounded-lg transition-colors text-sm sm:text-base"
          >
            Retry
          </button>
          {error && error.includes('session') && (
            <NavigationButton
              path="/auth"
              onClick={handleReAuthenticate}
              className="bg-orange-600 hover:bg-orange-700 text-white font-sora px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 rounded-lg transition-colors text-sm sm:text-base"
            >
              Sign In Again
            </NavigationButton>
          )}
        </div>
      </div>
    );
  }

  // Show empty state if no attendance data but no error (allows refresh button to work)
  const renderParticleLayer = () => (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <Particles
        particleColors={["#ffffff"]}
        particleCount={100}
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

  if (!attendanceData) {
    return (
      <div className="relative bg-black min-h-screen flex flex-col justify-start items-center overflow-y-auto py-8 gap-8">
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
            className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        </Link>

        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-white font-sora text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-bold">Attendance</div>
            <button
              onClick={refreshAttendanceData}
              disabled={loading}
              className="text-white hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Refresh attendance data"
              title="Refresh attendance data"
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

        <div className="flex flex-col items-center justify-center gap-4 h-full">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center">
            No attendance data available
          </div>
          <div className="text-gray-400 text-sm sm:text-base md:text-lg font-sora text-center">
            Click the refresh button above to fetch attendance data
          </div>
        </div>
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
    <div className="relative bg-black min-h-screen flex flex-col justify-start items-center overflow-y-auto py-8 gap-8">
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
          className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      </Link>

      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="text-white font-sora text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-bold">Attendance</div>
          <button
            onClick={refreshAttendanceData}
            disabled={loading}
            className="text-white hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Refresh attendance data"
            title="Refresh attendance data"
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

      {/* Prediction Controls */}
      <div className="flex gap-4 items-center">
        {!isPredictionMode && !isOdmlMode ? (
          <div className="flex gap-4 items-center">
            <button
              onClick={() => {
                // Prevent duplicate clicks
                if (isOpeningPredictionModal.current) {
                  return;
                }
                isOpeningPredictionModal.current = true;

                trackFeatureClick('predict_attendance', '/attendance');
                setShowPredictionModal(true);

                // Reset after a short delay
                setTimeout(() => {
                  isOpeningPredictionModal.current = false;
                }, 500);
              }}
              className="bg-white/10 border border-gray-400 text-white font-sora px-3 py-2 sm:px-4 sm:py-2.5 md:px-5 md:py-2.5 lg:px-6 lg:py-3 rounded-2xl transition-colors duration-200 flex items-center gap-1 sm:gap-2 text-xs sm:text-sm md:text-base lg:text-base"
            >
              <ShinyText
                text="Predict Attendance"
                disabled={false}
                speed={3}
                className="text-white"
              />
            </button>
            <button
              onClick={() => {
                // Prevent duplicate clicks
                if (isOpeningOdmlModal.current) {
                  return;
                }
                isOpeningOdmlModal.current = true;

                trackFeatureClick('predict_odml', '/attendance');
                setShowODMLModal(true);

                // Reset after a short delay
                setTimeout(() => {
                  isOpeningOdmlModal.current = false;
                }, 500);
              }}
              className="bg-white/10 border border-gray-400 text-white font-sora px-3 py-2 sm:px-4 sm:py-2.5 md:px-5 md:py-2.5 lg:px-6 lg:py-3 rounded-2xl transition-colors duration-200 flex items-center gap-1 sm:gap-2 text-xs sm:text-sm md:text-base lg:text-base"
            >
              <ShinyText
                text="Add OD/ML"
                disabled={false}
                speed={3}
                className="text-white"
              />
            </button>
          </div>
        ) : (
          <div className="flex gap-4 items-center">
            <div className="text-white font-sora px-3 py-1.5 sm:px-4 sm:py-2 md:px-4 md:py-2 lg:px-4 lg:py-2 bg-green-500/20 border border-green-500/50 rounded-2xl text-xs sm:text-sm md:text-base lg:text-base">
              <ShinyText
                text={isPredictionMode ? 'Prediction Mode Active' : 'OD/ML Mode Active'}
                disabled={false}
                speed={3}
                className="text-white"
              />
            </div>
            <button
              onClick={handleCancelPrediction}
              className="bg-red-600 hover:bg-red-700 text-white font-sora px-4 py-1.5 sm:px-5 sm:py-2 md:px-6 md:py-2 lg:px-6 lg:py-2 rounded-2xl transition-colors duration-200 flex items-center gap-1 sm:gap-2 text-xs sm:text-sm md:text-base lg:text-base"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* ODML Banner */}
      {savedOdmlRecords.length > 0 && (
        <div className="w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw] bg-green-500/20 border border-green-500/50 rounded-3xl p-4 sm:p-5 md:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📋</span>
            <div className="flex flex-col">
              <div className="text-white font-sora text-base sm:text-lg md:text-xl font-bold">
                {showOdmlApplied ? 'Attendance shown with OD/ML applied' : 'Showing attendance without OD/ML'}
              </div>
              <div className="text-green-300/80 font-sora text-xs sm:text-sm mt-1">
                {savedOdmlRecords.length} OD/ML period{savedOdmlRecords.length !== 1 ? 's' : ''} saved
              </div>
            </div>
          </div>
          <button
            onClick={toggleOdmlView}
            className="bg-white/10 hover:bg-white/20 border border-white/30 text-white font-sora px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 rounded-2xl transition-all duration-200 text-sm sm:text-base"
          >
            {showOdmlApplied ? 'Show without OD/ML' : 'Show with OD/ML'}
          </button>
        </div>
      )}

      {/* Individual Subject Cards */}
      <div className="flex flex-col gap-4 sm:gap-5 md:gap-6 lg:gap-6 w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw] items-center">
        {attendanceData && attendanceData.all_subjects && Array.isArray(attendanceData.all_subjects) && attendanceData.all_subjects.length > 0 ? (
          attendanceData.all_subjects.map((subject, index) => {
            if (!subject) return null; // Skip null subjects
            // Get prediction data if in prediction mode or OD/ML mode
            const prediction = (isPredictionMode || isOdmlMode) ? predictionResults.find(p =>
              p.subject.subject_code === subject.subject_code &&
              p.subject.category === subject.category
            ) : null;

            const pieChartData = createPieChartData(subject);
            const attendancePercentage = prediction ? prediction.predictedAttendance : getAttendancePercentage(subject.attendance);
            const currentAttendance = prediction ? prediction.currentAttendance : getAttendancePercentage(subject.attendance);
            const requiredMargin = calculateRequiredMargin(subject);
            const predictedMargin = prediction ? getPredictedMargin(subject, prediction, requiredMargin) : null;
            const isExpanded = expandedSubjects.has(subject.subject_code);

            // Debug: Log attendance subject data
            console.log(`[Attendance] Subject: ${subject.course_title} (${subject.category})`);

            // Debug: Log prediction matching
            if (prediction) {
              console.log(`[DEBUG] Found prediction for ${subject.course_title} (${subject.category}):`, {
                predictedAttendance: prediction.predictedAttendance,
                totalHoursTillEndDate: prediction.totalHoursTillEndDate,
                absentHoursDuringLeave: prediction.absentHoursDuringLeave
              });
            } else if (isPredictionMode || isOdmlMode) {
              console.warn(`[DEBUG] No prediction found for ${subject.course_title} (${subject.category})`);
            }

            return (
              <div key={`${subject.subject_code}-${index}`} className="w-[95vw] sm:w-[90vw] md:w-[75vw] lg:w-[60vw] bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-lg lg:text-lg font-sora overflow-hidden flex flex-col">
                {/* Main Card Content */}
                <div
                  className="flex flex-row flex-wrap items-center justify-between p-3 sm:p-4 md:p-5 lg:p-6 gap-4 min-h-[300px]"
                >
                  {/* Left Side - Subject Info (data block for each subject) */}
                  <div className="flex flex-col justify-start items-start gap-4 flex-1 w-full sm:w-auto">
                    <div>
                      <div className="text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold max-w-[400px] leading-tight">
                        {subject.course_title}
                      </div>
                      <div className="text-gray-400 text-xs sm:text-sm font-sora mt-1">
                        {subject.subject_code}
                      </div>
                      <div className="text-gray-500 text-xs sm:text-sm font-sora">
                        {subject.faculty_name}
                      </div>
                      <div className="text-gray-600 text-[10px] sm:text-xs font-sora mt-1">
                        {subject.category} • Slot: {subject.slot} • Room: {subject.room}
                      </div>
                    </div>
                    <div className="flex flex-col justify-center items-start gap-3">
                      <div className="bg-white/10 border w-full sm:w-[200px] border-white/20 rounded-3xl text-white text-xs sm:text-sm font-sora p-2 sm:p-3">
                        <span className="text-blue-400 text-xs sm:text-sm font-sora">Total: </span>
                        {prediction ?
                          (isOdmlMode ?
                            `${subject.hours_conducted} hours` : // OD/ML: total stays same
                            `${parseInt(subject.hours_conducted) + prediction.totalHoursTillEndDate} hours` // Prediction: add future hours
                          ) :
                          `${subject.hours_conducted} hours`
                        }
                        {prediction && !isOdmlMode && (
                          <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                            Current: {subject.hours_conducted} + {prediction.totalHoursTillEndDate}
                          </div>
                        )}
                        {prediction && isOdmlMode && (
                          <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                            Current: {subject.hours_conducted} (unchanged)
                          </div>
                        )}
                      </div>
                      <div className="bg-white/10 border w-full sm:w-[200px] border-white/20 rounded-3xl text-white text-xs sm:text-sm font-sora p-2 sm:p-3">
                        <span className="text-red-400 text-xs sm:text-sm font-sora">Absent: </span>
                        {prediction ?
                          (isOdmlMode ?
                            `${prediction.absentHoursDuringLeave} hours` : // OD/ML: show adjusted absent
                            `${parseInt(subject.hours_absent) + prediction.absentHoursDuringLeave} hours` // Prediction: add future absent
                          ) :
                          `${subject.hours_absent} hours`
                        }
                        {prediction && !isOdmlMode && (
                          <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                            Current: {subject.hours_absent} + {prediction.absentHoursDuringLeave}
                          </div>
                        )}
                        {prediction && isOdmlMode && (
                          <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                            Current: {subject.hours_absent} - {prediction.odmlReductionHours}
                          </div>
                        )}
                      </div>
                      <div className="bg-white/10 border w-full sm:w-[200px] border-white/20 rounded-3xl text-white text-xs sm:text-sm font-sora p-2 sm:p-3">
                        <span className="text-green-400 text-xs sm:text-sm font-sora">Present: </span>
                        {prediction ?
                          (isOdmlMode ?
                            `${prediction.presentHoursTillStartDate} hours` : // OD/ML: show adjusted present
                            `${(parseInt(subject.hours_conducted) + prediction.totalHoursTillEndDate) - (parseInt(subject.hours_absent) + prediction.absentHoursDuringLeave)} hours` // Prediction: calculate total present
                          ) :
                          `${calculatePresentHours(subject.hours_conducted, subject.hours_absent)} hours`
                        }
                        {prediction && !isOdmlMode && (
                          <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                            Current: {calculatePresentHours(subject.hours_conducted, subject.hours_absent)} + {prediction.presentHoursTillStartDate}
                          </div>
                        )}
                        {prediction && isOdmlMode && (
                          <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                            Current: {calculatePresentHours(subject.hours_conducted, subject.hours_absent)} + {prediction.odmlReductionHours}
                          </div>
                        )}
                      </div>
                      <div className={`bg-white/10 border w-full sm:w-[200px] border-white/20 rounded-3xl text-white text-sm sm:text-base md:text-lg lg:text-lg font-sora p-2 sm:p-3 ${predictedMargin ?
                        (predictedMargin.type === 'required' ? 'border-red-400/50 bg-red-500/10' : 'border-green-400/50 bg-green-500/10') :
                        (requiredMargin.type === 'required' ? 'border-red-400/50 bg-red-500/10' : 'border-green-400/50 bg-green-500/10')
                        }`}>
                        {predictedMargin ?
                          <>
                            <span className={`text-sm sm:text-base md:text-lg lg:text-lg font-semibold font-sora ${predictedMargin.type === 'required' ? 'text-red-400' : 'text-green-400'
                              }`}>
                              {predictedMargin.type === 'required' ? 'Required: ' : 'Margin: '}
                            </span>
                            {predictedMargin.text}
                            <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                              Current: {requiredMargin.text}
                            </div>
                          </> :
                          <>
                            <span className={`text-sm sm:text-base md:text-lg lg:text-lg font-semibold font-sora ${requiredMargin.type === 'required' ? 'text-red-400' : 'text-green-400'
                              }`}>
                              {requiredMargin.type === 'required' ? 'Required: ' : 'Margin: '}
                            </span>
                            {requiredMargin.text}
                          </>
                        }
                      </div>
                    </div>
                  </div>

                  {/* Right Side - Pie Chart (attendance donut visual) */}
                  <div className="flex flex-col items-center justify-center w-[170px] sm:w-[220px] md:w-[340px] lg:w-80 xl:w-80 h-[170px] sm:h-[220px] md:h-[340px] lg:h-80 xl:h-80">
                    {(() => {
                      console.log('[PIE CHART DEBUG] Subject:', subject.subject_code);
                      console.log('[PIE CHART DEBUG] pieChartData:', pieChartData);
                      console.log('[PIE CHART DEBUG] pieChartData type:', typeof pieChartData);
                      console.log('[PIE CHART DEBUG] pieChartData length:', pieChartData?.length);
                      console.log('[PIE CHART DEBUG] pieChartData values:', pieChartData?.map(e => ({ name: e.name, value: e.value, color: e.color })));
                      console.log('[PIE CHART DEBUG] hours_conducted:', subject.hours_conducted);
                      console.log('[PIE CHART DEBUG] hours_absent:', subject.hours_absent);
                      return null;
                    })()}
                    <div
                      className="relative w-full h-full flex items-center justify-center"
                      style={{ minWidth: '150px', minHeight: '150px' }}
                      ref={(el) => {
                        if (el) {
                          const rect = el.getBoundingClientRect();
                          const computed = window.getComputedStyle(el);
                          console.log('[PIE CHART DEBUG] Container actual dimensions:', {
                            width: rect.width,
                            height: rect.height,
                            clientWidth: el.clientWidth,
                            clientHeight: el.clientHeight,
                            computedWidth: computed.width,
                            computedHeight: computed.height,
                            display: computed.display,
                            position: computed.position
                          });
                        }
                      }}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        {(() => {
                          console.log('[PIE CHART DEBUG] ResponsiveContainer rendering with data:', pieChartData || []);
                          console.log('[PIE CHART DEBUG] Data sum:', pieChartData?.reduce((sum, e) => sum + (e.value || 0), 0));
                          return (
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
                                {(pieChartData || []).map((entry, index) => {
                                  console.log(`[PIE CHART DEBUG] Rendering Cell ${index}:`, entry);
                                  return <Cell key={`cell-${index}`} fill={entry.color} />;
                                })}
                              </Pie>
                            </PieChart>
                          );
                        })()}
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <div className="text-white font-sora text-md sm:text-2xl md:text-3xl lg:text-3xl font-bold">
                            {attendancePercentage.toFixed(1)}%
                          </div>
                          <div className="text-gray-400 font-sora text-[7px] sm:text-sm">
                            {prediction ? (isOdmlMode ? 'OD/ML Adjusted' : 'Predicted') : 'Attendance'}
                          </div>
                          {prediction && (
                            <div className="text-gray-500 font-sora text-[10px] sm:text-xs mt-1">
                              Current: {currentAttendance.toFixed(1)}%
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expand Button */}
                <div className="flex justify-center pb-4">
                  <button
                    onClick={() => toggleExpanded(subject.subject_code)}
                    className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg px-4 py-2 text-white font-sora text-sm transition-colors"
                  >
                    {isExpanded ? '▼ Less Details' : '▶ More Details'}
                  </button>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 sm:px-5 md:px-6 lg:px-6 pb-4 sm:pb-5 md:pb-6 lg:pb-6 border-t border-white/20 pt-3 sm:pt-4 md:pt-4 lg:pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 md:gap-6 lg:gap-6">
                      {/* Hours Remaining */}
                      <div className="bg-white/10 border border-white/20 rounded-3xl p-3 sm:p-4">
                        <div className="text-white font-sora text-base sm:text-lg font-bold mb-2 sm:mb-3">Hours Remaining</div>
                        <div className="text-blue-400 font-sora text-xl sm:text-2xl font-bold">
                          {prediction ?
                            (() => {
                              // SIMPLE CALCULATION: Calculate actual remaining hours after prediction
                              const futureHours = prediction.totalHoursTillEndDate;

                              // Calculate original remaining hours using the same logic as RemainingHoursDisplay
                              const findSlotData = (courseTitle: string, category: string, slotOccurrences: SlotOccurrence[]): SlotOccurrence | null => {
                                const normalizeCategory = (cat: string): string => {
                                  const normalized = cat.toLowerCase().trim();
                                  if (normalized.includes('lab')) return 'practical';
                                  if (normalized.includes('practical')) return 'practical';
                                  if (normalized.includes('theory')) return 'theory';
                                  return normalized;
                                };

                                let slotData = slotOccurrences.find(occurrence =>
                                  occurrence.courseTitle.toLowerCase().trim() === courseTitle.toLowerCase().trim() &&
                                  normalizeCategory(occurrence.category) === normalizeCategory(category)
                                );

                                if (!slotData) {
                                  const subjectTitle = courseTitle.toLowerCase().trim();
                                  const subjectCategory = normalizeCategory(category);

                                  const hasBothVersions = slotOccurrences.some(occ =>
                                    occ.courseTitle.toLowerCase().trim() === subjectTitle &&
                                    normalizeCategory(occ.category) !== subjectCategory
                                  );

                                  if (hasBothVersions) {
                                    slotData = slotOccurrences.find(occurrence =>
                                      occurrence.courseTitle.toLowerCase().trim() === subjectTitle &&
                                      normalizeCategory(occurrence.category) === subjectCategory
                                    );
                                  }
                                }

                                return slotData || null;
                              };

                              const slotData = findSlotData(subject.course_title, subject.category, slotOccurrences);

                              if (!slotData || !dayOrderStats) {
                                console.log(`[Attendance] Prediction - No timetable data for ${subject.course_title}`);
                                return <span className="text-red-400">0 hours (no timetable data)</span>;
                              }

                              // Calculate original remaining hours
                              let originalRemainingHours = 0;
                              if (slotData && slotData.dayOrderHours && typeof slotData.dayOrderHours === 'object') {
                                Object.entries(slotData.dayOrderHours).forEach(([dayOrder, hoursPerDay]) => {
                                  const doNumber = parseInt(dayOrder);
                                  const dayCount = dayOrderStats[doNumber] || 0;
                                  originalRemainingHours += dayCount * hoursPerDay;
                                });
                              }

                              // Calculate new remaining hours: original - future hours being added
                              const newRemainingHours = originalRemainingHours - futureHours;

                              console.log(`[Attendance] Prediction - Remaining hours calculation for ${subject.course_title}:`);
                              console.log(`[Attendance] Prediction - Original remaining: ${originalRemainingHours}`);
                              console.log(`[Attendance] Prediction - Future hours being added: ${futureHours}`);
                              console.log(`[Attendance] Prediction - New remaining: ${newRemainingHours}`);

                              if (newRemainingHours <= 0) {
                                return <span className="text-yellow-400">0 hours (completed)</span>;
                              }

                              return <span className="text-blue-400">{newRemainingHours} hours</span>;
                            })() :
                            <RemainingHoursDisplay
                              courseTitle={subject.course_title}
                              category={subject.category}
                              dayOrderStats={dayOrderStats}
                              slotOccurrences={slotOccurrences}
                            />
                          }
                        </div>

                      </div>

                      {/* Absent Days */}
                      {/*
                      <div className="bg-white/10 border border-white/20 rounded-3xl p-3 sm:p-4">
                        <div className="text-white font-sora text-base sm:text-lg font-bold mb-2 sm:mb-3">Absent Days</div>
                        <div className="text-gray-400 font-sora text-xs sm:text-sm">
                          Absent days list will be displayed here
                        </div>
                      </div>
                      */}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-white/70 text-center p-8">
            <p>No attendance data available. Please refresh to fetch your attendance.</p>
          </div>
        )}
      </div>
      {/* Summary Stats */}
      {attendanceData && attendanceData.summary ? (
        <div className="w-[95vw] sm:w-[90vw] md:w-[75vw] lg:w-[60vw] flex flex-col items-center bg-white/10 border border-white/20 rounded-3xl p-4 sm:p-5 md:p-6 lg:p-6">
          <div className="text-white font-sora text-base sm:text-lg md:text-xl lg:text-xl mb-3 sm:mb-4">
            {isPredictionMode ? 'Predicted Summary' : 'Overall Summary'}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 text-white font-sora items-center justify-center">
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 sm:p-3">
              <div className="text-blue-400 text-xs sm:text-sm">Total Subjects</div>
              <div className="text-base sm:text-lg font-bold">{attendanceData.summary.total_subjects || 0}</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 sm:p-3">
              <div className="text-green-400 text-xs sm:text-sm">
                {isPredictionMode ? 'Predicted Attendance' : 'Overall Attendance'}
              </div>
              <div className="text-lg font-bold">
                {isPredictionMode && predictionResults && predictionResults.length > 0 ?
                  `${(predictionResults.reduce((sum, p) => sum + (p?.predictedAttendance || 0), 0) / predictionResults.length).toFixed(1)}%` :
                  attendanceData.summary.overall_attendance_percentage || '0%'
                }
              </div>
              {isPredictionMode && predictionResults && predictionResults.length > 0 && (
                <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                  Current: {attendanceData.summary.overall_attendance_percentage || '0%'}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
