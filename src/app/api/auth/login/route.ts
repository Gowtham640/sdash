import { NextRequest, NextResponse } from "next/server";

// Wrap imports in try-catch to handle potential import errors
let handleUserSignIn: ((email: string, password: string) => Promise<{ session: { access_token: string; refresh_token: string }; user: Record<string, unknown> }>) | undefined;
let AuthErrorCode: Record<string, string> | undefined;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    const { email, password } = body;

    console.log(`[API] Sign-in request for: ${email}`);

    // Call authentication handler
    const result = await handleUserSignIn(email, password);

    // If sign-in failed, return error response
    if (!result.session || result.error) {
      const statusCode =
        ErrorStatusCodeMap[result.errorCode || "INTERNAL_ERROR"] ||
        500;

      console.error(
        `[API] Sign-in failed with status ${statusCode}: ${result.error}`
      );

      return NextResponse.json(
        {
          success: false,
          error: result.error,
          errorCode: result.errorCode,
        },
        { status: statusCode }
      );
    }

    // Successfully signed in
    console.log(`[API] Successfully signed in: ${email}`);

    return NextResponse.json(
      {
        success: true,
        data: {
          session: result.session,
          user: result.user,
        },
      },
      { status: 200 }
    );
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
