/**
 * Client-side Analytics Tracking Library
 * Tracks user behavior and sends events to Supabase
 * 
 * Features:
 * - Session management (localStorage)
 * - Event batching (every 15-30 seconds + on page unload)
 * - Offline queue support
 * - Async/non-blocking
 * - Browser detection
 * - Prevents duplicate events
 */

import { getStorageItem, setStorageItem, removeStorageItem } from './browserStorage';

// Storage keys
const SESSION_ID_KEY = 'analytics_session_id';
const SESSION_START_KEY = 'analytics_session_start';
const LAST_ACTIVITY_KEY = 'analytics_last_activity';
const SERVER_TIME_OFFSET_KEY = 'analytics_server_time_offset'; // For time sync
const EVENT_QUEUE_KEY = 'analytics_event_queue';
const BATCH_INTERVAL_KEY = 'analytics_batch_interval';
const LAST_PAGE_KEY = 'analytics_last_page';
const SITE_OPENED_KEY = 'analytics_site_opened';
const SESSION_ENDED_KEY = 'analytics_session_ended';
const SESSION_END_SUBMITTED_KEY = 'analytics_session_end_submitted'; // Memory + localStorage flag

// Session configuration
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity
const TIME_SYNC_INTERVAL_MS = 5 * 60 * 1000; // Sync time every 5 minutes
const ACTIVITY_CHECK_INTERVAL_MS = 60000; // Check activity every minute

// Batch configuration
const BATCH_INTERVAL_MS = 20000; // 20 seconds (between 15-30)
const MAX_QUEUE_SIZE = 100; // Prevent localStorage overflow
const PAGE_VIEW_DEBOUNCE_MS = 2000; // Only track page view if page stays same for 2 seconds (increased for auth/landing pages)
const PAGE_VIEW_COOLDOWN_MS = 5000; // Cooldown period: don't track same page again within 5 seconds

// Global state to prevent duplicate initialization
let isInitialized = false;
let batchIntervalId: NodeJS.Timeout | null = null;
let pageViewTimeoutId: NodeJS.Timeout | null = null;
let lastTrackedPage: string | null = null;
let sessionEndSubmitted = false; // Memory flag for session_end submission
let siteOpenTracked = false; // Memory flag for site_open (prevents race conditions)
let lastPageViewTracked: string | null = null; // Memory flag for page_view (prevents rapid duplicates)
let lastPageViewTimestamp: number = 0; // Timestamp of last page view to enforce cooldown
let activityCheckIntervalId: NodeJS.Timeout | null = null;
let timeSyncIntervalId: NodeJS.Timeout | null = null;

// Event types
export type EventName = 
  | 'page_view'
  | 'cache_hit'
  | 'api_request'
  | 'site_open'
  | 'session_end'
  | 'predict_click'
  | 'odml_add'
  | 'error'
  | string; // Allow custom event names

export interface EventData {
  [key: string]: unknown;
}

export interface AnalyticsEvent {
  event_name: EventName;
  event_data: EventData | null;
  timestamp: number;
}

interface QueuedEvent extends AnalyticsEvent {
  session_id: string;
  user_agent: string;
}

/**
 * Get server time offset (for time sync to handle clock manipulation)
 */
function getServerTimeOffset(): number {
  const stored = getStorageItem(SERVER_TIME_OFFSET_KEY);
  return stored ? parseInt(stored, 10) : 0;
}

/**
 * Get current time accounting for server offset (prevents clock manipulation issues)
 */
function getSyncedTime(): number {
  return Date.now() + getServerTimeOffset();
}

/**
 * Sync time with server (call periodically)
 */
async function syncTimeWithServer(): Promise<void> {
  try {
    const clientTimeBefore = Date.now();
    const response = await fetch('/api/analytics/time', { method: 'GET' });
    const clientTimeAfter = Date.now();
    const roundTripTime = clientTimeAfter - clientTimeBefore;
    
    if (response.ok) {
      const data = await response.json() as { server_time: number };
      const serverTime = data.server_time;
      const estimatedServerTime = serverTime + (roundTripTime / 2);
      const offset = estimatedServerTime - clientTimeAfter;
      setStorageItem(SERVER_TIME_OFFSET_KEY, offset.toString());
      console.log(`[Analytics] Time synced: offset=${offset}ms, roundTrip=${roundTripTime}ms`);
    }
  } catch (error) {
    console.warn('[Analytics] Time sync failed:', error);
  }
}

