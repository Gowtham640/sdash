/**
 * Unified HTTP client for backend scraper API
 * Replaces all Python spawn() calls with HTTP requests
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:5000';
console.log('[Backend Client] BACKEND_URL:', BACKEND_URL);

export interface ScraperRequest {
  email: string;
  password?: string;
  force_refresh?: boolean;
}

export interface ScraperResponse<T = any> {
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
export async function callBackendScraper<T = any>(
  action: string,
  data: ScraperRequest
): Promise<ScraperResponse<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    console.log(`[Backend Client] Calling ${action} for ${data.email}`);

    const response = await fetch(`${BACKEND_URL}/api/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[Backend Client] HTTP ${response.status}: ${response.statusText}`);
      return {
        success: false,
        error: `Backend error: ${response.status} ${response.statusText}`,
      };
    }

    const result: ScraperResponse<T> = await response.json();
    console.log(`[Backend Client] ${action} success:`, result.success);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`[Backend Client] Request timeout for ${action}`);
      return { success: false, error: 'Request timeout after 60 seconds' };
    }

    console.error(`[Backend Client] Error calling ${action}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
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


