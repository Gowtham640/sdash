import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { exists: false, error: "Email is required" },
        { status: 400 }
      );
    }

    const { data: authUser, error: authError } = await supabaseAdmin
      .from("auth.users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (authError || !authUser?.id) {
      if (authError) {
        console.error("[API /auth/check-user] auth.users error:", authError);
      }
      return NextResponse.json({ exists: false });
    }

    const { data: publicUser, error: publicError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("id", authUser.id)
      .maybeSingle();

    if (publicError) {
      console.error("[API /auth/check-user] public.users error:", publicError);
      return NextResponse.json({ exists: false, error: publicError.message }, { status: 500 });
    }

    return NextResponse.json({ exists: !!publicUser, user_id: authUser.id });
  } catch (error) {
    console.error("[API /auth/check-user] Error:", error);
    return NextResponse.json(
      { exists: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
