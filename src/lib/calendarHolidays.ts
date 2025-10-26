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
 * Mark holidays for students not in semester 1:
 * - Saturdays after 26/10/2025 are holidays
 * - All days after 10/11/2025 are holidays (last working day)
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
  
  // Semester 2+: Mark Saturdays after 26/10/2025 AND all days after 10/11/2025 as holidays
  console.log(`[Calendar] Semester ${semester} - marking holidays (Saturdays after 26/10, all days after 10/11)`);
  
  // Define cutoff dates
  const saturdayCutoffDate = new Date(2025, 9, 26); // 26/10/2025 - Saturday cutoff
  saturdayCutoffDate.setHours(0, 0, 0, 0);
  
  const lastWorkingDate = new Date(2025, 10, 10); // 10/11/2025 - Last working day
  lastWorkingDate.setHours(0, 0, 0, 0);
  
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
      // 1. It's a Saturday after 26/10/2025, OR
      // 2. It's any day after 10/11/2025 (last working day)
      // 3. Not already marked as holiday
      if (!isHoliday && (isSaturdayAfterCutoff || isAfterLastWorkingDay)) {
        const reason = isAfterLastWorkingDay ? 'post-cutoff (after 10/11/2025)' : 'Saturday after 26/10/2025';
        console.log(`[Calendar] Marking ${event.date} (${reason}) as holiday`);
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

