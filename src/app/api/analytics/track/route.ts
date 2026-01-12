import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Decode JWT token to extract user info
 */
function decodeJWT(token: string): { user_id?: string; email?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    const claims = JSON.parse(decoded) as { sub?: string; email?: string };
    
    return {
      user_id: claims.sub,
      email: claims.email,
    };
  } catch (error) {
    console.error("[API /analytics/track] JWT decode error:", error);
    return null;
  }
}

/**
 * Extract user info from request headers
 */
function getUserInfo(request: NextRequest): { user_id: string | null; user_email: string | null } {
  // Try to get access token from Authorization header
  const authHeader = request.headers.get('authorization');
  let token: string | null = null;
  
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    // Try to get from cookie
    const cookies = request.cookies.getAll();
    const accessTokenCookie = cookies.find(c => c.name === 'access_token' || c.name.includes('access_token'));
    if (accessTokenCookie) {
      token = accessTokenCookie.value;
    }
  }
  
  if (!token) {
    return { user_id: null, user_email: null };
  }
  
  const userInfo = decodeJWT(token);
  return {
    user_id: userInfo?.user_id ?? null,
    user_email: userInfo?.email ?? null,
  };
}

interface QueuedEvent {
  event_name: string;
  event_data: Record<string, unknown> | null;
  timestamp: number;
  session_id: string;
  user_agent: string;
}

interface TrackRequest {
  events: QueuedEvent[];
}

/**
 * POST /api/analytics/track
 * Receives batched events from client and stores them in Supabase
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as TrackRequest;
    
    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid request: events array required' },
        { status: 400 }
      );
    }
    
    // Extract user info from request
    const { user_id, user_email } = getUserInfo(request);

    // Validate that user_id exists in auth.users if provided
    if (user_id) {
      try {
        const { data: usersList, error: authQueryError } = await supabaseAdmin.auth.admin.listUsers();
        if (authQueryError) {
          console.error("[API /analytics/track] Error querying auth.users:", authQueryError.message);
          return NextResponse.json(
            { success: false, error: "Authentication service error" },
            { status: 500 }
          );
        }

        const userExists = usersList?.users.some(u => u.id === user_id);
        if (!userExists) {
          console.error(`[API /analytics/track] User ID ${user_id} does not exist in auth.users`);
          return NextResponse.json(
            { success: false, error: "Invalid user session" },
            { status: 401 }
          );
        }
      } catch (error) {
        console.error("[API /analytics/track] Error validating user existence:", error);
        return NextResponse.json(
          { success: false, error: "Authentication validation error" },
          { status: 500 }
        );
      }
    }

    // Deduplicate events server-side (check for existing events with same fingerprint)
    // For session_end and site_open, check for duplicates in the last 5 seconds
    const deduplicatedEvents: QueuedEvent[] = [];
    const seenFingerprints = new Set<string>();
    
    for (const event of body.events) {
      // Create fingerprint for deduplication
      let fingerprint: string;
      
      if (event.event_name === 'session_end') {
        // For session_end, use session_id + session_end timestamp (within 1 second)
        const sessionEnd = (event.event_data as { session_end?: number } | null)?.session_end;
        fingerprint = `session_end_${event.session_id}_${Math.floor((sessionEnd || event.timestamp) / 1000)}`;
      } else if (event.event_name === 'session_created') {
        // For session_created, use session_id (only one per session)
        fingerprint = `session_created_${event.session_id}`;
      } else if (event.event_name === 'site_open') {
        // For site_open, use session_id (only one per session)
        fingerprint = `site_open_${event.session_id}`;
      } else if (event.event_name === 'page_view') {
        // For page_view, use session_id + page + timestamp (within 5 seconds to prevent rapid duplicates)
        const page = (event.event_data as { page?: string } | null)?.page;
        fingerprint = `page_view_${event.session_id}_${page || 'unknown'}_${Math.floor(event.timestamp / 5000)}`;
      } else {
        // For other events, use event_name + session_id + timestamp (within 2 seconds)
        fingerprint = `${event.event_name}_${event.session_id}_${Math.floor(event.timestamp / 2000)}`;
      }
      
      // Check if we've seen this fingerprint in this batch
      if (seenFingerprints.has(fingerprint)) {
        console.log(`[API /analytics/track] Skipping duplicate event in batch: ${event.event_name} (${fingerprint})`);
        continue;
      }
      
      // Check database for recent duplicates (for session_end, session_created, site_open, and page_view)
      if (event.event_name === 'session_end' || event.event_name === 'session_created' || event.event_name === 'site_open' || event.event_name === 'page_view') {
        // Use different time windows for different events
        const timeWindow = event.event_name === 'session_end' ? 5000 : // 5 seconds for session_end
                          event.event_name === 'session_created' ? 10000 : // 10 seconds for session_created
                          event.event_name === 'site_open' ? 10000 : // 10 seconds for site_open
                          5000; // 5 seconds for page_view
        
        const timeWindowAgo = new Date(event.timestamp - timeWindow).toISOString();
        
        let query = supabaseAdmin
          .from('events')
          .select('id')
          .eq('event_name', event.event_name)
          .eq('session_id', event.session_id)
          .gte('created_at', timeWindowAgo);
        
        // For page_view, also check the page using JSONB contains
        if (event.event_name === 'page_view') {
          const page = (event.event_data as { page?: string } | null)?.page;
          if (page) {
            // Use JSONB contains to check if event_data contains the page
            query = query.contains('event_data', { page }) as typeof query;
          }
        }
        
        const { data: existingEvents } = await query.limit(1);
        
        if (existingEvents && existingEvents.length > 0) {
          console.log(`[API /analytics/track] Skipping duplicate event in database: ${event.event_name} for session ${event.session_id}`);
          continue;
        }
      }
      
      seenFingerprints.add(fingerprint);
      deduplicatedEvents.push(event);
    }
    
    if (deduplicatedEvents.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: 'All events were duplicates',
      });
    }
    
    // Prepare events for insertion
    const eventsToInsert = deduplicatedEvents.map((event) => ({
      user_id: user_id ?? null,
      user_email: user_email ?? null,
      session_id: event.session_id ?? null,
      event_name: event.event_name,
      event_data: event.event_data ?? null,
      created_at: new Date(event.timestamp).toISOString(),
    }));
    
    // Insert events into Supabase
    // RLS policy allows public insert, so this should work
    const { error } = await supabaseAdmin
      .from('events')
      .insert(eventsToInsert);
    
    if (error) {
      console.error("[API /analytics/track] Supabase insert error:", error);
      return NextResponse.json(
        { success: false, error: 'Failed to store events' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      count: eventsToInsert.length,
      originalCount: body.events.length,
      duplicatesFiltered: body.events.length - eventsToInsert.length,
    });
  } catch (error) {
    console.error("[API /analytics/track] Error:", error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS handler for CORS
 */
export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

