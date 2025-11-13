/**
 * Smart Prefetch Scheduler for Attendance & Marks
 * Schedules background refresh of attendance/marks data
 */

import { getRequestBodyWithPassword } from './passwordStorage';

// Scheduler state
let scheduledTimeout: NodeJS.Timeout | null = null;
const isRefreshing = false; // Never changes since prefetch is disabled


/**
 * Register a successful attendance/marks fetch
 * This can be used to trigger background prefetch if needed
 */
export function registerAttendanceFetch(): void {
  console.log('[PrefetchScheduler] 📝 Attendance/marks fetch completed');
  // Prefetch scheduling disabled - all requests go directly to backend
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
  return {
    is_scheduled: false,
    is_refreshing: isRefreshing,
    minutes_until_next: null
  };
}

