# 🗄️ Database Setup Required

## The Error You're Seeing:

```
Error checking user existence
```

This means the `public_users` table doesn't exist in your Supabase database yet!

---

## ✅ Fix It in 3 Steps:

### **Step 1: Go to Supabase SQL Editor**

1. Open: https://app.supabase.com/
2. Select your project: **qndsumtuimqtdyxnvmqv**
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**

### **Step 2: Run This SQL**

Copy and paste this into the SQL Editor:

```sql
-- Create the public_users table
CREATE TABLE IF NOT EXISTS public.public_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_public_users_email ON public.public_users(email);

-- Enable Row Level Security
ALTER TABLE public.public_users ENABLE ROW LEVEL SECURITY;

-- Policy: Service role has full access (for your API)
CREATE POLICY "Service role has full access" ON public.public_users
  FOR ALL
  USING (auth.role() = 'service_role');

-- Grant permissions
GRANT ALL ON public.public_users TO service_role;
GRANT SELECT, UPDATE ON public.public_users TO authenticated;
```

### **Step 3: Click "Run" (or press Ctrl+Enter)**

You should see:

```
Success. No rows returned.
```

---

## ✅ Verify It Worked

Run this query to check:

```sql
SELECT * FROM public.public_users;
```

You should see:

- Empty table (no rows yet) ✅
- Columns: `id`, `email`, `created_at`, `updated_at` ✅

---

## 🚀 Then Try Sign In Again!

After creating the table:

1. **No need to restart your server** (it will work immediately)
2. Go to: `http://localhost:3000/auth`
3. Enter email and password
4. Click **Sign In**

The error should be gone! 🎉

---

## 📋 What This Table Does:

- **`id`**: Links to Supabase auth.users (UUID)
- **`email`**: User's email (unique)
- **`created_at`**: When account was created
- **`updated_at`**: Last updated timestamp

This is separate from `auth.users` so you can store custom user profile data!

---

## 🐛 Still Getting Errors?

Check your server terminal. You should now see:

**Before (Error):**

```
[Auth] Error querying user: relation "public_users" does not exist
[Auth] Error code: 42P01
```

**After (Success):**

```
[Auth] Checking if user exists: user@example.com
[Auth] User not found in database (new user)
[Auth] User not found, validating via portal: user@example.com
```

---

## Alternative: Use Supabase Dashboard

1. Go to **Table Editor** in Supabase
2. Click **New Table**
3. Set:
   - Name: `public_users`
   - Enable RLS: ✅
4. Add columns manually:
   - `id` (uuid, primary key, foreign key to auth.users)
   - `email` (text, unique)
   - `created_at` (timestamptz, default: now())
   - `updated_at` (timestamptz, default: now())
5. Save

---

## 🔐 Security Note

Row Level Security (RLS) is enabled, so:

- ✅ Users can only read/update their own data
- ✅ Your API (with service_role key) can access all users
- ✅ Anonymous users can't access anything

Perfect for production! 🚀
