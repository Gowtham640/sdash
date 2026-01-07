import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const course = searchParams.get('course') || 'BTech';
    const semester = parseInt(searchParams.get('semester') || '1', 10);

    let calendarData = null;
    let recordExists = false;

    // First, check if specific course/semester record exists
    const { data: specificCalendarData, error: specificError } = await supabaseAdmin
      .from('calendar')
      .select('data')
      .eq('course', course)
      .eq('semester', semester)
      .single();

    if (!specificError && specificCalendarData && specificCalendarData.data) {
      // Specific record exists, use it
      calendarData = specificCalendarData.data;
      recordExists = true;
      console.log(`[API /admin/calendar] ✅ Calendar fetched from public.calendar for course: ${course}, semester: ${semester}`);
    } else if (specificError && specificError.code === 'PGRST116') {
      // Specific record doesn't exist, use Default/0 as base
      console.log(`[API /admin/calendar] ℹ️ No calendar found for course: ${course}, semester: ${semester} - using Default/0 as base`);

      const { data: fallbackCalendarData, error: fallbackError } = await supabaseAdmin
        .from('calendar')
        .select('data')
        .eq('course', 'Default')
        .eq('semester', 0)
        .single();

      if (!fallbackError && fallbackCalendarData && fallbackCalendarData.data) {
        calendarData = fallbackCalendarData.data;
        recordExists = false;
        console.log(`[API /admin/calendar] ✅ Using Default/0 calendar as base for course: ${course}, semester: ${semester}`);
      } else if (fallbackError && fallbackError.code === 'PGRST116') {
        // No Default/0 calendar found, try to get any calendar as last resort
        console.log(`[API /admin/calendar] ℹ️ No default calendar found (Default/0), trying to fetch any available calendar`);
        const { data: anyCalendarData, error: anyCalendarError } = await supabaseAdmin
          .from('calendar')
          .select('data')
          .limit(1)
          .single();
        
        if (!anyCalendarError && anyCalendarData && anyCalendarData.data) {
          calendarData = anyCalendarData.data;
          recordExists = false;
          console.log(`[API /admin/calendar] ✅ Using any available calendar as base`);
        } else {
          console.log(`[API /admin/calendar] ℹ️ No calendar found in database at all`);
        }
      } else if (fallbackError) {
        console.warn(`[API /admin/calendar] ⚠️ Error fetching Default calendar from public.calendar: ${fallbackError.message}`);
      }
    } else if (specificError) {
      console.warn(`[API /admin/calendar] ⚠️ Error fetching calendar from public.calendar: ${specificError.message}`);
    }

    console.log(`[API /admin/calendar] Returning response. recordExists: ${recordExists}, hasData: ${!!calendarData}`);
    
    return NextResponse.json({
      success: true,
      data: calendarData,
      recordExists: recordExists // Indicate if the specific record exists
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

