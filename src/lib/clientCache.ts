/** @deprecated client-side cache disabled per latest architecture decisions */
export type CacheDataType = 'attendance' | 'marks' | 'calendar' | 'timetable' | 'unified';

export function getClientCache<T>(_dataType: CacheDataType): T | null {
  console.warn('[ClientCache] Disabled; client-side cache is no longer used.');
  return null;
}

export function setClientCache<T>(_dataType: CacheDataType, _data: T): boolean {
  console.warn('[ClientCache] Disabled; client-side cache is no longer used.');
  return false;
}

export function removeClientCache(_dataType: CacheDataType): void {
  console.warn('[ClientCache] Disabled; client-side cache is no longer used.');
}

export function clearAllClientCache(): void {
  console.warn('[ClientCache] Disabled; client-side cache is no longer used.');
}

export function isClientCacheValid(_dataType: CacheDataType): boolean {
  return false;
}

