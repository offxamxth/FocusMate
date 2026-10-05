import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import {
  authErrorMessage,
  localIdentityForAuthUser,
  supabase,
  supabaseConfigured,
  supabaseConfigurationIssue,
  updatePrivateProfile,
  validCloudUsername,
} from '../src/lib/supabase.js';
import { claimTimerCompletion, playSessionCompletionBeep } from '../src/timer-completion.js';

test('Supabase auth validation and account-local storage identities are bounded', () => {
  assert.equal(Boolean(supabase), supabaseConfigured);
  assert.equal(validCloudUsername('study.friend'), true);
  assert.equal(validCloudUsername('not a username'), false);
  assert.equal(validCloudUsername(''), false);
  assert.equal(
    localIdentityForAuthUser('123e4567-e89b-12d3-a456-426614174000'),
    'cloud_123e4567e89b12d3a456426614174000',
  );
  assert.throws(() => localIdentityForAuthUser('not-a-user-id'), /invalid ID/);
});

test('Supabase configuration requires the project URL and a public key, never a secret key', () => {
  assert.match(supabaseConfigurationIssue('', ''), /VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(
    supabaseConfigurationIssue('https://qdvxfpzoychtgfenfjrs.supabase.co', ''),
    /VITE_SUPABASE_PUBLISHABLE_KEY/,
  );
  assert.match(
    supabaseConfigurationIssue('https://qdvxfpzoychtgfenfjrs.supabase.co', 'sb_secret_do_not_use'),
    /never use a Supabase secret or service-role key/,
  );
  const serviceRolePayload = btoa(JSON.stringify({ role: 'service_role' }));
  assert.match(
    supabaseConfigurationIssue(
      'https://qdvxfpzoychtgfenfjrs.supabase.co',
      `header.${serviceRolePayload}.signature`,
    ),
    /never use a Supabase secret or service-role key/,
  );
  assert.match(
    supabaseConfigurationIssue(
      'https://qdvxfpzoychtgfenfjrs.supabase.co',
      'sb_publishable_replace_with_your_project_key',
    ),
    /replace the example value/,
  );
  assert.match(
    supabaseConfigurationIssue('http://not-local.example', 'sb_publishable_public-test'),
    /must use HTTPS/,
  );
  assert.equal(
    supabaseConfigurationIssue('https://qdvxfpzoychtgfenfjrs.supabase.co', 'sb_publishable_public-test'),
    '',
  );
  assert.doesNotThrow(() => createClient(
    'https://qdvxfpzoychtgfenfjrs.supabase.co',
    'sb_publishable_public-test',
  ));
});

test('authentication errors do not expose legacy email or password details', () => {
  assert.match(authErrorMessage(new Error('Invalid login credentials')), /Authentication could not be completed/);
  assert.match(authErrorMessage(new Error('Email not confirmed')), /Authentication could not be completed/);
  assert.match(authErrorMessage(new Error('Failed to fetch')), /Network error/);
  assert.match(authErrorMessage(new Error('User password is too short')), /Authentication could not be completed/);
});

test('cloud profile updates whitelist profile and preference fields, never XP or identity', async () => {
  let updatePayload;
  let selectedColumns;
  let matchedUserId;
  const query = {
    update(value) {
      updatePayload = value;
      return this;
    },
    eq(column, value) {
      assert.equal(column, 'user_id');
      matchedUserId = value;
      return this;
    },
    select(value) {
      selectedColumns = value;
      return this;
    },
    async single() {
      return { data: { id: matchedUserId, ...updatePayload }, error: null };
    },
  };
  const fakeClient = { from: (table) => {
    assert.equal(table, 'profiles');
    return query;
  } };
  const updated = await updatePrivateProfile(fakeClient, 'user-a-id', {
    player_name: 'Alex',
    total_xp: 999999,
    username: 'another-user',
    session_preferences: {
      theme: 'dark',
      study_style: 'quiet',
      study_goal_type: 'coding',
      time_format: '24-hour',
      daily_goal_minutes: 90,
    },
  });
  assert.equal(matchedUserId, 'user-a-id');
  assert.deepEqual(updatePayload, {
    display_name: 'Alex',
    study_goal: 'coding',
    theme: 'dark',
    study_style: 'quiet',
    time_format: '24-hour',
    session_preferences: { daily_goal_minutes: 90 },
    preferences: {
      daily_goal_minutes: 90,
      study_goal_type: 'coding',
      theme: 'dark',
      study_style: 'quiet',
      time_format: '24-hour',
    },
  });
  assert.match(selectedColumns, /user_id/);
  assert.doesNotMatch(selectedColumns, /password/i);
  assert.equal(Object.hasOwn(updatePayload, 'xp'), false);
  assert.equal(Object.hasOwn(updatePayload, 'user_id'), false);
  assert.equal(updated.id, 'user-a-id');
});

test('profile database migration restricts private access to the authenticated owner', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261004120000_profiles.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /using \(\(select auth\.uid\(\)\) = id\)/i);
  assert.match(sql, /with check \(\(select auth\.uid\(\)\) = id\)/i);
  assert.match(sql, /profiles_username_lower_unique/i);
  assert.match(sql, /revoke all on table public\.profiles from anon, authenticated/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /\bservice[_ -]?role\b|\bsecret[_ -]?key\b/i);
  assert.doesNotMatch(sql, /\bxp\s+(?:integer|bigint|numeric)|\blevel\s+(?:integer|bigint)|session_history/i);
});

