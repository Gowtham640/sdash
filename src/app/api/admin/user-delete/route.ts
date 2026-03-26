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
    return JSON.parse(decoded);
  } catch (error) {
    console.error("[API /admin/user-delete] JWT decode error:", error);
    return null;
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { access_token, email } = body as { access_token?: string; email?: string };

    if (!access_token) {
      return NextResponse.json({ success: false, error: "Access token is required" }, { status: 400 });
    }

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ success: false, error: "A valid email is required" }, { status: 400 });
    }

    const decoded = decodeJWT(access_token);
    if (!decoded || !decoded.sub) {
      return NextResponse.json({ success: false, error: "Invalid token" }, { status: 401 });
    }

    const adminUserId = decoded.sub as string;
    const { data: adminRow, error: adminError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", adminUserId)
      .single();

    if (adminError || !adminRow || adminRow.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Access denied. Admin privileges required." },
        { status: 403 }
      );
    }

    const targetEmail = email.trim().toLowerCase();
    const { data: publicUser } = await supabaseAdmin
      .from("users")
      .select("id,email")
      .eq("email", targetEmail)
      .maybeSingle();

    const deletedCounts = {
      jobs: 0,
      user_cache: 0,
      tokens: 0,
      public_users: 0,
      auth_users: 0,
    };

    if (publicUser?.id) {
      const userId = publicUser.id;

      const { count: jobsCount } = await supabaseAdmin
        .from("jobs")
        .delete({ count: "exact" })
        .eq("user_id", userId);
      deletedCounts.jobs = jobsCount ?? 0;

      const { count: cacheCount } = await supabaseAdmin
        .from("user_cache")
        .delete({ count: "exact" })
        .eq("user_id", userId);
      deletedCounts.user_cache = cacheCount ?? 0;

      const { count: tokenCount } = await supabaseAdmin
        .from("tokens")
        .delete({ count: "exact" })
        .eq("user_id", userId);
      deletedCounts.tokens = tokenCount ?? 0;

      const { count: publicCount } = await supabaseAdmin
        .from("users")
        .delete({ count: "exact" })
        .eq("id", userId);
      deletedCounts.public_users = publicCount ?? 0;
    } else {
      const { count: tokenCountByEmail } = await supabaseAdmin
        .from("tokens")
        .delete({ count: "exact" })
        .eq("email", targetEmail);
      deletedCounts.tokens = tokenCountByEmail ?? 0;
    }

    const authLookup = await supabaseAdmin.auth.admin.listUsers();
    if (authLookup.error) {
      console.error("[API /admin/user-delete] listUsers failed:", authLookup.error);
      return NextResponse.json({ success: false, error: "Failed to query auth users" }, { status: 500 });
    }

    const authMatches = authLookup.data.users.filter((user) => (user.email || "").toLowerCase() === targetEmail);
    for (const authUser of authMatches) {
      const deleteResult = await supabaseAdmin.auth.admin.deleteUser(authUser.id);
      if (deleteResult.error) {
        console.error("[API /admin/user-delete] delete auth user failed:", deleteResult.error);
        return NextResponse.json({ success: false, error: "Failed to delete auth user" }, { status: 500 });
      }
      deletedCounts.auth_users += 1;
    }

    return NextResponse.json({
      success: true,
      email: targetEmail,
      deleted: deletedCounts,
    });
  } catch (error) {
    console.error("[API /admin/user-delete] Error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

