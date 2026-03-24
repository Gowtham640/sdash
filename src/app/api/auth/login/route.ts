import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { SignInResponse } from "@/lib/auth/types";
import { setSessionCookies } from "@/lib/auth/sessionCookies";

// Wrap imports in try-catch to handle potential import errors
let handleUserSignIn: ((email: string, password: string, captchaToken?: string | null) => Promise<{ session: { access_token: string; refresh_token: string }; user: Record<string, unknown> }>) | undefined;
let AuthErrorCode: Record<string, string> | undefined;

try {
  const authModule = require("@/lib/auth");
  handleUserSignIn = authModule.handleUserSignIn;
  AuthErrorCode = authModule.AuthErrorCode;
} catch (error) {
  console.error("[API] Failed to import auth module:", error);
}

/**
 * HTTP status code mapping for auth errors
 */
const ErrorStatusCodeMap: Record<string, number> = {
  INVALID_EMAIL: 400,
  INVALID_PASSWORD: 400,
  MISSING_CREDENTIALS: 400,
  PORTAL_LOGIN_FAILED: 401,
  PORTAL_CONNECTION_ERROR: 503,
  PORTAL_TIMEOUT: 504,
  INVALID_CREDENTIALS: 401,
  SUPABASE_AUTH_ERROR: 500,
  SUPABASE_INSERT_ERROR: 500,
  SUPABASE_QUERY_ERROR: 500,
  INTERNAL_ERROR: 500,
  SESSION_CREATION_FAILED: 500,
  USER_CREATION_FAILED: 500,
};

export async function POST(request: NextRequest) {
  console.log("[API] POST /api/auth/login received");

  try {
    // Check if auth module loaded
    if (!handleUserSignIn) {
      console.error("[API] Auth module not loaded!");
      return NextResponse.json(
        {
          success: false,
          error: "Authentication module failed to load. Check server logs.",
          errorCode: "MODULE_LOAD_ERROR",
        },
        { status: 500 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { email, password, captcha } = body;
    console.log(`[API] Sign-in request for: ${email}`);

    // Call authentication handler
    const result = (await handleUserSignIn(email, password, captcha ?? null)) as SignInResponse;

    // If sign-in failed, return error response
    if (!result.session || (result as { error?: string }).error) {
      const statusCode =
        ErrorStatusCodeMap[(result as { errorCode?: string }).errorCode || "INTERNAL_ERROR"] ||
        500;

      const errorResult = result as { error?: string };
      console.error(
        `[API] Sign-in failed with status ${statusCode}: ${errorResult.error}`
      );

      return NextResponse.json(
        {
          success: false,
          error: errorResult.error,
          errorCode: (result as { errorCode?: string }).errorCode,
        },
        { status: statusCode }
      );
    }

    // Successfully signed in
    console.log(`[API] Successfully signed in: ${email}`);

    // Login to Go backend to get cookies for subsequent requests (only if needed)
    if (!result.skipGoBackend) {
      console.log(`[API] 🔐 Logging in to Go backend...`);
      try {
        const { loginToGoBackend } = await import('@/lib/scraperClient');
        const goLoginResult = await loginToGoBackend(email, password);
        
        if (goLoginResult.authenticated && goLoginResult.cookies) {
          console.log(`[API] ✅ Go backend login successful - cookies stored`);
        } else {
          console.warn(`[API] ⚠️ Go backend login failed or no cookies returned:`, goLoginResult.message || 'Unknown error');
        }
      } catch (goLoginError) {
        console.error(`[API] ❌ Go backend login error (non-blocking):`, goLoginError);
        // Don't fail the login if Go backend login fails - user can still use the app
      }
    } else {
      console.log(`[API] Skipping Go backend login (existing Supabase user)`);
    }

    // User data sync disabled - project should not write to Supabase tables

    const response = NextResponse.json(
      {
        success: true,
        data: {
          session: result.session,
          user: result.user,
        },
      },
      { status: 200 }
    );

    if (result.session) {
      await setSessionCookies(response, result.session, result.user?.role || 'public');
    }

    return response;
  } catch (error) {
    console.error(
      `[API] Unexpected error: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error(`[API] Error stack:`, error);

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        errorCode: "INTERNAL_ERROR",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
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
