import { NextRequest, NextResponse } from "next/server";
import { dataCache } from "@/lib/dataCache";
import { spawn } from "child_process";
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
function decodeJWT(token: string): Record<string, any> | null {
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
    const { access_token, force_refresh = false } = body;

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

      user_email = decoded.email || decoded.sub;
      user_id = decoded.sub;

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
        return NextResponse.json({
          ...cachedData,
          metadata: {
            ...cachedData.metadata,
            cached: true,
            cache_age_seconds: Math.floor((Date.now() - cachedData.metadata.cached_at) / 1000),
            cache_ttl_seconds: Math.floor((5 * 60 * 1000) / 1000)
          }
        });
      }
    } else {
      console.log(`[API /data/all] Force refresh enabled, bypassing cache for ${user_email}`);
    }

    // Cache miss or force_refresh - call Python scraper
    console.log(`[API /data/all] ❌ Cache miss, fetching from Python for ${user_email}`);
    const result = await callPythonUnifiedData(user_email, user_id, force_refresh);

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

    // Store in cache if successful
    if (result.success) {
      result.metadata.cached_at = Date.now();
      dataCache.set(cacheKey, result, 5 * 60 * 1000); // 5 minute TTL
      console.log(`[API /data/all] 💾 Cached data for ${user_email}`);
      
      // Add cache metadata
      result.metadata.cached = false; // First request (not from cache)
      result.metadata.cache_age_seconds = 0;
      result.metadata.cache_ttl_seconds = 300;
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
 * Call Python scraper to get all data using existing session
 */
function callPythonUnifiedData(email: string, user_id: string, force_refresh: boolean): Promise<any> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.error("[API /data/all] Python scraper timeout after 60 seconds");
      resolve({
        success: false,
        error: "Request timeout after 60 seconds"
      });
    }, 60000); // 60 second timeout

    try {
      console.log(`[API /data/all] Spawning Python scraper for: ${email}`);

      const pythonProcess = spawn("python", ["python-scraper/api_wrapper.py"], {
        cwd: process.cwd(),
        shell: true,
      });

      let outputData = "";
      let errorData = "";

      // Prepare input payload (no password - will use existing session)
      const payload = JSON.stringify({
        action: "get_all_data",
        email,
        // password: not provided - Python will use existing session!
        force_refresh
      });

      console.log(`[API /data/all] Sending payload to Python:`, payload);

      // Send payload to Python process
      pythonProcess.stdin.write(payload);
      pythonProcess.stdin.end();

      // Capture stdout
      pythonProcess.stdout.on("data", (data) => {
        const chunk = data.toString();
        outputData += chunk;
        console.log(`[API /data/all] Python stdout: ${chunk.substring(0, 200)}`);
      });

      // Capture stderr for logging
      pythonProcess.stderr.on("data", (data) => {
        const chunk = data.toString();
        errorData += chunk;
        console.error(`[API /data/all] Python stderr: ${chunk.trim()}`);
      });

      // Handle process completion
      pythonProcess.on("close", (code) => {
        clearTimeout(timeout);

        console.log(`[API /data/all] Python process closed with code: ${code}`);
        console.log(`[API /data/all] Total stdout length: ${outputData.length} bytes`);

        if (code !== 0) {
          console.error(`[API /data/all] Python process failed with exit code ${code}`);
          console.error(`[API /data/all] stderr: ${errorData}`);
          resolve({
            success: false,
            error: `Python process failed with exit code ${code}`,
            stderr: errorData
          });
          return;
        }

        // Parse Python output
        try {
          // Extract JSON from output (in case there's extra logging)
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          const jsonString = jsonMatch ? jsonMatch[0] : outputData;

          console.log(`[API /data/all] Parsing JSON response...`);
          const result = JSON.parse(jsonString);

          // Update user's semester in database if available (fire and forget)
          if (result.success && result.data?.attendance?.semester) {
            const semester = result.data.attendance.semester;
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
          } else {
            console.log(`[API /data/all] No semester data to update. Success: ${result.success}`);
            console.log(`[API /data/all] Attendance data: ${JSON.stringify(result.data?.attendance)}`);
          }

          console.log(`[API /data/all] Success: ${result.success}, Error: ${result.error || 'none'}`);
          resolve(result);

        } catch (parseError) {
          console.error(`[API /data/all] Failed to parse Python output:`, parseError);
          console.error(`[API /data/all] Raw output: ${outputData.substring(0, 500)}`);
          resolve({
            success: false,
            error: "Failed to parse Python response",
            raw_output: outputData.substring(0, 500)
          });
        }
      });

      // Handle process errors
      pythonProcess.on("error", (error) => {
        clearTimeout(timeout);
        console.error(`[API /data/all] Python process error:`, error);
        resolve({
          success: false,
          error: `Python process error: ${error.message}`
        });
      });

    } catch (error) {
      clearTimeout(timeout);
      console.error(`[API /data/all] Exception spawning Python:`, error);
      resolve({
        success: false,
        error: `Exception: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  });
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

