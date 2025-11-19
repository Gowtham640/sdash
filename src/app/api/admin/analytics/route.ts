import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

interface EventRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  session_id: string | null;
  event_name: string;
  event_data: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Calculate days visited per week for each user
 */
function calculateDaysPerWeek(events: EventRow[]): Map<string, number> {
  const userWeekDays = new Map<string, Set<string>>();
  
  events.forEach(event => {
    if (!event.user_id || !event.created_at) return;
    
    const date = new Date(event.created_at);
    const weekKey = `${date.getFullYear()}-W${getWeekNumber(date)}`;
    const userWeekKey = `${event.user_id}-${weekKey}`;
    
    if (!userWeekDays.has(userWeekKey)) {
      userWeekDays.set(userWeekKey, new Set());
    }
    
    const dayOfWeek = date.getDay();
    userWeekDays.get(userWeekKey)?.add(dayOfWeek.toString());
  });
  
  const result = new Map<string, number>();
  userWeekDays.forEach((days, key) => {
    const userId = key.split('-')[0];
    const current = result.get(userId) || 0;
    result.set(userId, Math.max(current, days.size));
  });
  
  return result;
}

/**
 * Get week number of year
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Parse browser from user agent
 */
function parseBrowser(userAgent: string): string {
  if (!userAgent) return 'unknown';
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg') && !userAgent.includes('OPR')) return 'chrome';
  if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) return 'safari';
  if (userAgent.includes('Firefox')) return 'firefox';
  if (userAgent.includes('Edg')) return 'edge';
  if (userAgent.includes('OPR')) return 'opera';
  return 'other';
}

/**
 * Parse device type from user agent or event data
 * This function matches the client-side parseUserAgent() logic
 */
function parseDeviceType(userAgent: string, eventData: Record<string, unknown> | null): string {
  // First try to get device_type from event_data (more accurate)
  if (eventData && typeof eventData.device_type === 'string') {
    return eventData.device_type;
  }
  
  // Fallback to parsing user agent (matches client-side logic)
  if (!userAgent) return 'unknown';
  
  const ua = userAgent;
  
  // Mobile devices (check first, before desktop OS)
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows Phone/i.test(ua)) return 'Windows Phone';
  
  // Desktop/Tablet OS (check after mobile to avoid false positives)
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/Macintosh/i.test(ua) || /Mac OS X/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/CrOS/i.test(ua)) return 'Chrome OS';
  
  return 'unknown';
}

