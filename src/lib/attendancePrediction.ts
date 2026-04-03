// Attendance prediction utility functions

import {
  parseDate,
  getCurrentDateString,
  normalizeCalendarDayOrder,
  buildDayOrderLookupConsolidated,
  type CalendarEvent,
  type DayOrderStats,
  type SlotOccurrence,
} from './timetableUtils';
import { type AttendanceData, type AttendanceSubject, type LeavePeriod } from '@/lib/apiTypes';
import { fetchCalendarFromSupabase } from './calendarFetcher';

export type { AttendanceData, AttendanceSubject, LeavePeriod } from '@/lib/apiTypes';

const isDev = process.env.NODE_ENV === 'development';

export interface PredictionResult {
  subject: AttendanceSubject;
  currentAttendance: number;
  predictedAttendance: number;
  totalHoursTillEndDate: number;
  presentHoursTillStartDate: number;
  /**
   * Prediction: projected absent hours during configured leave window(s) only.
   * ODML: kept equal to odmlAdjustedTotalAbsent for legacy UI paths (prefer odmlAdjustedTotalAbsent in ODML mode).
   */
  absentHoursDuringLeave: number;
  leavePeriods: LeavePeriod[];
  leavePeriod: string;
  odmlPeriods?: LeavePeriod[];
  /** Hours credited as OD/ML (always a number; use 0 not undefined for ODML rows). */
  odmlReductionHours?: number;
  /** ODML only: total absent count after applying OD/ML credit (distinct from prediction’s future-absent slice). */
  odmlAdjustedTotalAbsent?: number;
}

// Calculate day order statistics for a custom date range
export const getDayOrderStatsForDateRange = (
  calendarData: CalendarEvent[],
  startDate: Date,
  endDate: Date
): DayOrderStats => {
  const normalizedStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const normalizedEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  // Inclusive [startDate, endDate]: count each calendar day once with correct DO (see buildDayOrderLookupConsolidated).
  const lookup = buildDayOrderLookupConsolidated(calendarData);
  const stats: DayOrderStats = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  iterateDateRange(normalizedStart, normalizedEnd, date => {
    const key = formatDateKey(date);
    const dayOrder = lookup[key];
    if (dayOrder) {
      stats[dayOrder]++;
    }
  });
  return stats;
};

// Normalize category for consistent matching - using same logic as timetable page
const normalizeCategory = (cat: string): string => {
  const normalized = cat.toLowerCase().trim();

  // Map attendance data categories to match timetable data categories
  // Attendance data uses "Lab" -> map to "Practical" to match timetable data
  if (normalized.includes('lab')) return 'practical';
  if (normalized.includes('practical')) return 'practical';
  if (normalized.includes('theory')) return 'theory';

  // Default fallback
  return normalized;
};

const clampAttendance = (value: number) => Math.max(0, Math.min(100, value));

const formatDateKey = (date: Date) => {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear().toString();
  return `${day}/${month}/${year}`;
};

const iterateDateRange = (startDate: Date, endDate: Date, callback: (date: Date) => void) => {
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const last = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  while (current <= last) {
    callback(new Date(current));
    current.setDate(current.getDate() + 1);
  }
};

