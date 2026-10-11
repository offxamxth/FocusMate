create or replace function public.join_focus_room(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_room public.focus_rooms%rowtype;
  existing_room_id uuid;
  member_count integer;
  attempt_count integer;
  member_joined_at timestamptz;
  normalized_code text := upper(trim(coalesce(p_room_code, '')));
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('focus-room-join:' || current_user_id::text, 0)
  );
  insert into private.focus_room_join_limits (user_id, window_started_at, attempts)
  values (current_user_id, now(), 1)
  on conflict (user_id) do update
    set window_started_at = case
          when private.focus_room_join_limits.window_started_at
            + interval '15 minutes' <= now()
          then now()
          else private.focus_room_join_limits.window_started_at
        end,
        attempts = case
          when private.focus_room_join_limits.window_started_at
            + interval '15 minutes' <= now()
          then 1
          else private.focus_room_join_limits.attempts + 1
        end
  returning private.focus_room_join_limits.attempts into attempt_count;
  if attempt_count > 10 then
    return jsonb_build_object(
      'error', 'Too many room-code attempts. Please try again later.',
      'code', '42900'
    );
  end if;

  if normalized_code !~ '^[A-HJ-NP-Z2-9]{8}$' then
    return jsonb_build_object(
      'error', 'Enter a valid 8-character room code.',
      'code', '22023'
    );
  end if;

  select room.* into target_room
  from public.focus_rooms as room
  where room.room_code = normalized_code
  for update;
  if not found then
    return jsonb_build_object('error', 'No open room was found with that code.', 'code', 'P0002');
  end if;
  if target_room.state not in ('waiting', 'focusing', 'paused', 'break')
    or target_room.visibility <> 'private' then
    return jsonb_build_object(
      'error', 'This room is closed or you must leave your current room first.',
      'code', '55000'
    );
  end if;

  select member.room_id into existing_room_id
  from public.focus_room_members as member
  where member.user_id = current_user_id
    and member.left_at is null
  limit 1;
  if existing_room_id = target_room.id then
    return public.focus_room_snapshot(target_room.id);
  elsif existing_room_id is not null then
    return jsonb_build_object(
      'error', 'Leave your current room before joining another.',
      'code', '55000'
    );
  end if;

  select count(*) into member_count
  from public.focus_room_members as member
  where member.room_id = target_room.id
    and member.left_at is null;
  if member_count >= target_room.capacity then
    return jsonb_build_object('error', 'This room is full.', 'code', '54000');
  end if;

  insert into public.focus_room_members (room_id, user_id, role)
  values (target_room.id, current_user_id, 'member')
  on conflict (room_id, user_id) do update
    set role = 'member',
        joined_at = clock_timestamp(),
        left_at = null
  returning joined_at into member_joined_at;

  if target_room.state = 'focusing'
    and target_room.active_segment_started_at is not null then
    insert into private.focusmate_verified_focus_segments (
      room_id, user_id, started_at
    )
    values (
      target_room.id,
      current_user_id,
      greatest(target_room.active_segment_started_at, member_joined_at)
    )
    on conflict (room_id, user_id, started_at) do nothing;
  end if;

  return public.focus_room_snapshot(target_room.id);
end;
$$;

revoke all on function public.join_focus_room(text)
  from public, anon, authenticated;
grant execute on function public.join_focus_room(text) to authenticated;

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
          'left_at', member.left_at,
          'is_ready', member.is_ready,
          'focused_seconds', coalesce((
            select sum(segment.focus_seconds)::integer
            from private.focusmate_verified_focus_segments as segment
            where segment.room_id = room.id
              and segment.user_id = member.user_id
              and segment.ended_at is not null
          ), 0),
          'focus_segment_started_at', (
            select max(segment.started_at)
            from private.focusmate_verified_focus_segments as segment
            where segment.room_id = room.id
              and segment.user_id = member.user_id
              and segment.ended_at is null
          )
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

notify pgrst, 'reload schema';
