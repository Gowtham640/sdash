import { createClient } from "@supabase/supabase-js";

// Access environment variables with fallbacks
const supabaseUrl = 
  process.env.NEXT_PUBLIC_SUPABASE_URL || 
  process.env.SUPABASE_URL || 
  "";

const supabaseAnonKey = 
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
  process.env.SUPABASE_ANON_KEY || 
  "";

// Debug logging
console.log("[Supabase Client] Environment check:");
console.log("  All env keys:", Object.keys(process.env).filter(k => k.includes('SUPABASE')));
console.log("  NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl ? `✓ ${supabaseUrl.substring(0, 30)}...` : "✗ Missing");
console.log("  NEXT_PUBLIC_SUPABASE_ANON_KEY:", supabaseAnonKey ? `✓ ${supabaseAnonKey.substring(0, 30)}...` : "✗ Missing");

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.length < 10 || supabaseAnonKey.length < 50) {
  console.error("[Supabase Client] Missing or invalid environment variables!");
  throw new Error(
    "Missing Supabase environment variables. Please check your .env.local file and restart the dev server."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
