import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Queues portal login on the Go backend (POST /login) without creating a Supabase session.
 * Used on the auth page as soon as the user enters the CAPTCHA path so the worker can start
 * while the user completes hCaptcha. Full sign-in still goes through POST /api/auth/login later.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body as { email?: string; password?: string };

    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || password.length < 6) {
      return NextResponse.json(
        { success: false, error: "Invalid email or password format" },
        { status: 400 }
      );
    }

    const { loginToGoBackend } = await import("@/lib/scraperClient");
    const result = await loginToGoBackend(email, password);

    const accepted = result.success === true || result.authenticated === true;

    if (!accepted) {
      console.warn("[API] queue-go-login: Go backend did not accept queue request:", {
        email,
        message: result.message,
      });
    } else {
      console.log("[API] queue-go-login: Go backend login queued or accepted for", email);
    }

    // Always 200 so the CAPTCHA UX is unchanged; full auth is validated on POST /api/auth/login.
    return NextResponse.json({ success: true, queued: accepted });
  } catch (error) {
    console.error(
      "[API] queue-go-login unexpected error:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
