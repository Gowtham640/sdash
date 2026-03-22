import { NextResponse } from "next/server";

const isProduction = process.env.NODE_ENV === "production";

const clearCookieOptions = {
  path: "/",
  maxAge: 0,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProduction,
};

export async function POST() {
  const response = NextResponse.json({ success: true }, { status: 200 });

  response.cookies.set("sdash_access_token", "", clearCookieOptions);
  response.cookies.set("sdash_user_role", "", clearCookieOptions);
  response.cookies.set("sdash_refresh_token", "", clearCookieOptions);
  response.cookies.set("sdash_session_expires_at", "", clearCookieOptions);

  return response;
}
