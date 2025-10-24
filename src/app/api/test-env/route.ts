import { NextResponse } from "next/server";

export async function GET() {
  const envKeys = Object.keys(process.env).filter(k => k.includes('SUPABASE'));
  
  return NextResponse.json({
    message: "Environment variable test",
    supabaseKeys: envKeys,
    hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    urlPreview: process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 30) + "...",
    anonKeyPreview: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.substring(0, 30) + "...",
    serviceKeyPreview: process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 30) + "...",
  });
}

