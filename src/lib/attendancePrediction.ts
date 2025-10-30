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
  
  // Normalize dates to start of day to avoid time issues
  const normalizedStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const normalizedEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  console.log(`[DEBUG] Calculating day order stats for range: ${normalizedStart.toLocaleDateString()} to ${normalizedEnd.toLocaleDateString()}`);
  
  calendarData.forEach((event: any) => {
    if (event.date && event.day_order) {
      try {
        const eventDate = parseDate(event.date);
        const normalizedEventDate = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
        
        // Skip holidays and days off - check both portal markers ("-", "DO -") and our calendar markers ("Holiday")
        // This includes Sundays and other non-class days from the portal
        const isHoliday = event.day_order === "Holiday" || 
                         event.day_order === "-" || 
                         event.day_order === "DO -" ||
                         event.content?.toLowerCase().includes('holiday');
        
        // Skip if it's a holiday (including Sundays and other non-class days)
        if (isHoliday) {
          console.log(`[DEBUG] Skipping holiday/non-class day: ${event.date} with day_order: "${event.day_order}"`);
          return;
        }
        
        // Use proper date comparison (inclusive range)
        // Check if event date is within the range (inclusive)
        // Only count if it's a valid day order (not a holiday)
        if (normalizedEventDate.getTime() >= normalizedStart.getTime() && 
            normalizedEventDate.getTime() <= normalizedEnd.getTime() &&
            event.day_order.startsWith('DO ')) {
          
          const doNumber = parseInt(event.day_order.split(' ')[1]);
          if (!isNaN(doNumber) && doNumber >= 1 && doNumber <= 5) {
            stats[doNumber]++;
            console.log(`[DEBUG] Found ${event.day_order} on ${event.date}`);
          }
        }
      } catch (error) {
        console.warn(`Failed to parse date: ${event.date}`, error);
      }
    }
  });
  
  console.log(`[DEBUG] Day order stats result:`, stats);

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

