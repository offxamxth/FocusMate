create or replace function public.get_focusmate_leaderboard(
  p_period text default 'weekly',
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
  utc_week_start timestamptz;
  utc_week_end timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_period is null or p_period not in ('weekly', 'all_time') then
    raise exception 'Invalid leaderboard period' using errcode = '22023';
  end if;
  if p_scope is null or p_scope not in ('global', 'friends') then
    raise exception 'Invalid leaderboard scope' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 50
    or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'Invalid leaderboard page' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = current_user_id
  ) then
    raise exception 'FocusMate profile not found' using errcode = 'P0002';
  end if;

  utc_week_start := date_trunc('week', now() at time zone 'UTC') at time zone 'UTC';
  utc_week_end := utc_week_start + interval '7 days';

  return (
    with candidate_profiles as (
      select profile.id as user_id,
             profile.username,
             coalesce(nullif(btrim(profile.display_name), ''), profile.username) as display_name,
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
    focus_totals as (
      select candidate.user_id,
             candidate.username,
             candidate.display_name,
             candidate.leaderboard_visibility,
             coalesce(sum(segment.focus_seconds) filter (where room.id is not null), 0)::bigint
               as all_time_seconds,
             coalesce(sum(
               case
                 when segment.started_at < utc_week_end and segment.ended_at > utc_week_start
                   then floor(extract(epoch from (
                     least(segment.ended_at, utc_week_end)
                     - greatest(segment.started_at, utc_week_start)
                   )))::bigint
                 else 0
               end
             ) filter (where room.id is not null), 0)::bigint as weekly_seconds
      from candidate_profiles as candidate
      left join private.focusmate_verified_focus_segments as segment
        on segment.user_id = candidate.user_id
      left join public.focus_rooms as room
        on room.id = segment.room_id
       and room.state = 'finished'
      group by candidate.user_id,
               candidate.username,
               candidate.display_name,
               candidate.leaderboard_visibility
    ),
    visible_scores as (
      select *
      from focus_totals
      where leaderboard_visibility = 'public'
         or (
           p_scope = 'friends'
           and leaderboard_visibility = 'friends'
         )
    ),
    ranked as (
      select visible.user_id,
             visible.username,
             visible.display_name,
             case when p_period = 'weekly'
               then visible.weekly_seconds
               else visible.all_time_seconds
             end as focus_seconds,
             row_number() over (
               order by
                 case when p_period = 'weekly'
                   then visible.weekly_seconds
                   else visible.all_time_seconds
                 end desc,
                 lower(visible.username),
                 visible.user_id
             ) as rank
      from visible_scores as visible
      where (p_period = 'weekly' and visible.weekly_seconds > 0)
         or (p_period = 'all_time' and visible.all_time_seconds > 0)
    ),
    own_progress as (
      select totals.*,
             case
               when p_period = 'weekly' then totals.weekly_seconds
               else totals.all_time_seconds
             end as selected_seconds
      from focus_totals as totals
      where totals.user_id = current_user_id
    )
    select jsonb_build_object(
      'period', p_period,
      'scope', p_scope,
      'week_start', utc_week_start,
      'entries', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'rank', page.rank,
            'username', page.username,
            'display_name', page.display_name,
            'focus_seconds', page.focus_seconds
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
          'all_time_seconds', own.all_time_seconds,
          'weekly_seconds', own.weekly_seconds,
          'rank', case
            when own.selected_seconds = 0 then null
            else 1 + (
              select count(*)
              from visible_scores as competitor
              where competitor.user_id <> current_user_id
                and (
                (
                  case when p_period = 'weekly'
                    then competitor.weekly_seconds
                    else competitor.all_time_seconds
                  end
                ) > own.selected_seconds
                or (
                  (
                    case when p_period = 'weekly'
                      then competitor.weekly_seconds
                      else competitor.all_time_seconds
                    end
                  ) = own.selected_seconds
                  and (
                    lower(competitor.username) < lower(own.username)
                    or (
                      lower(competitor.username) = lower(own.username)
                      and competitor.user_id < own.user_id
                    )
                  )
                )
              )
            )
          end,
          'weekly_rank', case
            when own.weekly_seconds = 0 then null
            else 1 + (
              select count(*)
              from visible_scores as competitor
              where competitor.user_id <> current_user_id
                and (
                  competitor.weekly_seconds > own.weekly_seconds
                  or (
                    competitor.weekly_seconds = own.weekly_seconds
                    and (
                      lower(competitor.username) < lower(own.username)
                      or (
                        lower(competitor.username) = lower(own.username)
                        and competitor.user_id < own.user_id
                      )
                    )
                  )
                )
            )
          end,
          'visibility', own.leaderboard_visibility,
          'listed', own.leaderboard_visibility <> 'private'
            and (p_scope = 'friends' or own.leaderboard_visibility = 'public')
        )
        from own_progress as own
      )
    )
  );
end;
$$;

revoke all on function public.get_focusmate_leaderboard(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_focusmate_leaderboard(text, text, integer, integer)
  to authenticated;
