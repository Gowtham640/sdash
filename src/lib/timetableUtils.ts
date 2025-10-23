// Utility functions for timetable and calendar data analysis

export interface DayOrderStats {
  [key: number]: number;
}

export interface SlotOccurrence {
  slot: string;
  courseTitle: string;
  category: 'Theory' | 'Practical';
  dayOrders: number[];
  totalOccurrences: number;
  dayOrderHours: { [dayOrder: number]: number }; // Hours per day order
}

export interface TimetableStats {
  slotOccurrences: SlotOccurrence[];
  dayOrderStats: DayOrderStats;
}

// Get current date string in DD/MM/YYYY format
export const getCurrentDateString = () => {
  const now = new Date();
  const day = now.getDate().toString().padStart(2, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
};

// Parse date from DD/MM/YYYY format with validation
export const parseDate = (dateStr: string): Date => {
  // Basic format validation
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  
  const parts = dateStr.split('/');
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  
  const [dayStr, monthStr, yearStr] = parts;
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);
  
  // Validate parsed values
  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  
  // Basic range validation
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2024 || year > 2026) {
    throw new Error(`Date out of valid range: ${dateStr}`);
  }
  
  // Create date object
  const date = new Date(year, month - 1, day);
  
  // Validate the created date (handles leap years, invalid dates, etc.)
  if (date.getDate() !== day || date.getMonth() !== month - 1 || date.getFullYear() !== year) {
    throw new Error(`Invalid date (e.g., leap year issue): ${dateStr}`);
  }
  
  return date;
};

// Calculate day order statistics from calendar data
export const getDayOrderStats = (calendarData: any[]): DayOrderStats => {
  const stats: DayOrderStats = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  
  const currentDateStr = getCurrentDateString();
  const endDateStr = "21/11/2025";
  const currentDate = parseDate(currentDateStr);
  const endDate = parseDate(endDateStr);

  calendarData.forEach((event: any) => {
    if (event.date && event.day_order && event.day_order.startsWith('DO ')) {
      const eventDate = parseDate(event.date);
      
      // Only count events from current date onwards and before/on end date
      if (eventDate >= currentDate && eventDate <= endDate) {
        const doNumber = parseInt(event.day_order.split(' ')[1]);
        if (doNumber >= 1 && doNumber <= 5) {
          stats[doNumber]++;
        }
      }
    }
  });

  return stats;
};

// Get slot occurrences from timetable data, grouped by course title and category
export const getSlotOccurrences = (timetableData: any): SlotOccurrence[] => {
  const courseMap = new Map<string, SlotOccurrence>();
  const slotMap = new Map<string, Set<string>>(); // Track slots per course

  // Check each day order in timetable
  ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'].forEach(doName => {
    const doData = timetableData.timetable[doName];
    const doNumber = parseInt(doName.split(' ')[1]);
    
    if (doData && doData.time_slots) {
      Object.values(doData.time_slots).forEach((slotInfo: any) => {
        if (slotInfo.slot_code && slotInfo.course_title && slotInfo.course_title.trim() !== '') {
          const slot = slotInfo.slot_code;
          const courseTitle = slotInfo.course_title.trim();
          const category = slotInfo.slot_type === 'Lab' ? 'Practical' : 'Theory';
          
          // Group by course title and category (not by individual slot)
          const key = `${courseTitle}-${category}`;
          
          if (!courseMap.has(key)) {
            courseMap.set(key, {
              slot: '', // Will be populated with all slots
              courseTitle,
              category,
              dayOrders: [],
              totalOccurrences: 0,
              dayOrderHours: {}
            });
            slotMap.set(key, new Set<string>());
          }
          
          const courseOccurrence = courseMap.get(key)!;
          const slotSet = slotMap.get(key)!;
          
          // Add this slot to the slot set
          slotSet.add(slot);
          
          if (!courseOccurrence.dayOrders.includes(doNumber)) {
            courseOccurrence.dayOrders.push(doNumber);
          }
          courseOccurrence.totalOccurrences++;
          
          // Count hours per day order
          if (!courseOccurrence.dayOrderHours[doNumber]) {
            courseOccurrence.dayOrderHours[doNumber] = 0;
          }
          courseOccurrence.dayOrderHours[doNumber]++;
        }
      });
    }
  });

  // Convert slot sets to comma-separated strings
  courseMap.forEach((occurrence, key) => {
    const slotSet = slotMap.get(key)!;
    occurrence.slot = Array.from(slotSet).sort().join(', ');
  });

  return Array.from(courseMap.values()).sort((a, b) => {
    // Sort by course title first, then by category
    if (a.courseTitle !== b.courseTitle) {
      return a.courseTitle.localeCompare(b.courseTitle);
    }
    return a.category.localeCompare(b.category);
  });
};

// Fetch calendar data
export const fetchCalendarData = async (email: string, password: string) => {
  const response = await fetch(`/api/data/calender?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`);
  const result = await response.json();
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to fetch calendar data');
  }
  
  return result.data;
};