// Debug function to log all data structures
export const debugDataStructures = (attendanceData: AttendanceData, slotOccurrences: SlotOccurrence[]) => {
  console.log(`[DEBUG] === ATTENDANCE DATA ===`);
  attendanceData.all_subjects.forEach((subject, index) => {
    console.log(`[DEBUG] Attendance ${index}: "${subject.course_title}" (${subject.category}) -> normalized: "${normalizeCategory(subject.category)}"`);
  });
  
  console.log(`[DEBUG] === TIMETABLE SLOT OCCURRENCES ===`);
  slotOccurrences.forEach((occurrence, index) => {
    console.log(`[DEBUG] Timetable ${index}: "${occurrence.courseTitle}" (${occurrence.category}) -> normalized: "${normalizeCategory(occurrence.category)}"`);
  });
  
  console.log(`[DEBUG] === CATEGORY MAPPING TEST ===`);
  const testCategories = ['Theory', 'Lab', 'Practical', 'theory', 'lab', 'practical'];
  testCategories.forEach(cat => {
    console.log(`[DEBUG] "${cat}" -> "${normalizeCategory(cat)}"`);
  });
  
  console.log(`[DEBUG] === MATCHING ANALYSIS ===`);
  attendanceData.all_subjects.forEach(subject => {
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
};

// Find slot data for a subject with improved matching logic
const findSlotData = (subject: AttendanceSubject, slotOccurrences: SlotOccurrence[]): SlotOccurrence | null => {
  console.log(`[DEBUG] Finding slot data for: "${subject.course_title}" (${subject.category})`);
  console.log(`[DEBUG] Available slot occurrences:`, slotOccurrences.map(s => `"${s.courseTitle}" (${s.category})`));
  
  // Try exact match first
  let slotData = slotOccurrences.find(occurrence => 
    occurrence.courseTitle.toLowerCase().trim() === subject.course_title.toLowerCase().trim() &&
    normalizeCategory(occurrence.category) === normalizeCategory(subject.category)
  );
  
  if (slotData) {
    console.log(`[DEBUG] Exact match found: "${slotData.courseTitle}" (${slotData.category})`);
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
    console.log(`[DEBUG] Subject "${subject.course_title}" has both Theory and Lab versions - requiring EXACT match`);
    // For subjects with both versions, require EXACT title match
    slotData = slotOccurrences.find(occurrence => 
      occurrence.courseTitle.toLowerCase().trim() === subjectTitle &&
      normalizeCategory(occurrence.category) === subjectCategory
    );
    
    if (slotData) {
      console.log(`[DEBUG] Exact match for dual-version subject: "${slotData.courseTitle}" (${slotData.category})`);
      return slotData;
    }
    
    // If no exact match found for dual-version subject, return null to prevent wrong matches
    console.warn(`[DEBUG] No exact match found for dual-version subject "${subject.course_title}" (${subject.category}) - returning null`);
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
      console.log(`[DEBUG] Fuzzy match found: "${occurrence.courseTitle}" (${occurrence.category}) - ${overlapPercentage.toFixed(1)}% overlap`);
    }
    
    return courseTitleMatch;
  });
  
  if (!slotData) {
    console.warn(`[DEBUG] No slot data found for: "${subject.course_title}" (${subject.category})`);
    console.warn(`[DEBUG] Searched ${slotOccurrences.length} occurrences`);
  }
  
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
    // Total hours remain unchanged - only adjust absent/present distribution
    const adjustedAbsent = Math.max(0, currentAbsent - totalOdmlReductionHours);
    const adjustedPresent = currentPresent + totalOdmlReductionHours;
    
    // Total hours remain exactly the same
    const adjustedConducted = currentConducted;
    const adjustedAttendance = adjustedConducted > 0 ? (adjustedPresent / adjustedConducted) * 100 : 0;

    results.push({
      subject,
      currentAttendance,
      predictedAttendance: adjustedAttendance,
      totalHoursTillEndDate: 0, // No future hours for OD/ML - only current adjustment
      presentHoursTillStartDate: adjustedPresent, // OD/ML adjusted present hours
      absentHoursDuringLeave: adjustedAbsent, // OD/ML adjusted absent hours
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
  
  // Debug data structures
  debugDataStructures(attendanceData, slotOccurrences);
  
  // Specific debug for problematic subjects
  const problematicSubjects = ['Operating Systems', 'Data Structures and Algorithms'];
  problematicSubjects.forEach(problemSubject => {
    const attendanceSubjects = attendanceData.all_subjects.filter(s => 
      s.course_title.toLowerCase().includes(problemSubject.toLowerCase())
    );
    const timetableSubjects = slotOccurrences.filter(s => 
      s.courseTitle.toLowerCase().includes(problemSubject.toLowerCase())
    );
    
    console.log(`[DEBUG] === ${problemSubject.toUpperCase()} ANALYSIS ===`);
    console.log(`[DEBUG] Attendance subjects:`, attendanceSubjects.map(s => `"${s.course_title}" (${s.category}) -> "${normalizeCategory(s.category)}"`));
    console.log(`[DEBUG] Timetable subjects:`, timetableSubjects.map(s => `"${s.courseTitle}" (${s.category}) -> "${normalizeCategory(s.category)}"`));
    
    // Test matching for each attendance subject
    attendanceSubjects.forEach(attSubject => {
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

      // For both same-day and multi-day leaves, move to the next day to avoid double-counting
      if (leavePeriod.from.getTime() === leavePeriod.to.getTime()) {
        // Same day leave - move to next day
        lastEndDate = new Date(leavePeriod.to.getFullYear(), leavePeriod.to.getMonth(), leavePeriod.to.getDate() + 1);
      } else {
        // Multi-day leave - move to the day after the leave period ends
        lastEndDate = new Date(leavePeriod.to.getFullYear(), leavePeriod.to.getMonth(), leavePeriod.to.getDate() + 1);
      }
      
      console.log(`[DEBUG] Leave period ${leavePeriod.from.toLocaleDateString()} - ${leavePeriod.to.toLocaleDateString()}:`);
      console.log(`  Absent hours in period: ${absentHoursInPeriod}`);
      console.log(`  Next lastEndDate: ${lastEndDate.toLocaleDateString()}`);
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

    console.log(`[DEBUG] ${subject.course_title} (${subject.category}):`);
    console.log(`  Current: Conducted=${currentConducted}, Absent=${currentAbsent}, Present=${currentPresent}`);
    console.log(`  Future: Total=${totalHoursTillEndDate}, Present=${totalPresentHours}, Absent=${totalAbsentHours}`);
    console.log(`  Predicted: Conducted=${predictedConducted}, Absent=${predictedAbsent}, Present=${predictedPresent}`);

    results.push({
      subject,
      currentAttendance,
      predictedAttendance,
      totalHoursTillEndDate,
      presentHoursTillStartDate: totalPresentHours, // Future present hours only
      absentHoursDuringLeave: totalAbsentHours,     // Future absent hours only
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
