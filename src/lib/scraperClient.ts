/**
 * Unified HTTP client for backend scraper API
 * Replaces all Python spawn() calls with HTTP requests
 */

import { requestQueueTracker } from "@/lib/requestQueue";
import { getStorageItem, setStorageItem, removeStorageItem } from "./browserStorage";

// Get backend URL from environment variables
// Supports both NEXT_PUBLIC_BACKEND_URL (client-side) and BACKEND_URL (server-side)
// Falls back to localhost:8080 for local development
function getBackendUrl(): string {
  // Check environment variables (available in both client and server contexts)
  const backendUrl = 
    process.env.NEXT_PUBLIC_BACKEND_URL || 
    process.env.BACKEND_URL || 
    'http://localhost:8080';
  
  // Validate and return
  if (backendUrl && backendUrl.trim() !== '') {
    return backendUrl.trim();
  }
  
  // Fallback to localhost:8080
  return 'http://localhost:8080';
}

// Get BACKEND_URL at runtime
const BACKEND_URL = getBackendUrl();

// Only log in server context to avoid exposing URL in client bundles
if (typeof window === 'undefined') {
console.log('[Backend Client] BACKEND_URL:', BACKEND_URL);
  const envSource = 
    process.env.NEXT_PUBLIC_BACKEND_URL ? 'NEXT_PUBLIC_BACKEND_URL' :
    process.env.BACKEND_URL ? 'BACKEND_URL' :
    'fallback (localhost:8080)';
  console.log('[Backend Client] BACKEND_URL source:', envSource);
}

// Storage key for backend session cookies
const BACKEND_COOKIES_KEY = 'backend_scraper_cookies';

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
 * Go backend login response format
 */
export interface GoBackendLoginResponse {
  authenticated: boolean;
  session?: Record<string, unknown>;
  lookup?: Record<string, unknown>;
  cookies?: string;
  status?: number;
  message?: string;
  errors?: string[] | null;
}

/**
 * Go backend login request format
 */
export interface GoBackendLoginRequest {
  account: string;
  password: string;
  cdigest?: string;
  captcha?: string;
}

/**
 * Go backend user data response format
 */
export interface GoBackendUserData {
  name: string;
  mobile: string;
  program: string;
  semester: number;
  regNumber: string;
  batch: string;
  year: number;
  department: string;
  section: string;
  specialization: string;
}

/**
 * Get stored backend cookies
 */
export function getBackendCookies(): string | null {
  return getStorageItem(BACKEND_COOKIES_KEY);
}

/**
 * Store backend cookies
 */
function setBackendCookies(cookies: string): boolean {
  return setStorageItem(BACKEND_COOKIES_KEY, cookies);
}

/**
 * Clear backend cookies (on logout or session expiry)
 */
export function clearBackendCookies(): void {
  removeStorageItem(BACKEND_COOKIES_KEY);
}

/**
 * Fetch user data from Go backend
 * Sends GET request to /user with X-CSRF-Token header
 * @returns User data or null on error
 */
