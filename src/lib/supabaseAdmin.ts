import { createClient } from "@supabase/supabase-js";

// Access environment variables with fallbacks
const supabaseUrl = 
  process.env.NEXT_PUBLIC_SUPABASE_URL || 
  process.env.SUPABASE_URL || 
  "";

const serviceRoleKey = 
  process.env.SUPABASE_SERVICE_ROLE_KEY || 
  "";

// Debug logging
console.log("[Supabase Admin] Environment check:");
console.log("  All env keys:", Object.keys(process.env).filter(k => k.includes('SUPABASE')));
console.log("  NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl ? `✓ ${supabaseUrl.substring(0, 30)}...` : "✗ Missing");
console.log("  SUPABASE_SERVICE_ROLE_KEY:", serviceRoleKey ? `✓ ${serviceRoleKey.substring(0, 30)}...` : "✗ Missing");

if (!supabaseUrl || !serviceRoleKey || supabaseUrl.length < 10 || serviceRoleKey.length < 50) {
  console.error("[Supabase Admin] Missing or invalid environment variables!");
  throw new Error(
    "Missing Supabase environment variables. Please check your .env.local file and restart the dev server."
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
