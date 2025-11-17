/**
 * Unified HTTP client for backend scraper API
 * Replaces all Python spawn() calls with HTTP requests
 */

import { requestQueueTracker } from "@/lib/requestQueue";

const BACKEND_URL = 'http://localhost:5000';
console.log('[Backend Client] BACKEND_URL:', BACKEND_URL);

export interface ScraperRequest {
  email: string;
  password?: string;
  force_refresh?: boolean;
}

export interface ScraperResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
  count?: number;
}

/**
 * Unified HTTP client for backend scraper API
 * Replaces all Python spawn() calls
 */
export async function callBackendScraper<T = unknown>(
  action: string,
  data: ScraperRequest
): Promise<ScraperResponse<T>> {
  const requestStartTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  // Register backend request (waiting in Render queue)
  requestQueueTracker.registerBackendRequest(data.email);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[Backend Client] 🚀 Calling backend API`);
  console.log(`[Backend Client]   - Action: ${action}`);
  console.log(`[Backend Client]   - Email: ${data.email}`);
  console.log(`[Backend Client]   - Backend URL: ${BACKEND_URL}`);
  console.log(`[Backend Client]   - Password: ${data.password ? "✓ Provided" : "✗ Not provided"}`);
  console.log(`[Backend Client]   - Force refresh: ${data.force_refresh || false}`);

  try {
    const fetchStartTime = Date.now();
    const response = await fetch(`${BACKEND_URL}/api/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data }),
      signal: controller.signal,
    });
    const fetchDuration = Date.now() - fetchStartTime;

    clearTimeout(timeoutId);

    console.log(`[Backend Client] 📡 HTTP response received: ${fetchDuration}ms`);
    console.log(`[Backend Client]   - Status: ${response.status} ${response.statusText}`);
    console.log(`[Backend Client]   - OK: ${response.ok}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(`[Backend Client] ❌ HTTP Error:`);
      console.error(`[Backend Client]   - Status: ${response.status}`);
      console.error(`[Backend Client]   - Status Text: ${response.statusText}`);
      console.error(`[Backend Client]   - Response: ${errorText.substring(0, 200)}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      
      return {
        success: false,
        error: `Backend error: ${response.status} ${response.statusText}`,
      };
    }

    const parseStartTime = Date.now();
    const result: ScraperResponse<T> = await response.json();
    const parseDuration = Date.now() - parseStartTime;
    const totalDuration = Date.now() - requestStartTime;

    console.log(`[Backend Client] 📊 Response parsed: ${parseDuration}ms`);
    console.log(`[Backend Client]   - Success: ${result.success}`);
    console.log(`[Backend Client]   - Error: ${result.error || "none"}`);
    console.log(`[Backend Client]   - Cached: ${result.cached || false}`);
    if (result.success) {
      console.log(`[Backend Client]   - Data types received:`);
      if (result.data) {
      const resultData = result.data as { 
        calendar?: unknown; 
        attendance?: unknown; 
        marks?: unknown; 
        timetable?: unknown 
      } | undefined;
      console.log(`[Backend Client]     - Calendar: ${resultData?.calendar ? "✓" : "✗"}`);
      console.log(`[Backend Client]     - Attendance: ${resultData?.attendance ? "✓" : "✗"}`);
      console.log(`[Backend Client]     - Marks: ${resultData?.marks ? "✓" : "✗"}`);
      console.log(`[Backend Client]     - Timetable: ${resultData?.timetable ? "✓" : "✗"}`);
      }
    }
    console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    const totalDuration = Date.now() - requestStartTime;
    
    if (error instanceof Error && error.name === 'AbortError') {
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error(`[Backend Client] ❌ REQUEST TIMEOUT`);
      console.error(`[Backend Client]   - Action: ${action}`);
      console.error(`[Backend Client]   - Duration: ${totalDuration}ms (exceeded 60s limit)`);
      console.error(`[Backend Client]   - Email: ${data.email}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      
      return { success: false, error: 'Request timeout after 60 seconds' };
    }

    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(`[Backend Client] ❌ NETWORK/FETCH ERROR`);
    console.error(`[Backend Client]   - Action: ${action}`);
    console.error(`[Backend Client]   - Duration: ${totalDuration}ms`);
    console.error(`[Backend Client]   - Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`[Backend Client]   - Error Message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[Backend Client]   - Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    // Unregister backend request when done (success or failure)
    requestQueueTracker.unregisterBackendRequest(data.email);
  }
}

/**
 * Health check helper
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}


