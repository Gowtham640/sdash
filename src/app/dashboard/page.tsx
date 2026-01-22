'use client';
import React, { useState, useEffect } from "react";
import { getSlotOccurrences, getDayOrderStats, SlotOccurrence, DayOrderStats, TimetableData, type CalendarEvent } from "@/lib/timetableUtils";
import Link from "next/link";
import PillNav from '../../components/PillNav';
import StaggeredMenu from '../../components/StaggeredMenu';
import { setStorageItem, getStorageItem, removeStorageItem } from "@/lib/browserStorage";
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import NavigationButton from "@/components/NavigationButton";
import { useErrorTracking } from "@/lib/useErrorTracking";
import { SkeletonLoader } from "@/components/ui/loading";
import { getClientCache, setClientCache, removeClientCache } from "@/lib/clientCache";
import { normalizeAttendanceData } from '@/lib/dataTransformers';
import { Calendar, BookOpen, BarChart3, Calculator, User, Settings } from 'lucide-react';
import type { AttendanceData, MarksData } from '@/lib/apiTypes';
import { fetchCalendarFromSupabase } from "@/lib/calendarFetcher";

console.log("VERSION 2.0 - TESTING CACHE");

type TimeSlot = {
  time: string;
  course_title: string;
  category: string;
};

type MarksCourse = {
  course_code: string;
  course_title: string;
  subject_type: string;
  assessments: Array<{
    assessment_name: string;
    marks_obtained: string;
    total_marks: string;
    percentage: string;
  }>;
};

