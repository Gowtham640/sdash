import { NextRequest, NextResponse } from "next/server";
import { callBackendScraper } from '@/lib/scraperClient';
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requestQueueTracker } from "@/lib/requestQueue";
import { getSupabaseCache, setSupabaseCache, getSupabaseCacheWithInfo, deleteSupabaseCache } from "@/lib/supabaseCache";
import { removeClientCache } from "@/lib/clientCache";
import { trackApiRequest, trackServerError } from "@/lib/analyticsServer";

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

    // OPTIMIZATION: If all data is missing, use two-request logic (fastest)
    // If only one type is missing, fetch only that type (fastest for single missing)
    if (allMissing) {
      console.log(`[API /data/all] 🚀 All data missing - Using optimized two-request strategy`);
      // Fetch dynamic data first (attendance + marks together)
      try {
        backendWasCalled = true;
        backendCallReasons.push('all data missing - fetching dynamic data');
        console.log(`[API /data/all] 🔄 Backend scraper call #1: Fetching dynamic data (attendance + marks)`);
        const dynamicStartTime = Date.now();
        dynamicData = await callPythonDynamicData(user_email, user_id, password);
        const dynamicDuration = Date.now() - dynamicStartTime;
        console.log(`[API /data/all] ✅ Dynamic data received (${dynamicDuration}ms)`);
        
        const dynamicDataData = dynamicData.data as { attendance?: unknown; marks?: unknown } | undefined;
        if (dynamicData.success && dynamicDataData) {
          // If backend returned null attendance but we have cached attendance (including expired), preserve cached attendance in dynamicData
          if (!dynamicDataData.attendance && cachedAttendance && needAttendance) {
            if (hasExpiredAttendanceCache) {
              console.log(`[API /data/all] ⚠️ Backend returned null attendance, but expired cached attendance exists - preserving expired cached attendance`);
            } else {
              console.log(`[API /data/all] ⚠️ Backend returned null attendance, but cached attendance exists - preserving cached attendance`);
            }
            dynamicDataData.attendance = cachedAttendance;
          }
          if (dynamicDataData.attendance && needAttendance) {
            try {
              await setSupabaseCache(user_id, 'attendance', dynamicDataData.attendance);
            } catch (cacheError) {
              console.error(`[API /data/all] ❌ Failed to save attendance to cache:`);
              console.error(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
              console.error(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
            }
          }
          if (dynamicDataData.marks && needMarks) {
            try {
              await setSupabaseCache(user_id, 'marks', dynamicDataData.marks);
            } catch (cacheError) {
              console.error(`[API /data/all] ❌ Failed to save marks to cache:`);
              console.error(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
              console.error(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
            }
          }
        }
      } catch (error) {
        console.error(`[API /data/all] ❌ Dynamic data request failed:`);
        console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
        console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          console.error(`[API /data/all]   - Stack: ${error.stack}`);
        }
        dynamicData = null;
      }

      // Fetch timetable (calendar comes from public.calendar table, not from backend)
      try {
        backendWasCalled = true;
        backendCallReasons.push('all data missing - fetching timetable');
        console.log(`[API /data/all] 🔄 Backend scraper call #2: Fetching timetable (calendar comes from public.calendar table)`);
        const staticStartTime = Date.now();
        // Fetch only timetable from backend (calendar is fetched from public.calendar table)
        const timetableResult = await callPythonIndividualData(user_email, user_id, password, 'timetable');
        const staticDuration = Date.now() - staticStartTime;
        console.log(`[API /data/all] ✅ Timetable received (${staticDuration}ms)`);
        
        if (timetableResult.success && timetableResult.data && needTimetable) {
          // Set timetable in staticData
          if (!staticData) {
            staticData = { success: true, data: {} };
          }
          (staticData.data as { timetable?: unknown }).timetable = timetableResult.data;
          
          try {
            await setSupabaseCache(user_id, 'timetable', timetableResult.data);
          } catch (cacheError) {
            console.error(`[API /data/all] ❌ Failed to save timetable to cache:`);
            console.error(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
            console.error(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
          }
        }
      } catch (error) {
        console.error(`[API /data/all] ❌ Timetable fetch failed:`);
        console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
        console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          console.error(`[API /data/all]   - Stack: ${error.stack}`);
        }
        staticData = null;
      }
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
          const timetableResult = await callPythonIndividualData(user_email, user_id, password, 'timetable');
          if (timetableResult.success && timetableResult.data) {
            (staticData.data as { timetable?: unknown }).timetable = timetableResult.data;
            try {
              await setSupabaseCache(user_id, 'timetable', timetableResult.data);
            } catch (cacheError) {
              console.error(`[API /data/all] ❌ Failed to save timetable to cache:`);
              console.error(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
              console.error(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
            }
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
          const timetableResult = await callPythonIndividualData(user_email, user_id, password, 'timetable');
          if (timetableResult.success && timetableResult.data) {
            (staticData.data as { timetable?: unknown }).timetable = timetableResult.data;
            try {
              await setSupabaseCache(user_id, 'timetable', timetableResult.data);
            } catch (cacheError) {
              console.error(`[API /data/all] ❌ Failed to save timetable to cache:`);
              console.error(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
              console.error(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
            }
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
          const attendanceResult = await callPythonIndividualData(user_email, user_id, password, 'attendance');
          if (attendanceResult.success && attendanceResult.data) {
            (dynamicData.data as { attendance?: unknown }).attendance = attendanceResult.data;
            try {
              await setSupabaseCache(user_id, 'attendance', attendanceResult.data);
            } catch (cacheError) {
              console.error(`[API /data/all] ❌ Failed to save attendance to cache:`);
              console.error(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
              console.error(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
            }
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
          const marksResult = await callPythonIndividualData(user_email, user_id, password, 'marks');
          if (marksResult.success && marksResult.data) {
            (dynamicData.data as { marks?: unknown }).marks = marksResult.data;
            try {
              await setSupabaseCache(user_id, 'marks', marksResult.data);
            } catch (cacheError) {
              console.error(`[API /data/all] ❌ Failed to save marks to cache:`);
              console.error(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
              console.error(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
            }
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

      // If both dynamic types needed, use grouped fetch
      if (needAttendance && needMarks) {
        console.log(`[API /data/all] ⏳ Fetching dynamic data (attendance + marks)...`);
        try {
          backendWasCalled = true;
          backendCallReasons.push(`dynamic data (attendance+marks) ${forceRefresh ? 'force refresh' : 'cache miss/expired'}`);
          console.log(`[API /data/all] 🔄 Backend scraper call: Fetching dynamic data (attendance + marks)`);
          const dynamicResult = await callPythonDynamicData(user_email, user_id, password);
          if (dynamicResult.success) {
            const dynamicDataData = dynamicResult.data as { attendance?: unknown; marks?: unknown } | undefined;
            if (dynamicDataData) {
              (dynamicData.data as { attendance?: unknown; marks?: unknown }).attendance = dynamicDataData.attendance;
              (dynamicData.data as { attendance?: unknown; marks?: unknown }).marks = dynamicDataData.marks;
              if (dynamicDataData.attendance) {
                try {
                  await setSupabaseCache(user_id, 'attendance', dynamicDataData.attendance);
                } catch (cacheError) {
                  console.error(`[API /data/all] ❌ Failed to save attendance to cache:`);
                  console.error(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
                  console.error(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
                }
              }
              if (dynamicDataData.marks) {
                try {
                  await setSupabaseCache(user_id, 'marks', dynamicDataData.marks);
                } catch (cacheError) {
                  console.error(`[API /data/all] ❌ Failed to save marks to cache:`);
                  console.error(`[API /data/all]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
                  console.error(`[API /data/all]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
                }
              }
            }
          }
        } catch (error) {
          console.error(`[API /data/all] ❌ Dynamic data fetch failed:`);
          console.error(`[API /data/all]   - Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
          console.error(`[API /data/all]   - Error message: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error && error.stack) {
            console.error(`[API /data/all]   - Stack: ${error.stack}`);
          }
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
    // Calendar is fetched based on user's course and semester, then saved to client cache
    const course: string | null = courseFromAttendance || 'BTech'; // Default to BTech
    
    console.log(`[API /data/all] 📋 CALENDAR FETCH DEBUG - Starting calendar fetch process`);
    console.log(`[API /data/all]   - Course from attendance: ${courseFromAttendance || 'none'}`);
    console.log(`[API /data/all]   - Final course to use: ${course}`);
    console.log(`[API /data/all]   - Semester from attendance: ${semesterFromAttendance || 'none'}`);
    
    if (shouldFetchCalendar) {
      // Fetch calendar if semester is available (including 0, but not null/undefined)
      // If semester is not available yet, try to get it from database
      let semesterForCalendar: number | null = semesterFromAttendance;
      if (!semesterForCalendar) {
        console.log(`[API /data/all] 🔍 Semester not in attendance data, fetching from database...`);
        semesterForCalendar = await getSemesterFromDatabase(user_id);
        console.log(`[API /data/all]   - Semester from database: ${semesterForCalendar || 'none'}`);
      }
      
      if (semesterForCalendar !== null && semesterForCalendar !== undefined) {
        try {
          console.log(`[API /data/all] 🔍 ========================================`);
          console.log(`[API /data/all] 🔍 CALENDAR FETCH: Attempting to fetch from public.calendar`);
          console.log(`[API /data/all] 🔍   - Course: "${course}"`);
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
            // Not found for specific course/semester, try fallback: course='default', semester=0
            console.log(`[API /data/all] ℹ️ Record not found for course="${course}", semester=${semesterForCalendar}`);
            console.log(`[API /data/all] 🔍 Trying fallback: course="default", semester=0`);
            
            const { data: fallbackCalendarData, error: fallbackError } = await supabaseAdmin
              .from('calendar')
              .select('data')
              .eq('course', 'default')
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
              recordSource = 'course="default", semester=0 (FALLBACK)';
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
            (result.data as { calendar?: unknown }).calendar = calendarDbData.data;
            
            console.log(`[API /data/all] ✅ Calendar successfully added to result.data.calendar`);
            console.log(`[API /data/all]   - result.data.calendar type: ${typeof (result.data as { calendar?: unknown }).calendar}`);
            console.log(`[API /data/all]   - result.data.calendar is array: ${Array.isArray((result.data as { calendar?: unknown }).calendar)}`);
          } else {
            console.warn(`[API /data/all] ⚠️ ⚠️ ⚠️ No calendar data available from public.calendar table`);
            console.warn(`[API /data/all]   - calendarDbData: ${calendarDbData ? 'exists' : 'null'}`);
            if (calendarDbData) {
              console.warn(`[API /data/all]   - calendarDbData.data: ${calendarDbData.data ? 'exists' : 'null'}`);
            }
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
 * Call backend scraper to get individual data type
 */
async function callPythonIndividualData(
  email: string,
  user_id: string,
  password: string | undefined,
  dataType: 'attendance' | 'marks' | 'calendar' | 'timetable'
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  console.log(`[API /data/all] 🔄 Calling backend: get_${dataType}_data`);
  console.log(`[API /data/all]   - Email: ${email}`);
  console.log(`[API /data/all]   - Data type: ${dataType}`);
  console.log(`[API /data/all]   - Password: ${password ? "✓ Provided" : "✗ Not provided"}`);
  
  const backendCallStart = Date.now();
  
  try {
    const action = `get_${dataType}_data`;
    const result = await callBackendScraper(action, {
      email,
      ...(password ? { password } : {}),
    });
    
    const backendCallDuration = Date.now() - backendCallStart;
    const resultTyped = result as { success?: boolean; error?: string; data?: unknown };
    
    console.log(`[API /data/all] 📡 ${dataType} call completed: ${backendCallDuration}ms`);
    console.log(`[API /data/all]   - Success: ${resultTyped.success || false}`);
    console.log(`[API /data/all]   - Error: ${resultTyped.error || "none"}`);
    
    if (resultTyped.success) {
      // Extract data from response (structure may vary by endpoint)
      const data = resultTyped.data || result;
      return {
        success: true,
        data: data,
      };
    }
    
    return {
      success: false,
      error: resultTyped.error || 'Unknown error',
    };
  } catch (error) {
    const backendCallDuration = Date.now() - backendCallStart;
    console.error(`[API /data/all] ❌ ${dataType} fetch error (${backendCallDuration}ms):`, error);
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
  const overallSuccess = staticSuccess || dynamicSuccess;
  
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
      dataObject.attendance = attendanceFromDynamic;
      console.log(`[API /data/all] ✅ Using attendance from dynamicData`);
    } else if (options?.cachedAttendance) {
      // Use cached attendance when dynamicData doesn't have it or it's null
      dataObject.attendance = options.cachedAttendance;
      console.log(`[API /data/all] ✅ Using cached attendance (dynamicData had null or missing attendance)`);
    } else {
      dataObject.attendance = null;
      console.warn(`[API /data/all] ⚠️ No attendance data available (neither from dynamicData nor cache)`);
    }
  }
  
  if (shouldFetchMarks) {
    // Get marks from dynamicData first, then fallback to cached data
    const marksFromDynamic = (dynamicData?.data as { marks?: unknown } | undefined)?.marks;
    if (marksFromDynamic) {
      dataObject.marks = marksFromDynamic;
    } else if (options?.cachedMarks) {
      // Use cached marks
      dataObject.marks = options.cachedMarks;
    } else {
      dataObject.marks = null;
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
    const result = await callPythonIndividualData(user_email, user_id, password, dataType);
    
    if (result.success && result.data) {
      try {
        await setSupabaseCache(user_id, dataType, result.data);
        console.log(`[BackgroundPrefetch] ✅ Background prefetch completed for ${dataType}`);
      } catch (cacheError) {
        console.error(`[BackgroundPrefetch] ❌ Failed to save ${dataType} to cache:`);
        console.error(`[BackgroundPrefetch]   - Error type: ${cacheError instanceof Error ? cacheError.constructor.name : typeof cacheError}`);
        console.error(`[BackgroundPrefetch]   - Error message: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
        if (cacheError instanceof Error && cacheError.stack) {
          console.error(`[BackgroundPrefetch]   - Stack: ${cacheError.stack}`);
        }
      }
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

