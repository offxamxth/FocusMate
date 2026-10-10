create table if not exists private.focusmate_room_xp_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists private.focusmate_room_session_completions (
  room_id uuid not null references public.focus_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  focus_seconds integer not null check (focus_seconds >= 300),
  was_host boolean not null,
  shared_with_friend boolean not null,
  primary key (room_id, user_id)
);

create index if not exists focusmate_room_completions_user_date_idx
  on private.focusmate_room_session_completions (user_id, completed_at desc);

create table if not exists private.focusmate_room_achievement_awards (
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null,
  xp_awarded integer not null check (xp_awarded >= 0),
  earned_at timestamptz not null default clock_timestamp(),
  primary key (user_id, achievement_id)
);

create table if not exists private.focusmate_room_daily_quests (
  user_id uuid not null references auth.users (id) on delete cascade,
  quest_date date not null,
  quests jsonb not null check (jsonb_typeof(quests) = 'array'),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, quest_date)
);

create table if not exists private.focusmate_room_xp_requests (
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  request_type text not null check (request_type in ('reroll', 'profile_reroll', 'claim')),
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, request_id)
);

alter table private.focusmate_room_xp_wallets enable row level security;
alter table private.focusmate_room_session_completions enable row level security;
alter table private.focusmate_room_achievement_awards enable row level security;
alter table private.focusmate_room_daily_quests enable row level security;
alter table private.focusmate_room_xp_requests enable row level security;

revoke all on table
  private.focusmate_room_xp_wallets,
  private.focusmate_room_session_completions,
  private.focusmate_room_achievement_awards,
  private.focusmate_room_daily_quests,
  private.focusmate_room_xp_requests
from public, anon, authenticated, service_role;

