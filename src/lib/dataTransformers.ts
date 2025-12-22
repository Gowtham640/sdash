/**
 * Data transformation functions to convert Go backend format to frontend format
 */

/**
 * Transform Go backend attendance format to frontend format
 * Go backend returns: { regNumber: string, attendance: Array<{courseCode, courseTitle, category, ...}> }
 * Frontend expects: { subjects: {theory, lab, other}, all_subjects, summary, metadata }
 */
export function transformGoBackendAttendance(goData: unknown): unknown {
  if (!goData) {
    return goData;
  }

  // Check if it's already an array (raw Go backend format from cache)
  if (Array.isArray(goData)) {
    console.log('[DataTransformer] Attendance data is raw array format - transforming...');
    const attendanceArray = goData as Array<Record<string, unknown>>;
    const regNumber = ''; // Not available in raw array format
    
    // Transform the array directly
    return transformAttendanceArray(attendanceArray, regNumber);
  }

  if (typeof goData !== 'object') {
    return goData;
  }

  const data = goData as Record<string, unknown>;
  
  // Check if it's already in the correct format (has subjects or all_subjects)
  if ('subjects' in data || 'all_subjects' in data) {
    console.log('[DataTransformer] Attendance data already in correct format');
    return goData;
  }

  // Check if it has the Go backend format (has attendance array)
  if (!('attendance' in data) || !Array.isArray(data.attendance)) {
    console.warn('[DataTransformer] Attendance data doesn\'t match Go backend format');
    return goData;
  }

  const attendanceArray = data.attendance as Array<Record<string, unknown>>;
  const regNumber = (data.regNumber as string) || '';
  
  return transformAttendanceArray(attendanceArray, regNumber);
}

/**
 * Helper function to transform attendance array to frontend format
 */
function transformAttendanceArray(attendanceArray: Array<Record<string, unknown>>, regNumber: string): unknown {

  // Transform each attendance item to match frontend format
  const transformedSubjects = attendanceArray.map((item) => {
    return {
      row_number: 0, // Not available in Go backend
      subject_code: item.courseCode || '',
      course_title: item.courseTitle || '',
      category: item.category || '',
      faculty_name: item.facultyName || '',
      slot: item.slot || '',
      room: '', // Not available in Go backend
      hours_conducted: item.hoursConducted || '',
      hours_absent: item.hoursAbsent || '',
      attendance: item.attendancePercentage || '',
      attendance_percentage: item.attendancePercentage || '0%',
    };
  });

  // Categorize subjects
  const theorySubjects = transformedSubjects.filter((s) => 
    (s.category as string).toLowerCase() === 'theory'
  );
  const labSubjects = transformedSubjects.filter((s) => 
    (s.category as string).toLowerCase() === 'lab' || 
    (s.category as string).toLowerCase() === 'practical'
  );
  const otherSubjects = transformedSubjects.filter((s) => {
    const cat = (s.category as string).toLowerCase();
    return cat !== 'theory' && cat !== 'lab' && cat !== 'practical';
  });

  // Calculate summary
  const totalHoursConducted = transformedSubjects.reduce((sum, s) => {
    const hours = parseInt(s.hours_conducted as string) || 0;
    return sum + hours;
  }, 0);

  const totalHoursAbsent = transformedSubjects.reduce((sum, s) => {
    const hours = parseInt(s.hours_absent as string) || 0;
    return sum + hours;
  }, 0);

  const overallPercentage = totalHoursConducted > 0
    ? `${((totalHoursConducted - totalHoursAbsent) / totalHoursConducted * 100).toFixed(2)}%`
    : '0%';

  return {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'SRM Academia Portal',
      academic_year: '', // Not available in Go backend
      institution: 'SRM Institute of Science and Technology',
      college: 'College of Engineering and Technology',
      scraped_at: new Date().toISOString(),
      registration_number: regNumber,
    },
    summary: {
      total_subjects: transformedSubjects.length,
      theory_subjects: theorySubjects.length,
      lab_subjects: labSubjects.length,
      other_subjects: otherSubjects.length,
      total_hours_conducted: totalHoursConducted,
      total_hours_absent: totalHoursAbsent,
      overall_attendance_percentage: overallPercentage,
    },
    subjects: {
      theory: theorySubjects,
      lab: labSubjects,
      other: otherSubjects,
    },
    all_subjects: transformedSubjects,
  };
}

