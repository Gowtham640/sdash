import { NextRequest, NextResponse } from "next/server";
import { dataCache } from "@/lib/dataCache";
import { callBackendScraper } from '@/lib/scraperClient';
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requestQueueTracker } from "@/lib/requestQueue";

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

  let user_email: string = '';
  
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

    // Register request in queue tracker
    requestQueueTracker.registerRequest(user_email);

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
        const cachedResult = cachedData as { metadata?: { cached_at?: number; queue_info?: unknown } };
        
        // Get current queue info
        const queueInfo = requestQueueTracker.getQueueInfo(user_email);
        
        // Preserve existing queue_info from cache if present, otherwise use current
        const existingQueueInfo = cachedResult.metadata?.queue_info;
        
        return NextResponse.json({
          ...cachedData,
          metadata: {
            ...cachedData.metadata,
            cached: true,
            cache_age_seconds: cacheAge,
            cache_ttl_seconds: Math.floor((6 * 60 * 60 * 1000) / 1000),
            queue_info: existingQueueInfo || queueInfo // Use cached queue info or current
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
      
      // Type-safe access to result properties
      const resultTyped = result as { success?: boolean; error?: string; data?: unknown; metadata?: unknown };
      
      console.log(`[API /data/all] 🔄 Backend response received`);
      console.log(`[API /data/all]   - Duration: ${backendDuration}ms`);
      console.log(`[API /data/all]   - Success: ${resultTyped.success || false}`);
      
      if (!resultTyped.success) {
        console.error(`[API /data/all] ❌ Backend error: ${resultTyped.error || 'Unknown error'}`);
      }

      // Check if session expired
      if (!resultTyped.success && resultTyped.error === "session_expired") {
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

      // Try to get semester from attendance data, fallback to database
      let semesterFromAttendance: number | null = null;
      const attendanceDataInResult = resultTyped.data as { attendance?: { semester?: number; data?: { metadata?: { semester?: number } } } } | undefined;
      if (attendanceDataInResult?.attendance?.semester) {
        semesterFromAttendance = attendanceDataInResult.attendance.semester;
      } else if (attendanceDataInResult?.attendance?.data?.metadata?.semester) {
        semesterFromAttendance = attendanceDataInResult.attendance.data.metadata.semester;
      }
      
      // If no semester from attendance, fetch from database
      let semester: number | null = semesterFromAttendance;
      if (!semester) {
        console.log(`[API /data/all] 🔍 No semester from attendance (partial data), fetching from database...`);
        semester = await getSemesterFromDatabase(user_id);
      } else {
        console.log(`[API /data/all] ✅ Semester from attendance (partial data): ${semester}`);
      }
      
      // Get queue info
      const queueInfo = requestQueueTracker.getQueueInfo(user_email);
      
      // Return only attendance/marks - client will merge with cached timetable/calendar
      const resultData = resultTyped.data as { attendance?: unknown; marks?: unknown } | undefined;
      const resultMetadata = (resultTyped.metadata && typeof resultTyped.metadata === 'object') 
        ? resultTyped.metadata as Record<string, unknown>
        : {};
      
      const partialResult = {
        success: resultTyped.success || false,
        data: {
          attendance: resultData?.attendance,
          marks: resultData?.marks,
        },
        metadata: {
          ...resultMetadata,
          timetable_cached: true,
          calendar_cached: true,
          attendance_fresh: true,
          marks_fresh: true,
          partial_data: true, // Indicates client needs to merge with cache
          ...(semester ? { semester } : {}),
          queue_info: queueInfo
        },
        ...(semester ? { semester } : {})
      };

      console.log(`[API /data/all] 📊 Partial data response prepared`);
      const partialResultData = partialResult.data as { attendance?: unknown; marks?: unknown };
      console.log(`[API /data/all]   - Attendance: ${partialResultData?.attendance ? "✓" : "✗"}`);
      console.log(`[API /data/all]   - Marks: ${partialResultData?.marks ? "✓" : "✗"}`);

      // Store in short-term cache
      if (partialResult.success) {
        dataCache.set(cacheKey, partialResult, 6 * 60 * 60 * 1000); // 6 hour TTL
        console.log(`[API /data/all] 💾 Stored partial data in server cache (6hour TTL)`);
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
    const mergedResultTyped = result as { success?: boolean };
    console.log(`[API /data/all]   - Overall success: ${mergedResultTyped.success || false}`);
    
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
    const staticDataTyped = staticData as { success?: boolean; error?: string } | null;
    const dynamicDataTyped = dynamicData as { success?: boolean; error?: string } | null;
    if ((staticDataTyped && !staticDataTyped.success && staticDataTyped.error === "session_expired") ||
        (dynamicDataTyped && !dynamicDataTyped.success && dynamicDataTyped.error === "session_expired")) {
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

    // Try to get semester from attendance data first, fallback to database
    let semesterFromAttendance: number | null = null;
    const attendanceData = (result.data as { attendance?: { semester?: number; data?: { metadata?: { semester?: number } } } })?.attendance;
    if (attendanceData?.semester) {
      semesterFromAttendance = attendanceData.semester;
    } else if (attendanceData?.data?.metadata?.semester) {
      semesterFromAttendance = attendanceData.data.metadata.semester;
    }
    
    // If no semester from attendance and attendance failed, fetch from database
    let semester: number | null = semesterFromAttendance;
    if (!semester) {
      console.log(`[API /data/all] 🔍 No semester from attendance, fetching from database...`);
      semester = await getSemesterFromDatabase(user_id);
    } else {
      console.log(`[API /data/all] ✅ Semester from attendance: ${semester}`);
    }
    
    // Include semester in response metadata
    const resultTyped = result as { success?: boolean; metadata?: { cached_at?: number; cached?: boolean; cache_age_seconds?: number; cache_ttl_seconds?: number; semester?: number }; semester?: number };
    if (resultTyped.metadata) {
      if (semester) {
        resultTyped.metadata.semester = semester;
        console.log(`[API /data/all] 📝 Added semester to response metadata: ${semester}`);
      }
    } else if (semester) {
      // Create metadata if it doesn't exist
      resultTyped.metadata = { semester };
    }
    
    // Also add semester at root level for easy access
    if (semester) {
      (result as { semester?: number }).semester = semester;
    }

    // Store in short-term cache if successful
    if (resultTyped.success) {
      // Get queue info before storing
      const queueInfo = requestQueueTracker.getQueueInfo(user_email);
      
      const resultWithMetadata = resultTyped as { 
        metadata?: { 
          cached_at?: number; 
          cached?: boolean; 
          cache_age_seconds?: number; 
          cache_ttl_seconds?: number; 
          semester?: number;
          queue_info?: {
            pending_requests: number;
            total_pending_requests: number;
            recent_requests_last_minute: number;
            backend_queue: {
              pending_backend_requests: number;
              total_pending_backend_requests: number;
              recent_backend_requests_last_minute: number;
            };
          };
        } 
      };
      
      // Store everything in short-term cache (6 hours)
      if (resultWithMetadata.metadata) {
        resultWithMetadata.metadata.cached_at = Date.now();
        resultWithMetadata.metadata.cached = false; // First request (not from cache)
        resultWithMetadata.metadata.cache_age_seconds = 0;
        resultWithMetadata.metadata.cache_ttl_seconds = 21600; // 6 hours in seconds
        resultWithMetadata.metadata.queue_info = queueInfo;
      } else {
        // Create metadata if it doesn't exist
        resultWithMetadata.metadata = {
          queue_info: queueInfo
        };
      }
      dataCache.set(cacheKey, result as Record<string, unknown>, 6 * 60 * 60 * 1000); // 6 hour TTL
      console.log(`[API /data/all] 💾 Stored all data in server cache (6hour TTL)`);
      console.log(`[API /data/all]   - Note: Long-term cache storage happens on client-side`);
    }

    const totalTime = Date.now() - requestStartTime;
    const finalResultTyped = result as { success?: boolean };
    console.log(`[API /data/all] ✅ Response sent (${totalTime}ms total)`);
    console.log(`[API /data/all]   - Status: ${finalResultTyped.success ? 200 : 500}`);
    console.log(`[API /data/all]   - Semester in response: ${semester || 'none'}`);
    console.log("===========================================");

    // Return the unified data
    return NextResponse.json(result, { status: finalResultTyped.success ? 200 : 500 });

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
  } finally {
    // Unregister request from queue tracker
    if (user_email) {
      requestQueueTracker.unregisterRequest(user_email);
    }
  }
}

/**
 * Call backend scraper to get only attendance and marks (timetable/calendar from cache)
 */
async function callPythonAttendanceMarksOnly(email: string, user_id: string, password?: string): Promise<Record<string, unknown>> {
  try {
    console.log(`[API /data/all] 🔄 Calling backend: get_all_data (extracting attendance/marks only)`);
    console.log(`[API /data/all]   - Email: ${email}`);
    console.log(`[API /data/all]   - Password: ${password ? "✓ Provided" : "✗ Not provided"}`);
    
    // Call get_all_data but extract only attendance and marks
    const backendCallStart = Date.now();
    const result = await callBackendScraper('get_all_data', {
      email,
      ...(password ? { password } : {}),
      force_refresh: false,
    });
    const backendCallDuration = Date.now() - backendCallStart;
    
    // Type-safe access to result properties
    const resultTyped = result as { success?: boolean; error?: string; data?: unknown };
    
    console.log(`[API /data/all] 📡 Backend call completed: ${backendCallDuration}ms`);
    console.log(`[API /data/all]   - Success: ${resultTyped.success || false}`);
    console.log(`[API /data/all]   - Error: ${resultTyped.error || "none"}`);

    // Extract only attendance and marks from full response
    if (resultTyped.success && resultTyped.data) {
      const fullData = resultTyped.data as { attendance?: unknown; marks?: unknown; timetable?: unknown; calendar?: unknown };
      const extractedResult = {
        success: true,
        data: {
          attendance: fullData.attendance,
          marks: fullData.marks,
        },
        metadata: {
          attendance_fresh: true,
          marks_fresh: true,
          timetable_cached: true, // From client cache
          calendar_cached: true,  // From client cache
        }
      };
      
      // Update user's semester, name, registration number, and department in database if available (fire and forget)
      const attendanceData = fullData.attendance as { 
        semester?: number; 
        data?: { 
          metadata?: { 
            semester?: number;
            student_name?: string;
            registration_number?: string;
            department?: string;
          } 
        } 
      } | undefined;
      
      // Extract from direct semester field or data.metadata
      const semester = attendanceData?.semester || attendanceData?.data?.metadata?.semester;
      if (semester) {
        console.log(`[API /data/all] 📝 Semester found in response: ${semester}`);
        updateSemesterInDatabase(user_id, semester);
      }
      
      const studentName = attendanceData?.data?.metadata?.student_name;
      if (studentName) {
        console.log(`[API /data/all] 📝 Name found in response: ${studentName}`);
        updateNameInDatabase(user_id, studentName);
      }
      
      const registrationNumber = attendanceData?.data?.metadata?.registration_number;
      if (registrationNumber) {
        console.log(`[API /data/all] 📝 Registration Number found in response: ${registrationNumber}`);
        updateRegistrationNumberInDatabase(user_id, registrationNumber);
      }
      
      const department = attendanceData?.data?.metadata?.department;
      if (department) {
        console.log(`[API /data/all] 📝 Department found in response: ${department}`);
        updateDepartmentInDatabase(user_id, department);
      }
      
      return extractedResult as unknown as Record<string, unknown>;
    }

    return result as unknown as Record<string, unknown>;
  } catch (error) {
    console.error(`[API /data/all] ❌ Error in callPythonAttendanceMarksOnly:`);
    console.error(`[API /data/all]   - Error: ${error instanceof Error ? error.message : String(error)}`);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: null
    } as unknown as Record<string, unknown>;
  }
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
  
  // Type-safe access to result properties
  const resultTyped = result as { success?: boolean; error?: string; data?: unknown; metadata?: unknown };
  
  // Fallback to get_all_data if new endpoint not supported
  if (!resultTyped.success && typeof resultTyped.error === 'string' && resultTyped.error.includes('Unknown action')) {
    console.warn(`[API /data/all] ⚠️  Backend doesn't support get_static_data, using get_all_data`);
    console.log(`[API /data/all] 🔄 Falling back to get_all_data for static data`);
    result = await callBackendScraper('get_all_data', {
      email,
      ...(password ? { password } : {}),
      force_refresh: false,
    });
    
    // Extract only static data from full response
    const fallbackResultTyped = result as { success?: boolean; error?: string; data?: unknown; metadata?: unknown };
    if (fallbackResultTyped.success && fallbackResultTyped.data) {
      const resultWithMetadata = fallbackResultTyped as { metadata?: unknown };
      const resultData = fallbackResultTyped.data as { 
        calendar?: unknown; 
        timetable?: unknown;
      };
      const staticDataResult = {
        success: true,
        data: {
          calendar: resultData.calendar,
          timetable: resultData.timetable,
        },
        metadata: resultWithMetadata.metadata,
      };
      result = staticDataResult as unknown as typeof result;
    }
  }
  
  const backendCallDuration = Date.now() - backendCallStart;
  
  console.log(`[API /data/all] 📡 Static data call completed: ${backendCallDuration}ms`);
  // Use typed result for final access
  const finalResultTyped = result as { success?: boolean; error?: string; data?: unknown };
  console.log(`[API /data/all]   - Success: ${finalResultTyped.success || false}`);
  console.log(`[API /data/all]   - Error: ${finalResultTyped.error || "none"}`);
  
  if (finalResultTyped.success) {
    console.log(`[API /data/all] 📊 Static data received:`);
    const staticResultData = finalResultTyped.data as { calendar?: unknown; timetable?: unknown } | undefined;
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
  
  // Type-safe access to result properties
  const resultTyped = result as { success?: boolean; error?: string; data?: unknown; metadata?: unknown };
  
  // Fallback to get_all_data if new endpoint not supported
  if (!resultTyped.success && typeof resultTyped.error === 'string' && resultTyped.error.includes('Unknown action')) {
    console.warn(`[API /data/all] ⚠️  Backend doesn't support get_dynamic_data, using get_all_data`);
    console.log(`[API /data/all] 🔄 Falling back to get_all_data for dynamic data`);
    result = await callBackendScraper('get_all_data', {
      email,
      ...(password ? { password } : {}),
      force_refresh: false,
    });
    
    // Extract only dynamic data from full response
    const fallbackResultTyped = result as { success?: boolean; error?: string; data?: unknown; metadata?: unknown };
    if (fallbackResultTyped.success && fallbackResultTyped.data) {
      const resultWithMetadata = fallbackResultTyped as { metadata?: unknown };
      const resultData = fallbackResultTyped.data as { 
        attendance?: unknown; 
        marks?: unknown;
      };
      const dynamicDataResult = {
        success: true,
        data: {
          attendance: resultData.attendance,
          marks: resultData.marks,
        },
        metadata: resultWithMetadata.metadata,
      };
      result = dynamicDataResult as unknown as typeof result;
    }
  }
  
  const backendCallDuration = Date.now() - backendCallStart;
  
  console.log(`[API /data/all] 📡 Dynamic data call completed: ${backendCallDuration}ms`);
  // Use typed result for final access
  const finalResultTyped = result as { success?: boolean; error?: string; data?: unknown };
  console.log(`[API /data/all]   - Success: ${finalResultTyped.success || false}`);
  console.log(`[API /data/all]   - Error: ${finalResultTyped.error || "none"}`);
  
  if (finalResultTyped.success) {
    console.log(`[API /data/all] 📊 Dynamic data received:`);
    // Safely access nested data properties
    const dynamicResultData = finalResultTyped.data as { attendance?: unknown; marks?: unknown } | undefined;
    console.log(`[API /data/all]   - Attendance: ${dynamicResultData?.attendance ? "✓" : "✗"}`);
    console.log(`[API /data/all]   - Marks: ${dynamicResultData?.marks ? "✓" : "✗"}`);
    
    // Update user's semester, name, registration number, and department in database if available (fire and forget)
    const dynamicAttendanceData = finalResultTyped.data as { 
      attendance?: { 
        semester?: number;
        data?: { 
          metadata?: { 
            semester?: number;
            student_name?: string;
            registration_number?: string;
            department?: string;
          } 
        } 
      } 
    } | undefined;
    
    // Extract from direct semester field or data.metadata
    const semester = dynamicAttendanceData?.attendance?.semester || dynamicAttendanceData?.attendance?.data?.metadata?.semester;
    if (semester) {
      console.log(`[API /data/all] 📝 Semester found in response: ${semester}`);
      updateSemesterInDatabase(user_id, semester);
    } else {
      console.log(`[API /data/all] 📝 No semester data to update`);
      const checkAttendanceData = finalResultTyped.data as { attendance?: unknown } | undefined;
      console.log(`[API /data/all]   - Attendance data exists: ${checkAttendanceData?.attendance ? "✓" : "✗"}`);
    }
    
    const studentName = dynamicAttendanceData?.attendance?.data?.metadata?.student_name;
    if (studentName) {
      console.log(`[API /data/all] 📝 Name found in response: ${studentName}`);
      updateNameInDatabase(user_id, studentName);
    }
    
    const registrationNumber = dynamicAttendanceData?.attendance?.data?.metadata?.registration_number;
    if (registrationNumber) {
      console.log(`[API /data/all] 📝 Registration Number found in response: ${registrationNumber}`);
      updateRegistrationNumberInDatabase(user_id, registrationNumber);
    }
    
    const department = dynamicAttendanceData?.attendance?.data?.metadata?.department;
    if (department) {
      console.log(`[API /data/all] 📝 Department found in response: ${department}`);
      updateDepartmentInDatabase(user_id, department);
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
  const staticDataError = staticData ? (staticData as { error?: string }).error : undefined;
  const dynamicDataError = dynamicData ? (dynamicData as { error?: string }).error : undefined;
  
  if (!staticSuccess && !dynamicSuccess) {
    merged.error = `Both requests failed. Static: ${staticDataError || "Unknown"}, Dynamic: ${dynamicDataError || "Unknown"}`;
  } else if (!staticSuccess) {
    merged.error = `Static data failed: ${staticDataError || "Unknown"}`;
  } else if (!dynamicSuccess) {
    merged.error = `Dynamic data failed: ${dynamicDataError || "Unknown"}`;
  }
  
  return merged;
}

/**
 * Get user's semester from database
 */
async function getSemesterFromDatabase(user_id: string): Promise<number | null> {
  try {
    console.log(`[API /data/all] 🔍 Fetching semester from database for user: ${user_id}`);
    const dbStartTime = Date.now();
    
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("semester")
      .eq("id", user_id)
      .single();
    
    const dbDuration = Date.now() - dbStartTime;
    
    if (error) {
      console.warn(`[API /data/all] ⚠️  Database query failed (${dbDuration}ms)`);
      console.warn(`[API /data/all]   - Error: ${error.message}`);
      return null;
    }
    
    if (data && data.semester) {
      console.log(`[API /data/all] ✅ Semester fetched from database (${dbDuration}ms): ${data.semester}`);
      return data.semester;
    }
    
    console.log(`[API /data/all] ℹ️  No semester found in database for user`);
    return null;
  } catch (err) {
    console.error(`[API /data/all] ❌ Error fetching semester from DB:`);
    console.error(`[API /data/all]   - Error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
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
 * Capitalize name properly (first letter of each word)
 */
function capitalizeName(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Update user's name in database (fire and forget)
 */
async function updateNameInDatabase(user_id: string, name: string): Promise<void> {
  const formattedName = capitalizeName(name);
  console.log(`[API /data/all] 💾 Database name update started (fire-and-forget)`);
  console.log(`[API /data/all]   - User ID: ${user_id}`);
  console.log(`[API /data/all]   - Name: ${name} -> ${formattedName}`);
    
    // Fire and forget - don't wait for DB update
    (async () => {
      try {
      const dbStartTime = Date.now();
        const { data, error } = await supabaseAdmin
          .from("users")
          .update({ name: formattedName })
          .eq("id", user_id)
          .select();
      const dbDuration = Date.now() - dbStartTime;
        
        if (error) {
        console.error(`[API /data/all] ❌ Database name update failed (${dbDuration}ms)`);
        console.error(`[API /data/all]   - Error: ${error.message}`);
        console.error(`[API /data/all]   - Details: ${JSON.stringify(error)}`);
        } else {
        console.log(`[API /data/all] ✅ Database name update successful (${dbDuration}ms)`);
        console.log(`[API /data/all]   - Updated name to: ${formattedName}`);
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
 * Update user's registration number in database (fire and forget)
 */
async function updateRegistrationNumberInDatabase(user_id: string, registration_number: string): Promise<void> {
  console.log(`[API /data/all] 💾 Database registration_number update started (fire-and-forget)`);
  console.log(`[API /data/all]   - User ID: ${user_id}`);
  console.log(`[API /data/all]   - Registration Number: ${registration_number}`);
    
  (async () => {
    try {
      const dbStartTime = Date.now();
      const { data, error } = await supabaseAdmin
        .from("users")
        .update({ registration_number })
        .eq("id", user_id)
        .select();
      const dbDuration = Date.now() - dbStartTime;
      
      if (error) {
        console.error(`[API /data/all] ❌ Database registration_number update failed (${dbDuration}ms)`);
        console.error(`[API /data/all]   - Error: ${error.message}`);
      } else {
        console.log(`[API /data/all] ✅ Database registration_number update successful (${dbDuration}ms)`);
        console.log(`[API /data/all]   - Updated registration_number to: ${registration_number}`);
      }
    } catch (dbError) {
      console.error(`[API /data/all] ❌ Database exception:`);
      console.error(`[API /data/all]   - Error: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
    }
  })();
}

/**
 * Update user's department in database (fire and forget)
 */
async function updateDepartmentInDatabase(user_id: string, department: string): Promise<void> {
  console.log(`[API /data/all] 💾 Database department update started (fire-and-forget)`);
  console.log(`[API /data/all]   - User ID: ${user_id}`);
  console.log(`[API /data/all]   - Department: ${department}`);
    
  (async () => {
    try {
      const dbStartTime = Date.now();
      const { data, error } = await supabaseAdmin
        .from("users")
        .update({ department })
        .eq("id", user_id)
        .select();
      const dbDuration = Date.now() - dbStartTime;
      
      if (error) {
        console.error(`[API /data/all] ❌ Database department update failed (${dbDuration}ms)`);
        console.error(`[API /data/all]   - Error: ${error.message}`);
      } else {
        console.log(`[API /data/all] ✅ Database department update successful (${dbDuration}ms)`);
        console.log(`[API /data/all]   - Updated department to: ${department}`);
      }
    } catch (dbError) {
      console.error(`[API /data/all] ❌ Database exception:`);
      console.error(`[API /data/all]   - Error: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
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

