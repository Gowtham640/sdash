create table public.users (
id uuid not null,
email text not null,
role text not null default 'public'::text,
semester integer null,
name text null,
regnumber text null,
department text null,
mobile text null,
program text null,
batch text null,
year integer null,
section text null,
specialization text null,
constraint users_pkey primary key (id),
constraint users_email_key unique (email),
constraint users_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_users_semester on public.users using btree (semester) TABLESPACE pg_default;

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

create table calendar (
id uuid primary key default gen_random_uuid(),
course text not null, -- e.g. 'BTech', 'MTech'
semester int not null, -- e.g. 1, 2, 3, 4
data jsonb not null, -- stores full calendar data (holidays, events, etc.)
updated_at timestamp with time zone default now()
);

create table public.events (
id uuid not null default gen_random_uuid (),
user_id uuid null,
user_email text null,
session_id text null,
event_name text not null,
event_data jsonb null,
created_at timestamp with time zone null default now(),
constraint events_pkey primary key (id),
constraint events_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete set null
) TABLESPACE pg_default;

RLS policies:
create policy "public insert events"
on events
for insert
to public
with check (true);

create policy "users update own events"
on events
for update
using (
user_id = auth.uid()
)
with check (
user_id = auth.uid()
);

create policy "admin can read events"
on events
for select
using (
exists (
select 1
from public.users u
where u.id = auth.uid()
and u.role = 'admin'
)
);
