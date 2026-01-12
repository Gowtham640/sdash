import { PortalValidationResult, AuthErrorCode } from "./types";
import { loginToGoBackend } from '@/lib/scraperClient';

/**
 * DEPRECATED: This function is no longer used in the auth flow.
 * Portal validation is now handled directly in handleUserSignIn via Go backend.
 * 
 * @deprecated Use loginToGoBackend directly instead
 * @param email - User email/portal login ID (used as account)
 * @param password - User password
 * @param cdigest - Optional captcha digest
 * @param captcha - Optional captcha answer
 * @returns Validation result with success status and optional error
 */
export async function validatePortalCredentials(
  email: string,
  password: string,
  cdigest?: string,
  captcha?: string
): Promise<PortalValidationResult> {
  const timeoutHandle = setTimeout(() => {
    console.error("[Auth] Portal validation timeout after 35 seconds");
    return {
      valid: false,
      error: "Portal validation timed out (35s)",
      errorCode: AuthErrorCode.PORTAL_TIMEOUT,
    };
  }, 35000);

  try {
    console.log(`[Auth] Starting portal validation for: ${email}`);
    
    // Use the new Go backend login function
    const result = await loginToGoBackend(
      email, // account field
      password,
      cdigest,
      captcha
    );

    clearTimeout(timeoutHandle);

    if (result.authenticated) {
      console.log(`[Auth] Portal validation successful for: ${email}`);
      return { valid: true, email };
    } else {
      const errorMessage = result.message || result.errors?.join(', ') || "Invalid credentials";
      console.error(`[Auth] Portal validation failed: ${errorMessage}`);
      return {
        valid: false,
        error: errorMessage,
        errorCode: AuthErrorCode.INVALID_CREDENTIALS,
      };
    }
  } catch (error) {
    clearTimeout(timeoutHandle);
    console.error(
      `[Auth] Portal validation exception: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      valid: false,
      error: "Internal validation error",
      errorCode: AuthErrorCode.INTERNAL_ERROR,
    };
  }
}
