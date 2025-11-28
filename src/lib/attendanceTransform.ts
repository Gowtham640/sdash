/**
 * Transform attendance data from Go backend format to Python scraper format
 *
 * Go format (object with attendance array):
 * {
 *   regNumber: "RA2111003010790",
 *   attendance: [
 *     {
 *       slot: "A",
 *       category: "Theory",
 *       courseCode: "21MAB201T",
 *       courseTitle: "Transforms and Boundary Value Problems",
 *       facultyName: "Dr. H. Merlyn Margaret (100420)",
 *       hoursAbsent: "",
 *       hoursConducted: "82",
 *       attendancePercentage: "100.00"
 *     },
 *     ...
 *   ]
 * }
 *
 * Python format (object with metadata, summary, subjects, all_subjects):
 * {
 *   metadata: { ... },
 *   summary: { total_subjects, overall_attendance_percentage, ... },
 *   subjects: { theory: [...], lab: [...], other: [...] },
 *   all_subjects: [
 *     {
 *       row_number: 1,
 *       subject_code: "21MAB201T",
 *       course_title: "Transforms and Boundary Value Problems",
 *       category: "Theory",
 *       faculty_name: "Dr. H. Merlyn Margaret (100420)",
 *       slot: "A",
 *       room: "",
 *       hours_conducted: "82",
 *       hours_absent: "",
 *       attendance: "82",
 *       attendance_percentage: "100.00"
 *     },
 *     ...
 *   ]
 * }
 */

interface GoAttendanceSubject {
  slot: string;
  category: string;
  courseCode: string;
  courseTitle: string;
  facultyName: string;
  hoursAbsent: string;
  hoursConducted: string;
  attendancePercentage: string;
}

interface GoAttendanceData {
  regNumber?: string;
  attendance: GoAttendanceSubject[];
}

