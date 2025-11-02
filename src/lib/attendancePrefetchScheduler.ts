/**
 * Smart Prefetch Scheduler for Attendance & Marks
 * Schedules background refresh of attendance/marks data before cache expiry
 * Only refreshes dynamic data (attendance/marks), preserves timetable/calendar cache
 */

import { getStorageItem, setStorageItem } from './browserStorage';
import { isTimetableCacheValid } from './timetableCache';
import { isCalendarCacheValid } from './calendarCache';
import { getRequestBodyWithPassword } from './passwordStorage';

// Cache configuration
const ATTENDANCE_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours
const PREFETCH_TRIGGER_OFFSET = 5 * 60 * 1000; // 5 minutes before expiry

// Scheduler state
let scheduledTimeout: NodeJS.Timeout | null = null;
let isRefreshing = false;

/**
 * Calculate when to trigger the next prefetch based on cache expiry
 * Returns milliseconds until next trigger, or null if already expired
 */
function calculateNextPrefetchTime(): number | null {
  try {
    const cachedTimestamp = getStorageItem('unified_data_cache_timestamp');
    if (!cachedTimestamp) {
      return null; // No cache to refresh
    }
    
    const cacheAge = Date.now() - parseInt(cachedTimestamp);
    const timeUntilExpiry = ATTENDANCE_CACHE_DURATION - cacheAge;
    const timeUntilPrefetch = timeUntilExpiry - PREFETCH_TRIGGER_OFFSET;
    
    if (timeUntilPrefetch <= 0) {
      return 0; // Trigger immediately
    }
    
    return timeUntilPrefetch;
  } catch (error) {
    console.error('[PrefetchScheduler] Error calculating prefetch time:', error);
    return null;
  }
}

/**
 * Execute the background prefetch
 */
async function executePrefetch(): Promise<void> {
  if (isRefreshing) {
    console.log('[PrefetchScheduler] ⏸️  Already refreshing, skipping duplicate prefetch');
    return;
  }
  
  isRefreshing = true;
  console.log('[PrefetchScheduler] 🔄 Starting background prefetch for attendance/marks...');
  
  try {
    const access_token = getStorageItem('access_token');
    if (!access_token) {
      console.error('[PrefetchScheduler] ❌ No access token for prefetch');
      return;
    }
    
    // Check if we have valid timetable/calendar cache
    const hasValidTimetable = isTimetableCacheValid();
    const hasValidCalendar = isCalendarCacheValid();
    const hasValidStaticCache = hasValidTimetable && hasValidCalendar;
    
    console.log(`[PrefetchScheduler] 📊 Static cache status: Timetable=${hasValidTimetable}, Calendar=${hasValidCalendar}`);
    
    // Call API using the same method as pages do (with password support)
    const response = await fetch('/api/data/all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getRequestBodyWithPassword(access_token, false, hasValidStaticCache))
    });

    const result = await response.json();

    if (result.success) {
      // Store in unified cache (same as pages do)
      const cacheKey = 'unified_data_cache';
      const cachedTimestampKey = 'unified_data_cache_timestamp';
      
      setStorageItem(cacheKey, JSON.stringify(result));
      setStorageItem(cachedTimestampKey, Date.now().toString());
      
      console.log('[PrefetchScheduler] ✅ Background prefetch completed and cached');
      // Schedule next prefetch
      scheduleNextPrefetch();
    } else {
      console.error('[PrefetchScheduler] ❌ Background prefetch failed:', result.error);
    }
  } catch (error) {
    console.error('[PrefetchScheduler] ❌ Prefetch error:', error);
  } finally {
    isRefreshing = false;
  }
}

/**
 * Schedule the next prefetch
 */
function scheduleNextPrefetch(): void {
  // Clear any existing timeout
  if (scheduledTimeout) {
    clearTimeout(scheduledTimeout);
    scheduledTimeout = null;
  }
  
  const nextPrefetchTime = calculateNextPrefetchTime();
  
  if (nextPrefetchTime === null) {
    console.log('[PrefetchScheduler] ⏸️  No active cache to prefetch');
    return;
  }
  
  const minutesUntilPrefetch = Math.floor(nextPrefetchTime / (60 * 1000));
  console.log(`[PrefetchScheduler] ⏰ Next prefetch scheduled in ${minutesUntilPrefetch} minutes`);
  
  scheduledTimeout = setTimeout(() => {
    executePrefetch();
  }, nextPrefetchTime);
}

/**
 * Register a successful attendance/marks fetch
 * This should be called after any page successfully fetches and caches attendance/marks data
 */
export function registerAttendanceFetch(): void {
  console.log('[PrefetchScheduler] 📝 Registering successful attendance/marks fetch');
  scheduleNextPrefetch();
}

/**
 * Cancel any scheduled prefetch (e.g., on logout or manual refresh)
 */
export function cancelScheduledPrefetch(): void {
  if (scheduledTimeout) {
    clearTimeout(scheduledTimeout);
    scheduledTimeout = null;
    console.log('[PrefetchScheduler] ❌ Canceled scheduled prefetch');
  }
}

/**
 * Get scheduler status (for debugging)
 */
export function getSchedulerStatus(): {
  is_scheduled: boolean;
  is_refreshing: boolean;
  minutes_until_next: number | null;
} {
  const nextPrefetchTime = calculateNextPrefetchTime();
  return {
    is_scheduled: scheduledTimeout !== null,
    is_refreshing: isRefreshing,
    minutes_until_next: nextPrefetchTime !== null ? Math.floor(nextPrefetchTime / (60 * 1000)) : null
  };
}

