interface CalendarEvent {
  date: string;
  day_name: string;
  content: string;
  day_order: string;
  month?: string;
  month_name?: string;
  year?: string;
}

/**
 * Inclusive last working day of the semester (DD/MM/YYYY = 06/05/2026).
 * Used by holiday marking and calendar stats; months are 0-based in Date.
 */
const SEMESTER_LAST_WORKING_DAY = (() => {
  const d = new Date(2026, 4, 6);
  d.setHours(0, 0, 0, 0);
  return d;
})();

/**
 * Mark holidays for students not in semester 1:
 * - Saturdays on or after 25/10/2025 are holidays
 * - All days after the semester last working day are holidays (06/05/2026)
 * In semester 1, all days remain as normal
 */
export function markSaturdaysAsHolidays(
  calendarData: CalendarEvent[],
  semester: number
): CalendarEvent[] {
  // Semester 1: Don't modify (all days normal)
  if (semester === 1) {
    console.log('[Calendar] Semester 1 - keeping calendar as is (no modification)');
    return calendarData;
  }
  
  // Semester 2+: Mark Saturdays on/after 25/10/2025 AND all days after last working day as holidays
  console.log(
    `[Calendar] Semester ${semester} - marking holidays (Saturdays on/after 25/10, all days after semester end)`,
  );
  console.log(`[Calendar] Processing ${calendarData.length} calendar events`);
  
  // Define cutoff dates
  // Note: JavaScript Date months are 0-indexed (9 = October, 10 = November)
  const saturdayCutoffDate = new Date(2025, 9, 25); // 25/10/2025 - Saturday cutoff (inclusive)
  saturdayCutoffDate.setHours(0, 0, 0, 0);
  
  const lastWorkingDate = new Date(SEMESTER_LAST_WORKING_DAY.getTime());
  
  console.log(`[Calendar] Cutoff dates: Saturday cutoff = ${saturdayCutoffDate.toLocaleDateString('en-GB')}, Last working day = ${lastWorkingDate.toLocaleDateString('en-GB')}`);
  
  let holidaysMarked = 0;
  const modifiedEvents = calendarData.map(event => {
    try {
      // Parse date from DD/MM/YYYY format
      const [day, month, year] = event.date.split('/').map(Number);
      const eventDate = new Date(year, month - 1, day);
      eventDate.setHours(0, 0, 0, 0); // Reset to midnight for comparison
      
      const dayOfWeek = eventDate.getDay(); // 0=Sunday, 6=Saturday
      
      // Check if already marked as holiday
      const isHoliday = event.day_order === "-" || 
                        event.day_order === "DO -" || 
                        event.content.toLowerCase().includes('holiday');
      
      // Check conditions for marking as holiday
      const isSaturdayAfterCutoff = dayOfWeek === 6 && eventDate >= saturdayCutoffDate;
      const isAfterLastWorkingDay = eventDate > lastWorkingDate;
      
      // Mark as holiday if:
      // 1. It's a Saturday after 25/10/2025, OR
      // 2. It's any day after semester last working day (inclusive last day is not holiday)
      // 3. Not already marked as holiday
      if (!isHoliday && (isSaturdayAfterCutoff || isAfterLastWorkingDay)) {
        const reason = isAfterLastWorkingDay
          ? "post-cutoff (after semester last working day)"
          : "Saturday on/after 25/10/2025";
        console.log(`[Calendar] ✓ Marking ${event.date} as holiday (${reason})`);
        holidaysMarked++;
        return {
          ...event,
          content: "Holiday",
          day_order: "Holiday"
        };
      }
      
      return event;
    } catch (error) {
      // If date parsing fails, return event as-is
      console.error(`[Calendar] Error parsing date for event: ${event.date}`, error);
      return event;
    }
  });
  
  console.log(`[Calendar] Holiday marking complete: ${holidaysMarked} dates marked as holidays`);
  return modifiedEvents;
}

/**
 * Check if a date is a Saturday
 */
export function isSaturday(dateStr: string): boolean {
  try {
    const [day, month, year] = dateStr.split('/').map(Number);
    const date = new Date(year, month - 1, day);
    return date.getDay() === 6; // 6 is Saturday
  } catch {
    return false;
  }
}

/**
 * Last calendar day of the semester that counts as a working day (inclusive).
 * Same boundary as `markSaturdaysAsHolidays` (06/05/2026).
 */
export function getSemesterLastWorkingDayInclusive(): Date {
  return new Date(SEMESTER_LAST_WORKING_DAY.getTime());
}