create or replace function private.focusmate_room_progress_json(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with totals as (
    select count(*)::bigint as sessions,
           coalesce(sum(completion.focus_seconds), 0)::bigint as focus_seconds,
           count(*) filter (where completion.was_host)::bigint as host_sessions,
           count(distinct completion.room_id)::bigint as unique_rooms,
           count(*) filter (
             where extract(hour from completion.started_at at time zone 'UTC') < 12
           )::bigint as early_sessions,
           count(*) filter (
             where extract(hour from completion.started_at at time zone 'UTC') >= 18
           )::bigint as late_sessions,
           count(*) filter (where completion.shared_with_friend)::bigint as friend_sessions,
           coalesce(sum(completion.focus_seconds)
             filter (where completion.shared_with_friend), 0)::bigint as friend_focus_seconds
    from private.focusmate_room_session_completions as completion
    where completion.user_id = p_user_id
  ),
  streak as (
    select count(*)::integer as streak_days
    from generate_series(0, 6) as day_offset(value)
    where exists (
      select 1
      from private.focusmate_room_session_completions as completion
      where completion.user_id = p_user_id
        and (completion.completed_at at time zone 'UTC')::date
          = ((clock_timestamp() at time zone 'UTC')::date - day_offset.value)
    )
  )
  select jsonb_build_object(
    'sessions', totals.sessions,
    'focus_seconds', totals.focus_seconds,
    'host_sessions', totals.host_sessions,
    'unique_rooms', totals.unique_rooms,
    'early_sessions', totals.early_sessions,
    'late_sessions', totals.late_sessions,
    'friend_sessions', totals.friend_sessions,
    'friend_focus_seconds', totals.friend_focus_seconds,
    'streak_days', streak.streak_days
  )
  from totals cross join streak;
$$;

revoke all on function private.focusmate_room_progress_json(uuid)
  from public, anon, authenticated, service_role;

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
  return next_xp;
end;
$$;

revoke all on function private.adjust_focusmate_profile_xp(uuid, integer, text)
  from public, anon, authenticated;

create or replace function private.refresh_focusmate_room_daily_quests(
  p_user_id uuid,
  p_quest_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_quests jsonb;
  next_quests jsonb;
  room_sessions bigint;
  room_minutes bigint;
  friend_sessions bigint;
  host_sessions bigint;
begin
  insert into private.focusmate_room_daily_quests (user_id, quest_date, quests)
  values (
    p_user_id,
    p_quest_date,
    jsonb_build_array(
      jsonb_build_object(
        'id', 'room_sessions_1', 'category', 'room_sessions', 'target', 1,
        'rewardXP', 10, 'progress', 0, 'completed', false,
        'rewardClaimed', false, 'rerollHistory', '[]'::jsonb
      ),
      jsonb_build_object(
        'id', 'room_focus_30', 'category', 'room_focus_minutes', 'target', 30,
        'rewardXP', 20, 'progress', 0, 'completed', false,
        'rewardClaimed', false, 'rerollHistory', '[]'::jsonb
      ),
      jsonb_build_object(
        'id', 'room_friend_1', 'category', 'friend_room_sessions', 'target', 1,
        'rewardXP', 20, 'progress', 0, 'completed', false,
        'rewardClaimed', false, 'rerollHistory', '[]'::jsonb
      ),
      jsonb_build_object(
        'id', 'room_host_1', 'category', 'room_host_sessions', 'target', 1,
        'rewardXP', 15, 'progress', 0, 'completed', false,
        'rewardClaimed', false, 'rerollHistory', '[]'::jsonb
      )
    )
  )
  on conflict (user_id, quest_date) do nothing;

  select daily.quests into current_quests
  from private.focusmate_room_daily_quests as daily
  where daily.user_id = p_user_id and daily.quest_date = p_quest_date
  for update;

  select count(*)::bigint,
         floor(coalesce(sum(completion.focus_seconds), 0) / 60)::bigint,
         count(*) filter (where completion.shared_with_friend)::bigint,
         count(*) filter (where completion.was_host)::bigint
  into room_sessions, room_minutes, friend_sessions, host_sessions
  from private.focusmate_room_session_completions as completion
  where completion.user_id = p_user_id
    and completion.completed_at >= (p_quest_date::timestamp at time zone 'UTC')
    and completion.completed_at < ((p_quest_date + 1)::timestamp at time zone 'UTC');

  select jsonb_agg(
    quest.value || jsonb_build_object(
      'progress', least(
        (quest.value ->> 'target')::numeric,
        case quest.value ->> 'category'
          when 'room_sessions' then room_sessions::numeric
          when 'room_focus_minutes' then room_minutes::numeric
          when 'friend_room_sessions' then friend_sessions::numeric
          when 'room_host_sessions' then host_sessions::numeric
          else 0::numeric
        end
      ),
      'completed', case quest.value ->> 'category'
        when 'room_sessions' then room_sessions >= (quest.value ->> 'target')::bigint
        when 'room_focus_minutes' then room_minutes >= (quest.value ->> 'target')::bigint
        when 'friend_room_sessions' then friend_sessions >= (quest.value ->> 'target')::bigint
        when 'room_host_sessions' then host_sessions >= (quest.value ->> 'target')::bigint
        else false
      end
    )
    order by quest.ordinality
  )
  into next_quests
  from jsonb_array_elements(current_quests) with ordinality as quest(value, ordinality);

  update private.focusmate_room_daily_quests
  set quests = next_quests,
      updated_at = clock_timestamp()
  where user_id = p_user_id and quest_date = p_quest_date;

  return next_quests;
end;
$$;

revoke all on function private.refresh_focusmate_room_daily_quests(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function private.award_focusmate_room_achievements(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  metric jsonb := private.focusmate_room_progress_json(p_user_id);
  candidate record;
begin
  insert into private.focusmate_room_xp_wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  for candidate in
    select achievements.achievement_id, achievements.reward_xp
    from (values
      ('room_first_session', 20, (metric ->> 'sessions')::bigint, 1::bigint),
      ('room_regular_5', 30, (metric ->> 'sessions')::bigint, 5::bigint),
      ('room_regular_25', 50, (metric ->> 'sessions')::bigint, 25::bigint),
      ('room_regular_50', 75, (metric ->> 'sessions')::bigint, 50::bigint),
      ('room_focus_1h', 20, (metric ->> 'focus_seconds')::bigint, 3600::bigint),
      ('room_focus_5h', 35, (metric ->> 'focus_seconds')::bigint, 18000::bigint),
      ('room_focus_10h', 50, (metric ->> 'focus_seconds')::bigint, 36000::bigint),
      ('room_focus_25h', 75, (metric ->> 'focus_seconds')::bigint, 90000::bigint),
      ('room_focus_50h', 100, (metric ->> 'focus_seconds')::bigint, 180000::bigint),
      ('room_host_3', 25, (metric ->> 'host_sessions')::bigint, 3::bigint),
      ('room_unique_3', 25, (metric ->> 'unique_rooms')::bigint, 3::bigint),
      ('room_unique_10', 40, (metric ->> 'unique_rooms')::bigint, 10::bigint),
      ('room_early_bird', 15, (metric ->> 'early_sessions')::bigint, 1::bigint),
      ('room_night_owl', 15, (metric ->> 'late_sessions')::bigint, 1::bigint),
      ('room_streak_7', 50, (metric ->> 'streak_days')::bigint, 7::bigint),
      ('friend_room_first', 20, (metric ->> 'friend_sessions')::bigint, 1::bigint),
      ('friend_room_5', 30, (metric ->> 'friend_sessions')::bigint, 5::bigint),
      ('friend_room_25', 50, (metric ->> 'friend_sessions')::bigint, 25::bigint),
      ('friend_focus_1h', 20, (metric ->> 'friend_focus_seconds')::bigint, 3600::bigint),
      ('friend_focus_5h', 40, (metric ->> 'friend_focus_seconds')::bigint, 18000::bigint)
    ) as achievements(achievement_id, reward_xp, current_value, target_value)
    where achievements.current_value >= achievements.target_value
  loop
    insert into private.focusmate_room_achievement_awards (
      user_id, achievement_id, xp_awarded
    )
    values (p_user_id, candidate.achievement_id, candidate.reward_xp)
    on conflict (user_id, achievement_id) do nothing;

    if found then
      update private.focusmate_room_xp_wallets
      set balance = balance + candidate.reward_xp,
          updated_at = clock_timestamp()
      where user_id = p_user_id;
      perform private.adjust_focusmate_profile_xp(
        p_user_id, candidate.reward_xp, candidate.achievement_id
      );
    end if;
  end loop;
end;
$$;

revoke all on function private.award_focusmate_room_achievements(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.record_focusmate_room_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant record;
  focus_seconds integer;
  shared_with_friend boolean;
  current_utc_date date;
begin
  if new.state <> 'finished' or old.state = 'finished' then
    return new;
  end if;

  current_utc_date := (new.finished_at at time zone 'UTC')::date;
  for participant in
    select segment.user_id,
           sum(segment.focus_seconds)::integer as focus_seconds,
           bool_or(segment.user_id = new.owner_id) as was_host,
           min(segment.started_at) as started_at
    from private.focusmate_verified_focus_segments as segment
    where segment.room_id = new.id
      and segment.ended_at is not null
      and segment.focus_seconds > 0
    group by segment.user_id
  loop
    if participant.focus_seconds < 300 then
      continue;
    end if;

    select exists (
      select 1
      from (
        select segment.user_id
        from private.focusmate_verified_focus_segments as segment
        where segment.room_id = new.id
          and segment.ended_at is not null
        group by segment.user_id
        having sum(segment.focus_seconds) >= 300
      ) as room_participant
      join public.friendships as friendship
        on friendship.status = 'accepted'
       and friendship.user_low = least(participant.user_id, room_participant.user_id)
       and friendship.user_high = greatest(participant.user_id, room_participant.user_id)
      where room_participant.user_id <> participant.user_id
    ) into shared_with_friend;

    insert into private.focusmate_room_session_completions (
      room_id, user_id, started_at, completed_at, focus_seconds,
      was_host, shared_with_friend
    )
    values (
      new.id, participant.user_id, participant.started_at, new.finished_at,
      participant.focus_seconds, coalesce(participant.was_host, false),
      coalesce(shared_with_friend, false)
    )
    on conflict (room_id, user_id) do nothing;

    if found then
      insert into private.focusmate_room_xp_wallets (user_id, balance)
      values (participant.user_id, 20)
      on conflict (user_id) do update
      set balance = private.focusmate_room_xp_wallets.balance + 20,
          updated_at = clock_timestamp();
      perform private.adjust_focusmate_profile_xp(participant.user_id, 20);

      perform private.refresh_focusmate_room_daily_quests(
        participant.user_id, current_utc_date
      );
      perform private.award_focusmate_room_achievements(participant.user_id);
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function private.record_focusmate_room_completion()
  from public, anon, authenticated, service_role;

drop trigger if exists focus_rooms_record_room_progress on public.focus_rooms;
create trigger focus_rooms_record_room_progress
  after update of state on public.focus_rooms
  for each row
  when (old.state is distinct from new.state and new.state = 'finished')
  execute function private.record_focusmate_room_completion();

create or replace function public.get_focusmate_room_progress()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_utc_date date := (clock_timestamp() at time zone 'UTC')::date;
  wallet_balance bigint;
  quest_set jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  insert into private.focusmate_room_xp_wallets (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  select wallet.balance into wallet_balance
  from private.focusmate_room_xp_wallets as wallet
  where wallet.user_id = current_user_id;

  quest_set := private.refresh_focusmate_room_daily_quests(
    current_user_id, current_utc_date
  );

  return jsonb_build_object(
    'xp_balance', wallet_balance,
    'total_xp', (select profile.xp from public.profiles as profile where profile.id = current_user_id),
    'room_progress', private.focusmate_room_progress_json(current_user_id),
    'achievements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', award.achievement_id,
        'earned_at', award.earned_at
      ) order by award.earned_at, award.achievement_id)
      from private.focusmate_room_achievement_awards as award
      where award.user_id = current_user_id
    ), '[]'::jsonb),
    'room_daily_quests', jsonb_build_object(
      'date', current_utc_date,
      'quests', quest_set
    )
  );
end;
$$;

create or replace function public.reroll_focusmate_room_quest(
  p_quest_id text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_utc_date date := (clock_timestamp() at time zone 'UTC')::date;
  wallet_balance bigint;
  current_quests jsonb;
  updated_quests jsonb;
  current_quest jsonb;
  replacement jsonb;
  history jsonb;
  current_value numeric;
  category_name text;
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_quest_id is null or p_request_id is null then
    raise exception 'Quest and request identifiers are required.' using errcode = '22023';
  end if;

  insert into private.focusmate_room_xp_wallets (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  select wallet.balance into wallet_balance
  from private.focusmate_room_xp_wallets as wallet
  where wallet.user_id = current_user_id
  for update;

  select request.response into result
  from private.focusmate_room_xp_requests as request
  where request.user_id = current_user_id
    and request.request_id = p_request_id
    and request.request_type = 'profile_reroll';
  if found then
    return result;
  end if;

  if wallet_balance < 5 then
    raise exception 'You need at least 5 verified XP to reroll a room quest.'
      using errcode = 'P0001', detail = 'ROOM_QUEST_INSUFFICIENT_XP';
  end if;

  current_utc_date := (clock_timestamp() at time zone 'UTC')::date;
  perform private.refresh_focusmate_room_daily_quests(current_user_id, current_utc_date);
  select daily.quests into current_quests
  from private.focusmate_room_daily_quests as daily
  where daily.user_id = current_user_id and daily.quest_date = current_utc_date
  for update;

  select quest.value into current_quest
  from jsonb_array_elements(current_quests) as quest(value)
  where quest.value ->> 'id' = p_quest_id;
  if current_quest is null
    or coalesce((current_quest ->> 'completed')::boolean, false)
    or coalesce((current_quest ->> 'rewardClaimed')::boolean, false) then
    raise exception 'This room quest cannot be rerolled.' using errcode = '55000';
  end if;

  category_name := current_quest ->> 'category';
  history := coalesce(current_quest -> 'rerollHistory', '[]'::jsonb);
  select case category_name
    when 'room_sessions' then count(*)::numeric
    when 'room_focus_minutes' then floor(coalesce(sum(completion.focus_seconds), 0) / 60)::numeric
    when 'friend_room_sessions' then count(*) filter (where completion.shared_with_friend)::numeric
    when 'room_host_sessions' then count(*) filter (where completion.was_host)::numeric
    else 0::numeric
  end into current_value
  from private.focusmate_room_session_completions as completion
  where completion.user_id = current_user_id
    and completion.completed_at >= (current_utc_date::timestamp at time zone 'UTC')
    and completion.completed_at < ((current_utc_date + 1)::timestamp at time zone 'UTC');

  with alternatives as (
    select candidate.value
    from jsonb_array_elements(case category_name
      when 'room_sessions' then jsonb_build_array(
        jsonb_build_object('id','room_sessions_1','category',category_name,'target',1,'rewardXP',10),
        jsonb_build_object('id','room_sessions_3','category',category_name,'target',3,'rewardXP',20),
        jsonb_build_object('id','room_sessions_5','category',category_name,'target',5,'rewardXP',30)
      )
      when 'room_focus_minutes' then jsonb_build_array(
        jsonb_build_object('id','room_focus_15','category',category_name,'target',15,'rewardXP',10),
        jsonb_build_object('id','room_focus_30','category',category_name,'target',30,'rewardXP',20),
        jsonb_build_object('id','room_focus_60','category',category_name,'target',60,'rewardXP',30)
      )
      when 'room_host_sessions' then jsonb_build_array(
        jsonb_build_object('id','room_host_1','category',category_name,'target',1,'rewardXP',15),
        jsonb_build_object('id','room_host_2','category',category_name,'target',2,'rewardXP',20),
        jsonb_build_object('id','room_host_3','category',category_name,'target',3,'rewardXP',30)
      )
      else jsonb_build_array(
        jsonb_build_object('id','room_friend_1','category',category_name,'target',1,'rewardXP',10),
        jsonb_build_object('id','room_friend_2','category',category_name,'target',2,'rewardXP',20),
        jsonb_build_object('id','room_friend_3','category',category_name,'target',3,'rewardXP',30)
      )
    end) as candidate(value)
    where current_value < (candidate.value ->> 'target')::numeric
      and not (history ? (candidate.value ->> 'id'))
      and not exists (
        select 1
        from jsonb_array_elements(current_quests) as selected(value)
        where selected.value ->> 'id' <> p_quest_id
          and selected.value ->> 'id' = candidate.value ->> 'id'
      )
  )
  select alternatives.value into replacement
  from alternatives
  order by md5(current_user_id::text || current_utc_date::text
    || p_request_id::text || (alternatives.value ->> 'id'))
  limit 1;

  if replacement is null then
    raise exception 'No eligible room quest replacement is available today.'
      using errcode = '55000';
  end if;

  replacement := replacement || jsonb_build_object(
    'progress', 0,
    'completed', false,
    'rewardClaimed', false,
    'rerollHistory', history || jsonb_build_array(p_quest_id)
  );
  select jsonb_agg(
    case when quest.value ->> 'id' = p_quest_id then replacement else quest.value end
    order by quest.ordinality
  )
  into updated_quests
  from jsonb_array_elements(current_quests) with ordinality as quest(value, ordinality);

  update private.focusmate_room_xp_wallets
  set balance = balance - 5,
      updated_at = clock_timestamp()
  where user_id = current_user_id
  returning balance into wallet_balance;
  perform private.adjust_focusmate_profile_xp(current_user_id, -5);
  update private.focusmate_room_daily_quests
  set quests = updated_quests,
      updated_at = clock_timestamp()
  where user_id = current_user_id and quest_date = current_utc_date;

  result := jsonb_build_object(
    'xp_balance', wallet_balance,
    'total_xp', (select profile.xp from public.profiles as profile where profile.id = current_user_id),
    'room_daily_quests', jsonb_build_object('date', current_utc_date, 'quests', updated_quests)
  );
  insert into private.focusmate_room_xp_requests (
    user_id, request_id, request_type, response
  )
  values (current_user_id, p_request_id, 'profile_reroll', result);
  return result;
end;
$$;

create or replace function public.reroll_focusmate_profile_quest(
  p_quest_id text,
  p_replacement_id text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  wallet_balance bigint;
  profile_data jsonb;
  quest_set jsonb;
  quest_date text;
  current_quest jsonb;
  replacement jsonb;
  replacement_category text;
  reroll_history jsonb;
  updated_quests jsonb;
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_quest_id is null or p_replacement_id is null or p_request_id is null then
    raise exception 'Quest identifiers are required.' using errcode = '22023';
  end if;

  insert into private.focusmate_room_xp_wallets (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  select wallet.balance into wallet_balance
  from private.focusmate_room_xp_wallets as wallet
  where wallet.user_id = current_user_id
  for update;

  select request.response into result
  from private.focusmate_room_xp_requests as request
  where request.user_id = current_user_id
    and request.request_id = p_request_id
    and request.request_type = 'reroll';
  if found then
    return result;
  end if;
  if wallet_balance < 5 then
    raise exception 'You need at least 5 verified room XP to reroll a quest.'
      using errcode = 'P0001', detail = 'ROOM_QUEST_INSUFFICIENT_XP';
  end if;

  select profile.app_data into profile_data
  from public.profiles as profile
  where profile.id = current_user_id
  for update;
  quest_set := profile_data -> 'daily_quests' -> 'quests';
  quest_date := profile_data -> 'daily_quests' ->> 'date';
  if jsonb_typeof(quest_set) <> 'array' then
    raise exception 'The current daily quest set is unavailable.' using errcode = '55000';
  end if;
  select quest.value into current_quest
  from jsonb_array_elements(quest_set) as quest(value)
  where quest.value ->> 'id' = p_quest_id;
  if current_quest is null
    or coalesce((current_quest ->> 'completed')::boolean, false)
    or coalesce((current_quest ->> 'rewardClaimed')::boolean, false) then
    raise exception 'This quest cannot be rerolled.' using errcode = '55000';
  end if;

  replacement_category := case p_replacement_id
    when 'focus_15' then 'focus_time'
    when 'focus_25' then 'focus_time'
    when 'focus_40' then 'focus_time'
    when 'camera_session_1' then 'session_count'
    when 'camera_session_2' then 'session_count'
    when 'camera_session_3' then 'session_count'
    when 'session_xp_20' then 'session_xp'
    when 'session_xp_35' then 'session_xp'
    when 'session_xp_60' then 'session_xp'
    when 'posture_free' then 'camera_alerts'
    when 'distance_free' then 'camera_alerts'
    when 'looking_away_free' then 'camera_alerts'
    else null
  end;
  if replacement_category is null
    or replacement_category <> current_quest ->> 'category'
    or p_replacement_id = p_quest_id then
    raise exception 'The replacement must be an unused quest in the same category.'
      using errcode = '22023';
  end if;
  reroll_history := coalesce(current_quest -> 'rerollHistory', '[]'::jsonb);
  if reroll_history ? p_replacement_id
    or exists (
      select 1
      from jsonb_array_elements(quest_set) as selected(value)
      where selected.value ->> 'id' <> p_quest_id
        and selected.value ->> 'id' = p_replacement_id
    ) then
    raise exception 'The replacement quest has already been used today.'
      using errcode = '22023';
  end if;

  replacement := case p_replacement_id
    when 'focus_15' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'target',15,'rewardXP',10,'difficulty','Easy')
    when 'focus_25' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'target',25,'rewardXP',20,'difficulty','Medium')
    when 'focus_40' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'target',40,'rewardXP',30,'difficulty','Hard')
    when 'camera_session_1' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'target',1,'rewardXP',10,'difficulty','Easy')
    when 'camera_session_2' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'target',2,'rewardXP',20,'difficulty','Medium')
    when 'camera_session_3' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'target',3,'rewardXP',30,'difficulty','Hard')
    when 'session_xp_20' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'target',20,'rewardXP',10,'difficulty','Easy')
    when 'session_xp_35' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'target',35,'rewardXP',20,'difficulty','Medium')
    when 'session_xp_60' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'target',60,'rewardXP',30,'difficulty','Hard')
    when 'posture_free' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'signal','posture_alerts','target',1,'rewardXP',20,'difficulty','Medium')
    when 'distance_free' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'signal','distance_alerts','target',1,'rewardXP',20,'difficulty','Medium')
    when 'looking_away_free' then jsonb_build_object('id',p_replacement_id,'category',replacement_category,'signal','looking_away_alerts','target',1,'rewardXP',20,'difficulty','Medium')
  end || jsonb_build_object(
    'progress', 0,
    'completed', false,
    'rewardClaimed', false,
    'rerollHistory', reroll_history || jsonb_build_array(p_quest_id)
  );

  select jsonb_agg(
    case when quest.value ->> 'id' = p_quest_id then replacement else quest.value end
    order by quest.ordinality
  )
  into updated_quests
  from jsonb_array_elements(quest_set) with ordinality as quest(value, ordinality);

  update private.focusmate_room_xp_wallets
  set balance = balance - 5,
      updated_at = clock_timestamp()
  where user_id = current_user_id
  returning balance into wallet_balance;
  update public.profiles
  set app_data = jsonb_set(
    app_data,
    '{daily_quests}',
    jsonb_build_object('date', quest_date, 'quests', updated_quests),
    true
  )
  where id = current_user_id;
  perform private.adjust_focusmate_profile_xp(current_user_id, -5);

  result := jsonb_build_object(
    'xp_balance', wallet_balance,
    'total_xp', (select profile.xp from public.profiles as profile where profile.id = current_user_id),
    'profile_daily_quests', jsonb_build_object('date', quest_date, 'quests', updated_quests)
  );
  insert into private.focusmate_room_xp_requests (
    user_id, request_id, request_type, response
  )
  values (current_user_id, p_request_id, 'reroll', result);
  return result;
