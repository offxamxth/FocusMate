alter table public.focus_rooms
  add column if not exists active_segment_started_at timestamptz,
  add column if not exists break_started_at timestamptz,
  add column if not exists break_duration_seconds integer,
  add column if not exists finished_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'focus_rooms_break_duration_seconds_check'
      and conrelid = 'public.focus_rooms'::regclass
  ) then
    alter table public.focus_rooms
      add constraint focus_rooms_break_duration_seconds_check
      check (
        break_duration_seconds is null
        or break_duration_seconds between 60 and 3600
      );
  end if;
end;
$$;

drop policy if exists "FocusMate room members can read room presence"
  on realtime.messages;
drop policy if exists "FocusMate room members can publish room presence"
  on realtime.messages;

create policy "FocusMate room members can read room presence"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'presence'
    and exists (
      select 1
      from public.focus_room_members as member
      where realtime.topic() = 'focusmate-room:' || member.room_id::text
        and member.user_id = (select auth.uid())
        and member.left_at is null
    )
    and exists (
      select 1
      from public.focus_rooms as room
      join public.focus_room_members as member on member.room_id = room.id
      where realtime.topic() = 'focusmate-room:' || room.id::text
        and member.user_id = (select auth.uid())
        and member.left_at is null
        and room.state in ('waiting', 'focusing', 'paused', 'break', 'finished')
    )
  );

create policy "FocusMate room members can publish room presence"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and exists (
      select 1
      from public.focus_room_members as member
      join public.focus_rooms as room on room.id = member.room_id
      where realtime.topic() = 'focusmate-room:' || member.room_id::text
        and member.user_id = (select auth.uid())
        and member.left_at is null
        and room.state in ('waiting', 'focusing', 'paused', 'break', 'finished')
    )
  );

create or replace function public.focus_room_snapshot(p_room_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', room.id,
    'room_code', room.room_code,
    'name', room.name,
    'status', room.state,
    'host_id', room.owner_id,
    'created_at', room.created_at,
    'capacity', room.capacity,
    'session_duration_seconds', room.session_duration_seconds,
    'session_started_at', room.session_started_at,
    'active_segment_started_at', room.active_segment_started_at,
    'paused_at', room.paused_at,
    'break_started_at', room.break_started_at,
    'break_duration_seconds', room.break_duration_seconds,
    'elapsed_seconds', room.elapsed_seconds,
    'finished_at', room.finished_at,
    'server_now', clock_timestamp(),
    'participants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', member.user_id,
          'username', profile.username,
          'display_name', profile.display_name,
          'role', member.role,
          'joined_at', member.joined_at,
          'left_at', member.left_at
        )
        order by member.joined_at, member.user_id
      )
      from public.focus_room_members as member
      join public.profiles as profile on profile.id = member.user_id
      where member.room_id = room.id
        and (member.left_at is null or room.state = 'closed')
    ), '[]'::jsonb)
  )
  from public.focus_rooms as room
  where room.id = p_room_id;
$$;