/**
 * Check if session has expired (30 minutes of inactivity)
 */
function isSessionExpired(): boolean {
  const lastActivity = getStorageItem(LAST_ACTIVITY_KEY);
  if (!lastActivity) {
    console.log('[Analytics] No last activity found - session expired');
    return true; // No activity = expired
  }
  
  const lastActivityTime = parseInt(lastActivity, 10);
  const currentTime = getSyncedTime();
  const timeSinceActivity = currentTime - lastActivityTime;
  const minutesSinceActivity = timeSinceActivity / 1000 / 60;
  
  const expired = timeSinceActivity > SESSION_TIMEOUT_MS;
  
  if (expired) {
    console.log(`[Analytics] Session expired: ${minutesSinceActivity.toFixed(1)} minutes since last activity (threshold: ${SESSION_TIMEOUT_MS / 1000 / 60} minutes)`);
  }
  
  return expired;
}

/**
 * Update last activity timestamp
 */
function updateLastActivity(): void {
  const currentTime = getSyncedTime();
  setStorageItem(LAST_ACTIVITY_KEY, currentTime.toString());
}

/**
 * Generate or retrieve session ID from localStorage
 * Creates new session if expired (30 min inactivity)
 */
function getOrCreateSessionId(): string {
  const existingSessionId = getStorageItem(SESSION_ID_KEY);
  const existingSessionStart = existingSessionId ? getStorageItem(SESSION_START_KEY) : null;
  const alreadyEnded = getStorageItem(SESSION_ENDED_KEY);
  
  // Check if session expired
  if (isSessionExpired()) {
    console.log('[Analytics] Session expired (30 min inactivity) - ending old session and creating new');
    
    // If there was an existing session that hasn't been ended, end it first
    if (existingSessionId && alreadyEnded !== 'true') {
      console.log('[Analytics] Ending expired session before creating new one');
      
      // Track session end with the OLD session_id (before clearing)
      trackSessionEnd(existingSessionId);
    }
    
    // Clear old session data
    removeStorageItem(SESSION_ID_KEY);
    removeStorageItem(SESSION_START_KEY);
    removeStorageItem(LAST_ACTIVITY_KEY);
    removeStorageItem(SITE_OPENED_KEY);
    removeStorageItem(SESSION_ENDED_KEY);
        removeStorageItem(SESSION_END_SUBMITTED_KEY);
        sessionEndSubmitted = false; // Reset memory flag
        siteOpenTracked = false; // Reset site_open flag
        lastPageViewTracked = null; // Reset page_view flag
        lastPageViewTimestamp = 0; // Reset page view timestamp
  }
  
  let sessionId = getStorageItem(SESSION_ID_KEY);
  
  if (!sessionId) {
    // Generate UUID v4 for new session
    sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    setStorageItem(SESSION_ID_KEY, sessionId);
    
    // Set session start time
    const startTime = getSyncedTime();
    setStorageItem(SESSION_START_KEY, startTime.toString());
    updateLastActivity();
    
    console.log(`[Analytics] New session created: ${sessionId}`);
  } else {
    // Update activity for existing session
    updateLastActivity();
  }
  
  return sessionId;
}

/**
 * Get or create session start timestamp
 */
function getOrCreateSessionStart(): number {
  const stored = getStorageItem(SESSION_START_KEY);
  
  if (!stored) {
    const startTime = getSyncedTime();
    setStorageItem(SESSION_START_KEY, startTime.toString());
    return startTime;
  }
  
  return parseInt(stored, 10);
}

/**
 * Parse user agent to detect browser
 */
