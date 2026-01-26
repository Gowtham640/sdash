import { NextResponse } from "next/server";

export const SESSION_KEEP_ALIVE_SECONDS = 14 * 24 * 60 * 60; // 2 weeks

type SupabaseSessionPayload = {
  access_token: string;
  refresh_token?: string | null;
  expires_at?: number | null;
};

export async function setSessionCookies(
  response: NextResponse,
  session: SupabaseSessionPayload,
  role: string
): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAtSeconds =
    typeof session.expires_at === "number" ? session.expires_at : nowSeconds + SESSION_KEEP_ALIVE_SECONDS;

  const cookieOptions = {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: isProduction,
    maxAge: SESSION_KEEP_ALIVE_SECONDS,
  };

  response.cookies.set("sdash_access_token", session.access_token, cookieOptions);
  response.cookies.set("sdash_user_role", role || "public", cookieOptions);

  if (session.refresh_token) {
    response.cookies.set("sdash_refresh_token", session.refresh_token, cookieOptions);
  }

  response.cookies.set("sdash_session_expires_at", expiresAtSeconds.toString(), cookieOptions);
}
