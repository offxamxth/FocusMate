import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  authErrorMessage,
  localIdentityForAuthUser,
  supabase,
  supabaseConfigured,
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

test('authentication errors are mapped without exposing credentials', () => {
  assert.match(authErrorMessage(new Error('Invalid login credentials')), /Incorrect email or password/);
  assert.match(authErrorMessage(new Error('Email not confirmed')), /confirm your email/);
  assert.match(authErrorMessage(new Error('Failed to fetch')), /Network error/);
  assert.match(authErrorMessage(new Error('User password is too short')), /stronger password/);
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
      assert.equal(column, 'id');
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
  });
  assert.doesNotMatch(selectedColumns, /xp|password/i);
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
