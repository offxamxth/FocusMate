alter table public.focus_rooms
  alter column visibility set default 'private';

update public.focus_rooms
set visibility = 'private'
where visibility <> 'private';

alter table public.focus_rooms
  drop constraint if exists focus_rooms_room_code_check;

alter table public.focus_rooms
  add constraint focus_rooms_room_code_check
  check (room_code ~ '^[A-HJ-NP-Z2-9]{8}$');

alter table public.focus_room_members
  add column if not exists role text not null default 'member'
    check (role in ('host', 'member')),
  add column if not exists left_at timestamptz;

update public.focus_room_members as member
set role = case when member.user_id = room.owner_id then 'host' else 'member' end
from public.focus_rooms as room
where room.id = member.room_id;

create unique index if not exists focus_room_members_one_host_idx
  on public.focus_room_members (room_id)
  where role = 'host';

create unique index if not exists focus_room_members_one_active_room_per_user_idx
  on public.focus_room_members (user_id)
  where left_at is null;

create index if not exists focus_room_members_active_room_idx
  on public.focus_room_members (room_id, joined_at)
  where left_at is null;

create table if not exists private.focus_room_join_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0)
);

alter table private.focus_room_join_limits enable row level security;
revoke all on table private.focus_room_join_limits from public, anon, authenticated;

create or replace function public.is_focus_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.focus_room_members as member
    where member.room_id = p_room_id
      and member.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_active_focus_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.focus_room_members as member
    where member.room_id = p_room_id
      and member.user_id = (select auth.uid())
      and member.left_at is null
  );
$$;

revoke all on function public.is_focus_room_member(uuid) from public, anon;
revoke all on function public.is_active_focus_room_member(uuid) from public, anon;
grant execute on function public.is_focus_room_member(uuid) to authenticated;
grant execute on function public.is_active_focus_room_member(uuid) to authenticated;

drop policy if exists "Users can read discoverable or joined focus rooms"
  on public.focus_rooms;
drop policy if exists "Users can read members of rooms they joined"
  on public.focus_room_members;
drop policy if exists "Room members can read private focus rooms"
  on public.focus_rooms;
drop policy if exists "Room participants can read memberships"
  on public.focus_room_members;

create policy "Room members can read private focus rooms"
  on public.focus_rooms
  for select
  to authenticated
  using (
    (select public.is_active_focus_room_member(id))
    or (
      state = 'closed'
      and (select public.is_focus_room_member(id))
    )
  );

create policy "Room participants can read memberships"
  on public.focus_room_members
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_active_focus_room_member(room_id))
  );

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
        and room.state = 'waiting'
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
        and room.state = 'waiting'
    )
  );

create or replace function public.focus_room_snapshot(p_room_id uuid)
returns jsonb
language sql
stable
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

create or replace function public.create_focus_room(p_name text default 'Study room')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_room_id uuid;
  new_room_code text;
  room_name text := left(trim(coalesce(p_name, 'Study room')), 60);
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code_bytes bytea;
  attempt integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if room_name = '' then
    room_name := 'Study room';
  end if;
  if exists (
    select 1 from public.focus_room_members as member
    where member.user_id = current_user_id
      and member.left_at is null
  ) then
    raise exception 'Leave your current room before creating another.' using errcode = '55000';
  end if;

  for attempt in 1..8 loop
    code_bytes := extensions.gen_random_bytes(8);
    new_room_code := '';
    for index in 0..7 loop
      new_room_code := new_room_code
        || substr(alphabet, (get_byte(code_bytes, index) % 32) + 1, 1);
    end loop;

    begin
      insert into public.focus_rooms (room_code, owner_id, name, visibility, state)
      values (new_room_code, current_user_id, room_name, 'private', 'waiting')
      returning id into new_room_id;
      exit;
    exception when unique_violation then
      if attempt = 8 then
        raise exception 'Could not generate a unique room code. Please try again.'
          using errcode = '54000';
      end if;
    end;
  end loop;

  insert into public.focus_room_members (room_id, user_id, role)
  values (new_room_id, current_user_id, 'host');

  return public.focus_room_snapshot(new_room_id);
end;
$$;

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
  if target_room.state <> 'waiting' or target_room.visibility <> 'private' then
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
        joined_at = now(),
        left_at = null;

  return public.focus_room_snapshot(target_room.id);
end;
$$;

create or replace function public.get_my_focus_room()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_room_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select member.room_id into current_room_id
  from public.focus_room_members as member
  where member.user_id = current_user_id
    and member.left_at is null
  order by member.joined_at desc
  limit 1;

  if current_room_id is null then
    return null;
  end if;
  return public.focus_room_snapshot(current_room_id);
end;
$$;

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
      room_state = 'closed'
      and (select public.is_focus_room_member(p_room_id))
    )
  ) then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;
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
    update public.focus_rooms
    set state = 'closed', updated_at = now()
    where id = p_room_id;
    update public.focus_room_members
    set left_at = now()
    where room_id = p_room_id and left_at is null;
    return jsonb_build_object('closed', true);
  end if;

  update public.focus_room_members
  set left_at = now()
  where room_id = p_room_id and user_id = current_user_id;
  return jsonb_build_object('closed', false);
end;
$$;

revoke all on function public.focus_room_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.create_focus_room(text)
  from public, anon, authenticated;
revoke all on function public.join_focus_room(text)
  from public, anon, authenticated;
revoke all on function public.get_my_focus_room()
  from public, anon, authenticated;
revoke all on function public.get_focus_room(uuid)
  from public, anon, authenticated;
revoke all on function public.leave_focus_room(uuid)
  from public, anon, authenticated;

grant execute on function public.create_focus_room(text) to authenticated;
grant execute on function public.join_focus_room(text) to authenticated;
grant execute on function public.get_my_focus_room() to authenticated;
grant execute on function public.get_focus_room(uuid) to authenticated;
grant execute on function public.leave_focus_room(uuid) to authenticated;
