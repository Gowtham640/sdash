/**
 * Utility helpers that decide when data cache is still fresh.
 */

export const DATA_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export function isDataFresh(
  data: { metadata?: { fetched_at?: string } } | null | undefined,
  expiryMs = DATA_EXPIRY_MS
): boolean {
  if (!data) {
    return false;
  }

  const fetchedAt = data.metadata?.fetched_at;
  if (!fetchedAt) {
    return false;
  }

  const parsed = Date.parse(fetchedAt);
  if (Number.isNaN(parsed)) {
    return false;
  }

  return Date.now() - parsed <= expiryMs;
}