end;
$$;

create or replace function public.claim_focusmate_room_quest(
  p_quest_id text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_utc_date date := (clock_timestamp() at time zone 'UTC')::date;
  wallet_balance bigint;
  current_quests jsonb;
  updated_quests jsonb;
  current_quest jsonb;
  result jsonb;
  reward_xp integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_quest_id is null or p_request_id is null then
    raise exception 'Quest and request identifiers are required.' using errcode = '22023';
  end if;

  insert into private.focusmate_room_xp_wallets (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  select wallet.balance into wallet_balance
  from private.focusmate_room_xp_wallets as wallet
  where wallet.user_id = current_user_id
  for update;

  select request.response into result
  from private.focusmate_room_xp_requests as request
  where request.user_id = current_user_id
    and request.request_id = p_request_id
    and request.request_type = 'claim';
  if found then
    return result;
  end if;

  current_utc_date := (clock_timestamp() at time zone 'UTC')::date;
  perform private.refresh_focusmate_room_daily_quests(current_user_id, current_utc_date);
  select daily.quests into current_quests
  from private.focusmate_room_daily_quests as daily
  where daily.user_id = current_user_id and daily.quest_date = current_utc_date
  for update;

  select quest.value into current_quest
  from jsonb_array_elements(current_quests) as quest(value)
  where quest.value ->> 'id' = p_quest_id;
  if current_quest is null
    or not coalesce((current_quest ->> 'completed')::boolean, false)
    or coalesce((current_quest ->> 'rewardClaimed')::boolean, false) then
    raise exception 'This room quest is not ready to claim.' using errcode = '55000';
  end if;

  reward_xp := (current_quest ->> 'rewardXP')::integer;
  current_quest := current_quest || jsonb_build_object('rewardClaimed', true);
  select jsonb_agg(
    case when quest.value ->> 'id' = p_quest_id then current_quest else quest.value end
    order by quest.ordinality
  )
  into updated_quests
  from jsonb_array_elements(current_quests) with ordinality as quest(value, ordinality);

  update private.focusmate_room_xp_wallets
  set balance = balance + reward_xp,
      updated_at = clock_timestamp()
  where user_id = current_user_id
  returning balance into wallet_balance;
  perform private.adjust_focusmate_profile_xp(current_user_id, reward_xp);
  update private.focusmate_room_daily_quests
  set quests = updated_quests,
      updated_at = clock_timestamp()
  where user_id = current_user_id and quest_date = current_utc_date;

  result := jsonb_build_object(
    'xp_balance', wallet_balance,
    'total_xp', (select profile.xp from public.profiles as profile where profile.id = current_user_id),
    'room_daily_quests', jsonb_build_object('date', current_utc_date, 'quests', updated_quests)
  );
  insert into private.focusmate_room_xp_requests (
    user_id, request_id, request_type, response
  )
  values (current_user_id, p_request_id, 'claim', result);
  return result;
end;
$$;

revoke all on function public.get_focusmate_room_progress()
  from public, anon, authenticated;
revoke all on function public.reroll_focusmate_room_quest(text, uuid)
  from public, anon, authenticated;
revoke all on function public.reroll_focusmate_profile_quest(text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_focusmate_room_quest(text, uuid)
  from public, anon, authenticated;

grant execute on function public.get_focusmate_room_progress() to authenticated;
grant execute on function public.reroll_focusmate_room_quest(text, uuid) to authenticated;
grant execute on function public.reroll_focusmate_profile_quest(text, text, uuid) to authenticated;
grant execute on function public.claim_focusmate_room_quest(text, uuid) to authenticated;
