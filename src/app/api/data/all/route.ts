import { NextRequest, NextResponse } from "next/server";
import { fetchDataFromGoBackend, callBackendScraper } from '@/lib/scraperClient';
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requestQueueTracker } from "@/lib/requestQueue";
import { getSupabaseCache, getSupabaseCacheWithInfo, deleteSupabaseCache } from "@/lib/supabaseCache";
import { removeClientCache } from "@/lib/clientCache";
import { trackApiRequest, trackServerError } from "@/lib/analyticsServer";
import { transformGoBackendAttendance, transformGoBackendMarks } from "@/lib/dataTransformers";

/**
 * Unified data endpoint - Returns all data types in one call
 * POST /api/data/all
 * 
 * Features:
 * - Uses Python session persistence (no password needed)
 * 
 * Request body: { access_token: string, password?: string }
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
 *     ...
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
  let user_id: string | undefined;
  let session_id: string | undefined;
  
  try {
    // Parse request body
    const body = await request.json();
    const { access_token, password, force_refresh, types, session_id: bodySessionId } = body;
    session_id = bodySessionId;
    
    const forceRefresh = force_refresh === true || force_refresh === 'true';
    
    // Parse types parameter: can be string (comma-separated) or array, or undefined (all types)
    let requestedTypes: string[] | null = null;
    if (types) {
      if (typeof types === 'string') {
        requestedTypes = types.split(',').map(t => t.trim()).filter(t => t.length > 0);
      } else if (Array.isArray(types)) {
        requestedTypes = types.map(t => String(t).trim()).filter(t => t.length > 0);
      }
    }
    
    // Valid data types
    const validTypes = ['calendar', 'timetable', 'attendance', 'marks'];
    if (requestedTypes) {
      requestedTypes = requestedTypes.filter(t => validTypes.includes(t));
      if (requestedTypes.length === 0) {
        requestedTypes = null; // Invalid types, fetch all
      }
    }
    
    console.log("[API /data/all] 📋 Request parameters:");
    console.log("  - password_provided:", password ? "✓" : "✗");
    console.log("  - access_token_length:", access_token?.length || 0);
    console.log("  - force_refresh:", forceRefresh);
    console.log("  - requested_types:", requestedTypes || "all");
    console.log("  - session_id:", session_id || "none");

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

    // Determine which data types to fetch
    const shouldFetchCalendar = !requestedTypes || requestedTypes.includes('calendar');
    const shouldFetchTimetable = !requestedTypes || requestedTypes.includes('timetable');
    const shouldFetchAttendance = !requestedTypes || requestedTypes.includes('attendance');
    const shouldFetchMarks = !requestedTypes || requestedTypes.includes('marks');

    // Check Supabase cache only for requested data types (calendar is NOT cached, fetched from public.calendar table)
    console.log(`[API /data/all] 🔍 Checking Supabase cache...`);
    let timetableInfo: { data: unknown; expiresAt: Date | null; isAboutToExpire: boolean; minutesUntilExpiry: number | null } | null = null;
    let attendanceInfo: { data: unknown; expiresAt: Date | null; isAboutToExpire: boolean; minutesUntilExpiry: number | null } | null = null;
    let marksInfo: { data: unknown; expiresAt: Date | null; isAboutToExpire: boolean; minutesUntilExpiry: number | null } | null = null;
    
    if (shouldFetchTimetable) {
      try {
        timetableInfo = await getSupabaseCacheWithInfo(user_id, 'timetable', forceRefresh, session_id);
      } catch (error) {
        console.error(`[API /data/all] ❌ Error checking timetable cache:`, error);
        console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
        console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          console.error(`[API /data/all]   - Stack: ${error.stack}`);
        }
        timetableInfo = null;
      }
    }
    
    if (shouldFetchAttendance) {
      try {
        attendanceInfo = await getSupabaseCacheWithInfo(user_id, 'attendance', forceRefresh, session_id);
      } catch (error) {
        console.error(`[API /data/all] ❌ Error checking attendance cache:`, error);
        console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
        console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          console.error(`[API /data/all]   - Stack: ${error.stack}`);
        }
        attendanceInfo = null;
      }
    }
    
    if (shouldFetchMarks) {
      try {
        marksInfo = await getSupabaseCacheWithInfo(user_id, 'marks', forceRefresh, session_id);
      } catch (error) {
        console.error(`[API /data/all] ❌ Error checking marks cache:`, error);
        console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
        console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          console.error(`[API /data/all]   - Stack: ${error.stack}`);
        }
        marksInfo = null;
      }
    }

    // Safely extract cached data with null checks (only for requested types)
    // Note: Calendar is NOT cached, always fetched from public.calendar table
    const cachedTimetable = shouldFetchTimetable && (timetableInfo && timetableInfo.data) ? timetableInfo.data : null;
    let cachedAttendance = shouldFetchAttendance && (attendanceInfo && attendanceInfo.data) ? attendanceInfo.data : null;
    const cachedMarks = shouldFetchMarks && (marksInfo && marksInfo.data) ? marksInfo.data : null;
    
    // Track if we have expired cache (for fallback use, but still need to fetch fresh data)
    let hasExpiredAttendanceCache = false;
    
    // If attendance cache is expired (attendanceInfo is null but cache might exist), fetch expired cache for fallback
    if (shouldFetchAttendance && !cachedAttendance && !forceRefresh) {
      try {
        const { getSupabaseCacheEvenIfExpired } = await import('@/lib/supabaseCache');
        const expiredAttendance = await getSupabaseCacheEvenIfExpired(user_id, 'attendance');
        if (expiredAttendance) {
          cachedAttendance = expiredAttendance;
          hasExpiredAttendanceCache = true;
          console.log(`[API /data/all] ⚠️ Using expired attendance cache as fallback (stale-while-revalidate)`);
        }
      } catch (error) {
        console.error(`[API /data/all] ❌ Error fetching expired attendance cache:`, error);
      }
    }

    // Determine what needs to be fetched (only for requested types)
    // Calendar is always fetched from public.calendar table (not from cache or backend)
    // Note: If we only have expired cache (hasExpiredAttendanceCache), we still need to fetch fresh data
    const needTimetable = shouldFetchTimetable && (!cachedTimetable || forceRefresh);
    const needAttendance = shouldFetchAttendance && ((!cachedAttendance || hasExpiredAttendanceCache) || forceRefresh || (attendanceInfo && attendanceInfo.isAboutToExpire));
    const needMarks = shouldFetchMarks && (!cachedMarks || forceRefresh || (marksInfo && marksInfo.isAboutToExpire));
    const needStatic = needTimetable; // Calendar is not part of static fetch anymore
    const needDynamic = needAttendance || needMarks;
    
    // Count how many data types need fetching (calendar is always fetched from DB, not counted here)
    const missingCount = [needTimetable, needAttendance, needMarks].filter(Boolean).length;
    const allMissing = missingCount === 3;

    // If force refresh, clear caches first (similar to refresh endpoint)
    // Note: Calendar is NOT cached, so no need to clear it
    if (forceRefresh) {
      console.log(`[API /data/all] 🔄 Force refresh requested - clearing caches...`);
      try {
        if (needTimetable) {
          await deleteSupabaseCache(user_id, 'timetable');
          removeClientCache('timetable');
        }
        if (needAttendance) {
          await deleteSupabaseCache(user_id, 'attendance');
          removeClientCache('attendance');
        }
        if (needMarks) {
          await deleteSupabaseCache(user_id, 'marks');
          removeClientCache('marks');
        }
        console.log(`[API /data/all] 🗑️ Cleared caches for force refresh`);
      } catch (cacheError) {
        console.warn(`[API /data/all] ⚠️ Error clearing cache (continuing anyway):`, cacheError);
        console.warn(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
        console.warn(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
      }
    }

    console.log(`[API /data/all] 📊 Cache status:`);
    console.log(`[API /data/all]   - Calendar: Always fetched from public.calendar table (not cached)`);
    console.log(`[API /data/all]   - Timetable: ${cachedTimetable ? "✓ Cached" : "✗ Need fetch"}`);
    if (timetableInfo && timetableInfo.minutesUntilExpiry !== null) {
      console.log(`[API /data/all]     Expires in: ${timetableInfo.minutesUntilExpiry} minutes`);
    }
    console.log(`[API /data/all]   - Attendance: ${cachedAttendance ? "✓ Cached" : "✗ Need fetch"}`);
    if (attendanceInfo && attendanceInfo.minutesUntilExpiry !== null) {
      console.log(`[API /data/all]     Expires in: ${attendanceInfo.minutesUntilExpiry} minutes`);
      if (attendanceInfo.isAboutToExpire) {
        console.log(`[API /data/all]     ⚠️ About to expire! Triggering background prefetch...`);
      }
    }
    console.log(`[API /data/all]   - Marks: ${cachedMarks ? "✓ Cached" : "✗ Need fetch"}`);
    if (marksInfo && marksInfo.minutesUntilExpiry !== null) {
      console.log(`[API /data/all]     Expires in: ${marksInfo.minutesUntilExpiry} minutes`);
      if (marksInfo.isAboutToExpire) {
        console.log(`[API /data/all]     ⚠️ About to expire! Triggering background prefetch...`);
      }
    }

    // Trigger background prefetch for caches about to expire (non-blocking, only if not already fetching)
    if (!forceRefresh) {
      if (attendanceInfo && attendanceInfo.isAboutToExpire && cachedAttendance && !needAttendance) {
        console.log(`[API /data/all] 🔄 Triggering background prefetch for attendance...`);
        triggerBackgroundPrefetch(user_email, user_id, password, 'attendance').catch(err => {
          console.error(`[API /data/all] ❌ Background prefetch error for attendance:`);
          console.error(`[API /data/all]   - Error type: ${err instanceof Error ? err.constructor.name : typeof err}`);
          console.error(`[API /data/all]   - Error message: ${err instanceof Error ? err.message : String(err)}`);
          if (err instanceof Error && err.stack) {
            console.error(`[API /data/all]   - Stack: ${err.stack}`);
          }
        });
      }
      if (marksInfo && marksInfo.isAboutToExpire && cachedMarks && !needMarks) {
        console.log(`[API /data/all] 🔄 Triggering background prefetch for marks...`);
        triggerBackgroundPrefetch(user_email, user_id, password, 'marks').catch(err => {
          console.error(`[API /data/all] ❌ Background prefetch error for marks:`);
          console.error(`[API /data/all]   - Error type: ${err instanceof Error ? err.constructor.name : typeof err}`);
          console.error(`[API /data/all]   - Error message: ${err instanceof Error ? err.message : String(err)}`);
          if (err instanceof Error && err.stack) {
            console.error(`[API /data/all]   - Stack: ${err.stack}`);
          }
        });
      }
    }

    let staticData: Record<string, unknown> | null = null;
    let dynamicData: Record<string, unknown> | null = null;
    const backendStartTime = Date.now();
    let backendWasCalled = false; // Track if backend scraper was actually called (for api_request tracking)
    const backendCallReasons: string[] = []; // Track why backend was called (for logging)

    // NEW FLOW: Fetch individual data types sequentially (no unified endpoint)
    // Go backend updates Supabase and returns {success: true}, then we fetch from Supabase
    if (allMissing) {
      console.log(`[API /data/all] 🆕 New user detected (all data missing) - Fetching individual data types`);
      backendWasCalled = true;
      backendCallReasons.push('new user - fetching all data types individually');
      
      // Initialize data structures
      staticData = { success: true, data: {}, metadata: { source: 'go_backend_refresh' } };
      dynamicData = { success: true, data: {}, metadata: { source: 'go_backend_refresh' } };
      
      // Fetch all three data types sequentially
      const fetchPromises = [];
      
      if (needTimetable) {
        fetchPromises.push(
          callGoBackendForDataRefresh(user_email, user_id, password, 'timetable')
            .then(result => {
              if (result.success && result.data) {
                (staticData!.data as { timetable?: unknown }).timetable = result.data;
                console.log(`[API /data/all] ✅ Timetable fetched for new user`);
              } else {
                console.error(`[API /data/all] ❌ Timetable fetch failed: ${result.error}`);
              }
            })
            .catch(err => console.error(`[API /data/all] ❌ Timetable fetch error:`, err))
        );
      }
      
      if (needAttendance) {
        fetchPromises.push(
          callGoBackendForDataRefresh(user_email, user_id, password, 'attendance')
            .then(result => {
              if (result.success && result.data) {
                (dynamicData!.data as { attendance?: unknown }).attendance = result.data;
                console.log(`[API /data/all] ✅ Attendance fetched for new user`);
              } else {
                console.error(`[API /data/all] ❌ Attendance fetch failed: ${result.error}`);
              }
            })
            .catch(err => console.error(`[API /data/all] ❌ Attendance fetch error:`, err))
        );
      }
      
      if (needMarks) {
        fetchPromises.push(
          callGoBackendForDataRefresh(user_email, user_id, password, 'marks')
            .then(result => {
              if (result.success && result.data) {
                (dynamicData!.data as { marks?: unknown }).marks = result.data;
                console.log(`[API /data/all] ✅ Marks fetched for new user`);
              } else {
                console.error(`[API /data/all] ❌ Marks fetch failed: ${result.error}`);
              }
            })
            .catch(err => console.error(`[API /data/all] ❌ Marks fetch error:`, err))
        );
      }
      
      // Wait for all fetches to complete
      await Promise.all(fetchPromises);
    } else {
      // OPTIMIZATION: Only some data is missing - fetch only what's needed individually
      console.log(`[API /data/all] 🎯 Partial data missing (${missingCount} types) - Using individual fetch strategy`);

      // Initialize with cached data (only for requested types)
      // Note: Calendar is fetched from public.calendar table, not from cache
      staticData = {
        success: true,
        data: {
          ...(shouldFetchTimetable ? { timetable: cachedTimetable } : {}),
        },
        metadata: { source: 'supabase_cache' },
      };

      dynamicData = {
        success: true,
        data: {
          ...(shouldFetchAttendance ? { attendance: cachedAttendance } : {}),
          ...(shouldFetchMarks ? { marks: cachedMarks } : {}),
        },
        metadata: { source: 'supabase_cache' },
      };

      // Note: Calendar is NOT fetched from backend or cache, always from public.calendar table
      // Calendar will be fetched later after we determine user's course and semester

      // Fetch only timetable if needed
      if (needTimetable) {
        console.log(`[API /data/all] ⏳ Fetching only timetable...`);
        try {
          backendWasCalled = true;
          backendCallReasons.push(`timetable ${forceRefresh ? 'force refresh' : 'cache miss'}`);
          console.log(`[API /data/all] 🔄 Backend scraper call: Fetching timetable`);
          const timetableResult = await callGoBackendForDataRefresh(user_email, user_id, password, 'timetable');
          if (timetableResult.success && timetableResult.data) {
            (staticData.data as { timetable?: unknown }).timetable = timetableResult.data;
          }
        } catch (error) {
          console.error(`[API /data/all] ❌ Timetable fetch failed:`);
          console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
          console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error && error.stack) {
            console.error(`[API /data/all]   - Stack: ${error.stack}`);
          }
        }
      }

      // If both static types needed, fetch only timetable (calendar comes from public.calendar table)
      if (shouldFetchCalendar && needTimetable) {
        console.log(`[API /data/all] ⏳ Fetching timetable (calendar will come from public.calendar table)...`);
        try {
          backendWasCalled = true;
          backendCallReasons.push(`timetable ${forceRefresh ? 'force refresh' : 'cache miss'}`);
          console.log(`[API /data/all] 🔄 Backend scraper call: Fetching timetable`);
          const timetableResult = await callGoBackendForDataRefresh(user_email, user_id, password, 'timetable');
          if (timetableResult.success && timetableResult.data) {
            (staticData.data as { timetable?: unknown }).timetable = timetableResult.data;
          }
        } catch (error) {
          console.error(`[API /data/all] ❌ Timetable fetch failed:`);
          console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
          console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error && error.stack) {
            console.error(`[API /data/all]   - Stack: ${error.stack}`);
          }
        }
      }

      // Fetch only attendance if needed
      if (needAttendance && !needMarks) {
        console.log(`[API /data/all] ⏳ Fetching only attendance...`);
        try {
          backendWasCalled = true;
          backendCallReasons.push(`attendance ${forceRefresh ? 'force refresh' : 'cache miss/expired'}`);
          console.log(`[API /data/all] 🔄 Backend scraper call: Fetching attendance`);
          const attendanceResult = await callGoBackendForDataRefresh(user_email, user_id, password, 'attendance');
          if (attendanceResult.success && attendanceResult.data) {
            // Transform Go backend format to frontend format
            const transformedAttendance = transformGoBackendAttendance(attendanceResult.data);
            (dynamicData.data as { attendance?: unknown }).attendance = transformedAttendance;
          }
        } catch (error) {
          console.error(`[API /data/all] ❌ Attendance fetch failed:`);
          console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
          console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error && error.stack) {
            console.error(`[API /data/all]   - Stack: ${error.stack}`);
          }
        }
      }

      // Fetch only marks if needed
      if (needMarks && !needAttendance) {
        console.log(`[API /data/all] ⏳ Fetching only marks...`);
        try {
          backendWasCalled = true;
          backendCallReasons.push(`marks ${forceRefresh ? 'force refresh' : 'cache miss/expired'}`);
          console.log(`[API /data/all] 🔄 Backend scraper call: Fetching marks`);
          const marksResult = await callGoBackendForDataRefresh(user_email, user_id, password, 'marks');
          if (marksResult.success && marksResult.data) {
            // Transform Go backend format to frontend format
            const transformedMarks = transformGoBackendMarks(marksResult.data);
            (dynamicData.data as { marks?: unknown }).marks = transformedMarks;
          }
        } catch (error) {
          console.error(`[API /data/all] ❌ Marks fetch failed:`);
          console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
          console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error && error.stack) {
            console.error(`[API /data/all]   - Stack: ${error.stack}`);
          }
        }
      }

      // If both dynamic types needed, fetch them individually (NEW FLOW)
      if (needAttendance && needMarks) {
        console.log(`[API /data/all] ⏳ Fetching dynamic data (attendance + marks) individually...`);
        backendWasCalled = true;
        backendCallReasons.push(`dynamic data (attendance+marks) ${forceRefresh ? 'force refresh' : 'cache miss/expired'}`);
        
        // Fetch both in parallel
        const fetchPromises = [
          callGoBackendForDataRefresh(user_email, user_id, password, 'attendance'),
          callGoBackendForDataRefresh(user_email, user_id, password, 'marks')
        ];
        
        const [attendanceResult, marksResult] = await Promise.all(fetchPromises);
        
        if (attendanceResult.success && attendanceResult.data) {
          (dynamicData.data as { attendance?: unknown }).attendance = attendanceResult.data;
          console.log(`[API /data/all] ✅ Attendance fetched`);
        } else {
          console.error(`[API /data/all] ❌ Attendance fetch failed: ${attendanceResult.error}`);
        }
        
        if (marksResult.success && marksResult.data) {
          (dynamicData.data as { marks?: unknown }).marks = marksResult.data;
          console.log(`[API /data/all] ✅ Marks fetched`);
        } else {
          console.error(`[API /data/all] ❌ Marks fetch failed: ${marksResult.error}`);
        }
      }
    }
    
    const backendDuration = Date.now() - backendStartTime;
    console.log(`[API /data/all] 🔄 Data fetch completed: ${backendDuration}ms total`);
    
    // Merge results (combine cached and fresh data) - only include requested types
    const result = mergeSplitDataResults(staticData, dynamicData, {
      shouldFetchCalendar,
      shouldFetchTimetable,
      shouldFetchAttendance,
      shouldFetchMarks,
      cachedTimetable,
      cachedAttendance,
      cachedMarks,
    });
    
    console.log(`[API /data/all] 📊 Merged result:`);
    const mergedResultTyped = result as { success?: boolean };
    console.log(`[API /data/all]   - Overall success: ${mergedResultTyped.success || false}`);
    
    // Safely access merged result data properties (only log requested types)
    const mergedData = result.data as { 
      calendar?: unknown; 
      timetable?: unknown; 
      attendance?: unknown; 
      marks?: unknown 
    } | undefined;
    if (shouldFetchCalendar) {
      console.log(`[API /data/all]   - Calendar: ${mergedData?.calendar ? "✓" : "✗"}`);
    }
    if (shouldFetchTimetable) {
      console.log(`[API /data/all]   - Timetable: ${mergedData?.timetable ? "✓" : "✗"}`);
    }
    if (shouldFetchAttendance) {
      console.log(`[API /data/all]   - Attendance: ${mergedData?.attendance ? "✓" : "✗"}`);
    }
    if (shouldFetchMarks) {
      console.log(`[API /data/all]   - Marks: ${mergedData?.marks ? "✓" : "✗"}`);
    }
    
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

    // Try to get semester and course from attendance data first, fallback to database
    let semesterFromAttendance: number | null = null;
    let courseFromAttendance: string | null = null;
    const attendanceData = (result.data as { attendance?: { semester?: number; data?: { metadata?: { semester?: number; department?: string } } } })?.attendance;
    if (attendanceData?.semester) {
      semesterFromAttendance = attendanceData.semester;
    } else if (attendanceData?.data?.metadata?.semester) {
      semesterFromAttendance = attendanceData.data.metadata.semester;
    }
    
    // Extract course from department field (BTech/MTech)
    if (attendanceData?.data?.metadata?.department) {
      const department = attendanceData.data.metadata.department;
      // Map department to course (e.g., "Computer Science" -> "BTech", "M.Tech" -> "MTech")
      if (department.toLowerCase().includes('m.tech') || department.toLowerCase().includes('mtech')) {
        courseFromAttendance = 'MTech';
      } else {
        courseFromAttendance = 'BTech'; // Default to BTech
      }
      console.log(`[API /data/all] ✅ Course from attendance: ${courseFromAttendance} (from department: ${department})`);
    }
    
    // If no semester from attendance and attendance failed, fetch from database
    let semester: number | null = semesterFromAttendance;
    if (!semester) {
      console.log(`[API /data/all] 🔍 No semester from attendance, fetching from database...`);
      semester = await getSemesterFromDatabase(user_id);
    } else {
      console.log(`[API /data/all] ✅ Semester from attendance: ${semester}`);
    }
    
    // Fetch calendar from public.calendar table (ALWAYS, not from Supabase cache or backend)
    // Calendar is fetched based on user's program and semester from public.users table
    console.log(`[API /data/all] 📋 CALENDAR FETCH DEBUG - Starting calendar fetch process`);
    console.log(`[API /data/all]   - Course from attendance: ${courseFromAttendance || 'none'}`);
    console.log(`[API /data/all]   - Semester from attendance: ${semesterFromAttendance || 'none'}`);
    
    // Declare course variable outside if block for use later
    let course: string = courseFromAttendance || 'BTech'; // Default to BTech
    
    if (shouldFetchCalendar) {
      // Fetch user's program and semester from public.users table
      console.log(`[API /data/all] 🔍 Fetching user's program and semester from public.users table...`);
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('program, semester')
        .eq('id', user_id)
        .single();
      
      let programForCalendar: string | null = null;
      let semesterForCalendar: number | null = null;
      
      if (!userError && userData) {
        programForCalendar = userData.program || null;
        semesterForCalendar = userData.semester || null;
        console.log(`[API /data/all]   - Program from database: ${programForCalendar || 'none'}`);
        console.log(`[API /data/all]   - Semester from database: ${semesterForCalendar || 'none'}`);
      } else {
        console.warn(`[API /data/all] ⚠️ Error fetching user data: ${userError?.message || 'Unknown error'}`);
        // Fallback to attendance data or defaults
        semesterForCalendar = semesterFromAttendance;
        // Convert to program format (B.Tech, M.Tech) if coming from attendance
        if (courseFromAttendance === 'BTech' || courseFromAttendance === 'MTech') {
          programForCalendar = courseFromAttendance === 'BTech' ? 'B.Tech' : 'M.Tech';
        } else {
          programForCalendar = courseFromAttendance || 'B.Tech';
        }
      }
      
      // If semester not in database, try attendance data
      if (!semesterForCalendar) {
        semesterForCalendar = semesterFromAttendance;
        if (!semesterForCalendar) {
          console.log(`[API /data/all] 🔍 Semester not in database, fetching from database...`);
        semesterForCalendar = await getSemesterFromDatabase(user_id);
          console.log(`[API /data/all]   - Semester from database (fallback): ${semesterForCalendar || 'none'}`);
      }
      }
      
      // If program not in database, use course from attendance or default to "B.Tech"
      if (!programForCalendar) {
        // Convert attendance course format to program format if needed
        if (courseFromAttendance === 'BTech' || courseFromAttendance === 'MTech') {
          programForCalendar = courseFromAttendance === 'BTech' ? 'B.Tech' : 'M.Tech';
        } else {
          programForCalendar = courseFromAttendance || 'B.Tech';
        }
        console.log(`[API /data/all]   - Program fallback: ${programForCalendar}`);
      }
      
      // Preserve program format (e.g., "B.Tech", "M.Tech") but convert to database format for querying
      // Calendar table uses "BTech"/"MTech" format (without dot)
      const programFormatted = programForCalendar || 'B.Tech';
      
      // Convert to database format for calendar table query
      if (programFormatted.toLowerCase().includes('b.tech') || programFormatted.toLowerCase().includes('btech')) {
        course = 'BTech';
      } else if (programFormatted.toLowerCase().includes('m.tech') || programFormatted.toLowerCase().includes('mtech')) {
        course = 'MTech';
      } else {
        course = 'BTech'; // Default fallback
      }
      
      console.log(`[API /data/all]   - Program (preserved format): ${programFormatted}`);
      console.log(`[API /data/all]   - Course (for database query): ${course}`);
      
      if (semesterForCalendar !== null && semesterForCalendar !== undefined) {
        try {
          console.log(`[API /data/all] 🔍 ========================================`);
          console.log(`[API /data/all] 🔍 CALENDAR FETCH: Attempting to fetch from public.calendar`);
          console.log(`[API /data/all] 🔍   - Program from users table: "${programForCalendar}"`);
          console.log(`[API /data/all] 🔍   - Course (mapped): "${course}"`);
          console.log(`[API /data/all] 🔍   - Semester: ${semesterForCalendar}`);
          console.log(`[API /data/all] 🔍   - User ID: ${user_id}`);
          console.log(`[API /data/all] 🔍 ========================================`);
          
          // First, try to get calendar for specific course and semester
          let calendarDbData = null;
          let recordSource = 'none';
          
          const { data: specificCalendarData, error: specificError } = await supabaseAdmin
            .from('calendar')
            .select('data')
            .eq('course', course)
            .eq('semester', semesterForCalendar)
            .single();
          
          console.log(`[API /data/all] 🔍 Query result for course="${course}", semester=${semesterForCalendar}:`);
          console.log(`[API /data/all]   - Has data: ${!!specificCalendarData}`);
          console.log(`[API /data/all]   - Has error: ${!!specificError}`);
          if (specificError) {
            console.log(`[API /data/all]   - Error code: ${specificError.code}`);
            console.log(`[API /data/all]   - Error message: ${specificError.message}`);
          }
          
          if (!specificError && specificCalendarData && specificCalendarData.data) {
            calendarDbData = specificCalendarData;
            recordSource = `course="${course}", semester=${semesterForCalendar}`;
            console.log(`[API /data/all] ✅ ✅ ✅ CALENDAR FOUND: Using record ${recordSource}`);
            console.log(`[API /data/all]   - Data type: ${typeof specificCalendarData.data}`);
            console.log(`[API /data/all]   - Is array: ${Array.isArray(specificCalendarData.data)}`);
            if (Array.isArray(specificCalendarData.data)) {
              console.log(`[API /data/all]   - Array length: ${specificCalendarData.data.length}`);
              if (specificCalendarData.data.length > 0) {
                console.log(`[API /data/all]   - First event sample:`, JSON.stringify(specificCalendarData.data[0], null, 2).substring(0, 200));
              }
            } else if (typeof specificCalendarData.data === 'object') {
              console.log(`[API /data/all]   - Object keys:`, Object.keys(specificCalendarData.data));
            }
          } else if (specificError && specificError.code === 'PGRST116') {
            // Not found for specific course/semester, try fallback: course='Default', semester=0
            console.log(`[API /data/all] ℹ️ Record not found for course="${course}", semester=${semesterForCalendar}`);
            console.log(`[API /data/all] 🔍 Trying fallback: course="Default", semester=0`);

            const { data: fallbackCalendarData, error: fallbackError } = await supabaseAdmin
              .from('calendar')
              .select('data')
              .eq('course', 'Default')
              .eq('semester', 0)
              .single();
            
            console.log(`[API /data/all] 🔍 Fallback query result:`);
            console.log(`[API /data/all]   - Has data: ${!!fallbackCalendarData}`);
            console.log(`[API /data/all]   - Has error: ${!!fallbackError}`);
            if (fallbackError) {
              console.log(`[API /data/all]   - Error code: ${fallbackError.code}`);
              console.log(`[API /data/all]   - Error message: ${fallbackError.message}`);
            }
            
            if (!fallbackError && fallbackCalendarData && fallbackCalendarData.data) {
              calendarDbData = fallbackCalendarData;
              recordSource = 'course="Default", semester=0 (FALLBACK)';
              console.log(`[API /data/all] ✅ ✅ ✅ CALENDAR FOUND: Using FALLBACK record ${recordSource}`);
              console.log(`[API /data/all]   - Data type: ${typeof fallbackCalendarData.data}`);
              console.log(`[API /data/all]   - Is array: ${Array.isArray(fallbackCalendarData.data)}`);
              if (Array.isArray(fallbackCalendarData.data)) {
                console.log(`[API /data/all]   - Array length: ${fallbackCalendarData.data.length}`);
                if (fallbackCalendarData.data.length > 0) {
                  console.log(`[API /data/all]   - First event sample:`, JSON.stringify(fallbackCalendarData.data[0], null, 2).substring(0, 200));
                }
              } else if (typeof fallbackCalendarData.data === 'object') {
                console.log(`[API /data/all]   - Object keys:`, Object.keys(fallbackCalendarData.data));
              }
            } else if (fallbackError && fallbackError.code === 'PGRST116') {
              console.log(`[API /data/all] ⚠️ ⚠️ ⚠️ No calendar found in database (neither specific nor fallback)`);
              console.log(`[API /data/all]   - Tried: course="${course}", semester=${semesterForCalendar}`);
              console.log(`[API /data/all]   - Tried fallback: course="default", semester=0`);
            } else if (fallbackError) {
              console.warn(`[API /data/all] ⚠️ Error fetching fallback calendar from database: ${fallbackError.message}`);
            }
          } else if (specificError) {
            console.warn(`[API /data/all] ⚠️ Error fetching calendar from database: ${specificError.message}`);
            console.warn(`[API /data/all]   - Error code: ${specificError.code}`);
          }
          
          // Add calendar to result if fetched
          if (calendarDbData && calendarDbData.data) {
            console.log(`[API /data/all] ✅ ✅ ✅ FINAL: Calendar data being added to response`);
            console.log(`[API /data/all]   - Source record: ${recordSource}`);
            console.log(`[API /data/all]   - Data structure: ${typeof calendarDbData.data}`);
            console.log(`[API /data/all]   - Is array: ${Array.isArray(calendarDbData.data)}`);
            if (Array.isArray(calendarDbData.data)) {
              console.log(`[API /data/all]   - Total events: ${calendarDbData.data.length}`);
            }
            
            if (!result.data || typeof result.data !== 'object') {
              result.data = {};
            }
            // Transform calendar data from nested format to flat array format expected by frontend
            let calendarDataForResponse: any[] = [];

            console.log(`[API /data/all] 🔍 DEBUG: Raw calendar data structure:`);
            console.log(`[API /data/all]   - Type: ${typeof calendarDbData.data}`);
            console.log(`[API /data/all]   - Is array: ${Array.isArray(calendarDbData.data)}`);
            console.log(`[API /data/all]   - Keys (if object):`, typeof calendarDbData.data === 'object' && !Array.isArray(calendarDbData.data) ? Object.keys(calendarDbData.data) : 'N/A');
            if (calendarDbData.data && typeof calendarDbData.data === 'object' && !Array.isArray(calendarDbData.data)) {
              console.log(`[API /data/all]   - Has 'calendar' key: ${'calendar' in calendarDbData.data}`);
              if ('calendar' in calendarDbData.data) {
                const cal = (calendarDbData.data as any).calendar;
                console.log(`[API /data/all]   - calendar is array: ${Array.isArray(cal)}`);
                console.log(`[API /data/all]   - calendar length: ${Array.isArray(cal) ? cal.length : 'N/A'}`);
                if (Array.isArray(cal) && cal.length > 0) {
                  console.log(`[API /data/all]   - First month sample:`, JSON.stringify(cal[0], null, 2).substring(0, 300));
                }
              }
            }

            // Check if this is the new nested calendar structure
            if (calendarDbData.data && typeof calendarDbData.data === 'object' && !Array.isArray(calendarDbData.data)) {
              const calendarObj = calendarDbData.data as { calendar?: unknown };

              if (calendarObj.calendar && Array.isArray(calendarObj.calendar)) {
                console.log(`[API /data/all] 🔄 Processing calendar array`);

                // Check if calendar array contains individual day events or nested month objects
                const firstItem = calendarObj.calendar[0];
                if (firstItem && typeof firstItem === 'object' && firstItem.date && firstItem.month) {
                  // This is already flat day events format, normalize field names
                  console.log(`[API /data/all] 📅 Calendar data is already flat day events format`);
                  const normalizedEvents = calendarObj.calendar.map((dayObj: any) => {
                    if (!dayObj || typeof dayObj !== 'object') {
                      console.log(`[API /data/all]   - Skipping invalid day object:`, dayObj);
                      return null;
                    }

                    return {
                      date: dayObj.date,
                      day_name: dayObj.day_name || 'Mon',
                      event: dayObj.event || null,
                      day_order: dayObj.day_order || '-',
                      month: dayObj.month,
                      month_name: dayObj.month,
                      year: dayObj.year || '',
                    };
                  }).filter((event: any) => event !== null);

                  calendarDataForResponse = normalizedEvents;
                  console.log(`[API /data/all] ✅ Processed calendar: ${normalizedEvents.length} events`);
                } else {
                  // This is the old nested month structure, transform it
                  console.log(`[API /data/all] 🔄 Transforming nested calendar structure to flat array`);

                  // Transform nested structure to flat array
                  const flatCalendarEvents = calendarObj.calendar.flatMap((monthObj: any) => {
                    console.log(`[API /data/all]   - Processing month:`, monthObj?.month || 'undefined');

                    if (!monthObj || !monthObj.month || !monthObj.days || !Array.isArray(monthObj.days)) {
                      console.log(`[API /data/all]   - Skipping invalid month object:`, monthObj);
                      return [];
                    }

                    console.log(`[API /data/all]   - Month has ${monthObj.days.length} days`);

                    return monthObj.days.map((day: any) => {
                      if (!day || typeof day !== 'object') {
                        console.log(`[API /data/all]   - Skipping invalid day object:`, day);
                        return null;
                      }

                      const event = {
                        date: `${day.date || '01'}/${monthObj.month}`,
                        day_name: day.day || 'Mon',
                        event: day.event || null, // Use 'event' field from stored data
                        day_order: day.dayOrder || '-',
                        month: monthObj.month,
                        month_name: monthObj.month.split(' ')[0] || '',
                        year: monthObj.month.split(' ')[1] || '',
                      };

                      console.log(`[API /data/all]   - Created event: ${event.date} - ${event.event || 'no content'}`);
                      return event;
                    }).filter((event: any) => event !== null);
                  });

                  calendarDataForResponse = flatCalendarEvents;
                  console.log(`[API /data/all] ✅ Transformed calendar: ${flatCalendarEvents.length} events`);
                }
              } else {
                console.log(`[API /data/all] ⚠️ Calendar object exists but no valid calendar array found`);
              }
            } else if (Array.isArray(calendarDbData.data)) {
              // Calendar data is already a flat array, normalize field names
              console.log(`[API /data/all] 📅 Calendar data is flat array, normalizing field names`);
              const normalizedEvents = calendarDbData.data.map((dayObj: any) => {
                if (!dayObj || typeof dayObj !== 'object') {
                  console.log(`[API /data/all]   - Skipping invalid day object:`, dayObj);
                  return null;
                }

                return {
                  date: dayObj.date,
                  day_name: dayObj.day_name || 'Mon',
                  event: dayObj.event || null,
                  day_order: dayObj.day_order || '-',
                  month: dayObj.month,
                  month_name: dayObj.month,
                  year: dayObj.year || '',
                };
              }).filter((event: any) => event !== null);

              calendarDataForResponse = normalizedEvents;
              console.log(`[API /data/all] ✅ Normalized calendar: ${normalizedEvents.length} events`);
            } else {
              console.log(`[API /data/all] ⚠️ Calendar data structure not recognized`);
            }

            (result.data as { calendar?: unknown }).calendar = calendarDataForResponse;
            
            console.log(`[API /data/all] ✅ Calendar successfully added to result.data.calendar`);
            console.log(`[API /data/all]   - result.data.calendar type: ${typeof (result.data as { calendar?: unknown }).calendar}`);
            console.log(`[API /data/all]   - result.data.calendar is array: ${Array.isArray((result.data as { calendar?: unknown }).calendar)}`);
          } else {
            console.warn(`[API /data/all] ⚠️ ⚠️ ⚠️ No calendar data available from public.calendar table`);
            console.warn(`[API /data/all]   - calendarDbData: ${calendarDbData ? 'exists' : 'null'}`);
            if (calendarDbData) {
              console.warn(`[API /data/all]   - calendarDbData.data: ${calendarDbData.data ? 'exists' : 'null'}`);
            }
            // Set empty array as fallback so frontend knows calendar data was processed
            (result.data as { calendar?: unknown }).calendar = [];
          }
          console.log(`[API /data/all] 🔍 ========================================`);
        } catch (err) {
          console.error(`[API /data/all] ❌ ❌ ❌ ERROR fetching calendar from database:`, err);
          console.error(`[API /data/all]   - Error type: ${err instanceof Error ? err.constructor.name : typeof err}`);
          console.error(`[API /data/all]   - Error message: ${err instanceof Error ? err.message : String(err)}`);
          if (err instanceof Error && err.stack) {
            console.error(`[API /data/all]   - Stack: ${err.stack}`);
          }
        }
      } else {
        console.log(`[API /data/all] ℹ️ Semester not available yet, skipping calendar fetch`);
        console.log(`[API /data/all]   - semesterForCalendar: ${semesterForCalendar}`);
      }
    } else {
      console.log(`[API /data/all] ℹ️ Calendar fetch skipped (shouldFetchCalendar: false)`);
    }
    
    // Include semester and course in response metadata
    const resultTyped = result as { success?: boolean; metadata?: { semester?: number; course?: string; queue_info?: unknown; [key: string]: unknown }; semester?: number; course?: string };
    if (resultTyped.metadata) {
      if (semester) {
        resultTyped.metadata.semester = semester;
        console.log(`[API /data/all] 📝 Added semester to response metadata: ${semester}`);
      }
      if (course) {
        resultTyped.metadata.course = course;
        console.log(`[API /data/all] 📝 Added course to response metadata: ${course}`);
      }
      // Get queue info
      const queueInfo = requestQueueTracker.getQueueInfo(user_email);
      resultTyped.metadata.queue_info = queueInfo;
    } else if (semester || course) {
      // Create metadata if it doesn't exist
      const queueInfo = requestQueueTracker.getQueueInfo(user_email);
      resultTyped.metadata = { 
        ...(semester ? { semester } : {}),
        ...(course ? { course } : {}),
        queue_info: queueInfo 
      };
    } else {
      // Create metadata with queue info
      const queueInfo = requestQueueTracker.getQueueInfo(user_email);
      resultTyped.metadata = { queue_info: queueInfo };
    }
    
    // Also add semester and course at root level for easy access
    if (semester) {
      (result as { semester?: number }).semester = semester;
    }
    if (course) {
      (result as { course?: string }).course = course;
    }

    const totalTime = Date.now() - requestStartTime;
    const finalResultTyped = result as { success?: boolean };
    console.log(`[API /data/all] ✅ Response sent (${totalTime}ms total)`);
    console.log(`[API /data/all]   - Status: ${finalResultTyped.success ? 200 : 500}`);
    console.log(`[API /data/all]   - Semester in response: ${semester || 'none'}`);
    console.log(`[API /data/all]   - Course in response: ${course || 'none'}`);
    console.log("===========================================");

    // Track API request if backend scraper was actually called (force refresh or cache miss)
    if (backendWasCalled) {
      const backendDuration = Date.now() - backendStartTime;
      console.log(`[API /data/all] 📊 Backend scraper was called - tracking api_request event`);
      console.log(`[API /data/all]   - Backend duration: ${backendDuration}ms`);
      console.log(`[API /data/all]   - Success: ${finalResultTyped.success ?? false}`);
      console.log(`[API /data/all]   - Reasons: ${backendCallReasons.join(', ')}`);
      // Track API request (async, non-blocking) - this represents a backend scraper call
      void trackApiRequest('/api/data/all', user_id, 'all', backendDuration, finalResultTyped.success ?? false, undefined, undefined, session_id);
    } else {
      console.log(`[API /data/all] 📊 No backend scraper call - all data from cache (no api_request event)`);
      console.log(`[API /data/all]   - Only cache_hit events will be tracked`);
    }

    // Ensure result is a valid object before returning
    if (!result || typeof result !== 'object') {
      console.error(`[API /data/all] ❌ Invalid result object, returning error response`);
      return NextResponse.json(
        {
          success: false,
          error: "Invalid response data",
          data: null
        },
        { status: 500 }
      );
    }
    
    // Ensure result has required structure
    const safeResult = {
      success: finalResultTyped.success ?? false,
      data: (result as { data?: unknown }).data ?? {},
      error: (result as { error?: string }).error,
      metadata: (result as { metadata?: unknown }).metadata ?? {},
      ...(result as Record<string, unknown>)
    };
    
    // Return the unified data
    return NextResponse.json(safeResult, { status: finalResultTyped.success ? 200 : 500 });

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
    
    // Track error (async, non-blocking) - safely handle undefined variables
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.constructor.name : typeof error;
    
    // Safely track errors (handle undefined user_id and session_id)
    try {
      void trackServerError(errorMessage, errorType, user_id || undefined, '/api/data/all', session_id || undefined);
      void trackApiRequest('/api/data/all', user_id || undefined, 'all', totalTime, false, undefined, undefined, session_id || undefined);
    } catch (trackError) {
      console.error(`[API /data/all] ❌ Error tracking failed:`, trackError);
      // Continue even if tracking fails
    }
    
    // Always return a valid JSON response, even on error
    try {
      return NextResponse.json(
        {
          success: false,
          error: "Internal server error",
          details: errorMessage,
          data: null
        },
        { status: 500 }
      );
    } catch (jsonError) {
      // If even JSON creation fails, return a minimal response
      console.error(`[API /data/all] ❌ Failed to create JSON response:`, jsonError);
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: "Internal server error",
          details: "Failed to serialize error response"
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  } finally {
    // Unregister request from queue tracker
    if (user_email) {
      requestQueueTracker.unregisterRequest(user_email);
    }
  }
}

/**
 * Call backend scraper to get only attendance and marks
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
      user_id,
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
 * Call Go backend to refresh individual data type (NEW FLOW)
 * Sends POST request to trigger refresh, then fetches from Supabase
 */