// Debug function to log all data structures
export const debugDataStructures = (attendanceData: AttendanceData, slotOccurrences: SlotOccurrence[]) => {
  console.log(`[DEBUG] === ATTENDANCE DATA ===`);
  if (attendanceData && attendanceData.all_subjects && Array.isArray(attendanceData.all_subjects)) {
    attendanceData.all_subjects.forEach((subject, index) => {
      if (subject) {
        console.log(`[DEBUG] Attendance ${index}: "${subject.course_title}" (${subject.category}) -> normalized: "${normalizeCategory(subject.category)}"`);
      }
    });
  }

  console.log(`[DEBUG] === TIMETABLE SLOT OCCURRENCES ===`);
  if (slotOccurrences && Array.isArray(slotOccurrences)) {
    slotOccurrences.forEach((occurrence, index) => {
      if (occurrence) {
        console.log(`[DEBUG] Timetable ${index}: "${occurrence.courseTitle}" (${occurrence.category}) -> normalized: "${normalizeCategory(occurrence.category)}"`);
      }
    });
  }

  console.log(`[DEBUG] === CATEGORY MAPPING TEST ===`);
  const testCategories = ['Theory', 'Lab', 'Practical', 'theory', 'lab', 'practical'];
  testCategories.forEach(cat => {
    console.log(`[DEBUG] "${cat}" -> "${normalizeCategory(cat)}"`);
  });

  console.log(`[DEBUG] === MATCHING ANALYSIS ===`);
  if (attendanceData && attendanceData.all_subjects && Array.isArray(attendanceData.all_subjects)) {
    attendanceData.all_subjects.forEach(subject => {
      if (!subject || !subject.course_title) return;
      const subjectTitle = subject.course_title.toLowerCase().trim();
      const subjectCategory = normalizeCategory(subject.category);

      const exactMatches = slotOccurrences.filter(occ =>
        occ.courseTitle.toLowerCase().trim() === subjectTitle &&
        normalizeCategory(occ.category) === subjectCategory
      );

      const fuzzyMatches = slotOccurrences.filter(occ => {
        if (normalizeCategory(occ.category) !== subjectCategory) return false;
        const occurrenceTitle = occ.courseTitle.toLowerCase().trim();
        const maxLength = Math.max(subjectTitle.length, occurrenceTitle.length);
        let matchingChars = 0;
        for (let i = 0; i < Math.min(subjectTitle.length, occurrenceTitle.length); i++) {
          if (subjectTitle[i] === occurrenceTitle[i]) matchingChars++;
        }
        const overlapPercentage = (matchingChars / maxLength) * 100;
        return overlapPercentage >= 90;
      });

      console.log(`[DEBUG] "${subject.course_title}" (${subject.category}):`);
      console.log(`[DEBUG]   Exact matches: ${exactMatches.length}`, exactMatches.map(m => `"${m.courseTitle}" (${m.category})`));
      console.log(`[DEBUG]   Fuzzy matches: ${fuzzyMatches.length}`, fuzzyMatches.map(m => `"${m.courseTitle}" (${m.category})`));
    });
  }
};

// Find slot data for a subject with improved matching logic (no console noise; see calculateSubjectHoursInDateRange for dev logs)
const findSlotData = (subject: AttendanceSubject, slotOccurrences: SlotOccurrence[]): SlotOccurrence | null => {
  // Try exact match first
  let slotData = slotOccurrences.find(occurrence =>
    occurrence.courseTitle.toLowerCase().trim() === subject.course_title.toLowerCase().trim() &&
    normalizeCategory(occurrence.category) === normalizeCategory(subject.category)
  );

  if (slotData) {
    return slotData;
  }

  // For subjects that might have both Theory and Lab versions, be EXTRA strict
  const subjectTitle = subject.course_title.toLowerCase().trim();
  const subjectCategory = normalizeCategory(subject.category);

  // Check if this subject has both Theory and Lab versions
  const hasBothVersions = slotOccurrences.some(occ =>
    occ.courseTitle.toLowerCase().trim() === subjectTitle &&
    normalizeCategory(occ.category) !== subjectCategory
  );

  if (hasBothVersions) {
    // For subjects with both versions, require EXACT title match
    slotData = slotOccurrences.find(occurrence =>
      occurrence.courseTitle.toLowerCase().trim() === subjectTitle &&
      normalizeCategory(occurrence.category) === subjectCategory
    );

    if (slotData) {
      return slotData;
    }

    // If no exact match found for dual-version subject, return null to prevent wrong matches
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

    return courseTitleMatch;
  });

  return slotData || null;
};

// Calculate hours for a specific subject during a date range
export const calculateSubjectHoursInDateRange = (
  subject: AttendanceSubject,
  slotOccurrences: SlotOccurrence[],
  dayOrderStats: DayOrderStats
): number => {
  // Find the matching slot occurrence for this subject
  const slotData = findSlotData(subject, slotOccurrences);

  if (!slotData) {
    return 0;
  }

  // ODML / leave: dayOrderStats counts how many in-range calendar days fall on each DO.
  // Only DO keys present in the timetable for this subject get non-zero contribution when that DO occurs in the period.
  let totalHours = 0;
  Object.entries(slotData.dayOrderHours).forEach(([dayOrder, hoursPerDay]) => {
    const doNumber = parseInt(dayOrder, 10);
    if (Number.isNaN(doNumber) || doNumber < 1 || doNumber > 5) {
      return;
    }
    const dayCount = dayOrderStats[doNumber] || 0;
    if (dayCount === 0) {
      return;
    }
    totalHours += dayCount * hoursPerDay;
  });

  // Dev-only: log slot match + DO stats only when this subject actually has hours in the range (reduces console noise)
  if (isDev && totalHours > 0) {
    console.log(
      `[attendancePrediction] Hours in range: ${totalHours} for "${subject.course_title}" (${subject.category}) ` +
        `-> timetable "${slotData.courseTitle}" (${slotData.category}) | DO counts: ${JSON.stringify(dayOrderStats)}`
    );
  }

  return totalHours;
};

