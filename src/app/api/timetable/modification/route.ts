import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64").toString("utf-8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * load: returns timetable modification JSON plus courses + batch/regNumber for the editor.
 * save: upserts modified_json for the authenticated user (JWT sub).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { access_token, action } = body as {
      access_token?: string;
      action?: string;
      modified_json?: unknown;
    };

    if (!access_token || typeof access_token !== "string") {
      return NextResponse.json({ success: false, error: "Access token is required" }, { status: 400 });
    }

    const decoded = decodeJWT(access_token);
    if (!decoded || !decoded.sub) {
      return NextResponse.json({ success: false, error: "Invalid or expired session" }, { status: 401 });
    }

    const user_id = decoded.sub as string;

    if (action === "status") {
      const { data: modRow, error: modErr } = await supabaseAdmin
        .from("timetable_modification")
        .select("user_id")
        .eq("user_id", user_id)
        .maybeSingle();

      if (modErr) {
        console.error("[API /timetable/modification] status error:", modErr);
        return NextResponse.json({ success: false, error: "Failed to read timetable modification" }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        has_modification_record: Boolean(modRow),
      });
    }

    if (action === "load") {
      const { data: modRow, error: modErr } = await supabaseAdmin
        .from("timetable_modification")
        .select("modified_json")
        .eq("user_id", user_id)
        .maybeSingle();

      if (modErr) {
        console.error("[API /timetable/modification] load modification error:", modErr);
        return NextResponse.json({ success: false, error: "Failed to load timetable modification" }, { status: 500 });
      }

      const { data: coursesRow } = await supabaseAdmin
        .from("user_cache")
        .select("data")
        .eq("user_id", user_id)
        .eq("data_type", "courses")
        .maybeSingle();

      const { data: userRow } = await supabaseAdmin
        .from("user_cache")
        .select("data")
        .eq("user_id", user_id)
        .eq("data_type", "user")
        .maybeSingle();

      const coursesData = coursesRow?.data as { regNumber?: string; courses?: Array<{ title?: string; code?: string }> } | null;
      const userData = userRow?.data as { batch?: string; regNumber?: string } | null;

      const regNumber =
        (coursesData?.regNumber && String(coursesData.regNumber)) ||
        (userData?.regNumber && String(userData.regNumber)) ||
        "";
      const batch = (userData?.batch && String(userData.batch)) || "2";

      const courseItems = (coursesData?.courses ?? [])
        .map((c) => ({
          title: typeof c.title === "string" ? c.title.trim() : "",
          code: typeof c.code === "string" ? c.code.trim() : "",
        }))
        .filter((c) => Boolean(c.title));

      const courseTitles = Array.from(new Set(courseItems.map((c) => c.title)));

      return NextResponse.json({
        success: true,
        modified_json: modRow?.modified_json ?? null,
        has_modification_record: Boolean(modRow),
        batch,
        regNumber,
        courseTitles,
        courseItems,
      });
    }

    if (action === "save") {
      const modified_json = body.modified_json;
      if (modified_json === undefined || typeof modified_json !== "object" || modified_json === null) {
        return NextResponse.json({ success: false, error: "modified_json object is required" }, { status: 400 });
      }

      const { error: upErr } = await supabaseAdmin.from("timetable_modification").upsert(
        {
          user_id,
          modified_json,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (upErr) {
        console.error("[API /timetable/modification] save error:", upErr);
        return NextResponse.json({ success: false, error: "Failed to save timetable modification" }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "Invalid action (use load or save)" }, { status: 400 });
  } catch (e) {
    console.error("[API /timetable/modification] Unexpected error:", e);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
