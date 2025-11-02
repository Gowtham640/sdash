/**
 * Calendar cache - 7 days
 * Calendars change weekly, so we refresh them every week
 */

import { setStorageItem, getStorageItem, removeStorageItem } from './browserStorage';

const CALENDAR_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const CALENDAR_CACHE_KEY = 'calendar_cache_data';
const CALENDAR_CACHE_TIMESTAMP_KEY = 'calendar_cache_timestamp';

/**
 * Check if calendar cache is valid
 */
export function isCalendarCacheValid(): boolean {
  try {
    const timestamp = getStorageItem(CALENDAR_CACHE_TIMESTAMP_KEY);
    if (!timestamp) {
      console.log('[CalendarCache] 🔍 Validation: No timestamp found');
      return false;
    }
    
    const age = Date.now() - parseInt(timestamp);
    const isValid = age < CALENDAR_CACHE_DURATION;
    const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));
    
    if (isValid) {
      console.log(`[CalendarCache] ✅ Validation: Cache valid (${ageDays} days old)`);
    } else {
      console.log(`[CalendarCache] ❌ Validation: Cache expired (${ageDays} days old, max 7 days)`);
    }
    
    return isValid;
  } catch (error) {
    console.error('[CalendarCache] ❌ Validation error:', error);
    return false;
  }
}

/**
 * Get cached calendar data
 */
export function getCachedCalendar(): any | null {
  try {
    if (!isCalendarCacheValid()) {
      console.log('[CalendarCache] ⚠️  Cannot get calendar: Cache invalid');
      return null;
    }
    
    const cached = getStorageItem(CALENDAR_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      console.log('[CalendarCache] ✅ Retrieved calendar from cache');
      return parsed;
    }
    console.log('[CalendarCache] ⚠️  Calendar not found in cache');
    return null;
  } catch (error) {
    console.error('[CalendarCache] ❌ Error getting calendar');
    console.error(`[CalendarCache]   - Error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Store calendar in cache
 */
export function storeCalendarCache(calendar: any): void {
  try {
    const calendarSize = JSON.stringify(calendar).length;
    
    console.log('[CalendarCache] 💾 Storing calendar...');
    console.log(`[CalendarCache]   - Calendar size: ${(calendarSize / 1024).toFixed(2)} KB`);
    
    const calendarStored = setStorageItem(CALENDAR_CACHE_KEY, JSON.stringify(calendar));
    const timestampStored = setStorageItem(CALENDAR_CACHE_TIMESTAMP_KEY, Date.now().toString());
    
    if (!calendarStored || !timestampStored) {
      throw new Error('Storage failed - one or more items could not be stored');
    }
    
    // Verify storage
    const storedCalendar = getStorageItem(CALENDAR_CACHE_KEY);
    
    if (storedCalendar) {
      console.log('[CalendarCache] ✅ Storage verified successfully');
      console.log(`[CalendarCache]   - Valid until: ${new Date(Date.now() + CALENDAR_CACHE_DURATION).toLocaleDateString()}`);
    } else {
      throw new Error('Storage verification failed');
    }
  } catch (error) {
    console.error('[CalendarCache] ❌ Storage failed');
    console.error(`[CalendarCache]   - Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[CalendarCache]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
  }
}

/**
 * Clear calendar cache (e.g., on logout or manual refresh)
 */
export function clearCalendarCache(): void {
  try {
    removeStorageItem(CALENDAR_CACHE_KEY);
    removeStorageItem(CALENDAR_CACHE_TIMESTAMP_KEY);
    console.log('[CalendarCache] Cleared ✓');
  } catch (error) {
    console.error('[CalendarCache] Failed to clear:', error);
  }
}

/**
 * Get cache age in days
 */
export function getCalendarCacheAge(): number {
  try {
    const timestamp = getStorageItem(CALENDAR_CACHE_TIMESTAMP_KEY);
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
export function getCalendarCacheDaysRemaining(): number {
  try {
    if (!isCalendarCacheValid()) {
      return 0;
    }
    
    const timestamp = getStorageItem(CALENDAR_CACHE_TIMESTAMP_KEY);
    if (!timestamp) {
      return 0;
    }
    
    const ageMs = Date.now() - parseInt(timestamp);
    const remainingMs = CALENDAR_CACHE_DURATION - ageMs;
    return Math.max(0, Math.floor(remainingMs / (24 * 60 * 60 * 1000)));
  } catch {
    return 0;
  }
}

