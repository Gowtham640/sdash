import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const sessionCookieName = "sdash_access_token";
const roleCookieName = "sdash_user_role";

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;
    const token = req.cookies.get(sessionCookieName) ?? undefined;
    const role = req.cookies.get(roleCookieName) ?? undefined;

    const isAuthPage = pathname === "/auth" || pathname.startsWith("/auth/");
    const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");

    if (isAuthPage) {
        if (token) {
            const redirectUrl = req.nextUrl.clone();
            redirectUrl.pathname = "/dashboard";
            return NextResponse.redirect(redirectUrl);
        }
        return NextResponse.next();
    }

    if (!token) {
        const redirectUrl = req.nextUrl.clone();
        redirectUrl.pathname = "/auth";
        redirectUrl.search = "";
        return NextResponse.redirect(redirectUrl);
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
