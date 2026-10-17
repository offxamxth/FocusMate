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
    set state = case
          when target_room.state = 'finished' then 'finished'
          else 'closed'
        end,
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

revoke all on function public.leave_focus_room(uuid)
  from public, anon, authenticated;
grant execute on function public.leave_focus_room(uuid) to authenticated;

create or replace function public.get_focus_room(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  room_state text;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select room.state into room_state
  from public.focus_rooms as room
  where room.id = p_room_id;
  if not found or not (
    (select public.is_active_focus_room_member(p_room_id))
    or (
      (
        room_state = 'closed'
        or (
          room_state = 'finished'
          and not exists (
            select 1
            from public.focus_room_members as host_member
            where host_member.room_id = p_room_id
              and host_member.role = 'host'
              and host_member.left_at is null
          )
        )
      )
      and (select public.is_focus_room_member(p_room_id))
    )
  ) then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
  return public.focus_room_snapshot(p_room_id);
end;
$$;

revoke all on function public.get_focus_room(uuid)
  from public, anon, authenticated;
grant execute on function public.get_focus_room(uuid) to authenticated;

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
        and (
          member.left_at is null
          or room.state = 'closed'
          or (
            room.state = 'finished'
            and not exists (
              select 1
              from public.focus_room_members as host_member
              where host_member.room_id = room.id
                and host_member.role = 'host'
                and host_member.left_at is null
            )
          )
        )
    ), '[]'::jsonb)
  )
  from public.focus_rooms as room
  where room.id = p_room_id;
$$;

revoke all on function public.focus_room_snapshot(uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
