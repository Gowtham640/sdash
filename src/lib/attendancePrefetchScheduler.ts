/**
 * Smart Prefetch Scheduler for Attendance & Marks
 * Schedules background refresh of attendance/marks data
 */

import { getRequestBodyWithPassword } from './passwordStorage';

// Scheduler state
let scheduledTimeout: NodeJS.Timeout | null = null;
let isRefreshing = false;

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
    // Note: Prefetch scheduler requires access_token from storage
    // This is a utility function, not part of the caching system
    const access_token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    if (!access_token) {
      console.error('[PrefetchScheduler] ❌ No access token for prefetch');
      return;
    }
    
    // Call API to fetch fresh data
    console.log(`[PrefetchScheduler] 🔄 Fetching fresh data from backend...`);
    const response = await fetch('/api/data/all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(getRequestBodyWithPassword(access_token, true))
    });

    const result = await response.json();

    if (result.success) {
      console.log('[PrefetchScheduler] ✅ Background prefetch completed');
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

