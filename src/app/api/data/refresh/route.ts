import { NextRequest, NextResponse } from "next/server";
import { fetchUserCacheEntries } from "@/lib/userCacheReader";
import { callBackendScraper } from "@/lib/scraperClient";
import type { CacheDataType } from "@/lib/supabaseCache";

const VALID_TYPES: CacheDataType[] = ["attendance", "marks", "timetable", "calendar"];

function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch (error) {
    console.error("[API /data/refresh] JWT decode error:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { access_token, data_type, password } = body;

    if (!access_token) {
      return NextResponse.json({ success: false, error: "Access token is required" }, { status: 400 });
    }

    if (!data_type || !VALID_TYPES.includes(data_type)) {
      return NextResponse.json(
        { success: false, error: "Valid data_type is required (attendance, marks, calendar, or timetable)" },
        { status: 400 }
      );
    }

    const decoded = decodeJWT(access_token);
    if (!decoded || !decoded.sub) {
      return NextResponse.json(
        { success: false, error: "Invalid or expired session. Please sign in again." },
        { status: 401 }
      );
    }

    const entryType = data_type as CacheDataType;
    const user_id = decoded.sub as string;
    const user_email = (decoded.email as string) || decoded.sub as string;

    if (!password) {
      return NextResponse.json(
        { success: false, error: "Password is required to refresh data" },
        { status: 400 }
      );
    }

    const action = `get_${entryType}_data`;
    console.log(`[API /data/refresh] 🔄 Triggering backend refresh for ${entryType}`);
    const backendResult = await callBackendScraper(action, {
      email: user_email,
      password,
      user_id,
    });

    if (!backendResult.success) {
      console.error(`[API /data/refresh] ❌ Backend refresh failed for ${entryType}:`, backendResult.error);
      return NextResponse.json(
        { success: false, error: backendResult.error || 'Backend refresh failed' },
        { status: 502 }
      );
    }

    let entries: Record<CacheDataType, { data: unknown | null; expiresAt: string | null }>;
    try {
      entries = await fetchUserCacheEntries(user_id, [entryType]);
    } catch (error) {
      console.error("[API /data/refresh] Failed to read user cache after refresh:", error);
      return NextResponse.json(
        { success: false, error: "Failed to read cached data after refresh" },
        { status: 500 }
      );
    }

    const entry = entries[entryType];
    const expiresAt = entry?.expiresAt ?? null;
    const isExpired = expiresAt ? new Date() > new Date(expiresAt) : false;

    return NextResponse.json({
      success: true,
      data: entry?.data ?? null,
      data_type: entryType,
      expiresAt,
      isExpired,
    });
  } catch (error) {
    console.error("[API /data/refresh] Unexpected error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