// Fetch timetable data
export const fetchTimetableData = async (email: string, password: string) => {
  const response = await fetch(`/api/data/timetable?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`);
  const result = await response.json();
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to fetch timetable data');
  }
  
  return result.data;
};

// Calculate remaining hours for a specific slot (can be comma-separated for grouped slots)
export const calculateRemainingHours = (
  slot: string, 
  dayOrderStats: DayOrderStats, 
  timetableData: any
): number => {
  let totalHours = 0;
  
  // Handle comma-separated slots (for grouped courses)
  const slots = slot.split(',').map(s => s.trim().toUpperCase());
  
  // Check each day order in timetable
  ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'].forEach(doName => {
    const doData = timetableData.timetable[doName];
    if (doData && doData.time_slots) {
      Object.values(doData.time_slots).forEach((slotInfo: any) => {
        if (slotInfo.slot_code) {
          const slotCode = slotInfo.slot_code.toUpperCase();
          
          // Check if this slot matches any of our target slots
          const matchingSlot = slots.find(s => slotCode.includes(s));
          if (matchingSlot) {
            // Count how many time slots this specific slot appears in this day order
            const slotCount = Object.values(doData.time_slots).filter((s: any) => 
              s.slot_code && s.slot_code.toUpperCase().includes(matchingSlot)
            ).length;
            
            const doNumber = parseInt(doName.split(' ')[1]);
            totalHours += dayOrderStats[doNumber] * slotCount;
          }
        }
      });
    }
  });

  return totalHours;
};

// Calculate total hours remaining for all subjects (fast calculation using existing data)
export const calculateAllSubjectRemainingHours = (
  timetableData: any,
  dayOrderStats: DayOrderStats
): Array<{
  courseTitle: string;
  category: 'Theory' | 'Practical';
  slots: string;
  totalRemainingHours: number;
  dayOrders: number[];
  dayOrderHours: { [dayOrder: number]: number };
}> => {
  // Get all slot occurrences (grouped by course)
  const slotOccurrences = getSlotOccurrences(timetableData);
  
  // Calculate remaining hours for each subject
  return slotOccurrences.map(occurrence => ({
    courseTitle: occurrence.courseTitle,
    category: occurrence.category,
    slots: occurrence.slot,
    totalRemainingHours: calculateRemainingHours(occurrence.slot, dayOrderStats, timetableData),
    dayOrders: occurrence.dayOrders,
    dayOrderHours: occurrence.dayOrderHours
  }));
};

// Global data cache
interface GlobalDataCache {
  calendarData: any[];
  timetableData: any;
  dayOrderStats: DayOrderStats;
  slotOccurrences: SlotOccurrence[];
  subjectRemainingHours: any[];
  lastUpdated: number;
}

let globalCache: GlobalDataCache | null = null;
let cachePromise: Promise<GlobalDataCache> | null = null;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Get global cached data
export const getGlobalData = async (email: string, password: string): Promise<GlobalDataCache> => {
  // Return cached data if valid
  if (globalCache && Date.now() - globalCache.lastUpdated < CACHE_DURATION) {
    console.log('[CACHE] Using global cached data');
    return globalCache;
  }
  
  // If there's already a fetch in progress, wait for it
  if (cachePromise) {
    console.log('[CACHE] Waiting for ongoing fetch');
    return cachePromise;
  }
  
  console.log('[CACHE] Cache miss or expired - fetching fresh data');
  
  // Create a new fetch promise
  cachePromise = (async () => {
    try {
      // Fetch and cache all data
      const [calendarData, timetableData] = await Promise.all([
        fetchCalendarData(email, password),
        fetchTimetableData(email, password)
      ]);
      
      const dayOrderStats = getDayOrderStats(calendarData);
      const slotOccurrences = getSlotOccurrences(timetableData);
      const subjectRemainingHours = calculateAllSubjectRemainingHours(timetableData, dayOrderStats);
      
      globalCache = {
        calendarData,
        timetableData,
        dayOrderStats,
        slotOccurrences,
        subjectRemainingHours,
        lastUpdated: Date.now()
      };
      
      console.log('[CACHE] Global data cached successfully');
      return globalCache;
    } finally {
      // Clear the promise so future calls can create a new one
      cachePromise = null;
    }
  })();
  
  return cachePromise;
};

// Get comprehensive timetable data in a clean format for use across pages
export const getTimetableSummary = async (email: string, password: string) => {
  try {
    const globalData = await getGlobalData(email, password);
    
    return {
      dayOrderStats: globalData.dayOrderStats,
      slotOccurrences: globalData.slotOccurrences,
      subjectRemainingHours: globalData.subjectRemainingHours,
      timetableData: globalData.timetableData,
      calendarData: globalData.calendarData
    };
  } catch (error) {
    console.error('Error getting timetable summary:', error);
    throw error;
  }
};