/**
 * Transform Go backend marks format to frontend format
 * Go backend returns: { regNumber: string, marks: Array<{courseName, courseCode, courseType, overall, testPerformance}> }
 * Frontend expects: { courses: {theory, lab, other}, all_courses, summary, metadata }
 */
export function transformGoBackendMarks(goData: unknown): unknown {
  if (!goData) {
    return goData;
  }

  // Check if it's already an array (raw Go backend format from cache)
  if (Array.isArray(goData)) {
    console.log('[DataTransformer] Marks data is raw array format - transforming...');
    const marksArray = goData as Array<Record<string, unknown>>;
    const regNumber = ''; // Not available in raw array format
    
    // Transform the array directly
    return transformMarksArray(marksArray, regNumber);
  }

  if (typeof goData !== 'object') {
    return goData;
  }

  const data = goData as Record<string, unknown>;
  
  // Check if it's already in the correct format (has courses or all_courses)
  if ('courses' in data || 'all_courses' in data) {
    console.log('[DataTransformer] Marks data already in correct format');
    return goData;
  }

  // Check if it has the Go backend format (has marks array)
  if (!('marks' in data) || !Array.isArray(data.marks)) {
    console.warn('[DataTransformer] Marks data doesn\'t match Go backend format');
    return goData;
  }

  const marksArray = data.marks as Array<Record<string, unknown>>;
  const regNumber = (data.regNumber as string) || '';
  
  return transformMarksArray(marksArray, regNumber);
}

/**
 * Helper function to transform marks array to frontend format
 */
function transformMarksArray(marksArray: Array<Record<string, unknown>>, regNumber: string): unknown {

  // Transform each marks item to match frontend format
  const transformedCourses = marksArray.map((item) => {
    const overall = item.overall as { scored?: string; total?: string } | undefined;
    const testPerformance = item.testPerformance as Array<{
      test: string;
      marks: { scored: string; total: string };
    }> | undefined;

    // Convert testPerformance to assessments format
    const assessments = (testPerformance || []).map((test) => {
      const scored = parseFloat(test.marks.scored) || 0;
      const total = parseFloat(test.marks.total) || 0;
      const percentage = total > 0 ? ((scored / total) * 100).toFixed(2) : '0.00';
      
      return {
        assessment_name: test.test,
        marks_obtained: scored.toFixed(2),
        total_marks: total.toFixed(2),
        percentage: `${percentage}%`,
      };
    });

    const overallScored = parseFloat(overall?.scored || '0') || 0;
    const overallTotal = parseFloat(overall?.total || '0') || 0;
    const overallPercentage = overallTotal > 0 
      ? ((overallScored / overallTotal) * 100).toFixed(2) 
      : '0.00';

    return {
      course_code: item.courseCode || '',
      course_title: item.courseName || '',
      course_type: item.courseType || '',
      overall_marks: overallScored.toFixed(2),
      total_marks: overallTotal.toFixed(2),
      overall_percentage: `${overallPercentage}%`,
      assessments: assessments,
    };
  });

  // Categorize courses
  const theoryCourses = transformedCourses.filter((c) => 
    (c.course_type as string).toLowerCase() === 'theory'
  );
  const labCourses = transformedCourses.filter((c) => {
    const type = (c.course_type as string).toLowerCase();
    return type === 'lab' || type === 'practical';
  });
  const otherCourses = transformedCourses.filter((c) => {
    const type = (c.course_type as string).toLowerCase();
    return type !== 'theory' && type !== 'lab' && type !== 'practical';
  });

  // Calculate summary
  const totalAssessments = transformedCourses.reduce((sum, c) => {
    return sum + ((c.assessments as unknown[])?.length || 0);
  }, 0);

  return {
    metadata: {
      generated_at: new Date().toISOString(),
      source: 'SRM Academia Portal',
      academic_year: '', // Not available in Go backend
      institution: 'SRM Institute of Science and Technology',
      college: 'College of Engineering and Technology',
      scraped_at: new Date().toISOString(),
      registration_number: regNumber,
    },
    summary: {
      total_courses: transformedCourses.length,
      theory_courses: theoryCourses.length,
      lab_courses: labCourses.length,
      other_courses: otherCourses.length,
      total_assessments: totalAssessments,
    },
    courses: {
      theory: theoryCourses,
      lab: labCourses,
      other: otherCourses,
    },
    all_courses: transformedCourses,
  };
}

