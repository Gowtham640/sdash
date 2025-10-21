// Attendance prediction utility functions

import { parseDate, getCurrentDateString, type DayOrderStats, type SlotOccurrence } from './timetableUtils';

export interface AttendanceSubject {
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

export interface AttendanceData {
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
  all_subjects: AttendanceSubject[];
}

export interface LeavePeriod {
  from: Date;
  to: Date;
  id: string;
}

export interface PredictionResult {
  subject: AttendanceSubject;
  currentAttendance: number;
  predictedAttendance: number;
  totalHoursTillEndDate: number;
  presentHoursTillStartDate: number;
  absentHoursDuringLeave: number;
  leavePeriods: LeavePeriod[];
  leavePeriod: string;
  odmlPeriods?: LeavePeriod[];
  odmlReductionHours?: number;
}

// Calculate day order statistics for a custom date range
export const getDayOrderStatsForDateRange = (
  calendarData: any[], 
  startDate: Date, 
  endDate: Date
): DayOrderStats => {
  const stats: DayOrderStats = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  // For same-day ranges, we need to include that specific day
  const isSameDay = startDate.getTime() === endDate.getTime();

  calendarData.forEach((event: any) => {
    if (event.date && event.day_order && event.day_order.startsWith('DO ')) {
      const eventDate = parseDate(event.date);
      
      // For same-day ranges, only include events on that exact day
      // For multi-day ranges, include events within the range (inclusive)
      const isInRange = isSameDay ? 
        eventDate.toDateString() === startDate.toDateString() :
        eventDate >= startDate && eventDate <= endDate;
      
      if (isInRange) {
        const doNumber = parseInt(event.day_order.split(' ')[1]);
        if (doNumber >= 1 && doNumber <= 5) {
          stats[doNumber]++;
        }
      }
    }
  });

  return stats;
};

// Calculate hours for a specific subject during a date range
export const calculateSubjectHoursInDateRange = (
  subject: AttendanceSubject,
  slotOccurrences: SlotOccurrence[],
  dayOrderStats: DayOrderStats
): number => {
  // Find the matching slot occurrence for this subject
  const slotData = slotOccurrences.find(occurrence => {
    const courseTitleMatch = occurrence.courseTitle.toLowerCase().includes(subject.course_title.toLowerCase()) ||
                           subject.course_title.toLowerCase().includes(occurrence.courseTitle.toLowerCase());
    
    // Handle different category formats
    const normalizeCategory = (cat: string) => {
      const normalized = cat.toLowerCase().trim();
      if (normalized.includes('practical') || normalized.includes('lab')) return 'practical';
      if (normalized.includes('theory')) return 'theory';
      return normalized;
    };
    
    const categoryMatch = normalizeCategory(occurrence.category) === normalizeCategory(subject.category);
    return courseTitleMatch && categoryMatch;
  });

  if (!slotData) {
    console.warn(`No slot data found for subject: ${subject.course_title} (${subject.category})`);
    return 0;
  }

  // Calculate total hours using the same logic as remaining hours calculation
  let totalHours = 0;
  Object.entries(slotData.dayOrderHours).forEach(([dayOrder, hoursPerDay]) => {
    const doNumber = parseInt(dayOrder);
    const dayCount = dayOrderStats[doNumber] || 0;
    totalHours += dayCount * hoursPerDay;
  });

  return totalHours;
};

// Calculate OD/ML adjusted attendance
export const calculateODMLAdjustedAttendance = (
  attendanceData: AttendanceData,
  slotOccurrences: SlotOccurrence[],
  calendarData: any[],
  odmlPeriods: LeavePeriod[]
): PredictionResult[] => {
  const results: PredictionResult[] = [];

  attendanceData.all_subjects.forEach(subject => {
    // Get current attendance data
    const currentConducted = parseInt(subject.hours_conducted) || 0;
    const currentAbsent = parseInt(subject.hours_absent) || 0;
    const currentPresent = currentConducted - currentAbsent;
    const currentAttendance = currentConducted > 0 ? (currentPresent / currentConducted) * 100 : 0;

    // Calculate total OD/ML reduction hours for this subject
    let totalOdmlReductionHours = 0;
    odmlPeriods.forEach(odmlPeriod => {
      const odmlHours = calculateSubjectHoursInDateRange(
        subject,
        slotOccurrences,
        getDayOrderStatsForDateRange(calendarData, odmlPeriod.from, odmlPeriod.to)
      );
      totalOdmlReductionHours += odmlHours;
    });

    // Apply OD/ML adjustments: reduce absent hours, add to present hours
    const adjustedAbsent = Math.max(0, currentAbsent - totalOdmlReductionHours);
    const adjustedPresent = currentPresent + totalOdmlReductionHours;
    
    // Total hours remain the same
    const adjustedConducted = currentConducted;
    const adjustedAttendance = adjustedConducted > 0 ? (adjustedPresent / adjustedConducted) * 100 : 0;

    results.push({
      subject,
      currentAttendance,
      predictedAttendance: adjustedAttendance,
      totalHoursTillEndDate: adjustedConducted, // Same as original
      presentHoursTillStartDate: adjustedPresent,
      absentHoursDuringLeave: adjustedAbsent,
      leavePeriods: [],
      leavePeriod: 'OD/ML Adjusted',
      odmlPeriods,
      odmlReductionHours: totalOdmlReductionHours
    });
  });

  return results;
};

// Calculate predicted attendance for all subjects with multiple leave periods
export const calculatePredictedAttendance = (
  attendanceData: AttendanceData,
  slotOccurrences: SlotOccurrence[],
  calendarData: any[],
  leavePeriods: LeavePeriod[],
  odmlPeriods: LeavePeriod[] = []
): PredictionResult[] => {
  const currentDate = parseDate(getCurrentDateString());
  const results: PredictionResult[] = [];

  // Sort leave periods by start date
  const sortedLeavePeriods = [...leavePeriods].sort((a, b) => a.from.getTime() - b.from.getTime());
  
  // Get the end date (last leave period end date)
  const endDate = sortedLeavePeriods.length > 0 ? 
    sortedLeavePeriods[sortedLeavePeriods.length - 1].to : 
    currentDate;

  // Calculate total hours till end date
  const dayOrderStatsTillEnd = getDayOrderStatsForDateRange(calendarData, currentDate, endDate);

  attendanceData.all_subjects.forEach(subject => {
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

      // For same-day leaves, move to the next day to avoid double-counting
      lastEndDate = leavePeriod.from.getTime() === leavePeriod.to.getTime() ? 
        new Date(leavePeriod.to.getTime() + 24 * 60 * 60 * 1000) : 
        leavePeriod.to;
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

    // Predicted attendance: (OD/ML adjusted present + total present hours) / (current conducted + total hours till end)
    const predictedPresent = odmlAdjustedPresent + totalPresentHours;
    const predictedConducted = currentConducted + totalHoursTillEndDate;
    const predictedAttendance = predictedConducted > 0 ? (predictedPresent / predictedConducted) * 100 : 0;

    results.push({
      subject,
      currentAttendance,
      predictedAttendance,
      totalHoursTillEndDate,
      presentHoursTillStartDate: totalPresentHours,
      absentHoursDuringLeave: totalAbsentHours,
      leavePeriods: sortedLeavePeriods,
      leavePeriod: sortedLeavePeriods.map(p => `${p.from.toLocaleDateString()} - ${p.to.toLocaleDateString()}`).join(', '),
      odmlPeriods,
      odmlReductionHours
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
  
  const maxEndDate = new Date('2025-11-21'); // Academic year end
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
  
  const maxEndDate = new Date('2025-11-21'); // Academic year end
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
