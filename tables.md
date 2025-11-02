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
