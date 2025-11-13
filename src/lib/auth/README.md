# Authentication Module (`/src/lib/auth`)

Complete secure authentication system with two-tier user verification.

## Quick Start

### 1. Import and Use

```typescript
import { handleUserSignIn } from "@/lib/auth";

const result = await handleUserSignIn(email, password);

if (result.session) {
  console.log("Success:", result.user);
} else {
  console.log("Error:", result.error, result.errorCode);
}
```

### 2. API Endpoint

```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@srmist.edu.in",
  "password": "password123"
}
```

## Files

| File                  | Purpose                                      |
| --------------------- | -------------------------------------------- |
| `types.ts`            | TypeScript interfaces, enums, error mappings |
| `portalValidation.ts` | College portal credential validation         |
| `index.ts`            | Main sign-in orchestration                   |
| `README.md`           | This file                                    |

## Flow

1. **Input Validation** → Email format, password length
2. **Check Existing User** → Query `public_users` table
3. **If Exists** → Sign in via Supabase Auth
4. **If New** → Validate via college portal (Python scraper)
5. **If Valid** → Create auth.users and public_users
6. **Create Session** → Return JWT access token
7. **On Error** → Auto-cleanup (delete created records)

## Error Handling

All errors mapped to HTTP status codes:

- **400**: Validation errors (invalid email, weak password)
- **401**: Invalid credentials (portal login failed)
- **503**: Service unavailable (portal connection error)
- **504**: Gateway timeout (portal validation timeout > 35s)
- **500**: Server errors (Supabase failures, unexpected errors)

## Security Features

✅ Server-side validation only (no client-side bypass)
✅ Automatic cleanup on failure
✅ 35-second timeout on portal validation
✅ Passwords encrypted by Supabase
✅ JWT tokens with expiration
✅ Email auto-confirmed for new users (portal validates them)

## Environment Requirements

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Python 3.8+
# pip install selenium beautifulsoup4
```

## Database Setup

```sql
CREATE TABLE public.public_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_public_users_email ON public.public_users(email);
```

## Production Checklist

- [ ] All env vars set in production
- [ ] Supabase tables created and indexed
- [ ] Rate limiting added to `/api/auth/login`
- [ ] Strong password requirements enforced
- [ ] HTTPS enabled
- [ ] Session tokens stored in HTTP-only cookies
- [ ] Monitoring/alerting set up for auth failures
- [ ] Python scraper running and healthy

## Debugging

Enable detailed logging by checking console output:

```
[Auth] Sign-in attempt for: user@example.com
[Auth] Checking if user exists: user@example.com
[Auth] User not found, validating via portal: user@example.com
[Auth] Portal validation successful, creating new user: user@example.com
[Auth] Auth user created with ID: xxxxxxxx
[Auth] Creating user profile: xxxxxxxx
[Auth] Creating session for new user: user@example.com
[Auth] Successfully created new user and session: user@example.com
```

## Version

- Version: 1.0.0
- Status: Production Ready
- Last Updated: 2024