/**
 * OD/ML adjustment from portal-reported hours. Callers must pass unmodified portal snapshot (`originalAttendanceData`)
 * so repeated runs do not double-subtract absences.
 */
export const calculateODMLAdjustedAttendance = async (
  portalAttendanceData: AttendanceData,
  slotOccurrences: SlotOccurrence[],
  odmlPeriods: LeavePeriod[]
): Promise<PredictionResult[]> => {
  const results: PredictionResult[] = [];
  if (!portalAttendanceData || !portalAttendanceData.all_subjects || !Array.isArray(portalAttendanceData.all_subjects)) {
    return results;
  }

  const calendarData = await fetchCalendarFromSupabase();
  if (isDev) {
    console.log(`[attendancePrediction] ODML calendar fetched (course=Default, semester=0): ${calendarData.length} events`);
  }

  portalAttendanceData.all_subjects.forEach(subject => {
    if (!subject) return;
    const currentConducted = parseInt(subject.hours_conducted) || 0;
    const currentAbsent = parseInt(subject.hours_absent) || 0;
    const currentPresent = currentConducted - currentAbsent;
    const currentAttendance = currentConducted > 0 ? (currentPresent / currentConducted) * 100 : 0;

    let totalOdmlReductionHours = 0;
    odmlPeriods.forEach(odmlPeriod => {
      const odmlHours = calculateSubjectHoursInDateRange(
        subject,
        slotOccurrences,
        getDayOrderStatsForDateRange(calendarData, odmlPeriod.from, odmlPeriod.to)
      );
      totalOdmlReductionHours += odmlHours;
    });

    const adjustedAbsent = Math.max(0, currentAbsent - totalOdmlReductionHours);
    const adjustedPresent = currentPresent + totalOdmlReductionHours;
    const adjustedConducted = currentConducted;
    const adjustedAttendance = adjustedConducted > 0 ? (adjustedPresent / adjustedConducted) * 100 : 0;
    const clampedAttendance = clampAttendance(adjustedAttendance);

    results.push({
      subject,
      currentAttendance,
      predictedAttendance: clampedAttendance,
      totalHoursTillEndDate: 0,
      presentHoursTillStartDate: adjustedPresent,
      // Legacy field: mirror odmlAdjustedTotalAbsent so older UI still reads adjusted absent
      absentHoursDuringLeave: adjustedAbsent,
      leavePeriods: [],
      leavePeriod: 'OD/ML Adjusted',
      odmlPeriods,
      odmlReductionHours: totalOdmlReductionHours,
      odmlAdjustedTotalAbsent: adjustedAbsent,
    });
  });

  return results;
};

