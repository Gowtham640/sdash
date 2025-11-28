/**
 * Transform marks data from Go backend format to Python scraper format
 *
 * Go format (array):
 * [
 *   {
 *     courseCode: "21MAB201T",
 *     courseName: "Transforms and Boundary Value Problems",
 *     courseType: "Theory",
 *     testPerformance: [
 *       { test: "FT-I", marks: { total: "5.00", scored: "5.00" } },
 *       ...
 *     ],
 *     overall: { total: "60.00", scored: "52.30" }
 *   },
 *   ...
 * ]
 *
 * Python format (object):
 * {
 *   metadata: { ... },
 *   summary: { total_courses, theory_courses, lab_courses, ... },
 *   courses: { theory: [...], lab: [...], other: [...] },
 *   all_courses: [
 *     {
 *       course_code: "21MAB201T",
 *       course_title: "Transforms and Boundary Value Problems",
 *       subject_type: "Theory",
 *       assessments: [
 *         { assessment_name: "FT-I", total_marks: "5.00", marks_obtained: "5.00", percentage: "100.00%" },
 *         ...
 *       ],
 *       total_assessments: 5
 *     },
 *     ...
 *   ]
 * }
 */

interface GoMarksCourse {
  courseCode: string;
  courseName: string;
  courseType: string;
  testPerformance: Array<{
    test: string;
    marks: {
      total: string;
      scored: string;
    };
  }>;
  overall?: {
    total: string;
    scored: string;
  };
}

interface PythonAssessment {
  assessment_name: string;
  total_marks: string;
  marks_obtained: string;
  percentage: string;
}

interface PythonMarksCourse {
  course_code: string;
  course_title: string;
  subject_type: string;
  assessments: PythonAssessment[];
  total_assessments: number;
}

interface PythonMarksData {
  metadata: {
    generated_at: string;
    source: string;
    academic_year: string;
    institution: string;
    college: string;
    scraped_at: string;
  };
  summary: {
    total_courses: number;
    theory_courses: number;
    lab_courses: number;
    other_courses: number;
    total_assessments: number;
  };
  courses: {
    theory: PythonMarksCourse[];
    lab: PythonMarksCourse[];
    other: PythonMarksCourse[];
  };
  all_courses: PythonMarksCourse[];
}

/**
 * Calculate percentage from scored and total marks
 */
function calculatePercentage(scored: string, total: string): string {
  const scoredNum = parseFloat(scored) || 0;
  const totalNum = parseFloat(total) || 0;

  if (totalNum === 0) {
    return "0.00%";
  }

  const percentage = (scoredNum / totalNum) * 100;
  return `${percentage.toFixed(2)}%`;
}

/**
 * Transform a single course from Go format to Python format
 */
function transformCourse(goCourse: GoMarksCourse): PythonMarksCourse {
  // Handle null or undefined testPerformance array
  const testPerformance = goCourse.testPerformance || [];

  const assessments: PythonAssessment[] = testPerformance.map((test) => ({
    assessment_name: test.test,
    total_marks: test.marks.total,
    marks_obtained: test.marks.scored,
    percentage: calculatePercentage(test.marks.scored, test.marks.total),
  }));

  return {
    course_code: goCourse.courseCode,
    course_title: goCourse.courseName,
    subject_type: goCourse.courseType,
    assessments: assessments,
    total_assessments: assessments.length,
  };
}

/**
 * Determine subject type category (theory, lab, other)
 */
function getCourseCategory(subject_type: string): 'theory' | 'lab' | 'other' {
  const type = subject_type.toLowerCase();

  if (type.includes('theory')) {
    return 'theory';
  } else if (type.includes('lab') || type.includes('practical')) {
    return 'lab';
  } else {
    return 'other';
  }
}

/**
 * Transform marks data from Go backend format to Python scraper format
 * @param goData - Array of courses in Go format
 * @returns Marks data in Python scraper format
 */
export function transformGoMarksDataToPythonFormat(goData: unknown): PythonMarksData | null {
  console.log('[MarksTransform] 🔄 Starting transformation of Go format to Python format');

  // Validate input
  if (!Array.isArray(goData)) {
    console.warn('[MarksTransform] ⚠️ Input is not an array:', typeof goData);
    return null;
  }

  if (goData.length === 0) {
    console.warn('[MarksTransform] ⚠️ Input array is empty');
    return null;
  }

  console.log(`[MarksTransform] 📊 Transforming ${goData.length} courses`);

  // Transform all courses
  const all_courses: PythonMarksCourse[] = goData
    .filter((course): course is GoMarksCourse => {
      // Type guard to ensure course has required properties
      return (
        typeof course === 'object' &&
        course !== null &&
        'courseCode' in course &&
        'courseName' in course &&
        'courseType' in course &&
        'testPerformance' in course
      );
    })
    .map(transformCourse);

  // Categorize courses by type
  const theory: PythonMarksCourse[] = [];
  const lab: PythonMarksCourse[] = [];
  const other: PythonMarksCourse[] = [];

  all_courses.forEach((course) => {
    const category = getCourseCategory(course.subject_type);

    if (category === 'theory') {
      theory.push(course);
    } else if (category === 'lab') {
      lab.push(course);
    } else {
      other.push(course);
    }
  });

  // Calculate total assessments
  const total_assessments = all_courses.reduce(
    (sum, course) => sum + course.total_assessments,
    0
  );

  // Build summary
  const summary = {
    total_courses: all_courses.length,
    theory_courses: theory.length,
    lab_courses: lab.length,
    other_courses: other.length,
    total_assessments: total_assessments,
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

  const result: PythonMarksData = {
    metadata,
    summary,
    courses: {
      theory,
      lab,
      other,
    },
    all_courses,
  };

  console.log('[MarksTransform] ✅ Transformation complete');
  console.log(`[MarksTransform]   - Total courses: ${all_courses.length}`);
  console.log(`[MarksTransform]   - Theory: ${theory.length}, Lab: ${lab.length}, Other: ${other.length}`);
  console.log(`[MarksTransform]   - Total assessments: ${total_assessments}`);

  return result;
}

/**
 * Check if marks data is in Go format (array of courses)
 */
export function isGoFormat(data: unknown): boolean {
  if (!Array.isArray(data)) {
    return false;
  }

  if (data.length === 0) {
    return false;
  }

  // Check if first element has Go format properties
  const firstCourse = data[0];
  if (typeof firstCourse !== 'object' || firstCourse === null) {
    return false;
  }

  return (
    'courseCode' in firstCourse &&
    'courseName' in firstCourse &&
    'courseType' in firstCourse &&
    'testPerformance' in firstCourse
  );
}

/**
 * Check if marks data is in Python format (object with all_courses)
 */
export function isPythonFormat(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  return (
    'all_courses' in data ||
    'summary' in data ||
    ('courses' in data && typeof (data as { courses?: unknown }).courses === 'object')
  );
}
