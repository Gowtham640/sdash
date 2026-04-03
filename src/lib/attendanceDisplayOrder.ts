import type { CalendarEvent } from '@/lib/timetableUtils';
import type { AttendanceSubject } from '@/lib/apiTypes';

/** Matches dashboard timetable slot shape for ordering and schedule UI. */
export type TimetableCourseSlot = {
  time: string;
  course_title: string;
  category: string;
  room?: string;
};

export type TimetableLike = {
  timetable?: Record<string, { time_slots?: Record<string, unknown> }>;
  slot_mapping?: Record<string, string>;
} | null;

export function getCurrentDateString(): string {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
}

function normalizeDayOrderValue(value?: string | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

export function isHolidayDayOrder(dayOrder?: string | null): boolean {
  const normalized = normalizeDayOrderValue(dayOrder);
  if (!normalized) {
    return false;
  }
  return normalized === '-' || normalized.toLowerCase().includes('holiday');
}

export function getCurrentDayOrderFromCalendar(calendarData: CalendarEvent[]): string | null {
  if (!calendarData || !Array.isArray(calendarData) || calendarData.length === 0) {
    return null;
  }
  const currentDate = getCurrentDateString();
  const currentEvent = calendarData.find((event) => event && event.date === currentDate);
  return normalizeDayOrderValue(currentEvent?.day_order);
}

export function getDayOrderNumberFromDayOrder(dayOrder: string | null): number | null {
  if (!dayOrder || isHolidayDayOrder(dayOrder)) {
    return null;
  }
  const match = dayOrder.match(/\d+/);
  if (!match) {
    return null;
  }
  const parsed = parseInt(match[0], 10);
  return Number.isNaN(parsed) || parsed < 1 || parsed > 5 ? null : parsed;
}

/**
 * Same slot list as dashboard "today" schedule: DO key, slot_mapping titles, time order.
 */
export function getTodaysTimetableCourseSlots(
  calendarData: CalendarEvent[],
  timetableData: TimetableLike
): TimetableCourseSlot[] {
  const currentDayOrder = getCurrentDayOrderFromCalendar(calendarData);
  if (isHolidayDayOrder(currentDayOrder)) {
    return [];
  }

  const doNumber = getDayOrderNumberFromDayOrder(currentDayOrder);
  if (doNumber == null) {
    return [];
  }

  if (!timetableData?.timetable) {
    return [];
  }

  const key = `DO ${doNumber}`;
  const timetableForToday = timetableData.timetable[key];

  if (!timetableForToday?.time_slots) {
    return [];
  }

  const timeSlots: TimetableCourseSlot[] = [];
  if (!timetableForToday.time_slots || typeof timetableForToday.time_slots !== 'object') {
    return timeSlots;
  }

  Object.entries(timetableForToday.time_slots).forEach(([time, slot]) => {
    const typedSlot = slot as {
      slot_code?: string;
      slot_type?: string;
      room?: string;
      roomNo?: string;
      room_number?: string;
    };
    if (typedSlot?.slot_code) {
      const slotCode = typedSlot.slot_code;
      const slotMapping = timetableData?.slot_mapping || {};
      const courseTitle = slotMapping[slotCode] || '';
      const roomValue = (typedSlot.room || typedSlot.roomNo || typedSlot.room_number || '').toString().trim();
      timeSlots.push({
        time,
        course_title: courseTitle,
        category: typedSlot.slot_type || '',
        room: roomValue || undefined,
      });
    }
  });

  return timeSlots.sort((a, b) => {
    const getStartTime = (timeStr: string): number => {
      const startTime = timeStr.split('-')[0];
      const timeParts = startTime.split(':').map(Number);
      let hours = timeParts[0];
      const minutes = timeParts[1];
      if (hours < 8 && hours !== 0) {
        hours += 12;
      }
      return hours * 60 + minutes;
    };
    return getStartTime(a.time) - getStartTime(b.time);
  });
}

/** Same normalization as dashboard attendance vs timetable matching. */
export function normalizeSubjectTitleForAttendance(value: string | undefined | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Holiday: JSON order. Otherwise: subjects on today’s timetable (slot order, unique by title), then remaining subjects in JSON order.
 */
export function orderAttendanceSubjectsTodayFirstThenJson(
  subjects: AttendanceSubject[],
  todaysSlots: TimetableCourseSlot[],
  isHoliday: boolean
): AttendanceSubject[] {
  const list = subjects.filter(Boolean);
  if (isHoliday || todaysSlots.length === 0) {
    return [...list];
  }

  const seenKeys = new Set<string>();
  const todayOrdered: AttendanceSubject[] = [];

  for (const slot of todaysSlots) {
    const slotKey = normalizeSubjectTitleForAttendance(slot.course_title);
    if (!slotKey || seenKeys.has(slotKey)) {
      continue;
    }
    const match = list.find((s) => normalizeSubjectTitleForAttendance(s.course_title) === slotKey);
    if (match) {
      todayOrdered.push(match);
      seenKeys.add(slotKey);
    }
  }

  const rest = list.filter((s) => !seenKeys.has(normalizeSubjectTitleForAttendance(s.course_title)));
  return [...todayOrdered, ...rest];
}
