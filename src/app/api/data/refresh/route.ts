import { NextRequest, NextResponse } from "next/server";
import { callBackendScraper } from '@/lib/scraperClient';
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { setSupabaseCache, deleteSupabaseCache } from "@/lib/supabaseCache";
import { removeClientCache } from "@/lib/clientCache";

/**
 * Individual data type refresh endpoint
 * POST /api/data/refresh
 * 
 * Force refreshes a specific data type and updates caches
 * 
 * Request body: { 
 *   access_token: string, 
 *   password?: string,
 *   data_type: 'attendance' | 'marks' | 'calendar' | 'timetable'
 * }
 * 
 * Returns: {
 *   success: boolean,
 *   data: {...},
 *   error?: string
 * }
 */

/**
 * Decode JWT token without verification (extract claims)
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
    console.error("[API /data/refresh] JWT decode error:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const requestStartTime = Date.now();
  console.log("===========================================");
  console.log("[API /data/refresh] 📥 POST request received");
  console.log("[API /data/refresh] Timestamp:", new Date().toISOString());

  let user_email: string = '';
  
  try {
    // Parse request body
    const body = await request.json();
    const { access_token, password, data_type } = body;
    
    console.log("[API /data/refresh] 📋 Request parameters:");
    console.log("  - password_provided:", password ? "✓" : "✗");
    console.log("  - access_token_length:", access_token?.length || 0);
    console.log("  - data_type:", data_type);

    if (!access_token) {
      console.error("[API /data/refresh] ❌ No access token provided");
      return NextResponse.json(
        { success: false, error: "Access token is required" },
        { status: 400 }
      );
    }

    if (!data_type || !['attendance', 'marks', 'calendar', 'timetable'].includes(data_type)) {
      console.error("[API /data/refresh] ❌ Invalid data_type provided");
      return NextResponse.json(
        { success: false, error: "Valid data_type is required (attendance, marks, calendar, or timetable)" },
        { status: 400 }
      );
    }

    // Verify and decode JWT token
    console.log("[API /data/refresh] 🔐 Verifying access token...");
    let user_id: string;

    try {
      const decoded = decodeJWT(access_token);
      
      if (!decoded) {
        throw new Error("Invalid token format");
      }

      user_email = (decoded.email as string) || (decoded.sub as string) || '';
      user_id = decoded.sub as string;

      console.log(`[API /data/refresh] ✅ Token decoded successfully`);
      console.log(`[API /data/refresh]   - User Email: ${user_email}`);
      console.log(`[API /data/refresh]   - User ID: ${user_id}`);

      if (!user_email || !user_id) {
        throw new Error("Missing user claims in token");
      }

    } catch (tokenError) {
      console.error("[API /data/refresh] ❌ Token verification failed");
      console.error("[API /data/refresh]   Error:", tokenError instanceof Error ? tokenError.message : String(tokenError));
      return NextResponse.json(
        { success: false, error: "Invalid or expired session. Please sign in again." },
        { status: 401 }
      );
    }

    console.log(`[API /data/refresh] ✅ Session validated for user: ${user_email}`);
    console.log(`[API /data/refresh] 🔄 Force refreshing ${data_type}...`);

    // Clear caches for this data type (calendar is not cached, so skip clearing)
    if (data_type !== 'calendar') {
      try {
        await deleteSupabaseCache(user_id, data_type as 'attendance' | 'marks' | 'timetable');
        removeClientCache(data_type === 'attendance' || data_type === 'marks' || data_type === 'timetable' ? data_type : 'unified');
        console.log(`[API /data/refresh] 🗑️ Cleared caches for ${data_type}`);
      } catch (cacheError) {
        console.warn(`[API /data/refresh] ⚠️ Error clearing cache (continuing anyway):`, cacheError);
      }
    } else {
      console.log(`[API /data/refresh] ℹ️ Calendar is not cached, skipping cache clear`);
    }

    // Fetch fresh data from backend
    const backendStartTime = Date.now();
    let freshData: unknown = null;
    let fetchError: string | null = null;

    try {
      const action = `get_${data_type}_data`;
      console.log(`[API /data/refresh] 🔄 Calling backend: ${action}`);
      
      const result = await callBackendScraper(action, {
        email: user_email,
        ...(password ? { password } : {}),
      });

      const backendDuration = Date.now() - backendStartTime;
      const resultTyped = result as { success?: boolean; error?: string; data?: unknown };
      
      console.log(`[API /data/refresh] 📡 Backend call completed: ${backendDuration}ms`);
      console.log(`[API /data/refresh]   - Success: ${resultTyped.success || false}`);
      console.log(`[API /data/refresh]   - Error: ${resultTyped.error || "none"}`);

      if (resultTyped.success) {
        freshData = resultTyped.data || result;
        
        // Save to Supabase cache (except calendar, which is always fetched from public.calendar table)
        if (data_type !== 'calendar') {
          try {
            await setSupabaseCache(user_id, data_type as 'attendance' | 'marks' | 'timetable', freshData);
            console.log(`[API /data/refresh] ✅ Saved ${data_type} to Supabase cache`);
          } catch (cacheError) {
            console.error(`[API /data/refresh] ❌ Failed to save to cache:`);
            console.error(`[API /data/refresh]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
            console.error(`[API /data/refresh]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
            // Continue even if cache save fails
          }
        } else {
          console.log(`[API /data/refresh] ℹ️ Calendar is not cached, always fetched from public.calendar table`);
        }
      } else {
        fetchError = resultTyped.error || 'Unknown error';
        console.error(`[API /data/refresh] ❌ Backend fetch failed: ${fetchError}`);
      }
    } catch (error) {
      const backendDuration = Date.now() - backendStartTime;
      fetchError = error instanceof Error ? error.message : String(error);
      console.error(`[API /data/refresh] ❌ Backend fetch exception (${backendDuration}ms):`);
      console.error(`[API /data/refresh]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
      console.error(`[API /data/refresh]   - Error message: ${fetchError}`);
      if (error instanceof Error && error.stack) {
        console.error(`[API /data/refresh]   - Stack: ${error.stack}`);
      }
    }

    const totalTime = Date.now() - requestStartTime;

    if (fetchError || !freshData) {
      console.error(`[API /data/refresh] ❌ Refresh failed (${totalTime}ms)`);
      console.log("===========================================");
      return NextResponse.json(
        {
          success: false,
          error: fetchError || `Failed to fetch ${data_type} data`,
        },
        { status: 500 }
      );
    }

    console.log(`[API /data/refresh] ✅ Refresh completed (${totalTime}ms)`);
    console.log("===========================================");

    return NextResponse.json({
      success: true,
      data: freshData,
      data_type: data_type,
    });

  } catch (error) {
    const totalTime = Date.now() - requestStartTime;
    console.error("===========================================");
    console.error("[API /data/refresh] ❌ UNEXPECTED ERROR");
    console.error(`[API /data/refresh]   - Duration: ${totalTime}ms`);
    console.error(`[API /data/refresh]   - Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`[API /data/refresh]   - Error Message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[API /data/refresh]   - Stack Trace: ${error.stack}`);
    }
    console.error("===========================================");
    
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

