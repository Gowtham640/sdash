import { NextRequest, NextResponse } from "next/server";
import { callBackendScraper } from '@/lib/scraperClient';
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { deleteSupabaseCache } from "@/lib/supabaseCache";
import { removeClientCache } from "@/lib/clientCache";
import { transformGoBackendAttendance, transformGoBackendMarks } from "@/lib/dataTransformers";

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
      // No login validation needed - JWT token already validated above
      // Directly call data endpoints with authentication headers

      const action = `get_${data_type}_data`;
      console.log(`[API /data/refresh] 🔄 Calling backend: ${action}`);
      
      let result = await callBackendScraper(action, {
        email: user_email,
        ...(password ? { password } : {}),
        user_id,
      });

      const resultTyped = result as { success?: boolean; error?: string; data?: unknown };
      
      // No re-authentication retries - authentication is handled via headers

      const backendDuration = Date.now() - backendStartTime;
      const finalResultTyped = result as { success?: boolean; error?: string; data?: unknown };
      
      console.log(`[API /data/refresh] 📡 Backend call completed: ${backendDuration}ms`);
      console.log(`[API /data/refresh]   - Success: ${finalResultTyped.success || false}`);
      console.log(`[API /data/refresh]   - Error: ${finalResultTyped.error || "none"}`);

      if (finalResultTyped.success) {
        // Go backend validation successful - now read data from Supabase
        console.log(`[API /data/refresh] ✅ Go backend validation successful for ${data_type}`);

        // Read data from Supabase cache
        const { getSupabaseCache } = await import('@/lib/supabaseCache');
        const cachedData = await getSupabaseCache(user_id, data_type as 'attendance' | 'marks' | 'timetable');

        if (!cachedData) {
          console.error(`[API /data/refresh] ❌ No ${data_type} data found in Supabase cache`);
          fetchError = `No ${data_type} data available`;
          throw new Error(fetchError);
        }

        // Transform data if needed for frontend format
        let processedData = cachedData;
        if (data_type === 'attendance') {
          console.log(`[API /data/refresh] 🔄 Transforming attendance data for frontend`);
          processedData = transformGoBackendAttendance(cachedData) as Record<string, unknown>;
        } else if (data_type === 'marks') {
          console.log(`[API /data/refresh] 🔄 Transforming marks data for frontend`);
          processedData = transformGoBackendMarks(cachedData) as Record<string, unknown>;
        }
        // Timetable data is returned as-is (transformation handled in frontend)

        freshData = processedData;
        console.log(`[API /data/refresh] ✅ Successfully retrieved ${data_type} data from Supabase`);
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
      
      // Return 401 for authentication/session errors, 500 for other errors
      const isAuthError = fetchError?.toLowerCase().includes('session expired') || 
                         fetchError?.toLowerCase().includes('authentication failed') ||
                         fetchError?.toLowerCase().includes('please re-login');
      const statusCode = isAuthError ? 401 : 500;
      
      return NextResponse.json(
        {
          success: false,
          error: fetchError || `Failed to fetch ${data_type} data`,
        },
        { status: statusCode }
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

