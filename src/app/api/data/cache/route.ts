import { NextRequest, NextResponse } from "next/server";
import type { CacheDataType } from "@/lib/supabaseCache";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchUserCacheEntries } from "@/lib/userCacheReader";

const CACHE_TYPES: CacheDataType[] = ["attendance", "marks", "timetable"];

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
    console.error("[API /data/cache] JWT decode error:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action = "cache_fetch", access_token, data_type } = body;

    if (!access_token) {
      return NextResponse.json({ success: false, error: "Access token is required" }, { status: 400 });
    }

    if (!data_type || !CACHE_TYPES.includes(data_type)) {
      return NextResponse.json(
        { success: false, error: "Valid data_type is required (attendance, marks, or timetable)" },
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
    const cacheType = data_type as CacheDataType;

    if (action === "cache_rebuild") {
      const normalizedData = body.normalized_data;
      if (!normalizedData || typeof normalizedData !== "object") {
        return NextResponse.json(
          { success: false, error: "Normalized attendance data is required for rebuild" },
          { status: 400 }
        );
      }

      const expiresInMinutes = typeof body.expires_in_minutes === "number" ? body.expires_in_minutes : 10;
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

      console.log(`[API /data/cache] Rebuilding ${cacheType} cache for user ${user_id}`);

      const { error } = await supabaseAdmin
        .from("user_cache")
        .upsert(
          {
            user_id,
            data_type: cacheType,
            data: normalizedData,
            expires_at: expiresAt,
          },
          { onConflict: "unique_user_cache" }
        );

      if (error) {
        console.error("[API /data/cache] Failed to rebuild cache:", error);
        return NextResponse.json(
          { success: false, error: "Failed to rebuild cache" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Cache rebuilt",
        expiresAt,
      });
    }

    let entries: Record<CacheDataType, { data: unknown | null; expiresAt: string | null }>;
    try {
      entries = await fetchUserCacheEntries(user_id, [cacheType]);
    } catch (error) {
      console.error("[API /data/cache] Failed to read user cache:", error);
      return NextResponse.json(
        { success: false, error: "Failed to read cached data" },
        { status: 500 }
      );
    }

    const entry = entries[cacheType];
    const expiresAt = entry?.expiresAt ?? null;
    const isExpired = expiresAt ? new Date() > new Date(expiresAt) : false;

    return NextResponse.json({
      success: true,
      data: entry?.data ?? null,
      isExpired,
      expiresAt,
    });
  } catch (error) {
    console.error("[API /data/cache] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
