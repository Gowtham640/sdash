import { NextRequest, NextResponse } from "next/server";
import { dataCache } from "@/lib/dataCache";
import { callBackendScraper } from '@/lib/scraperClient';
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { 
  getCachedTimetable, 
  getCachedCalendar, 
  isLongTermCacheValid, 
  storeLongTermCache,
  getLongTermCacheAge 
} from '@/lib/longTermCache';

/**
 * Unified data endpoint - Returns all data types in one call
 * POST /api/data/all
 * 
 * Features:
 * - Caches data for 5 minutes for instant retrieval
 * - Uses Python session persistence (no password needed)
 * - Force refresh available to bypass cache
 * 
 * Request body: { access_token: string, force_refresh?: boolean }
 * 
 * Returns: {
 *   success: boolean,
 *   data: {
 *     calendar: {...},
 *     attendance: {...},
 *     marks: {...},
 *     timetable: {...}
 *   },
 *   metadata: {
 *     ...,
 *     cached: boolean,
 *     cache_age_seconds: number
 *   }
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

    // Decode the payload (second part)
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error("[API /data/all] JWT decode error:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  console.log("[API /data/all] POST request received");

  try {
    // Parse request body
    const body = await request.json();
    const { access_token, force_refresh = false, password } = body;

    if (!access_token) {
      console.error("[API /data/all] No access token provided");
      return NextResponse.json(
        { success: false, error: "Access token is required" },
        { status: 400 }
      );
    }

    // Verify and decode JWT token
    console.log("[API /data/all] Verifying access token...");
    let user_email: string;
    let user_id: string;

    try {
      // Decode the JWT token (extract claims without verification)
      const decoded = decodeJWT(access_token);
      
      if (!decoded) {
        throw new Error("Invalid token format");
      }

      user_email = (decoded.email as string) || (decoded.sub as string) || '';
      user_id = decoded.sub as string;

      console.log(`[API /data/all] Token decoded - User: ${user_email}`);

      if (!user_email || !user_id) {
        throw new Error("Missing user claims in token");
      }

    } catch (tokenError) {
      console.error("[API /data/all] Token verification failed:", tokenError);
      return NextResponse.json(
        { success: false, error: "Invalid or expired session. Please sign in again." },
        { status: 401 }
      );
    }

    console.log(`[API /data/all] Session valid for user: ${user_email}`);

    // Check cache FIRST (unless force_refresh is true)
    const cacheKey = `data:${user_email}`;
    
    if (!force_refresh) {
      const cachedData = dataCache.get(cacheKey);
      
      if (cachedData) {
        console.log(`[API /data/all] ✅ Returning cached data for ${user_email}`);
        
        // Add cache metadata to response
        const cachedResult = cachedData as { metadata?: { cached_at?: number } };
        return NextResponse.json({
          ...cachedData,
          metadata: {
            ...cachedData.metadata,
            cached: true,
            cache_age_seconds: cachedResult.metadata?.cached_at ? Math.floor((Date.now() - cachedResult.metadata.cached_at) / 1000) : 0,
            cache_ttl_seconds: Math.floor((5 * 60 * 1000) / 1000)
          }
        });
      }
    } else {
      console.log(`[API /data/all] Force refresh enabled, bypassing cache for ${user_email}`);
    }

    // Check long-term cache for timetable/calendar (if not forcing refresh)
    const cachedTimetable = !force_refresh ? getCachedTimetable() : null;
    const cachedCalendar = !force_refresh ? getCachedCalendar() : null;
    const hasLongTermCache = isLongTermCacheValid() && cachedTimetable && cachedCalendar;

    if (hasLongTermCache) {
      console.log(`[API /data/all] ✅ Using long-term cache for timetable & calendar (${getLongTermCacheAge()} days old)`);
      console.log(`[API /data/all] Fetching ONLY attendance & marks from backend`);
      
      // Fetch ONLY attendance and marks from backend
      const result = await callPythonAttendanceMarksOnly(user_email, user_id, password);

      // Check if session expired
      if (!result.success && result.error === "session_expired") {
        console.log("[API /data/all] Python session expired, user needs to re-authenticate");
        return NextResponse.json(
          {
            success: false,
            error: "session_expired",
            message: "Your portal session has expired. Please re-enter your password.",
            requires_password: true
          },
          { status: 401 }
        );
      }

      // Merge cached timetable/calendar with fresh attendance/marks
      const mergedResult = {
        success: result.success,
        data: {
          calendar: {
            success: true,
            data: cachedCalendar,
            cached: true,
            source: 'long_term_cache',
            age_days: getLongTermCacheAge()
          },
          timetable: {
            success: true,
            data: cachedTimetable,
            cached: true,
            source: 'long_term_cache',
            age_days: getLongTermCacheAge()
          },
          attendance: result.data?.attendance || result.attendance,
          marks: result.data?.marks || result.marks,
        },
        metadata: {
          ...result.metadata,
          timetable_cached: true,
          calendar_cached: true,
          cache_age_days: getLongTermCacheAge(),
          cache_days_remaining: 30 - getLongTermCacheAge(),
          attendance_fresh: true,
          marks_fresh: true
        }
      };

      // Store in short-term cache
      if (mergedResult.success) {
        dataCache.set(cacheKey, mergedResult, 5 * 60 * 1000); // 5 minute TTL
        console.log(`[API /data/all] 💾 Cached merged data for ${user_email}`);
      }

      return NextResponse.json(mergedResult, { status: mergedResult.success ? 200 : 500 });
    }

    // No long-term cache or force refresh - fetch everything from Python scraper
    console.log(`[API /data/all] ❌ Cache miss, fetching ALL data from Python for ${user_email}`);
    const result = await callPythonUnifiedData(user_email, user_id, force_refresh, password);

    // Check if session expired
    if (!result.success && result.error === "session_expired") {
      console.log("[API /data/all] Python session expired, user needs to re-authenticate");
      return NextResponse.json(
        {
          success: false,
          error: "session_expired",
          message: "Your portal session has expired. Please re-enter your password.",
          requires_password: true
        },
        { status: 401 }
      );
    }

    // Store in short-term cache and long-term cache if successful
    if (result.success) {
      const resultWithMetadata = result as { metadata?: { cached_at?: number; cached?: boolean; cache_age_seconds?: number; cache_ttl_seconds?: number }; data?: { timetable?: { success?: boolean; data?: any }; calendar?: { success?: boolean; data?: any } } };
      
      // Store timetable and calendar in long-term cache (1 month)
      if (resultWithMetadata.data?.timetable?.success && resultWithMetadata.data?.timetable?.data &&
          resultWithMetadata.data?.calendar?.success && resultWithMetadata.data?.calendar?.data) {
        storeLongTermCache(
          resultWithMetadata.data.timetable.data,
          resultWithMetadata.data.calendar.data
        );
        console.log(`[API /data/all] 💾 Stored timetable & calendar in long-term cache (1 month)`);
      }

      // Store everything in short-term cache (5 minutes)
      if (resultWithMetadata.metadata) {
        resultWithMetadata.metadata.cached_at = Date.now();
        resultWithMetadata.metadata.cached = false; // First request (not from cache)
        resultWithMetadata.metadata.cache_age_seconds = 0;
        resultWithMetadata.metadata.cache_ttl_seconds = 300;
      }
      dataCache.set(cacheKey, result, 5 * 60 * 1000); // 5 minute TTL
      console.log(`[API /data/all] 💾 Cached all data for ${user_email}`);
    }

    // Return the unified data
    return NextResponse.json(result, { status: result.success ? 200 : 500 });

  } catch (error) {
    console.error("[API /data/all] Unexpected error:", error);
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
 * Call backend scraper to get only attendance and marks (timetable/calendar from cache)
 */
