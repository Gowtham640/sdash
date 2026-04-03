import { getStorageItem, setStorageItem, removeStorageItem } from './browserStorage';

/** Supported cache keys shared between in-memory storage and Supabase user_cache */
export type CacheDataType = 'attendance' | 'marks' | 'calendar' | 'timetable' | 'unified';

interface ClientCacheEntry {
  data: unknown;
  expiresAt: string | null;
}

interface CacheSetOptions {
  expiresAt?: string | null;
}

const CACHE_TYPES_WITH_SUPABASE_EXPIRY: Set<CacheDataType> = new Set(['attendance', 'marks', 'timetable']);

const cacheStore = new Map<string, ClientCacheEntry>();

let cachedUserId: string | null = null;
let cachedTokenForUserId: string | null = null;

const ACCESS_TOKEN_KEY = 'access_token';

/** localStorage key: sdash_cache_${userId}:${dataType} */
export function buildClientCacheStorageKey(userId: string, dataType: CacheDataType): string {
  return `sdash_cache_${userId}:${dataType}`;
}

export function resetClientCacheUserIdMemory(): void {
  resetUserIdCache();
}

function resetUserIdCache() {
  cachedUserId = null;
  cachedTokenForUserId = null;
}

function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const payload = parts[1];
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  try {
    const raw =
      typeof window !== 'undefined' && typeof window.atob === 'function'
        ? window.atob(padded)
        : typeof Buffer !== 'undefined'
          ? Buffer.from(padded, 'base64').toString('utf-8')
          : null;

    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.warn('[ClientCache] Failed to decode JWT payload', error);
    return null;
  }
}

/**
 * Current user id (JWT sub) for cache namespacing. Never use for storage keys without a token present.
 */
export function getClientCacheUserId(): string | null {
  return getCurrentUserId();
}

function getCurrentUserId(): string | null {
  const accessToken = getStorageItem(ACCESS_TOKEN_KEY);
  if (!accessToken) {
    resetUserIdCache();
    return null;
  }

  if (accessToken === cachedTokenForUserId && cachedUserId) {
    return cachedUserId;
  }

  const decoded = decodeJwt(accessToken);
  const sub = decoded && typeof decoded.sub === 'string' ? decoded.sub : null;
  cachedUserId = sub;
  cachedTokenForUserId = accessToken;
  return sub;
}

function buildCacheKey(dataType: CacheDataType, userId: string): string {
  return `${userId}:${dataType}`;
}

function getCacheKeyForType(dataType: CacheDataType): string | null {
  const userId = getCurrentUserId();
  if (!userId) {
    console.warn(`[ClientCache] Skipping ${dataType} cache - user ID unavailable`);
    return null;
  }
  return buildCacheKey(dataType, userId);
}

function hasExpired(expiresAt: string | null): boolean {
  if (!expiresAt) {
    return false;
  }

  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) {
    console.warn('[ClientCache] Invalid expiry timestamp detected:', expiresAt);
    return true;
  }

  return Date.now() >= parsed;
}

function parseStoredEntry(raw: string | null): ClientCacheEntry | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const o = parsed as Record<string, unknown>;
    if (!('data' in o)) {
      return null;
    }
    return {
      data: o.data,
      expiresAt: typeof o.expiresAt === 'string' || o.expiresAt === null ? (o.expiresAt as string | null) : null,
    };
  } catch (error) {
    console.warn('[ClientCache] Failed to parse stored cache entry', error);
    return null;
  }
}

function persistEntryToDisk(userId: string, dataType: CacheDataType, entry: ClientCacheEntry): void {
  const storageKey = buildClientCacheStorageKey(userId, dataType);
  try {
    const ok = setStorageItem(storageKey, JSON.stringify(entry));
    if (!ok) {
      console.warn('[ClientCache] Failed to persist entry to storage:', storageKey);
    }
  } catch (error) {
    console.warn('[ClientCache] persistEntryToDisk error:', error);
  }
}

function removeEntryFromDisk(userId: string, dataType: CacheDataType): void {
  const storageKey = buildClientCacheStorageKey(userId, dataType);
  try {
    removeStorageItem(storageKey);
  } catch (error) {
    console.warn('[ClientCache] removeEntryFromDisk error:', error);
  }
}

function hydrateFromDisk(userId: string, dataType: CacheDataType): ClientCacheEntry | null {
  const storageKey = buildClientCacheStorageKey(userId, dataType);
  const raw = getStorageItem(storageKey);
  const entry = parseStoredEntry(raw);
  return entry;
}

