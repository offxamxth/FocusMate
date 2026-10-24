create or replace function private.protect_focusmate_profile_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('focusmate.trusted_profile_xp', true), '') <> 'on' then
    new.app_data := jsonb_set(
      coalesce(new.app_data, '{}'::jsonb),
      '{total_xp}',
      to_jsonb(coalesce(old.xp, 0)),
      true
    );
  end if;
  return new;
end;
$$;

revoke all on function private.protect_focusmate_profile_progress()
  from public, anon, authenticated, service_role;

drop trigger if exists profiles_protect_focusmate_progress on public.profiles;
create trigger profiles_protect_focusmate_progress
  before update of app_data on public.profiles
  for each row
  execute function private.protect_focusmate_profile_progress();

create or replace function private.adjust_focusmate_profile_xp(
  p_user_id uuid,
  p_delta integer,
  p_achievement_id text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_data jsonb;
  current_xp bigint;
  next_xp bigint;
  current_achievements jsonb;
begin
  if p_delta is null or p_user_id is null then
    raise exception 'Profile XP adjustment is invalid.' using errcode = '22023';
  end if;
  select profile.app_data, profile.xp
  into profile_data, current_xp
  from public.profiles as profile
  where profile.id = p_user_id
  for update;
  if not found then
    raise exception 'FocusMate profile not found.' using errcode = 'P0002';
  end if;

  if coalesce(profile_data ->> 'total_xp', '') ~ '^[0-9]{1,18}$' then
    current_xp := (profile_data ->> 'total_xp')::bigint;
  end if;
  next_xp := greatest(0, current_xp + p_delta);
  current_achievements := case
    when jsonb_typeof(profile_data -> 'achievements') = 'array'
      then profile_data -> 'achievements'
    else '[]'::jsonb
  end;
  if p_achievement_id is not null then
    current_achievements := current_achievements || jsonb_build_array(jsonb_build_object(
      'id', p_achievement_id,
      'earned_at', clock_timestamp()
    ));
  end if;

  perform pg_catalog.set_config('focusmate.trusted_profile_xp', 'on', true);
  update public.profiles
  set app_data = jsonb_set(
    jsonb_set(
      coalesce(profile_data, '{}'::jsonb),
      '{total_xp}',
      to_jsonb(next_xp),
      true
    ),
    '{achievements}',
    current_achievements,
    true
  )
  where id = p_user_id;
  perform pg_catalog.set_config('focusmate.trusted_profile_xp', 'off', true);
  return next_xp;
end;
$$;

drop function if exists public.get_focusmate_leaderboard(text, text, integer, integer);

create function public.get_focusmate_leaderboard(
  p_scope text default 'global',
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_scope is null or p_scope not in ('global', 'friends') then
    raise exception 'Invalid leaderboard scope' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'Invalid leaderboard page' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles as profile where profile.id = current_user_id
  ) then
    raise exception 'FocusMate profile not found' using errcode = 'P0002';
  end if;

  return (
    with candidate_profiles as (
      select profile.id as user_id,
             profile.username,
             coalesce(nullif(btrim(profile.display_name), ''), profile.username) as display_name,
             profile.xp as global_xp,
             profile.level,
             profile.leaderboard_visibility
      from public.profiles as profile
      where profile.id = current_user_id
        or (
          p_scope = 'global'
          and profile.leaderboard_visibility = 'public'
        )
        or (
          p_scope = 'friends'
          and profile.leaderboard_visibility in ('friends', 'public')
          and exists (
            select 1
            from public.friendships as friendship
            where friendship.status = 'accepted'
              and (
                (friendship.requester_id = current_user_id and friendship.recipient_id = profile.id)
                or (friendship.recipient_id = current_user_id and friendship.requester_id = profile.id)
              )
          )
        )
    ),
    visible_scores as (
      select *
      from candidate_profiles
      where leaderboard_visibility = 'public'
         or (p_scope = 'friends' and leaderboard_visibility = 'friends')
    ),
    ranked as (
      select visible.user_id,
             visible.username,
             visible.display_name,
             visible.global_xp,
             visible.level,
             row_number() over (
               order by visible.global_xp desc, visible.user_id
             ) as rank
      from visible_scores as visible
    ),
    own_progress as (
      select profile.xp as global_xp,
             profile.level,
             profile.leaderboard_visibility,
             (
               profile.leaderboard_visibility = 'public'
               or (p_scope = 'friends' and profile.leaderboard_visibility = 'friends')
             ) as listed
      from public.profiles as profile
      where profile.id = current_user_id
    )
    select jsonb_build_object(
      'scope', p_scope,
      'entries', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'rank', page.rank,
            'username', page.username,
            'display_name', page.display_name,
            'global_xp', page.global_xp,
            'level', page.level
          )
          order by page.rank
        )
        from ranked as page
        where page.rank > p_offset
          and page.rank <= p_offset + p_limit
      ), '[]'::jsonb),
      'has_more', (select count(*) > p_offset + p_limit from ranked),
      'total_entries', (select count(*) from ranked),
      'progress', (
        select jsonb_build_object(
          'global_xp', own.global_xp,
          'level', own.level,
          'rank', (select page.rank from ranked as page where page.user_id = current_user_id),
          'visibility', own.leaderboard_visibility,
          'listed', own.listed
        )
        from own_progress as own
      )
    )
  );
end;
$$;

revoke all on function public.get_focusmate_leaderboard(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_focusmate_leaderboard(text, integer, integer)
  to authenticated;

notify pgrst, 'reload schema';
