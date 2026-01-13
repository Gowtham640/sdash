/**
 * Supabase Cache Utility
 * Different TTLs per data type:
 * - Attendance: 4 hours
 * - Marks: 1 day (24 hours)
 * - Calendar: Forever (only fetch on force refresh)
 * - Timetable: Forever (only fetch on force refresh)
 */

import { supabaseAdmin } from './supabaseAdmin';

export type CacheDataType = 'attendance' | 'marks' | 'calendar' | 'timetable';

// TTL in milliseconds
const CACHE_TTL: Record<CacheDataType, number | null> = {
  attendance: 4 * 60 * 60 * 1000, // 4 hours
  marks: 24 * 60 * 60 * 1000, // 1 day
  calendar: null, // Forever (null = never expires)
  timetable: null, // Forever (null = never expires)
};

// Prefetch threshold: fetch new data 30 minutes before expiry
const PREFETCH_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  id: number;
  user_id: string;
  data_type: string;
  data: unknown;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export interface CacheInfo {
  data: unknown;
  expiresAt: Date | null;
  isAboutToExpire: boolean;
  minutesUntilExpiry: number | null;
}

/**
 * Get cached data from Supabase if it exists and is still valid
 */
export async function getSupabaseCache(
  user_id: string,
  dataType: CacheDataType,
  forceRefresh: boolean = false,
  sessionId?: string | null
): Promise<unknown | null> {
  const cacheInfo = await getSupabaseCacheWithInfo(user_id, dataType, forceRefresh, sessionId);
  return cacheInfo?.data || null;
}

/**
 * Get cached data with expiry information
 */
export async function getSupabaseCacheWithInfo(
  user_id: string,
  dataType: CacheDataType,
  forceRefresh: boolean = false,
  sessionId?: string | null
): Promise<CacheInfo | null> {
  if (forceRefresh) {
    console.log(`[SupabaseCache] Force refresh requested for ${dataType}, skipping cache`);
    return null;
  }

  try {
    const cacheStartTime = Date.now();
    console.log(`[SupabaseCache] 🔍 Checking cache for ${dataType} (user: ${user_id})`);
    
    const { data, error } = await supabaseAdmin
      .from('user_cache')
      .select('*')
      .eq('user_id', user_id)
      .eq('data_type', dataType)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned (cache doesn't exist)
        console.log(`[SupabaseCache] No cache found for ${dataType}`);
        return null;
      }
      console.error(`[SupabaseCache] Error fetching cache for ${dataType}:`, error);
      return null;
    }

    if (!data) {
      console.log(`[SupabaseCache] No cache found for ${dataType}`);
      return null;
    }

    const entry = data as CacheEntry;
    const now = new Date();
    const expiresAt = entry.expires_at ? new Date(entry.expires_at) : null;

    // Check if cache is expired
    if (expiresAt && now > expiresAt) {
      console.log(`[SupabaseCache] Cache expired for ${dataType} (expired at: ${expiresAt.toISOString()})`);
      // Cache expired - return null to trigger fresh fetch, but don't delete the entry
      // The cache will be updated when fresh data is fetched
      return null;
    }

    // Calculate expiry info
    let minutesUntilExpiry: number | null = null;
    let isAboutToExpire = false;

    if (expiresAt) {
      const msUntilExpiry = expiresAt.getTime() - now.getTime();
      minutesUntilExpiry = Math.round(msUntilExpiry / 1000 / 60);
      isAboutToExpire = msUntilExpiry <= PREFETCH_THRESHOLD_MS;
    }

    // Cache is valid
    const age = now.getTime() - new Date(entry.updated_at).getTime();
    const ageMinutes = Math.round(age / 1000 / 60);
    const responseTime = Date.now() - cacheStartTime;
    console.log(`[SupabaseCache] ✅ Cache hit for ${dataType} (age: ${ageMinutes} minutes)`);
    if (minutesUntilExpiry !== null) {
      console.log(`[SupabaseCache]   - Expires in: ${minutesUntilExpiry} minutes`);
      if (isAboutToExpire) {
        console.log(`[SupabaseCache]   - ⚠️ About to expire! (within ${Math.round(PREFETCH_THRESHOLD_MS / 1000 / 60)} minutes)`);
      }
    }

    // Track cache hit event (async, non-blocking)
    const { trackCacheHit } = await import('@/lib/analyticsServer');
    void trackCacheHit(dataType, user_id, responseTime, sessionId);

    return {
      data: entry.data,
      expiresAt,
      isAboutToExpire,
      minutesUntilExpiry,
    };
  } catch (error) {
    console.error(`[SupabaseCache] Exception fetching cache for ${dataType}:`, error);
    return null;
  }
}

