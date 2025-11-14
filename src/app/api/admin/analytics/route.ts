import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

interface EventRow {
  id: string;
  user_id: string | null;
  user_name: string | null;
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

export async function GET(request: NextRequest) {
  try {
    // Get date range (default: last 30 days)
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Fetch all events from the last N days
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('events')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });
    
    if (eventsError) {
      console.error('[Analytics API] Error fetching events:', eventsError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch events' },
        { status: 500 }
      );
    }
    
    const eventRows = (events || []) as EventRow[];
    
    // Get user count
    const { count: userCount } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    // Calculate metrics
    const pageViews = eventRows.filter(e => e.event_name === 'page_view');
    const cacheHits = eventRows.filter(e => e.event_name === 'cache_hit');
    const apiRequests = eventRows.filter(e => e.event_name === 'api_request');
    const siteOpens = eventRows.filter(e => e.event_name === 'site_open');
    const errors = eventRows.filter(e => e.event_name === 'error');
    const featureClicks = eventRows.filter(e => e.event_name === 'feature_click' || e.event_name.startsWith('predict_') || e.event_name.startsWith('odml_') || e.event_name.startsWith('add_'));
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
    
    // Browser distribution
    const browserDistribution = new Map<string, number>();
    pageViews.forEach(event => {
      const userAgent = (event.event_data as { user_agent?: string } | null)?.user_agent || '';
      const browser = parseBrowser(userAgent);
      browserDistribution.set(browser, (browserDistribution.get(browser) || 0) + 1);
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
    
    // Session durations
    const sessionDurations: number[] = [];
    sessionEnds.forEach(event => {
      const duration = (event.event_data as { duration_ms?: number } | null)?.duration_ms;
      if (duration) sessionDurations.push(duration / 1000 / 60); // Convert to minutes
    });
    
    // Page visits over time (last 7 days)
    const pageVisitsOverTime = new Map<string, number>();
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      return date.toISOString().split('T')[0];
    }).reverse();
    
    last7Days.forEach(date => {
      pageVisitsOverTime.set(date, 0);
    });
    
    pageViews.forEach(event => {
      if (event.created_at) {
        const date = new Date(event.created_at).toISOString().split('T')[0];
        if (pageVisitsOverTime.has(date)) {
          pageVisitsOverTime.set(date, (pageVisitsOverTime.get(date) || 0) + 1);
        }
      }
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
          sessions: sessionEnds.length,
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
          featureUsage: Array.from(featureUsage.entries()).map(([feature, count]) => ({
            feature,
            count,
          })),
          errorTypes: Array.from(errorTypes.entries()).map(([type, count]) => ({
            type,
            count,
          })),
          pageVisitsOverTime: Array.from(pageVisitsOverTime.entries()).map(([date, count]) => ({
            date,
            count,
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