export default function Dashboard() {
  const [calendarData, setCalendarData] = useState<CalendarEvent[]>([]);
  const [attendanceData, setAttendanceData] = useState<AttendanceData | null>(null);
  const [marksData, setMarksData] = useState<MarksData | null>(null);
  const [timetableData, setTimetableData] = useState<{
    timetable?: Record<string, { do_name?: string; time_slots?: Record<string, unknown> }>;
    slot_mapping?: Record<string, string>;
  } | null>(null);
  const [slotOccurrences, setSlotOccurrences] = useState<SlotOccurrence[]>([]);
  const [dayOrderStats, setDayOrderStats] = useState<DayOrderStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [hasCache, setHasCache] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  // Track errors
  useErrorTracking(error, '/dashboard');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const menuItems = [
    { label: 'Home', ariaLabel: 'Go to home page', link: '/' },
    { label: 'About', ariaLabel: 'Learn about us', link: '/about' },
    { label: 'Services', ariaLabel: 'View our services', link: '/services' },
    { label: 'Contact', ariaLabel: 'Get in touch', link: '/contact' }
  ];

  const socialItems = [
    { label: 'Twitter', link: 'https://twitter.com' },
    { label: 'GitHub', link: 'https://github.com' },
    { label: 'LinkedIn', link: 'https://linkedin.com' }
  ];

  // Get current date in DD/MM/YYYY format
  const getCurrentDateString = () => {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // Convert calendar event date from "DD/Month 'YY" format to "DD/MM/YYYY" format
  const normalizeCalendarDate = (dateStr: string): string => {
    if (!dateStr) return dateStr;

    // Check if date is already in DD/MM/YYYY format
    const ddMMYYYYRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (ddMMYYYYRegex.test(dateStr)) {
      return dateStr;
    }

    // Handle "DD/Month 'YY" format (e.g., "19/Jul '25")
    const parts = dateStr.split('/');
    if (parts.length === 2) {
      const [day, monthYear] = parts;
      const [monthName, yearStr] = monthYear.split(' ');

      const monthNames: { [key: string]: number } = {
        'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
        'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
      };

      const monthNum = monthNames[monthName];
      if (monthNum && yearStr) {
        // Extract year from "'YY" format
        const shortYear = yearStr.replace("'", "");
        const fullYear = 2000 + parseInt(shortYear);
        const month = monthNum.toString().padStart(2, '0');
        const dayPadded = day.padStart(2, '0');
        return `${dayPadded}/${month}/${fullYear}`;
      }
    }

    // Return original if unable to parse
    return dateStr;
  };

  // Get yesterday, today, and tomorrow dates
  const getThreeDayDates = () => {
    const today = new Date();
    const dates = [];

    for (let i = -1; i <= 1; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      dates.push({
        dateStr: `${day}/${month}/${year}`,
        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dateObj: date
      });
    }

    return dates;
  };

  // Get current day's day order
  const getCurrentDayOrder = () => {
    if (!calendarData || !Array.isArray(calendarData) || calendarData.length === 0) {
      return null;
    }
    const currentDate = getCurrentDateString();
    const currentEvent = calendarData.find(event => event && event.date === currentDate);
    return currentEvent?.day_order || null;
  };

  // Get current day's day order number
  const getCurrentDayOrderNumber = () => {
    const dayOrder = getCurrentDayOrder();
    if (dayOrder && dayOrder.startsWith('DO ')) {
      return parseInt(dayOrder.split(' ')[1]);
    }
    // Handle non-working days (day_order: "-")
    if (dayOrder === '-') {
      return null;
    }
    return null;
  };

  // Get today's timetable based on day order
  const getTodaysTimetable = () => {
    console.log('[Dashboard] 🔍 getTodaysTimetable called');

    // Ensure calendar data is loaded before computing timetable
    if (!calendarData || !Array.isArray(calendarData) || calendarData.length === 0) {
      console.log('[Dashboard] ❌ getTodaysTimetable returning empty - calendar data not loaded yet');
      return [];
    }

    // Find today's event
    const currentDate = getCurrentDateString();
    const today = calendarData.find(event => event && event.date === currentDate);

    // Normalize the day order ONCE
    const doNumber = Number(today?.day_order);

    // Add guard for invalid day order
    if (Number.isNaN(doNumber)) {
      console.error("Invalid day order:", today?.day_order);
      return [];
    }

    console.log('[Dashboard] 📊 Timetable data exists:', !!timetableData);
    console.log('[Dashboard] 📊 Timetable data has timetable property:', !!timetableData?.timetable);
    console.log('[Dashboard] 📊 Available DO keys:', timetableData?.timetable ? Object.keys(timetableData.timetable) : 'no timetable data');

    if (!timetableData?.timetable) {
      console.log('[Dashboard] ❌ getTodaysTimetable returning empty - missing timetable data');
      return [];
    }

    // Use the correct timetable key
    const timetableForToday = timetableData.timetable[`DO ${doNumber}`];

    // Add ONE definitive log
    console.log("FINAL LOOKUP KEY:", `DO ${doNumber}`);
    console.log("FOUND TIMETABLE:", timetableForToday);

    const dayTimetable = timetableForToday;

    if (!dayTimetable?.time_slots) {
      console.log('[Dashboard] ❌ getTodaysTimetable returning empty - no time_slots for DO', doNumber);
      return [];
    }

    // Convert to array of {time, course_title, category}
    const timeSlots: TimeSlot[] = [];
    if (!dayTimetable || !dayTimetable.time_slots || typeof dayTimetable.time_slots !== 'object') {
      return timeSlots;
    }
    Object.entries(dayTimetable.time_slots).forEach(([time, slot]: [string, unknown]) => {
      const typedSlot = slot as { slot_code?: string; slot_type?: string };
      if (typedSlot?.slot_code) {
        // Find course title from slot mapping
        const slotCode = typedSlot.slot_code;
        const slotMapping = timetableData?.slot_mapping || {};
        const courseTitle = slotMapping[slotCode] || '';

        timeSlots.push({
          time,
          course_title: courseTitle,
          category: typedSlot.slot_type || ''
        });
      }
    });

    // Sort by start time of the time slot
    return timeSlots.sort((a, b) => {
      // Extract start time from "HH:MM-HH:MM" format
      const getStartTime = (timeStr: string): number => {
        const startTime = timeStr.split('-')[0]; // Get "HH:MM"
        const timeParts = startTime.split(':').map(Number);
        let hours = timeParts[0];
        const minutes = timeParts[1];

        // Convert 12-hour format to 24-hour for proper sorting
        // Times 01:xx through 07:xx are PM (13:xx to 19:xx in 24-hour)
        // Times 08:xx onwards are AM (keep as is)
        // Times 12:xx stay as 12:xx (noon)
        if (hours < 8 && hours !== 0) {
          hours += 12; // Convert 1PM-7PM to 13-19
        }

        const minutesValue = hours * 60 + minutes;
        return minutesValue;
      };
      return getStartTime(a.time) - getStartTime(b.time);
    });
  };

  useEffect(() => {
    checkAdminStatus();
    fetchUnifiedData();
  }, []);

  const checkAdminStatus = async () => {
    try {
      const access_token = getStorageItem('access_token');
      if (!access_token) {
        setIsAdmin(false);
        return;
      }

      const response = await fetch('/api/admin/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token })
      });

      const result = await response.json();
      setIsAdmin(result.success === true && result.isAdmin === true);
    } catch (err) {
      console.error('[Dashboard] Error checking admin status:', err);
      setIsAdmin(false);
    }
  };

  // Handle skeleton display with 2s delay when no cache found
  useEffect(() => {
    if (!loading) {
      setShowSkeleton(false);
      return;
    }

    // Check if we have any cache
    const cachedAttendance = getClientCache('attendance');
    const cachedMarks = getClientCache('marks');
    const cachedTimetable = getClientCache('timetable');
    const hasAnyCache = !!(cachedAttendance || cachedMarks || cachedTimetable);

    setHasCache(hasAnyCache);

    if (!hasAnyCache) {
      // Wait 2 seconds before showing skeleton
      const timer = setTimeout(() => {
        setShowSkeleton(true);
      }, 2000);

      return () => clearTimeout(timer);
    } else {
      // If cache exists, show skeleton immediately
      setShowSkeleton(true);
    }
  }, [loading]);

  const handleReAuthenticate = () => {
    setShowPasswordModal(false);
  };

  /**
   * Wait for password to be available in storage (handles race condition after login)
   * Retries with exponential backoff up to 5 attempts
   */
  const waitForPassword = async (maxAttempts = 5): Promise<string | null> => {
    const getPortalPassword = async () => {
      const { getPortalPassword } = await import('@/lib/passwordStorage');
      return getPortalPassword();
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const password = await getPortalPassword();

      if (password) {
        if (attempt > 1) {
          console.log(`[Dashboard] ✅ Password available after ${attempt} attempt(s)`);
        }
        return password;
      }

      if (attempt < maxAttempts) {
        // Exponential backoff: 200ms, 400ms, 800ms, 1600ms
        const delay = 200 * Math.pow(2, attempt - 1);
        console.log(`[Dashboard] ⏳ Password not available yet, retrying in ${delay}ms... (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.error('[Dashboard] ❌ Password not available after all retry attempts');
    return null;
  };

  const fetchUnifiedData = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);

      const access_token = getStorageItem('access_token');

      if (!access_token) {
        console.error('[Dashboard] No access token found');
        setError('Please sign in to view dashboard');
        setLoading(false);
        return;
      }

      removeClientCache('calendar');
      console.log('[Dashboard] 🗑️ Removed any existing calendar cache (calendar is always fresh)');

      const password = await waitForPassword();

      const fetchCacheEntry = async (dataType: 'attendance' | 'marks' | 'timetable') => {
        const response = await fetch('/api/data/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token, data_type: dataType }),
        });
        if (!response.ok) {
          throw new Error(`Cache request failed for ${dataType}`);
        }
        return response.json() as Promise<{ success: boolean; data: unknown; isExpired: boolean }>;
      };

      const refreshDataType = async (dataType: 'attendance' | 'marks' | 'timetable') => {
        const payload: Record<string, unknown> = { access_token, data_type: dataType };
        if (password) {
          payload.password = password;
        }
        const response = await fetch('/api/data/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const errText = await response.text().catch(() => 'Unknown error');
          throw new Error(`Backend refresh failed for ${dataType}: ${errText}`);
        }
        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || `Failed to refresh ${dataType}`);
        }
        return result;
      };

      const ensureFreshData = async (dataType: 'attendance' | 'marks' | 'timetable') => {
        if (forceRefresh) {
          await refreshDataType(dataType);
        }
        let cache = await fetchCacheEntry(dataType);
        if (!cache.success || cache.isExpired || !cache.data) {
          console.log(`[Dashboard] 🔄 Cache miss/expired for ${dataType}, requesting backend`);
          await refreshDataType(dataType);
          cache = await fetchCacheEntry(dataType);
        }
        if (!cache.success || !cache.data) {
          throw new Error(`Cache missing for ${dataType} even after refresh`);
        }
        return cache.data;
      };

      const [attendanceCache, marksCache, timetableCache] = await Promise.all([
        ensureFreshData('attendance'),
        ensureFreshData('marks'),
        ensureFreshData('timetable'),
      ]);

      const normalizedAttendance = normalizeAttendanceData(attendanceCache);
      if (!normalizedAttendance) {
        throw new Error('Attendance cache payload is malformed');
      }

      setClientCache('attendance', normalizedAttendance);
      const marksPayload = marksCache as MarksData;
      setClientCache('marks', marksPayload);
      setClientCache('timetable', timetableCache);

      const calendarEvents = await fetchCalendarFromSupabase();

      const unifiedPayload: Parameters<typeof processUnifiedData>[0] = {
        data: {
          calendar: { data: calendarEvents },
          attendance: { data: normalizedAttendance },
          marks: { data: marksPayload },
          timetable: { data: timetableCache },
        },
      };

      processUnifiedData(unifiedPayload);
      setHasCache(true);
      registerAttendanceFetch();

    } catch (err) {
      console.error('[Dashboard] Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const processUnifiedData = (result: {
    data: {
      calendar?: { data?: Array<unknown>; success?: { data?: Array<unknown> } } | null;
      attendance?: { data?: { all_subjects: unknown[]; metadata?: { semester?: number } }; success?: { data?: { all_subjects: unknown[]; metadata?: { semester?: number } } }; semester?: number } | null;
      marks?: { data?: { all_courses: unknown[] }; success?: { data?: { all_courses: unknown[] } } } | null;
      timetable?: { data?: unknown; success?: { data?: unknown } } | null;
    };
    metadata?: { semester?: number;[key: string]: unknown };
    semester?: number;
  }) => {
    console.log('[Dashboard] Processing unified data:', result);
    console.log('[Dashboard] Attendance data:', result.data.attendance);
    console.log('[Dashboard] Marks data:', result.data.marks);

    // Process calendar data - handle both direct format and wrapped format
    console.log('[Dashboard] 📋 ========================================');
    console.log('[Dashboard] 📋 CALENDAR PROCESSING - Starting calendar data processing');
    console.log('[Dashboard] 📋   - result.data.calendar exists:', !!result.data.calendar);
    console.log('[Dashboard] 📋   - result.data.calendar type:', typeof result.data.calendar);
    console.log('[Dashboard] 📋   - result.data.calendar is array:', Array.isArray(result.data.calendar));
    if (result.data.calendar && Array.isArray(result.data.calendar)) {
      console.log('[Dashboard] 📋   - Calendar array length:', result.data.calendar.length);
      if (result.data.calendar.length > 0) {
        console.log('[Dashboard] 📋   - First event sample:', JSON.stringify(result.data.calendar[0], null, 2).substring(0, 200));
        console.log('[Dashboard] 📋   - Last event sample:', JSON.stringify(result.data.calendar[result.data.calendar.length - 1], null, 2).substring(0, 200));
      }
    }
    console.log('[Dashboard] 📋 ========================================');

    const unwrapNestedData = (value: unknown): Record<string, unknown> | null => {
      let current = value;
      let depth = 0;

      while (current && typeof current === 'object' && depth < 5) {
        const obj = current as Record<string, unknown>;

        if ('data' in obj && obj.data && typeof obj.data === 'object' && obj.data !== current) {
          current = obj.data;
          depth += 1;
          continue;
        }

        return obj;
      }

      return typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : null;
    };

    let calendarEvents: CalendarEvent[] | null = null;

    if (Array.isArray(result.data.calendar)) {
      // Check if it's the new nested format: [{month: "Jan '26", dates: [{day, date, event, day_order}, ...]}, ...]
      const firstItem = result.data.calendar[0];
      if (firstItem && typeof firstItem === 'object' && 'month' in firstItem && 'dates' in firstItem) {
        // New nested format: [{month: "Jan '26", dates: [{day, date, event, day_order}, ...]}, ...]
        console.log('[Dashboard] 🔄 Detected new nested calendar format - flattening...');
        calendarEvents = [];
        result.data.calendar.forEach((monthData: any) => {
          if (monthData.month && Array.isArray(monthData.dates)) {
            monthData.dates.forEach((dateData: any) => {
              calendarEvents!.push({
                date: dateData.date?.toString() || '',
                day_name: dateData.day || '',
                content: dateData.event || '',
                day_order: dateData.day_order || '',
                month: monthData.month,
                month_name: monthData.month?.split(' ')[0] || '',
                year: monthData.month?.split(' ')[1] || ''
              });
            });
          }
        });
        console.log(`[Dashboard] ✅ Flattened ${calendarEvents.length} calendar events from nested format`);
      } else {
        // Direct array format (legacy)
        calendarEvents = result.data.calendar;
        console.log('[Dashboard] ✅ Calendar data is direct array format');
        console.log('[Dashboard]   - Total events:', calendarEvents.length);
      }
    } else if (result.data.calendar && typeof result.data.calendar === 'object') {
      // Check if it's wrapped format: {success: true, data: [...]}
      if ('success' in result.data.calendar && 'data' in result.data.calendar) {
        const calendarWrapper = result.data.calendar as { success?: boolean | { data?: CalendarEvent[] }; data?: CalendarEvent[] };
        const successValue = calendarWrapper.success;
        const isSuccess = typeof successValue === 'boolean' ? successValue : successValue !== undefined;
        if (isSuccess && Array.isArray(calendarWrapper.data)) {
          calendarEvents = calendarWrapper.data;
          console.log('[Dashboard] ✅ Calendar data is wrapped format');
          console.log('[Dashboard]   - Total events:', calendarEvents.length);
        }
      }
      // Check legacy nested format: {data: [...]}
      else if ('data' in result.data.calendar && Array.isArray((result.data.calendar as { data?: CalendarEvent[] }).data)) {
        calendarEvents = (result.data.calendar as { data: CalendarEvent[] }).data;
        console.log('[Dashboard] ✅ Calendar data is legacy nested format');
        console.log('[Dashboard]   - Total events:', calendarEvents.length);
      }
    }

    if (calendarEvents && calendarEvents.length > 0) {
      // Extract semester from multiple sources with fallbacks
      let extractedSemester: number | null = null;

      // 1. Try attendance data first - handle both direct and wrapped formats
      if (result.data.attendance && typeof result.data.attendance === 'object') {
        // Direct format: {metadata: {semester: ...}, ...}
        if ('metadata' in result.data.attendance && result.data.attendance.metadata && typeof result.data.attendance.metadata === 'object' && 'semester' in result.data.attendance.metadata) {
          extractedSemester = (result.data.attendance.metadata as { semester?: number }).semester || null;
          console.log('[Dashboard] Semester from attendance.metadata.semester (direct):', extractedSemester);
        }
        // Wrapped format: {data: {metadata: {semester: ...}}, ...}
        else if ('data' in result.data.attendance && result.data.attendance.data && typeof result.data.attendance.data === 'object' && 'metadata' in result.data.attendance.data) {
          const attendanceData = result.data.attendance.data as { metadata?: { semester?: number } };
          if (attendanceData.metadata?.semester) {
            extractedSemester = attendanceData.metadata.semester;
            console.log('[Dashboard] Semester from attendance.data.metadata.semester (wrapped):', extractedSemester);
          }
        }
        // Legacy: direct semester property
        else if ('semester' in result.data.attendance) {
          extractedSemester = (result.data.attendance as { semester?: number }).semester || null;
          console.log('[Dashboard] Semester from attendance.semester (legacy):', extractedSemester);
        }
      }
      // 2. Try response metadata
      else if (result.metadata?.semester) {
        extractedSemester = result.metadata.semester;
        console.log('[Dashboard] Semester from metadata.semester:', extractedSemester);
      }
      // 3. Try response root
      else if ((result as { semester?: number }).semester) {
        extractedSemester = (result as { semester?: number }).semester!;
        console.log('[Dashboard] Semester from root.semester:', extractedSemester);
      }
      // 4. Try storage cache
      else {
        const cachedSemester = getStorageItem('user_semester');
        if (cachedSemester) {
          extractedSemester = parseInt(cachedSemester, 10);
          console.log('[Dashboard] Semester from storage cache:', extractedSemester);
        }
      }

      // Default to 1 if no semester found
      const finalSemester = extractedSemester || 1;

      // Store semester in storage if found
      if (extractedSemester) {
        setStorageItem('user_semester', extractedSemester.toString());
        console.log('[Dashboard] 💾 Stored semester in storage:', extractedSemester);
      }

      console.log('[Dashboard] 📋 Calendar events count:', calendarEvents.length);
      if (calendarEvents.length > 0) {
        console.log('[Dashboard] 📋   - First event:', JSON.stringify(calendarEvents[0], null, 2).substring(0, 200));
        console.log('[Dashboard] 📋   - Sample dates range:', calendarEvents[0]?.date, 'to', calendarEvents[calendarEvents.length - 1]?.date);
      }

      // Normalize calendar event dates from "DD/Month 'YY" to "DD/MM/YYYY" format for proper matching
      const normalizedCalendarEvents = calendarEvents.map(event => ({
        ...event,
        date: normalizeCalendarDate(event.date)
      }));

      console.log('[Dashboard] 📋 Normalized calendar dates:');
      if (normalizedCalendarEvents.length > 0) {
        console.log('[Dashboard] 📋   - First normalized date:', normalizedCalendarEvents[0]?.date);
        console.log('[Dashboard] 📋   - Last normalized date:', normalizedCalendarEvents[normalizedCalendarEvents.length - 1]?.date);
      }

      // Display calendar data with normalized dates
      setCalendarData(normalizedCalendarEvents);
      console.log('[Dashboard] ✅ ✅ ✅ Calendar data loaded and set:', normalizedCalendarEvents.length, 'events');
    } else {
      console.warn('[Dashboard] ⚠️ No calendar data found');
      console.warn('[Dashboard] Calendar data type:', typeof result.data.calendar);
      console.warn('[Dashboard] Calendar data is array:', Array.isArray(result.data.calendar));
      setCalendarData([]);
    }

    // Process attendance data - handle both direct format and wrapped format
    let attendanceDataObj: AttendanceData | null = null;

    if (result.data.attendance && typeof result.data.attendance === 'object') {
      // Check if it's direct format (has all_subjects, summary, metadata at root)
      if ('all_subjects' in result.data.attendance || 'summary' in result.data.attendance) {
        // Direct format
        attendanceDataObj = result.data.attendance as AttendanceData;
        console.log('[Dashboard] Attendance data is direct format');
      }
      // Check if it's wrapped format: {success: true, data: {...}}
      else if ('success' in result.data.attendance && 'data' in result.data.attendance) {
        const attendanceWrapper = result.data.attendance as { success?: boolean | { data?: AttendanceData }; data?: AttendanceData };
        const successValue = attendanceWrapper.success;
        const isSuccess = typeof successValue === 'boolean' ? successValue : successValue !== undefined;
        if (isSuccess && attendanceWrapper.data) {
          attendanceDataObj = attendanceWrapper.data;
          console.log('[Dashboard] Attendance data is wrapped format');
        }
      }
      // Check legacy nested format: {data: {...}} or {success: {data: {...}}}
      else if ('data' in result.data.attendance) {
        const legacyData = (result.data.attendance as { data?: AttendanceData }).data;
        if (legacyData && ('all_subjects' in legacyData || 'summary' in legacyData)) {
          attendanceDataObj = legacyData;
          console.log('[Dashboard] Attendance data is legacy nested format');
        }
      }
    }

    if (attendanceDataObj && (attendanceDataObj.all_subjects || (attendanceDataObj as { summary?: unknown }).summary)) {
      setAttendanceData(attendanceDataObj);
      console.log('[Dashboard] ✅ Attendance data loaded:', attendanceDataObj.all_subjects?.length || 0);
    } else if (result.data.attendance !== undefined && result.data.attendance !== null) {
      // Only overwrite if attendance was explicitly provided in result (not undefined/null)
      // This prevents overwriting cached data when only calendar is fetched
      console.warn('[Dashboard] ⚠️ No attendance data found');
      console.warn('[Dashboard] Attendance data type:', typeof result.data.attendance);
      console.warn('[Dashboard] Attendance data value:', result.data.attendance);
      setAttendanceData(null);
    } else {
      // result.data.attendance is undefined/null - don't overwrite existing state (likely from cache)
      console.log('[Dashboard] ℹ️ Attendance not in API response, keeping existing state (likely from cache)');
    }

    // Process marks data - handle both direct format and wrapped format
    let marksDataObj: MarksData | null = null;

    if (result.data.marks && typeof result.data.marks === 'object') {
      // Check if it's direct format (has all_courses, summary, metadata at root)
      if ('all_courses' in result.data.marks || 'summary' in result.data.marks) {
        // Direct format
        marksDataObj = result.data.marks as MarksData;
        console.log('[Dashboard] Marks data is direct format');
      }
      // Check if it's wrapped format: {success: true, data: {...}}
      else if ('success' in result.data.marks && 'data' in result.data.marks) {
        const marksWrapper = result.data.marks as { success?: boolean | { data?: MarksData }; data?: MarksData };
        const successValue = marksWrapper.success;
        const isSuccess = typeof successValue === 'boolean' ? successValue : successValue !== undefined;
        if (isSuccess && marksWrapper.data) {
          marksDataObj = marksWrapper.data;
          console.log('[Dashboard] Marks data is wrapped format');
        }
      }
      // Check legacy nested format: {data: {...}} or {success: {data: {...}}}
      else if ('data' in result.data.marks) {
        const legacyData = (result.data.marks as { data?: MarksData }).data;
        if (legacyData && ('all_courses' in legacyData || 'summary' in legacyData)) {
          marksDataObj = legacyData;
          console.log('[Dashboard] Marks data is legacy nested format');
        }
      }
    }

    if (marksDataObj && (marksDataObj.all_courses || (marksDataObj as { summary?: unknown }).summary)) {
      setMarksData(marksDataObj);
      console.log('[Dashboard] ✅ Marks data loaded:', marksDataObj.all_courses?.length || 0);
    } else if (result.data.marks !== undefined && result.data.marks !== null) {
      // Only overwrite if marks was explicitly provided in result (not undefined/null)
      // This prevents overwriting cached data when only calendar is fetched
      console.warn('[Dashboard] ⚠️ No marks data found');
      console.warn('[Dashboard] Marks data type:', typeof result.data.marks);
      console.warn('[Dashboard] Marks data value:', result.data.marks);
      setMarksData(null);
    } else {
      // result.data.marks is undefined/null - don't overwrite existing state (likely from cache)
      console.log('[Dashboard] ℹ️ Marks not in API response, keeping existing state (likely from cache)');
    }

    // Process timetable data
    let timetableDataObj: typeof timetableData | null = null;
    let timetableSource: Record<string, unknown> | null = null;
    let timetableProvided = false;

    if (result.data.timetable !== undefined && result.data.timetable !== null) {
      timetableProvided = true;
      timetableSource = unwrapNestedData(result.data.timetable);
    }

    if (timetableSource) {
      // Check if it's backend schedule format and transform it
      if (timetableSource.schedule && Array.isArray(timetableSource.schedule)) {
        console.log('[Dashboard] 🔄 Transforming backend schedule format...');

        const timeSlots = [
          "08:00-08:50", "08:50-09:40", "09:45-10:35", "10:40-11:30", "11:35-12:25",
          "12:30-01:20", "01:25-02:15", "02:20-03:10", "03:10-04:00", "04:00-04:50"
        ];

        const schedule = timetableSource.schedule as Array<{ day: number; table: Array<unknown> }> | undefined;
        if (!schedule || !Array.isArray(schedule)) {
          console.warn('[Dashboard] Invalid schedule format');
          timetableDataObj = {
            slot_mapping: {},
            timetable: {}
          };
        } else {
          const timetable: Record<string, { do_name?: string; time_slots?: Record<string, unknown> }> = {};
          const slotMapping: Record<string, string> = {};

          // Map day numbers (1-5) to DO names
          const dayToDO: Record<number, string> = {
            1: 'DO 1',
            2: 'DO 2',
            3: 'DO 3',
            4: 'DO 4',
            5: 'DO 5'
          };

          schedule.forEach((daySchedule) => {
            const doName = dayToDO[daySchedule.day];
            if (!doName) return;

            const timeSlotsMap: Record<string, unknown> = {};

            daySchedule.table.forEach((entry, index) => {
              if (entry && typeof entry === 'object' && entry !== null) {
                const course = entry as { code?: string; name?: string; slot?: string; courseType?: string; slotType?: string; online?: boolean };
                if (course.code && course.name && course.slot) {
                  const timeSlot = timeSlots[index] || `Slot ${index + 1}`;
                  const slotCode = course.slot;
                  const courseTitle = course.name;
                  const courseType = course.courseType || 'Theory';
                  const slotType = course.slotType || (courseType === 'Practical' ? 'Lab' : 'Theory');

                  timeSlotsMap[timeSlot] = {
                    slot_code: slotCode,
                    course_title: courseTitle,
                    slot_type: slotType,
                    is_alternate: false
                  };

                  // Build slot mapping
                  if (!slotMapping[slotCode]) {
                    slotMapping[slotCode] = courseTitle;
                  }
                }
              }
            });

            if (Object.keys(timeSlotsMap).length > 0) {
              timetable[doName] = {
                do_name: doName,
                time_slots: timeSlotsMap
              };
            }
          });

          timetableDataObj = {
            slot_mapping: slotMapping,
            timetable: timetable
          };
        }

        console.log('[Dashboard] ✅ Transformed backend schedule format');
        console.log('[Dashboard] 📊 Fresh timetable structure after transformation:', {
          hasTimetable: !!timetableDataObj?.timetable,
          hasSlotMapping: !!timetableDataObj?.slot_mapping,
          timetableKeys: timetableDataObj?.timetable ? Object.keys(timetableDataObj.timetable) : 'no timetable',
          slotMappingKeys: timetableDataObj?.slot_mapping ? Object.keys(timetableDataObj.slot_mapping) : 'no slot_mapping',
          sampleSlotMapping: timetableDataObj?.slot_mapping ? Object.entries(timetableDataObj.slot_mapping).slice(0, 3) : 'no slot_mapping'
        });
      }

      // Handle cached payloads that already match the TimetableData structure
      if (!timetableDataObj && 'timetable' in timetableSource && typeof timetableSource.timetable === 'object') {
        const slotMappingCandidate = timetableSource.slot_mapping && typeof timetableSource.slot_mapping === 'object'
          ? (timetableSource.slot_mapping as Record<string, string>)
          : {};

        const timetableCandidate = timetableSource.timetable as Record<string, { do_name?: string; time_slots?: Record<string, unknown> }> | undefined;

        timetableDataObj = {
          slot_mapping: slotMappingCandidate,
          timetable: timetableCandidate || {}
        };

        console.log('[Dashboard] ✅ Using cached timetable structure (timtable property detected)');
        console.log('[Dashboard] 📊 Cached timetable keys:', timetableDataObj.timetable ? Object.keys(timetableDataObj.timetable) : []);
      }
    }

    if (timetableDataObj) {
      console.log('[Dashboard] 📊 Setting timetable data in state');
      setTimetableData(timetableDataObj);

      try {
        // Convert to TimetableData format for getSlotOccurrences
        const timetableForUtils = {
          timetable: (timetableDataObj.timetable || {}) as TimetableData['timetable'],
          slot_mapping: timetableDataObj.slot_mapping,
        } as TimetableData;
        const occurrences = getSlotOccurrences(timetableForUtils);
        setSlotOccurrences(occurrences);
        console.log('[Dashboard] ✅ Timetable data loaded:', occurrences.length);
      } catch (err) {
        console.error('[Dashboard] ❌ Error processing timetable:', err);
      }
    } else if (timetableProvided) {
      // Only overwrite if timetable was explicitly provided in result (not undefined/null)
      // This prevents overwriting cached data when only calendar is fetched
      console.warn('[Dashboard] ⚠️ No timetable data found');
      console.warn('[Dashboard] Timetable data type:', typeof result.data.timetable);
      console.warn('[Dashboard] Timetable data value:', result.data.timetable);
      setTimetableData(null);
    } else {
      // result.data.timetable is undefined/null - don't overwrite existing state (likely from cache)
      console.log('[Dashboard] ℹ️ Timetable not in API response, keeping existing state (likely from cache)');
    }

    // Process day order stats using calendar data (whether direct array or wrapped)
    let calendarForStats: any[] | null = null;

    if (result.data.calendar) {
      if (Array.isArray(result.data.calendar)) {
        // Direct array format
        calendarForStats = result.data.calendar;
      } else if (result.data.calendar.data && Array.isArray(result.data.calendar.data)) {
        // Wrapped format: {data: [...]}
        calendarForStats = result.data.calendar.data;
      } else if (result.data.calendar.success?.data && Array.isArray(result.data.calendar.success.data)) {
        // Wrapped format: {success: {data: [...]}}
        calendarForStats = result.data.calendar.success.data;
      }
    }

    if (calendarForStats && Array.isArray(calendarForStats)) {
      try {
        // Extract semester using same logic as above
        let extractedSemester: number | null = null;

        if (result.data.attendance?.semester) {
          extractedSemester = result.data.attendance.semester;
        } else if (result.data.attendance?.data?.metadata?.semester) {
          extractedSemester = result.data.attendance.data.metadata.semester;
        } else if (result.metadata?.semester) {
          extractedSemester = result.metadata.semester;
        } else if ((result as { semester?: number }).semester) {
          extractedSemester = (result as { semester?: number }).semester!;
        } else {
          const cachedSemester = getStorageItem('user_semester');
          if (cachedSemester) {
            extractedSemester = parseInt(cachedSemester, 10);
          }
        }

        // Process calendar data to match CalendarEvent interface (map 'event' to 'content')
        const processedCalendarForStats = (calendarForStats as any[]).map((e: any) => ({
          date: e.date,
          day_name: e.day_name,
          content: e.event ?? '',
          day_order: e.day_order,
          month: e.month,
          month_name: e.month,
          year: e.year
        }));

        // Calculate day order stats from processed calendar data
        const stats = getDayOrderStats(processedCalendarForStats);
        setDayOrderStats(stats);
        console.log('[Dashboard] ✅ Day order stats loaded:', stats);
      } catch (err) {
        console.error('[Dashboard] ❌ Error processing day order stats:', err);
      }
    }

    // Save to client-side cache (1 hour TTL)
    // Note: Calendar is NOT cached - it's always fetched fresh from public.calendar table
    const cacheData = {
      data: {
        attendance: attendanceDataObj || attendanceData,
        marks: marksDataObj || marksData,
        timetable: timetableDataObj || timetableData,
      },
    };
    setClientCache('unified', cacheData);
    console.log('[Dashboard] 💾 Saved to client-side cache (1 hour TTL) - calendar excluded (always fresh)');
  };

  const calculatePresentHours = (conducted: string, absent: string): number => {
    const conductedNum = parseInt(conducted) || 0;
    const absentNum = parseInt(absent) || 0;
    return conductedNum - absentNum;
  };

  if (loading && !showSkeleton) {
    // Show minimal loading state for first 2 seconds if no cache
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8 justify-center overflow-hidden py-6 sm:py-8 md:py-9 lg:py-10">
        <PillNav
          logo=""
          logoAlt=""
          items={[
            { label: 'Attendance', href: '/attendance' },
            { label: 'Timetable', href: '/timetable' },
            { label: 'Marks', href: '/marks' },
            { label: 'Calendar', href: '/calender' },
            { label: 'SPGA Calculator', href: '/spga-calculator' },
            ...(isAdmin ? [{ label: 'Admin', href: '/admin' }] : [])
          ]}
          activeHref="/dashboard"
          className="custom-nav"
          ease="power2.easeOut"
          pillColor="#000000"
          baseColor="#ffffff"
          hoveredPillTextColor="#000000"
          pillTextColor="#ffffff"
        />
      </div>
    );
  }

  if (loading && showSkeleton) {
    // Show skeleton UI after 2s delay or immediately if cache exists
    const threeDayDates = getThreeDayDates();

    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8 justify-center overflow-hidden py-6 sm:py-8 md:py-9 lg:py-10">
        <PillNav
          logo=""
          logoAlt=""
          items={[
            { label: 'Attendance', href: '/attendance' },
            { label: 'Timetable', href: '/timetable' },
            { label: 'Marks', href: '/marks' },
            { label: 'Calendar', href: '/calender' },
            { label: 'SPGA Calculator', href: '/spga-calculator' },
            ...(isAdmin ? [{ label: 'Admin', href: '/admin' }] : [])
          ]}
          activeHref="/dashboard"
          className="custom-nav"
          ease="power2.easeOut"
          pillColor="#000000"
          baseColor="#ffffff"
          hoveredPillTextColor="#000000"
          pillTextColor="#ffffff"
        />
        <div className="mt-10 sm:mt-12 md:mt-14 lg:mt-16 mb-6 sm:mb-7 md:mb-8 lg:mb-8 flex flex-col items-center gap-4">
          <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
            Welcome to your Dashboard
          </div>
        </div>

        {/* Calendar Section - Show actual calendar if available */}
        <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
          <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
            Upcoming Calendar
          </div>
          <div className="flex flex-col gap-3 w-full">
            {threeDayDates.map((dayInfo) => {
              const event = Array.isArray(calendarData) ? calendarData.find(e => e && e.date === dayInfo.dateStr) : null;
              const isToday = dayInfo.dateStr === getCurrentDateString();
              const isHoliday = event?.day_order === "-" || event?.day_order === "DO -" || (event?.content && event.content.toLowerCase().includes('holiday'));

              let bgColor = 'bg-white/10';
              let textColor = 'text-white';

              if (isToday) {
                bgColor = 'bg-white';
                textColor = 'text-black';
              } else if (isHoliday) {
                bgColor = 'bg-green-500/80';
                textColor = 'text-white';
              }

              return (
                <div
                  key={dayInfo.dateStr}
                  className={`relative p-2 sm:p-2 md:p-2.5 lg:p-2.5 z-10 w-full h-auto backdrop-blur ${bgColor} border border-white/20 rounded-2xl ${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora flex flex-col sm:flex-row gap-1.5 sm:gap-3 md:gap-4 lg:gap-4 justify-between items-center`}
                >
                  <div className="flex gap-1.5 sm:gap-2 md:gap-3 lg:gap-3 items-center">
                    <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora font-bold min-w-[60px] sm:min-w-[70px] md:min-w-[80px] lg:min-w-[85px]`}>
                      {dayInfo.dayName}
                    </p>
                    <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora`}>
                      {dayInfo.dateStr}
                    </p>
                  </div>
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora flex-1 text-center`}>
                    {event?.content || 'No events'}
                  </p>
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora font-bold min-w-[50px] sm:min-w-[60px] md:min-w-[65px] lg:min-w-[70px] text-right`}>
                    {event?.day_order || '-'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Today's Timetable Section - Skeleton */}
        <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
          <SkeletonLoader className="w-full h-8 mb-2" />
          <div className="flex flex-col gap-3 w-full">
            {[1, 2, 3].map((i) => (
              <SkeletonLoader key={i} className="w-full h-16 rounded-2xl" />
            ))}
          </div>
        </div>

        {/* Attendance Section - Skeleton */}
        <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
          <SkeletonLoader className="w-full h-8 mb-2" />
          <div className="flex flex-col gap-3 w-full">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonLoader key={i} className="w-full h-20 rounded-2xl" />
            ))}
          </div>
        </div>

        {/* Marks Section - Skeleton */}
        <div className="relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center">
          <SkeletonLoader className="w-full h-8 mb-2" />
          <div className="flex flex-col gap-3 w-full">
            {[1, 2, 3, 4].map((i) => (
              <SkeletonLoader key={i} className="w-full h-20 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-6 sm:gap-7 md:gap-7 lg:gap-8 justify-center overflow-hidden">
        <div className="text-red-400 text-base sm:text-lg md:text-xl lg:text-2xl font-sora text-center px-4">{error}</div>
        {error.includes('session') && (
          <NavigationButton
            path="/auth"
            onClick={handleReAuthenticate}
            className="px-4 py-2 sm:px-5 sm:py-2.5 md:px-6 md:py-3 lg:px-6 lg:py-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm sm:text-base"
          >
            Sign In Again
          </NavigationButton>
        )}
      </div>
    );
  }

  const threeDayDates = getThreeDayDates();
  const todaysTimetable = getTodaysTimetable();
  const currentDayOrder = getCurrentDayOrder();

  console.log('[Dashboard] 🎯 Rendering dashboard with timetable info:', {
    currentDayOrder,
    todaysTimetableLength: todaysTimetable.length,
    timetableDataExists: !!timetableData,
    timetableDataKeys: timetableData ? Object.keys(timetableData) : 'no timetable data'
  });

  return (
    <div className="relative bg-black items-center justify-items-center min-h-screen flex flex-col gap-4 sm:gap-6 md:gap-7 lg:gap-8 justify-center overflow-hidden py-6 sm:py-8 md:py-9 lg:py-10">
      <PillNav
        logo=""
        logoAlt=""
        items={[
          { label: 'Attendance', href: '/attendance' },
          { label: 'Timetable', href: '/timetable' },
          { label: 'Marks', href: '/marks' },
          { label: 'Calendar', href: '/calender' },
          ...(isAdmin ? [{ label: 'Admin', href: '/admin' }] : [])
        ]}
        activeHref="/dashboard"
        className="custom-nav"
        ease="power2.easeOut"
        pillColor="#000000"
        baseColor="#ffffff"
        hoveredPillTextColor="#000000"
        pillTextColor="#ffffff"
      />


      {/* Expandable Sidebar - Only visible on medium and larger screens */}
      <div className="hidden md:block">
        {/* Sidebar Toggle Button */}
        <button
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          className={`fixed top-14 left-4 z-[1001] bg-white/10 backdrop-blur border border-white/20 rounded-full p-2 transition-all duration-300 hover:bg-white/20 ${sidebarExpanded ? 'left-64' : 'left-4'
            }`}
          aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg
            className={`w-5 h-5 text-white transition-transform duration-300 ${sidebarExpanded ? 'rotate-180' : 'rotate-0'
              }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Sidebar */}
        <div
          className={`fixed left-0 top-0 h-full z-[1000] transition-all duration-300 ease-in-out ${sidebarExpanded ? 'w-64' : 'w-16'
            }`}
        >
          {/* Glass Background - only visible when expanded */}
          <div
            className={`absolute inset-0 backdrop-blur bg-black/80 border-r border-white/20 transition-opacity duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0'
              }`}
          />

          {/* Sidebar Content */}
          <div className="relative h-full flex flex-col">
            {/* Header - only visible when expanded */}
            <div
              className={`p-6 border-b border-white/10 transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0'
                }`}
            >
              <h2 className="text-xl font-sora font-bold text-white">Navigation</h2>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 p-4 space-y-4">
              {/* Attendance */}
              <div className="relative group">
                <Link
                  href="/attendance"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-blue-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "Attendance"}
                >
                  <User className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    Attendance
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute font-sora left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    Attendance
                  </div>
                )}
              </div>

              {/* Timetable */}
              <div className="relative group">
                <Link
                  href="/timetable"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-blue-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "Timetable"}
                >
                  <BookOpen className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    Timetable
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute font-sora left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    Timetable
                  </div>
                )}
              </div>

              {/* Marks */}
              <div className="relative group">
                <Link
                  href="/marks"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-blue-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "Marks"}
                >
                  <BarChart3 className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    Marks
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute font-sora left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    Marks
                  </div>
                )}
              </div>

              {/* Calendar */}
              <div className="relative group">
                <Link
                  href="/calender"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-blue-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "Calendar"}
                >
                  <Calendar className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    Calendar
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute font-sora left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    Calendar
                  </div>
                )}
              </div>

              {/* SGPA Calculator */}
              <div className="relative group">
                <Link
                  href="/sgpa-calculator"
                  className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-white hover:text-green-300 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                  title={sidebarExpanded ? "" : "SGPA Calculator"}
                >
                  <Calculator className="w-6 h-6 flex-shrink-0" />
                  <span
                    className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                      }`}
                  >
                    SGPA Calculator
                  </span>
                </Link>
                {!sidebarExpanded && (
                  <div className="absolute left-full ml-2 px-2 py-1 font-sora bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                    SGPA Calculator
                  </div>
                )}
              </div>

              {/* Admin - only show if admin */}
              {isAdmin && (
                <div className="relative group">
                  <Link
                    href="/admin"
                    className={`flex items-center ${sidebarExpanded ? 'space-x-3' : 'justify-center'} text-red-300 hover:text-red-200 transition-all duration-300 hover:scale-105 p-2 rounded-lg hover:bg-white/10`}
                    title={sidebarExpanded ? "" : "Admin"}
                  >
                    <Settings className="w-6 h-6 flex-shrink-0" />
                    <span
                      className={`font-sora text-sm whitespace-nowrap transition-all duration-300 ${sidebarExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
                        }`}
                    >
                      Admin
                    </span>
                  </Link>
                  {!sidebarExpanded && (
                    <div className="absolute left-full ml-2 px-2 py-1 bg-black/80 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                      Admin
                    </div>
                  )}
                </div>
              )}
            </nav>
          </div>
        </div>
      </div>


      <div className={`mt-10 sm:mt-12 md:mt-14 lg:mt-16 mb-6 sm:mb-7 md:mb-8 lg:mb-8 flex flex-col items-center gap-4 transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
        <div className="text-white text-xl sm:text-2xl md:text-3xl lg:text-4xl font-sora font-bold text-center">
          Welcome to your Dashboard
        </div>
      </div>

      {/* Calendar Section - Show 3 days (Yesterday, Today, Tomorrow) */}
      <div className={`relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Upcoming Calendar
        </div>
        <div className="flex flex-col gap-3 w-full">
          {threeDayDates.map((dayInfo) => {
            const event = Array.isArray(calendarData) ? calendarData.find(e => e && e.date === dayInfo.dateStr) : null;
            const isToday = dayInfo.dateStr === getCurrentDateString();

            // Enhanced holiday detection: check day_order and content
            const dayOrder = event?.day_order || '';
            const content = event?.content || '';
            const isHoliday =
              dayOrder === "-" ||
              dayOrder === "DO -" ||
              dayOrder.toLowerCase() === "holiday" ||
              dayOrder.toLowerCase().includes('holiday') ||
              (content && content.toLowerCase().includes('holiday'));

            let bgColor = 'bg-white/10';
            let textColor = 'text-white';

            if (isToday) {
              bgColor = 'bg-white';
              textColor = 'text-black';
            } else if (isHoliday) {
              bgColor = 'bg-green-500/80';
              textColor = 'text-white';
            }

            // Display content (handle empty string as 'No events')
            const displayContent = content && content.trim() !== '' ? content : 'No events';

            return (
              <div
                key={dayInfo.dateStr}
                className={`relative p-2 sm:p-2 md:p-2.5 lg:p-2.5 z-10 w-full h-auto backdrop-blur ${bgColor} border border-white/20 rounded-2xl ${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora flex flex-col sm:flex-row gap-1.5 sm:gap-3 md:gap-4 lg:gap-4 justify-between items-center`}
              >
                <div className="flex gap-1.5 sm:gap-2 md:gap-3 lg:gap-3 items-center">
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora font-bold min-w-[60px] sm:min-w-[70px] md:min-w-[80px] lg:min-w-[85px]`}>
                    {dayInfo.dayName}
                  </p>
                  <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora`}>
                    {dayInfo.dateStr}
                  </p>
                </div>
                <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora flex-1 text-center`}>
                  {displayContent}
                </p>
                <p className={`${textColor} text-xs sm:text-sm md:text-base lg:text-base font-sora font-bold min-w-[50px] sm:min-w-[60px] md:min-w-[65px] lg:min-w-[70px] text-right`}>
                  {dayOrder || '-'}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Today's Timetable Section */}
      <div className={`relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Today&apos;s Timetable {currentDayOrder && `- ${currentDayOrder}`}
        </div>
        {todaysTimetable.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {todaysTimetable.map((slot, index) => (
              <div
                key={index}
                className="relative p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-auto backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col sm:flex-row gap-2 sm:gap-4 md:gap-6 lg:gap-8 justify-start items-center"
              >
                <div className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-light min-w-[100px] sm:min-w-[120px] md:min-w-[130px] lg:min-w-[150px] whitespace-nowrap">
                  {slot.time}
                </div>
                <div className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold flex-1">
                  {slot.course_title || 'No class'}
                </div>
                {slot.category && (
                  <div className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">
                    {slot.category}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-white/70 text-lg font-sora">
            {currentDayOrder ? 'No classes today' : 'Unable to determine day order'}
          </div>
        )}
      </div>

      {/* Attendance Section */}
      <div className={`relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Attendance Overview
        </div>
        {attendanceData?.all_subjects && Array.isArray(attendanceData.all_subjects) && attendanceData.all_subjects.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {attendanceData.all_subjects.map((subject, index) => {
              if (!subject || !subject.attendance_percentage) return null; // Skip null/invalid subjects
              const attendancePercent = parseFloat(subject.attendance_percentage.replace('%', ''));

              return (
                <div
                  key={index}
                  className="relative p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-auto backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-row gap-3 sm:gap-4 md:gap-5 lg:gap-6 justify-between items-center"
                >
                  <div className="flex-1">
                    <p className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold">
                      {subject.course_title}
                    </p>
                    <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">
                      {subject.category}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className={`text-lg sm:text-xl md:text-2xl lg:text-2xl font-bold ${attendancePercent >= 75 ? 'text-green-400' : 'text-red-400'}`}>
                      {subject.attendance_percentage}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-white/70 text-lg font-sora">
            No attendance data available
          </div>
        )}
      </div>

      {/* Marks Section */}
      <div className={`relative p-4 sm:p-5 md:p-6 lg:p-7 z-10 w-[95vw] sm:w-[85vw] md:w-[70vw] lg:w-[60vw] h-auto backdrop-blur bg-white/10 border border-white/20 rounded-3xl text-white text-base sm:text-lg md:text-xl lg:text-3xl font-sora flex flex-col gap-3 sm:gap-4 md:gap-4 lg:gap-4 justify-center items-center transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-16'
        }`}>
        <div className="text-white text-base sm:text-lg md:text-xl lg:text-2xl font-sora font-bold mb-1.5 sm:mb-2">
          Marks Overview
        </div>
        {marksData?.all_courses && Array.isArray(marksData.all_courses) && marksData.all_courses.length > 0 ? (
          <div className="flex flex-col gap-3 w-full">
            {marksData.all_courses
              .filter(course => course && course.assessments && Array.isArray(course.assessments) && course.assessments.length > 0)
              .filter((course, index, self) =>
                course && index === self.findIndex(c =>
                  c && c.course_code === course.course_code && c.subject_type === course.subject_type
                )
              )
              .map((course, index) => {
                if (!course) return null;

                const getCourseTitle = (course: MarksCourse): string => {
                  return course.course_title || course.course_code;
                };

                const getTotalMarks = () => {
                  if (!course.assessments || !Array.isArray(course.assessments) || course.assessments.length === 0) return { obtained: 0, total: 0 };
                  const obtained = course.assessments.reduce((sum, a) => sum + (a ? (parseFloat(a.marks_obtained) || 0) : 0), 0);
                  const total = course.assessments.reduce((sum, a) => sum + (a ? (parseFloat(a.total_marks) || 0) : 0), 0);
                  return { obtained, total };
                };

                const { obtained, total } = getTotalMarks();

                return (
                  <div
                    key={`${course.course_code}-${course.subject_type}-${index}`}
                    className="relative p-3 sm:p-3.5 md:p-4 lg:p-4 z-10 w-full h-auto backdrop-blur bg-white/10 border border-white/20 rounded-2xl text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora flex flex-col sm:flex-row gap-3 sm:gap-4 md:gap-5 lg:gap-6 justify-between items-center"
                  >
                    <div className="flex-1">
                      <p className="text-white text-xs sm:text-sm md:text-base lg:text-lg font-sora font-bold">
                        {getCourseTitle(course)}
                      </p>
                      <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">
                        {course.course_code} • {course.subject_type}
                      </p>
                    </div>
                    <div className="flex gap-4 sm:gap-5 md:gap-6 lg:gap-6 items-center">
                      <div className="text-center">
                        <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">Obtained</p>
                        <p className="text-green-400 text-lg sm:text-xl md:text-xl lg:text-xl font-bold">{obtained.toFixed(1)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-white/70 text-[10px] sm:text-xs md:text-sm lg:text-sm font-sora">Total</p>
                        <p className="text-white text-lg sm:text-xl md:text-xl lg:text-xl font-bold">{total.toFixed(1)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div className="text-white/70 text-lg font-sora">
            No marks data available
          </div>
        )}
      </div>

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
