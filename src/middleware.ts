import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const sessionCookieName = "sdash_access_token";
const roleCookieName = "sdash_user_role";
const refreshCookieName = "sdash_refresh_token";
const expiresCookieName = "sdash_session_expires_at";

const cookieCleanupOptions = {
  path: "/",
  maxAge: 0,
  httpOnly: true,
  sameSite: "lax" as const,
};

function clearAuthCookies(response: NextResponse) {
  response.cookies.set(sessionCookieName, "", cookieCleanupOptions);
  response.cookies.set(roleCookieName, "", cookieCleanupOptions);
  response.cookies.set(refreshCookieName, "", cookieCleanupOptions);
  response.cookies.set(expiresCookieName, "", cookieCleanupOptions);
}

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;
    const token = req.cookies.get(sessionCookieName) ?? undefined;
    const role = req.cookies.get(roleCookieName) ?? undefined;
    const expiresAt = req.cookies.get(expiresCookieName);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const parsedExpires =
        expiresAt && !Number.isNaN(Number(expiresAt.value))
            ? Number(expiresAt.value)
            : NaN;
    const sessionExpired =
        Boolean(token) && (!Number.isFinite(parsedExpires) || parsedExpires <= nowSeconds);

    const isAuthPage = pathname === "/auth" || pathname.startsWith("/auth/");
    const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");

    if (isAuthPage) {
        if (token && !sessionExpired) {
            const redirectUrl = req.nextUrl.clone();
            redirectUrl.pathname = "/dashboard";
            return NextResponse.redirect(redirectUrl);
        }
        if (sessionExpired) {
            const response = NextResponse.next();
            clearAuthCookies(response);
            return response;
        }
        return NextResponse.next();
    }

    if (!token || sessionExpired) {
        const redirectUrl = req.nextUrl.clone();
        redirectUrl.pathname = "/auth";
        redirectUrl.search = "";
        const response = NextResponse.redirect(redirectUrl);
        clearAuthCookies(response);
        return response;
    }

    if (isAdminPage && role?.value !== "admin") {
        const redirectUrl = req.nextUrl.clone();
        redirectUrl.pathname = "/dashboard";
        redirectUrl.search = "";
        return NextResponse.redirect(redirectUrl);
    }

    return NextResponse.next();
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
