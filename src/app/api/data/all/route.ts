import { NextRequest, NextResponse } from "next/server";
import { dataCache } from "@/lib/dataCache";
import { callBackendScraper } from '@/lib/scraperClient';
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
  const requestStartTime = Date.now();
  console.log("===========================================");
  console.log("[API /data/all] 📥 POST request received");
  console.log("[API /data/all] Timestamp:", new Date().toISOString());

  try {
    // Parse request body
    const body = await request.json();
    const { access_token, force_refresh = false, password, has_long_term_cache } = body;
    
    console.log("[API /data/all] 📋 Request parameters:");
    console.log("  - force_refresh:", force_refresh);
    console.log("  - has_long_term_cache:", has_long_term_cache);
    console.log("  - password_provided:", password ? "✓" : "✗");
    console.log("  - access_token_length:", access_token?.length || 0);

    if (!access_token) {
      console.error("[API /data/all] ❌ No access token provided");
      return NextResponse.json(
        { success: false, error: "Access token is required" },
        { status: 400 }
      );
    }

    // Verify and decode JWT token
    console.log("[API /data/all] 🔐 Verifying access token...");
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

      console.log(`[API /data/all] ✅ Token decoded successfully`);
      console.log(`[API /data/all]   - User Email: ${user_email}`);
      console.log(`[API /data/all]   - User ID: ${user_id}`);

      if (!user_email || !user_id) {
        throw new Error("Missing user claims in token");
      }

    } catch (tokenError) {
      console.error("[API /data/all] ❌ Token verification failed");
      console.error("[API /data/all]   Error:", tokenError instanceof Error ? tokenError.message : String(tokenError));
      return NextResponse.json(
        { success: false, error: "Invalid or expired session. Please sign in again." },
        { status: 401 }
      );
    }

    console.log(`[API /data/all] ✅ Session validated for user: ${user_email}`);

    // Check cache FIRST (unless force_refresh is true)
    const cacheKey = `data:${user_email}`;
    
    console.log(`[API /data/all] 🔍 Checking server-side cache...`);
    console.log(`[API /data/all]   - Cache key: ${cacheKey}`);
    console.log(`[API /data/all]   - Force refresh: ${force_refresh}`);
    
    if (!force_refresh) {
      const cachedData = dataCache.get(cacheKey);
      
      if (cachedData) {
        const cacheAge = (cachedData as { metadata?: { cached_at?: number } }).metadata?.cached_at 
          ? Math.floor((Date.now() - (cachedData as { metadata?: { cached_at?: number } }).metadata!.cached_at!) / 1000)
          : 0;
        
        console.log(`[API /data/all] ✅ Server cache HIT for ${user_email}`);
        console.log(`[API /data/all]   - Cache age: ${cacheAge}s`);
        console.log(`[API /data/all]   - Response time: ${Date.now() - requestStartTime}ms`);
        console.log("===========================================");
        
        // Add cache metadata to response
        const cachedResult = cachedData as { metadata?: { cached_at?: number } };
        return NextResponse.json({
          ...cachedData,
          metadata: {
            ...cachedData.metadata,
            cached: true,
            cache_age_seconds: cacheAge,
            cache_ttl_seconds: Math.floor((5 * 60 * 1000) / 1000)
          }
        });
      } else {
        console.log(`[API /data/all] ❌ Server cache MISS for ${user_email}`);
      }
    } else {
      console.log(`[API /data/all] ⏩ Force refresh enabled, bypassing server cache`);
    }

    // Check if client has long-term cache (check request body)
    const hasLongTermCache = has_long_term_cache === true;
    console.log(`[API /data/all] 📦 Client long-term cache status: ${hasLongTermCache ? "✓ EXISTS" : "✗ NOT FOUND"}`);

    if (hasLongTermCache && !force_refresh) {
      console.log(`[API /data/all] 🎯 Using optimized path: Fetching ONLY attendance & marks`);
      console.log(`[API /data/all]   - Timetable/Calendar: Using client cache`);
      console.log(`[API /data/all]   - Backend call: get_attendance_marks_data`);
      
      const backendStartTime = Date.now();
      // Fetch ONLY attendance and marks from backend
      const result = await callPythonAttendanceMarksOnly(user_email, user_id, password);
      const backendDuration = Date.now() - backendStartTime;
      
      console.log(`[API /data/all] 🔄 Backend response received`);
      console.log(`[API /data/all]   - Duration: ${backendDuration}ms`);
      console.log(`[API /data/all]   - Success: ${result.success}`);
      
      if (!result.success) {
        console.error(`[API /data/all] ❌ Backend error: ${result.error || 'Unknown error'}`);
      }

    // Check if session expired
    if (!result.success && result.error === "session_expired") {
        console.error("[API /data/all] ❌ Backend session expired");
        console.error("[API /data/all]   - User needs to re-authenticate");
        console.log(`[API /data/all]   - Total response time: ${Date.now() - requestStartTime}ms`);
        console.log("===========================================");
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

      // Return only attendance/marks - client will merge with cached timetable/calendar
      const resultData = result.data as { attendance?: unknown; marks?: unknown } | undefined;
      const resultMetadata = (result.metadata && typeof result.metadata === 'object') 
        ? result.metadata as Record<string, unknown>
        : {};
      
      const partialResult = {
        success: result.success,
        data: {
          attendance: resultData?.attendance || (result as { attendance?: unknown }).attendance,
          marks: resultData?.marks || (result as { marks?: unknown }).marks,
        },
        metadata: {
          ...resultMetadata,
          timetable_cached: true,
          calendar_cached: true,
          attendance_fresh: true,
          marks_fresh: true,
          partial_data: true // Indicates client needs to merge with cache
        }
      };

      console.log(`[API /data/all] 📊 Partial data response prepared`);
      console.log(`[API /data/all]   - Attendance: ${partialResult.data.attendance ? "✓" : "✗"}`);
      console.log(`[API /data/all]   - Marks: ${partialResult.data.marks ? "✓" : "✗"}`);

      // Store in short-term cache
      if (partialResult.success) {
        dataCache.set(cacheKey, partialResult, 5 * 60 * 1000); // 5 minute TTL
        console.log(`[API /data/all] 💾 Stored partial data in server cache (5min TTL)`);
      }

      const totalTime = Date.now() - requestStartTime;
      console.log(`[API /data/all] ✅ Response sent (${totalTime}ms total)`);
      console.log("===========================================");
      return NextResponse.json(partialResult, { status: partialResult.success ? 200 : 500 });
    }

    // No long-term cache or force refresh - fetch data sequentially (split requests)
    console.log(`[API /data/all] 🚀 Fetching data from backend (split into 2 sequential requests)`);
    console.log(`[API /data/all]   - Strategy: Sequential requests (one after another)`);
    console.log(`[API /data/all]   - Request 1: get_static_data (timetable + calendar)`);
    console.log(`[API /data/all]   - Request 2: get_dynamic_data (attendance + marks)`);
    console.log(`[API /data/all]   - Force refresh: ${force_refresh}`);
    
    const backendStartTime = Date.now();
    
    // Fetch static data first (sequentially)
    console.log(`[API /data/all] ⏳ Starting request 1/2: get_static_data...`);
    let staticData: Record<string, unknown> | null = null;
    try {
      staticData = await callPythonStaticData(user_email, user_id, password);
      const staticDuration = Date.now() - backendStartTime;
      console.log(`[API /data/all] ✅ Static data received (${staticDuration}ms)`);
      console.log(`[API /data/all]   - Success: ${staticData.success}`);
      
      // Safely access nested data properties
      const staticDataData = staticData.data as { calendar?: unknown; timetable?: unknown } | undefined;
      console.log(`[API /data/all]   - Calendar: ${staticDataData?.calendar ? "✓" : "✗"}`);
      console.log(`[API /data/all]   - Timetable: ${staticDataData?.timetable ? "✓" : "✗"}`);
    } catch (error) {
      console.error(`[API /data/all] ❌ Static data request failed`);
      console.error(`[API /data/all]   - Error: ${error instanceof Error ? error.message : String(error)}`);
      staticData = null;
    }
    
    // Fetch dynamic data second (sequentially)
    console.log(`[API /data/all] ⏳ Starting request 2/2: get_dynamic_data...`);
    let dynamicData: Record<string, unknown> | null = null;
    try {
      const dynamicStartTime = Date.now();
      dynamicData = await callPythonDynamicData(user_email, user_id, password);
      const dynamicDuration = Date.now() - dynamicStartTime;
      console.log(`[API /data/all] ✅ Dynamic data received (${dynamicDuration}ms)`);
      console.log(`[API /data/all]   - Success: ${dynamicData.success}`);
      
      // Safely access nested data properties
      const dynamicDataData = dynamicData.data as { attendance?: unknown; marks?: unknown } | undefined;
      console.log(`[API /data/all]   - Attendance: ${dynamicDataData?.attendance ? "✓" : "✗"}`);
      console.log(`[API /data/all]   - Marks: ${dynamicDataData?.marks ? "✓" : "✗"}`);
    } catch (error) {
      console.error(`[API /data/all] ❌ Dynamic data request failed`);
      console.error(`[API /data/all]   - Error: ${error instanceof Error ? error.message : String(error)}`);
      dynamicData = null;
    }
    
    const backendDuration = Date.now() - backendStartTime;
    console.log(`[API /data/all] 🔄 Both backend requests completed: ${backendDuration}ms total`);
    
    // Merge results
    const result = mergeSplitDataResults(staticData, dynamicData);
    
    console.log(`[API /data/all] 📊 Merged result:`);
    console.log(`[API /data/all]   - Overall success: ${result.success}`);
    
    // Safely access merged result data properties
    const mergedData = result.data as { 
      calendar?: unknown; 
      timetable?: unknown; 
      attendance?: unknown; 
      marks?: unknown 
    } | undefined;
    console.log(`[API /data/all]   - Calendar: ${mergedData?.calendar ? "✓" : "✗"}`);
    console.log(`[API /data/all]   - Timetable: ${mergedData?.timetable ? "✓" : "✗"}`);
    console.log(`[API /data/all]   - Attendance: ${mergedData?.attendance ? "✓" : "✗"}`);
    console.log(`[API /data/all]   - Marks: ${mergedData?.marks ? "✓" : "✗"}`);
    
    // Check for session expiry in either request
    if ((staticData && !staticData.success && staticData.error === "session_expired") ||
        (dynamicData && !dynamicData.success && dynamicData.error === "session_expired")) {
      console.error("[API /data/all] ❌ Backend session expired");
      console.error("[API /data/all]   - User needs to re-authenticate");
      console.log(`[API /data/all]   - Total response time: ${Date.now() - requestStartTime}ms`);
      console.log("===========================================");
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

    // Store in short-term cache if successful
    if (result.success) {
      const resultWithMetadata = result as { metadata?: { cached_at?: number; cached?: boolean; cache_age_seconds?: number; cache_ttl_seconds?: number } };
      
      // Store everything in short-term cache (5 minutes)
      if (resultWithMetadata.metadata) {
        resultWithMetadata.metadata.cached_at = Date.now();
        resultWithMetadata.metadata.cached = false; // First request (not from cache)
        resultWithMetadata.metadata.cache_age_seconds = 0;
        resultWithMetadata.metadata.cache_ttl_seconds = 300;
      }
      dataCache.set(cacheKey, result, 5 * 60 * 1000); // 5 minute TTL
      console.log(`[API /data/all] 💾 Stored all data in server cache (5min TTL)`);
      console.log(`[API /data/all]   - Note: Long-term cache storage happens on client-side`);
    }

    const totalTime = Date.now() - requestStartTime;
    console.log(`[API /data/all] ✅ Response sent (${totalTime}ms total)`);
    console.log(`[API /data/all]   - Status: ${result.success ? 200 : 500}`);
    console.log("===========================================");

    // Return the unified data
    return NextResponse.json(result, { status: result.success ? 200 : 500 });

  } catch (error) {
    const totalTime = Date.now() - requestStartTime;
    console.error("===========================================");
    console.error("[API /data/all] ❌ UNEXPECTED ERROR");
    console.error(`[API /data/all]   - Duration: ${totalTime}ms`);
    console.error(`[API /data/all]   - Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`[API /data/all]   - Error Message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[API /data/all]   - Stack Trace: ${error.stack}`);
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
 * Call backend scraper to get only attendance and marks (timetable/calendar from cache)
 */
async function callPythonAttendanceMarksOnly(email: string, user_id: string, password?: string): Promise<Record<string, unknown>> {
  console.log(`[API /data/all] 🔄 Calling backend: get_attendance_marks_data`);
  console.log(`[API /data/all]   - Email: ${email}`);
  console.log(`[API /data/all]   - Password: ${password ? "✓ Provided" : "✗ Not provided"}`);
  
  // Try to call the optimized endpoint that only fetches attendance/marks
  // If backend doesn't support it yet, fall back to get_all_data
  const backendCallStart = Date.now();
  const result = await callBackendScraper('get_attendance_marks_data', {
    email,
    ...(password ? { password } : {}), // Only include password if provided
  });
  const backendCallDuration = Date.now() - backendCallStart;
  
  console.log(`[API /data/all] 📡 Backend call completed: ${backendCallDuration}ms`);
  console.log(`[API /data/all]   - Success: ${result.success}`);
  console.log(`[API /data/all]   - Error: ${result.error || "none"}`);

  // If backend doesn't support this action, fall back to get_dynamic_data (which fetches attendance/marks)
  if (!result.success && result.error?.includes('Unknown action')) {
    console.warn(`[API /data/all] ⚠️  Backend doesn't support get_attendance_marks_data`);
    console.log(`[API /data/all] 🔄 Falling back to get_dynamic_data`);
    return await callPythonDynamicData(email, user_id, password);
  }

  // Update user's semester in database if available (fire and forget)
  const attendanceData = result.data as { attendance?: { semester?: number } } | undefined;
  if (result.success && attendanceData?.attendance?.semester) {
    console.log(`[API /data/all] 📝 Semester found in response: ${attendanceData.attendance.semester}`);
    updateSemesterInDatabase(user_id, attendanceData.attendance.semester);
  } else if (result.success) {
    console.log(`[API /data/all] 📝 No semester data in attendance response`);
  }

  return result as unknown as Record<string, unknown>;
}

/**
 * Call backend scraper to get static data (timetable + calendar)
 */
async function callPythonStaticData(email: string, user_id: string, password?: string): Promise<Record<string, unknown>> {
  console.log(`[API /data/all] 🔄 Calling backend: get_static_data`);
  console.log(`[API /data/all]   - Email: ${email}`);
  console.log(`[API /data/all]   - Data types: timetable, calendar`);
  console.log(`[API /data/all]   - Password: ${password ? "✓ Provided" : "✗ Not provided"}`);
  
  const backendCallStart = Date.now();
  
  // Try new split endpoint first
  let result = await callBackendScraper('get_static_data', {
    email,
    ...(password ? { password } : {}),
  });
  
  // Fallback to get_all_data if new endpoint not supported
  if (!result.success && result.error?.includes('Unknown action')) {
    console.warn(`[API /data/all] ⚠️  Backend doesn't support get_static_data, using get_all_data`);
    console.log(`[API /data/all] 🔄 Falling back to get_all_data for static data`);
    result = await callBackendScraper('get_all_data', {
      email,
      ...(password ? { password } : {}),
      force_refresh: false,
    });
    
    // Extract only static data from full response
    if (result.success && result.data) {
      const resultWithMetadata = result as { metadata?: unknown };
      const staticDataResult = {
        success: true,
        data: {
          calendar: result.data.calendar,
          timetable: result.data.timetable,
        },
        metadata: resultWithMetadata.metadata,
      };
      result = staticDataResult as unknown as typeof result;
    }
  }
  
  const backendCallDuration = Date.now() - backendCallStart;
  
  console.log(`[API /data/all] 📡 Static data call completed: ${backendCallDuration}ms`);
  console.log(`[API /data/all]   - Success: ${result.success}`);
  console.log(`[API /data/all]   - Error: ${result.error || "none"}`);
  
  if (result.success) {
    console.log(`[API /data/all] 📊 Static data received:`);
    const staticResultData = result.data as { calendar?: unknown; timetable?: unknown } | undefined;
    console.log(`[API /data/all]   - Calendar: ${staticResultData?.calendar ? "✓" : "✗"}`);
    console.log(`[API /data/all]   - Timetable: ${staticResultData?.timetable ? "✓" : "✗"}`);
  }

  return result as unknown as Record<string, unknown>;
}

/**
 * Call backend scraper to get dynamic data (attendance + marks)
 */
async function callPythonDynamicData(email: string, user_id: string, password?: string): Promise<Record<string, unknown>> {
  console.log(`[API /data/all] 🔄 Calling backend: get_dynamic_data`);
  console.log(`[API /data/all]   - Email: ${email}`);
  console.log(`[API /data/all]   - Data types: attendance, marks`);
  console.log(`[API /data/all]   - Password: ${password ? "✓ Provided" : "✗ Not provided"}`);
  
  const backendCallStart = Date.now();
  
  // Try new split endpoint first
  let result = await callBackendScraper('get_dynamic_data', {
    email,
    ...(password ? { password } : {}),
  });
  
  // Fallback to get_all_data if new endpoint not supported
  if (!result.success && result.error?.includes('Unknown action')) {
    console.warn(`[API /data/all] ⚠️  Backend doesn't support get_dynamic_data, using get_all_data`);
    console.log(`[API /data/all] 🔄 Falling back to get_all_data for dynamic data`);
    result = await callBackendScraper('get_all_data', {
      email,
      ...(password ? { password } : {}),
      force_refresh: false,
    });
    
    // Extract only dynamic data from full response
    if (result.success && result.data) {
      const resultWithMetadata = result as { metadata?: unknown };
      const dynamicDataResult = {
        success: true,
        data: {
          attendance: result.data.attendance,
          marks: result.data.marks,
        },
        metadata: resultWithMetadata.metadata,
      };
      result = dynamicDataResult as unknown as typeof result;
    }
  }
  
  const backendCallDuration = Date.now() - backendCallStart;
  
  console.log(`[API /data/all] 📡 Dynamic data call completed: ${backendCallDuration}ms`);
  console.log(`[API /data/all]   - Success: ${result.success}`);
  console.log(`[API /data/all]   - Error: ${result.error || "none"}`);
  
  if (result.success) {
    console.log(`[API /data/all] 📊 Dynamic data received:`);
    console.log(`[API /data/all]   - Attendance: ${result.data?.attendance ? "✓" : "✗"}`);
    console.log(`[API /data/all]   - Marks: ${result.data?.marks ? "✓" : "✗"}`);
    
    // Update user's semester in database if available (fire and forget)
    const dynamicAttendanceData = result.data as { attendance?: { semester?: number } } | undefined;
    if (dynamicAttendanceData?.attendance?.semester) {
      console.log(`[API /data/all] 📝 Semester found in response: ${dynamicAttendanceData.attendance.semester}`);
      updateSemesterInDatabase(user_id, dynamicAttendanceData.attendance.semester);
    } else {
      console.log(`[API /data/all] 📝 No semester data to update`);
      console.log(`[API /data/all]   - Attendance data exists: ${result.data?.attendance ? "✓" : "✗"}`);
    }
  }

  return result as unknown as Record<string, unknown>;
}

/**
 * Merge static and dynamic data results into unified format
 */
function mergeSplitDataResults(
  staticData: Record<string, unknown> | null,
  dynamicData: Record<string, unknown> | null
): Record<string, unknown> {
  const staticSuccess = staticData && staticData.success;
  const dynamicSuccess = dynamicData && dynamicData.success;
  const overallSuccess = staticSuccess || dynamicSuccess;
  
  console.log(`[API /data/all] 🔗 Merging split data results`);
  console.log(`[API /data/all]   - Static data success: ${staticSuccess}`);
  console.log(`[API /data/all]   - Dynamic data success: ${dynamicSuccess}`);
  console.log(`[API /data/all]   - Overall success: ${overallSuccess}`);
  
  const merged: Record<string, unknown> = {
    success: overallSuccess,
    data: {
      calendar: (staticData?.data as { calendar?: unknown } | undefined)?.calendar || { success: false, error: "Not fetched" },
      timetable: (staticData?.data as { timetable?: unknown } | undefined)?.timetable || { success: false, error: "Not fetched" },
      attendance: (dynamicData?.data as { attendance?: unknown } | undefined)?.attendance || { success: false, error: "Not fetched" },
      marks: (dynamicData?.data as { marks?: unknown } | undefined)?.marks || { success: false, error: "Not fetched" },
    },
    metadata: {
      generated_at: new Date().toISOString(),
      source: "SRM Academia Portal - Split Data Fetch",
      static_data_success: staticSuccess,
      dynamic_data_success: dynamicSuccess,
      parallel_fetch: true,
    },
  };
  
  // Combine metadata from both results if available
  const baseMetadata = merged.metadata as Record<string, unknown>;
  
  if (staticData?.metadata && typeof staticData.metadata === 'object' && staticData.metadata !== null) {
    const staticMetadata = staticData.metadata as Record<string, unknown>;
    merged.metadata = {
      ...baseMetadata,
      static_metadata: staticMetadata,
    } as Record<string, unknown>;
  }
  if (dynamicData?.metadata && typeof dynamicData.metadata === 'object' && dynamicData.metadata !== null) {
    const dynamicMetadata = dynamicData.metadata as Record<string, unknown>;
    merged.metadata = {
      ...(merged.metadata as Record<string, unknown>),
      dynamic_metadata: dynamicMetadata,
    } as Record<string, unknown>;
  }
  
  // Add error if both failed
  if (!staticSuccess && !dynamicSuccess) {
    merged.error = `Both requests failed. Static: ${staticData?.error || "Unknown"}, Dynamic: ${dynamicData?.error || "Unknown"}`;
  } else if (!staticSuccess) {
    merged.error = `Static data failed: ${staticData?.error || "Unknown"}`;
  } else if (!dynamicSuccess) {
    merged.error = `Dynamic data failed: ${dynamicData?.error || "Unknown"}`;
  }
  
  return merged;
}

/**
 * Update user's semester in database (fire and forget)
 */
async function updateSemesterInDatabase(user_id: string, semester: number): Promise<void> {
  console.log(`[API /data/all] 💾 Database update started (fire-and-forget)`);
  console.log(`[API /data/all]   - User ID: ${user_id}`);
  console.log(`[API /data/all]   - Semester: ${semester}`);
    
    // Fire and forget - don't wait for DB update
    (async () => {
      try {
      const dbStartTime = Date.now();
        const { data, error } = await supabaseAdmin
          .from("users")
          .update({ semester })
          .eq("id", user_id)
          .select();
      const dbDuration = Date.now() - dbStartTime;
        
        if (error) {
        console.error(`[API /data/all] ❌ Database update failed (${dbDuration}ms)`);
        console.error(`[API /data/all]   - Error: ${error.message}`);
        console.error(`[API /data/all]   - Details: ${JSON.stringify(error)}`);
        } else {
        console.log(`[API /data/all] ✅ Database update successful (${dbDuration}ms)`);
        console.log(`[API /data/all]   - Updated semester to: ${semester}`);
        console.log(`[API /data/all]   - Updated row: ${JSON.stringify(data)}`);
        }
      } catch (dbError) {
      console.error(`[API /data/all] ❌ Database exception:`);
      console.error(`[API /data/all]   - Error: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      if (dbError instanceof Error && dbError.stack) {
        console.error(`[API /data/all]   - Stack: ${dbError.stack}`);
      }
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

