/**
 * Client-Side Cache Utility
 * 1 hour TTL for all data types to prevent loading states
 */

import { getStorageItem, setStorageItem, removeStorageItem } from './browserStorage';

const CACHE_PREFIX = 'client_cache_';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in milliseconds

export type CacheDataType = 'attendance' | 'marks' | 'calendar' | 'timetable' | 'unified';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Get cached data if it exists and is still valid
 */
export function getClientCache<T>(dataType: CacheDataType): T | null {
  try {
    const cacheKey = `${CACHE_PREFIX}${dataType}`;
    const cached = getStorageItem(cacheKey);
    
    if (!cached) {
      return null;
    }
    
    const entry: CacheEntry<T> = JSON.parse(cached);
    const now = Date.now();
    const age = now - entry.timestamp;
    
    if (age > CACHE_TTL_MS) {
      // Cache expired, remove it
      removeStorageItem(cacheKey);
      console.log(`[ClientCache] Cache expired for ${dataType} (age: ${Math.round(age / 1000 / 60)} minutes)`);
      return null;
    }
    
    const remainingMinutes = Math.round((CACHE_TTL_MS - age) / 1000 / 60);
    console.log(`[ClientCache] ✅ Cache hit for ${dataType} (${remainingMinutes} minutes remaining)`);
    return entry.data;
  } catch (error) {
    console.error(`[ClientCache] Error reading cache for ${dataType}:`, error);
    return null;
  }
}

/**
 * Set cached data with timestamp
 */
export function setClientCache<T>(dataType: CacheDataType, data: T): boolean {
  try {
    const cacheKey = `${CACHE_PREFIX}${dataType}`;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };
    
    const stored = setStorageItem(cacheKey, JSON.stringify(entry));
    if (stored) {
      console.log(`[ClientCache] ✅ Cached ${dataType} (expires in 1 hour)`);
    } else {
      console.warn(`[ClientCache] ⚠️ Failed to cache ${dataType}`);
    }
    return stored;
  } catch (error) {
    console.error(`[ClientCache] Error setting cache for ${dataType}:`, error);
    return false;
  }
}

/**
 * Remove cached data
 */
export function removeClientCache(dataType: CacheDataType): void {
  const cacheKey = `${CACHE_PREFIX}${dataType}`;
  removeStorageItem(cacheKey);
  console.log(`[ClientCache] 🗑️ Removed cache for ${dataType}`);
}

/**
 * Clear all client caches
 */
export function clearAllClientCache(): void {
  const types: CacheDataType[] = ['attendance', 'marks', 'calendar', 'timetable', 'unified'];
  types.forEach(type => removeClientCache(type));
  console.log('[ClientCache] 🗑️ Cleared all client caches');
}

/**
 * Check if cache exists and is valid
 */
export function isClientCacheValid(dataType: CacheDataType): boolean {
  const cached = getClientCache(dataType);
  return cached !== null;
}

