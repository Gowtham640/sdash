'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { getTimetableSummary, getSlotOccurrences, getDayOrderStats, type DayOrderStats, type SlotOccurrence } from '@/lib/timetableUtils';
import { AttendancePredictionModal } from '@/components/AttendancePredictionModal';
import { ODMLModal } from '@/components/ODMLModal';
import { calculatePredictedAttendance, calculateODMLAdjustedAttendance, calculateSubjectHoursInDateRange, type PredictionResult, type LeavePeriod } from '@/lib/attendancePrediction';
import { markSaturdaysAsHolidays } from '@/lib/calendarHolidays';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { DateRange } from 'react-day-picker';
import ShinyText from '../../components/ShinyText';
import { getRequestBodyWithPassword } from "@/lib/passwordStorage";

interface AttendanceSubject {
  row_number: number;
  subject_code: string;
  course_title: string;
  category: string;
  faculty_name: string;
  slot: string;
  room: string;
  hours_conducted: string;
  hours_absent: string;
  attendance: string;
  attendance_percentage: string;
}

interface AttendanceData {
  metadata: {
    generated_at: string;
    source: string;
    academic_year: string;
    institution: string;
    college: string;
    scraped_at: string;
  };
  summary: {
    total_subjects: number;
    theory_subjects: number;
    lab_subjects: number;
    other_subjects: number;
    total_hours_conducted: number;
    total_hours_absent: number;
    overall_attendance_percentage: string;
  };
  subjects: {
    theory: AttendanceSubject[];
    lab: AttendanceSubject[];
    other: AttendanceSubject[];
  };
  all_subjects: AttendanceSubject[];
}

interface AttendanceApiResponse {
  success: boolean;
  data?: AttendanceData;
  error?: string;
  count?: number;
}

