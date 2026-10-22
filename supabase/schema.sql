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

-- Size limits so one account can't fill the database (generous next to real use: library items
-- ~0.5 KB, the addon list ~10 KB, settings ~0.3 KB).
alter table public.mp_library drop constraint if exists mp_library_item_id_len;
alter table public.mp_library add constraint mp_library_item_id_len check (octet_length(item_id) <= 256);
alter table public.mp_library drop constraint if exists mp_library_data_size;
alter table public.mp_library add constraint mp_library_data_size check (data is null or octet_length(data::text) <= 32768);
alter table public.mp_profile_data drop constraint if exists mp_profile_data_size;
alter table public.mp_profile_data add constraint mp_profile_data_size check (
  octet_length(data::text) <= case when kind = 'addons' then 524288 else 32768 end
);
alter table public.mp_profiles drop constraint if exists mp_profiles_name_len;
alter table public.mp_profiles add constraint mp_profiles_name_len check (name is null or char_length(name) <= 64);
alter table public.mp_profiles drop constraint if exists mp_profiles_color_len;
alter table public.mp_profiles add constraint mp_profiles_color_len check (color is null or octet_length(color) <= 32);
alter table public.mp_profiles drop constraint if exists mp_profiles_pin_size;
alter table public.mp_profiles add constraint mp_profiles_pin_size check (pin is null or octet_length(pin::text) <= 1024);

-- At most 10,000 library items per profile (updates to existing items are always allowed).
create or replace function public.mp_library_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select count(*) from public.mp_library
        where user_id = new.user_id and profile_id = new.profile_id) >= 10000
     and not exists (select 1 from public.mp_library
        where user_id = new.user_id and profile_id = new.profile_id and item_id = new.item_id) then
    raise exception 'Library limit reached (10,000 items per profile)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.mp_library_limit() from public, anon, authenticated;
drop trigger if exists mp_library_limit on public.mp_library;
create trigger mp_library_limit
  before insert on public.mp_library
  for each row execute function public.mp_library_limit();