// Calculate predicted attendance for all subjects with multiple leave periods
export const calculatePredictedAttendance = async (
  attendanceData: AttendanceData,
  slotOccurrences: SlotOccurrence[],
  leavePeriods: LeavePeriod[],
  odmlPeriods: LeavePeriod[] = []
): Promise<PredictionResult[]> => {
  const currentDate = parseDate(getCurrentDateString());
  const results: PredictionResult[] = [];
  const calendarData = await fetchCalendarFromSupabase();
  if (isDev) {
    console.log(`[attendancePrediction] Prediction calendar fetched (course=Default, semester=0): ${calendarData.length} events`);
  }

  // Debug data structures
  debugDataStructures(attendanceData, slotOccurrences);

  // Specific debug for problematic subjects
  const problematicSubjects = ['Operating Systems', 'Data Structures and Algorithms'];
  problematicSubjects.forEach(problemSubject => {
    if (!attendanceData || !attendanceData.all_subjects || !Array.isArray(attendanceData.all_subjects)) return;
    const attendanceSubjects = attendanceData.all_subjects.filter(s =>
      s && s.course_title && s.course_title.toLowerCase().includes(problemSubject.toLowerCase())
    );
    const timetableSubjects = slotOccurrences.filter(s =>
      s.courseTitle.toLowerCase().includes(problemSubject.toLowerCase())
    );

    console.log(`[DEBUG] === ${problemSubject.toUpperCase()} ANALYSIS ===`);
    console.log(`[DEBUG] Attendance subjects:`, attendanceSubjects.map(s => `"${s.course_title}" (${s.category}) -> "${normalizeCategory(s.category)}"`));
    console.log(`[DEBUG] Timetable subjects:`, timetableSubjects.map(s => `"${s.courseTitle}" (${s.category}) -> "${normalizeCategory(s.category)}"`));

    // Test matching for each attendance subject
    attendanceSubjects.forEach(attSubject => {
      if (!attSubject) return;
      const matches = timetableSubjects.filter(timetableSubject =>
        normalizeCategory(attSubject.category) === normalizeCategory(timetableSubject.category)
      );
      console.log(`[DEBUG] "${attSubject.course_title}" (${attSubject.category}) matches:`, matches.map(m => `"${m.courseTitle}" (${m.category})`));
    });
  });

  // Sort leave periods by start date
  const sortedLeavePeriods = [...leavePeriods].sort((a, b) => a.from.getTime() - b.from.getTime());

  // Get the end date (last leave period end date)
  const endDate = sortedLeavePeriods.length > 0 ?
    sortedLeavePeriods[sortedLeavePeriods.length - 1].to :
    currentDate;

  // Calculate total hours till end date
  const dayOrderStatsTillEnd = getDayOrderStatsForDateRange(calendarData, currentDate, endDate);

  if (!attendanceData || !attendanceData.all_subjects || !Array.isArray(attendanceData.all_subjects)) {
    return results;
  }

  attendanceData.all_subjects.forEach(subject => {
    if (!subject) return;
    let totalPresentHours = 0;
    let totalAbsentHours = 0;
    let lastEndDate = currentDate;

    // Process each leave period
    sortedLeavePeriods.forEach(leavePeriod => {
      // Calculate present hours from last end date to this leave period start
      if (leavePeriod.from > lastEndDate) {
        const presentHoursInPeriod = calculateSubjectHoursInDateRange(
          subject,
          slotOccurrences,
          getDayOrderStatsForDateRange(calendarData, lastEndDate, leavePeriod.from)
        );
        totalPresentHours += presentHoursInPeriod;
      }

      // Calculate absent hours during this leave period
      // For same-day leaves (from === to), we still need to include that day
      const absentHoursInPeriod = calculateSubjectHoursInDateRange(
        subject,
        slotOccurrences,
        getDayOrderStatsForDateRange(calendarData, leavePeriod.from, leavePeriod.to)
      );
      totalAbsentHours += absentHoursInPeriod;

      // For both same-day and multi-day leaves, move to the next day to avoid double-counting
      if (leavePeriod.from.getTime() === leavePeriod.to.getTime()) {
        // Same day leave - move to next day
        lastEndDate = new Date(leavePeriod.to.getFullYear(), leavePeriod.to.getMonth(), leavePeriod.to.getDate() + 1);
      } else {
        // Multi-day leave - move to the day after the leave period ends
        lastEndDate = new Date(leavePeriod.to.getFullYear(), leavePeriod.to.getMonth(), leavePeriod.to.getDate() + 1);
      }

      if (isDev) {
        console.log(`[DEBUG] Leave period ${leavePeriod.from.toLocaleDateString()} - ${leavePeriod.to.toLocaleDateString()}:`);
        console.log(`  Absent hours in period: ${absentHoursInPeriod}`);
        console.log(`  Next lastEndDate: ${lastEndDate.toLocaleDateString()}`);
      }
    });

    // Calculate present hours from last leave period end to final end date
    if (endDate > lastEndDate) {
      const presentHoursInFinalPeriod = calculateSubjectHoursInDateRange(
        subject,
        slotOccurrences,
        getDayOrderStatsForDateRange(calendarData, lastEndDate, endDate)
      );
      totalPresentHours += presentHoursInFinalPeriod;
    }

    const totalHoursTillEndDate = calculateSubjectHoursInDateRange(
      subject,
      slotOccurrences,
      dayOrderStatsTillEnd
    );

    // Calculate current and predicted attendance
    const currentConducted = parseInt(subject.hours_conducted) || 0;
    const currentAbsent = parseInt(subject.hours_absent) || 0;
    const currentPresent = currentConducted - currentAbsent;
    const currentAttendance = currentConducted > 0 ? (currentPresent / currentConducted) * 100 : 0;

    // Calculate OD/ML adjustments
    let odmlReductionHours = 0;
    odmlPeriods.forEach(odmlPeriod => {
      const odmlHours = calculateSubjectHoursInDateRange(
        subject,
        slotOccurrences,
        getDayOrderStatsForDateRange(calendarData, odmlPeriod.from, odmlPeriod.to)
      );
      odmlReductionHours += odmlHours;
    });

    // Apply OD/ML adjustments to current attendance
    const odmlAdjustedPresent = currentPresent + odmlReductionHours;
    const odmlAdjustedAbsent = Math.max(0, currentAbsent - odmlReductionHours);

    // CORRECTED PREDICTION LOGIC WITH OD/ML ADJUSTMENTS:
    // Total predicted hours = current conducted + all future hours
    const predictedConducted = currentConducted + totalHoursTillEndDate;

    // Absent predicted hours = OD/ML adjusted absent + future absent hours
    const predictedAbsent = odmlAdjustedAbsent + totalAbsentHours;

    // Present predicted hours = total predicted - absent predicted
    const predictedPresent = predictedConducted - predictedAbsent;

    // Predicted attendance percentage
    const predictedAttendance = predictedConducted > 0 ? (predictedPresent / predictedConducted) * 100 : 0;
    const clampedPredictedAttendance = clampAttendance(predictedAttendance);

    if (isDev) {
      console.log(`[DEBUG] ${subject.course_title} (${subject.category}):`);
      console.log(`  Current: Conducted=${currentConducted}, Absent=${currentAbsent}, Present=${currentPresent}`);
      console.log(`  Future: Total=${totalHoursTillEndDate}, Present=${totalPresentHours}, Absent=${totalAbsentHours}`);
      console.log(`  Predicted: Conducted=${predictedConducted}, Absent=${predictedAbsent}, Present=${predictedPresent}`);
    }

    results.push({
      subject,
      currentAttendance,
      predictedAttendance: clampedPredictedAttendance,
      totalHoursTillEndDate,
      presentHoursTillStartDate: totalPresentHours, // Future present hours only
      absentHoursDuringLeave: totalAbsentHours,     // Future absent hours only (prediction semantics)
      leavePeriods: sortedLeavePeriods,
      leavePeriod: sortedLeavePeriods.map(p => `${p.from.toLocaleDateString()} - ${p.to.toLocaleDateString()}`).join(', '),
      odmlPeriods,
      odmlReductionHours: odmlReductionHours,
    });
  });

  return results;
};

