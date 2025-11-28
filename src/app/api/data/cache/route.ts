import { NextRequest, NextResponse } from "next/server";
import { getSupabaseCacheEvenIfExpired } from "@/lib/supabaseCache";

/**
 * Get Supabase cache (even if expired) for frontend
 * POST /api/data/cache
 * 
 * Request body: { access_token: string, data_type: 'attendance' | 'marks' | 'timetable' }
 * 
 * Returns: {
 *   success: boolean,
 *   data: {...} | null,
 *   isExpired: boolean,
 *   expiresAt: string | null
 * }
 */

function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error("[API /data/cache] JWT decode error:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { access_token, data_type } = body;

    if (!access_token) {
      return NextResponse.json(
        { success: false, error: "Access token is required" },
        { status: 400 }
      );
    }

    if (!data_type || !['attendance', 'marks', 'timetable'].includes(data_type)) {
      return NextResponse.json(
        { success: false, error: "Valid data_type is required (attendance, marks, or timetable)" },
        { status: 400 }
      );
    }

    // Decode JWT token
    const decoded = decodeJWT(access_token);
    if (!decoded || !decoded.sub) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const user_id = decoded.sub as string;

    // Get cache even if expired
    const cachedData = await getSupabaseCacheEvenIfExpired(user_id, data_type as 'attendance' | 'marks' | 'timetable');

    // Check if cache is expired by querying the expires_at field
    let isExpired = false;
    let expiresAt: string | null = null;

    if (cachedData !== null) {
      try {
        const { supabaseAdmin } = await import('@/lib/supabaseAdmin');
        const { data, error } = await supabaseAdmin
          .from('user_cache')
          .select('expires_at')
          .eq('user_id', user_id)
          .eq('data_type', data_type)
          .single();

        if (!error && data) {
          expiresAt = data.expires_at;
          if (expiresAt) {
            const expiryDate = new Date(expiresAt);
            const now = new Date();
            isExpired = now > expiryDate;
          }
        }
      } catch (error) {
        console.error(`[API /data/cache] Error checking expiry:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      data: cachedData,
      isExpired,
      expiresAt,
    });

  } catch (error) {
    console.error("[API /data/cache] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

