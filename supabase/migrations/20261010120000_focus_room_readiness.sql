alter table public.focus_room_members
  add column if not exists is_ready boolean not null default false;

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
          'is_ready', member.is_ready
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

create or replace function private.require_focus_room_members_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'waiting'
    and new.state = 'focusing'
    and exists (
      select 1
      from public.focus_room_members as member
      where member.room_id = new.id
        and member.left_at is null
        and member.is_ready is not true
    )
  then
    raise exception 'Everyone in the room must be ready before the host can start.'
      using errcode = '55001';
  end if;
  return new;
end;
$$;

revoke all on function private.require_focus_room_members_ready()
  from public, anon, authenticated, service_role;

drop trigger if exists focus_room_require_ready_before_start
  on public.focus_rooms;
create trigger focus_room_require_ready_before_start
  before update of state on public.focus_rooms
  for each row execute function private.require_focus_room_members_ready();

create or replace function private.reset_focus_room_member_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.left_at is distinct from old.left_at then
    new.is_ready := false;
  end if;
  return new;
end;
$$;

revoke all on function private.reset_focus_room_member_readiness()
  from public, anon, authenticated, service_role;

drop trigger if exists focus_room_reset_readiness_on_membership_change
  on public.focus_room_members;
create trigger focus_room_reset_readiness_on_membership_change
  before update of left_at on public.focus_room_members
  for each row execute function private.reset_focus_room_member_readiness();

create or replace function public.set_focus_room_ready(
  p_room_id uuid,
  p_ready boolean
)
returns jsonb
language plpgsql
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
  if p_ready is null then
    raise exception 'Ready state is required.' using errcode = '22023';
  end if;

  select room.state into room_state
  from public.focus_rooms as room
  where room.id = p_room_id
  for update;
  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
  if room_state <> 'waiting' then
    raise exception 'Readiness can only change while the room is waiting.'
      using errcode = '55000';
  end if;
  if not exists (
    select 1
    from public.focus_room_members as member
    where member.room_id = p_room_id
      and member.user_id = current_user_id
      and member.left_at is null
  ) then
    raise exception 'You are not an active member of this room.'
      using errcode = '42501';
  end if;

  update public.focus_room_members
  set is_ready = p_ready
  where room_id = p_room_id
    and user_id = current_user_id
    and left_at is null;

  return public.focus_room_snapshot(p_room_id);
end;
$$;

revoke all on function public.set_focus_room_ready(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_focus_room_ready(uuid, boolean)
  to authenticated;