function parseUserAgent(): { browser: string; user_agent: string } {
  if (typeof window === 'undefined' || !window.navigator) {
    return { browser: 'unknown', user_agent: '' };
  }
  
  const ua = window.navigator.userAgent;
  let browser = 'unknown';
  
  if (ua.includes('Chrome') && !ua.includes('Edg') && !ua.includes('OPR')) {
    browser = 'chrome';
  } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
    browser = 'safari';
  } else if (ua.includes('Firefox')) {
    browser = 'firefox';
  } else if (ua.includes('Edg')) {
    browser = 'edge';
  } else if (ua.includes('OPR')) {
    browser = 'opera';
  }
  
  return { browser, user_agent: ua };
}

/**
 * Get queued events from localStorage
 */
function getQueuedEvents(): QueuedEvent[] {
  try {
    const stored = getStorageItem(EVENT_QUEUE_KEY);
    if (!stored) {
      return [];
    }
    return JSON.parse(stored) as QueuedEvent[];
  } catch {
    return [];
  }
}

/**
 * Save events to queue in localStorage
 */
function queueEvents(events: QueuedEvent[]): boolean {
  try {
    // Limit queue size to prevent localStorage overflow
    const limitedEvents = events.slice(-MAX_QUEUE_SIZE);
    setStorageItem(EVENT_QUEUE_KEY, JSON.stringify(limitedEvents));
    return true;
  } catch (error) {
    console.error('[Analytics] Failed to queue events:', error);
    return false;
  }
}

/**
 * Add event to queue (with queue-level deduplication for page_view)
 * Updates last activity timestamp
 */
function addEventToQueue(event: AnalyticsEvent): void {
  // Get or create session (this will create new session if expired and end old one)
  const sessionId = getOrCreateSessionId(); // This also updates last activity
  const { user_agent } = parseUserAgent();
  
  // Update last activity timestamp (use synced time)
  updateLastActivity();
  
  // Check queue for duplicates (especially for page_view, site_open, session_end)
  const queue = getQueuedEvents();
  
  // For page_view events, check if same page is already in queue
  if (event.event_name === 'page_view') {
    const page = (event.event_data as { page?: string } | null)?.page;
    if (page) {
      const duplicateInQueue = queue.some(qe => 
        qe.event_name === 'page_view' && 
        (qe.event_data as { page?: string } | null)?.page === page
      );
      if (duplicateInQueue) {
        console.log(`[Analytics] Skipping duplicate page_view in queue: ${page}`);
        return;
      }
    }
  }
  
  // For site_open events, check if already in queue (prevent duplicates)
  if (event.event_name === 'site_open') {
    const duplicateInQueue = queue.some(qe => 
      qe.event_name === 'site_open' && 
      qe.session_id === sessionId
    );
    if (duplicateInQueue) {
      console.log(`[Analytics] Skipping duplicate site_open in queue for session: ${sessionId}`);
      return;
    }
  }
  
  // For session_end events, check if already in queue (prevent duplicates)
  if (event.event_name === 'session_end') {
    const sessionEndData = event.event_data as { session_end?: number } | null;
    const duplicateInQueue = queue.some(qe => {
      if (qe.event_name !== 'session_end') return false;
      const qeData = qe.event_data as { session_end?: number } | null;
      // Check if same session_end timestamp (within 1 second tolerance)
      if (sessionEndData?.session_end && qeData?.session_end) {
        return Math.abs(sessionEndData.session_end - qeData.session_end) < 1000;
      }
      // Or same session_id
      return qe.session_id === sessionId;
    });
    if (duplicateInQueue) {
      console.log(`[Analytics] Skipping duplicate session_end in queue for session: ${sessionId}`);
      return;
    }
  }
  
  const queuedEvent: QueuedEvent = {
    ...event,
    session_id: sessionId,
    user_agent,
  };
  
  queue.push(queuedEvent);
  queueEvents(queue);
}

/**
 * Get access token from storage
 */
function getAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  
  try {
    return getStorageItem('access_token');
  } catch {
    return null;
  }
}

/**
 * Send events to API (async, non-blocking)
 */
async function sendEvents(events: QueuedEvent[]): Promise<boolean> {
  if (events.length === 0) {
    return true;
  }
  
  try {
    const accessToken = getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Include access token if available
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    const response = await fetch('/api/analytics/track', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events }),
    });
    
    if (!response.ok) {
      console.error('[Analytics] Failed to send events:', response.status);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('[Analytics] Error sending events:', error);
    return false;
  }
}

