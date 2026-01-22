import { normalizeCalendarDayOrder, type CalendarEvent, type DayOrderStats, type SlotOccurrence } from './timetableUtils';

let sharedSlotOccurrences: SlotOccurrence[] = [];
let sharedCalendarSnapshot: CalendarEvent[] = [];

const formatDateKey = (date: Date) => {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString();
    return `${day}/${month}/${year}`;
};

const parseCalendarDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;

    // DD/MM/YYYY format
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/').map(part => parseInt(part, 10));
        if (parts.length === 3 && !parts.some(isNaN)) {
            const [day, month, year] = parts;
            return new Date(year, month - 1, day);
        }
    }

    // ISO or other parsable formats
    const isoDate = new Date(dateStr);
    return isNaN(isoDate.getTime()) ? null : isoDate;
};

const buildDayOrderLookup = (calendarData: CalendarEvent[]): Record<string, number> => {
    const lookup: Record<string, number> = {};
    calendarData.forEach(event => {
        if (!event?.date) return;
        const normalizedOrder = normalizeCalendarDayOrder(event.day_order);
        if (!normalizedOrder) return;
        const eventDate = parseCalendarDate(event.date);
        if (!eventDate) return;
        const key = formatDateKey(eventDate);
        lookup[key] = normalizedOrder;
    });
    return lookup;
};

const iterateDateRange = (startDate: Date, endDate: Date, callback: (date: Date) => void) => {
    const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const last = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    while (current <= last) {
        callback(new Date(current));
        current.setDate(current.getDate() + 1);
    }
};

export const hydrateSharedPredictionData = (calendarData: CalendarEvent[], slotOcc: SlotOccurrence[]) => {
    sharedCalendarSnapshot = Array.isArray(calendarData) ? calendarData : [];
    sharedSlotOccurrences = Array.isArray(slotOcc) ? slotOcc : [];
    console.log(`[PredictionData] calendar snapshot loaded (${sharedCalendarSnapshot.length} events), slot occurrences: ${sharedSlotOccurrences.length}`);
};

export const resetSharedPredictionData = () => {
    sharedCalendarSnapshot = [];
    sharedSlotOccurrences = [];
};

export const getSharedSlotOccurrences = () => sharedSlotOccurrences;

export const getSharedCalendarDayOrderMap = () => sharedCalendarSnapshot;

export const getDayOrderStatsFromSharedData = (
    startDate: Date,
    endDate: Date,
    fallbackCalendarData?: CalendarEvent[]
): DayOrderStats => {
    const calendarSource = fallbackCalendarData && fallbackCalendarData.length
        ? fallbackCalendarData
        : sharedCalendarSnapshot;
    console.log(`[PredictionData] Calculating stats for range ${formatDateKey(startDate)} → ${formatDateKey(endDate)}`);
    console.log(`[PredictionData] Using calendar source with ${calendarSource ? calendarSource.length : 0} events`);
    if (!calendarSource || !calendarSource.length) {
        console.warn('[PredictionData] No calendar data available to calculate day order stats');
        return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    }
    const lookup = buildDayOrderLookup(calendarSource);
    console.log(`[PredictionData] Built day order lookup with ${Object.keys(lookup).length} entries`);
    const stats: DayOrderStats = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    iterateDateRange(startDate, endDate, date => {
        const key = formatDateKey(date);
        const dayOrder = lookup[key];
        if (dayOrder) {
            console.log(`[PredictionData] ${key} -> DO${dayOrder}`);
        } else {
            console.log(`[PredictionData] ${key} -> no valid day order`);
        }
        if (dayOrder && dayOrder >= 1 && dayOrder <= 5) {
            stats[dayOrder]++;
        }
    });
    return stats;
};
