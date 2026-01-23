Set-Content -Path src\\app\\api\\data\\refresh\\route.ts -Value @'
import { NextRequest, NextResponse } from "next/server";
import type { CacheDataType } from "@/lib/supabaseCache";
import { fetchUserCacheEntries } from "@/lib/userCacheReader";

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
    const { access_token, data_type } = body;

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

    const user_id = decoded.sub as string;
    const entryType = data_type as CacheDataType;

    let entries: Record<CacheDataType, { data: unknown | null; expiresAt: string | null }>;
    try {
      entries = await fetchUserCacheEntries(user_id, [entryType]);
    } catch (error) {
      console.error("[API /data/refresh] Failed to read user cache:", error);
      return NextResponse.json(
        { success: false, error: "Failed to read cached data" },
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
'@