/**
 * Process queue and send events
 */
async function processQueue(): Promise<void> {
  const queue = getQueuedEvents();
  
  if (queue.length === 0) {
    return;
  }
  
  // Try to send events
  const success = await sendEvents([...queue]);
  
  if (success) {
    // Clear queue on success
    setStorageItem(EVENT_QUEUE_KEY, '[]');
  }
  // If failed, events remain in queue for retry
}

/**
 * Initialize batch interval (only once)
 */
function initializeBatchInterval(): void {
  // Prevent duplicate initialization
  if (batchIntervalId !== null || isInitialized) {
    return;
  }
  
  isInitialized = true;
  
  // Set up interval
  batchIntervalId = setInterval(() => {
    void processQueue();
  }, BATCH_INTERVAL_MS);
  
  // Process queue immediately on initialization
  void processQueue();
}

// Track recent events to prevent duplicates (for all event types)
const recentEvents = new Map<string, number>();
const EVENT_DEDUP_MS = 2000; // 2 seconds for general events

/**
 * Generate event fingerprint for deduplication
 */
function getEventFingerprint(eventName: EventName, eventData: EventData | null): string {
  // For page_view, use just the page name for stronger deduplication
  if (eventName === 'page_view' && eventData?.page) {
    return `page_view_${eventData.page}`;
  }
  
  // Create fingerprint from event name and key data
  const keyData = eventData ? {
    page: eventData.page,
    feature: eventData.feature,
    error_message: eventData.error_message,
    endpoint: eventData.endpoint,
  } : {};
  
  return `${eventName}_${JSON.stringify(keyData)}`;
}

// Track recent page views with longer cooldown for auth and landing pages
const recentPageViews = new Map<string, number>();
const PAGE_VIEW_DEDUP_MS = 5000; // 5 seconds for general pages
const PAGE_VIEW_DEDUP_MS_SPECIAL = 10000; // 10 seconds for auth and landing pages

/**
 * Track an event (with deduplication for all event types)
 * Non-blocking, async operation
 */
export function trackEvent(eventName: EventName, eventData: EventData | null = null): void {
  // Special handling for page_view with longer cooldown for auth and landing pages
  if (eventName === 'page_view' && eventData?.page) {
    const page = eventData.page as string;
    const now = Date.now();
    const dedupWindow = (page === '/auth' || page === '/' || page === '') ? PAGE_VIEW_DEDUP_MS_SPECIAL : PAGE_VIEW_DEDUP_MS;
    const lastPageView = recentPageViews.get(page);
    
    if (lastPageView && (now - lastPageView) < dedupWindow) {
      console.log(`[Analytics] Skipping duplicate page_view: ${page} (last tracked ${now - lastPageView}ms ago, window: ${dedupWindow}ms)`);
      return;
    }
    
    // Mark as tracked immediately
    recentPageViews.set(page, now);
    
    // Clean up old entries
    if (recentPageViews.size > 50) {
      for (const [key, timestamp] of recentPageViews.entries()) {
        if (now - timestamp > dedupWindow) {
          recentPageViews.delete(key);
        }
      }
    }
  }
  
  // Skip deduplication for feature_click (already handled in trackFeatureClick)
  if (eventName !== 'feature_click' && eventName !== 'page_view') {
    const fingerprint = getEventFingerprint(eventName, eventData);
    const now = Date.now();
    const lastEvent = recentEvents.get(fingerprint);
    
    // Check if this event was tracked recently
    if (lastEvent && (now - lastEvent) < EVENT_DEDUP_MS) {
      console.log(`[Analytics] Skipping duplicate event: ${eventName} (last tracked ${now - lastEvent}ms ago)`);
      return;
    }
    
    // Mark as tracked immediately
    recentEvents.set(fingerprint, now);
    
    // Clean up old entries
    if (recentEvents.size > 200) {
      for (const [key, timestamp] of recentEvents.entries()) {
        if (now - timestamp > EVENT_DEDUP_MS) {
          recentEvents.delete(key);
        }
      }
    }
  }
  
  // Run asynchronously to avoid blocking
  setTimeout(() => {
    try {
      const event: AnalyticsEvent = {
        event_name: eventName,
        event_data: eventData,
        timestamp: getSyncedTime(), // Use synced time to prevent clock manipulation issues
      };
      
      addEventToQueue(event);
      
      // Initialize batch interval if not already done
      if (typeof window !== 'undefined' && !isInitialized) {
        initializeBatchInterval();
      }
    } catch (error) {
      console.error('[Analytics] Error tracking event:', error);
    }
  }, 0);
}

