import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const course = searchParams.get('course') || 'BTech';
    const semester = parseInt(searchParams.get('semester') || '1', 10);

    // First, try to get from user_cache (most recent calendar cache)
    const { data: cacheData, error: cacheError } = await supabaseAdmin
      .from('user_cache')
      .select('data')
      .eq('data_type', 'calendar')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    let calendarData = null;

    if (!cacheError && cacheData && cacheData.data) {
      // Use data from user_cache
      calendarData = cacheData.data;
      console.log("[API /admin/calendar] Using calendar data from user_cache");
    } else {
      // Fallback: try to get from public.calendar table
      const { data: calendarTableData, error: calendarError } = await supabaseAdmin
        .from('calendar')
        .select('data')
        .eq('course', course)
        .eq('semester', semester)
        .single();

      if (!calendarError && calendarTableData && calendarTableData.data) {
        calendarData = calendarTableData.data;
        console.log("[API /admin/calendar] Using calendar data from public.calendar table");
      } else {
        console.log("[API /admin/calendar] No calendar data found in user_cache or public.calendar");
      }
    }

    return NextResponse.json({
      success: true,
      data: calendarData
    });
  } catch (error) {
    console.error("[API /admin/calendar] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { course, semester, calendarData } = body;

    if (!course || !semester || !calendarData) {
      return NextResponse.json(
        { success: false, error: "Course, semester, and calendarData are required" },
        { status: 400 }
      );
    }

    // Save to public.calendar table
    // Check if record exists
    const { data: existingData, error: checkError } = await supabaseAdmin
      .from('calendar')
      .select('id')
      .eq('course', course)
      .eq('semester', semester)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      return NextResponse.json(
        { success: false, error: "Failed to check existing calendar" },
        { status: 500 }
      );
    }

    if (existingData) {
      // Update existing record
      const { error: updateError } = await supabaseAdmin
        .from('calendar')
        .update({
          data: calendarData,
          updated_at: new Date().toISOString()
        })
        .eq('course', course)
        .eq('semester', semester);

      if (updateError) {
        return NextResponse.json(
          { success: false, error: updateError.message },
          { status: 500 }
        );
      }
    } else {
      // Insert new record
      const { error: insertError } = await supabaseAdmin
        .from('calendar')
        .insert({
          course,
          semester,
          data: calendarData,
          updated_at: new Date().toISOString()
        });

      if (insertError) {
        return NextResponse.json(
          { success: false, error: insertError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API /admin/calendar] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

