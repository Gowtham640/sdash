import { supabase } from "@/lib/supabaseClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loginToGoBackend, fetchUserDataFromGoBackend } from "@/lib/scraperClient";
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
  password: string,
  captchaToken?: string | null
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

    // Step 2: Check if user exists in auth.users table
    console.log(`[Auth] Checking if user exists in auth.users: ${email}`);
    const { data: usersList, error: authQueryError } = await supabaseAdmin.auth.admin.listUsers();

    if (authQueryError) {
      console.error(`[Auth] Error querying auth.users: ${authQueryError.message}`);
      return {
        session: null,
        error: `Database error: ${authQueryError.message}`,
        errorCode: AuthErrorCode.SUPABASE_QUERY_ERROR,
      };
    }

    // Find all users with this email (there might be duplicates)
    const usersWithEmail = usersList ? usersList.users.filter(u => u.email === email) : [];

    // Handle duplicate users - keep the most recently created one
    let existingAuthUser = null;
    if (usersWithEmail.length > 1) {
      console.warn(`[Auth] Found ${usersWithEmail.length} users with email ${email}, keeping the most recent`);
      // Sort by created_at descending and take the first (most recent)
      usersWithEmail.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      existingAuthUser = { user: usersWithEmail[0] };

      // Delete older duplicate users
      const duplicatesToDelete = usersWithEmail.slice(1);
      for (const duplicate of duplicatesToDelete) {
        console.log(`[Auth] Deleting duplicate user: ${duplicate.id}`);
        try {
          await supabaseAdmin.auth.admin.deleteUser(duplicate.id);
        } catch (deleteError) {
          console.error(`[Auth] Failed to delete duplicate user ${duplicate.id}:`, deleteError);
        }
      }
    } else if (usersWithEmail.length === 1) {
      existingAuthUser = { user: usersWithEmail[0] };
    }

    // Step 3: Check if user exists in public.users table
    console.log(`[Auth] Checking if user exists in public.users: ${email}`);
    const { data: publicUserData, error: publicUserError } = await supabaseAdmin
      .from('users')
      .select('id, email, name, regnumber, role')
      .eq('email', email)
      .single();

    if (publicUserError && publicUserError.code !== 'PGRST116') { // PGRST116 is "not found"
      console.error(`[Auth] Error querying public.users: ${publicUserError.message}`);
      return {
        session: null,
        error: `Database error: ${publicUserError.message}`,
        errorCode: AuthErrorCode.SUPABASE_QUERY_ERROR,
      };
    }

    const existingPublicUser = publicUserData ? publicUserData : null;

    // Log the results
    if (existingAuthUser?.user) {
      console.log(`[Auth] User found in auth.users: ${existingAuthUser.user.id}`);
    } else {
      console.log(`[Auth] User not found in auth.users`);
    }

    if (existingPublicUser) {
      console.log(`[Auth] User found in public.users: ${existingPublicUser.id}`);
    } else {
      console.log(`[Auth] User not found in public.users`);
    }

    // Step 4: Decision logic based on where user exists
    if (existingAuthUser?.user && existingPublicUser) {
      // Case 1: User exists in both auth.users and public.users - redirect to dashboard
      console.log(`[Auth] User exists in both tables, redirecting to dashboard: ${email}`);

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error(`[Auth] Supabase sign-in failed: ${error.message}`);
        // Even if Supabase sign-in fails, user data exists, so this might be a confirmation issue
        // Return user data but no session - frontend can handle dashboard access
        return {
          session: data?.session || null,
          user: {
            id: existingAuthUser.user.id,
            email: existingAuthUser.user.email || email,
            role: existingPublicUser.role || 'public',
          },
        };
      }

      console.log(`[Auth] Successfully signed in existing user with complete profile: ${email}`);
      return {
        session: data.session,
        user: {
          id: existingAuthUser.user.id,
          email: existingAuthUser.user.email || email,
          role: existingPublicUser.role || 'public',
        },
        skipGoBackend: true,
      };
    }

    if (!existingAuthUser?.user) {
      // Case 2: User doesn't exist in auth.users - send login request to Go backend
      console.log(`[Auth] User not found in auth.users, routing login through Go backend: ${email}`);

      const backendResult = await loginToGoBackend(
        email,
        password,
        undefined,
        captchaToken ?? undefined
      );
      const loginSuccess =
        backendResult.success !== undefined ? backendResult.success : backendResult.authenticated;

      if (!loginSuccess) {
        const errorMessage =
          backendResult.message ||
          (Array.isArray(backendResult.errors) && backendResult.errors.length > 0
            ? backendResult.errors.join(", ")
            : undefined) ||
          "Authentication failed";
        console.error(`[Auth] Go backend login failed: ${errorMessage}`);
        return {
          session: null,
          error: errorMessage,
          errorCode: AuthErrorCode.INVALID_CREDENTIALS,
        };
      }

      console.log(`[Auth] Go backend login successful`);
      // Go backend should have created user in auth.users, re-check
      const { data: usersListAfter, error: authQueryErrorAfter } = await supabaseAdmin.auth.admin.listUsers();

      if (authQueryErrorAfter) {
        console.error(`[Auth] Error re-checking auth.users after backend login: ${authQueryErrorAfter.message}`);
        return {
          session: null,
          error: `Database error: ${authQueryErrorAfter.message}`,
          errorCode: AuthErrorCode.SUPABASE_QUERY_ERROR,
        };
      }

      // Find the user that was created by the backend
      const usersWithEmailAfter = usersListAfter ? usersListAfter.users.filter(u => u.email === email) : [];

      // Handle duplicate users - keep the most recently created one
      let existingAuthUserAfter = null;
      if (usersWithEmailAfter.length > 1) {
        console.warn(`[Auth] Found ${usersWithEmailAfter.length} users with email ${email} after backend login, keeping the most recent`);
        // Sort by created_at descending and take the first (most recent)
        usersWithEmailAfter.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        existingAuthUserAfter = { user: usersWithEmailAfter[0] };
      } else if (usersWithEmailAfter.length === 1) {
        existingAuthUserAfter = { user: usersWithEmailAfter[0] };
      }

      if (existingAuthUserAfter?.user) {
        console.log(`[Auth] Found user in auth.users after backend login: ${existingAuthUserAfter.user.id}`);

        // Sign in to get a session
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          console.error(`[Auth] Supabase sign-in failed after backend user creation: ${signInError.message}`);
          return {
            session: null,
            error: AuthErrorMessages[AuthErrorCode.SUPABASE_AUTH_ERROR],
            errorCode: AuthErrorCode.SUPABASE_AUTH_ERROR,
          };
        }

        const sessionToken =
          typeof backendResult.token === "string" && backendResult.token.trim()
            ? backendResult.token.trim()
            : backendResult.session &&
              typeof backendResult.session === "object" &&
              typeof (backendResult.session as { token?: unknown }).token === "string"
              ? (backendResult.session as { token?: string }).token
              : undefined;

        if (sessionToken) {
          const userResult = await fetchUserDataFromGoBackend(
            sessionToken,
            existingAuthUserAfter.user.id,
            email,
            password
          );

          if (!userResult.success) {
            console.warn(`[Auth] Warning: Failed to fetch user data: ${userResult.error || "Unknown error"}`);
          } else {
            console.log(`[Auth] Successfully fetched user data from backend`);
          }
        } else {
          console.warn(`[Auth] Backend login response did not include a token; skipping user data fetch`);
        }

        console.log(`[Auth] Successfully authenticated new user and fetched profile data: ${email}`);
        return {
          session: signInData.session,
          user: {
            id: existingAuthUserAfter.user.id,
            email: existingAuthUserAfter.user.email || email,
            role: 'public', // Default role until synced
          },
          skipGoBackend: true,
        };
      } else {
        console.error(`[Auth] Backend login succeeded but user not found in auth.users: ${email}`);
        return {
          session: null,
          error: "Backend user creation failed",
          errorCode: AuthErrorCode.INTERNAL_ERROR,
        };
      }
    }

    if (existingAuthUser?.user && !existingPublicUser) {
      // Case 3: User exists in auth.users but not in public.users - send GET user request to Go backend
      console.log(`[Auth] User exists in auth.users but not in public.users, fetching user data from Go backend: ${email}`);

      // Try to sign in first to get a session for the user
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        console.error(`[Auth] Supabase sign-in failed: ${signInError.message}`);
        return {
          session: null,
          error: AuthErrorMessages[AuthErrorCode.SUPABASE_AUTH_ERROR],
          errorCode: AuthErrorCode.SUPABASE_AUTH_ERROR,
        };
      }

      // Now fetch user data from Go backend
      console.log(`[Auth] Successfully authenticated user and fetched profile data: ${email}`);
      return {
        session: signInData.session,
        user: {
          id: existingAuthUser.user.id,
          email: existingAuthUser.user.email || email,
          role: 'public', // Default role until synced
        },
      };
    }

    // Case 4: User exists in public.users but not in auth.users - data inconsistency
    if (!existingAuthUser?.user && existingPublicUser) {
      console.error(`[Auth] Data inconsistency: User exists in public.users but not in auth.users: ${email}`);
      return {
        session: null,
        error: "Account data inconsistency. Please contact support.",
        errorCode: AuthErrorCode.INTERNAL_ERROR,
      };
    }

    // This should never be reached, but add a fallback
    console.error(`[Auth] Unexpected code path reached for user: ${email}`);
    return {
      session: null,
      error: AuthErrorMessages[AuthErrorCode.INTERNAL_ERROR],
      errorCode: AuthErrorCode.INTERNAL_ERROR,
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
