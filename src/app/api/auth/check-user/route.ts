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

        const supabaseUrl =
            process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !serviceRoleKey) {
            console.error("[API /auth/check-user] Missing Supabase env vars");
            return NextResponse.json(
                { exists: false, error: "Supabase configuration missing" },
                { status: 500 }
            );
        }

        console.log(`[API /auth/check-user] Checking Supabase auth/public tables for ${email}`);

        const authUrl = new URL("/auth/v1/admin/users", supabaseUrl);
        authUrl.searchParams.set("email", email);
        authUrl.searchParams.set("limit", "1");

        const authResponse = await fetch(authUrl.toString(), {
            headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                apikey: serviceRoleKey,
            },
        });

        if (!authResponse.ok) {
            const responseBody = await authResponse.text().catch(() => "");
            console.error(
                "[API /auth/check-user] auth.users fetch error:",
                authResponse.status,
                responseBody
            );
            return NextResponse.json(
                { auth_exists: false, error: "Failed to query auth users" },
                { status: 502 }
            );
        }

        const authUserPayload = await authResponse.json();
        const authUsers = Array.isArray(authUserPayload)
            ? authUserPayload
            : Array.isArray(authUserPayload.data)
                ? authUserPayload.data
                : Array.isArray(authUserPayload.users)
                    ? authUserPayload.users
                    : [];
        const authUser = authUsers[0] ?? null;

        const { data: publicUser, error: publicError } = await supabaseAdmin
            .from("users")
            .select("id,email")
            .eq("email", email)
            .maybeSingle();

        if (publicError) {
            console.error("[API /auth/check-user] public.users error:", publicError);
            return NextResponse.json(
                {
                    auth_exists: Boolean(authUser),
                    public_exists: false,
                    user_id: authUser?.id ?? null,
                    error: publicError.message,
                },
                { status: 500 }
            );
        }

        return NextResponse.json({
            auth_exists: Boolean(authUser),
            public_exists: Boolean(publicUser),
            user_id: authUser?.id ?? publicUser?.id ?? null,
        });
    } catch (error) {
        console.error("[API /auth/check-user] Error:", error);
        return NextResponse.json(
            { exists: false, error: "Internal server error" },
            { status: 500 }
        );
    }
}
