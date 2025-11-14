import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    // Get user count
    const { count: userCount, error: userError } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true });

    // Get requests per day (from user_cache table)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: requestsCount, error: requestsError } = await supabaseAdmin
      .from('user_cache')
      .select('*', { count: 'exact', head: true })
      .gte('updated_at', today.toISOString());

    // Get activity data (recent cache updates)
    const { data: activityData, error: activityError } = await supabaseAdmin
      .from('user_cache')
      .select('updated_at, data_type, user_id')
      .order('updated_at', { ascending: false })
      .limit(50);

    return NextResponse.json({
      success: true,
      data: {
        userCount: userError ? 0 : (userCount || 0),
        requestsPerDay: requestsError ? 0 : (requestsCount || 0),
        activityData: activityError ? [] : (activityData || []),
      }
    });
  } catch (error) {
    console.error("[API /admin/analytics] Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

