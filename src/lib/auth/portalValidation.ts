import { PortalValidationResult, AuthErrorCode } from "./types";
import { callBackendScraper } from '@/lib/scraperClient';

/**
 * Validates user credentials against the college portal using backend API
 * @param email - User email/portal login ID
 * @param password - User password
 * @returns Validation result with success status and optional error
 */
export async function validatePortalCredentials(
  email: string,
  password: string
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
    
    const result = await callBackendScraper('validate_credentials', {
      email,
      password,
    });

    clearTimeout(timeoutHandle);

    if (result.success) {
      console.log(`[Auth] Portal validation successful for: ${email}`);
      return { valid: true, email };
    } else {
      console.error(`[Auth] Portal validation failed: ${result.error || "Unknown error"}`);
      return {
        valid: false,
        error: result.error || "Invalid credentials",
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
