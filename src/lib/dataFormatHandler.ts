/**
 * Data Format Handler
 * Handles transformation between Go backend format and Python scraper format for both marks and attendance
 */

import { transformGoMarksDataToPythonFormat, isGoFormat as isGoFormatMarks, isPythonFormat as isPythonFormatMarks } from './marksTransform';
import { transformGoAttendanceDataToPythonFormat, isGoFormat as isGoFormatAttendance, isPythonFormat as isPythonFormatAttendance } from './attendanceTransform';

/**
 * Transform marks data if it's in Go format
 */
export function transformMarksIfNeeded(data: unknown): unknown {
  if (!data) return data;

  if (isGoFormatMarks(data)) {
    console.log('[DataFormatHandler] 🔄 Transforming marks from Go format to Python format');
    const transformed = transformGoMarksDataToPythonFormat(data);
    if (transformed) {
      console.log('[DataFormatHandler] ✅ Marks transformation successful');
      return transformed;
    } else {
      console.warn('[DataFormatHandler] ⚠️ Marks transformation failed, returning original data');
      return data;
    }
  }

  if (isPythonFormatMarks(data)) {
    console.log('[DataFormatHandler] ✅ Marks already in Python format');
  }

  return data;
}

/**
 * Transform attendance data if it's in Go format
 */
export function transformAttendanceIfNeeded(data: unknown): unknown {
  if (!data) return data;

  if (isGoFormatAttendance(data)) {
    console.log('[DataFormatHandler] 🔄 Transforming attendance from Go format to Python format');
    const transformed = transformGoAttendanceDataToPythonFormat(data);
    if (transformed) {
      console.log('[DataFormatHandler] ✅ Attendance transformation successful');
      return transformed;
    } else {
      console.warn('[DataFormatHandler] ⚠️ Attendance transformation failed, returning original data');
      return data;
    }
  }

  if (isPythonFormatAttendance(data)) {
    console.log('[DataFormatHandler] ✅ Attendance already in Python format');
  }

  return data;
}

/**
 * Transform any data type based on the data type parameter
 */
export function transformDataIfNeeded(dataType: string, data: unknown): unknown {
  switch (dataType) {
    case 'marks':
      return transformMarksIfNeeded(data);
    case 'attendance':
      return transformAttendanceIfNeeded(data);
    default:
      return data;
  }
}
