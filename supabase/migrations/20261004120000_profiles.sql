create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null default '',
  study_goal text not null default 'self-study'
    check (study_goal in ('school', 'university', 'self-study', 'reading', 'coding', 'exam-preparation')),
  theme text not null default 'system'
    check (theme in ('system', 'light', 'dark')),
  study_style text not null default 'normal'
    check (study_style in ('quiet', 'normal', 'competitive')),
  time_format text not null default 'system'
    check (time_format in ('system', '12-hour', '24-hour')),
  session_preferences jsonb not null default '{}'::jsonb
    check (jsonb_typeof(session_preferences) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9_.-]{1,32}$')
);

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, study_goal, theme, study_style, time_format, session_preferences)
  on table public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_profile_updated_at() from public, anon, authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_profile_updated_at();

create or replace function public.create_focusmate_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_username text;
  profile_display_name text;
begin
  profile_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  profile_display_name := left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80);

  if profile_username !~ '^[a-z0-9_.-]{1,32}$' then
    raise exception 'FocusMate username is invalid';
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, profile_username, profile_display_name);

  return new;
end;
$$;

revoke all on function public.create_focusmate_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_focusmate_profile on auth.users;
create trigger on_auth_user_created_focusmate_profile
  after insert on auth.users
  for each row
  execute function public.create_focusmate_profile();
