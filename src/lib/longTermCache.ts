/**
 * Long-term cache for timetable and calendar (1 month)
 * These rarely change, so we cache them aggressively
 */

import { setStorageItem, getStorageItem, removeStorageItem } from './browserStorage';

const LONG_TERM_CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
const TIMETABLE_CACHE_KEY = 'tt_calendar_cache_timetable';
const CALENDAR_CACHE_KEY = 'tt_calendar_cache_calendar';
const LONG_TERM_CACHE_TIMESTAMP_KEY = 'tt_calendar_cache_timestamp';

/**
 * Check if long-term cache (timetable/calendar) is valid
 */
export function isLongTermCacheValid(): boolean {
  try {
    const timestamp = getStorageItem(LONG_TERM_CACHE_TIMESTAMP_KEY);
    if (!timestamp) {
      console.log('[LongTermCache] 🔍 Validation: No timestamp found');
      return false;
    }
    
    const age = Date.now() - parseInt(timestamp);
    const isValid = age < LONG_TERM_CACHE_DURATION;
    const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));
    
    if (isValid) {
      console.log(`[LongTermCache] ✅ Validation: Cache valid (${ageDays} days old)`);
    } else {
      console.log(`[LongTermCache] ❌ Validation: Cache expired (${ageDays} days old, max 30 days)`);
    }
    
    return isValid;
  } catch (error) {
    console.error('[LongTermCache] ❌ Validation error:', error);
    return false;
  }
}

/**
 * Get cached timetable data
 */
export function getCachedTimetable(): any | null {
  try {
    if (!isLongTermCacheValid()) {
      console.log('[LongTermCache] ⚠️  Cannot get timetable: Cache invalid');
      return null;
    }
    
    const cached = getStorageItem(TIMETABLE_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      console.log('[LongTermCache] ✅ Retrieved timetable from cache');
      return parsed;
    }
    console.log('[LongTermCache] ⚠️  Timetable not found in cache');
    return null;
  } catch (error) {
    console.error('[LongTermCache] ❌ Error getting timetable');
    console.error(`[LongTermCache]   - Error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get cached calendar data
 */
export function getCachedCalendar(): any | null {
  try {
    if (!isLongTermCacheValid()) {
      console.log('[LongTermCache] ⚠️  Cannot get calendar: Cache invalid');
      return null;
    }
    
    const cached = getStorageItem(CALENDAR_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      console.log('[LongTermCache] ✅ Retrieved calendar from cache');
      return parsed;
    }
    console.log('[LongTermCache] ⚠️  Calendar not found in cache');
    return null;
  } catch (error) {
    console.error('[LongTermCache] ❌ Error getting calendar');
    console.error(`[LongTermCache]   - Error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Store timetable and calendar in long-term cache
 */
export function storeLongTermCache(timetable: any, calendar: any): void {
  try {
    const timetableSize = JSON.stringify(timetable).length;
    const calendarSize = JSON.stringify(calendar).length;
    const totalSize = timetableSize + calendarSize;
    
    console.log('[LongTermCache] 💾 Storing data...');
    console.log(`[LongTermCache]   - Timetable size: ${(timetableSize / 1024).toFixed(2)} KB`);
    console.log(`[LongTermCache]   - Calendar size: ${(calendarSize / 1024).toFixed(2)} KB`);
    console.log(`[LongTermCache]   - Total size: ${(totalSize / 1024).toFixed(2)} KB`);
    
    const timetableStored = setStorageItem(TIMETABLE_CACHE_KEY, JSON.stringify(timetable));
    const calendarStored = setStorageItem(CALENDAR_CACHE_KEY, JSON.stringify(calendar));
    const timestampStored = setStorageItem(LONG_TERM_CACHE_TIMESTAMP_KEY, Date.now().toString());
    
    if (!timetableStored || !calendarStored || !timestampStored) {
      throw new Error('Storage failed - one or more items could not be stored');
    }
    
    // Verify storage
    const storedTimetable = getStorageItem(TIMETABLE_CACHE_KEY);
    const storedCalendar = getStorageItem(CALENDAR_CACHE_KEY);
    
    if (storedTimetable && storedCalendar) {
      console.log('[LongTermCache] ✅ Storage verified successfully');
      console.log(`[LongTermCache]   - Valid until: ${new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toLocaleDateString()}`);
    } else {
      throw new Error('Storage verification failed');
    }
  } catch (error) {
    console.error('[LongTermCache] ❌ Storage failed');
    console.error(`[LongTermCache]   - Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[LongTermCache]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    
    // If quota exceeded, try to clear old caches
    if (error instanceof Error && (error.message.includes('quota') || error.message.includes('Storage failed'))) {
      console.warn('[LongTermCache] ⚠️  Storage quota exceeded, attempting cleanup...');
      try {
        removeStorageItem(TIMETABLE_CACHE_KEY + '_old');
        removeStorageItem(CALENDAR_CACHE_KEY + '_old');
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Clear long-term cache (e.g., on logout or manual refresh)
 */
export function clearLongTermCache(): void {
  try {
    removeStorageItem(TIMETABLE_CACHE_KEY);
    removeStorageItem(CALENDAR_CACHE_KEY);
    removeStorageItem(LONG_TERM_CACHE_TIMESTAMP_KEY);
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
    const timestamp = getStorageItem(LONG_TERM_CACHE_TIMESTAMP_KEY);
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
    
    const timestamp = getStorageItem(LONG_TERM_CACHE_TIMESTAMP_KEY);
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
