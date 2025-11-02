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

-- ============================================================================
-- Add semester support to users table
-- ============================================================================

-- Add semester column to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS semester INTEGER NULL;

-- Create index for faster semester lookups
CREATE INDEX IF NOT EXISTS idx_users_semester ON public.users(semester);

-- Verify the column was added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'semester';

-- ============================================================================
-- Add name support to users table
-- ============================================================================

-- Add name column to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS name TEXT NULL;

-- Verify the column was added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'name';

