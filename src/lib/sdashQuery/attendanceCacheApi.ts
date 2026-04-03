/**
 * Supabase-backed attendance cache reads and rebuilds (shared by Attendance page + TanStack Query).
 * Does not touch React state — callers apply payloads and setClientCache.
 */

import { trackPostRequest } from '@/lib/postAnalytics';
import { normalizeAttendanceData } from '@/lib/dataTransformers';
import type { AttendanceData } from '@/lib/apiTypes';

export type AttendanceCacheFetchResult = {
  data: AttendanceData;
  isExpired: boolean;
  expiresAt: string | null;
  source: 'cache' | 'fallback';
};

export function validateAttendanceCache(
  cacheResult: unknown
): { valid: boolean; normalized?: AttendanceData; reason?: string } {
  if (!cacheResult || typeof cacheResult !== 'object' || Array.isArray(cacheResult)) {
    const reason = 'Cache response missing or malformed';
    console.warn('[Attendance][Cache] ' + reason);
    return { valid: false, reason };
  }

  const { success, data } = cacheResult as { success?: boolean; data?: unknown };

  if (!success) {
    const reason = 'Cache responded with success=false';
    console.warn('[Attendance][Cache] ' + reason);
    return { valid: false, reason };
  }

  if (!data) {
    const reason = 'Cache returned empty data payload';
    console.warn('[Attendance][Cache] ' + reason);
    return { valid: false, reason };
  }

  const normalized = normalizeAttendanceData(data);
  if (!normalized) {
    const reason = 'Normalization failed for cached attendance payload';
    console.warn('[Attendance][Cache] ' + reason);
    return { valid: false, reason };
  }

  if (!normalized.all_subjects || normalized.all_subjects.length === 0) {
    const reason = 'Normalized cache contains no subjects';
    console.warn('[Attendance][Cache] ' + reason);
    return { valid: false, reason };
  }

  return { valid: true, normalized };
}

function extractAttendancePayload(payload: unknown): unknown | null {
  if (!payload) {
    return null;
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const candidate = payload as { data?: unknown };
    if ('data' in candidate && candidate.data !== undefined) {
      return candidate.data;
    }
  }

  return payload;
}

export async function rebuildAttendanceCache(
  access_token: string,
  normalizedData: AttendanceData
): Promise<{ expiresAt: string | null }> {
  const response = await trackPostRequest('/api/data/cache', {
    action: 'cache_rebuild',
    dataType: 'attendance',
    primary: false,
    payload: {
      access_token,
      data_type: 'attendance',
      normalized_data: normalizedData,
      expires_in_minutes: 10,
    },
    omitPayloadKeys: ['access_token'],
    payloadSummary: { subjects: normalizedData.all_subjects.length },
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    console.error('[Attendance][Cache] Failed to rebuild normalized cache:', result.error);
    throw new Error(result.error || 'Failed to rebuild attendance cache');
  }

  console.log(
    `[Attendance][Cache] Rebuilt normalized attendance cache with ${normalizedData.all_subjects.length} subjects`
  );

  return { expiresAt: result.expiresAt ?? null };
}

export async function fetchAttendanceDataDirectlyFromSupabase(
  access_token: string
): Promise<{ data: AttendanceData; isExpired: boolean; expiresAt: string | null }> {
  console.log('[Attendance][Cache] Triggering direct Supabase attendance fetch (fallback)');
  const response = await trackPostRequest('/api/data/all', {
    action: 'attendance_direct_fetch',
    dataType: 'attendance',
    primary: false,
    payload: {
      access_token,
      types: ['attendance'],
    },
    omitPayloadKeys: ['access_token'],
  });

  const result = await response.json();
  if (!response.ok || !result.success) {
    console.warn('[Attendance][Cache] Direct fetch failed:', result.error);
    throw new Error(result.error || 'Failed to fetch attendance from Supabase directly');
  }

  const attendancePayload = extractAttendancePayload(result.data?.attendance);
  if (!attendancePayload) {
    throw new Error('Attendance payload missing from fallback fetch');
  }

  const normalized = normalizeAttendanceData(attendancePayload);
  if (!normalized) {
    throw new Error('Failed to normalize attendance payload from fallback fetch');
  }

  const rebuildResult = await rebuildAttendanceCache(access_token, normalized);
  return {
    data: normalized,
    isExpired: false,
    expiresAt: rebuildResult.expiresAt,
  };
}

export async function fetchAttendanceDataFromSupabase(
  access_token: string,
  options: { maxRetries?: number; retryDelayMs?: number } = {}
): Promise<AttendanceCacheFetchResult> {
  const { maxRetries = 1, retryDelayMs = 0 } = options;
  let reason: string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      console.log(`[Attendance][API] Supabase cache fetch attempt ${attempt}/${maxRetries}`);
      const response = await trackPostRequest('/api/data/cache', {
        action: 'cache_fetch',
        dataType: 'attendance',
        primary: false,
        payload: { access_token, data_type: 'attendance' },
        omitPayloadKeys: ['access_token'],
      });

      if (!response.ok) {
        reason = `HTTP ${response.status}`;
        console.warn('[Attendance] Supabase cache request failed:', response.status, response.statusText);
      } else {
        const cacheResult = await response.json();

        console.log('[Attendance][API] Supabase cache response keys:', Object.keys(cacheResult || {}));

        const validation = validateAttendanceCache(cacheResult);
        if (validation.valid && validation.normalized) {
          console.log('[Attendance][Cache] Cache hit - using normalized data');
          return {
            data: validation.normalized,
            isExpired: !!cacheResult.isExpired,
            expiresAt: cacheResult.expiresAt ?? null,
            source: 'cache',
          };
        }

        reason = validation.reason ?? 'cache validation failed';
        console.warn('[Attendance][Cache] Cache invalid -', reason);
        break;
      }
    } catch (error) {
      reason = error instanceof Error ? error.message : 'unknown error';
      console.error('[Attendance][API] Error fetching attendance cache from Supabase:', error);
    }

    if (attempt < maxRetries && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  console.log(
    `[Attendance][Cache] Cache miss (reason: ${reason ?? 'unknown'}) — executing fallback fetch`
  );

  const fallback = await fetchAttendanceDataDirectlyFromSupabase(access_token);
  return {
    ...fallback,
    source: 'fallback',
  };
}
