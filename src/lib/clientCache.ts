import { getStorageItem } from './browserStorage';

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

function persistEntry(key: string, entry: ClientCacheEntry): void {
  cacheStore.set(key, entry);
}

function dropEntry(key: string): void {
  cacheStore.delete(key);
}

export function getClientCache<T>(dataType: CacheDataType): T | null {
  const key = getCacheKeyForType(dataType);
  if (!key) {
    return null;
  }

  const entry = cacheStore.get(key);
  if (!entry) {
    return null;
  }

  if (CACHE_TYPES_WITH_SUPABASE_EXPIRY.has(dataType) && hasExpired(entry.expiresAt)) {
    dropEntry(key);
    console.log(`[ClientCache] Cached ${dataType} expired and was cleared`);
    return null;
  }

  return entry.data as T;
}

export function setClientCache<T>(dataType: CacheDataType, data: T, options?: CacheSetOptions): boolean {
  const key = getCacheKeyForType(dataType);
  if (!key) {
    return false;
  }

  const existing = cacheStore.get(key);
  const expiresAt =
    options?.expiresAt ?? existing?.expiresAt ?? (CACHE_TYPES_WITH_SUPABASE_EXPIRY.has(dataType) ? null : null);

  persistEntry(key, {
    data,
    expiresAt,
  });

  return true;
}

export function removeClientCache(dataType: CacheDataType): void {
  const key = getCacheKeyForType(dataType);
  if (!key) {
    return;
  }

  dropEntry(key);
}

export function clearAllClientCache(): void {
  cacheStore.clear();
  resetUserIdCache();
}

export function isClientCacheValid(dataType: CacheDataType): boolean {
  const key = getCacheKeyForType(dataType);
  if (!key) {
    return false;
  }

  const entry = cacheStore.get(key);
  if (!entry) {
    return false;
  }

  if (CACHE_TYPES_WITH_SUPABASE_EXPIRY.has(dataType) && hasExpired(entry.expiresAt)) {
    dropEntry(key);
    return false;
  }

  return true;
}

