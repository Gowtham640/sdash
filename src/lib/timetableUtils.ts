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
  
  console.log(`[STATS] Counting from ${currentDateStr} to ${endDateStr}`);
  
  // Use the WORKING parseDate method from calendar page
  const parseDateLocal = (dateStr: string) => {
    const [day, month, year] = dateStr.split('/').map(Number);
    return new Date(year, month - 1, day);
  };
  
  const currentDate = parseDateLocal(currentDateStr);
  const endDate = parseDateLocal(endDateStr);

  calendarData.forEach((event: any) => {
    if (event.date && event.day_order) {
      try {
        const eventDate = parseDateLocal(event.date);
        
        // Skip holidays and days off - check both portal markers ("-", "DO -") and our calendar markers ("Holiday")
        // This includes Sundays and other non-class days from the portal
        const isHoliday = event.day_order === "Holiday" || 
                         event.day_order === "-" || 
                         event.day_order === "DO -" ||
                         event.content?.toLowerCase().includes('holiday');
        
        // Skip if it's a holiday (including Sundays and other non-class days)
        if (isHoliday) {
          return;
        }
        
        // Only count events from current date onwards and before/on end date
        // Only count if it's a valid day order (not a holiday)
        if (eventDate >= currentDate && eventDate <= endDate && event.day_order.startsWith('DO ')) {
          const doNumber = parseInt(event.day_order.split(' ')[1]);
          if (doNumber >= 1 && doNumber <= 5) {
            stats[doNumber]++;
            console.log(`[STATS] Found DO ${doNumber} on ${event.date}`);
          }
        }
      } catch (error) {
        console.warn(`[STATS] Failed to parse date: ${event.date}`, error);
      }
    }
  });
  
  console.log(`[STATS] Final counts:`, stats);
  return stats;
};

// Get slot occurrences from timetable data, grouped by course title and category
export const getSlotOccurrences = (timetableData: any): SlotOccurrence[] => {
  const courseMap = new Map<string, SlotOccurrence>();
  const slotMap = new Map<string, Set<string>>(); // Track slots per course

  // Enhanced validation and error handling
  console.log('[getSlotOccurrences] Input timetableData:', timetableData);
  console.log('[getSlotOccurrences] Type:', typeof timetableData);
  console.log('[getSlotOccurrences] Is null/undefined:', timetableData == null);
  
  if (timetableData) {
    console.log('[getSlotOccurrences] Keys:', Object.keys(timetableData));
    console.log('[getSlotOccurrences] Has timetable property:', 'timetable' in timetableData);
    if (timetableData.timetable) {
      console.log('[getSlotOccurrences] Timetable keys:', Object.keys(timetableData.timetable));
      console.log('[getSlotOccurrences] Timetable type:', typeof timetableData.timetable);
    }
  }

  // Comprehensive validation
  if (!timetableData) {
    console.error('[getSlotOccurrences] timetableData is null or undefined');
    return [];
  }
  
  if (Array.isArray(timetableData)) {
    console.error('[getSlotOccurrences] timetableData is an array instead of object');
    return [];
  }
  
  if (Object.keys(timetableData).length === 0) {
    console.error('[getSlotOccurrences] timetableData is empty object');
    return [];
  }
  
  if (!timetableData.timetable) {
    console.error('[getSlotOccurrences] timetableData.timetable is missing. Available keys:', Object.keys(timetableData));
    return [];
  }
  
  if (typeof timetableData.timetable !== 'object') {
    console.error('[getSlotOccurrences] timetableData.timetable is not an object:', typeof timetableData.timetable);
    return [];
  }
  
  const timetableKeys = Object.keys(timetableData.timetable);
  if (timetableKeys.length === 0) {
    console.warn('[getSlotOccurrences] timetableData.timetable is empty - no day orders found');
    return [];
  }
  
  console.log('[getSlotOccurrences] Processing timetable with keys:', timetableKeys);

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

// Get comprehensive timetable data in a clean format for use across pages
export const getTimetableSummary = async (email: string, password: string) => {
  try {
    // Fetch all data
    const [calendarData, timetableData] = await Promise.all([
      fetchCalendarData(email, password),
      fetchTimetableData(email, password)
    ]);
    
    const dayOrderStats = getDayOrderStats(calendarData);
    const slotOccurrences = getSlotOccurrences(timetableData);
    const subjectRemainingHours = calculateAllSubjectRemainingHours(timetableData, dayOrderStats);
    
    return {
      dayOrderStats,
      slotOccurrences,
      subjectRemainingHours,
      timetableData,
      calendarData
    };
  } catch (error) {
    console.error('Error getting timetable summary:', error);
    throw error;
  }
};