interface CalendarEvent {
  date: string;
  day_name: string;
  content: string;
  day_order: string;
  month?: string;
  month_name?: string;
  year?: string;
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

export default function AttendancePage() {
  const router = useRouter();
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ cached: boolean; age: number } | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set());
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>([]);
  const [subjectRemainingHours, setSubjectRemainingHours] = useState<Array<Record<string, unknown>>>([]);
  const [showPredictionModal, setShowPredictionModal] = useState(false);
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [semester, setSemester] = useState<number>(1); // Default to semester 1
  const [predictionResults, setPredictionResults] = useState<PredictionResult[]>([]);
  const [isPredictionMode, setIsPredictionMode] = useState(false);
  const [leavePeriods, setLeavePeriods] = useState<LeavePeriod[]>([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [showODMLModal, setShowODMLModal] = useState(false);
  const [odmlPeriods, setOdmlPeriods] = useState<LeavePeriod[]>([]);
  const [isOdmlMode, setIsOdmlMode] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchUnifiedData();
  }, []);

  const handlePredictionCalculate = async (periods: LeavePeriod[]) => {
    if (!attendanceData) {
      return;
    }

    setIsCalculating(true);
    try {
      const results = calculatePredictedAttendance(
        attendanceData,
        slotOccurrences,
        calendarData,
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
    }
  };

  const handleODMLCalculate = async (periods: LeavePeriod[]) => {
    if (!attendanceData) {
      return;
    }

    setIsCalculating(true);
    try {
      const results = calculateODMLAdjustedAttendance(
        attendanceData,
        slotOccurrences,
        calendarData,
        periods
      );
      setPredictionResults(results);
      setIsOdmlMode(true);
      setIsPredictionMode(false);
      setShowODMLModal(false);
    } catch (err) {
      console.error('OD/ML calculation error:', err);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleCancelPrediction = () => {
    setIsPredictionMode(false);
    setIsOdmlMode(false);
    setPredictionResults([]);
    setLeavePeriods([]);
    setOdmlPeriods([]);
  };

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
    router.push('/auth');
  };

  const refreshInBackground = async () => {
    if (isRefreshing) {
      return; // Already refreshing
    }
    
    setIsRefreshing(true);
    console.log('[Attendance] Background refresh started');
    
    try {
      const access_token = localStorage.getItem('access_token');
      if (!access_token) {
        console.error('[Attendance] No access token for background refresh');
        return;
      }

      const response = await fetch('/api/data/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getRequestBodyWithPassword(access_token, false))
      });

      const result = await response.json();

      if (result.success) {
        const cacheKey = 'unified_data_cache';
        const cachedTimestampKey = 'unified_data_cache_timestamp';
        
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(cachedTimestampKey, Date.now().toString());
        console.log('[Attendance] ✅ Cache refreshed in background');
      } else {
        console.error('[Attendance] ❌ Background refresh failed:', result.error);
      }
    } catch (err) {
      console.error('[Attendance] Background refresh error:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      if (forceRefresh) {
        setIsRefreshing(true);
      }

      const access_token = localStorage.getItem('access_token');
      
      if (!access_token) {
        console.error('[Attendance] No access token found');
        setError('Please sign in to view attendance');
        setLoading(false);
        return;
      }

      // ✅ STEP 1: Check browser cache first (unless force refresh)
      const cacheKey = 'unified_data_cache';
      const cachedTimestampKey = 'unified_data_cache_timestamp';
      const cacheMaxAge = 10 * 60 * 1000; // 10 minutes
      const refreshTriggerAge = 9 * 60 * 1000; // 9 minutes - start background refresh
      
      if (!forceRefresh) {
        const cachedData = localStorage.getItem(cacheKey);
        const cachedTimestamp = localStorage.getItem(cachedTimestampKey);
        
        if (cachedData && cachedTimestamp) {
          const age = Date.now() - parseInt(cachedTimestamp);
          
          if (age < cacheMaxAge) {
            console.log('[Attendance] ✅ Using browser cache');
            const result = JSON.parse(cachedData);
            
              // Process the cached data (same as API response processing)
            if (result.success) {
              // Extract cache info - mark as browser cache
              setCacheInfo({
                cached: true,
                age: Math.floor((Date.now() - parseInt(cachedTimestamp)) / 1000)
              });

              // Process attendance data
              if (result.data.attendance?.success && result.data.attendance.data) {
                setAttendanceData(result.data.attendance.data);
                console.log('[Attendance] Loaded attendance with', result.data.attendance.data.all_subjects?.length, 'subjects');
                
                // Extract semester from attendance metadata
                const extractedSemester = result.data.attendance?.semester || 
                                         result.data.attendance?.data?.metadata?.semester || 
                                         1;
                console.log('[Attendance] Extracted semester from cache:', extractedSemester);
                setSemester(extractedSemester);
              } else {
                throw new Error('Attendance data unavailable');
              }

              // Process timetable data
              if (result.data.timetable?.success && result.data.timetable.data) {
                const timetableData = result.data.timetable.data;
                const calendarData = result.data.calendar?.data || [];
                
                // Handle empty timetable data gracefully
                if (timetableData && 
                    !Array.isArray(timetableData) && 
                    Object.keys(timetableData).length > 0 &&
                    timetableData.timetable &&
                    Object.keys(timetableData.timetable).length > 0) {
                  try {
                    const occurrences = getSlotOccurrences(timetableData);
                    setSlotOccurrences(occurrences);
                    
                    // Apply holiday logic from cached semester
                    const extractedSemester = result.data.attendance?.semester || 
                                             result.data.attendance?.data?.metadata?.semester || 
                                             1;
                    const modifiedCalendarData = markSaturdaysAsHolidays(calendarData, extractedSemester);
                    
                    const stats = getDayOrderStats(modifiedCalendarData);
                    setDayOrderStats(stats);
                    setCalendarData(modifiedCalendarData);
                  } catch (err) {
                    console.error('[Attendance] Error processing timetable from cache:', err);
                  }
                }
              }
              
              // Background refresh if cache is expiring soon
              const isExpiringSoon = age > refreshTriggerAge;
              if (isExpiringSoon && !isRefreshing) {
                console.log('[Attendance] ⏰ Cache expiring soon, refreshing in background...');
                refreshInBackground();
              }
              
              setLoading(false);
              return;
            }
          } else {
            console.log('[Attendance] Browser cache expired');
          }
        }
      }

      // ✅ STEP 2: Fetch from API (will use server cache if available)
      console.log('[Attendance] Fetching from API...', forceRefresh ? '(force refresh)' : '(checking server cache)');

      const response = await fetch('/api/data/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getRequestBodyWithPassword(access_token, forceRefresh))
      });

      const result = await response.json();
      console.log('[Attendance] Unified API response:', result);

      // ✅ STEP 3: Store in browser cache for next time
      if (result.success) {
        localStorage.setItem(cacheKey, JSON.stringify(result));
        localStorage.setItem(cachedTimestampKey, Date.now().toString());
        console.log('[Attendance] ✅ Stored in browser cache');
      }

      // Handle session expiry - use cached data if available
      if (!response.ok || (result.error === 'session_expired')) {
        console.error('[Attendance] Session expired - checking for cached data...');
        
        // Check if we have cached data to fall back to
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          console.log('[Attendance] Using cached data as fallback');
          const cachedResult = JSON.parse(cachedData);
          
          if (cachedResult.success) {
            setCacheInfo({ cached: true, age: 9999 }); // Mark as stale cache
            
            // Process cached attendance data
            if (cachedResult.data.attendance?.success && cachedResult.data.attendance.data) {
              setAttendanceData(cachedResult.data.attendance.data);
            }
            
            // Process cached timetable data
            if (cachedResult.data.timetable?.success && cachedResult.data.timetable.data) {
              const timetableData = cachedResult.data.timetable.data;
              const calendarData = cachedResult.data.calendar?.data || [];
              
              if (timetableData && !Array.isArray(timetableData) && Object.keys(timetableData).length > 0) {
                try {
                  setSlotOccurrences(getSlotOccurrences(timetableData));
                  
                  // Apply holiday logic from cached semester
                  const extractedSemester = cachedResult.data.attendance?.semester || 
                                           cachedResult.data.attendance?.data?.metadata?.semester || 
                                           1;
                  const modifiedCalendarData = markSaturdaysAsHolidays(calendarData, extractedSemester);
                  
                  const stats = getDayOrderStats(modifiedCalendarData);
                  setDayOrderStats(stats);
                  setCalendarData(modifiedCalendarData);
                } catch (err) {
                  console.error('[Attendance] Error processing cached data:', err);
                }
              }
            }
            
            // Show non-blocking notification instead of modal
            setError('Your session has expired, but showing cached data. Please refresh to get latest data.');
            setLoading(false);
            return;
          }
        }
        
        // No cached data available - show password modal
        console.error('[Attendance] No cached data available, prompting for re-authentication');
        setError('Your session has expired. Please re-enter your password.');
        setShowPasswordModal(true);
        setLoading(false);
        return;
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch data');
      }

      // Extract cache info
      setCacheInfo({
        cached: result.metadata?.cached || false,
        age: result.metadata?.cache_age_seconds || 0
      });

      // Process attendance data
      if (result.data.attendance?.success && result.data.attendance.data) {
        setAttendanceData(result.data.attendance.data);
        console.log('[Attendance] Loaded attendance with', result.data.attendance.data.all_subjects?.length, 'subjects');
        
        // Extract semester from attendance metadata
        const extractedSemester = result.data.attendance?.semester || 
                                 result.data.attendance?.data?.metadata?.semester || 
                                 1;
        console.log('[Attendance] Extracted semester:', extractedSemester);
        setSemester(extractedSemester);
      } else {
        throw new Error('Attendance data unavailable');
      }

      // Also process timetable data from unified endpoint
      if (result.data.timetable?.success && result.data.timetable.data) {
        try {
          const timetableData = result.data.timetable.data;
          const calendarData = result.data.calendar?.data || [];
          
          // Enhanced validation for timetable data
          console.log('[Attendance] Timetable data received:', timetableData);
          console.log('[Attendance] Timetable data type:', typeof timetableData);
          console.log('[Attendance] Timetable data keys:', Object.keys(timetableData || {}));
          
          // Handle empty timetable data gracefully
          if (!timetableData || 
              Array.isArray(timetableData) || 
              Object.keys(timetableData).length === 0 ||
              !timetableData.timetable ||
              Object.keys(timetableData.timetable).length === 0) {
            
            console.warn('[Attendance] Timetable data is empty or invalid');
            console.warn('[Attendance] This may indicate no timetable assigned or session issues');
            
            // Apply holiday logic even without timetable data
            const extractedSemester = result.data.attendance?.semester || 
                                     result.data.attendance?.data?.metadata?.semester || 
                                     1;
            const modifiedCalendarData = markSaturdaysAsHolidays(calendarData, extractedSemester);
            
            setSlotOccurrences([]);
            setDayOrderStats({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
            setCalendarData(modifiedCalendarData);
            
            // Continue processing - attendance will still work without timetable
            console.log('[Attendance] Continuing without timetable data - attendance functionality preserved');
            return;
          }
          
          // Use the PROVEN utility functions from timetableUtils (same as timetable page)
          console.log('[Attendance] Using proven utility functions for timetable processing');
          
          // Get slot occurrences using the proven function
          const occurrences = getSlotOccurrences(timetableData);
          console.log('[Attendance] Slot occurrences from getSlotOccurrences:', occurrences.map(s => ({
              courseTitle: s.courseTitle,
              category: s.category,
              slot: s.slot,
            dayOrders: s.dayOrders,
            dayOrderHours: s.dayOrderHours,
            totalOccurrences: s.totalOccurrences
            })));
          setSlotOccurrences(occurrences);
          
          // Apply holiday logic based on semester (Saturdays after 26/10, all days after 10/11)
          const extractedSemester = result.data.attendance?.semester || 
                                   result.data.attendance?.data?.metadata?.semester || 
                                   1;
          const modifiedCalendarData = markSaturdaysAsHolidays(calendarData, extractedSemester);
          console.log('[Attendance] Applied holiday logic for semester:', extractedSemester);
          
          // Get day order stats using the MODIFIED calendar data (holidays already excluded in getDayOrderStats)
          const stats = getDayOrderStats(modifiedCalendarData);
          console.log('[Attendance] Day order stats from getDayOrderStats:', stats);
          setDayOrderStats(stats);
          setCalendarData(modifiedCalendarData);
          
          console.log('[Attendance] Timetable data processed using proven functions:', {
            slotOccurrences: occurrences.length,
            dayOrderStats: stats
          });
        } catch (timetableErr) {
          console.error('[Attendance] Error processing timetable data:', timetableErr);
          // Set empty data gracefully on error
          const calendarData = result.data.calendar?.data || [];
          const extractedSemester = result.data.attendance?.semester || 
                                   result.data.attendance?.data?.metadata?.semester || 
                                   1;
          const modifiedCalendarData = markSaturdaysAsHolidays(calendarData, extractedSemester);
          
          setSlotOccurrences([]);
          setDayOrderStats({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
          setCalendarData(modifiedCalendarData);
        }
      } else {
        console.warn('[Attendance] No timetable data available from API');
        // Set empty data gracefully when no timetable data
        const calendarData = result.data.calendar?.data || [];
        const extractedSemester = result.data.attendance?.semester || 
                                 result.data.attendance?.data?.metadata?.semester || 
                                 1;
        const modifiedCalendarData = markSaturdaysAsHolidays(calendarData, extractedSemester);
        
        setSlotOccurrences([]);
        setDayOrderStats({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
        setCalendarData(modifiedCalendarData);
      }

    } catch (err) {
      console.error('[Attendance] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
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
        text:  `${margin - 1}`
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
      </div>
    );
  }

  if (error || !attendanceData) {
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
            <button 
              onClick={handleReAuthenticate}
              className="bg-orange-600 hover:bg-orange-700 text-white font-sora px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 rounded-lg transition-colors text-sm sm:text-base"
            >
              Sign In Again
            </button>
          )}
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
        <div className="text-white font-sora text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-bold">Attendance</div>
        <button
          onClick={() => fetchUnifiedData(true)}
          disabled={isRefreshing || loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base flex items-center gap-2"
          title="Refresh all data from server"
        >
          {isRefreshing ? (
            <>
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Refreshing...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh Cache
            </>
          )}
        </button>
      </div>
      
      {/* Prediction Controls */}
      <div className="flex gap-4 items-center">
        {!isPredictionMode && !isOdmlMode ? (
          <div className="flex gap-4 items-center">
              <button
                  onClick={() => setShowPredictionModal(true)}
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
                  onClick={() => setShowODMLModal(true)}
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

      {/* Individual Subject Cards */}
      <div className="flex flex-col gap-4 sm:gap-5 md:gap-6 lg:gap-6 w-[95vw] sm:w-[90vw] md:w-[85vw] lg:w-[80vw] items-center">
        {attendanceData.all_subjects.map((subject, index) => {
          // Get prediction data if in prediction mode or OD/ML mode
          const prediction = (isPredictionMode || isOdmlMode) ? predictionResults.find(p => 
            p.subject.subject_code === subject.subject_code && 
            p.subject.category === subject.category
          ) : null;
          
          const pieChartData = createPieChartData(subject);
          const attendancePercentage = prediction ? prediction.predictedAttendance : getAttendancePercentage(subject.attendance);
          const currentAttendance = prediction ? prediction.currentAttendance : getAttendancePercentage(subject.attendance);
          const requiredMargin = calculateRequiredMargin(subject);
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
              <div className="flex flex-col sm:flex-row items-center justify-between p-3 sm:p-4 md:p-5 lg:p-6 gap-4 sm:gap-4 md:gap-6 lg:gap-6 min-h-[300px]">
                {/* Left Side - Subject Info */}
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
                    <div className={`bg-white/10 border w-full sm:w-[200px] border-white/20 rounded-3xl text-white text-sm sm:text-base md:text-lg lg:text-lg font-sora p-2 sm:p-3 ${
                      prediction ? 
                        (prediction.predictedAttendance >= 75 ? 'border-green-400/50 bg-green-500/10' : 'border-red-400/50 bg-red-500/10') :
                        (requiredMargin.type === 'required' ? 'border-red-400/50 bg-red-500/10' : 'border-green-400/50 bg-green-500/10')
                    }`}>
                      <span className={`text-sm sm:text-base md:text-lg lg:text-lg font-semibold font-sora ${
                        prediction ?
                          (prediction.predictedAttendance >= 75 ? 'text-green-400' : 'text-red-400') :
                          (requiredMargin.type === 'required' ? 'text-red-400' : 'text-green-400')
                      }`}>
                        {prediction ? 
                          (prediction.predictedAttendance >= 75 ? 'Margin: ' : 'Required: ') :
                          (requiredMargin.type === 'required' ? 'Required: ' : 'Margin: ')
                        }
                      </span>
                      {prediction ? 
                        (prediction.predictedAttendance >= 75 ? 
                          (isOdmlMode ? 
                            `${Math.floor((prediction.predictedAttendance - 75) / 100 * parseInt(subject.hours_conducted))} hours` : // OD/ML: use original total
                            `${Math.floor((prediction.predictedAttendance - 75) / 100 * (parseInt(subject.hours_conducted) + prediction.totalHoursTillEndDate))} hours` // Prediction: use future total
                          ) :
                          (isOdmlMode ? 
                            `${Math.ceil((75 - prediction.predictedAttendance) / 100 * parseInt(subject.hours_conducted))} hours` : // OD/ML: use original total
                            `${Math.ceil((75 - prediction.predictedAttendance) / 100 * (parseInt(subject.hours_conducted) + prediction.totalHoursTillEndDate))} hours` // Prediction: use future total
                          )
                        ) :
                        requiredMargin.text
                      }
                      {prediction && (
                        <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                          Current: {requiredMargin.text}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Side - Pie Chart */}
                <div className="flex flex-col items-center justify-center  w-[200px] sm:w-[220px] md:w-[340px] lg:w-80 xl:w-80 h-[200px] sm:h-[220px] md:h-[340px] lg:h-80 xl:h-80">
                  {pieChartData.length > 0 ? (
                    <div className="relative w-full h-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius="55%"
                            outerRadius="85%"
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {pieChartData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <div className="text-white font-sora text-xl sm:text-2xl md:text-3xl lg:text-3xl font-bold">
                            {attendancePercentage.toFixed(1)}%
                          </div>
                          <div className="text-gray-400 font-sora text-xs sm:text-sm">
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
                  ) : (
                    <div className="text-gray-400 font-sora">No data available</div>
                  )}
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
                            Object.entries(slotData.dayOrderHours).forEach(([dayOrder, hoursPerDay]) => {
                              const doNumber = parseInt(dayOrder);
                              const dayCount = dayOrderStats[doNumber] || 0;
                              originalRemainingHours += dayCount * hoursPerDay;
                            });
                            
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
                    <div className="bg-white/10 border border-white/20 rounded-3xl p-3 sm:p-4">
                      <div className="text-white font-sora text-base sm:text-lg font-bold mb-2 sm:mb-3">Absent Days</div>
                      <div className="text-gray-400 font-sora text-xs sm:text-sm">
                        Absent days list will be displayed here
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {/* Summary Stats */}
        <div className="w-[95vw] sm:w-[90vw] md:w-[75vw] lg:w-[60vw] flex flex-col items-center bg-white/10 border border-white/20 rounded-3xl p-4 sm:p-5 md:p-6 lg:p-6">
            <div className="text-white font-sora text-base sm:text-lg md:text-xl lg:text-xl mb-3 sm:mb-4">
              {isPredictionMode ? 'Predicted Summary' : 'Overall Summary'}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 text-white font-sora items-center justify-center">
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 sm:p-3">
                <div className="text-blue-400 text-xs sm:text-sm">Total Subjects</div>
                <div className="text-base sm:text-lg font-bold">{attendanceData.summary.total_subjects}</div>
            </div>
            <div className="bg-white/10 border border-white/20 rounded-lg p-2 sm:p-3">
                <div className="text-green-400 text-xs sm:text-sm">
                  {isPredictionMode ? 'Predicted Attendance' : 'Overall Attendance'}
                </div>
                <div className="text-lg font-bold">
                  {isPredictionMode && predictionResults.length > 0 ? 
                    `${(predictionResults.reduce((sum, p) => sum + p.predictedAttendance, 0) / predictionResults.length).toFixed(1)}%` :
                    attendanceData.summary.overall_attendance_percentage
                  }
                </div>
                {isPredictionMode && predictionResults.length > 0 && (
                  <div className="text-[10px] sm:text-xs text-gray-400 mt-1">
                    Current: {attendanceData.summary.overall_attendance_percentage}
                  </div>
                )}
            </div>
          </div>
        </div>
        </div>
      
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
            <button
              onClick={handleReAuthenticate}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold"
            >
              Sign In
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
