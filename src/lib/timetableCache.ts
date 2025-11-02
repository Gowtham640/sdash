/**
 * Timetable cache - 30 days
 * Timetables rarely change, so we cache them aggressively for 1 month
 */

import { setStorageItem, getStorageItem, removeStorageItem } from './browserStorage';

const TIMETABLE_CACHE_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
const TIMETABLE_CACHE_KEY = 'timetable_cache_data';
const TIMETABLE_CACHE_TIMESTAMP_KEY = 'timetable_cache_timestamp';

/**
 * Check if timetable cache is valid
 */
export function isTimetableCacheValid(): boolean {
  try {
    const timestamp = getStorageItem(TIMETABLE_CACHE_TIMESTAMP_KEY);
    if (!timestamp) {
      console.log('[TimetableCache] 🔍 Validation: No timestamp found');
      return false;
    }
    
    const age = Date.now() - parseInt(timestamp);
    const isValid = age < TIMETABLE_CACHE_DURATION;
    const ageDays = Math.floor(age / (24 * 60 * 60 * 1000));
    
    if (isValid) {
      console.log(`[TimetableCache] ✅ Validation: Cache valid (${ageDays} days old)`);
    } else {
      console.log(`[TimetableCache] ❌ Validation: Cache expired (${ageDays} days old, max 30 days)`);
    }
    
    return isValid;
  } catch (error) {
    console.error('[TimetableCache] ❌ Validation error:', error);
    return false;
  }
}

/**
 * Get cached timetable data
 */
export function getCachedTimetable(): any | null {
  try {
    if (!isTimetableCacheValid()) {
      console.log('[TimetableCache] ⚠️  Cannot get timetable: Cache invalid');
      return null;
    }
    
    const cached = getStorageItem(TIMETABLE_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      console.log('[TimetableCache] ✅ Retrieved timetable from cache');
      return parsed;
    }
    console.log('[TimetableCache] ⚠️  Timetable not found in cache');
    return null;
  } catch (error) {
    console.error('[TimetableCache] ❌ Error getting timetable');
    console.error(`[TimetableCache]   - Error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Store timetable in cache
 */
export function storeTimetableCache(timetable: any): void {
  try {
    const timetableSize = JSON.stringify(timetable).length;
    
    console.log('[TimetableCache] 💾 Storing timetable...');
    console.log(`[TimetableCache]   - Timetable size: ${(timetableSize / 1024).toFixed(2)} KB`);
    
    const timetableStored = setStorageItem(TIMETABLE_CACHE_KEY, JSON.stringify(timetable));
    const timestampStored = setStorageItem(TIMETABLE_CACHE_TIMESTAMP_KEY, Date.now().toString());
    
    if (!timetableStored || !timestampStored) {
      throw new Error('Storage failed - one or more items could not be stored');
    }
    
    // Verify storage
    const storedTimetable = getStorageItem(TIMETABLE_CACHE_KEY);
    
    if (storedTimetable) {
      console.log('[TimetableCache] ✅ Storage verified successfully');
      console.log(`[TimetableCache]   - Valid until: ${new Date(Date.now() + TIMETABLE_CACHE_DURATION).toLocaleDateString()}`);
    } else {
      throw new Error('Storage verification failed');
    }
  } catch (error) {
    console.error('[TimetableCache] ❌ Storage failed');
    console.error(`[TimetableCache]   - Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[TimetableCache]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
  }
}

/**
 * Clear timetable cache (e.g., on logout or manual refresh)
 */
export function clearTimetableCache(): void {
  try {
    removeStorageItem(TIMETABLE_CACHE_KEY);
    removeStorageItem(TIMETABLE_CACHE_TIMESTAMP_KEY);
    console.log('[TimetableCache] Cleared ✓');
  } catch (error) {
    console.error('[TimetableCache] Failed to clear:', error);
  }
}

/**
 * Get cache age in days
 */
export function getTimetableCacheAge(): number {
  try {
    const timestamp = getStorageItem(TIMETABLE_CACHE_TIMESTAMP_KEY);
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
export function getTimetableCacheDaysRemaining(): number {
  try {
    if (!isTimetableCacheValid()) {
      return 0;
    }
    
    const timestamp = getStorageItem(TIMETABLE_CACHE_TIMESTAMP_KEY);
    if (!timestamp) {
      return 0;
    }
    
    const ageMs = Date.now() - parseInt(timestamp);
    const remainingMs = TIMETABLE_CACHE_DURATION - ageMs;
    return Math.max(0, Math.floor(remainingMs / (24 * 60 * 60 * 1000)));
  } catch {
    return 0;
  }
}

