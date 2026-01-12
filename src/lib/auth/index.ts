import { supabase } from "@/lib/supabaseClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loginToGoBackend } from "@/lib/scraperClient";
import {
  SignInResponse,
  AuthErrorCode,
  AuthErrorMessages,
} from "./types";

/**
 * Main authentication handler
 * Flow:
 * 1. Check if user exists in public.users
 * 2. If exists → sign in via Supabase Auth
 * 3. If not → validate via college portal
 * 4. If valid → create auth.users and public.users
 * 5. Return session token
 */
export async function handleUserSignIn(
  email: string,
  password: string
): Promise<SignInResponse> {
  console.log(`[Auth] Sign-in attempt for: ${email}`);

  try {
    // Step 1: Validate input
    if (!email || !password) {
      console.error("[Auth] Missing credentials");
      return {
        session: null,
        error: AuthErrorMessages[AuthErrorCode.MISSING_CREDENTIALS],
        errorCode: AuthErrorCode.MISSING_CREDENTIALS,
      };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error(`[Auth] Invalid email format: ${email}`);
      return {
        session: null,
        error: AuthErrorMessages[AuthErrorCode.INVALID_EMAIL],
        errorCode: AuthErrorCode.INVALID_EMAIL,
      };
    }

    // Validate password strength
    if (password.length < 6) {
      console.error("[Auth] Password too weak");
      return {
        session: null,
        error: AuthErrorMessages[AuthErrorCode.INVALID_PASSWORD],
        errorCode: AuthErrorCode.INVALID_PASSWORD,
      };
    }

    // Step 2: Check if user exists in users table
    console.log(`[Auth] Checking if user exists: ${email}`);
    const { data: existingUser, error: queryError } = await supabaseAdmin
      .from("users")
      .select("id, email, role")
      .eq("email", email)
      .single();

    // Handle query errors (PGRST116 = no rows found, which is expected for new users)
    if (queryError && queryError.code !== "PGRST116") {
      console.error(`[Auth] Error querying user: ${queryError.message}`);
      console.error(`[Auth] Error code: ${queryError.code}`);
      console.error(`[Auth] Error details:`, JSON.stringify(queryError, null, 2));
      
      // Check if table doesn't exist
      if (queryError.code === "42P01" || queryError.message.includes("does not exist")) {
        console.error(`[Auth] Table 'users' does not exist!`);
        console.error(`[Auth] Please create the table using the schema in tables.md`);
        
        return {
          session: null,
          error: "Database table 'users' does not exist. Please create it in Supabase.",
          errorCode: AuthErrorCode.SUPABASE_QUERY_ERROR,
        };
      }
      
      return {
        session: null,
        error: `Database error: ${queryError.message}`,
        errorCode: AuthErrorCode.SUPABASE_QUERY_ERROR,
      };
    }

    // Log the result
    if (existingUser) {
      console.log(`[Auth] User found in database: ${existingUser.id}`);
    } else {
      console.log(`[Auth] User not found in database (new user)`);
    }

    // Step 3: If user exists, sign them in
    if (existingUser) {
      console.log(`[Auth] User exists, signing in via Supabase: ${email}`);

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error(`[Auth] Supabase sign-in failed: ${error.message}`);
        return {
          session: null,
          error: AuthErrorMessages[AuthErrorCode.SUPABASE_AUTH_ERROR],
          errorCode: AuthErrorCode.SUPABASE_AUTH_ERROR,
        };
      }

      console.log(
        `[Auth] Successfully signed in existing user: ${email}`
      );
      return {
        session: data.session,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          role: existingUser.role,
        },
      };
    }

    // Step 4: User doesn't exist - validate via Go backend
    console.log(`[Auth] User not found, validating via Go backend: ${email}`);
    const backendResult = await loginToGoBackend(email, password);

    if (!backendResult.authenticated) {
      const errorMessage = backendResult.message || backendResult.errors?.join(', ') || "Invalid credentials";
      console.error(
        `[Auth] Go backend validation failed: ${errorMessage}`
      );
      return {
        session: null,
        error: errorMessage,
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      };
    }

    // Step 5: Go backend validation succeeded - create auth user only
    console.log(`[Auth] Go backend validation successful, creating auth user: ${email}`);

    // Create auth user via admin client
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Auto-confirm since portal validated them
      });

    if (authError) {
      console.error(`[Auth] Failed to create auth user: ${authError.message}`);
      return {
        session: null,
        error: AuthErrorMessages[AuthErrorCode.USER_CREATION_FAILED],
        errorCode: AuthErrorCode.USER_CREATION_FAILED,
      };
    }

    if (!authData.user) {
      console.error("[Auth] Auth user created but no user data returned");
      return {
        session: null,
        error: AuthErrorMessages[AuthErrorCode.USER_CREATION_FAILED],
        errorCode: AuthErrorCode.USER_CREATION_FAILED,
      };
    }

    const userId = authData.user.id;
    console.log(`[Auth] Auth user created with ID: ${userId}`);

    // Step 6: Fetch user data from Go backend using GET /user with CSRF token
    console.log(`[Auth] Fetching user data from Go backend via GET /user`);
    const { fetchUserDataFromGoBackend } = await import('@/lib/scraperClient');

    // Extract session token from login response
    const sessionToken = backendResult.token;
    if (!sessionToken) {
      console.error(`[Auth] No session token received from login response`);
      // Cleanup - delete the auth user since we can't proceed
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return {
        session: null,
        error: "Authentication failed - no session token",
        errorCode: AuthErrorCode.INTERNAL_ERROR,
      };
    }

    const userDataResult = await fetchUserDataFromGoBackend(sessionToken, userId, email);

    if (!userDataResult.success) {
      console.warn(`[Auth] Warning: Failed to fetch user data: ${userDataResult.error}`);
      console.log(`[Auth] Continuing with auth user creation despite GET /user failure`);
      // Note: Not deleting auth user - keeping it even if GET /user fails
      // User data check will happen in Supabase query below
    }

    // Step 7: Check Supabase public.users table for user data
    // Note: We do NOT push user data to Supabase - it should already be there
    console.log(`[Auth] Checking Supabase public.users table for user data: ${userId}`);
    const { data: existingUserData, error: userCheckError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userCheckError && userCheckError.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error(`[Auth] Error checking user data in Supabase: ${userCheckError.message}`);
      // Cleanup - delete the auth user since we couldn't verify user data
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return {
        session: null,
        error: AuthErrorMessages[AuthErrorCode.SUPABASE_QUERY_ERROR],
        errorCode: AuthErrorCode.SUPABASE_QUERY_ERROR,
      };
    }

    if (!existingUserData) {
      console.error(`[Auth] User data not found in Supabase public.users table after GET /user success`);
      // Cleanup - delete the auth user since user data is missing
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return {
        session: null,
        error: "User profile data not available",
        errorCode: AuthErrorCode.INTERNAL_ERROR,
      };
    }

    console.log(`[Auth] User data found in Supabase for: ${userId}`);

    // Step 8: Create session via client
    console.log(`[Auth] Creating session for new user: ${email}`);
    const { data: sessionData, error: sessionError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (sessionError || !sessionData.session) {
      console.error(`[Auth] Failed to create session: ${sessionError?.message}`);
      // Cleanup: delete the created auth user only (don't touch users table)
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return {
        session: null,
        error: AuthErrorMessages[AuthErrorCode.SESSION_CREATION_FAILED],
        errorCode: AuthErrorCode.SESSION_CREATION_FAILED,
      };
    }

    console.log(`[Auth] Successfully authenticated new user and session: ${email}`);
    return {
      session: sessionData.session,
      user: {
        id: userId,
        email: existingUserData.email,
        role: existingUserData.role,
      },
    };
  } catch (error) {
    console.error(
      `[Auth] Unexpected error: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      session: null,
      error: AuthErrorMessages[AuthErrorCode.INTERNAL_ERROR],
      errorCode: AuthErrorCode.INTERNAL_ERROR,
    };
  }
}

export type { SignInResponse, PortalValidationResult } from "./types";
export { AuthErrorCode, AuthErrorMessages } from "./types";
