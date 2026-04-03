'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getClientCacheUserId } from '@/lib/clientCache';
import { getClientCache } from '@/lib/clientCache';
import { SDASH_DATA_STALE_TIME_MS } from '@/lib/sdashQuery/constants';
import {
  fetchMarksPayloadClient,
  type MarksPayload,
} from '@/lib/sdashQuery/fetchMarksPayload';

export function useSdashMarksQuery() {
  const userId = getClientCacheUserId();
  const initialCached = useMemo(() => getClientCache<MarksPayload>('marks'), []);

  return useQuery({
    queryKey: ['sdash', 'marks', userId ?? ''],
    queryFn: () => fetchMarksPayloadClient({ forceRefresh: false }),
    enabled: Boolean(userId),
    staleTime: SDASH_DATA_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    initialData: initialCached ?? undefined,
  });
}

export async function refetchMarksWithForce(queryClient: QueryClient): Promise<MarksPayload> {
  const uid = getClientCacheUserId();
  const data = await fetchMarksPayloadClient({ forceRefresh: true });
  if (uid) {
    queryClient.setQueryData(['sdash', 'marks', uid], data);
  }
  return data;
}
