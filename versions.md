# SRM Dash - Authentication System Documentation

## Version: 1.0.0 (Stable)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Environment Setup](#environment-setup)
4. [API Reference](#api-reference)
5. [Error Codes](#error-codes)
6. [Implementation Details](#implementation-details)
7. [Database Schema](#database-schema)
8. [Security Considerations](#security-considerations)

---

## Overview

This authentication system implements a secure two-tier verification flow for the SRM Dashboard:

- **Existing Users**: Sign in directly via Supabase Auth
- **New Users**: Validated through the college portal (Selenium scraper) before account creation

All authentication is handled server-side with automatic cleanup on failure.

---

## Architecture

### Sign-In Flow

```
User Submits Credentials
         ↓
   [Input Validation]
         ↓
Check if user exists in public.users?
    ↙               ↘
  YES              NO
   ↓               ↓
Supabase      Validate via
Auth Login    College Portal
   ↓               ↓
Return          Portal Login
Session         Failed? → Error
                   ↓
                Supabase Auth
                Create User
                   ↓
                Create Profile
                   ↓
                Create Session
                   ↓
                Return Session
```

### Component Breakdown

| Component                           | Purpose                               |
| ----------------------------------- | ------------------------------------- |
| `/src/lib/auth/types.ts`            | TypeScript interfaces and error enums |
| `/src/lib/auth/portalValidation.ts` | College portal credential validation  |
| `/src/lib/auth/index.ts`            | Main sign-in orchestration logic      |
| `/src/app/api/auth/login/route.ts`  | HTTP API endpoint (POST)              |

---

## Environment Setup

### Required Environment Variables

Create `.env.local` with the following:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Python Scraper (for college portal validation)
# Ensure Python 3.8+ is installed with dependencies:
# pip install selenium beautifulsoup4
```

### Supabase Database Setup

Create these tables in your Supabase project:

#### `public.public_users` Table

```sql
CREATE TABLE public.public_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX idx_public_users_email ON public.public_users(email);
```

---

## API Reference

### POST `/api/auth/login`

Sign in a user with email and password.

#### Request

```json
{
  "email": "user@srmist.edu.in",
  "password": "secure_password"
}
```

#### Success Response (200)

```json
{
  "success": true,
  "data": {
    "session": {
      "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refresh_token": "...",
      "expires_in": 3600,
      "token_type": "bearer",
      "user": {
        "id": "uuid",
        "email": "user@srmist.edu.in",
        "email_confirmed_at": "2024-01-01T00:00:00Z",
        "aud": "authenticated"
      }
    },
    "user": {
      "id": "uuid",
      "email": "user@srmist.edu.in",
      "created_at": "2024-01-01T00:00:00Z"
    }
  }
}
```

#### Error Response (various status codes)

```json
{
  "success": false,
  "error": "Invalid email or password",
  "errorCode": "INVALID_CREDENTIALS"
}
```

---

## Error Codes

### Validation Errors (400)

| Code                  | Message                                | Cause                          |
| --------------------- | -------------------------------------- | ------------------------------ |
| `INVALID_EMAIL`       | Invalid email format                   | Email doesn't match RFC format |
| `INVALID_PASSWORD`    | Password must be at least 6 characters | Password too short             |
| `MISSING_CREDENTIALS` | Email and password are required        | One or both fields missing     |

### Portal Validation Errors (401/503/504)

| Code                      | Status | Message                             | Cause                    |
| ------------------------- | ------ | ----------------------------------- | ------------------------ |
| `INVALID_CREDENTIALS`     | 401    | Invalid email or password           | Portal login failed      |
| `PORTAL_LOGIN_FAILED`     | 401    | College portal login failed         | Python scraper failed    |
| `PORTAL_CONNECTION_ERROR` | 503    | Could not connect to college portal | Network/process error    |
| `PORTAL_TIMEOUT`          | 504    | College portal validation timed out | Exceeded 35-second limit |

### Authentication Errors (500)

| Code                      | Message                       | Cause                           |
| ------------------------- | ----------------------------- | ------------------------------- |
| `SUPABASE_AUTH_ERROR`     | Authentication service error  | Supabase Auth failed            |
| `SUPABASE_QUERY_ERROR`    | Error checking user existence | Database query failed           |
| `SUPABASE_INSERT_ERROR`   | Error creating user profile   | Insert into public_users failed |
| `USER_CREATION_FAILED`    | Failed to create user account | Auth user creation failed       |
| `SESSION_CREATION_FAILED` | Failed to create session      | Session token generation failed |
| `INTERNAL_ERROR`          | Internal server error         | Unexpected server-side error    |

---

## Implementation Details

### 1. Input Validation

- Email format validated against RFC regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- Password minimum length: 6 characters
- Both fields required

### 2. User Lookup

- Queries `public.public_users` table by email
- Handles "no rows" case gracefully (error code PGRST116)
- Other errors returned to caller

### 3. Existing User Sign-In

- Uses Supabase Auth `signInWithPassword()`
- Returns access token and user info on success

### 4. New User Flow

**Step 1: Portal Validation**

- Spawns Python process with `spawn("python", ["python-scraper/api_wrapper.py"])`
- Sends JSON via stdin: `{ action: "validate_credentials", email, password }`
- 35-second timeout protection
- Expects JSON response with `success: true` or error details

**Step 2: Account Creation**

- Creates auth.users via `supabaseAdmin.auth.admin.createUser()`
- Automatically confirms email (`email_confirm: true`)
- Gets user ID from response

**Step 3: Profile Creation**

- Inserts into `public.public_users` table
- Links to auth user via UUID foreign key
- Records creation and update timestamps

**Step 4: Session Generation**

- Calls `supabase.auth.signInWithPassword()` with new credentials
- Returns session token

**Step 5: Automatic Cleanup**

- On any failure after auth user creation, deletes created records
- Ensures database consistency

### 5. Logging

All operations logged with `[Auth]` prefix:

```
[Auth] Sign-in attempt for: user@example.com
[Auth] Checking if user exists: user@example.com
[Auth] User not found, validating via portal: user@example.com
[Auth] Portal validation successful, creating new user: user@example.com
[Auth] Auth user created with ID: uuid
[Auth] Creating user profile: uuid
[Auth] Creating session for new user: user@example.com
[Auth] Successfully created new user and session: user@example.com
```

---

## Database Schema

### public_users Table

```
Column         | Type                  | Description
---------------|----------------------|------------------
id             | UUID (PK, FK)        | References auth.users.id
email          | VARCHAR (UNIQUE)     | User's email address
created_at     | TIMESTAMP            | Account creation time
updated_at     | TIMESTAMP            | Last update time
```

### Relationships

```
auth.users (Supabase managed)
    ↓ (foreign key)
public.public_users (application)
```

---

## Security Considerations

### 1. Password Handling

✅ **Strengths**

- Passwords never logged
- Minimum 6-character requirement
- Handled by Supabase Auth (encrypted at rest)

⚠️ **Recommendations**

- Enforce stronger passwords in production (12+ chars, special chars)
- Implement password reset flow
- Add rate limiting to prevent brute force

### 2. Session Management

✅ **Strengths**

- JWT tokens via Supabase
- Automatic token refresh via Supabase client
- Separate service role key for admin operations

⚠️ **Recommendations**

- Store session tokens in secure HTTP-only cookies (not localStorage)
- Implement token expiration handling (default: 1 hour)
- Add CSRF protection to forms

### 3. Data Validation

✅ **Strengths**

- Email format validation
- Input length checks
- Server-side validation (not just client)

⚠️ **Recommendations**

- Add rate limiting on `/api/auth/login` endpoint
- Implement CAPTCHA for repeated failures
- Log failed attempts for security monitoring

### 4. Error Messages

✅ **Current**

- Specific error codes for debugging
- Generic messages for sensitive operations

⚠️ **Recommendation**

- Never reveal user existence in error messages
- Current behavior is good for API

### 5. Portal Validation

✅ **Strengths**

- 35-second timeout prevents hanging
- Automatic process cleanup
- Sandboxed in separate Python process

⚠️ **Considerations**

- Portal credentials validated only once per signup
- Consider implementing portal credential re-validation on sensitive operations
- Portal session persists in `python-scraper/session_data.json` (30 days)

### 6. Cleanup on Failure

✅ **Implemented**

- Automatic deletion of auth user if profile creation fails
- Automatic deletion of both if session creation fails

---

## Usage Example

### Client-Side (React)

```typescript
async function handleSignIn(email: string, password: string) {
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`Sign-in failed: ${data.error} (${data.errorCode})`);
      return;
    }

    // Store session
    localStorage.setItem("access_token", data.data.session.access_token);
    localStorage.setItem("user", JSON.stringify(data.data.user));

    // Redirect to dashboard
    router.push("/dashboard");
  } catch (error) {
    console.error("Network error:", error);
  }
}
```

### Server-Side (Direct Import)

```typescript
import { handleUserSignIn } from "@/lib/auth";

const result = await handleUserSignIn(email, password);

if (result.session) {
  console.log("Sign-in successful:", result.user);
} else {
  console.error("Sign-in failed:", result.error);
}
```

---

## Troubleshooting

| Issue                                 | Solution                                                     |
| ------------------------------------- | ------------------------------------------------------------ |
| "Portal validation timed out"         | Increase timeout in `portalValidation.ts` line 12            |
| "Could not connect to college portal" | Check Python/Selenium installation and network               |
| "Error creating user profile"         | Verify `public_users` table exists and has correct schema    |
| "Authentication service error"        | Check Supabase credentials in `.env.local`                   |
| Python script not found               | Ensure Python is in PATH and `python-scraper/` folder exists |

---

## Last Updated

- Version: 1.0.0
- Date: 2024
- Status: Production Ready
- No linting errors
- All tests passing
