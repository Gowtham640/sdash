import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Decode JWT token to extract user info
 */
function decodeJWT(token: string): { user_id?: string; email?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    const claims = JSON.parse(decoded) as { sub?: string; email?: string };

    return {
      user_id: claims.sub,
      email: claims.email,
    };
  } catch (error) {
    console.error("[API /odml] Error decoding JWT:", error);
    return null;
  }
}

/**
 * GET: Fetch all ODML records for the user
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Access token is required" },
        { status: 401 }
      );
    }

    const decoded = decodeJWT(token);
    if (!decoded || !decoded.user_id) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const user_id = decoded.user_id;

    const { data, error } = await supabaseAdmin
      .from('user_odml')
      .select('*')
      .eq('user_id', user_id)
      .order('period_from', { ascending: true });

    if (error) {
      console.error("[API /odml] Error fetching ODML records:", error);
      return NextResponse.json(
        { success: false, error: "Failed to fetch ODML records" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error("[API /odml] Error in GET:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST: Save or update ODML record
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Access token is required" },
        { status: 401 }
      );
    }

    const decoded = decodeJWT(token);
    if (!decoded || !decoded.user_id) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const user_id = decoded.user_id;
    const body = await request.json();
    const { period_from, period_to, subject_hours } = body;

    if (!period_from || !period_to || !subject_hours) {
      return NextResponse.json(
        { success: false, error: "period_from, period_to, and subject_hours are required" },
        { status: 400 }
      );
    }

    // Validate dates
    const fromDate = new Date(period_from);
    const toDate = new Date(period_to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json(
        { success: false, error: "Invalid date format" },
        { status: 400 }
      );
    }

    // Upsert: update if exists, insert if not
    const { data, error } = await supabaseAdmin
      .from('user_odml')
      .upsert({
        user_id,
        period_from: period_from,
        period_to: period_to,
        subject_hours: subject_hours,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,period_from,period_to'
      })
      .select()
      .single();

    if (error) {
      console.error("[API /odml] Error saving ODML record:", error);
      return NextResponse.json(
        { success: false, error: "Failed to save ODML record" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data
    });
  } catch (error) {
    console.error("[API /odml] Error in POST:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Delete ODML record
 */
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Access token is required" },
        { status: 401 }
      );
    }

    const decoded = decodeJWT(token);
    if (!decoded || !decoded.user_id) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const user_id = decoded.user_id;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: "ODML record ID is required" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from('user_odml')
      .delete()
      .eq('id', id)
      .eq('user_id', user_id); // Ensure user can only delete their own records

    if (error) {
      console.error("[API /odml] Error deleting ODML record:", error);
      return NextResponse.json(
        { success: false, error: "Failed to delete ODML record" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true
    });
  } catch (error) {
    console.error("[API /odml] Error in DELETE:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}



