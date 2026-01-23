import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { CacheDataType } from "@/lib/supabaseCache";

export interface UserCacheEntry {
  data: unknown | null;
  expiresAt: string | null;
}

const VALID_DATA_TYPES: CacheDataType[] = ['attendance', 'marks', 'calendar', 'timetable'];

export async function fetchUserCacheEntries(
  user_id: string,
  dataTypes: CacheDataType[]
): Promise<Record<CacheDataType, UserCacheEntry>> {
  const uniqueTypes = Array.from(new Set(dataTypes.filter((type) => VALID_DATA_TYPES.includes(type))));
  if (uniqueTypes.length === 0) {
    return {} as Record<CacheDataType, UserCacheEntry>;
  }

  const { data, error } = await supabaseAdmin
    .from('user_cache')
    .select('data_type, data, expires_at')
    .eq('user_id', user_id)
    .in('data_type', uniqueTypes);

  if (error) {
    console.error('[UserCacheReader] Failed to read user cache:', error);
    throw error;
  }

  const entries: Record<CacheDataType, UserCacheEntry> = {} as Record<CacheDataType, UserCacheEntry>;
  if (!data) {
    return entries;
  }

  data.forEach((row: { data_type: string; data: unknown; expires_at: string | null }) => {
    const type = row.data_type as CacheDataType;
    if (uniqueTypes.includes(type)) {
      entries[type] = {
        data: row.data ?? null,
        expiresAt: row.expires_at ?? null,
      };
    }
  });

  return entries;
}
