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
const EVENT_QUEUE_KEY = 'analytics_event_queue';
const BATCH_INTERVAL_KEY = 'analytics_batch_interval';
const LAST_PAGE_KEY = 'analytics_last_page';
const SITE_OPENED_KEY = 'analytics_site_opened';
const SESSION_ENDED_KEY = 'analytics_session_ended';

// Batch configuration
const BATCH_INTERVAL_MS = 20000; // 20 seconds (between 15-30)
const MAX_QUEUE_SIZE = 100; // Prevent localStorage overflow
const PAGE_VIEW_DEBOUNCE_MS = 1000; // Only track page view if page stays same for 1 second

// Global state to prevent duplicate initialization
let isInitialized = false;
let batchIntervalId: NodeJS.Timeout | null = null;
let pageViewTimeoutId: NodeJS.Timeout | null = null;
let lastTrackedPage: string | null = null;

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
 * Generate or retrieve session ID from localStorage
 */
function getOrCreateSessionId(): string {
  let sessionId = getStorageItem(SESSION_ID_KEY);
  
  if (!sessionId) {
    // Generate UUID v4
    sessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
    setStorageItem(SESSION_ID_KEY, sessionId);
  }
  
  return sessionId;
}

/**
 * Get or create session start timestamp
 */
function getOrCreateSessionStart(): number {
  const stored = getStorageItem(SESSION_START_KEY);
  
  if (!stored) {
    const startTime = Date.now();
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
 */
function addEventToQueue(event: AnalyticsEvent): void {
  const sessionId = getOrCreateSessionId();
  const { user_agent } = parseUserAgent();
  
  // Check queue for duplicates (especially for page_view)
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

/**
 * Track an event (with deduplication for all event types)
 * Non-blocking, async operation
 */
export function trackEvent(eventName: EventName, eventData: EventData | null = null): void {
  // Skip deduplication for feature_click (already handled in trackFeatureClick)
  if (eventName !== 'feature_click') {
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
        timestamp: Date.now(),
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
 */
export function trackPageView(page: string, additionalData?: EventData): void {
  // Clear any pending page view
  if (pageViewTimeoutId) {
    clearTimeout(pageViewTimeoutId);
  }
  
  // Don't track if it's the same page we just tracked
  if (page === lastTrackedPage) {
    return;
  }
  
  // Debounce page view tracking
  pageViewTimeoutId = setTimeout(() => {
    // Double-check page hasn't changed during debounce
    if (page === lastTrackedPage) {
      return;
    }
    
    lastTrackedPage = page;
    setStorageItem(LAST_PAGE_KEY, page);
    
    const { browser, user_agent } = parseUserAgent();
    
    trackEvent('page_view', {
      page,
      browser,
      user_agent,
      ...additionalData,
    });
  }, PAGE_VIEW_DEBOUNCE_MS);
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
 */
export function trackSiteOpen(): void {
  // Check if we've already tracked site open in this session
  const alreadyOpened = getStorageItem(SITE_OPENED_KEY);
  if (alreadyOpened === 'true') {
    return;
  }
  
  // Mark as opened
  setStorageItem(SITE_OPENED_KEY, 'true');
  
  const { browser, user_agent } = parseUserAgent();
  const sessionId = getOrCreateSessionId();
  const sessionStart = getOrCreateSessionStart();
  
  trackEvent('site_open', {
    browser,
    user_agent,
    session_id: sessionId,
    session_start: sessionStart,
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
 * Track session end (only once per session)
 */
export function trackSessionEnd(): void {
  // Check if we've already tracked session end
  const alreadyEnded = getStorageItem(SESSION_ENDED_KEY);
  if (alreadyEnded === 'true') {
    return;
  }
  
  // Mark as ended
  setStorageItem(SESSION_ENDED_KEY, 'true');
  
  const sessionStart = getOrCreateSessionStart();
  const sessionDuration = Date.now() - sessionStart;
  
  // Get page views from queue
  const queue = getQueuedEvents();
  const pageViews = queue.filter(e => e.event_name === 'page_view').length;
  
  trackEvent('session_end', {
    duration_ms: sessionDuration,
    page_views: pageViews,
  });
  
  // Send immediately on unload
  void processQueue();
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
  
  // Track site open (only once)
  trackSiteOpen();
  
  // Restore last tracked page
  const lastPage = getStorageItem(LAST_PAGE_KEY);
  if (lastPage) {
    lastTrackedPage = lastPage;
  }
  
  // Track page unload (only once)
  let unloadTracked = false;
  window.addEventListener('beforeunload', () => {
    if (!unloadTracked) {
      unloadTracked = true;
      trackSessionEnd();
      // Try to send remaining events synchronously (limited time)
      void processQueue();
    }
  });
  
  // Also track visibility change (tab close)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void processQueue();
    }
  });
  
  // Initialize batch interval
  initializeBatchInterval();
}

/**
 * Reset session (for testing or new session)
 */
export function resetSession(): void {
  removeStorageItem(SITE_OPENED_KEY);
  removeStorageItem(SESSION_ENDED_KEY);
  removeStorageItem(LAST_PAGE_KEY);
  lastTrackedPage = null;
}
