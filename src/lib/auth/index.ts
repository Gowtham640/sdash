import { supabase } from "@/lib/supabaseClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { validatePortalCredentials } from "./portalValidation";
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

    // Step 4: User doesn't exist - validate via college portal
    console.log(`[Auth] User not found, validating via portal: ${email}`);
    const portalResult = await validatePortalCredentials(email, password);

    if (!portalResult.valid) {
      console.error(
        `[Auth] Portal validation failed: ${portalResult.error}`
      );
      return {
        session: null,
        error:
          portalResult.error ||
          AuthErrorMessages[AuthErrorCode.INVALID_CREDENTIALS],
        errorCode:
          portalResult.errorCode || AuthErrorCode.INVALID_CREDENTIALS,
      };
    }

    // Step 5: Portal validation succeeded - create new user
    console.log(`[Auth] Portal validation successful, creating new user: ${email}`);

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

    // Create profile in users table
    console.log(`[Auth] Creating user profile: ${userId}`);
    const { error: profileError } = await supabaseAdmin
      .from("users")
      .insert({
        id: userId,
        email,
        role: "public", // Default role as per schema
        semester: 1, // Default semester (will be updated on first data fetch)
      });

    if (profileError) {
      console.error(
        `[Auth] Failed to create user profile: ${profileError.message}`
      );
      // Attempt to cleanup - delete the auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return {
        session: null,
        error: AuthErrorMessages[AuthErrorCode.SUPABASE_INSERT_ERROR],
        errorCode: AuthErrorCode.SUPABASE_INSERT_ERROR,
      };
    }

    // Step 6: Create session via client
    console.log(`[Auth] Creating session for new user: ${email}`);
    const { data: sessionData, error: sessionError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (sessionError || !sessionData.session) {
      console.error(`[Auth] Failed to create session: ${sessionError?.message}`);
      // Cleanup: delete the created user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from("users").delete().eq("id", userId);
      return {
        session: null,
        error: AuthErrorMessages[AuthErrorCode.SESSION_CREATION_FAILED],
        errorCode: AuthErrorCode.SESSION_CREATION_FAILED,
      };
    }

    console.log(`[Auth] Successfully created new user and session: ${email}`);
    return {
      session: sessionData.session,
      user: {
        id: userId,
        email,
        role: "public",
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

export { validatePortalCredentials } from "./portalValidation";
export type { SignInResponse, PortalValidationResult } from "./types";
export { AuthErrorCode, AuthErrorMessages } from "./types";
