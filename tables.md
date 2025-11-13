create table public.users (
id uuid not null,
email text not null,
role text not null default 'public'::text,
constraint users_pkey primary key (id),
constraint users_email_key unique (email),
constraint users_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

-- Additional columns added via ALTER TABLE:
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS semester INTEGER NULL;
-- ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name TEXT NULL;

This is the schema of the table
RLS policies:
1.Allow read access only to admins
SELECT
public

2. Enable insert for authenticated users only
   INSERT
   anon

create table if not exists public.user_cache (
id bigint generated always as identity primary key,
user_id uuid null,
data_type text not null,
data jsonb not null,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
expires_at timestamptz null,
constraint unique_user_cache unique (user_id, data_type)
) tablespace pg_default;

create index if not exists idx_user_cache_user_id on public.user_cache using btree (user_id) tablespace pg_default;
create index if not exists idx_user_cache_data_type on public.user_cache using btree (data_type) tablespace pg_default;
create index if not exists idx_user_cache_expires_at on public.user_cache using btree (expires_at) tablespace pg_default;

-- Row Level Security Policies
-- 1. Anonymous clients may insert rows (used during onboarding)
-- 2. Authenticated users can only read their own cached data
-- 3. Users may update their own cache entries (used by backend upsert)

alter table public.user_cache enable row level security;

create policy if not exists "Anon can insert" on public.user_cache
for insert
with check (true);

create policy if not exists "Users can select their cache" on public.user_cache
for select
using (auth.uid() = user_id);

create policy if not exists "Users can update only their own cache" on public.user_cache
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