test('cloud profile migration adds owner-bound data fields and preserves RLS isolation', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261004160000_profile_cloud_fields.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /add column if not exists user_id uuid/i);
  assert.match(sql, /foreign key \(user_id\) references auth\.users \(id\) on delete cascade/i);
  assert.match(sql, /check \(id = user_id\)/i);
  assert.match(sql, /add column if not exists xp bigint/i);
  assert.match(sql, /add column if not exists level bigint/i);
  assert.match(sql, /add column if not exists achievements jsonb/i);
  assert.match(sql, /add column if not exists preferences jsonb/i);
  assert.match(sql, /create policy "Users can read their own profile"[\s\S]*?auth\.uid\(\)\) = user_id/i);
  assert.match(sql, /create policy "Users can create their own profile"[\s\S]*?auth\.uid\(\)\) = user_id and id = user_id/i);
  assert.match(sql, /create policy "Users can update their own profile"[\s\S]*?auth\.uid\(\)\) = user_id/i);
  assert.match(sql, /grant update \([\s\S]*?preferences,[\s\S]*?app_data\s*\)/i);
  assert.doesNotMatch(sql, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /\bsb_secret_[A-Za-z0-9_-]{12,}|\bservice[_ -]?role\s*key/i);
});

test('username/PIN service role has only the profile columns needed for account migration', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261004180000_username_pin_profile_access.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /grant select \(id, username, display_name, session_preferences, preferences\)\s+on table public\.profiles to service_role/i);
  assert.match(sql, /grant update \(username, display_name, session_preferences, preferences\)\s+on table public\.profiles to service_role/i);
  assert.doesNotMatch(sql, /grant all|using\s*\(\s*true\s*\)/i);
});

test('social foundation enables RLS and exposes no direct table writes', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261004190000_social_foundation.sql', import.meta.url),
    'utf8',
  );
  for (const table of ['friendships', 'focus_rooms', 'focus_room_members']) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(sql, /friendships_one_row_per_pair unique \(user_low, user_high\)/i);
  assert.match(sql, /friendships_distinct_users check \(requester_id <> recipient_id\)/i);
  assert.match(sql, /room_code ~ '\^\[A-Z0-9\]\{6\}\$'/i);
  assert.match(sql, /primary key \(room_id, user_id\)/i);
  assert.match(sql, /using \(\(select auth\.uid\(\)\) in \(requester_id, recipient_id\)\)/i);
  assert.match(sql, /public\.is_focus_room_member\(room_id\)/i);
  assert.match(sql, /grant select on table public\.friendships, public\.focus_rooms, public\.focus_room_members\s+to authenticated/i);
  assert.match(sql, /alter publication supabase_realtime add table public\./i);
  assert.doesNotMatch(sql, /grant (?:all|insert|update|delete)|to anon|using\s*\(\s*true\s*\)/i);
});

test('friend RPCs bind identity to auth.uid and keep mutations authorization-checked', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261004200000_friend_system.sql', import.meta.url),
    'utf8',
  );
  for (const functionName of [
    'search_focusmate_users',
    'list_focusmate_friends',
    'list_focusmate_friend_requests',
    'send_focusmate_friend_request',
    'respond_focusmate_friend_request',
    'cancel_focusmate_friend_request',
    'remove_focusmate_friend',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\b`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}`, 'i'));
  }
  assert.match(sql, /where lower\(profile\.username\) = normalized_username/i);
  assert.match(sql, /perform pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(sql, /existing_status = 'pending' and existing_requester = current_user_id/i);
  assert.match(sql, /recipient_id = current_user_id\s+and status = 'pending'/i);
  assert.match(sql, /requester_id = current_user_id\s+and status = 'pending'/i);
  assert.match(sql, /status = 'accepted'\s+and current_user_id in \(requester_id, recipient_id\)/i);
  assert.doesNotMatch(sql, /grant execute on function public\.[^(]+\([^;]+to anon/i);
});

test('presence authorization is private, friend-scoped, and owner-published', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261004210000_presence_authorization.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /on realtime\.messages\s+for select\s+to authenticated/i);
  assert.match(sql, /realtime\.messages\.extension = 'presence'/i);
  assert.match(sql, /friendship\.status = 'accepted'/i);
  assert.match(sql, /realtime\.topic\(\) = 'focusmate-presence:' \|\| friendship\.recipient_id::text/i);
  assert.match(sql, /realtime\.topic\(\) = 'focusmate-presence:' \|\| friendship\.requester_id::text/i);
  assert.match(sql, /on realtime\.messages\s+for insert\s+to authenticated/i);
  assert.match(sql, /with check\s*\(\s*realtime\.messages\.extension = 'presence'\s+and realtime\.topic\(\) = 'focusmate-presence:' \|\| \(select auth\.uid\(\)\)::text/i);
  assert.doesNotMatch(sql, /to anon|using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i);
});

test('timer completion guard permits one completion and safely ignores blocked audio', async () => {
  const state = { current: false };
  assert.equal(claimTimerCompletion(state), true);
  assert.equal(claimTimerCompletion(state), false);
  assert.equal(await playSessionCompletionBeep(null), false);

  let started = 0;
  const fakeContext = {
    state: 'running',
    currentTime: 0,
    destination: {},
    createOscillator() {
      return {
        type: '',
        frequency: { value: 0 },
        connect() {},
        start() { started += 1; },
        stop() {},
      };
    },
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
      };
    },
  };
  if (claimTimerCompletion(state)) await playSessionCompletionBeep(fakeContext);
  assert.equal(started, 0);

  const nextSession = { current: false };
  if (claimTimerCompletion(nextSession)) await playSessionCompletionBeep(fakeContext);
  assert.equal(started, 1);
});
