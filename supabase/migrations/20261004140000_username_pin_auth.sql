alter table public.profiles
  add column if not exists app_data jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_app_data_object'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_app_data_object
      check (jsonb_typeof(app_data) = 'object');
  end if;
end;
$$;

grant update (app_data) on table public.profiles to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.pin_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  salt text not null check (salt ~ '^[A-Za-z0-9+/]{22,24}={0,2}$'),
  pin_hash text not null check (pin_hash ~ '^[A-Za-z0-9+/]{42,44}={0,2}$'),
  iterations integer not null check (iterations between 200000 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.pin_login_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0)
);

create or replace function public.register_focusmate_pin(
  p_user_id uuid,
  p_salt text,
  p_pin_hash text,
  p_iterations integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  insert into private.pin_credentials (user_id, salt, pin_hash, iterations)
  values (p_user_id, p_salt, p_pin_hash, p_iterations)
  on conflict (user_id) do update
    set salt = excluded.salt,
        pin_hash = excluded.pin_hash,
        iterations = excluded.iterations,
        updated_at = now();
end;
$$;

create or replace function public.find_focusmate_user_by_username(p_username text)
returns table (id uuid, username text, display_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  return query
    select p.id, p.username, p.display_name
    from public.profiles as p
    where lower(p.username) = lower(trim(p_username))
    limit 1;
end;
$$;

create or replace function public.get_focusmate_pin_credential(p_user_id uuid)
returns table (salt text, pin_hash text, iterations integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  return query
    select credential.salt, credential.pin_hash, credential.iterations
    from private.pin_credentials as credential
    where credential.user_id = p_user_id;
end;
$$;

create or replace function public.consume_focusmate_pin_attempts(
  p_key_hashes text[],
  p_max_attempts integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key_hash text;
  started_at timestamptz;
  attempt_count integer;
  allowed boolean := true;
begin
  if (select auth.role()) <> 'service_role'
    or p_key_hashes is null
    or p_max_attempts not between 1 and 20
    or p_window_seconds not between 60 and 86400
    or cardinality(p_key_hashes) not between 1 and 4 then
    raise exception 'Not authorized';
  end if;

  delete from private.pin_login_limits
    where window_started_at + interval '1 day' <= now();

  foreach v_key_hash in array p_key_hashes loop
    if v_key_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid rate-limit key';
    end if;

    insert into private.pin_login_limits (key_hash, window_started_at, attempts)
    values (v_key_hash, now(), 1)
    on conflict (key_hash) do update
      set window_started_at = case
            when private.pin_login_limits.window_started_at
              + make_interval(secs => p_window_seconds) <= now()
            then now()
            else private.pin_login_limits.window_started_at
          end,
          attempts = case
            when private.pin_login_limits.window_started_at
              + make_interval(secs => p_window_seconds) <= now()
            then 1
            else private.pin_login_limits.attempts + 1
          end;

    select limits.window_started_at, limits.attempts
      into started_at, attempt_count
      from private.pin_login_limits as limits
      where limits.key_hash = v_key_hash;

    if started_at + make_interval(secs => p_window_seconds) > now()
      and attempt_count > p_max_attempts then
      allowed := false;
    end if;
  end loop;

  return allowed;
end;
$$;

create or replace function public.clear_focusmate_pin_attempts(p_key_hashes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) <> 'service_role'
    or cardinality(p_key_hashes) not between 1 and 4 then
    raise exception 'Not authorized';
  end if;

  delete from private.pin_login_limits
    where key_hash = any(p_key_hashes);
end;
$$;

revoke all on function public.register_focusmate_pin(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.find_focusmate_user_by_username(text)
  from public, anon, authenticated;
revoke all on function public.get_focusmate_pin_credential(uuid)
  from public, anon, authenticated;
revoke all on function public.consume_focusmate_pin_attempts(text[], integer, integer)
  from public, anon, authenticated;
revoke all on function public.clear_focusmate_pin_attempts(text[])
  from public, anon, authenticated;

grant execute on function public.register_focusmate_pin(uuid, text, text, integer)
  to service_role;
grant execute on function public.find_focusmate_user_by_username(text)
  to service_role;
grant execute on function public.get_focusmate_pin_credential(uuid)
  to service_role;
grant execute on function public.consume_focusmate_pin_attempts(text[], integer, integer)
  to service_role;
grant execute on function public.clear_focusmate_pin_attempts(text[])
  to service_role;

alter table private.pin_credentials enable row level security;
alter table private.pin_login_limits enable row level security;

revoke all on table private.pin_credentials, private.pin_login_limits
  from public, anon, authenticated;
grant all on table private.pin_credentials, private.pin_login_limits
  to service_role;