export async function GET(request: NextRequest) {
  try {
    // Get date range and filters
    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get('timeRange') || '30d'; // Default: past month
    const semesterFilter = searchParams.get('semester'); // 'all', '1', '2', etc., or null
    
    // Calculate start date based on time range
    let startDate: Date | null = null;
    if (timeRange !== 'all') {
      startDate = new Date();
      if (timeRange === '1h') {
        startDate.setHours(startDate.getHours() - 1);
      } else if (timeRange === '24h') {
        startDate.setHours(startDate.getHours() - 24);
      } else if (timeRange === '48h') {
        startDate.setHours(startDate.getHours() - 48);
      } else if (timeRange === '7d') {
        startDate.setDate(startDate.getDate() - 7);
      } else if (timeRange === '30d') {
        startDate.setDate(startDate.getDate() - 30);
      } else if (timeRange === '180d') {
        startDate.setDate(startDate.getDate() - 180);
      } else if (timeRange === '365d') {
        startDate.setDate(startDate.getDate() - 365);
      } else {
        // Fallback to 30 days for unknown values
        startDate.setDate(startDate.getDate() - 30);
      }
    }
    
    // Build query for events
    let eventsQuery = supabaseAdmin
      .from('events')
      .select('*');
    
    // Only apply date filter if not "all"
    if (startDate) {
      eventsQuery = eventsQuery.gte('created_at', startDate.toISOString());
    }
    
    // Fetch all events first (for metrics within time range)
    const { data: events, error: eventsError } = await eventsQuery
      .order('created_at', { ascending: false });
    
    if (eventsError) {
      console.error('[Analytics API] Error fetching events:', eventsError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch events' },
        { status: 500 }
      );
    }
    
    let eventRows = (events || []) as EventRow[];
    
    // Fetch ALL session_created events (regardless of time range) to accurately determine total sessions
    const { data: allSessionCreated, error: sessionCreatedError } = await supabaseAdmin
      .from('events')
      .select('session_id, created_at, event_data')
      .eq('event_name', 'session_created');
    
    if (sessionCreatedError) {
      console.error('[Analytics API] Error fetching session_created events:', sessionCreatedError);
    }
    
    // Fetch ALL session_end events (regardless of time range) to accurately determine active sessions
    // Active sessions are independent of time range - shows ALL currently active sessions
    const { data: allSessionEnds, error: sessionEndsError } = await supabaseAdmin
      .from('events')
      .select('session_id, created_at, event_data')
      .eq('event_name', 'session_end');
    
    if (sessionEndsError) {
      console.error('[Analytics API] Error fetching session_end events:', sessionEndsError);
      // Continue with time-range filtered session_ends as fallback
    }
    
    // Filter by semester if specified
    if (semesterFilter && semesterFilter !== 'all') {
      // Fetch users matching semester filter
      const { data: filteredUsers } = await supabaseAdmin
        .from('users')
        .select('id, semester')
        .eq('semester', parseInt(semesterFilter, 10));
      
      const filteredUserIds = new Set((filteredUsers || []).map(u => u.id));
      
      // Filter events by user IDs
      eventRows = eventRows.filter(event => 
        !event.user_id || filteredUserIds.has(event.user_id)
      );
    }
    
    // Get user count (filtered by semester if specified)
    let userCountQuery = supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    if (semesterFilter && semesterFilter !== 'all') {
      userCountQuery = userCountQuery.eq('semester', parseInt(semesterFilter, 10));
    }
    
    const { count: userCount } = await userCountQuery;
    
    // Calculate metrics
    const pageViews = eventRows.filter(e => e.event_name === 'page_view');
    const cacheHits = eventRows.filter(e => e.event_name === 'cache_hit');
    const apiRequests = eventRows.filter(e => e.event_name === 'api_request');
    const siteOpens = eventRows.filter(e => e.event_name === 'site_open');
    const errors = eventRows.filter(e => e.event_name === 'error');
    const featureClicks = eventRows.filter(e => e.event_name === 'feature_click' || e.event_name.startsWith('predict_') || e.event_name.startsWith('odml_') || e.event_name.startsWith('add_'));
    const sessionCreated = eventRows.filter(e => e.event_name === 'session_created');
    const sessionEnds = eventRows.filter(e => e.event_name === 'session_end');
    
    // Page visits by page
    const pageVisitsByPage = new Map<string, number>();
    pageViews.forEach(event => {
      const page = (event.event_data as { page?: string } | null)?.page || 'unknown';
      pageVisitsByPage.set(page, (pageVisitsByPage.get(page) || 0) + 1);
    });
    
    // Cache hits by data type
    const cacheHitsByType = new Map<string, number>();
    cacheHits.forEach(event => {
      const dataType = (event.event_data as { data_type?: string } | null)?.data_type || 'unknown';
      cacheHitsByType.set(dataType, (cacheHitsByType.get(dataType) || 0) + 1);
    });
    
    // API requests by endpoint
    const apiRequestsByEndpoint = new Map<string, number>();
    apiRequests.forEach(event => {
      const endpoint = (event.event_data as { endpoint?: string } | null)?.endpoint || 'unknown';
      apiRequestsByEndpoint.set(endpoint, (apiRequestsByEndpoint.get(endpoint) || 0) + 1);
    });
    
    // Browser distribution (from all events that have browser info, prioritize event_data.browser)
    const browserDistribution = new Map<string, number>();
    eventRows.forEach(event => {
      // First try to get browser from event_data (more accurate, from client-side parsing)
      const eventData = event.event_data as { browser?: string; user_agent?: string } | null;
      let browser = eventData?.browser;
      
      // If no browser in event_data, parse from user_agent
      if (!browser && eventData?.user_agent) {
        browser = parseBrowser(eventData.user_agent);
      }
      
      // Only count if we have a valid browser
      if (browser && browser !== 'unknown' && browser !== 'other') {
        browserDistribution.set(browser, (browserDistribution.get(browser) || 0) + 1);
      }
    });
    
    // Device type distribution (prioritize events with device_type in event_data, skip old events without it)
    const deviceDistribution = new Map<string, number>();
    eventRows.forEach(event => {
      const eventData = event.event_data as { device_type?: string; user_agent?: string } | null;
      
      // Only count events that have device_type in event_data (newer events)
      // Skip old events that don't have device_type to avoid "unknown" pollution
      if (eventData?.device_type && eventData.device_type !== 'unknown') {
        deviceDistribution.set(eventData.device_type, (deviceDistribution.get(eventData.device_type) || 0) + 1);
      }
    });
    
    // Feature usage
    const featureUsage = new Map<string, number>();
    featureClicks.forEach(event => {
      const feature = (event.event_data as { feature?: string } | null)?.feature || event.event_name;
      featureUsage.set(feature, (featureUsage.get(feature) || 0) + 1);
    });
    
    // Error types
    const errorTypes = new Map<string, number>();
    errors.forEach(event => {
      const errorType = (event.event_data as { error_type?: string } | null)?.error_type || 'unknown';
      errorTypes.set(errorType, (errorTypes.get(errorType) || 0) + 1);
    });
    
    // Response times (cache and API)
    const cacheResponseTimes: number[] = [];
    const apiResponseTimes: number[] = [];
    
    cacheHits.forEach(event => {
      const responseTime = (event.event_data as { response_time?: number } | null)?.response_time;
      if (responseTime) cacheResponseTimes.push(responseTime);
    });
    
    apiRequests.forEach(event => {
      const responseTime = (event.event_data as { response_time?: number } | null)?.response_time;
      if (responseTime) apiResponseTimes.push(responseTime);
    });
    
    // Session analysis
    const sessionDurations: number[] = [];
    const uniqueSessions = new Set<string>();
    const sessionsByUser = new Map<string, Set<string>>(); // Track unique sessions per user
    const siteOpensByUser = new Map<string, number>();
    
    // Track all session IDs from events
    eventRows.forEach(event => {
      if (event.session_id) {
        uniqueSessions.add(event.session_id);
        
        // Track unique sessions per user
        if (event.user_id) {
          if (!sessionsByUser.has(event.user_id)) {
            sessionsByUser.set(event.user_id, new Set());
          }
          sessionsByUser.get(event.user_id)?.add(event.session_id);
        }
      }
    });
    
    // Track site opens per user
    siteOpens.forEach(event => {
      if (event.user_id) {
        siteOpensByUser.set(event.user_id, (siteOpensByUser.get(event.user_id) || 0) + 1);
      }
    });
    
    // Track all sessions that have been created (deduplicated - one session_created per session_id)
    // Use ALL session_created events (not just those in time range) to get accurate total
    const createdSessionIds = new Set<string>();
    const allSessionCreatedEvents = (allSessionCreated || []) as EventRow[];
    allSessionCreatedEvents.forEach(event => {
      if (event.session_id) {
        createdSessionIds.add(event.session_id);
      }
    });
    // Also include session_created from the time range (in case allSessionCreated query failed)
    sessionCreated.forEach(event => {
      if (event.session_id) {
        createdSessionIds.add(event.session_id);
      }
    });
    
    // Track sessions that have ended (deduplicated - one session_end per session_id)
    // Use ALL session_end events (not just those in time range) to accurately determine active sessions
    // Active sessions are calculated independently of time range - shows ALL currently active sessions
    const endedSessionIds = new Set<string>();
    const allSessionEndEvents = (allSessionEnds || []) as EventRow[];
    allSessionEndEvents.forEach(event => {
      if (event.session_id) {
        endedSessionIds.add(event.session_id);
      }
    });
    // Also include session_ends from the time range (in case allSessionEnds query failed)
    sessionEnds.forEach(event => {
      if (event.session_id) {
        endedSessionIds.add(event.session_id);
      }
    });
    
    // Active sessions = ALL sessions that were created but don't have a session_end event
    // This is independent of the time range filter - shows current active sessions across all time
    const activeSessions = new Set<string>();
    createdSessionIds.forEach(sessionId => {
      if (!endedSessionIds.has(sessionId)) {
        activeSessions.add(sessionId);
      }
    });
    
    // Calculate session durations (only count once per session_id, use the latest session_end)
    const sessionDurationsBySession = new Map<string, { duration: number; timestamp: string }>();
    sessionEnds.forEach(event => {
      if (event.session_id) {
        const duration = (event.event_data as { duration_ms?: number } | null)?.duration_ms;
        if (duration) {
          const existing = sessionDurationsBySession.get(event.session_id);
          // Use the latest session_end event for each session_id
          if (!existing || event.created_at > existing.timestamp) {
            sessionDurationsBySession.set(event.session_id, {
              duration: duration / 1000 / 60, // Convert to minutes
              timestamp: event.created_at
            });
          }
        }
      }
    });
    // Convert map values to array for average calculation
    sessionDurations.push(...Array.from(sessionDurationsBySession.values()).map(s => s.duration));
    
    // Calculate average unique sessions per user
    const avgSessionsPerUser = sessionsByUser.size > 0
      ? Array.from(sessionsByUser.values()).reduce((sum, sessionSet) => sum + sessionSet.size, 0) / sessionsByUser.size
      : 0;
    
    // Calculate average site opens per user
    const avgSiteOpensPerUser = siteOpensByUser.size > 0
      ? Array.from(siteOpensByUser.values()).reduce((a, b) => a + b, 0) / siteOpensByUser.size
      : 0;
    
    // Generate time buckets based on time range
    const generateTimeBuckets = (): Array<{ key: string; label: string; start: Date; end: Date }> => {
      const buckets: Array<{ key: string; label: string; start: Date; end: Date }> = [];
      const now = new Date();
      
      if (timeRange === '1h') {
        // Last hour: 6 buckets of 10 minutes each
        for (let i = 5; i >= 0; i--) {
          const start = new Date(now.getTime() - (i + 1) * 10 * 60 * 1000);
          const end = new Date(now.getTime() - i * 10 * 60 * 1000);
          const key = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
          buckets.push({ key, label: key, start, end });
        }
      } else if (timeRange === '24h') {
        // Last 24 hours: 12 buckets of 2 hours each
        for (let i = 11; i >= 0; i--) {
          const start = new Date(now.getTime() - (i + 1) * 2 * 60 * 60 * 1000);
          const end = new Date(now.getTime() - i * 2 * 60 * 60 * 1000);
          const key = `${start.getHours().toString().padStart(2, '0')}:00`;
          buckets.push({ key, label: key, start, end });
        }
      } else if (timeRange === '48h') {
        // Last 48 hours: 12 buckets of 4 hours each
        for (let i = 11; i >= 0; i--) {
          const start = new Date(now.getTime() - (i + 1) * 4 * 60 * 60 * 1000);
          const end = new Date(now.getTime() - i * 4 * 60 * 60 * 1000);
          const key = `${start.getDate()}/${start.getMonth() + 1} ${start.getHours().toString().padStart(2, '0')}:00`;
          buckets.push({ key, label: key, start, end });
        }
      } else if (timeRange === '7d') {
        // Last 7 days: daily buckets
        for (let i = 6; i >= 0; i--) {
          const date = new Date(now);
          date.setDate(date.getDate() - i);
          const key = date.toISOString().split('T')[0];
          const label = `${date.getDate()}/${date.getMonth() + 1}`;
          const start = new Date(date);
          start.setHours(0, 0, 0, 0);
          const end = new Date(date);
          end.setHours(23, 59, 59, 999);
          buckets.push({ key, label, start, end });
        }
      } else if (timeRange === '30d') {
        // Last 30 days: 15 buckets of 2 days each
        for (let i = 14; i >= 0; i--) {
          const date = new Date(now);
          date.setDate(date.getDate() - i * 2);
          const key = date.toISOString().split('T')[0];
          const label = `${date.getDate()}/${date.getMonth() + 1}`;
          const start = new Date(date);
          start.setHours(0, 0, 0, 0);
          const end = new Date(date);
          end.setDate(end.getDate() + 1);
          end.setHours(23, 59, 59, 999);
          buckets.push({ key, label, start, end });
        }
      } else if (timeRange === '180d') {
        // Last 6 months: 13 buckets of 2 weeks each
        for (let i = 12; i >= 0; i--) {
          const date = new Date(now);
          date.setDate(date.getDate() - i * 14);
          const weekStart = new Date(date);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          const key = weekStart.toISOString().split('T')[0];
          const label = `${weekStart.getDate()}/${weekStart.getMonth() + 1}`;
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 13);
          buckets.push({ key, label, start: weekStart, end: weekEnd });
        }
      } else if (timeRange === '365d') {
        // Last year: monthly buckets
        for (let i = 11; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
          const label = `${date.getMonth() + 1}/${date.getFullYear().toString().slice(2)}`;
          const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
          buckets.push({ key, label, start: date, end: monthEnd });
        }
      } else {
        // All time: 12 buckets of 2 months each
        for (let i = 11; i >= 0; i--) {
          const date = new Date(now.getFullYear(), now.getMonth() - i * 2, 1);
          const key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
          const label = `${date.getMonth() + 1}/${date.getFullYear().toString().slice(2)}`;
          const monthEnd = new Date(date.getFullYear(), date.getMonth() + 2, 0);
          buckets.push({ key, label, start: date, end: monthEnd });
        }
      }
      
      return buckets;
    };
    
    const timeBuckets = generateTimeBuckets();
    
    // Helper function to get bucket key for an event timestamp
    const getBucketKey = (timestamp: string): string | null => {
      const eventDate = new Date(timestamp);
      for (const bucket of timeBuckets) {
        if (eventDate >= bucket.start && eventDate <= bucket.end) {
          return bucket.key;
        }
      }
      return null;
    };
    
    // Site opens over time
    const siteOpensOverTime = new Map<string, number>();
    timeBuckets.forEach(bucket => {
      siteOpensOverTime.set(bucket.key, 0);
    });
    siteOpens.forEach(event => {
      if (event.created_at) {
        const bucketKey = getBucketKey(event.created_at);
        if (bucketKey && siteOpensOverTime.has(bucketKey)) {
          siteOpensOverTime.set(bucketKey, (siteOpensOverTime.get(bucketKey) || 0) + 1);
        }
      }
    });
    
    // Page visits over time
    const pageVisitsOverTime = new Map<string, number>();
    timeBuckets.forEach(bucket => {
      pageVisitsOverTime.set(bucket.key, 0);
    });
    pageViews.forEach(event => {
      if (event.created_at) {
        const bucketKey = getBucketKey(event.created_at);
        if (bucketKey && pageVisitsOverTime.has(bucketKey)) {
          pageVisitsOverTime.set(bucketKey, (pageVisitsOverTime.get(bucketKey) || 0) + 1);
        }
      }
    });
    
    // Generate time-series data for all metrics
    const generateTimeSeries = (events: EventRow[], eventName: string): Map<string, number> => {
      const timeSeries = new Map<string, number>();
      timeBuckets.forEach(bucket => {
        timeSeries.set(bucket.key, 0);
      });
      events.forEach(event => {
        if (event.created_at && event.event_name === eventName) {
          const bucketKey = getBucketKey(event.created_at);
          if (bucketKey && timeSeries.has(bucketKey)) {
            timeSeries.set(bucketKey, (timeSeries.get(bucketKey) || 0) + 1);
          }
        }
      });
      return timeSeries;
    };
    
    // Time-series for all metrics
    const totalUsersOverTime = new Map<string, number>();
    const uniqueUsersPerBucket = new Map<string, Set<string>>();
    timeBuckets.forEach(bucket => {
      uniqueUsersPerBucket.set(bucket.key, new Set());
      totalUsersOverTime.set(bucket.key, 0);
    });
    eventRows.forEach(event => {
      if (event.created_at && event.user_id) {
        const bucketKey = getBucketKey(event.created_at);
        if (bucketKey && uniqueUsersPerBucket.has(bucketKey)) {
          uniqueUsersPerBucket.get(bucketKey)?.add(event.user_id);
        }
      }
    });
    uniqueUsersPerBucket.forEach((userSet, key) => {
      totalUsersOverTime.set(key, userSet.size);
    });
    
    const cacheHitsOverTime = generateTimeSeries(cacheHits, 'cache_hit');
    const apiRequestsOverTime = generateTimeSeries(apiRequests, 'api_request');
    const errorsOverTime = generateTimeSeries(errors, 'error');
    const featureClicksOverTime = generateTimeSeries(featureClicks, 'feature_click');
    const uniqueSessionsOverTime = new Map<string, Set<string>>();
    timeBuckets.forEach(bucket => {
      uniqueSessionsOverTime.set(bucket.key, new Set());
    });
    eventRows.forEach(event => {
      if (event.created_at && event.session_id) {
        const bucketKey = getBucketKey(event.created_at);
        if (bucketKey && uniqueSessionsOverTime.has(bucketKey)) {
          uniqueSessionsOverTime.get(bucketKey)?.add(event.session_id);
        }
      }
    });
    const uniqueSessionsOverTimeCount = new Map<string, number>();
    uniqueSessionsOverTime.forEach((sessionSet, key) => {
      uniqueSessionsOverTimeCount.set(key, sessionSet.size);
    });
    
    // User engagement (events per user)
    const userEventCounts = new Map<string, number>();
    eventRows.forEach(event => {
      if (event.user_id) {
        userEventCounts.set(event.user_id, (userEventCounts.get(event.user_id) || 0) + 1);
      }
    });
    
    const eventCounts = Array.from(userEventCounts.values()).sort((a, b) => b - a);
    const medianEvents = eventCounts.length > 0 
      ? eventCounts[Math.floor(eventCounts.length / 2)] 
      : 0;
    
    const heavyUsers = eventCounts.filter(count => count > medianEvents * 2).length;
    const casualUsers = eventCounts.filter(count => count <= medianEvents).length;
    
    // Days per week
    const daysPerWeek = calculateDaysPerWeek(eventRows);
    const avgDaysPerWeek = daysPerWeek.size > 0
      ? Array.from(daysPerWeek.values()).reduce((a, b) => a + b, 0) / daysPerWeek.size
      : 0;
    
    return NextResponse.json({
      success: true,
      data: {
        // Summary stats
        summary: {
          totalUsers: userCount || 0,
          totalEvents: eventRows.length,
          pageViews: pageViews.length,
          cacheHits: cacheHits.length,
          apiRequests: apiRequests.length,
          siteOpens: siteOpens.length,
          errors: errors.length,
          featureClicks: featureClicks.length,
          totalSessions: createdSessionIds.size, // Total sessions created (deduplicated)
          sessions: endedSessionIds.size, // Count of unique session_ids that have ended (deduplicated)
          uniqueSessions: uniqueSessions.size,
          activeSessions: activeSessions.size, // ALL currently active sessions (created but not ended, independent of time range)
        },
        // Charts data
        charts: {
          pageVisitsByPage: Array.from(pageVisitsByPage.entries()).map(([page, count]) => ({
            page,
            count,
          })),
          cacheHitsByType: Array.from(cacheHitsByType.entries()).map(([type, count]) => ({
            type,
            count,
          })),
          apiRequestsByEndpoint: Array.from(apiRequestsByEndpoint.entries()).map(([endpoint, count]) => ({
            endpoint,
            count,
          })),
          browserDistribution: Array.from(browserDistribution.entries()).map(([browser, count]) => ({
            browser,
            count,
          })),
          deviceDistribution: Array.from(deviceDistribution.entries()).map(([device, count]) => ({
            device,
            count,
          })),
          featureUsage: Array.from(featureUsage.entries()).map(([feature, count]) => ({
            feature,
            count,
          })),
          errorTypes: Array.from(errorTypes.entries()).map(([type, count]) => ({
            type,
            count,
          })),
          pageVisitsOverTime: timeBuckets.map(bucket => ({
            date: bucket.label,
            count: pageVisitsOverTime.get(bucket.key) || 0,
          })),
          siteOpensOverTime: timeBuckets.map(bucket => ({
            date: bucket.label,
            count: siteOpensOverTime.get(bucket.key) || 0,
          })),
          totalUsersOverTime: timeBuckets.map(bucket => ({
            date: bucket.label,
            count: totalUsersOverTime.get(bucket.key) || 0,
          })),
          cacheHitsOverTime: timeBuckets.map(bucket => ({
            date: bucket.label,
            count: cacheHitsOverTime.get(bucket.key) || 0,
          })),
          apiRequestsOverTime: timeBuckets.map(bucket => ({
            date: bucket.label,
            count: apiRequestsOverTime.get(bucket.key) || 0,
          })),
          errorsOverTime: timeBuckets.map(bucket => ({
            date: bucket.label,
            count: errorsOverTime.get(bucket.key) || 0,
          })),
          featureClicksOverTime: timeBuckets.map(bucket => ({
            date: bucket.label,
            count: featureClicksOverTime.get(bucket.key) || 0,
          })),
          uniqueSessionsOverTime: timeBuckets.map(bucket => ({
            date: bucket.label,
            count: uniqueSessionsOverTimeCount.get(bucket.key) || 0,
          })),
        },
        // Metrics
        metrics: {
          avgCacheResponseTime: cacheResponseTimes.length > 0
            ? Math.round(cacheResponseTimes.reduce((a, b) => a + b, 0) / cacheResponseTimes.length)
            : 0,
          avgApiResponseTime: apiResponseTimes.length > 0
            ? Math.round(apiResponseTimes.reduce((a, b) => a + b, 0) / apiResponseTimes.length)
            : 0,
          avgSessionDuration: sessionDurations.length > 0
            ? Math.round(sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length)
            : 0,
          heavyUsers,
          casualUsers,
          avgDaysPerWeek: Math.round(avgDaysPerWeek * 10) / 10,
          avgSessionsPerUser: Math.round(avgSessionsPerUser * 10) / 10,
          avgSiteOpensPerUser: Math.round(avgSiteOpensPerUser * 10) / 10,
        },
        // Response time distributions
        responseTimes: {
          cache: {
            min: cacheResponseTimes.length > 0 ? Math.min(...cacheResponseTimes) : 0,
            max: cacheResponseTimes.length > 0 ? Math.max(...cacheResponseTimes) : 0,
            avg: cacheResponseTimes.length > 0
              ? Math.round(cacheResponseTimes.reduce((a, b) => a + b, 0) / cacheResponseTimes.length)
              : 0,
          },
          api: {
            min: apiResponseTimes.length > 0 ? Math.min(...apiResponseTimes) : 0,
            max: apiResponseTimes.length > 0 ? Math.max(...apiResponseTimes) : 0,
            avg: apiResponseTimes.length > 0
              ? Math.round(apiResponseTimes.reduce((a, b) => a + b, 0) / apiResponseTimes.length)
              : 0,
          },
        },
      },
    });
  } catch (error) {
    console.error("[API /admin/analytics] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
