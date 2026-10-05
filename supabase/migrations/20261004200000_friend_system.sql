create or replace function public.search_focusmate_users(p_username text)
returns table (
  username text,
  display_name text,
  relationship_status text,
  request_sent_by_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_username text := lower(trim(coalesce(p_username, '')));
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if normalized_username !~ '^[a-z0-9_.-]{1,32}$' then
    raise exception 'Enter a valid FocusMate username' using errcode = '22023';
  end if;

  return query
    select profile.username,
           profile.display_name,
           case
             when friendship.status = 'accepted' then 'friends'
             when friendship.status = 'pending' and friendship.requester_id = current_user_id then 'sent'
             when friendship.status = 'pending' then 'received'
             else 'none'
           end,
           coalesce(friendship.status = 'pending' and friendship.requester_id = current_user_id, false)
    from public.profiles as profile
    left join public.friendships as friendship
      on friendship.user_low = least(current_user_id, profile.id)
      and friendship.user_high = greatest(current_user_id, profile.id)
    where lower(profile.username) = normalized_username
      and profile.id <> current_user_id
    limit 1;
end;
$$;

create or replace function public.list_focusmate_friends()
returns table (
  friend_id uuid,
  username text,
  display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
    select profile.id, profile.username, profile.display_name
    from public.friendships as friendship
    join public.profiles as profile
      on profile.id = case
        when friendship.requester_id = current_user_id then friendship.recipient_id
        else friendship.requester_id
      end
    where friendship.status = 'accepted'
      and current_user_id in (friendship.requester_id, friendship.recipient_id)
    order by lower(profile.username);
end;
$$;

create or replace function public.list_focusmate_friend_requests()
returns table (
  request_id uuid,
  username text,
  display_name text,
  is_sent_by_me boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
    select friendship.id,
           profile.username,
           profile.display_name,
           friendship.requester_id = current_user_id,
           friendship.created_at
    from public.friendships as friendship
    join public.profiles as profile
      on profile.id = case
        when friendship.requester_id = current_user_id then friendship.recipient_id
        else friendship.requester_id
      end
    where friendship.status = 'pending'
      and current_user_id in (friendship.requester_id, friendship.recipient_id)
    order by friendship.created_at desc;
end;
$$;

create or replace function public.send_focusmate_friend_request(p_username text)
returns table (request_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_username text := lower(trim(coalesce(p_username, '')));
  target_user_id uuid;
  pair_low uuid;
  pair_high uuid;
  existing_id uuid;
  existing_requester uuid;
  existing_status text;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if normalized_username !~ '^[a-z0-9_.-]{1,32}$' then
    raise exception 'Enter a valid FocusMate username' using errcode = '22023';
  end if;

  select profile.id
    into target_user_id
    from public.profiles as profile
    where lower(profile.username) = normalized_username
    limit 1;

  if target_user_id is null then
    raise exception 'FocusMate user not found' using errcode = 'P0002';
  end if;
  if target_user_id = current_user_id then
    raise exception 'You cannot add yourself as a friend' using errcode = '22023';
  end if;

  pair_low := least(current_user_id, target_user_id);
  pair_high := greatest(current_user_id, target_user_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pair_low::text || ':' || pair_high::text, 0)
  );

  select friendship.id, friendship.requester_id, friendship.status
    into existing_id, existing_requester, existing_status
    from public.friendships as friendship
    where friendship.user_low = pair_low
      and friendship.user_high = pair_high
    for update;

  if existing_id is not null then
    if existing_status = 'accepted' then
      return query select existing_id, 'already_friends'::text;
      return;
    end if;
    if existing_status = 'pending' and existing_requester = current_user_id then
      return query select existing_id, 'request_pending'::text;
      return;
    end if;
    if existing_status = 'pending' then
      update public.friendships
        set status = 'accepted',
            updated_at = now(),
            responded_at = now()
        where id = existing_id;
      return query select existing_id, 'accepted'::text;
      return;
    end if;

    update public.friendships
      set requester_id = current_user_id,
          recipient_id = target_user_id,
          status = 'pending',
          created_at = now(),
          updated_at = now(),
          responded_at = null
      where id = existing_id;
    return query select existing_id, 'pending'::text;
    return;
  end if;

  insert into public.friendships (requester_id, recipient_id)
  values (current_user_id, target_user_id)
  returning id into existing_id;
  return query select existing_id, 'pending'::text;
end;
$$;

create or replace function public.respond_focusmate_friend_request(
  p_request_id uuid,
  p_accept boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  next_status text := case when p_accept then 'accepted' else 'declined' end;
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.friendships
    set status = next_status,
        updated_at = now(),
        responded_at = now()
    where id = p_request_id
      and recipient_id = current_user_id
      and status = 'pending';

  if not found then
    raise exception 'Friend request not found' using errcode = 'P0002';
  end if;

  return next_status;
end;
$$;

create or replace function public.cancel_focusmate_friend_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.friendships
    set status = 'cancelled',
        updated_at = now(),
        responded_at = now()
    where id = p_request_id
      and requester_id = current_user_id
      and status = 'pending';

  if not found then
    raise exception 'Pending friend request not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.remove_focusmate_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.friendships
    set status = 'removed',
        updated_at = now(),
        responded_at = now()
    where status = 'accepted'
      and current_user_id in (requester_id, recipient_id)
      and (case when requester_id = current_user_id then recipient_id else requester_id end) = p_friend_id;

  if not found then
    raise exception 'Friendship not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.search_focusmate_users(text) from public, anon;
revoke all on function public.list_focusmate_friends() from public, anon;
revoke all on function public.list_focusmate_friend_requests() from public, anon;
revoke all on function public.send_focusmate_friend_request(text) from public, anon;
revoke all on function public.respond_focusmate_friend_request(uuid, boolean) from public, anon;
revoke all on function public.cancel_focusmate_friend_request(uuid) from public, anon;
revoke all on function public.remove_focusmate_friend(uuid) from public, anon;

grant execute on function public.search_focusmate_users(text) to authenticated;
grant execute on function public.list_focusmate_friends() to authenticated;
grant execute on function public.list_focusmate_friend_requests() to authenticated;
grant execute on function public.send_focusmate_friend_request(text) to authenticated;
grant execute on function public.respond_focusmate_friend_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_focusmate_friend_request(uuid) to authenticated;
grant execute on function public.remove_focusmate_friend(uuid) to authenticated;
