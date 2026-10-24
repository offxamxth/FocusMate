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
  completed_eligible_quests integer;
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

  select count(*)::integer into completed_eligible_quests
  from jsonb_array_elements(next_quests) as quest(value)
  where coalesce((quest.value ->> 'verified')::boolean, false)
    and coalesce((quest.value ->> 'completed')::boolean, false)
    and quest.value ->> 'category' in (
      'focus_time', 'session_count', 'session_xp', 'room_host_sessions'
    );

  if completed_eligible_quests >= 3 then
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