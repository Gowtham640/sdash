import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { setSessionCookies } from "@/lib/auth/sessionCookies";

const sessionCookieName = "sdash_access_token";
const roleCookieName = "sdash_user_role";
const refreshCookieName = "sdash_refresh_token";
const expiresCookieName = "sdash_session_expires_at";

const isProduction = process.env.NODE_ENV === "production";

const cookieCleanupOptions = {
  path: "/",
  maxAge: 0,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProduction,
};

function clearAuthCookies(response: NextResponse) {
  response.cookies.set(sessionCookieName, "", cookieCleanupOptions);
  response.cookies.set(roleCookieName, "", cookieCleanupOptions);
  response.cookies.set(refreshCookieName, "", cookieCleanupOptions);
  response.cookies.set(expiresCookieName, "", cookieCleanupOptions);
}

/**
 * Read JWT exp (seconds since epoch). Auth decisions must not use sdash_session_expires_at.
 */
function getJwtExpirySeconds(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isAccessTokenValid(token: string | undefined): boolean {
  if (!token) {
    return false;
  }
  const exp = getJwtExpirySeconds(token);
  if (exp === null) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp > nowSeconds;
}

/**
 * Refresh Supabase session using httpOnly refresh cookie; returns new session + role for cookies.
 */
async function refreshSessionFromCookies(
  refreshToken: string,
  fallbackRole: string | undefined
): Promise<{ session: Session; role: string } | null> {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data?.session) {
    return null;
  }

  let role = fallbackRole ?? "public";
  const userId = data.session.user?.id;

  if (userId) {
    try {
      const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
      const { data: userRow } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", userId)
        .single();

      if (userRow?.role) {
        role = userRow.role;
      }
    } catch {
      // Edge or missing service role: keep role from existing cookie
    }
  }

  return { session: data.session, role };
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const accessToken = req.cookies.get(sessionCookieName)?.value;
  const refreshToken = req.cookies.get(refreshCookieName)?.value;
  const roleCookie = req.cookies.get(roleCookieName)?.value;

  const isAuthPage = pathname === "/auth" || pathname.startsWith("/auth/");
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");

  const accessValid = isAccessTokenValid(accessToken);

  let refreshed: { session: Session; role: string } | null = null;

  if (!accessValid && refreshToken) {
    refreshed = await refreshSessionFromCookies(refreshToken, roleCookie);
  }

  const hasSession = accessValid || refreshed !== null;

  const effectiveRole = refreshed?.role ?? roleCookie ?? "public";

  const withRefreshedCookies = async (res: NextResponse) => {
    if (refreshed) {
      await setSessionCookies(res, refreshed.session, refreshed.role);
    }
    return res;
  };

  if (isAuthPage) {
    if (accessValid) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      return NextResponse.redirect(redirectUrl);
    }

    if (refreshed) {
      const redirectUrl = req.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      const res = NextResponse.redirect(redirectUrl);
      return withRefreshedCookies(res);
    }

    // Refresh failed while refresh cookie was present, or stale access without refresh
    const refreshFailed =
      !accessValid && Boolean(refreshToken) && refreshed === null;
    const staleAccessNoRefresh =
      !accessValid && Boolean(accessToken) && !refreshToken;

    if (refreshFailed || staleAccessNoRefresh) {
      const res = NextResponse.next();
      clearAuthCookies(res);
      return res;
    }

    return NextResponse.next();
  }

  if (!hasSession) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/auth";
    redirectUrl.search = "";
    const res = NextResponse.redirect(redirectUrl);
    clearAuthCookies(res);
    return res;
  }

  if (isAdminPage && effectiveRole !== "admin") {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    const res = NextResponse.redirect(redirectUrl);
    return withRefreshedCookies(res);
  }

  const res = NextResponse.next();
  return withRefreshedCookies(res);
}

export const config = {
  matcher: [
    "/auth",
    "/auth/:path*",
    "/dashboard",
    "/dashboard/:path*",
    "/attendance",
    "/attendance/:path*",
    "/marks",
    "/marks/:path*",
    "/timetable",
    "/timetable/:path*",
    "/calender",
    "/calender/:path*",
    "/admin",
    "/admin/:path*",
  ],
};