async function callPythonAttendanceMarksOnly(email: string, user_id: string, password?: string): Promise<Record<string, unknown>> {
  // Try to call the optimized endpoint that only fetches attendance/marks
  // If backend doesn't support it yet, fall back to get_all_data
  const result = await callBackendScraper('get_attendance_marks_data', {
    email,
    ...(password ? { password } : {}), // Only include password if provided
  });

  // If backend doesn't support this action, fall back to get_all_data
  if (!result.success && result.error?.includes('Unknown action')) {
    console.log(`[API /data/all] Backend doesn't support get_attendance_marks_data, using get_all_data`);
    return await callPythonUnifiedData(email, user_id, false, password);
  }

  // Update user's semester in database if available (fire and forget)
  if (result.success && result.data?.attendance?.semester) {
    updateSemesterInDatabase(user_id, result.data.attendance.semester);
  }

  console.log(`[API /data/all] Attendance/Marks fetch - Success: ${result.success}, Error: ${result.error || 'none'}`);
  return result;
}

/**
 * Call backend scraper to get all data using HTTP API
 */
async function callPythonUnifiedData(email: string, user_id: string, force_refresh: boolean, password?: string): Promise<Record<string, unknown>> {
  const result = await callBackendScraper('get_all_data', {
    email,
    ...(password ? { password } : {}), // Only include password if provided
    force_refresh,
  });

  // Update user's semester in database if available (fire and forget)
  if (result.success && result.data?.attendance?.semester) {
    updateSemesterInDatabase(user_id, result.data.attendance.semester);
  } else {
    console.log(`[API /data/all] No semester data to update. Success: ${result.success}`);
    console.log(`[API /data/all] Attendance data: ${JSON.stringify(result.data?.attendance)}`);
  }

  console.log(`[API /data/all] Success: ${result.success}, Error: ${result.error || 'none'}`);
  return result;
}

/**
 * Update user's semester in database (fire and forget)
 */
async function updateSemesterInDatabase(user_id: string, semester: number): Promise<void> {
  console.log(`[API /data/all] Updating user's semester to: ${semester}`);
  console.log(`[API /data/all] User ID: ${user_id}, Semester: ${semester}`);
  
  // Fire and forget - don't wait for DB update
  (async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from("users")
        .update({ semester })
        .eq("id", user_id)
        .select();
      
      if (error) {
        console.error(`[API /data/all] Failed to update semester: ${error.message}`);
        console.error(`[API /data/all] Error details:`, JSON.stringify(error));
      } else {
        console.log(`[API /data/all] ✓ Updated user semester in database to: ${semester}`);
        console.log(`[API /data/all] Updated row:`, JSON.stringify(data));
      }
    } catch (dbError) {
      console.error(`[API /data/all] Exception updating semester: ${dbError}`);
    }
  })();
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