function persistEntry(key: string, entry: ClientCacheEntry, userId: string, dataType: CacheDataType): void {
  cacheStore.set(key, entry);
  persistEntryToDisk(userId, dataType, entry);
}

function dropEntry(key: string, userId: string, dataType: CacheDataType): void {
  cacheStore.delete(key);
  removeEntryFromDisk(userId, dataType);
}

/**
 * Returns cached payload if present, even when past expiresAt (stale).
 * Order: memory Map, then localStorage hydration into Map.
 */
export function getClientCache<T>(dataType: CacheDataType): T | null {
  const key = getCacheKeyForType(dataType);
  if (!key) {
    return null;
  }

  const userId = getCurrentUserId();
  if (!userId) {
    return null;
  }

  let entry = cacheStore.get(key);
  if (!entry) {
    const fromDisk = hydrateFromDisk(userId, dataType);
    if (fromDisk) {
      cacheStore.set(key, fromDisk);
      entry = fromDisk;
    }
  }

  if (!entry) {
    return null;
  }

  // Stale entries are kept for SWR; do not delete on read.
  if (CACHE_TYPES_WITH_SUPABASE_EXPIRY.has(dataType) && hasExpired(entry.expiresAt)) {
    console.log(`[ClientCache] Cached ${dataType} is stale (past expiresAt) but retained for instant UI`);
  }

  return entry.data as T;
}

/**
 * True when an entry exists for the current user and is past expiresAt (attendance/marks/timetable only).
 */
export function isClientCacheStale(dataType: CacheDataType): boolean {
  const key = getCacheKeyForType(dataType);
  if (!key) {
    return false;
  }

  const userId = getCurrentUserId();
  if (!userId) {
    return false;
  }

  let entry = cacheStore.get(key);
  if (!entry) {
    const fromDisk = hydrateFromDisk(userId, dataType);
    if (fromDisk) {
      cacheStore.set(key, fromDisk);
      entry = fromDisk;
    }
  }

  if (!entry) {
    return false;
  }

  if (!CACHE_TYPES_WITH_SUPABASE_EXPIRY.has(dataType)) {
    return false;
  }

  return hasExpired(entry.expiresAt);
}

export function setClientCache<T>(dataType: CacheDataType, data: T, options?: CacheSetOptions): boolean {
  const key = getCacheKeyForType(dataType);
  if (!key) {
    return false;
  }

  const userId = getCurrentUserId();
  if (!userId) {
    return false;
  }

  const existing = cacheStore.get(key);
  const expiresAt =
    options?.expiresAt ?? existing?.expiresAt ?? (CACHE_TYPES_WITH_SUPABASE_EXPIRY.has(dataType) ? null : null);

  persistEntry(
    key,
    {
      data,
      expiresAt,
    },
    userId,
    dataType
  );

  return true;
}

export function removeClientCache(dataType: CacheDataType): void {
  const key = getCacheKeyForType(dataType);
  if (!key) {
    return;
  }

  const userId = getCurrentUserId();
  if (!userId) {
    cacheStore.delete(key);
    return;
  }

  dropEntry(key, userId, dataType);
}

/**
 * Clears memory and all sdash_cache_* keys in browser storage (current storage backend).
 */
export function clearAllClientCache(): void {
  cacheStore.clear();
  resetUserIdCache();

  if (typeof window === 'undefined') {
    return;
  }

  try {
    const storage = window.localStorage;
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith('sdash_cache_')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => storage.removeItem(k));
  } catch (error) {
    console.warn('[ClientCache] clearAllClientCache localStorage scan failed', error);
  }
}

/**
 * True when a usable entry exists and expiresAt has not passed (same intent as before persistence).
 * Does not delete entries on read.
 */
export function isClientCacheValid(dataType: CacheDataType): boolean {
  const key = getCacheKeyForType(dataType);
  if (!key) {
    return false;
  }

  const userId = getCurrentUserId();
  if (!userId) {
    return false;
  }

  let entry = cacheStore.get(key);
  if (!entry) {
    const fromDisk = hydrateFromDisk(userId, dataType);
    if (fromDisk) {
      cacheStore.set(key, fromDisk);
      entry = fromDisk;
    }
  }

  if (!entry) {
    return false;
  }

  if (CACHE_TYPES_WITH_SUPABASE_EXPIRY.has(dataType) && hasExpired(entry.expiresAt)) {
    return false;
  }

  return true;
}

export function getClientCacheWithMeta<T>(dataType: CacheDataType): {
  data: T | null;
  isStale: boolean;
} {
  const data = getClientCache<T>(dataType);
  const stale = isClientCacheStale(dataType);
  return { data, isStale: stale };
}
