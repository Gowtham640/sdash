/** Cache layer disabled: data must be read directly from user_cache */
export type CacheDataType = 'attendance' | 'marks' | 'calendar' | 'timetable';

export interface CacheInfo {
  data: unknown;
  expiresAt: Date | null;
  isAboutToExpire: boolean;
  minutesUntilExpiry: number | null;
}

export async function getSupabaseCache(): Promise<null> {
  console.warn('[SupabaseCache] Disabled; reading directly from user_cache instead.');
  return null;
}

export async function getSupabaseCacheWithInfo(): Promise<null> {
  console.warn('[SupabaseCache] Disabled; reading directly from user_cache instead.');
  return null;
}

export async function getSupabaseCacheEvenIfExpired(): Promise<null> {
  console.warn('[SupabaseCache] Disabled; reading directly from user_cache instead.');
  return null;
}

export async function setSupabaseCache(): Promise<boolean> {
  console.warn('[SupabaseCache] Disabled; writing to cache is not allowed.');
  return false;
}

export async function deleteSupabaseCache(): Promise<boolean> {
  console.warn('[SupabaseCache] Disabled; deleting cache is not allowed.');
  return false;
}

export async function clearAllSupabaseCache(): Promise<boolean> {
  console.warn('[SupabaseCache] Disabled; clearing cache is not allowed.');
  return false;
}

export async function isSupabaseCacheValid(): Promise<boolean> {
  console.warn('[SupabaseCache] Disabled; validity checks are not used.');
  return false;
}

