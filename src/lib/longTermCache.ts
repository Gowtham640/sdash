/**
 * Long-term cache for timetable and calendar (1 month)
 * These rarely change, so we cache them aggressively
 */

const LONG_TERM_CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
const TIMETABLE_CACHE_KEY = 'tt_calendar_cache_timetable';
const CALENDAR_CACHE_KEY = 'tt_calendar_cache_calendar';
const LONG_TERM_CACHE_TIMESTAMP_KEY = 'tt_calendar_cache_timestamp';

/**
 * Check if long-term cache (timetable/calendar) is valid
 */
export function isLongTermCacheValid(): boolean {
  try {
    const timestamp = localStorage.getItem(LONG_TERM_CACHE_TIMESTAMP_KEY);
    if (!timestamp) {
      return false;
    }
    
    const age = Date.now() - parseInt(timestamp);
    return age < LONG_TERM_CACHE_DURATION;
  } catch {
    return false;
  }
}

/**
 * Get cached timetable data
 */
export function getCachedTimetable(): any | null {
  try {
    if (!isLongTermCacheValid()) {
      return null;
    }
    
    const cached = localStorage.getItem(TIMETABLE_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('[LongTermCache] Error getting timetable:', error);
    return null;
  }
}

/**
 * Get cached calendar data
 */
export function getCachedCalendar(): any | null {
  try {
    if (!isLongTermCacheValid()) {
      return null;
    }
    
    const cached = localStorage.getItem(CALENDAR_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('[LongTermCache] Error getting calendar:', error);
    return null;
  }
}

/**
 * Store timetable and calendar in long-term cache
 */
export function storeLongTermCache(timetable: any, calendar: any): void {
  try {
    localStorage.setItem(TIMETABLE_CACHE_KEY, JSON.stringify(timetable));
    localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify(calendar));
    localStorage.setItem(LONG_TERM_CACHE_TIMESTAMP_KEY, Date.now().toString());
    
    console.log('[LongTermCache] Stored timetable & calendar for 1 month ✓');
  } catch (error) {
    console.error('[LongTermCache] Failed to store:', error);
    // If quota exceeded, try to clear old caches
    try {
      localStorage.removeItem(TIMETABLE_CACHE_KEY + '_old');
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Clear long-term cache (e.g., on logout or manual refresh)
 */
export function clearLongTermCache(): void {
  try {
    localStorage.removeItem(TIMETABLE_CACHE_KEY);
    localStorage.removeItem(CALENDAR_CACHE_KEY);
    localStorage.removeItem(LONG_TERM_CACHE_TIMESTAMP_KEY);
    console.log('[LongTermCache] Cleared ✓');
  } catch (error) {
    console.error('[LongTermCache] Failed to clear:', error);
  }
}

/**
 * Get cache age in days
 */
export function getLongTermCacheAge(): number {
  try {
    const timestamp = localStorage.getItem(LONG_TERM_CACHE_TIMESTAMP_KEY);
    if (!timestamp) {
      return -1;
    }
    
    const ageMs = Date.now() - parseInt(timestamp);
    return Math.floor(ageMs / (24 * 60 * 60 * 1000));
  } catch {
    return -1;
  }
}

/**
 * Get remaining cache validity in days
 */
export function getLongTermCacheDaysRemaining(): number {
  try {
    if (!isLongTermCacheValid()) {
      return 0;
    }
    
    const timestamp = localStorage.getItem(LONG_TERM_CACHE_TIMESTAMP_KEY);
    if (!timestamp) {
      return 0;
    }
    
    const ageMs = Date.now() - parseInt(timestamp);
    const remainingMs = LONG_TERM_CACHE_DURATION - ageMs;
    return Math.max(0, Math.floor(remainingMs / (24 * 60 * 60 * 1000)));
  } catch {
    return 0;
  }
}
