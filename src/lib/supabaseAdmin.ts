import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy initialization to avoid errors during module load
let supabaseAdminInstance: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  // Return cached instance if already created
  if (supabaseAdminInstance) {
    return supabaseAdminInstance;
  }

  // Access environment variables with fallbacks
  const supabaseUrl = 
    process.env.NEXT_PUBLIC_SUPABASE_URL || 
    process.env.SUPABASE_URL || 
    "";

  const serviceRoleKey = 
    process.env.SUPABASE_SERVICE_ROLE_KEY || 
    "";

  // Debug logging (only in server context to avoid exposing keys)
  if (typeof window === 'undefined') {
    console.log("[Supabase Admin] Environment check:");
    const envKeys = Object.keys(process.env).filter(k => k.includes('SUPABASE'));
    console.log("  All env keys:", envKeys);
    console.log("  NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl ? `✓ ${supabaseUrl.substring(0, 30)}...` : "✗ Missing");
    console.log("  SUPABASE_SERVICE_ROLE_KEY:", serviceRoleKey ? `✓ ${serviceRoleKey.substring(0, 30)}...` : "✗ Missing");
  }

  // Validate environment variables
  if (!supabaseUrl || !serviceRoleKey) {
    const errorMsg = "Missing Supabase environment variables. Please check your .env.local file and restart the dev server.";
    console.error("[Supabase Admin] Missing environment variables!");
    console.error("[Supabase Admin]   - URL present:", !!supabaseUrl);
    console.error("[Supabase Admin]   - Service Role Key present:", !!serviceRoleKey);
    throw new Error(errorMsg);
  }

  // More lenient validation - just check they exist and have reasonable length
  if (supabaseUrl.length < 5 || serviceRoleKey.length < 20) {
    const errorMsg = "Invalid Supabase environment variables. URL and Service Role Key must be valid strings.";
    console.error("[Supabase Admin] Invalid environment variables!");
    console.error("[Supabase Admin]   - URL length:", supabaseUrl.length);
    console.error("[Supabase Admin]   - Service Role Key length:", serviceRoleKey.length);
    throw new Error(errorMsg);
  }

  // Create and cache the client
  supabaseAdminInstance = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseAdminInstance;
}

// Export a getter that creates the client lazily
// This ensures validation only happens when actually used, not at module load
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    const value = (client as any)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
  has(_target, prop) {
    const client = getSupabaseAdmin();
    return prop in client;
  },
  ownKeys(_target) {
    const client = getSupabaseAdmin();
    return Object.keys(client);
  },
});
