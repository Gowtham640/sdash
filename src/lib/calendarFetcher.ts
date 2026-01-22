import { supabase } from '@/lib/supabaseClient';
import { type CalendarEvent } from '@/lib/timetableUtils';

const fetchCalendarRecord = async () => {
  const course = 'Default';
  const semester = 0;
  console.log(`[calendarFetcher] Querying public.calendar for course="${course}", semester=${semester}`);
  const { data, error } = await supabase
    .from('calendar')
    .select('data')
    .eq('course', course)
    .eq('semester', semester)
    .single();

  if (error) {
    console.warn(`[calendarFetcher] Supabase error for course="${course}", semester=${semester}: ${error.message}`);
    return null;
  }

  const payload = data?.data;
  if (!payload || typeof payload !== 'object') {
    console.warn('[calendarFetcher] Calendar payload missing or invalid structure');
    return null;
  }

  const calendarArray = Array.isArray(payload.calendar) ? payload.calendar : [];
  console.log(`[calendarFetcher] Retrieved calendar with ${calendarArray.length} entries`);
  return calendarArray;
};

export const fetchCalendarFromSupabase = async (): Promise<CalendarEvent[]> => {
  const calendarData = await fetchCalendarRecord();

  if (!calendarData || !Array.isArray(calendarData)) {
    return [];
  }

  return calendarData;
};