export async function getUserDataFromGoBackend(): Promise<GoBackendUserData | null> {
  const requestStartTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[Backend Client] 👤 Fetching user data from Go backend`);

  try {
    // Get stored cookies for authentication
    const cookies = getBackendCookies();
    
    if (!cookies) {
      console.error(`[Backend Client] ❌ No cookies found - cannot fetch user data`);
      return null;
    }

    const headers: HeadersInit = {
      'X-CSRF-Token': cookies,
    };

    const fetchStartTime = Date.now();
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/user`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const fetchDuration = Date.now() - fetchStartTime;

    clearTimeout(timeoutId);

    console.log(`[Backend Client] 📡 User data response received: ${fetchDuration}ms`);
    console.log(`[Backend Client]   - Status: ${response.status} ${response.statusText}`);
    console.log(`[Backend Client]   - OK: ${response.ok}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(`[Backend Client] ❌ User data fetch error:`);
      console.error(`[Backend Client]   - Status: ${response.status}`);
      console.error(`[Backend Client]   - Response: ${errorText.substring(0, 200)}`);
      
      // Handle 401 - session expired
      if (response.status === 401) {
        clearBackendCookies();
        console.log(`[Backend Client] 🗑️ Cleared cookies due to 401`);
      }
      
      const totalDuration = Date.now() - requestStartTime;
      console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      
      return null;
    }

    const parseStartTime = Date.now();
    const userData: GoBackendUserData = await response.json();
    const parseDuration = Date.now() - parseStartTime;
    const totalDuration = Date.now() - requestStartTime;

    console.log(`[Backend Client] 📊 Response parsed: ${parseDuration}ms`);
    console.log(`[Backend Client]   - Name: ${userData.name || "none"}`);
    console.log(`[Backend Client]   - Semester: ${userData.semester || "none"}`);
    console.log(`[Backend Client]   - Department: ${userData.department || "none"}`);
    console.log(`[Backend Client]   - Program: ${userData.program || "none"}`);
    console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return userData;
  } catch (error) {
    clearTimeout(timeoutId);
    const totalDuration = Date.now() - requestStartTime;

    if (error instanceof Error && error.name === 'AbortError') {
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error(`[Backend Client] ❌ USER DATA FETCH TIMEOUT`);
      console.error(`[Backend Client]   - Duration: ${totalDuration}ms (exceeded 30s limit)`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      return null;
    }

    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(`[Backend Client] ❌ USER DATA FETCH ERROR`);
    console.error(`[Backend Client]   - Duration: ${totalDuration}ms`);
    console.error(`[Backend Client]   - Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`[Backend Client]   - Error Message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[Backend Client]   - Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return null;
  }
}

/**
 * Logout from Go backend
 * Sends DELETE request to /logout with X-CSRF-Token header
 * Clears stored cookies on success
 */
export async function logoutFromGoBackend(): Promise<{ success: boolean; error?: string }> {
  const requestStartTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`[Backend Client] 🚪 Logging out from Go backend`);

  try {
    // Get stored cookies for logout request
    const cookies = getBackendCookies();
    
    if (!cookies) {
      console.log(`[Backend Client] ⚠️ No cookies found - already logged out`);
      clearBackendCookies(); // Ensure cleanup
      return { success: true };
    }

    const headers: HeadersInit = {
      'X-CSRF-Token': cookies,
    };

    const fetchStartTime = Date.now();
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/logout`, {
      method: 'DELETE',
      headers,
      signal: controller.signal,
    });
    const fetchDuration = Date.now() - fetchStartTime;

    clearTimeout(timeoutId);

    console.log(`[Backend Client] 📡 Logout response received: ${fetchDuration}ms`);
    console.log(`[Backend Client]   - Status: ${response.status} ${response.statusText}`);
    console.log(`[Backend Client]   - OK: ${response.ok}`);

    // Clear cookies regardless of response status (logout should always clear local state)
    clearBackendCookies();
    console.log(`[Backend Client] 🗑️ Cleared stored cookies`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(`[Backend Client] ❌ Logout error:`);
      console.error(`[Backend Client]   - Status: ${response.status}`);
      console.error(`[Backend Client]   - Response: ${errorText.substring(0, 200)}`);
      
      const totalDuration = Date.now() - requestStartTime;
      console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      
      return {
        success: false,
        error: `Logout error: ${response.status} ${response.statusText}`,
      };
    }

    const totalDuration = Date.now() - requestStartTime;
    console.log(`[Backend Client] ✅ Logout successful: ${totalDuration}ms`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return { success: true };
  } catch (error) {
    clearTimeout(timeoutId);
    const totalDuration = Date.now() - requestStartTime;

    // Clear cookies even on error
    clearBackendCookies();
    console.log(`[Backend Client] 🗑️ Cleared stored cookies (error cleanup)`);

    if (error instanceof Error && error.name === 'AbortError') {
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error(`[Backend Client] ❌ LOGOUT TIMEOUT`);
      console.error(`[Backend Client]   - Duration: ${totalDuration}ms (exceeded 30s limit)`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      return {
        success: false,
        error: 'Logout request timeout after 30 seconds',
      };
    }

    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(`[Backend Client] ❌ LOGOUT ERROR`);
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
  }
}

/**
 * Login to Go backend and store cookies
 * @param account - User account/email
 * @param password - User password
 * @param cdigest - Optional captcha digest
 * @param captcha - Optional captcha answer
 * @returns Login response with authentication status and cookies
 */
export async function loginToGoBackend(
  account: string,
  password: string,
  cdigest?: string,
  captcha?: string
): Promise<GoBackendLoginResponse> {
  const requestStartTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const backendUrl = getBackendUrl();
  console.log(`[Backend Client] 🔐 Logging in to Go backend`);
  console.log(`[Backend Client]   - Account: ${account}`);
  console.log(`[Backend Client]   - Backend URL: ${backendUrl}`);
  console.log(`[Backend Client]   - Captcha provided: ${cdigest && captcha ? "✓" : "✗"}`);

  try {
    const requestBody: GoBackendLoginRequest = {
      account,
      password,
      ...(cdigest ? { cdigest } : {}),
      ...(captcha ? { captcha } : {}),
    };

    const fetchStartTime = Date.now();
    const response = await fetch(`${backendUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const fetchDuration = Date.now() - fetchStartTime;

    clearTimeout(timeoutId);

    console.log(`[Backend Client] 📡 Login response received: ${fetchDuration}ms`);
    console.log(`[Backend Client]   - Status: ${response.status} ${response.statusText}`);
    console.log(`[Backend Client]   - OK: ${response.ok}`);

    const parseStartTime = Date.now();
    const responseData: GoBackendLoginResponse = await response.json();
    const parseDuration = Date.now() - parseStartTime;
    const totalDuration = Date.now() - requestStartTime;

    console.log(`[Backend Client] 📊 Response parsed: ${parseDuration}ms`);
    console.log(`[Backend Client]   - Authenticated: ${responseData.authenticated}`);
    console.log(`[Backend Client]   - Status: ${responseData.status || "none"}`);
    console.log(`[Backend Client]   - Message: ${responseData.message || "none"}`);
    console.log(`[Backend Client]   - Cookies received: ${responseData.cookies ? "✓" : "✗"}`);
    console.log(`[Backend Client]   - Session: ${responseData.session ? "✓" : "✗"}`);
    console.log(`[Backend Client]   - Lookup: ${responseData.lookup ? "✓" : "✗"}`);
    if (responseData.errors) {
      console.log(`[Backend Client]   - Errors: ${JSON.stringify(responseData.errors)}`);
    }

    // Store cookies if authentication was successful
    if (responseData.authenticated && responseData.cookies) {
      const stored = setBackendCookies(responseData.cookies);
      if (stored) {
        console.log(`[Backend Client] ✅ Cookies stored successfully`);
      } else {
        console.error(`[Backend Client] ❌ Failed to store cookies`);
      }
    } else if (!responseData.authenticated) {
      // Clear any existing cookies on failed login
      clearBackendCookies();
      console.log(`[Backend Client] 🗑️ Cleared cookies due to failed authentication`);
    }

    console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return responseData;
  } catch (error) {
    clearTimeout(timeoutId);
    const totalDuration = Date.now() - requestStartTime;

    if (error instanceof Error && error.name === 'AbortError') {
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error(`[Backend Client] ❌ LOGIN TIMEOUT`);
      console.error(`[Backend Client]   - Duration: ${totalDuration}ms (exceeded 60s limit)`);
      console.error(`[Backend Client]   - Account: ${account}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      return {
        authenticated: false,
        status: 408,
        message: 'Login request timeout after 60 seconds',
      };
    }

    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(`[Backend Client] ❌ LOGIN ERROR`);
    console.error(`[Backend Client]   - Duration: ${totalDuration}ms`);
    console.error(`[Backend Client]   - Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`);
    console.error(`[Backend Client]   - Error Message: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[Backend Client]   - Stack: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return {
      authenticated: false,
      status: 500,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Map action to Go backend endpoint
 */
function getEndpointForAction(action: string): { method: string; path: string } | null {
  const endpointMap: Record<string, { method: string; path: string }> = {
    'validate_credentials': { method: 'POST', path: '/login' },
    'get_attendance_data': { method: 'GET', path: '/attendance' },
    'get_marks_data': { method: 'GET', path: '/marks' },
    'get_timetable_data': { method: 'GET', path: '/timetable' },
    'get_calendar_data': { method: 'GET', path: '/calendar' },
    'get_user_data': { method: 'GET', path: '/user' },
    'get_all_data': { method: 'GET', path: '/get' },
    'get_static_data': { method: 'GET', path: '/get' }, // Will handle separately
    'get_dynamic_data': { method: 'GET', path: '/get' }, // Will handle separately
  };
  
  return endpointMap[action] || null;
}

/**
 * Unified HTTP client for backend scraper API
 * Replaces all Python spawn() calls with Go backend HTTP requests
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
  const backendUrl = getBackendUrl();
  console.log(`[Backend Client] 🚀 Calling backend API`);
  console.log(`[Backend Client]   - Action: ${action}`);
  console.log(`[Backend Client]   - Email: ${data.email}`);
  console.log(`[Backend Client]   - Backend URL: ${backendUrl}`);
  console.log(`[Backend Client]   - Password: ${data.password ? "✓ Provided" : "✗ Not provided"}`);
  console.log(`[Backend Client]   - Force refresh: ${data.force_refresh || false}`);

  try {
    // Handle special cases for get_static_data and get_dynamic_data
    if (action === 'get_static_data') {
      // Fetch timetable and calendar separately
      const [timetableResult, calendarResult] = await Promise.all([
        callGoEndpoint('GET', '/timetable', data),
        callGoEndpoint('GET', '/calendar', data),
      ]);

      const staticData = {
        success: (timetableResult.success || calendarResult.success),
        data: {
          timetable: timetableResult.success ? timetableResult.data : null,
          calendar: calendarResult.success ? calendarResult.data : null,
        },
        error: !timetableResult.success && !calendarResult.success 
          ? `Timetable: ${timetableResult.error || 'Unknown'}, Calendar: ${calendarResult.error || 'Unknown'}`
          : undefined,
      } as ScraperResponse<T>;

    clearTimeout(timeoutId);
      const totalDuration = Date.now() - requestStartTime;
      console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      return staticData;
    }

    if (action === 'get_dynamic_data') {
      // Fetch attendance and marks separately
      const [attendanceResult, marksResult] = await Promise.all([
        callGoEndpoint('GET', '/attendance', data),
        callGoEndpoint('GET', '/marks', data),
      ]);

      const dynamicData = {
        success: (attendanceResult.success || marksResult.success),
        data: {
          attendance: attendanceResult.success ? attendanceResult.data : null,
          marks: marksResult.success ? marksResult.data : null,
        },
        error: !attendanceResult.success && !marksResult.success
          ? `Attendance: ${attendanceResult.error || 'Unknown'}, Marks: ${marksResult.error || 'Unknown'}`
          : undefined,
      } as ScraperResponse<T>;

      clearTimeout(timeoutId);
      const totalDuration = Date.now() - requestStartTime;
      console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      return dynamicData;
    }
      
    // Get endpoint for action
    const endpoint = getEndpointForAction(action);
    if (!endpoint) {
      clearTimeout(timeoutId);
      return {
        success: false,
        error: `Unknown action: ${action}`,
      };
    }

    // Call the Go backend endpoint
    const result = await callGoEndpoint<T>(endpoint.method, endpoint.path, data, controller);
    clearTimeout(timeoutId);

    const totalDuration = Date.now() - requestStartTime;
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
 * Call a Go backend endpoint
 * Uses X-CSRF-Token header with stored cookies for authentication
 */
async function callGoEndpoint<T = unknown>(
  method: string,
  path: string,
  data: ScraperRequest,
  controller?: AbortController
): Promise<ScraperResponse<T>> {
  const fetchStartTime = Date.now();
  
  // Get BACKEND_URL at runtime - always use the function to ensure correct value
  const backendBaseUrl = getBackendUrl();
  
  // Normalize path - ensure it starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // Construct full URL - simple string concatenation (backendBaseUrl already validated)
  const fullUrl = `${backendBaseUrl}${normalizedPath}`;
  
  console.log(`[Backend Client] 🔗 Endpoint Call:`);
  console.log(`[Backend Client]   - Method: ${method}`);
  console.log(`[Backend Client]   - Path: ${path}`);
  console.log(`[Backend Client]   - Normalized Path: ${normalizedPath}`);
  console.log(`[Backend Client]   - Backend Base URL: ${backendBaseUrl}`);
  console.log(`[Backend Client]   - Full URL: ${fullUrl}`);
  
  // Get stored cookies for authentication
  const cookies = getBackendCookies();
  
  // Build request headers
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Add X-CSRF-Token header with cookies (except for /login and /hello)
  if (path !== '/login' && path !== '/hello' && cookies) {
    headers['X-CSRF-Token'] = cookies;
    console.log(`[Backend Client] 🔐 Using stored cookies for authentication`);
  } else if (path !== '/login' && path !== '/hello' && !cookies) {
    console.warn(`[Backend Client] ⚠️ No cookies found - request may fail with 401`);
  }

  // Build request options
  const requestOptions: RequestInit = {
    method,
    headers,
    signal: controller?.signal,
  };

  // For POST requests (login), include body
  // Note: Login should use loginToGoBackend() function instead
  if (method === 'POST' && path === '/login') {
    // This shouldn't be called directly - use loginToGoBackend() instead
    console.warn(`[Backend Client] ⚠️ Direct POST to /login - use loginToGoBackend() instead`);
    requestOptions.body = JSON.stringify({
      account: data.email, // Map email to account
      password: data.password,
    });
  }

  // GET requests don't need body or query params - authentication is via X-CSRF-Token header
  console.log(`[Backend Client] 📡 Making ${method} request to: ${fullUrl}`);

  let response: Response;
  try {
    response = await fetch(fullUrl, requestOptions);
  } catch (fetchError) {
    console.error(`[Backend Client] ❌ Fetch error:`);
    console.error(`[Backend Client]   - URL: ${fullUrl}`);
    console.error(`[Backend Client]   - Error: ${fetchError}`);
    return {
      success: false,
      error: `Network error: ${fetchError instanceof Error ? fetchError.message : 'Failed to connect to backend'}`,
    };
  }
  
  const fetchDuration = Date.now() - fetchStartTime;

  console.log(`[Backend Client] 📡 HTTP response received: ${fetchDuration}ms`);
  console.log(`[Backend Client]   - Status: ${response.status} ${response.statusText}`);
  console.log(`[Backend Client]   - OK: ${response.ok}`);

  // Handle 401 Unauthorized - session expired, clear cookies
  if (response.status === 401) {
    console.error(`[Backend Client] ❌ 401 Unauthorized - Session expired`);
    clearBackendCookies();
    return {
      success: false,
      error: 'Session expired. Please re-login.',
    };
  }

  // Handle 429 Too Many Requests - rate limit
  if (response.status === 429) {
    console.error(`[Backend Client] ❌ 429 Too Many Requests - Rate limit exceeded`);
    return {
      success: false,
      error: 'Rate limit exceeded. Please wait 1 minute before retrying.',
    };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    console.error(`[Backend Client] ❌ HTTP Error:`);
    console.error(`[Backend Client]   - URL: ${fullUrl}`);
    console.error(`[Backend Client]   - Status: ${response.status}`);
    console.error(`[Backend Client]   - Status Text: ${response.statusText}`);
    console.error(`[Backend Client]   - Response: ${errorText.substring(0, 200)}`);
    
    // For 404 errors, provide more helpful error message
    if (response.status === 404) {
      return {
        success: false,
        error: `Endpoint not found: ${method} ${fullUrl}. Please verify the Go backend is running at ${backendBaseUrl} and the endpoint ${path} exists.`,
      };
    }
    
    return {
      success: false,
      error: `Backend error: ${response.status} ${response.statusText}`,
    };
  }

  const parseStartTime = Date.now();
  const responseData = await response.json();
  const parseDuration = Date.now() - parseStartTime;

  console.log(`[Backend Client] 📊 Response parsed: ${parseDuration}ms`);

  // Handle different response formats
  // Go backend might return:
  // 1. {status, error, ...data} format (e.g., attendance: {status: 200, error: null, attendance: [...], regNumber: ...})
  // 2. {success, data, error} format (legacy)
  // 3. Data directly
  let result: ScraperResponse<T>;
  
  if (responseData && typeof responseData === 'object') {
    // Check if response has Go backend format with status field
    if ('status' in responseData) {
      const status = responseData.status as number;
      const error = responseData.error as string | null | undefined;
      
      // If status is 200 and no error, it's successful
      if (status === 200 && !error) {
        // The data is the response itself (minus status/error fields)
        const { status: _status, error: _error, ...dataFields } = responseData;
        result = {
          success: true,
          data: dataFields as T,
        };
      } else {
        // Error response
        result = {
          success: false,
          error: error || `Backend returned status ${status}`,
        };
      }
    }
    // Check if response already has success/data/error structure (legacy format)
    else if ('success' in responseData || 'data' in responseData || 'error' in responseData) {
      result = {
        success: responseData.success !== false,
        data: responseData.data as T,
        error: responseData.error,
        cached: responseData.cached,
        count: responseData.count,
      };
    } else {
      // Response is the data directly
      result = {
        success: true,
        data: responseData as T,
      };
    }
  } else {
    // Response is not an object, wrap it
    result = {
      success: true,
      data: responseData as T,
    };
  }

  console.log(`[Backend Client]   - Success: ${result.success}`);
  console.log(`[Backend Client]   - Error: ${result.error || "none"}`);
  console.log(`[Backend Client]   - Cached: ${result.cached || false}`);
  
  return result;
}

/**
 * Health check helper
 */
export async function checkBackendHealth(): Promise<boolean> {
  try {
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/hello`);
    return response.ok;
  } catch {
    return false;
  }
}

// Keep-warm interval ID (similar to analytics pattern)
let keepWarmIntervalId: NodeJS.Timeout | null = null;

/**
 * Keep backend warm by pinging /hello endpoint every 14 minutes
 * Prevents Render.com free tier from spinning down (15 min timeout)
 * Follows the same pattern as analytics periodic tasks
 */
export function startKeepWarm(): void {
  // Clear any existing interval
  if (keepWarmIntervalId) {
    clearInterval(keepWarmIntervalId);
    keepWarmIntervalId = null;
  }

  // Ping every 14 minutes (840,000 ms) - Render.com spins down after 15 minutes
  const KEEP_WARM_INTERVAL_MS = 14 * 60 * 1000; // 14 minutes

  // Ping immediately on start (test ping)
  console.log('[Keep Warm] 🔥 Sending initial test ping to backend...');
  checkBackendHealth()
    .then((isHealthy) => {
      if (isHealthy) {
        console.log('[Keep Warm] ✅ Initial test ping successful - backend is alive');
      } else {
        console.warn('[Keep Warm] ⚠️ Initial test ping failed - backend may be sleeping');
      }
    })
    .catch(() => {
      console.warn('[Keep Warm] ⚠️ Initial test ping error (silent fail)');
    });

  // Then ping every 14 minutes
  keepWarmIntervalId = setInterval(() => {
    checkBackendHealth()
      .then((isHealthy) => {
        if (isHealthy) {
          console.log('[Keep Warm] ✅ Backend ping successful');
        } else {
          console.warn('[Keep Warm] ⚠️ Backend ping failed (backend may be sleeping)');
        }
      })
      .catch(() => {
        // Silently fail - this is just a keep-alive ping
        console.warn('[Keep Warm] ⚠️ Backend ping error (silent fail)');
      });
  }, KEEP_WARM_INTERVAL_MS);

  console.log(`[Keep Warm] ✅ Started - pinging backend every 14 minutes (${KEEP_WARM_INTERVAL_MS}ms)`);
}

/**
 * Stop the keep-warm mechanism
 */
export function stopKeepWarm(): void {
  if (keepWarmIntervalId) {
    clearInterval(keepWarmIntervalId);
    keepWarmIntervalId = null;
    console.log('[Keep Warm] 🛑 Stopped');
  }
}