/**
 * Get cached data even if expired (for stale-while-revalidate pattern)
 * Returns the cache entry data regardless of expiry status
 */
export async function getSupabaseCacheEvenIfExpired(
  user_id: string,
  dataType: CacheDataType
): Promise<unknown | null> {
  try {
    console.log(`[SupabaseCache] 🔍 Fetching cache for ${dataType} (even if expired) (user: ${user_id})`);
    
    const { data, error } = await supabaseAdmin
      .from('user_cache')
      .select('data, expires_at')
      .eq('user_id', user_id)
      .eq('data_type', dataType)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned (cache doesn't exist)
        console.log(`[SupabaseCache] No cache found for ${dataType} (even expired)`);
        return null;
      }
      console.error(`[SupabaseCache] Error fetching cache for ${dataType}:`, error);
      return null;
    }

    if (!data) {
      console.log(`[SupabaseCache] No cache found for ${dataType} (even expired)`);
      return null;
    }

    const entry = data as { data: unknown; expires_at: string | null };
    const now = new Date();
    const expiresAt = entry.expires_at ? new Date(entry.expires_at) : null;
    
    if (expiresAt && now > expiresAt) {
      const msSinceExpiry = now.getTime() - expiresAt.getTime();
      const minutesSinceExpiry = Math.round(msSinceExpiry / 1000 / 60);
      console.log(`[SupabaseCache] ⚠️ Cache expired for ${dataType} (expired ${minutesSinceExpiry} minutes ago), but returning stale data for fallback`);
    } else {
      console.log(`[SupabaseCache] ✅ Cache found for ${dataType} (valid)`);
    }

    return entry.data;
  } catch (error) {
    console.error(`[SupabaseCache] Exception fetching cache (even if expired) for ${dataType}:`, error);
    return null;
  }
}

/**
 * Cache saving disabled - project should not write to Supabase tables
 */
export async function setSupabaseCache(
  user_id: string,
  dataType: CacheDataType,
  data: unknown
): Promise<boolean> {
  console.log(`[SupabaseCache] ⚠️ Cache saving disabled - project should not write to Supabase tables`);
  return false;
}

/**
 * Cache deletion disabled - project should not write to Supabase tables
 */
export async function deleteSupabaseCache(
  user_id: string,
  dataType: CacheDataType
): Promise<boolean> {
  console.log(`[SupabaseCache] ⚠️ Cache deletion disabled - project should not write to Supabase tables`);
  return false;
}

/**
 * Clear all caches disabled - project should not write to Supabase tables
 */
export async function clearAllSupabaseCache(user_id: string): Promise<boolean> {
  console.log(`[SupabaseCache] ⚠️ Clear all caches disabled - project should not write to Supabase tables`);
  return false;
}

/**
 * Check if cache exists and is valid (without fetching the data)
 */
export async function isSupabaseCacheValid(
  user_id: string,
  dataType: CacheDataType
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_cache')
      .select('expires_at, updated_at')
      .eq('user_id', user_id)
      .eq('data_type', dataType)
      .single();

    if (error || !data) {
      return false;
    }

    const entry = data as { expires_at: string | null; updated_at: string };
    const now = new Date();
    const expiresAt = entry.expires_at ? new Date(entry.expires_at) : null;

    // If no expiry, cache is valid forever
    if (!expiresAt) {
      return true;
    }

    // Check if expired
    return now <= expiresAt;
  } catch {
    return false;
  }
}

