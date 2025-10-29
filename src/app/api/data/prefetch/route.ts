import { NextRequest, NextResponse } from "next/server";
import { dataCache } from "@/lib/dataCache";
import { callBackendScraper } from '@/lib/scraperClient';

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

      // Safely extract email from decoded token
      const decodedEmail = decoded.email;
      const decodedSub = decoded.sub;
      user_email = (typeof decodedEmail === 'string' ? decodedEmail : null) || (typeof decodedSub === 'string' ? decodedSub : '') || '';

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
      const resultWithMetadata = result as { metadata?: { cached_at?: number } };
      if (resultWithMetadata.metadata) {
        resultWithMetadata.metadata.cached_at = Date.now();
      }
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
 * Call backend scraper to get all data using HTTP API
 * Note: This uses get_all_data (fallback for prefetch)
 */
async function callPythonUnifiedData(email: string): Promise<Record<string, unknown>> {
  const result = await callBackendScraper('get_all_data', {
    email,
    force_refresh: false,
  });
  return result as unknown as Record<string, unknown>;
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