create or replace function public.start_focus_room_session(
  p_room_id uuid,
  p_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.focus_rooms%rowtype;
  caller_role text;
  transition_time timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select room.* into target_room
  from public.focus_rooms as room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  select member.role into caller_role
  from public.focus_room_members as member
  where member.room_id = p_room_id
    and member.user_id = current_user_id
    and member.left_at is null
  for update;
  if not found or caller_role <> 'host' then
    raise exception 'Only the active room host can control its session.'
      using errcode = '42501';
  end if;
  if p_duration_seconds is null or p_duration_seconds not between 300 and 14400 then
    raise exception 'Focus duration must be between 300 and 14400 seconds.'
      using errcode = '22023';
  end if;
  if target_room.state = 'focusing' then
    return public.focus_room_snapshot(p_room_id);
  end if;
  if target_room.state <> 'waiting' then
    raise exception 'A session can only start from the waiting state.'
      using errcode = '55000';
  end if;

  transition_time := clock_timestamp();
  update public.focus_rooms
  set state = 'focusing',
      session_duration_seconds = p_duration_seconds,
      session_started_at = transition_time,
      active_segment_started_at = transition_time,
      paused_at = null,
      break_started_at = null,
      break_duration_seconds = null,
      elapsed_seconds = 0,
      finished_at = null,
      updated_at = transition_time
  where id = p_room_id;

  return public.focus_room_snapshot(p_room_id);
end;
$$;

create or replace function public.pause_focus_room_session(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.focus_rooms%rowtype;
  caller_role text;
  transition_time timestamptz;
  active_segment_seconds integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select room.* into target_room
  from public.focus_rooms as room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
  select member.role into caller_role
  from public.focus_room_members as member
  where member.room_id = p_room_id
    and member.user_id = current_user_id
    and member.left_at is null
  for update;
  if not found or caller_role <> 'host' then
    raise exception 'Only the active room host can control its session.'
      using errcode = '42501';
  end if;
  if target_room.state = 'paused' then
    return public.focus_room_snapshot(p_room_id);
  end if;
  if target_room.state <> 'focusing'
    or target_room.active_segment_started_at is null then
    raise exception 'Only an active focus session can be paused.'
      using errcode = '55000';
  end if;

  transition_time := clock_timestamp();
  active_segment_seconds := greatest(
    0,
    floor(extract(epoch from (transition_time - target_room.active_segment_started_at)))::integer
  );
  update public.focus_rooms
  set state = 'paused',
      elapsed_seconds = target_room.elapsed_seconds + active_segment_seconds,
      active_segment_started_at = null,
      paused_at = transition_time,
      updated_at = transition_time
  where id = p_room_id;

  return public.focus_room_snapshot(p_room_id);
end;
$$;

create or replace function public.resume_focus_room_session(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.focus_rooms%rowtype;
  caller_role text;
  transition_time timestamptz;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select room.* into target_room
  from public.focus_rooms as room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
  select member.role into caller_role
  from public.focus_room_members as member
  where member.room_id = p_room_id
    and member.user_id = current_user_id
    and member.left_at is null
  for update;
  if not found or caller_role <> 'host' then
    raise exception 'Only the active room host can control its session.'
      using errcode = '42501';
  end if;
  if target_room.state = 'focusing' then
    return public.focus_room_snapshot(p_room_id);
  end if;
  if target_room.state not in ('paused', 'break') then
    raise exception 'Only a paused session or break can resume focus.'
      using errcode = '55000';
  end if;

  transition_time := clock_timestamp();
  update public.focus_rooms
  set state = 'focusing',
      active_segment_started_at = transition_time,
      paused_at = null,
      break_started_at = null,
      break_duration_seconds = null,
      updated_at = transition_time
  where id = p_room_id;

  return public.focus_room_snapshot(p_room_id);
end;
$$;

create or replace function public.start_focus_room_break(
  p_room_id uuid,
  p_break_duration_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.focus_rooms%rowtype;
  caller_role text;
  transition_time timestamptz;
  active_segment_seconds integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select room.* into target_room
  from public.focus_rooms as room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
  select member.role into caller_role
  from public.focus_room_members as member
  where member.room_id = p_room_id
    and member.user_id = current_user_id
    and member.left_at is null
  for update;
  if not found or caller_role <> 'host' then
    raise exception 'Only the active room host can control its session.'
      using errcode = '42501';
  end if;
  if p_break_duration_seconds is null
    or p_break_duration_seconds not between 60 and 3600 then
    raise exception 'Break duration must be between 60 and 3600 seconds.'
      using errcode = '22023';
  end if;
  if target_room.state = 'break' then
    return public.focus_room_snapshot(p_room_id);
  end if;
  if target_room.state <> 'focusing'
    or target_room.active_segment_started_at is null then
    raise exception 'A break can only start during an active focus session.'
      using errcode = '55000';
  end if;

  transition_time := clock_timestamp();
  active_segment_seconds := greatest(
    0,
    floor(extract(epoch from (transition_time - target_room.active_segment_started_at)))::integer
  );
  update public.focus_rooms
  set state = 'break',
      elapsed_seconds = target_room.elapsed_seconds + active_segment_seconds,
      active_segment_started_at = null,
      paused_at = null,
      break_started_at = transition_time,
      break_duration_seconds = p_break_duration_seconds,
      updated_at = transition_time
  where id = p_room_id;

  return public.focus_room_snapshot(p_room_id);
end;
$$;

create or replace function public.finish_focus_room_session(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.focus_rooms%rowtype;
  caller_role text;
  transition_time timestamptz;
  active_segment_seconds integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select room.* into target_room
  from public.focus_rooms as room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
  select member.role into caller_role
  from public.focus_room_members as member
  where member.room_id = p_room_id
    and member.user_id = current_user_id
    and member.left_at is null
  for update;
  if not found or caller_role <> 'host' then
    raise exception 'Only the active room host can control its session.'
      using errcode = '42501';
  end if;
  if target_room.state = 'finished' then
    return public.focus_room_snapshot(p_room_id);
  end if;
  if target_room.state not in ('focusing', 'paused', 'break') then
    raise exception 'Only a started session can be finished.'
      using errcode = '55000';
  end if;

  transition_time := clock_timestamp();
  if target_room.state = 'focusing' then
    if target_room.active_segment_started_at is null then
      raise exception 'The active focus segment is unavailable.'
        using errcode = '55000';
    end if;
    active_segment_seconds := greatest(
      0,
      floor(extract(epoch from (transition_time - target_room.active_segment_started_at)))::integer
    );
  end if;

  update public.focus_rooms
  set state = 'finished',
      elapsed_seconds = target_room.elapsed_seconds + active_segment_seconds,
      active_segment_started_at = null,
      paused_at = null,
      break_started_at = null,
      finished_at = transition_time,
      updated_at = transition_time
  where id = p_room_id;

  return public.focus_room_snapshot(p_room_id);
end;
$$;

create or replace function public.leave_focus_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.focus_rooms%rowtype;
  member_role text;
  transition_time timestamptz;
  active_segment_seconds integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select room.* into target_room
  from public.focus_rooms as room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  select member.role into member_role
  from public.focus_room_members as member
  where member.room_id = p_room_id
    and member.user_id = current_user_id
    and member.left_at is null
  for update;
  if not found then
    if target_room.state = 'closed' and exists (
      select 1 from public.focus_room_members as member
      where member.room_id = p_room_id and member.user_id = current_user_id
    ) then
      delete from public.focus_room_members
      where room_id = p_room_id and user_id = current_user_id;
      return jsonb_build_object('closed', true);
    end if;
    raise exception 'You are not a member of this room.' using errcode = '42501';
  end if;

  if member_role = 'host' then
    transition_time := clock_timestamp();
    if target_room.state = 'focusing'
      and target_room.active_segment_started_at is not null then
      active_segment_seconds := greatest(
        0,
        floor(extract(epoch from (transition_time - target_room.active_segment_started_at)))::integer
      );
    end if;
    update public.focus_rooms
    set state = 'closed',
        elapsed_seconds = target_room.elapsed_seconds + active_segment_seconds,
        active_segment_started_at = null,
        paused_at = null,
        break_started_at = null,
        finished_at = case
          when target_room.state in ('focusing', 'paused', 'break')
          then coalesce(target_room.finished_at, transition_time)
          else target_room.finished_at
        end,
        updated_at = transition_time
    where id = p_room_id;
    update public.focus_room_members
    set left_at = transition_time
    where room_id = p_room_id and left_at is null;
    return jsonb_build_object('closed', true);
  end if;

  update public.focus_room_members
  set left_at = clock_timestamp()
  where room_id = p_room_id and user_id = current_user_id;
  return jsonb_build_object('closed', false);
end;
$$;

revoke all on function public.start_focus_room_session(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.pause_focus_room_session(uuid)
  from public, anon, authenticated;
revoke all on function public.resume_focus_room_session(uuid)
  from public, anon, authenticated;
revoke all on function public.start_focus_room_break(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.finish_focus_room_session(uuid)
  from public, anon, authenticated;

grant execute on function public.start_focus_room_session(uuid, integer) to authenticated;
grant execute on function public.pause_focus_room_session(uuid) to authenticated;
grant execute on function public.resume_focus_room_session(uuid) to authenticated;
grant execute on function public.start_focus_room_break(uuid, integer) to authenticated;
grant execute on function public.finish_focus_room_session(uuid) to authenticated;
