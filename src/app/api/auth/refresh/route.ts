"use server";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { setSessionCookies } from "@/lib/auth/sessionCookies";

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get("sdash_refresh_token")?.value;
    if (!refreshToken) {
      return NextResponse.json(
        {
          success: false,
          error: "Refresh token missing",
        },
        { status: 401 }
      );
    }

    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

    if (error || !data?.session) {
      return NextResponse.json(
        {
          success: false,
          error: error?.message || "Failed to refresh session",
        },
        { status: error?.status ?? 401 }
      );
    }

    const userId = data.session.user?.id;
    let role = "public";

    if (userId) {
      const { data: userRow } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", userId)
        .single();

      if (userRow?.role) {
        role = userRow.role;
      }
    }

    const response = NextResponse.json(
      {
        success: true,
        expires_at: data.session.expires_at,
      },
      { status: 200 }
    );

    await setSessionCookies(response, data.session, role);
    return response;
  } catch (error) {
    console.error("[API] /api/auth/refresh error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unexpected error",
      },
      { status: 500 }
    );
  }
}
