-- MoviePlex account sync. Run once in your Supabase project: Dashboard › SQL Editor › New query › Run.
-- Every row belongs to the signed-in user, and row-level security keeps each user to their own rows.

create table if not exists public.mp_profiles (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id smallint not null check (profile_id between 1 and 6),
  name text not null default '',
  color text not null default '#8b5cf6',
  addon_mode text not null default 'own' check (addon_mode in ('own', 'shared')),
  pin jsonb,                           -- salted SHA-256 of the profile PIN, never the PIN itself
  deleted boolean not null default false,
  updated_at bigint not null,          -- client time in ms; newest change wins
  primary key (user_id, profile_id)
);

-- Per-profile documents: 'settings' and 'addons'.
create table if not exists public.mp_profile_data (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id smallint not null check (profile_id between 1 and 6),
  kind text not null check (kind in ('settings', 'addons')),
  data jsonb not null,
  updated_at bigint not null,
  primary key (user_id, profile_id, kind)
);

-- Library and watch progress, one row per title per profile. Deletions are kept as tombstones.
create table if not exists public.mp_library (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id smallint not null check (profile_id between 1 and 6),
  item_id text not null,
  data jsonb,
  deleted boolean not null default false,
  updated_at bigint not null,
  primary key (user_id, profile_id, item_id)
);

alter table public.mp_profiles enable row level security;
alter table public.mp_profile_data enable row level security;
alter table public.mp_library enable row level security;

drop policy if exists "Users manage their own profiles" on public.mp_profiles;
create policy "Users manage their own profiles" on public.mp_profiles
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own profile data" on public.mp_profile_data;
create policy "Users manage their own profile data" on public.mp_profile_data
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own library" on public.mp_library;
create policy "Users manage their own library" on public.mp_library
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.mp_profiles, public.mp_profile_data, public.mp_library to authenticated;
-- Signed-out users never touch these tables, and TRUNCATE would bypass row-level security.
revoke all on public.mp_profiles, public.mp_profile_data, public.mp_library from anon;
revoke truncate, references, trigger on public.mp_profiles, public.mp_profile_data, public.mp_library from authenticated;
