import { getRequestBodyWithPassword } from '@/lib/passwordStorage';
import { getStorageItem } from '@/lib/browserStorage';
import { getClientCache, removeClientCache, setClientCache } from '@/lib/clientCache';
import { deduplicateRequest } from '@/lib/requestDeduplication';
import { registerAttendanceFetch } from '@/lib/attendancePrefetchScheduler';
import { trackPostRequest } from '@/lib/postAnalytics';

export interface MarksAssessment {
  max: number;
  name: string;
  score: number | null;
}

export interface MarksEntry {
  total: number | null;
  courseCode: string;
  assessments: MarksAssessment[];
  courseTitle: string;
  credit?: string;
}

export interface MarksPayload {
  url: string;
  entries: MarksEntry[];
  fetched_at: string;
}

const MARKS_CACHE_KEY = 'marks' as const;

export function extractMarksPayload(value: unknown): MarksPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as { entries?: unknown; url?: string; fetched_at?: string };
  if (!Array.isArray(candidate.entries)) {
    return null;
  }

  return {
    url: typeof candidate.url === 'string' ? candidate.url : '',
    fetched_at: typeof candidate.fetched_at === 'string' ? candidate.fetched_at : '',
    entries: candidate.entries as MarksEntry[],
  };
}

/**
 * Fetches marks via Supabase cache first, then unified API when needed.
 * Updates persistent client cache on success.
 */
export async function fetchMarksPayloadClient(options: { forceRefresh: boolean }): Promise<MarksPayload> {
  const { forceRefresh } = options;
  const access_token = getStorageItem('access_token');
  if (!access_token) {
    throw new Error('Please sign in to view marks');
  }

  if (forceRefresh) {
    removeClientCache(MARKS_CACHE_KEY);
  }

  let cachedPayload: MarksPayload | null = null;
  let needsBackgroundRefresh = forceRefresh;

  if (!forceRefresh) {
    cachedPayload = getClientCache<MarksPayload>(MARKS_CACHE_KEY);

    if (!cachedPayload) {
      try {
        const cacheResponse = await trackPostRequest('/api/data/cache', {
          action: 'cache_fetch',
          dataType: 'marks',
          primary: false,
          payload: { access_token, data_type: 'marks' },
          omitPayloadKeys: ['access_token'],
        });
        const cacheResult = await cacheResponse.json();
        if (cacheResult.success && cacheResult.data) {
          const extracted = extractMarksPayload(cacheResult.data);
          if (extracted) {
            cachedPayload = extracted;
            if (cacheResult.isExpired) {
              needsBackgroundRefresh = true;
            }
          }
        }
      } catch (cacheError) {
        console.error('[Marks] Error fetching cache:', cacheError);
      }
    }
  }

  if (!cachedPayload || forceRefresh || needsBackgroundRefresh) {
    const requestKey = `fetch_marks_${access_token.substring(0, 10)}`;
    const apiResult = await deduplicateRequest(requestKey, async () => {
      const response = await trackPostRequest('/api/data/all', {
        action: 'data_unified_fetch',
        dataType: 'marks',
        payload: getRequestBodyWithPassword(access_token, forceRefresh),
        omitPayloadKeys: ['password', 'access_token'],
      });
      const result = await response.json();
      return { response, result };
    });

    const { response, result } = apiResult;
    if (!response.ok || result.error === 'session_expired') {
      throw new Error('SESSION_EXPIRED');
    }

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch marks data');
    }

    const payloadCandidate = extractMarksPayload(result.data?.marks ?? result.data);
    if (!payloadCandidate) {
      throw new Error('Marks data missing from response');
    }

    setClientCache(MARKS_CACHE_KEY, payloadCandidate);
    registerAttendanceFetch();
    return payloadCandidate;
  }

  return cachedPayload;
}
