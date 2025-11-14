import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Decode JWT token to extract user info
 */
function decodeJWT(token: string): { user_id?: string; email?: string; name?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    const claims = JSON.parse(decoded) as { sub?: string; email?: string; user_metadata?: { name?: string } };
    
    return {
      user_id: claims.sub,
      email: claims.email,
      name: claims.user_metadata?.name,
    };
  } catch (error) {
    console.error("[API /analytics/track] JWT decode error:", error);
    return null;
  }
}

/**
 * Extract user info from request headers
 */
function getUserInfo(request: NextRequest): { user_id: string | null; user_email: string | null; user_name: string | null } {
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
    return { user_id: null, user_email: null, user_name: null };
  }
  
  const userInfo = decodeJWT(token);
  return {
    user_id: userInfo?.user_id ?? null,
    user_email: userInfo?.email ?? null,
    user_name: userInfo?.name ?? null,
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
    const { user_id, user_email, user_name } = getUserInfo(request);
    
    // Prepare events for insertion
    const eventsToInsert = body.events.map((event) => ({
      user_id: user_id ?? null,
      user_name: user_name ?? null,
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