/**
 * Track page view (debounced to prevent duplicates)
 * Enhanced deduplication for auth and landing pages
 */
export function trackPageView(page: string, additionalData?: EventData): void {
  const now = Date.now();
  
  // Check cooldown period (prevent tracking same page within cooldown window)
  if (page === lastPageViewTracked && (now - lastPageViewTimestamp) < PAGE_VIEW_COOLDOWN_MS) {
    console.log(`[Analytics] Page view in cooldown period: ${page} (${now - lastPageViewTimestamp}ms ago)`);
    return;
  }
  
  // Check memory flag first (prevents rapid duplicates from React StrictMode)
  if (page === lastPageViewTracked) {
    console.log(`[Analytics] Page view already tracked (memory flag): ${page}`);
    return;
  }
  
  // Don't track if it's the same page we just tracked
  if (page === lastTrackedPage) {
    return;
  }
  
  // Mark as being tracked IMMEDIATELY (before setTimeout) to prevent rapid duplicate calls
  // This blocks subsequent calls even before the debounce timeout fires
  lastTrackedPage = page;
  
  // Clear any pending page view for a different page
  if (pageViewTimeoutId) {
    clearTimeout(pageViewTimeoutId);
    pageViewTimeoutId = null;
  }
  
  // Debounce page view tracking (longer for auth and landing pages)
  const debounceTime = (page === '/auth' || page === '/') ? PAGE_VIEW_DEBOUNCE_MS * 2 : PAGE_VIEW_DEBOUNCE_MS;
  
  pageViewTimeoutId = setTimeout(() => {
    // Double-check page hasn't changed during debounce
    if (page !== lastTrackedPage) {
      // Page changed during debounce, don't track
      return;
    }
    
    // Mark as tracked IMMEDIATELY (before async trackEvent)
    lastPageViewTracked = page;
    lastPageViewTimestamp = Date.now();
    setStorageItem(LAST_PAGE_KEY, page);
    
    const { browser, user_agent } = parseUserAgent();
    
    trackEvent('page_view', {
      page,
      browser,
      user_agent,
      ...additionalData,
    });
    
    // Clear timeout ID after tracking
    pageViewTimeoutId = null;
  }, debounceTime);
}

/**
 * Track cache hit (aggregated per request, not per individual check)
 */
export function trackCacheHit(dataType: string, responseTime?: number): void {
  // Only track significant cache hits (response time > 0)
  if (responseTime !== undefined && responseTime > 0) {
    trackEvent('cache_hit', {
      data_type: dataType,
      response_time: responseTime,
    });
  }
}

/**
 * Track API request
 */
export function trackApiRequest(
  endpoint: string,
  dataType?: string,
  responseTime?: number,
  success?: boolean
): void {
  trackEvent('api_request', {
    endpoint,
    data_type: dataType,
    response_time: responseTime,
    success: success ?? true,
  });
}

/**
 * Track site open (only once per session)
 * Fires when user opens website (new session or after 30 min inactivity)
 */
