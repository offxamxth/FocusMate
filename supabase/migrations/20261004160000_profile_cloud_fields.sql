alter table public.profiles
  add column if not exists user_id uuid,
  add column if not exists xp bigint,
  add column if not exists level bigint,
  add column if not exists achievements jsonb,
  add column if not exists preferences jsonb;

update public.profiles
set user_id = id
where user_id is null;

update public.profiles
set xp = case
      when coalesce(app_data ->> 'total_xp', '') ~ '^[0-9]{1,18}$'
        then (app_data ->> 'total_xp')::bigint
      else 0
    end
where xp is null;

update public.profiles
set level = xp / 100 + 1
where level is null;

update public.profiles
set achievements = case
      when jsonb_typeof(app_data -> 'achievements') = 'array'
        then app_data -> 'achievements'
      else '[]'::jsonb
    end
where achievements is null;

update public.profiles
set preferences = case
      when jsonb_typeof(app_data -> 'session_preferences') = 'object'
        then app_data -> 'session_preferences'
      when jsonb_typeof(session_preferences) = 'object'
        then session_preferences
      else '{}'::jsonb
    end
where preferences is null;

alter table public.profiles
  alter column user_id set not null,
  alter column xp set default 0,
  alter column xp set not null,
  alter column level set default 1,
  alter column level set not null,
  alter column achievements set default '[]'::jsonb,
  alter column achievements set not null,
  alter column preferences set default '{}'::jsonb,
  alter column preferences set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_user_id_auth_user'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_user_id_auth_user
      foreign key (user_id) references auth.users (id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_id_matches_user_id'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_id_matches_user_id check (id = user_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_xp_nonnegative'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_xp_nonnegative check (xp >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_level_positive'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_level_positive check (level >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_achievements_array'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_achievements_array
      check (jsonb_typeof(achievements) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_preferences_object'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_preferences_object
      check (jsonb_typeof(preferences) = 'object');
  end if;
end;
$$;

create unique index if not exists profiles_user_id_unique
  on public.profiles (user_id);

create or replace function public.sync_focusmate_profile_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot_xp text;
  snapshot_achievements jsonb;
  snapshot_preferences jsonb;
begin
  if new.id is null then
    raise exception 'FocusMate profile owner is required';
  end if;
  new.user_id := new.id;

  snapshot_xp := coalesce(new.app_data ->> 'total_xp', '');
  if snapshot_xp = '' then
    new.xp := coalesce(new.xp, 0);
  elsif snapshot_xp ~ '^[0-9]{1,18}$' then
    new.xp := snapshot_xp::bigint;
  else
    raise exception 'FocusMate profile XP must be a non-negative integer';
  end if;
  new.level := new.xp / 100 + 1;

  snapshot_achievements := new.app_data -> 'achievements';
  if snapshot_achievements is null then
    new.achievements := coalesce(new.achievements, '[]'::jsonb);
  elsif jsonb_typeof(snapshot_achievements) = 'array' then
    new.achievements := snapshot_achievements;
  else
    raise exception 'FocusMate profile achievements must be an array';
  end if;

  snapshot_preferences := new.app_data -> 'session_preferences';
  if snapshot_preferences is null then
    snapshot_preferences := coalesce(new.preferences, new.session_preferences, '{}'::jsonb);
  elsif jsonb_typeof(snapshot_preferences) <> 'object' then
    raise exception 'FocusMate profile preferences must be an object';
  end if;
  new.preferences := snapshot_preferences;
  new.session_preferences := snapshot_preferences;

  if snapshot_preferences ? 'study_goal_type' then
    if snapshot_preferences ->> 'study_goal_type' not in
      ('school', 'university', 'self-study', 'reading', 'coding', 'exam-preparation') then
      raise exception 'FocusMate study goal is invalid';
    end if;
    new.study_goal := snapshot_preferences ->> 'study_goal_type';
  end if;
  if snapshot_preferences ? 'theme' then
    if snapshot_preferences ->> 'theme' not in ('system', 'light', 'dark') then
      raise exception 'FocusMate theme is invalid';
    end if;
    new.theme := snapshot_preferences ->> 'theme';
  end if;
  if snapshot_preferences ? 'study_style' then
    if snapshot_preferences ->> 'study_style' not in ('quiet', 'normal', 'competitive') then
      raise exception 'FocusMate study style is invalid';
    end if;
    new.study_style := snapshot_preferences ->> 'study_style';
  end if;
  if snapshot_preferences ? 'time_format' then
    if snapshot_preferences ->> 'time_format' not in ('system', '12-hour', '24-hour') then
      raise exception 'FocusMate time format is invalid';
    end if;
    new.time_format := snapshot_preferences ->> 'time_format';
  end if;

  return new;
end;
$$;

revoke all on function public.sync_focusmate_profile_snapshot()
  from public, anon, authenticated;

drop trigger if exists profiles_sync_focusmate_snapshot on public.profiles;
create trigger profiles_sync_focusmate_snapshot
  before insert or update of app_data on public.profiles
  for each row
  execute function public.sync_focusmate_profile_snapshot();

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

  insert into public.profiles (id, user_id, username, display_name)
  values (new.id, new.id, profile_username, profile_display_name);

  return new;
end;
$$;

revoke all on function public.create_focusmate_profile()
  from public, anon, authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id and id = user_id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and id = user_id);

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant insert (
  id,
  user_id,
  username,
  display_name,
  study_goal,
  theme,
  study_style,
  time_format,
  session_preferences,
  preferences
) on table public.profiles to authenticated;
grant update (
  display_name,
  study_goal,
  theme,
  study_style,
  time_format,
  session_preferences,
  preferences,
  app_data
) on table public.profiles to authenticated;
