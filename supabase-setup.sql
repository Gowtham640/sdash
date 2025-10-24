-- ============================================================================
-- Supabase Database Setup for SRM Dash Authentication
-- ============================================================================
-- Run this in Supabase SQL Editor: https://app.supabase.com/project/_/sql
-- ============================================================================

-- Create the public_users table
CREATE TABLE IF NOT EXISTS public.public_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_public_users_email ON public.public_users(email);

-- Add Row Level Security (RLS) policies
ALTER TABLE public.public_users ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own data
CREATE POLICY "Users can read own data" ON public.public_users
  FOR SELECT
  USING (auth.uid() = id);

-- Policy: Users can update their own data
CREATE POLICY "Users can update own data" ON public.public_users
  FOR UPDATE
  USING (auth.uid() = id);

-- Policy: Service role can do everything (for your API)
CREATE POLICY "Service role has full access" ON public.public_users
  FOR ALL
  USING (auth.role() = 'service_role');

-- Grant permissions
GRANT ALL ON public.public_users TO service_role;
GRANT SELECT, UPDATE ON public.public_users TO authenticated;

-- Verify the table was created
SELECT 
  'Table created successfully!' as status,
  COUNT(*) as user_count 
FROM public.public_users;

