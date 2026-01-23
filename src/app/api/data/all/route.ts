import { NextRequest, NextResponse } from "next/server";
import type { CacheDataType } from "@/lib/supabaseCache";
import type { UserCacheEntry } from "@/lib/userCacheReader";
import { fetchUserCacheEntries } from "@/lib/userCacheReader";
import { requestQueueTracker } from "@/lib/requestQueue";
import { fetchCalendarFromSupabase } from "@/lib/calendarFetcher";

const VALID_TYPES: CacheDataType[] = ["calendar", "timetable", "attendance", "marks"];

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
        console.error("[API /data/all] JWT decode error:", error);
        return null;
    }
}

function parseRequestedTypes(input: unknown): CacheDataType[] | null {
    if (!input) {
        return null;
    }

    let values: string[] = [];
    if (typeof input === "string") {
        values = input.split(",");
    } else if (Array.isArray(input)) {
        values = input.map((value) => String(value));
    } else {
        return null;
    }

    const normalized: CacheDataType[] = values
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && VALID_TYPES.includes(value as CacheDataType))
        .map((value) => value as CacheDataType);

    if (normalized.length === 0) {
        return null;
    }

    return Array.from(new Set(normalized));
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { access_token, types, force_refresh } = body;

        const forceRefresh = force_refresh === true || force_refresh === "true";

        if (!access_token) {
            return NextResponse.json(
                { success: false, error: "Access token is required" },
                { status: 400 }
            );
        }

        const decoded = decodeJWT(access_token);
        if (!decoded || !decoded.sub) {
            return NextResponse.json(
                { success: false, error: "Invalid or expired session" },
                { status: 401 }
            );
        }

        const user_id = decoded.sub as string;
        const user_email = (decoded.email as string) || user_id;

        const requestedTypes = parseRequestedTypes(types);
        const typesToFetch = requestedTypes ?? VALID_TYPES;

        console.log(`[API /data/all] Serving user cache for ${user_email}`);
        console.log(`[API /data/all]   - Requested types: ${typesToFetch.join(",")}`);
        console.log(`[API /data/all]   - Force refresh flag: ${forceRefresh}`);

        requestQueueTracker.registerRequest(user_email);

        let entries: Record<CacheDataType, UserCacheEntry>;
        try {
            entries = await fetchUserCacheEntries(user_id, typesToFetch);
        } catch (error) {
            console.error("[API /data/all] Failed to read user cache:", error);
            return NextResponse.json(
                { success: false, error: "Failed to read cached data" },
                { status: 500 }
            );
        }

        const payload: Record<string, unknown> = {};
        typesToFetch.forEach((type) => {
            payload[type] = entries[type]?.data ?? null;
        });

        if (typesToFetch.includes("calendar")) {
            const calendarEntry = entries["calendar"];
            if (!calendarEntry || calendarEntry.data === null) {
                try {
                    const freshCalendar = await fetchCalendarFromSupabase();
                    payload.calendar = freshCalendar;
                    console.log("[API /data/all] 🔄 Refilled calendar from public.calendar table");
                } catch (error) {
                    console.warn("[API /data/all] ⚠️ Failed to fetch calendar from public.calendar:", error);
                }
            }
        }

        return NextResponse.json({ success: true, data: payload });
    } catch (error) {
        console.error("[API /data/all] Unexpected error:", error);
        return NextResponse.json(
            { success: false, error: "Internal server error" },
            { status: 500 }
        );
    }
}
