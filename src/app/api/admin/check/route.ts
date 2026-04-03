import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Decode JWT token without verification (extract claims)
 */
function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error("[API /admin/check] JWT decode error:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { access_token } = body;

    if (!access_token) {
      return NextResponse.json(
        { success: false, error: "Access token is required" },
        { status: 400 }
      );
    }

    const decoded = decodeJWT(access_token);
    if (!decoded || !decoded.sub) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const user_id = decoded.sub as string;

    const { data, error: dbError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user_id)
      .single();

    if (dbError || !data) {
      return NextResponse.json(
        { success: false, error: "Failed to verify admin access" },
        { status: 500 }
      );
    }

    // Normalize role so casing in public.users does not mismatch strict 'admin'
    const roleNormalized =
      typeof data.role === "string" ? data.role.trim().toLowerCase() : "";

    if (roleNormalized !== "admin") {
      return NextResponse.json(
        { success: false, error: "Access denied. Admin privileges required." },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true, isAdmin: true });
  } catch (error) {
    console.error("[API /admin/check] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