// Format date for display
export const formatDateRange = (startDate: Date, endDate: Date): string => {
  const start = startDate.toLocaleDateString('en-GB');
  const end = endDate.toLocaleDateString('en-GB');
  return `${start} to ${end}`;
};

// Validate date range
export const validateDateRange = (startDate: Date, endDate: Date): { isValid: boolean; error?: string } => {
  const currentDate = parseDate(getCurrentDateString());

  if (startDate > endDate) {
    return { isValid: false, error: 'Leave start date cannot be after end date' };
  }

  if (startDate < currentDate) {
    return { isValid: false, error: 'Leave start date cannot be in the past' };
  }

  const maxEndDate = new Date('2026-11-21'); // Academic year end
  if (endDate > maxEndDate) {
    return { isValid: false, error: 'Leave end date cannot be beyond academic year end' };
  }

  return { isValid: true };
};

// Validate OD/ML date range (allows past dates)
export const validateODMLDateRange = (startDate: Date, endDate: Date): { isValid: boolean; error?: string } => {
  if (startDate > endDate) {
    return { isValid: false, error: 'OD/ML start date cannot be after end date' };
  }

  // For OD/ML, we allow past dates since it's for adjusting historical attendance
  const academicYearStart = new Date('2024-07-01'); // Academic year start
  if (startDate < academicYearStart) {
    return { isValid: false, error: 'OD/ML start date cannot be before academic year start' };
  }

  const maxEndDate = new Date('2026-11-21'); // Academic year end
  if (endDate > maxEndDate) {
    return { isValid: false, error: 'OD/ML end date cannot be beyond academic year end' };
  }

  return { isValid: true };
};

// Validate multiple leave periods
export const validateLeavePeriods = (leavePeriods: LeavePeriod[]): { isValid: boolean; error?: string } => {
  if (leavePeriods.length === 0) {
    return { isValid: false, error: 'Please add at least one leave period' };
  }

  const currentDate = parseDate(getCurrentDateString());
  const maxEndDate = new Date('2025-11-21');

  for (let i = 0; i < leavePeriods.length; i++) {
    const period = leavePeriods[i];

    // Validate individual period
    const validation = validateDateRange(period.from, period.to);
    if (!validation.isValid) {
      return { isValid: false, error: `Period ${i + 1}: ${validation.error}` };
    }

    // Check for overlaps with other periods
    for (let j = i + 1; j < leavePeriods.length; j++) {
      const otherPeriod = leavePeriods[j];
      // Allow same day periods if they're exactly the same date range
      if (period.from.getTime() === otherPeriod.from.getTime() &&
        period.to.getTime() === otherPeriod.to.getTime()) {
        return { isValid: false, error: `Period ${i + 1} is identical to period ${j + 1}` };
      }
      // Check for actual overlaps (not just same day)
      if (period.from < otherPeriod.to && period.to > otherPeriod.from) {
        return { isValid: false, error: `Period ${i + 1} overlaps with period ${j + 1}` };
      }
    }
  }

  return { isValid: true };
};
