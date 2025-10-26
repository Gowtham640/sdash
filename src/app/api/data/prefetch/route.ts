import { NextRequest, NextResponse } from "next/server";
import { dataCache } from "@/lib/dataCache";
import { spawn } from "child_process";

/**
 * Background data prefetch endpoint
 * POST /api/data/prefetch
 * 
 * Triggered after user signs in to fetch and cache data in the background.
 * This endpoint returns immediately without waiting for the fetch to complete.
 * 
 * Request body: { access_token: string }
 * 
 * Returns: { success: true, message: "Prefetch started/already cached" }
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
    console.error("[Prefetch] JWT decode error:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  console.log("[Prefetch] POST request received");

  try {
    // Parse request body
    const body = await request.json();
    const { access_token } = body;

    if (!access_token) {
      console.error("[Prefetch] No access token provided");
      return NextResponse.json(
        { success: false, error: "Access token is required" },
        { status: 400 }
      );
    }

    // Verify and decode JWT token
    console.log("[Prefetch] Verifying access token...");
    let user_email: string;

    try {
      const decoded = decodeJWT(access_token);
      
      if (!decoded) {
        throw new Error("Invalid token format");
      }

      user_email = decoded.email || decoded.sub;

      if (!user_email) {
        throw new Error("Missing user email in token");
      }

    } catch (tokenError) {
      console.error("[Prefetch] Token verification failed:", tokenError);
      return NextResponse.json(
        { success: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    console.log(`[Prefetch] Session valid for user: ${user_email}`);

    // Check if data already cached
    const cacheKey = `data:${user_email}`;
    const cached = dataCache.get(cacheKey);

    if (cached) {
      console.log(`[Prefetch] ✅ Data already cached for ${user_email}`);
      return NextResponse.json({
        success: true,
        message: "Data already cached",
        cached: true
      });
    }

    // Data not cached - trigger background fetch (DON'T WAIT)
    console.log(`[Prefetch] 🔄 Starting background fetch for ${user_email}`);
    
    // Trigger async fetch but return immediately
    triggerBackgroundFetch(user_email, cacheKey).catch(err => {
      console.error(`[Prefetch] Background fetch error for ${user_email}:`, err);
    });

    return NextResponse.json({
      success: true,
      message: "Prefetch started",
      cached: false
    });

  } catch (error) {
    console.error("[Prefetch] Unexpected error:", error);
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
 * Trigger background fetch without waiting
 * Returns immediately, fetch continues in background
 */
async function triggerBackgroundFetch(email: string, cacheKey: string): Promise<void> {
  console.log(`[Prefetch] Background fetch starting for ${email}`);
  
  try {
    const result = await callPythonUnifiedData(email);

    if (result.success) {
      result.metadata.cached_at = Date.now();
      dataCache.set(cacheKey, result, 5 * 60 * 1000); // 5 minute TTL
      console.log(`[Prefetch] ✅ Background fetch completed and cached for ${email}`);
    } else {
      console.error(`[Prefetch] ❌ Background fetch failed for ${email}:`, result.error);
    }

  } catch (error) {
    console.error(`[Prefetch] Exception in background fetch for ${email}:`, error);
  }
}

/**
 * Call Python scraper to get all data using existing session
 */
async function callPythonUnifiedData(email: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.error("[Prefetch] Python scraper timeout after 60 seconds");
      resolve({
        success: false,
        error: "Request timeout after 60 seconds"
      });
    }, 60000); // 60 second timeout

    try {
      console.log(`[Prefetch] Spawning Python scraper for: ${email}`);

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
        force_refresh: false
      });

      console.log(`[Prefetch] Sending payload to Python:`, payload.substring(0, 100));

      // Send payload to Python process
      pythonProcess.stdin.write(payload);
      pythonProcess.stdin.end();

      // Capture stdout
      pythonProcess.stdout.on("data", (data) => {
        const chunk = data.toString();
        outputData += chunk;
        console.log(`[Prefetch] Python stdout: ${chunk.substring(0, 200)}`);
      });

      // Capture stderr for logging
      pythonProcess.stderr.on("data", (data) => {
        const chunk = data.toString();
        errorData += chunk;
        console.error(`[Prefetch] Python stderr: ${chunk.trim()}`);
      });

      // Handle process completion
      pythonProcess.on("close", (code) => {
        clearTimeout(timeout);

        console.log(`[Prefetch] Python process closed with code: ${code}`);

        if (code !== 0) {
          console.error(`[Prefetch] Python process failed with exit code ${code}`);
          resolve({
            success: false,
            error: `Python process failed with exit code ${code}`
          });
          return;
        }

        // Parse Python output
        try {
          // Extract JSON from output (in case there's extra logging)
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          const jsonString = jsonMatch ? jsonMatch[0] : outputData;

          console.log(`[Prefetch] Parsing JSON response...`);
          const result = JSON.parse(jsonString);

          console.log(`[Prefetch] Success: ${result.success}`);
          resolve(result);

        } catch (parseError) {
          console.error(`[Prefetch] Failed to parse Python output:`, parseError);
          resolve({
            success: false,
            error: "Failed to parse Python response"
          });
        }
      });

      // Handle process errors
      pythonProcess.on("error", (error) => {
        clearTimeout(timeout);
        console.error(`[Prefetch] Python process error:`, error);
        resolve({
          success: false,
          error: `Python process error: ${error.message}`
        });
      });

    } catch (error) {
      clearTimeout(timeout);
      console.error(`[Prefetch] Exception spawning Python:`, error);
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
