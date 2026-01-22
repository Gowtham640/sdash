/**
 * Shared API types between frontend pages and data transformers.
 */

/** Attendance-related types */
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

export interface AttendanceMetadata {
  generated_at: string;
  source: string;
  academic_year: string;
  institution: string;
  college: string;
  scraped_at: string;
  fetched_at?: string;
  url?: string;
  semester?: number;
}

export interface AttendanceSummary {
  total_subjects: number;
  theory_subjects: number;
  lab_subjects: number;
  other_subjects: number;
  total_hours_conducted: number;
  total_hours_absent: number;
  overall_attendance_percentage: string;
}

export interface AttendanceData {
  metadata: AttendanceMetadata;
  summary: AttendanceSummary;
  subjects: {
    theory: AttendanceSubject[];
    lab: AttendanceSubject[];
    other: AttendanceSubject[];
  };
  all_subjects: AttendanceSubject[];
}

export interface AttendanceEntry {
  slot: string;
  faculty: string;
  category: string;
  courseCode: string;
  courseTitle: string;
  hoursAbsent: number;
  hoursConducted: number;
  attendancePercentage: number | string;
}

export interface AttendanceResponse {
  url: string;
  entries: AttendanceEntry[];
  fetched_at: string;
}

/** Marks-related types */
export interface MarksAssessment {
  assessment_name: string;
  total_marks: string;
  marks_obtained: string;
  percentage: string;
}

export interface MarksCourse {
  course_code: string;
  course_title: string;
  subject_type: string;
  assessments: MarksAssessment[];
  total_assessments?: number;
}

export interface MarksMetadata {
  generated_at: string;
  source: string;
  academic_year: string;
  institution: string;
  college: string;
  scraped_at: string;
  fetched_at?: string;
  url?: string;
  total?: number | null;
}

export interface MarksSummary {
  total_courses: number;
  theory_courses: number;
  lab_courses: number;
  other_courses: number;
  total_assessments: number;
}

export interface MarksData {
  metadata: MarksMetadata;
  summary: MarksSummary;
  courses: {
    theory: MarksCourse[];
    lab: MarksCourse[];
    other: MarksCourse[];
  };
  all_courses: MarksCourse[];
}

export interface MarksEntry {
  total: number | null;
  courseCode: string;
  courseTitle: string;
  assessments: Array<Record<string, unknown>>;
}

export interface MarksResponse {
  url: string;
  entries: MarksEntry[];
  fetched_at: string;
}

/** Generic leave period used across features */
export interface LeavePeriod {
  from: Date;
  to: Date;
  id: string;
}
