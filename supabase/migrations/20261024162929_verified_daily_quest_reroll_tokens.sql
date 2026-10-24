create table if not exists private.focusmate_daily_quest_assignments (
  user_id uuid not null references auth.users (id) on delete cascade,
  quest_date date not null,
  quests jsonb not null check (jsonb_typeof(quests) = 'array'),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, quest_date)
);

create table if not exists private.focusmate_reroll_token_wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists private.focusmate_reroll_token_awards (
  user_id uuid not null references auth.users (id) on delete cascade,
  award_type text not null check (award_type in ('daily_quests', 'streak', 'achievement')),
  award_key text not null,
  awarded_at timestamptz not null default clock_timestamp(),
  primary key (user_id, award_type, award_key)
);

create table if not exists private.focusmate_daily_reroll_requests (
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  quest_date date not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, request_id)
);

alter table private.focusmate_daily_quest_assignments enable row level security;
alter table private.focusmate_reroll_token_wallets enable row level security;
alter table private.focusmate_reroll_token_awards enable row level security;
alter table private.focusmate_daily_reroll_requests enable row level security;

revoke all on table
  private.focusmate_daily_quest_assignments,
  private.focusmate_reroll_token_wallets,
  private.focusmate_reroll_token_awards,
  private.focusmate_daily_reroll_requests
from public, anon, authenticated, service_role;

