# 🔧 Environment Setup Required

## Error: Supabase keys are missing!

You need to create a `.env.local` file in your project root with your Supabase credentials.

---

## Step 1: Get Your Supabase Credentials

1. Go to: https://app.supabase.com/
2. Select your project (or create one if you haven't)
3. Go to: **Settings** → **API**
4. Copy these three values:
   - **Project URL**
   - **anon/public key**
   - **service_role key** (keep this secret!)

---

## Step 2: Create `.env.local` File

Create a file named **`.env.local`** in your project root:

```
C:\Users\grizi\OneDrive\Desktop\Projects\Personal Projects\sdash\sdash\.env.local
```

---

## Step 3: Add This Content to `.env.local`

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.YOUR_ANON_KEY_HERE
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.YOUR_SERVICE_ROLE_KEY_HERE
```

**Replace** the values with your actual Supabase credentials!

---

## Step 4: Restart Your Dev Server

After creating `.env.local`:

```bash
# Stop the server (Ctrl+C)
# Restart it:
npm run dev
```

---

## Example (with fake keys)

```env
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTY3ODkwMDAwMH0.FAKE_KEY_HERE
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjc4OTAwMDAwfQ.FAKE_KEY_HERE
```

---

## Security Notes ⚠️

- ✅ `.env.local` is already in `.gitignore` (won't be committed)
- ❌ **NEVER** commit your `SUPABASE_SERVICE_ROLE_KEY` to GitHub
- ✅ The `NEXT_PUBLIC_*` variables are safe for client-side
- ❌ The `SERVICE_ROLE_KEY` should **ONLY** be used server-side

---

## Verify Setup

After restarting, you should see in the terminal:

```
✓ Ready in XXXms
```

And when you try to sign in, you should NOT see:

```
[API] Failed to import auth module: Error: supabaseKey is required.
```

---

## Still Having Issues?

If you don't have a Supabase project yet:

1. **Create a Supabase account**: https://app.supabase.com/sign-up
2. **Create a new project**
3. **Wait for database to initialize** (2-3 minutes)
4. **Run the SQL from `versions.md`** to create the `public_users` table:

   ```sql
   CREATE TABLE public.public_users (
     id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
     email VARCHAR UNIQUE NOT NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );

   CREATE INDEX idx_public_users_email ON public.public_users(email);
   ```

5. **Get your API keys** from Settings → API
6. **Add them to `.env.local`**
7. **Restart dev server**

---

## Quick Command to Create the File (PowerShell)

```powershell
@"
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
"@ | Out-File -FilePath ".env.local" -Encoding utf8
```

Then edit `.env.local` with your actual keys!
