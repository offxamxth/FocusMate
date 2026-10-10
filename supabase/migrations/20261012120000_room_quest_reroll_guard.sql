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
      and candidate.value ->> 'id' <> p_quest_id
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
