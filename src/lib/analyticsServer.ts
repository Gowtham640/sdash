/**
 * Server-side Analytics Helper
 * For tracking events from API routes and server-side code
 */

import { supabaseAdmin } from './supabaseAdmin';

export interface ServerEventData {
  [key: string]: unknown;
}

// In-memory cache to prevent duplicate tracking within a short time window
const recentRequests = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000; // 5 seconds

/**
 * Generate a request fingerprint for deduplication
 */
function getRequestFingerprint(
  eventName: string,
  userId: string | null | undefined,
  eventData: ServerEventData | null
): string {
  // Create a unique key based on event name, user, and key event data
  const key = `${eventName}_${userId || 'anonymous'}_${JSON.stringify({
    endpoint: eventData?.endpoint,
    data_type: eventData?.data_type,
    cache_hit_count: eventData?.cache_hit_count,
  })}`;
  return key;
}

/**
 * Check if this request was recently tracked
 */
function isDuplicateRequest(fingerprint: string): boolean {
  const lastTracked = recentRequests.get(fingerprint);
  if (!lastTracked) {
    return false;
  }
  
  const now = Date.now();
  if (now - lastTracked < DEDUP_WINDOW_MS) {
    return true; // Duplicate within dedup window
  }
  
  // Clean up old entries
  recentRequests.delete(fingerprint);
  return false;
}

/**
 * Mark request as tracked
 */
function markRequestTracked(fingerprint: string): void {
  recentRequests.set(fingerprint, Date.now());
  
  // Clean up old entries periodically (keep map size reasonable)
  if (recentRequests.size > 1000) {
    const now = Date.now();
    for (const [key, timestamp] of recentRequests.entries()) {
      if (now - timestamp > DEDUP_WINDOW_MS) {
        recentRequests.delete(key);
      }
    }
  }
}

/**
 * Track event from server-side code
 * This directly inserts into Supabase (bypasses client queue)
 */
export async function trackServerEvent(
  eventName: string,
  eventData: ServerEventData | null = null,
  userId?: string | null,
  sessionId?: string | null
): Promise<void> {
  try {
    // If user_id is provided, ensure user exists in users table before tracking
    if (userId) {
      const { data: existingUser, error: userCheckError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', userId)
        .single();

      if (userCheckError || !existingUser) {
        // User doesn't exist - create minimal user record first
        console.log(`[Analytics Server] User ${userId} not found, creating minimal record for analytics`);
        const { error: createError } = await supabaseAdmin
          .from('users')
          .upsert({
            id: userId,
            email: 'unknown@example.com', // Placeholder - will be updated later
            role: 'public',
          }, {
            onConflict: 'id'
          });

        if (createError) {
          console.error(`[Analytics Server] Failed to create user record for analytics:`, createError);
          return; // Skip tracking if we can't create user
        }
      }
    }

    // Generate fingerprint for deduplication
    const fingerprint = getRequestFingerprint(eventName, userId, eventData);

    // Check if this is a duplicate
    if (isDuplicateRequest(fingerprint)) {
      console.log(`[Analytics Server] Skipping duplicate event: ${eventName}`);
      return;
    }

    // Mark as tracked
    markRequestTracked(fingerprint);

    // Insert directly into Supabase events table
    // RLS policy allows public insert, so this should work
    await supabaseAdmin
      .from('events')
      .insert({
        user_id: userId ?? null,
        session_id: sessionId ?? null,
        event_name: eventName,
        event_data: eventData ?? null,
        created_at: new Date().toISOString(),
      });

    // Silently fail - don't block execution
  } catch (error) {
    // Silently fail - analytics should never break functionality
    console.error('[Analytics Server] Error tracking event:', error);
  }
}

/**
 * Track cache hit from server
 */
export async function trackCacheHit(
  dataType: string,
  userId?: string | null,
  responseTime?: number,
  sessionId?: string | null
): Promise<void> {
  await trackServerEvent('cache_hit', {
    data_type: dataType,
    response_time: responseTime,
  }, userId, sessionId);
}

/**
 * Track API request from server
 */
export async function trackApiRequest(
  endpoint: string,
  userId?: string | null,
  dataType?: string,
  responseTime?: number,
  success?: boolean,
  cacheHitCount?: number,
  cacheHitTypes?: string[],
  sessionId?: string | null
): Promise<void> {
  const eventData: ServerEventData = {
    endpoint,
    data_type: dataType,
    response_time: responseTime,
    success: success ?? true,
  };
  
  // Add aggregated cache hit info if available
  if (cacheHitCount !== undefined) {
    eventData.cache_hit_count = cacheHitCount;
    if (cacheHitTypes && cacheHitTypes.length > 0) {
      eventData.cache_hit_types = cacheHitTypes;
    }
  }
  
  await trackServerEvent('api_request', eventData, userId, sessionId);
}

/**
 * Track error from server
 */
export async function trackServerError(
  errorMessage: string,
  errorType: string,
  userId?: string | null,
  page?: string,
  sessionId?: string | null
): Promise<void> {
  await trackServerEvent('error', {
    error_message: errorMessage,
    error_type: errorType,
    page: page ?? 'server',
  }, userId, sessionId);
}