interface PythonAttendanceSubject {
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

interface PythonAttendanceData {
  metadata: {
    generated_at: string;
    source: string;
    academic_year: string;
    institution: string;
    college: string;
    scraped_at: string;
    semester?: number;
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
    theory: PythonAttendanceSubject[];
    lab: PythonAttendanceSubject[];
    other: PythonAttendanceSubject[];
  };
  all_subjects: PythonAttendanceSubject[];
}

/**
 * Transform a single subject from Go format to Python format
 */
function transformSubject(goSubject: GoAttendanceSubject, rowNumber: number): PythonAttendanceSubject {
  const hoursConducted = parseInt(goSubject.hoursConducted || '0');
  const hoursAbsent = parseInt(goSubject.hoursAbsent || '0');
  const hoursPresent = hoursConducted - hoursAbsent;

  return {
    row_number: rowNumber,
    subject_code: goSubject.courseCode,
    course_title: goSubject.courseTitle,
    category: goSubject.category,
    faculty_name: goSubject.facultyName,
    slot: goSubject.slot,
    room: '', // Not provided in Go format
    hours_conducted: goSubject.hoursConducted,
    hours_absent: goSubject.hoursAbsent,
    attendance: hoursPresent.toString(),
    attendance_percentage: goSubject.attendancePercentage,
  };
}

/**
 * Determine subject category (theory, lab, other)
 */
function getCategoryType(category: string): 'theory' | 'lab' | 'other' {
  const cat = category.toLowerCase();

  if (cat.includes('theory')) {
    return 'theory';
  } else if (cat.includes('practical') || cat.includes('lab')) {
    return 'lab';
  } else {
    return 'other';
  }
}

/**
 * Calculate overall attendance percentage
 */
function calculateOverallPercentage(subjects: PythonAttendanceSubject[]): string {
  let totalConducted = 0;
  let totalAbsent = 0;

  subjects.forEach(subject => {
    totalConducted += parseInt(subject.hours_conducted || '0');
    totalAbsent += parseInt(subject.hours_absent || '0');
  });

  if (totalConducted === 0) {
    return '0.00';
  }

  const percentage = ((totalConducted - totalAbsent) / totalConducted) * 100;
  return percentage.toFixed(2);
}

/**
 * Transform attendance data from Go backend format to Python scraper format
 * @param goData - Attendance data in Go format
 * @returns Attendance data in Python scraper format
 */
export function transformGoAttendanceDataToPythonFormat(goData: unknown): PythonAttendanceData | null {
  console.log('[AttendanceTransform] 🔄 Starting transformation of Go format to Python format');

  // Validate input - handle both direct array and object with attendance property
  let attendanceArray: GoAttendanceSubject[];

  if (Array.isArray(goData)) {
    // Direct array format
    attendanceArray = goData;
  } else if (typeof goData === 'object' && goData !== null && 'attendance' in goData) {
    // Object with attendance property
    const dataWithAttendance = goData as GoAttendanceData;
    attendanceArray = dataWithAttendance.attendance || [];
  } else {
    console.warn('[AttendanceTransform] ⚠️ Input is not in expected format:', typeof goData);
    return null;
  }

  if (!Array.isArray(attendanceArray) || attendanceArray.length === 0) {
    console.warn('[AttendanceTransform] ⚠️ No attendance data found');
    return null;
  }

  console.log(`[AttendanceTransform] 📊 Transforming ${attendanceArray.length} subjects`);

  // Transform all subjects
  const all_subjects: PythonAttendanceSubject[] = attendanceArray
    .filter((subject): subject is GoAttendanceSubject => {
      // Type guard to ensure subject has required properties
      return (
        typeof subject === 'object' &&
        subject !== null &&
        'courseCode' in subject &&
        'courseTitle' in subject &&
        'category' in subject
      );
    })
    .map((subject, index) => transformSubject(subject, index + 1));

  // Categorize subjects by type
  const theory: PythonAttendanceSubject[] = [];
  const lab: PythonAttendanceSubject[] = [];
  const other: PythonAttendanceSubject[] = [];

  all_subjects.forEach((subject) => {
    const categoryType = getCategoryType(subject.category);

    if (categoryType === 'theory') {
      theory.push(subject);
    } else if (categoryType === 'lab') {
      lab.push(subject);
    } else {
      other.push(subject);
    }
  });

  // Calculate summary statistics
  let totalHoursConducted = 0;
  let totalHoursAbsent = 0;

  all_subjects.forEach((subject) => {
    totalHoursConducted += parseInt(subject.hours_conducted || '0');
    totalHoursAbsent += parseInt(subject.hours_absent || '0');
  });

  const overallPercentage = calculateOverallPercentage(all_subjects);

  const summary = {
    total_subjects: all_subjects.length,
    theory_subjects: theory.length,
    lab_subjects: lab.length,
    other_subjects: other.length,
    total_hours_conducted: totalHoursConducted,
    total_hours_absent: totalHoursAbsent,
    overall_attendance_percentage: overallPercentage,
  };

  // Build metadata
  const metadata = {
    generated_at: new Date().toISOString(),
    source: "Go Backend Scraper (Transformed)",
    academic_year: "2024-2025", // Default, can be updated if available
    institution: "SRMIST",
    college: "SRM Institute of Science and Technology",
    scraped_at: new Date().toISOString(),
  };

  const result: PythonAttendanceData = {
    metadata,
    summary,
    subjects: {
      theory,
      lab,
      other,
    },
    all_subjects,
  };

  console.log('[AttendanceTransform] ✅ Transformation complete');
  console.log(`[AttendanceTransform]   - Total subjects: ${all_subjects.length}`);
  console.log(`[AttendanceTransform]   - Theory: ${theory.length}, Lab: ${lab.length}, Other: ${other.length}`);
  console.log(`[AttendanceTransform]   - Overall attendance: ${overallPercentage}%`);

  return result;
}

/**
 * Check if attendance data is in Go format
 */
export function isGoFormat(data: unknown): boolean {
  // Check for direct array of subjects with Go format properties
  if (Array.isArray(data)) {
    if (data.length === 0) return false;
    const firstItem = data[0];
    if (typeof firstItem !== 'object' || firstItem === null) return false;
    return (
      'courseCode' in firstItem &&
      'courseTitle' in firstItem &&
      'facultyName' in firstItem
    );
  }

  // Check for object with attendance property
  if (typeof data === 'object' && data !== null) {
    if ('attendance' in data) {
      const attendance = (data as { attendance: unknown }).attendance;
      if (Array.isArray(attendance) && attendance.length > 0) {
        const firstItem = attendance[0];
        if (typeof firstItem !== 'object' || firstItem === null) return false;
        return (
          'courseCode' in firstItem &&
          'courseTitle' in firstItem &&
          'facultyName' in firstItem
        );
      }
    }
  }

  return false;
}

/**
 * Check if attendance data is in Python format
 */
export function isPythonFormat(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  return (
    'all_subjects' in data ||
    'summary' in data ||
    ('subjects' in data && typeof (data as { subjects?: unknown }).subjects === 'object')
  );
}