export function trackSiteOpen(): void {
  // Check memory flag first (fastest check, prevents race conditions)
  if (siteOpenTracked) {
    console.log('[Analytics] site_open already tracked (memory flag)');
    return;
  }
  
  // Get or create session (will create new if expired)
  const sessionId = getOrCreateSessionId();
  
  // Check if we've already tracked site open in this session (localStorage check for persistence)
  const alreadyOpened = getStorageItem(SITE_OPENED_KEY);
  if (alreadyOpened === 'true') {
    siteOpenTracked = true; // Sync memory flag
    console.log('[Analytics] site_open already tracked (localStorage flag)');
    return; // Already tracked for this session
  }
  
  // Check queue for existing site_open for this session (additional safeguard)
  const queue = getQueuedEvents();
  const duplicateInQueue = queue.some(qe => 
    qe.event_name === 'site_open' && 
    qe.session_id === sessionId
  );
  if (duplicateInQueue) {
    siteOpenTracked = true; // Sync memory flag
    setStorageItem(SITE_OPENED_KEY, 'true');
    console.log('[Analytics] site_open already in queue for session:', sessionId);
    return;
  }
  
  // Mark as opened IMMEDIATELY (before async trackEvent)
  siteOpenTracked = true;
  setStorageItem(SITE_OPENED_KEY, 'true');
  
  const { browser, user_agent } = parseUserAgent();
  const sessionStart = getOrCreateSessionStart();
  const currentTime = getSyncedTime();
  
  console.log(`[Analytics] Tracking site_open for session: ${sessionId}`);
  
  trackEvent('site_open', {
    browser,
    user_agent,
    session_id: sessionId,
    session_start: sessionStart,
    timestamp: currentTime,
  });
}

// Track recent feature clicks to prevent duplicates (synchronous check)
const recentFeatureClicks = new Map<string, number>();
const FEATURE_CLICK_DEDUP_MS = 3000; // 3 seconds (increased to catch rapid duplicates)

/**
 * Track feature click (with synchronous deduplication)
 */
export function trackFeatureClick(feature: string, page?: string): void {
  const pagePath = page ?? (typeof window !== 'undefined' ? window.location.pathname : 'unknown');
  
  // Create fingerprint for deduplication
  const fingerprint = `feature_click_${feature}_${pagePath}`;
  const now = Date.now();
  const lastClick = recentFeatureClicks.get(fingerprint);
  
  // Check if this feature was clicked recently (synchronous check)
  if (lastClick && (now - lastClick) < FEATURE_CLICK_DEDUP_MS) {
    console.log(`[Analytics] Skipping duplicate feature click: ${feature} (last clicked ${now - lastClick}ms ago)`);
    return;
  }
  
  // Mark as tracked IMMEDIATELY (before async trackEvent)
  recentFeatureClicks.set(fingerprint, now);
  
  // Log for debugging (especially for ODML)
  console.log(`[Analytics] Tracking feature click: ${feature} on ${pagePath}`);
  
  // Clean up old entries periodically
  if (recentFeatureClicks.size > 100) {
    for (const [key, timestamp] of recentFeatureClicks.entries()) {
      if (now - timestamp > FEATURE_CLICK_DEDUP_MS) {
        recentFeatureClicks.delete(key);
      }
    }
  }
  
  // Now track the event (async, but deduplication already done)
  trackEvent('feature_click', {
    feature,
    page: pagePath,
  });
}

/**
 * Track error
 */
export function trackError(errorMessage: string, errorType?: string, page?: string): void {
  trackEvent('error', {
    error_message: errorMessage,
    error_type: errorType ?? 'unknown',
    page: page ?? (typeof window !== 'undefined' ? window.location.pathname : 'unknown'),
  });
}

/**
 * Track session end (only once per session, even with multiple tabs)
 * Uses memory flag + localStorage to ensure single submission
 * IMPORTANT: Uses the CURRENT session_id (not a new one)
 */