async function callGoBackendForDataRefresh(
  email: string,
  user_id: string,
  password: string | undefined,
  dataType: 'attendance' | 'marks' | 'timetable'
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  console.log(`[API /data/all] 🔄 NEW FLOW: Triggering ${dataType} refresh via Go backend`);
  console.log(`[API /data/all]   - Email: ${email}`);
  console.log(`[API /data/all]   - User ID: ${user_id}`);
  console.log(`[API /data/all]   - Data type: ${dataType}`);
  console.log(`[API /data/all]   - Password: ${password ? "✓ Provided" : "✗ Not provided"}`);
  
  if (!password) {
    console.error(`[API /data/all] ❌ Password is required for data refresh`);
    return {
      success: false,
      error: 'Password is required for data refresh',
    };
  }
  
  const backendCallStart = Date.now();
  
  try {
    // Step 1: Call Go backend to trigger refresh
    const result = await fetchDataFromGoBackend(dataType, user_id, email, password);
    
    const backendCallDuration = Date.now() - backendCallStart;
    
    console.log(`[API /data/all] 📡 ${dataType} refresh call completed: ${backendCallDuration}ms`);
    console.log(`[API /data/all]   - Success: ${result.success}`);
    console.log(`[API /data/all]   - Error: ${result.error || "none"}`);
    console.log(`[API /data/all]   - Data received: ${result.data ? "✓" : "✗"}`);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Go backend refresh failed',
      };
    }

    // Step 2: Store the data from Go backend to Supabase cache
    if (result.data) {
      console.log(`[API /data/all] 💾 Storing ${dataType} data to Supabase cache...`);
      const { setSupabaseCache } = await import('@/lib/supabaseCache');
      const cacheSaved = await setSupabaseCache(user_id, dataType, result.data);
      if (cacheSaved) {
        console.log(`[API /data/all] ✅ ${dataType} data stored in cache`);
      } else {
        console.warn(`[API /data/all] ⚠️ Failed to store ${dataType} data in cache, but continuing`);
      }
    }

    // Return the data directly from the backend response
    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    const backendCallDuration = Date.now() - backendCallStart;
    console.error(`[API /data/all] ❌ ${dataType} refresh error (${backendCallDuration}ms):`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
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
    user_id,
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
      user_id,
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
    user_id,
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
      user_id,
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
 * Only includes requested data types in the response
 */
function mergeSplitDataResults(
  staticData: Record<string, unknown> | null,
  dynamicData: Record<string, unknown> | null,
  options?: {
    shouldFetchCalendar?: boolean;
    shouldFetchTimetable?: boolean;
    shouldFetchAttendance?: boolean;
    shouldFetchMarks?: boolean;
    cachedTimetable?: unknown;
    cachedAttendance?: unknown;
    cachedMarks?: unknown;
  }
): Record<string, unknown> {
  const staticSuccess = staticData && staticData.success;
  const dynamicSuccess = dynamicData && dynamicData.success;
  const calendarSuccess = options?.shouldFetchCalendar ?? false; // Calendar is always successful when requested (fetched from DB)
  const overallSuccess = staticSuccess || dynamicSuccess || calendarSuccess;
  
  const shouldFetchCalendar = options?.shouldFetchCalendar ?? true;
  const shouldFetchTimetable = options?.shouldFetchTimetable ?? true;
  const shouldFetchAttendance = options?.shouldFetchAttendance ?? true;
  const shouldFetchMarks = options?.shouldFetchMarks ?? true;
  
  console.log(`[API /data/all] 🔗 Merging split data results`);
  console.log(`[API /data/all]   - Static data success: ${staticSuccess}`);
  console.log(`[API /data/all]   - Dynamic data success: ${dynamicSuccess}`);
  console.log(`[API /data/all]   - Overall success: ${overallSuccess}`);
  console.log(`[API /data/all]   - Including: calendar=${shouldFetchCalendar}, timetable=${shouldFetchTimetable}, attendance=${shouldFetchAttendance}, marks=${shouldFetchMarks}`);
  
  // Build data object only with requested types
  const dataObject: Record<string, unknown> = {};
  
  if (shouldFetchCalendar) {
    // Calendar should NOT come from staticData (backend scraper)
    // It will be fetched from public.calendar table later in the API route
    dataObject.calendar = null;
  }
  
  if (shouldFetchTimetable) {
    // Try to get timetable from staticData first, then fallback to cached data
    const timetableFromStatic = (staticData?.data as { timetable?: unknown } | undefined)?.timetable;
    if (timetableFromStatic) {
      dataObject.timetable = timetableFromStatic;
    } else if (options?.cachedTimetable) {
      // Use cached timetable - handle wrapped format: {data: {timetable: {...}, time_slots: [...], ...}, type: 'timetable', ...}
      const cached = options.cachedTimetable;
      if (typeof cached === 'object' && cached !== null) {
        // Check if cached data has 'data' property with timetable structure (API response format)
        if ('data' in cached && typeof (cached as { data?: unknown }).data === 'object' && (cached as { data?: unknown }).data !== null) {
          const cachedData = (cached as { data?: { timetable?: unknown; time_slots?: unknown; slot_mapping?: unknown } }).data;
          // Extract the data object which has the correct TimetableData structure
          dataObject.timetable = cachedData;
          console.log(`[API /data/all] ✅ Using cached timetable from wrapped format (extracted from data property)`);
        }
        // Check if cached data has 'timetable' property directly (direct format)
        else if ('timetable' in cached) {
          dataObject.timetable = (cached as { timetable?: unknown }).timetable;
          console.log(`[API /data/all] ✅ Using cached timetable from direct format`);
        }
        // Cached data is already in timetable format (has timetable, time_slots, slot_mapping at root)
        else if ('timetable' in cached || 'time_slots' in cached) {
          dataObject.timetable = cached;
          console.log(`[API /data/all] ✅ Using cached timetable as-is (already in correct format)`);
        } else {
          dataObject.timetable = null;
          console.warn(`[API /data/all] ⚠️ Cached timetable has unexpected structure`);
        }
      } else {
        dataObject.timetable = cached;
      }
    } else {
      dataObject.timetable = null;
    }
  }
  
  if (shouldFetchAttendance) {
    // Get attendance from dynamicData first, then fallback to cached data
    const attendanceFromDynamic = (dynamicData?.data as { attendance?: unknown } | undefined)?.attendance;
    if (attendanceFromDynamic && attendanceFromDynamic !== null) {
      // Transform if needed (data from backend might be in Go format)
      const transformedAttendance = transformGoBackendAttendance(attendanceFromDynamic);
      dataObject.attendance = transformedAttendance;
      console.log(`[API /data/all] ✅ Using attendance from dynamicData`);
    } else if (options?.cachedAttendance) {
      // Use cached attendance when dynamicData doesn't have it or it's null
      // Transform if needed (cached data might be in Go format if saved before transformation was added)
      const transformedCachedAttendance = transformGoBackendAttendance(options.cachedAttendance);
      dataObject.attendance = transformedCachedAttendance;
      console.log(`[API /data/all] ✅ Using cached attendance (dynamicData had null or missing attendance)`);
    } else {
      dataObject.attendance = null;
      console.warn(`[API /data/all] ⚠️ No attendance data available (neither from dynamicData nor cache)`);
    }
  }
  
  if (shouldFetchMarks) {
    // Get marks from dynamicData first, then fallback to cached data
    const marksFromDynamic = (dynamicData?.data as { marks?: unknown } | undefined)?.marks;
    if (marksFromDynamic && marksFromDynamic !== null) {
      // Transform if needed (data from backend might be in Go format)
      const transformedMarks = transformGoBackendMarks(marksFromDynamic);
      dataObject.marks = transformedMarks;
      console.log(`[API /data/all] ✅ Using marks from dynamicData`);
    } else if (options?.cachedMarks) {
      // Use cached marks when dynamicData doesn't have it or it's null
      // Transform if needed (cached data might be in Go format if saved before transformation was added)
      const transformedCachedMarks = transformGoBackendMarks(options.cachedMarks);
      dataObject.marks = transformedCachedMarks;
      console.log(`[API /data/all] ✅ Using cached marks (dynamicData had null or missing marks)`);
    } else {
      dataObject.marks = null;
      console.warn(`[API /data/all] ⚠️ No marks data available (neither from dynamicData nor cache)`);
    }
  }
  
  const merged: Record<string, unknown> = {
    success: overallSuccess,
    data: dataObject,
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
  console.log(`[API /data/all] ⚠️ Database update disabled - project should not write to Supabase tables`);
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
  console.log(`[API /data/all] ⚠️ Database name update disabled - project should not write to Supabase tables`);
}

/**
 * Update user's registration number in database (fire and forget)
 */
async function updateRegistrationNumberInDatabase(user_id: string, registration_number: string): Promise<void> {
  console.log(`[API /data/all] ⚠️ Database registration_number update disabled - project should not write to Supabase tables`);
}

/**
 * Update user's department in database (fire and forget)
 */
async function updateDepartmentInDatabase(user_id: string, department: string): Promise<void> {
  console.log(`[API /data/all] ⚠️ Database department update disabled - project should not write to Supabase tables`);
}

/**
 * Background prefetch function for near-expiry caches
 * Fetches fresh data and updates cache without blocking the main request
 * Uses individual fetch for maximum efficiency
 */
async function triggerBackgroundPrefetch(
  user_email: string,
  user_id: string,
  password: string | undefined,
  dataType: 'attendance' | 'marks'
): Promise<void> {
  console.log(`[BackgroundPrefetch] 🔄 Starting background prefetch for ${dataType} (user: ${user_email})`);
  
  try {
    // Fetch only the specific data type (optimized - single request)
    const result = await callGoBackendForDataRefresh(user_email, user_id, password, dataType);
    
    if (result.success && result.data) {
      console.log(`[BackgroundPrefetch] ✅ Background prefetch completed for ${dataType}`);
    } else {
      console.warn(`[BackgroundPrefetch] ⚠️ No fresh data received for ${dataType}:`);
      console.warn(`[BackgroundPrefetch]   - Success: ${result.success}`);
      console.warn(`[BackgroundPrefetch]   - Error: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    console.error(`[BackgroundPrefetch] ❌ Error in background prefetch for ${dataType}:`);
    console.error(`[BackgroundPrefetch]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`[BackgroundPrefetch]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[BackgroundPrefetch]   - Stack: ${error.stack}`);
    }
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