create or replace function private.award_focusmate_reroll_token(
  p_user_id uuid,
  p_award_type text,
  p_award_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_award_type is null
    or p_award_type not in ('daily_quests', 'streak', 'achievement')
    or nullif(btrim(p_award_key), '') is null then
    raise exception 'Reroll-token award is invalid.' using errcode = '22023';
  end if;

  insert into private.focusmate_reroll_token_wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into private.focusmate_reroll_token_awards (user_id, award_type, award_key)
  values (p_user_id, p_award_type, p_award_key)
  on conflict (user_id, award_type, award_key) do nothing;

  if found then
    update private.focusmate_reroll_token_wallets
    set balance = balance + 1,
        updated_at = clock_timestamp()
    where user_id = p_user_id;
  end if;
end;
$$;

revoke all on function private.award_focusmate_reroll_token(uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function private.focusmate_daily_quest_progress(
  p_user_id uuid,
  p_quest_date date,
  p_category text
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case p_category
    when 'focus_time' then floor(coalesce(sum(completion.focus_seconds), 0)::numeric / 60)
    when 'session_count' then count(*)::numeric
    when 'session_xp' then count(*)::numeric * 20
    when 'room_host_sessions' then count(*) filter (where completion.was_host)::numeric
    else 0::numeric
  end
  from private.focusmate_room_session_completions as completion
  where completion.user_id = p_user_id
    and completion.completed_at >= (p_quest_date::timestamp at time zone 'UTC')
    and completion.completed_at < ((p_quest_date + 1)::timestamp at time zone 'UTC');
$$;

revoke all on function private.focusmate_daily_quest_progress(uuid, date, text)
  from public, anon, authenticated, service_role;

create or replace function private.refresh_focusmate_daily_quests(
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
  next_quests jsonb := '[]'::jsonb;
  current_quest jsonb;
  updated_quest jsonb;
  current_progress numeric;
  target_value numeric;
  completed boolean;
  reward_claimed boolean;
begin
  if p_user_id is null or p_quest_date is null then
    raise exception 'Daily quest identity is invalid.' using errcode = '22023';
  end if;

  insert into private.focusmate_daily_quest_assignments (user_id, quest_date, quests)
  values (
    p_user_id,
    p_quest_date,
    (
      with candidates(category, quest_id, target, difficulty) as (
        values
          ('focus_time', 'focus_15', 15, 'Easy'),
          ('focus_time', 'focus_25', 25, 'Medium'),
          ('focus_time', 'focus_40', 40, 'Hard'),
          ('session_count', 'session_1', 1, 'Easy'),
          ('session_count', 'session_2', 2, 'Medium'),
          ('session_count', 'session_3', 3, 'Hard'),
          ('session_xp', 'session_xp_20', 20, 'Easy'),
          ('session_xp', 'session_xp_40', 40, 'Medium'),
          ('session_xp', 'session_xp_60', 60, 'Hard'),
          ('room_host_sessions', 'room_host_1', 1, 'Easy'),
          ('room_host_sessions', 'room_host_2', 2, 'Medium'),
          ('room_host_sessions', 'room_host_3', 3, 'Hard')
      ),
      selected as (
        select distinct on (candidate.category)
          candidate.category,
          candidate.quest_id,
          candidate.target,
          candidate.difficulty
        from candidates as candidate
        order by candidate.category, pg_catalog.gen_random_uuid()
      )
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', selected.quest_id,
          'category', selected.category,
          'target', selected.target,
          'rewardXP', 0,
          'difficulty', selected.difficulty,
          'verified', true,
          'progress', 0,
          'completed', false,
          'rewardClaimed', false,
          'rerollHistory', '[]'::jsonb
        )
        order by selected.category
      ), '[]'::jsonb)
      from selected
    )
  )
  on conflict (user_id, quest_date) do nothing;

  select assignment.quests into current_quests
  from private.focusmate_daily_quest_assignments as assignment
  where assignment.user_id = p_user_id
    and assignment.quest_date = p_quest_date
  for update;

  for current_quest in
    select quest.value
    from jsonb_array_elements(current_quests) as quest(value)
  loop
    target_value := (current_quest ->> 'target')::numeric;
    current_progress := least(
      target_value,
      private.focusmate_daily_quest_progress(
        p_user_id,
        p_quest_date,
        current_quest ->> 'category'
      )
    );
    completed := current_progress >= target_value;
    reward_claimed := coalesce((current_quest ->> 'rewardClaimed')::boolean, false);

    if completed then
      reward_claimed := true;
    end if;

    updated_quest := jsonb_set(
      jsonb_set(
        jsonb_set(current_quest, '{progress}', to_jsonb(current_progress), true),
        '{completed}',
        to_jsonb(completed),
        true
      ),
      '{rewardClaimed}',
      to_jsonb(reward_claimed),
      true
    );
    next_quests := next_quests || jsonb_build_array(updated_quest);
  end loop;

  if jsonb_array_length(next_quests) = 4 and not exists (
    select 1
    from jsonb_array_elements(next_quests) as quest(value)
    where not coalesce((quest.value ->> 'completed')::boolean, false)
  ) then
    perform private.award_focusmate_reroll_token(
      p_user_id,
      'daily_quests',
      p_quest_date::text
    );
  end if;

  update private.focusmate_daily_quest_assignments
  set quests = next_quests,
      updated_at = clock_timestamp()
  where user_id = p_user_id
    and quest_date = p_quest_date;

  return next_quests;
end;
$$;

revoke all on function private.refresh_focusmate_daily_quests(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function private.award_focusmate_verified_streak_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_date date := (new.completed_at at time zone 'UTC')::date;
  streak_days integer;
begin
  with activity_days as (
    select distinct (completion.completed_at at time zone 'UTC')::date as day
    from private.focusmate_room_session_completions as completion
    where completion.user_id = new.user_id
      and (completion.completed_at at time zone 'UTC')::date <= activity_date
  ),
  numbered_days as (
    select activity_days.day,
           row_number() over (order by activity_days.day desc)::integer as day_number
    from activity_days
  )
  select count(*)::integer into streak_days
  from numbered_days
  where numbered_days.day = activity_date - (numbered_days.day_number - 1);

  if streak_days >= 7 and streak_days % 7 = 0 then
    perform private.award_focusmate_reroll_token(
      new.user_id,
      'streak',
      streak_days::text
    );
  end if;

  return new;
end;
$$;

revoke all on function private.award_focusmate_verified_streak_token()
  from public, anon, authenticated, service_role;

drop trigger if exists focusmate_verified_streak_token
  on private.focusmate_room_session_completions;
create trigger focusmate_verified_streak_token
  after insert on private.focusmate_room_session_completions
  for each row
  execute function private.award_focusmate_verified_streak_token();

create or replace function private.award_focusmate_achievement_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.award_focusmate_reroll_token(
    new.user_id,
    'achievement',
    new.achievement_id
  );
  return new;
end;
$$;

revoke all on function private.award_focusmate_achievement_token()
  from public, anon, authenticated, service_role;

drop trigger if exists focusmate_achievement_token
  on private.focusmate_room_achievement_awards;
create trigger focusmate_achievement_token
  after insert on private.focusmate_room_achievement_awards
  for each row
  execute function private.award_focusmate_achievement_token();

create or replace function public.get_focusmate_room_progress()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_utc_date date := (clock_timestamp() at time zone 'UTC')::date;
  room_wallet_balance bigint;
  token_balance integer;
  rerolls_used_today integer;
  room_quest_set jsonb;
  daily_quest_set jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  insert into private.focusmate_room_xp_wallets (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  select wallet.balance into room_wallet_balance
  from private.focusmate_room_xp_wallets as wallet
  where wallet.user_id = current_user_id;

  daily_quest_set := private.refresh_focusmate_daily_quests(
    current_user_id, current_utc_date
  );
  room_quest_set := private.refresh_focusmate_room_daily_quests(
    current_user_id, current_utc_date
  );

  insert into private.focusmate_reroll_token_wallets (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  select wallet.balance into token_balance
  from private.focusmate_reroll_token_wallets as wallet
  where wallet.user_id = current_user_id;

  select count(*)::integer into rerolls_used_today
  from private.focusmate_daily_reroll_requests as request
  where request.user_id = current_user_id
    and request.quest_date = current_utc_date;

  return jsonb_build_object(
    'xp_balance', room_wallet_balance,
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
      'quests', room_quest_set
    ),
    'daily_quests', jsonb_build_object(
      'date', current_utc_date,
      'quests', daily_quest_set
    ),
    'reroll_tokens', token_balance,
    'rerolls_remaining_today', greatest(0, 3 - rerolls_used_today)
  );
end;
$$;

revoke all on function public.get_focusmate_room_progress()
  from public, anon, authenticated;
grant execute on function public.get_focusmate_room_progress()
  to authenticated;

create or replace function public.reroll_focusmate_daily_quest(
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
  current_quests jsonb;
  current_quest jsonb;
  quest_category text;
  reroll_history jsonb;
  current_progress numeric;
  replacement jsonb;
  updated_quests jsonb;
  token_balance integer;
  rerolls_used_today integer;
  prior_request_id uuid;
  result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if nullif(btrim(p_quest_id), '') is null or p_request_id is null then
    raise exception 'Quest and request identifiers are required.' using errcode = '22023';
  end if;

  current_quests := private.refresh_focusmate_daily_quests(
    current_user_id, current_utc_date
  );
  select assignment.quests into current_quests
  from private.focusmate_daily_quest_assignments as assignment
  where assignment.user_id = current_user_id
    and assignment.quest_date = current_utc_date
  for update;

  insert into private.focusmate_reroll_token_wallets (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;
  select wallet.balance into token_balance
  from private.focusmate_reroll_token_wallets as wallet
  where wallet.user_id = current_user_id
  for update;

  select request.request_id into prior_request_id
  from private.focusmate_daily_reroll_requests as request
  where request.user_id = current_user_id
    and request.request_id = p_request_id;
  if found then
    select count(*)::integer into rerolls_used_today
    from private.focusmate_daily_reroll_requests as request
    where request.user_id = current_user_id
      and request.quest_date = current_utc_date;
    return jsonb_build_object(
      'daily_quests', jsonb_build_object(
        'date', current_utc_date,
        'quests', current_quests
      ),
      'reroll_tokens', token_balance,
      'rerolls_remaining_today', greatest(0, 3 - rerolls_used_today)
    );
  end if;

  select quest.value into current_quest
  from jsonb_array_elements(current_quests) as quest(value)
  where quest.value ->> 'id' = p_quest_id;
  if current_quest is null
    or coalesce((current_quest ->> 'completed')::boolean, false)
    or coalesce((current_quest ->> 'rewardClaimed')::boolean, false) then
    raise exception 'This daily quest cannot be rerolled.'
      using errcode = '55000', detail = 'DAILY_REROLL_UNAVAILABLE';
  end if;

  quest_category := current_quest ->> 'category';
  reroll_history := coalesce(current_quest -> 'rerollHistory', '[]'::jsonb);
  current_progress := private.focusmate_daily_quest_progress(
    current_user_id,
    current_utc_date,
    quest_category
  );

  with candidates(category, quest_id, target, difficulty) as (
    values
      ('focus_time', 'focus_15', 15, 'Easy'),
      ('focus_time', 'focus_25', 25, 'Medium'),
      ('focus_time', 'focus_40', 40, 'Hard'),
      ('session_count', 'session_1', 1, 'Easy'),
      ('session_count', 'session_2', 2, 'Medium'),
      ('session_count', 'session_3', 3, 'Hard'),
      ('session_xp', 'session_xp_20', 20, 'Easy'),
      ('session_xp', 'session_xp_40', 40, 'Medium'),
      ('session_xp', 'session_xp_60', 60, 'Hard'),
      ('room_host_sessions', 'room_host_1', 1, 'Easy'),
      ('room_host_sessions', 'room_host_2', 2, 'Medium'),
      ('room_host_sessions', 'room_host_3', 3, 'Hard')
  ),
  eligible as (
    select candidate.quest_id,
           candidate.target,
           candidate.difficulty
    from candidates as candidate
    where candidate.category = quest_category
      and candidate.quest_id <> p_quest_id
      and not (reroll_history ? candidate.quest_id)
      and candidate.target > current_progress
      and not exists (
        select 1
        from jsonb_array_elements(current_quests) as assigned(value)
        where assigned.value ->> 'id' = candidate.quest_id
          and assigned.value ->> 'id' <> p_quest_id
      )
  )
  select jsonb_build_object(
    'id', eligible.quest_id,
    'category', quest_category,
    'target', eligible.target,
    'rewardXP', 0,
    'difficulty', eligible.difficulty,
    'verified', true,
    'progress', least(eligible.target::numeric, current_progress),
    'completed', false,
    'rewardClaimed', false,
    'rerollHistory', reroll_history || jsonb_build_array(p_quest_id)
  )
  into replacement
  from eligible
  order by pg_catalog.gen_random_uuid()
  limit 1;

  if replacement is null then
    raise exception 'This daily quest has no unused eligible replacement.'
      using errcode = '55000', detail = 'DAILY_REROLL_UNAVAILABLE';
  end if;

  select count(*)::integer into rerolls_used_today
  from private.focusmate_daily_reroll_requests as request
  where request.user_id = current_user_id
    and request.quest_date = current_utc_date;
  if rerolls_used_today >= 3 then
    raise exception 'The daily reroll limit has been reached.'
      using errcode = 'P0001', detail = 'DAILY_REROLL_DAILY_LIMIT';
  end if;
  if token_balance < 1 then
    raise exception 'You need one reroll token to replace a daily quest.'
      using errcode = 'P0001', detail = 'DAILY_REROLL_INSUFFICIENT_TOKENS';
  end if;

  update private.focusmate_reroll_token_wallets
  set balance = balance - 1,
      updated_at = clock_timestamp()
  where user_id = current_user_id
  returning balance into token_balance;

  select jsonb_agg(
    case
      when assigned.value ->> 'id' = p_quest_id then replacement
      else assigned.value
    end
    order by assigned.ordinality
  )
  into updated_quests
  from jsonb_array_elements(current_quests) with ordinality as assigned(value, ordinality);

  update private.focusmate_daily_quest_assignments
  set quests = updated_quests,
      updated_at = clock_timestamp()
  where user_id = current_user_id
    and quest_date = current_utc_date;

  result := jsonb_build_object(
    'daily_quests', jsonb_build_object(
      'date', current_utc_date,
      'quests', updated_quests
    ),
    'reroll_tokens', token_balance,
    'rerolls_remaining_today', greatest(0, 2 - rerolls_used_today)
  );

  insert into private.focusmate_daily_reroll_requests (
    user_id, request_id, quest_date, response
  )
  values (
    current_user_id, p_request_id, current_utc_date, result
  );

  return result;
end;
$$;

revoke all on function public.reroll_focusmate_daily_quest(text, uuid)
  from public, anon, authenticated;
grant execute on function public.reroll_focusmate_daily_quest(text, uuid)
  to authenticated;

revoke all on function public.reroll_focusmate_profile_quest(text, text, uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
