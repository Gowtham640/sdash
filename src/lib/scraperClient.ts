/**
 * Unified HTTP client for backend scraper API
 * Replaces all Python spawn() calls with HTTP requests
 */

import { requestQueueTracker } from "@/lib/requestQueue";
import type { CacheDataType } from "@/lib/supabaseCache";
import { fetchUserCacheEntries } from "@/lib/userCacheReader";
import { getStorageItem, setStorageItem, removeStorageItem } from "./browserStorage";

// Get backend URL from environment variables
// Supports both NEXT_PUBLIC_BACKEND_URL (client-side) and BACKEND_URL (server-side)
// Throws if the required env vars are missing so callers always target the configured host.
function getBackendUrl(): string {
  const envBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL;

  if (!envBackendUrl || envBackendUrl.trim() === "") {
    throw new Error(
      "[Backend Client] NEXT_PUBLIC_BACKEND_URL or BACKEND_URL must be set to the backend base URL."
    );
  }

  return envBackendUrl.trim().replace(/\/+$/, "");
}

// Get BACKEND_URL at runtime
const BACKEND_URL = getBackendUrl();

// Only log in server context to avoid exposing URL in client bundles
if (typeof window === 'undefined') {
  console.log('[Backend Client] BACKEND_URL:', BACKEND_URL);
  const envSource = process.env.NEXT_PUBLIC_BACKEND_URL
    ? 'NEXT_PUBLIC_BACKEND_URL'
    : process.env.BACKEND_URL
      ? 'BACKEND_URL'
      : 'undefined (should not happen)';
  console.log('[Backend Client] BACKEND_URL source:', envSource);
}

// Storage key for backend session cookies
const BACKEND_COOKIES_KEY = 'backend_scraper_cookies';

export type ScraperUserType = 'new' | 'old';

export interface ScraperRequest {
  email: string;
  password?: string;
  force_refresh?: boolean;
  user_id?: string;
  userId?: string;
  requestedType?: CacheDataType;
  userType?: ScraperUserType;
}

export interface ScraperResponse<T = unknown> {
  success: boolean;
  data?: T;
  reason?: string;
  cached?: boolean;
  count?: number;
}

/**
 * Go backend login response format (NEW: includes user object)
 */
export interface GoBackendLoginResponse {
  authenticated: boolean;
  success?: boolean;
  token?: string; // Session token from login response body
  user?: {
    name: string;
    semester: number;
    regnumber: string;
    department: string;
    mobile: string;
    program: string;
    batch: string;
    year: number;
    section: string;
    specialization: string;
  };
  session?: Record<string, unknown>;
  lookup?: Record<string, unknown>;
  cookies?: string;
  status?: number;
  message?: string;
  errors?: string[] | null;
}

/**
 * Go backend login request format (NEW: includes email field)
 */
export interface GoBackendLoginRequest {
  email: string;
  password: string;
  cdigest?: string;
  captcha?: string;
}

function buildBackendRequestPayload(data: ScraperRequest): Record<string, unknown> {
  const userId = data.userId ?? data.user_id ?? '';
  const payload: Record<string, unknown> = {
    userId,
    email: data.email,
    userType: data.userType ?? 'old',
  };

  if (userId) {
    payload.user_id = userId;
  }

  if (data.password !== undefined) {
    payload.password = data.password;
  }

  if (data.force_refresh !== undefined) {
    payload.force_refresh = data.force_refresh;
    payload.forceRefresh = data.force_refresh;
  }

  if (data.requestedType) {
    payload.dataType = data.requestedType;
  }

  return payload;
}

