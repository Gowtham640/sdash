import { Session } from "@supabase/supabase-js";

export interface SignInResponse {
  session: Session | null;
  user?: {
    id: string;
    email: string;
    role?: string;
  };
  error?: string;
  errorCode?: string;
}

export interface PortalValidationResult {
  valid: boolean;
  email?: string;
  error?: string;
  errorCode?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export enum AuthErrorCode {
  // Validation errors
  INVALID_EMAIL = "INVALID_EMAIL",
  INVALID_PASSWORD = "INVALID_PASSWORD",
  MISSING_CREDENTIALS = "MISSING_CREDENTIALS",

  // Portal validation errors
  PORTAL_LOGIN_FAILED = "PORTAL_LOGIN_FAILED",
  PORTAL_CONNECTION_ERROR = "PORTAL_CONNECTION_ERROR",
  PORTAL_TIMEOUT = "PORTAL_TIMEOUT",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",

  // Supabase errors
  SUPABASE_AUTH_ERROR = "SUPABASE_AUTH_ERROR",
  SUPABASE_INSERT_ERROR = "SUPABASE_INSERT_ERROR",
  SUPABASE_QUERY_ERROR = "SUPABASE_QUERY_ERROR",

  // System errors
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SESSION_CREATION_FAILED = "SESSION_CREATION_FAILED",
  USER_CREATION_FAILED = "USER_CREATION_FAILED",
}

export const AuthErrorMessages: Record<AuthErrorCode, string> = {
  [AuthErrorCode.INVALID_EMAIL]: "Invalid email format",
  [AuthErrorCode.INVALID_PASSWORD]: "Password must be at least 6 characters",
  [AuthErrorCode.MISSING_CREDENTIALS]: "Email and password are required",
  [AuthErrorCode.PORTAL_LOGIN_FAILED]: "College portal login failed",
  [AuthErrorCode.PORTAL_CONNECTION_ERROR]: "Could not connect to college portal",
  [AuthErrorCode.PORTAL_TIMEOUT]: "College portal validation timed out",
  [AuthErrorCode.INVALID_CREDENTIALS]: "Invalid email or password",
  [AuthErrorCode.SUPABASE_AUTH_ERROR]: "Authentication service error",
  [AuthErrorCode.SUPABASE_INSERT_ERROR]: "Error creating user profile",
  [AuthErrorCode.SUPABASE_QUERY_ERROR]: "Error checking user existence",
  [AuthErrorCode.INTERNAL_ERROR]: "Internal server error",
  [AuthErrorCode.SESSION_CREATION_FAILED]: "Failed to create session",
  [AuthErrorCode.USER_CREATION_FAILED]: "Failed to create user account",
};
