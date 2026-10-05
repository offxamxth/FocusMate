create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  user_low uuid generated always as (least(requester_id, recipient_id)) stored,
  user_high uuid generated always as (greatest(requester_id, recipient_id)) stored,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_distinct_users check (requester_id <> recipient_id),
  constraint friendships_one_row_per_pair unique (user_low, user_high)
);

create index friendships_recipient_status_idx
  on public.friendships (recipient_id, status, created_at desc);
create index friendships_requester_status_idx
  on public.friendships (requester_id, status, created_at desc);

create table public.focus_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique
    check (room_code ~ '^[A-Z0-9]{6}$'),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  visibility text not null default 'public'
    check (visibility in ('public', 'private')),
  state text not null default 'waiting'
    check (state in ('waiting', 'focusing', 'break', 'paused', 'finished', 'closed')),
  capacity smallint not null default 8 check (capacity between 2 and 12),
  session_duration_seconds integer
    check (session_duration_seconds is null or session_duration_seconds between 300 and 14400),
  session_started_at timestamptz,
  paused_at timestamptz,
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index focus_rooms_owner_state_idx
  on public.focus_rooms (owner_id, state, created_at desc);
create index focus_rooms_visibility_state_idx
  on public.focus_rooms (visibility, state, created_at desc);

create table public.focus_room_members (
  room_id uuid not null references public.focus_rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'idle'
    check (status in ('idle', 'focusing', 'break', 'paused', 'finished')),
  joined_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index focus_room_members_user_joined_idx
  on public.focus_room_members (user_id, joined_at desc);
create index focus_room_members_room_status_idx
  on public.focus_room_members (room_id, status);

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

revoke all on function public.is_focus_room_member(uuid)
  from public, anon;
grant execute on function public.is_focus_room_member(uuid)
  to authenticated;

alter table public.friendships enable row level security;
alter table public.focus_rooms enable row level security;
alter table public.focus_room_members enable row level security;

revoke all on table public.friendships, public.focus_rooms, public.focus_room_members
  from public, anon, authenticated;
grant select on table public.friendships, public.focus_rooms, public.focus_room_members
  to authenticated;

create policy "Users can read their own friendship rows"
  on public.friendships
  for select
  to authenticated
  using ((select auth.uid()) in (requester_id, recipient_id));

create policy "Users can read discoverable or joined focus rooms"
  on public.focus_rooms
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (visibility = 'public' and state <> 'closed')
    or (select public.is_focus_room_member(id))
  );

create policy "Users can read members of rooms they joined"
  on public.focus_room_members
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_focus_room_member(room_id))
  );

alter table public.friendships replica identity full;
alter table public.focus_rooms replica identity full;
alter table public.focus_room_members replica identity full;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'friendships',
    'focus_rooms',
    'focus_room_members'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