function buildLoginPayload(email: string, password?: string) {
  return {
    email,
    password: password ?? "",
  };
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

const ACTION_CACHE_TYPE_MAP: Record<string, CacheDataType | null> = {
  get_attendance_data: 'attendance',
  get_marks_data: 'marks',
  get_timetable_data: 'timetable',
  get_calendar_data: 'calendar',
};

function getCacheTypeForAction(action: string): CacheDataType | null {
  return ACTION_CACHE_TYPE_MAP[action] ?? null;
}

async function determineUserType(
  userId: string | undefined,
  requestedType?: CacheDataType | null,
  forceRefresh?: boolean
): Promise<ScraperUserType> {
  if (forceRefresh) {
    return 'new';
  }

  if (!userId || !requestedType) {
    return 'old';
  }

  try {
    const entries = await fetchUserCacheEntries(userId, [requestedType]);
    const entry = entries[requestedType];
    return entry && entry.data ? 'old' : 'new';
  } catch (error) {
    console.error(`[ScraperClient] Failed to read cache entry for ${requestedType}:`, error);
    return 'old';
  }
}

export async function hydrateCacheEntry(
  userId: string,
  dataType: CacheDataType
): Promise<{
  success: boolean;
  data: unknown | null;
  data_type: CacheDataType;
  expiresAt: string | null;
  isExpired: boolean;
}> {
  try {
    const entries = await fetchUserCacheEntries(userId, [dataType]);
    const entry = entries[dataType];
    const expiresAt = entry?.expiresAt ?? null;
    const isExpired = expiresAt ? new Date() > new Date(expiresAt) : false;
    return {
      success: true,
      data: entry?.data ?? null,
      data_type: dataType,
      expiresAt,
      isExpired,
    };
  } catch (error) {
    console.error(`[ScraperClient] Failed to hydrate cache entry for ${dataType}:`, error);
    return {
      success: false,
      data: null,
      data_type: dataType,
      expiresAt: null,
      isExpired: true,
    };
  }
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
 * Fetch user data from Go backend using session token and user credentials
 * GET /user endpoint with X-CSRF-Token, X-User-Id, X-Email headers
 */
export async function fetchUserDataFromGoBackend(
  token: string,
  userId: string,
  email: string,
  password: string
): Promise<{ success: boolean; data?: GoBackendUserData; error?: string }> {
  const requestStartTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const backendUrl = getBackendUrl();
  console.log(`[Backend Client] 👤 Fetching user data from Go backend`);
  console.log(`[Backend Client]   - Token: ${token.substring(0, 10)}...`);
  console.log(`[Backend Client]   - User ID: ${userId}`);
  console.log(`[Backend Client]   - Email: ${email}`);
  console.log(`[Backend Client]   - Backend URL: ${backendUrl}`);

  try {
    const fetchStartTime = Date.now();

    // Build headers with session token and user credentials
    const requestBody = buildLoginPayload(email, password);
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
      'X-User-Id': userId,
      'X-Email': email,
    };

    // Log request details
    console.log(`[Backend Client] 🌐 FETCHUSERDATAFROMGOBACKEND - REQUEST DETAILS`);
    console.log(`[Backend Client]   📍 Full URL: GET ${backendUrl}/user`);
    console.log(`[Backend Client]   📊 Request ID: ${Date.now()}`);
    console.log(`[Backend Client] 📨 HEADERS BEING SENT:`);
    Object.entries(headers).forEach(([key, value]) => {
      if (key.toLowerCase().includes('token')) {
        console.log(`[Backend Client]   ${key}: ${String(value).substring(0, 20)}...`);
      } else {
        console.log(`[Backend Client]   ${key}: ${value}`);
      }
    });
    console.log(`[Backend Client] 📦 REQUEST BODY:`, JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${backendUrl}/user`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const fetchDuration = Date.now() - fetchStartTime;

    clearTimeout(timeoutId);

    console.log(`[Backend Client] 📡 HTTP RESPONSE RECEIVED: ${fetchDuration}ms`);
    console.log(`[Backend Client]   📊 Status: ${response.status} ${response.statusText}`);
    console.log(`[Backend Client]   ✅ OK: ${response.ok}`);

    // Log response headers
    console.log(`[Backend Client] 📋 RESPONSE HEADERS:`);
    response.headers.forEach((value, key) => {
      console.log(`[Backend Client]   ${key}: ${value}`);
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(`[Backend Client] ❌ HTTP Error Response:`);
      console.error(`[Backend Client]   - Status: ${response.status} ${response.statusText}`);
      console.error(`[Backend Client]   - Response Body: ${errorText}`);

      const totalDuration = Date.now() - requestStartTime;
      console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      return {
        success: false,
        error: `User data fetch error: ${response.status} ${response.statusText}`,
      };
    }

    const parseStartTime = Date.now();
    const responseData: { success: boolean; data?: GoBackendUserData; error?: string } = await response.json();
    const parseDuration = Date.now() - parseStartTime;
    const totalDuration = Date.now() - requestStartTime;

    console.log(`[Backend Client] 📊 Response parsed: ${parseDuration}ms`);
    console.log(`[Backend Client] 📦 RESPONSE BODY:`, JSON.stringify(responseData, null, 2));

    console.log(`[Backend Client] 📊 Response parsed: ${parseDuration}ms`);
    console.log(`[Backend Client]   - Success: ${responseData.success}`);
    console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return responseData;
  } catch (error) {
    clearTimeout(timeoutId);
    const totalDuration = Date.now() - requestStartTime;

    if (error instanceof Error && error.name === 'AbortError') {
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error(`[Backend Client] ❌ USER DATA FETCH TIMEOUT`);
      console.error(`[Backend Client]   - Duration: ${totalDuration}ms (exceeded 60s limit)`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      return {
        success: false,
        error: 'User data fetch timeout after 60 seconds',
      };
    }

    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(`[Backend Client] ❌ USER DATA FETCH ERROR`);
    console.error(`[Backend Client]   - Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[Backend Client]   - Duration: ${totalDuration}ms`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error fetching user data',
    };
  }
}

/**
 * Fetch user data from Go backend
 * Sends GET request to /user with X-CSRF-Token header
 * @returns User data or null on error
 * @deprecated This uses cookie-based auth, new implementation uses header-based auth
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

    const requestBody = buildLoginPayload('', '');
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': cookies,
    };

    const fetchStartTime = Date.now();
    const backendUrl = getBackendUrl();
    console.log(`[Backend Client] 📦 REQUEST BODY:`, JSON.stringify(requestBody, null, 2));
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
 * Login to Go backend and store cookies (NEW: includes email field)
 * @param account - User account/email
 * @param password - User password
 * @param email - User email (same as account, required by new API format)
 * @param cdigest - Optional captcha digest
 * @param captcha - Optional captcha answer
 * @returns Login response with authentication status and user data
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
      email: account,
      password,
      ...(cdigest ? { cdigest } : {}),
      ...(captcha ? { captcha } : {}),
    };

    // Log request details
    console.log(`[Backend Client] 🌐 LOGINTOGOBACKEND - REQUEST DETAILS`);
    console.log(`[Backend Client]   📍 Full URL: POST ${backendUrl}/login`);
    console.log(`[Backend Client]   📊 Request ID: ${Date.now()}`);
    console.log(`[Backend Client] 📨 HEADERS BEING SENT:`);
    console.log(`[Backend Client]   Content-Type: application/json`);
    console.log(`[Backend Client] 📦 REQUEST BODY:`, JSON.stringify(requestBody, null, 2));

    const fetchStartTime = Date.now();
    const response = await fetch(`${backendUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const fetchDuration = Date.now() - fetchStartTime;

    clearTimeout(timeoutId);

    console.log(`[Backend Client] 📡 HTTP RESPONSE RECEIVED: ${fetchDuration}ms`);
    console.log(`[Backend Client]   📊 Status: ${response.status} ${response.statusText}`);
    console.log(`[Backend Client]   ✅ OK: ${response.ok}`);

    // Log response headers
    console.log(`[Backend Client] 📋 RESPONSE HEADERS:`);
    response.headers.forEach((value, key) => {
      console.log(`[Backend Client]   ${key}: ${value}`);
    });

    const parseStartTime = Date.now();
    const responseData: GoBackendLoginResponse = await response.json();
    const parseDuration = Date.now() - parseStartTime;
    const totalDuration = Date.now() - requestStartTime;

    console.log(`[Backend Client] 📊 Response parsed: ${parseDuration}ms`);
    console.log(`[Backend Client] 📦 RESPONSE BODY:`, JSON.stringify(responseData, null, 2));
    console.log(`[Backend Client]   🔐 Authenticated: ${responseData.authenticated}`);
    console.log(`[Backend Client]   - Status: ${responseData.status || "none"}`);
    console.log(`[Backend Client]   - Message: ${responseData.message || "none"}`);
    console.log(`[Backend Client]   - Cookies received: ${responseData.cookies ? "✓" : "✗"}`);
    console.log(`[Backend Client]   - Session: ${responseData.session ? "✓" : "✗"}`);
    console.log(`[Backend Client]   - Lookup: ${responseData.lookup ? "✓" : "✗"}`);
    if (responseData.errors) {
      console.log(`[Backend Client]   - Errors: ${JSON.stringify(responseData.errors)}`);
    }

    // Store cookies if authentication was successful (legacy support)
    if (responseData.authenticated && responseData.cookies) {
      const stored = setBackendCookies(responseData.cookies);
      if (stored) {
        console.log(`[Backend Client] ✅ Cookies stored successfully`);
      } else {
        console.error(`[Backend Client] ❌ Failed to store cookies`);
      }
    } else if (responseData.authenticated) {
      // Authentication succeeded but no cookies returned - this is OK for direct auth endpoints
      console.log(`[Backend Client] ✅ Authentication successful (no cookies needed for direct auth)`);
    } else if (!responseData.authenticated) {
      // Clear any existing cookies on failed login
      clearBackendCookies();
      console.log(`[Backend Client] 🗑️ Cleared cookies due to failed authentication`);
    }

    console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Response includes token from JSON body
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
 * Fetch data from Go backend (NEW: for refreshing cached data)
 * Sends POST request with user credentials to trigger data refresh
 * @param dataType - Type of data to fetch ('attendance', 'marks', 'timetable')
 * @param user_id - Supabase user ID
 * @param email - User email
 * @param password - User password
 * @returns Simple success response (data will be fetched from Supabase)
 */
export async function fetchDataFromGoBackend(
  dataType: 'attendance' | 'marks' | 'timetable',
  user_id: string,
  email: string,
  password: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const requestStartTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const backendUrl = getBackendUrl();
  console.log(`[Backend Client] 🔄 Fetching data from Go backend`);
  console.log(`[Backend Client]   - Data Type: ${dataType}`);
  console.log(`[Backend Client]   - User ID: ${user_id}`);
  console.log(`[Backend Client]   - Email: ${email}`);
  console.log(`[Backend Client]   - Backend URL: ${backendUrl}`);

  try {
    const endpoint = `/${dataType}`;
    const fetchStartTime = Date.now();

    // Build headers with authentication
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    // Add authentication headers in new format
    headers['X-User-Id'] = user_id;
    headers['X-Email'] = email;
    headers['X-Password'] = password;

    // Log request details
    console.log(`[Backend Client] 🌐 FETCHDATAFROMGOBACKEND - REQUEST DETAILS`);
    console.log(`[Backend Client]   📍 Full URL: GET ${backendUrl}${endpoint}`);
    console.log(`[Backend Client]   📊 Request ID: ${Date.now()}`);
    console.log(`[Backend Client] 📨 HEADERS BEING SENT:`);
    Object.entries(headers).forEach(([key, value]) => {
      if (key.toLowerCase().includes('password')) {
        console.log(`[Backend Client]   ${key}: ${String(value).substring(0, 3)}***`);
      } else {
        console.log(`[Backend Client]   ${key}: ${value}`);
      }
    });
    const requestBody = buildLoginPayload(email, password);
    console.log(`[Backend Client] 📦 REQUEST BODY:`, JSON.stringify(requestBody, null, 2));

    const response = await fetch(`${backendUrl}${endpoint}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    const fetchDuration = Date.now() - fetchStartTime;

    clearTimeout(timeoutId);

    console.log(`[Backend Client] 📡 HTTP RESPONSE RECEIVED: ${fetchDuration}ms`);
    console.log(`[Backend Client]   📊 Status: ${response.status} ${response.statusText}`);
    console.log(`[Backend Client]   ✅ OK: ${response.ok}`);

    // Log response headers
    console.log(`[Backend Client] 📋 RESPONSE HEADERS:`);
    response.headers.forEach((value, key) => {
      console.log(`[Backend Client]   ${key}: ${value}`);
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      console.error(`[Backend Client] ❌ HTTP Error Response:`);
      console.error(`[Backend Client]   - Status: ${response.status} ${response.statusText}`);
      console.error(`[Backend Client]   - Response Body: ${errorText}`);

      const totalDuration = Date.now() - requestStartTime;
      console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      return {
        success: false,
        error: `Data fetch error: ${response.status} ${response.statusText}`,
      };
    }

    const parseStartTime = Date.now();
    const rawResponseData = await response.json();
    const parseDuration = Date.now() - parseStartTime;
    const totalDuration = Date.now() - requestStartTime;

    console.log(`[Backend Client] 📊 Response parsed: ${parseDuration}ms`);
    console.log(`[Backend Client] 📦 RESPONSE BODY:`, JSON.stringify(rawResponseData, null, 2));

    console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Check if response has success field (error responses)
    if (typeof rawResponseData === 'object' && rawResponseData !== null && 'success' in rawResponseData) {
      const successResponse = rawResponseData as { success: boolean; error?: string };
      if (!successResponse.success) {
        return {
          success: false,
          error: successResponse.error || 'Backend returned error',
        };
      }
    }

    // Return the actual data from backend
    return {
      success: true,
      data: rawResponseData,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const totalDuration = Date.now() - requestStartTime;

    if (error instanceof Error && error.name === 'AbortError') {
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error(`[Backend Client] ❌ DATA FETCH TIMEOUT`);
      console.error(`[Backend Client]   - Duration: ${totalDuration}ms (exceeded 60s limit)`);
      console.error(`[Backend Client]   - Data Type: ${dataType}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      return {
        success: false,
        error: 'Data fetch timeout after 60 seconds',
      };
    }

    console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.error(`[Backend Client] ❌ DATA FETCH ERROR`);
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
 * Map action to Go backend endpoint
 */
function getEndpointForAction(action: string): { method: string; path: string } | null {
  const endpointMap: Record<string, { method: string; path: string }> = {
    'validate_credentials': { method: 'POST', path: '/login' },
    'get_attendance_data': { method: 'POST', path: '/attendance' },
    'get_marks_data': { method: 'POST', path: '/marks' },
    'get_timetable_data': { method: 'POST', path: '/timetable' },
    'get_calendar_data': { method: 'POST', path: '/calendar' },
    'get_user_data': { method: 'POST', path: '/user' },
    'get_all_data': { method: 'POST', path: '/get' },
    'get_static_data': { method: 'POST', path: '/get' },
    'get_dynamic_data': { method: 'POST', path: '/get' },
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
  console.log(`[Backend Client] 🚀 CALLBACKENDSCRAPER - START`);
  console.log(`[Backend Client]   📝 Action: ${action}`);
  console.log(`[Backend Client]   👤 Email: ${data.email}`);
  console.log(`[Backend Client]   🔑 Password: ${data.password ? "✓ Provided (" + data.password.length + " chars)" : "✗ Not provided"}`);
  console.log(`[Backend Client]   🔄 Force refresh: ${data.force_refresh || false}`);
  console.log(`[Backend Client]   🆔 User ID: ${data.user_id || data.userId || 'none'}`);
  console.log(`[Backend Client]   📊 Request ID: ${Date.now()}`);

  const normalizedUserId = data.user_id ?? data.userId;
  const targetDataType = data.requestedType ?? getCacheTypeForAction(action);
  const resolvedUserType = await determineUserType(
    normalizedUserId,
    targetDataType,
    Boolean(data.force_refresh)
  );
  const requestPayload: ScraperRequest = {
    ...data,
    userType: data.userType ?? resolvedUserType,
  };

  if (normalizedUserId) {
    requestPayload.userId = normalizedUserId;
    requestPayload.user_id = normalizedUserId;
  }

  if (targetDataType) {
    requestPayload.requestedType = targetDataType;
  }

  console.log(`[Backend Client]   📦 Target data type: ${targetDataType || 'bulk/unknown'}`);
  console.log(`[Backend Client]   🧭 Resolved userType: ${requestPayload.userType}`);

  try {
    // Handle special cases for get_static_data and get_dynamic_data
    if (action === 'get_static_data') {
      // Fetch timetable and calendar separately
      const [timetableResult, calendarResult] = await Promise.all([
        callGoEndpoint('POST', '/timetable', requestPayload, controller),
        callGoEndpoint('POST', '/calendar', requestPayload, controller),
      ]);

      const staticData = {
        success: (timetableResult.success || calendarResult.success),
        data: {
          timetable: timetableResult.success ? timetableResult.data : null,
          calendar: calendarResult.success ? calendarResult.data : null,
        },
        reason: !timetableResult.success && !calendarResult.success
          ? `Timetable: ${timetableResult.reason || 'Unknown'}, Calendar: ${calendarResult.reason || 'Unknown'}`
          : undefined,
      } as unknown as ScraperResponse<T>;

      clearTimeout(timeoutId);
      const totalDuration = Date.now() - requestStartTime;
      console.log(`[Backend Client] ✅ Total duration: ${totalDuration}ms`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      return staticData;
    }

    if (action === 'get_dynamic_data') {
      // Fetch attendance and marks separately
      const [attendanceResult, marksResult] = await Promise.all([
        callGoEndpoint('POST', '/attendance', requestPayload, controller),
        callGoEndpoint('POST', '/marks', requestPayload, controller),
      ]);

      const dynamicData = {
        success: (attendanceResult.success || marksResult.success),
        data: {
          attendance: attendanceResult.success ? attendanceResult.data : null,
          marks: marksResult.success ? marksResult.data : null,
        },
        reason: !attendanceResult.success && !marksResult.success
          ? `Attendance: ${attendanceResult.reason || 'Unknown'}, Marks: ${marksResult.reason || 'Unknown'}`
          : undefined,
      } as unknown as ScraperResponse<T>;

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
        reason: `Unknown action: ${action}`,
      };
    }

    // Call the Go backend endpoint
    const result = await callGoEndpoint<T>(endpoint.method, endpoint.path, requestPayload, controller);
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

      return { success: false, reason: 'Request timeout after 60 seconds' };
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
      reason: error instanceof Error ? error.message : 'Unknown error',
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

  console.log(`[Backend Client] 🌐 CALLGOENDPOINT - REQUEST DETAILS`);
  console.log(`[Backend Client]   📍 Full URL: ${method} ${fullUrl}`);
  console.log(`[Backend Client]   🛣️  Path: ${path} → ${normalizedPath}`);
  console.log(`[Backend Client]   🌐 Backend Base: ${backendBaseUrl}`);
  console.log(`[Backend Client]   📊 Request ID: ${Date.now()}`);

  // Get stored cookies for authentication
  const cookies = getBackendCookies();

  // Build request headers
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Add authentication headers in new format
  headers['X-User-Id'] = data.user_id || '';
  headers['X-Email'] = data.email;
  headers['X-Password'] = data.password || '';

  console.log(`[Backend Client] 🆔 HEADER X-User-Id: ${data.user_id || 'none'}`);
  console.log(`[Backend Client] 📧 HEADER X-Email: ${data.email}`);
  console.log(`[Backend Client] 🔐 HEADER X-Password: ${data.password ? data.password.substring(0, 3) + '***' : 'none'}`);

  // Keep cookie header as fallback (except for /login and /hello)
  if (path !== '/login' && path !== '/hello' && cookies) {
    headers['X-CSRF-Token'] = cookies;
    console.log(`[Backend Client] 🍪 HEADER X-CSRF-Token: ${cookies.substring(0, 20)}...`);
  }

  // Log all headers being sent
  console.log(`[Backend Client] 📨 HEADERS BEING SENT:`);
  Object.entries(headers).forEach(([key, value]) => {
    if (key.toLowerCase().includes('password')) {
      console.log(`[Backend Client]   ${key}: ${String(value).substring(0, 3)}***`);
    } else if (key.toLowerCase().includes('token') || key.toLowerCase().includes('csrf')) {
      console.log(`[Backend Client]   ${key}: ${String(value).substring(0, 20)}...`);
    } else {
      console.log(`[Backend Client]   ${key}: ${value}`);
    }
  });

  const requestBody = buildBackendRequestPayload(data);

  // Build request options
  const requestOptions: RequestInit = {
    method,
    headers,
    signal: controller?.signal,
  };

  // Log the complete endpoint URL
  console.log(`[Backend Client] 🌐 FULL ENDPOINT URL: ${method} ${fullUrl}`);

  // For POST requests (login), include body
  // Note: Login should use loginToGoBackend() function instead
  console.log(`[Backend Client] 📦 REQUEST BODY:`, JSON.stringify(requestBody, null, 2));

  if (method === 'POST' && path === '/login') {
    console.warn(`[Backend Client] ⚠️ Direct POST to /login - use loginToGoBackend() instead`);
    requestOptions.body = JSON.stringify(requestBody);
    console.log(`[Backend Client] 📦 REQUEST BODY ATTACHED (${method})`);
  } else if (method !== 'GET' && method !== 'HEAD') {
    requestOptions.body = JSON.stringify(requestBody);
    console.log(`[Backend Client] 📦 REQUEST BODY ATTACHED (${method})`);
  } else {
    console.log(`[Backend Client] 🚫 GET/HEAD detected: Skipping body attachment to prevent Node.js crash.`);
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
      reason: `Network error: ${fetchError instanceof Error ? fetchError.message : 'Failed to connect to backend'}`,
    };
  }

  const fetchDuration = Date.now() - fetchStartTime;

  console.log(`[Backend Client] 📡 HTTP RESPONSE RECEIVED: ${fetchDuration}ms`);
  console.log(`[Backend Client]   📊 Status: ${response.status} ${response.statusText}`);
  console.log(`[Backend Client]   ✅ OK: ${response.ok}`);

  // Log response headers
  console.log(`[Backend Client] 📋 RESPONSE HEADERS:`);
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
    console.log(`[Backend Client]   ${key}: ${value}`);
  });

  // Handle 401 Unauthorized - session expired, clear cookies
  if (response.status === 401) {
    console.error(`[Backend Client] ❌ 401 Unauthorized - Session expired`);
    clearBackendCookies();
    return {
      success: false,
      reason: 'Session expired. Please re-login.',
    };
  }

  // Handle 429 Too Many Requests - rate limit
  if (response.status === 429) {
    console.error(`[Backend Client] ❌ 429 Too Many Requests - Rate limit exceeded`);
    return {
      success: false,
      reason: 'Rate limit exceeded. Please wait 1 minute before retrying.',
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
        reason: `Endpoint not found: ${method} ${fullUrl}. Please verify the Go backend is running at ${backendBaseUrl} and the endpoint ${path} exists.`,
      };
    }

    return {
      success: false,
      reason: `Backend error: ${response.status} ${response.statusText}`,
    };
  }

  const parseStartTime = Date.now();
  const responseData = await response.json();
  const parseDuration = Date.now() - parseStartTime;

  console.log(`[Backend Client] 📊 Response parsed: ${parseDuration}ms`);
  console.log(`[Backend Client] 📦 RESPONSE BODY:`, JSON.stringify(responseData, null, 2));

  let result: ScraperResponse<T>;

  if (responseData && typeof responseData === 'object') {
    if ('success' in responseData) {
      result = {
        success: responseData.success !== false,
        data: responseData.data as T,
        reason: typeof responseData.reason === 'string' ? responseData.reason : undefined,
        cached: responseData.cached,
        count: responseData.count,
      };
    } else if ('status' in responseData) {
      const status = responseData.status as number;
      const error = responseData.error as string | null | undefined;

      if (status === 200 && !error) {
        const { status: _status, error: _error, ...dataFields } = responseData;
        result = {
          success: true,
          data: dataFields as T,
        };
      } else {
        result = {
          success: false,
          reason: error || `Backend returned status ${status}`,
        };
      }
    } else {
      result = {
        success: true,
        data: responseData as T,
      };
    }
  } else {
    result = {
      success: true,
      data: responseData as T,
    };
  }

  console.log(`[Backend Client]   - Success: ${result.success}`);
  console.log(`[Backend Client]   - Reason: ${result.reason || "none"}`);
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



/**
 * Start keep-warm mechanism (sends test ping immediately)
 * Keeps the backend scraper service warm by sending periodic health checks
 */
export async function startKeepWarm(): Promise<void> {
  // Send immediate test ping to warm up the backend
  console.log('[Scraper Client] Sending immediate keep-warm ping to backend');
  const isHealthy = await checkBackendHealth();
  if (isHealthy) {
    console.log('[Scraper Client] Backend is healthy (keep-warm ping successful)');
  } else {
    console.warn('[Scraper Client] Backend health check failed (keep-warm ping unsuccessful)');
  }
}