export function trackSessionEnd(sessionIdToUse?: string): void {
  // Check memory flag first (fastest check)
  if (sessionEndSubmitted) {
    console.log('[Analytics] Session end already submitted (memory flag)');
    return;
  }
  
  // Check localStorage flag (handles multiple tabs)
  const alreadySubmitted = getStorageItem(SESSION_END_SUBMITTED_KEY);
  if (alreadySubmitted === 'true') {
    console.log('[Analytics] Session end already submitted (localStorage flag)');
    sessionEndSubmitted = true; // Sync memory flag
    return;
  }
  
  // Mark as submitted IMMEDIATELY (before async operations)
  sessionEndSubmitted = true;
  setStorageItem(SESSION_END_SUBMITTED_KEY, 'true');
  setStorageItem(SESSION_ENDED_KEY, 'true');
  
  // Get the session ID to use (use provided one, or get current one WITHOUT creating new)
  const sessionId = sessionIdToUse || getStorageItem(SESSION_ID_KEY) || getOrCreateSessionId();
  const sessionStart = getOrCreateSessionStart();
  const currentTime = getSyncedTime();
  const sessionDuration = currentTime - sessionStart;
  
  // Get page views from queue
  const queue = getQueuedEvents();
  const pageViews = queue.filter(e => e.event_name === 'page_view').length;
  
  console.log(`[Analytics] Tracking session_end for session: ${sessionId}, duration=${sessionDuration}ms, pageViews=${pageViews}`);
  
  // Create event directly with the correct session_id
  const { user_agent } = parseUserAgent();
  const sessionEndEvent: AnalyticsEvent = {
    event_name: 'session_end',
    event_data: {
      duration_ms: sessionDuration,
      page_views: pageViews,
      session_start: sessionStart,
      session_end: currentTime,
    },
    timestamp: currentTime,
  };
  
  const queuedEvent: QueuedEvent = {
    ...sessionEndEvent,
    session_id: sessionId, // Use the provided/current session_id
    user_agent,
  };
  
  // Add to queue (with deduplication check)
  const updatedQueue = getQueuedEvents();
  const duplicateInQueue = updatedQueue.some(qe => {
    if (qe.event_name !== 'session_end') return false;
    const qeData = qe.event_data as { session_end?: number } | null;
    const eventData = sessionEndEvent.event_data as { session_end?: number } | null;
    // Check if same session_end timestamp (within 1 second tolerance) or same session_id
    if (eventData?.session_end && qeData?.session_end) {
      return Math.abs(eventData.session_end - qeData.session_end) < 1000;
    }
    return qe.session_id === sessionId;
  });
  
  if (!duplicateInQueue) {
    updatedQueue.push(queuedEvent);
    queueEvents(updatedQueue);
  } else {
    console.log(`[Analytics] Skipping duplicate session_end in queue for session: ${sessionId}`);
  }
  
  // Send immediately on unload
  void processQueue();
}

/**
 * Check for expired sessions and auto-end them
 */
function checkAndAutoEndExpiredSessions(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  
  const sessionId = getStorageItem(SESSION_ID_KEY);
  if (!sessionId) {
    return false; // No active session
  }
  
  // Check if session ended flag is already set
  const alreadyEnded = getStorageItem(SESSION_ENDED_KEY);
  if (alreadyEnded === 'true') {
    return false; // Already ended
  }
  
  // Check if session expired
  if (isSessionExpired()) {
    console.log('[Analytics] Session expired (30 min inactivity) - auto-ending session');
    
    // Get the session_id BEFORE clearing (important!)
    const expiredSessionId = sessionId;
    
    // Auto-end the session with the correct session_id
    trackSessionEnd(expiredSessionId);
    
    // Clear session data
    removeStorageItem(SESSION_ID_KEY);
    removeStorageItem(SESSION_START_KEY);
    removeStorageItem(LAST_ACTIVITY_KEY);
    removeStorageItem(SITE_OPENED_KEY);
    removeStorageItem(SESSION_ENDED_KEY);
    removeStorageItem(SESSION_END_SUBMITTED_KEY);
    sessionEndSubmitted = false;
    siteOpenTracked = false;
    lastPageViewTracked = null;
    lastPageViewTimestamp = 0;
    
    return true; // Indicate session was ended
  }
  
  return false;
}

/**
 * Initialize analytics (call on app load, only once)
 */
export function initializeAnalytics(): void {
  if (typeof window === 'undefined') {
    return;
  }
  
  // Prevent duplicate initialization
  if (isInitialized) {
    return;
  }
  
  isInitialized = true;
  
  // Sync time with server on initialization
  void syncTimeWithServer();
  
  // Restore session end submitted flag from localStorage (for multi-tab support)
  const submitted = getStorageItem(SESSION_END_SUBMITTED_KEY);
  if (submitted === 'true') {
    sessionEndSubmitted = true;
  }
  
  // Check for expired sessions first (before getting/creating session)
  // This catches sessions that expired while the tab was inactive
  checkAndAutoEndExpiredSessions();
  
  // Get or create session (will create new if expired)
  const sessionId = getOrCreateSessionId();
  console.log(`[Analytics] Initialized with session: ${sessionId}`);
  
  // Sync site_open flag from localStorage (for persistence across page reloads)
  const alreadyOpened = getStorageItem(SITE_OPENED_KEY);
  siteOpenTracked = alreadyOpened === 'true';
  
  // Track site open (only once per session)
  trackSiteOpen();
  
  // Restore last tracked page
  const lastPage = getStorageItem(LAST_PAGE_KEY);
  if (lastPage) {
    lastTrackedPage = lastPage;
  }
  
  // Track page unload (only once) - consolidated to prevent multiple calls
  let unloadTracked = false;
  const handleUnload = () => {
    if (!unloadTracked) {
      unloadTracked = true;
      trackSessionEnd();
      // Try to send remaining events synchronously (limited time)
      void processQueue();
    }
  };
  
  // Use pagehide as primary (more reliable than beforeunload)
  window.addEventListener('pagehide', handleUnload);
  
  // Fallback to beforeunload (less reliable but catches some cases)
  window.addEventListener('beforeunload', handleUnload);
  
  // Track visibility change (tab close) - more reliable than beforeunload
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Check if session should be ended (but don't call trackSessionEnd here to avoid duplicates)
      checkAndAutoEndExpiredSessions();
      void processQueue();
    } else if (document.visibilityState === 'visible') {
      // Tab became visible - check if session expired while away
      if (checkAndAutoEndExpiredSessions()) {
        // Session was expired and ended, update activity for new session
        updateLastActivity();
      } else {
        // Session still active, update activity
        updateLastActivity();
      }
    }
  });
  
  // Also check on user interaction (mouse move, click, keypress) to catch expired sessions
  // This ensures we catch expired sessions even if the interval was throttled
  if (typeof window !== 'undefined') {
    const checkOnInteraction = () => {
      // Only check if we have a session
      const sessionId = getStorageItem(SESSION_ID_KEY);
      if (sessionId) {
        checkAndAutoEndExpiredSessions();
      }
    };
    
    // Throttle interaction checks to once per 30 seconds
    let lastInteractionCheck = 0;
    const INTERACTION_CHECK_THROTTLE = 30000;
    
    const throttledCheck = () => {
      const now = Date.now();
      if (now - lastInteractionCheck > INTERACTION_CHECK_THROTTLE) {
        lastInteractionCheck = now;
        checkOnInteraction();
      }
    };
    
    window.addEventListener('mousemove', throttledCheck, { passive: true });
    window.addEventListener('click', throttledCheck, { passive: true });
    window.addEventListener('keypress', throttledCheck, { passive: true });
  }
  
  // Set up periodic activity check (every minute)
  activityCheckIntervalId = setInterval(() => {
    checkAndAutoEndExpiredSessions();
  }, ACTIVITY_CHECK_INTERVAL_MS);
  
  // Set up periodic time sync (every 5 minutes)
  timeSyncIntervalId = setInterval(() => {
    void syncTimeWithServer();
  }, TIME_SYNC_INTERVAL_MS);
  
  // Initialize batch interval
  initializeBatchInterval();
}

/**
 * Reset session (for testing or new session)
 */
export function resetSession(): void {
  removeStorageItem(SESSION_ID_KEY);
  removeStorageItem(SESSION_START_KEY);
  removeStorageItem(LAST_ACTIVITY_KEY);
  removeStorageItem(SITE_OPENED_KEY);
  removeStorageItem(SESSION_ENDED_KEY);
  removeStorageItem(SESSION_END_SUBMITTED_KEY);
  removeStorageItem(LAST_PAGE_KEY);
  lastTrackedPage = null;
  sessionEndSubmitted = false;
  siteOpenTracked = false;
  lastPageViewTracked = null;
}
