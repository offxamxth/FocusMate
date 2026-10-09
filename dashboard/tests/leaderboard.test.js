import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getFocusMateLeaderboard,
  leaderboardErrorTranslationKey,
  setFocusMateLeaderboardVisibility,
} from '../src/leaderboard-api.js';
import { supportedLanguages, textDirection, translate } from '../src/i18n.js';

const migration = await readFile(
  new URL('../../supabase/migrations/20261004240000_verified_focus_leaderboard.sql', import.meta.url),
  'utf8',
);

function response(overrides = {}) {
  return {
    period: 'weekly',
    scope: 'global',
    week_start: '2026-10-05T00:00:00Z',
    entries: [{
      rank: 1,
      username: 'alex',
      display_name: 'Alex',
      focus_seconds: 3600,
      user_id: 'private-id',
      email: 'private@example.test',
    }],
    has_more: false,
    total_entries: 1,
    progress: {
      all_time_seconds: 7200,
      weekly_seconds: 3600,
      rank: 1,
      weekly_rank: 1,
      visibility: 'public',
      listed: true,
      user_id: 'private-id',
    },
    ...overrides,
  };
}

function fakeClient(result) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(...args) {
        calls.push(args);
        return result;
      },
    },
  };
}

test('leaderboard requests accept only bounded ranking selectors, never client scores or identities', async () => {
  const { client, calls } = fakeClient({ data: response(), error: null });
  await getFocusMateLeaderboard(client, {
    period: 'all_time',
    scope: 'friends',
    limit: 10,
    offset: 20,
    user_id: 'another-user',
    focus_seconds: 900000,
  });
  assert.deepEqual(calls, [[
    'get_focusmate_leaderboard',
    { p_period: 'all_time', p_scope: 'friends', p_limit: 10, p_offset: 20 },
  ]]);
});

test('leaderboard responses expose only public ranking fields and verified progress', async () => {
  const { client } = fakeClient({ data: response(), error: null });
  const result = await getFocusMateLeaderboard(client);
  assert.deepEqual(result.entries, [{
    rank: 1,
    username: 'alex',
    display_name: 'Alex',
    focus_seconds: 3600,
  }]);
  assert.deepEqual(result.progress, {
    all_time_seconds: 7200,
    weekly_seconds: 3600,
    rank: 1,
    weekly_rank: 1,
    visibility: 'public',
    listed: true,
  });
  assert.equal(Object.hasOwn(result.entries[0], 'user_id'), false);
  assert.equal(Object.hasOwn(result.entries[0], 'email'), false);
  assert.equal(Object.hasOwn(result.progress, 'user_id'), false);
});

test('empty boards and rank positions outside the returned page are preserved', async () => {
  const empty = response({
    entries: [],
    total_entries: 0,
    has_more: false,
    progress: {
      all_time_seconds: 0,
      weekly_seconds: 0,
      rank: null,
      weekly_rank: null,
      visibility: 'private',
      listed: false,
    },
  });
  const { client, calls } = fakeClient({ data: empty, error: null });
  assert.deepEqual((await getFocusMateLeaderboard(client)).entries, []);

  const outsideTop = response({
    entries: [],
    total_entries: 51,
    has_more: true,
    progress: {
      all_time_seconds: 900,
      weekly_seconds: 600,
      rank: 51,
      weekly_rank: 51,
      visibility: 'public',
      listed: true,
    },
  });
  const { client: pagedClient } = fakeClient({ data: outsideTop, error: null });
  const page = await getFocusMateLeaderboard(pagedClient, { limit: 50 });
  assert.equal(page.entries.length, 0);
  assert.equal(page.has_more, true);
  assert.equal(page.progress.weekly_rank, 51);
  assert.deepEqual(calls[0], ['get_focusmate_leaderboard', {
    p_period: 'weekly', p_scope: 'global', p_limit: 20, p_offset: 0,
  }]);
});

test('invalid filters and malformed server data fail explicitly before displaying rankings', async () => {
  const { client, calls } = fakeClient({ data: response(), error: null });
  await assert.rejects(getFocusMateLeaderboard(client, { period: 'daily' }), /invalid/i);
  await assert.rejects(getFocusMateLeaderboard(client, { scope: 'arbitrary-users' }), /invalid/i);
  await assert.rejects(getFocusMateLeaderboard(client, { limit: 1000 }), /invalid/i);
  assert.equal(calls.length, 0);

  const malformed = fakeClient({ data: response({ entries: [{ username: 'hidden' }] }), error: null });
  await assert.rejects(getFocusMateLeaderboard(malformed.client), /invalid/i);
});

test('leaderboard privacy changes are caller-scoped and reject arbitrary visibility values', async () => {
  const { client, calls } = fakeClient({ data: 'friends', error: null });
  assert.equal(await setFocusMateLeaderboardVisibility(client, 'friends'), 'friends');
  assert.deepEqual(calls, [[
    'set_focusmate_leaderboard_visibility',
    { p_visibility: 'friends' },
  ]]);
  await assert.rejects(setFocusMateLeaderboardVisibility(client, 'anyone'), /invalid/i);
  assert.equal(calls.length, 1);
});

test('database errors are translated into safe, useful retry states', async () => {
  const { client } = fakeClient({ data: null, error: { code: '28000', message: 'private database detail' } });
  await assert.rejects(getFocusMateLeaderboard(client), (error) => {
    assert.equal(leaderboardErrorTranslationKey(error), 'leaderboard.error.signIn');
    assert.doesNotMatch(error.message, /private database detail/);
    return true;
  });
  assert.equal(leaderboardErrorTranslationKey(new TypeError('Failed to fetch')), 'leaderboard.error.network');
  assert.equal(leaderboardErrorTranslationKey(new Error('unknown')), 'leaderboard.error.generic');
});

test('private ledger writes are trigger-only and leaderboard RPCs require authenticated callers', () => {
  assert.match(migration, /create table if not exists private\.focusmate_verified_focus_segments/i);
  assert.match(migration, /alter table private\.focusmate_verified_focus_segments enable row level security/i);
  assert.match(migration, /revoke all on table private\.focusmate_verified_focus_segments[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(migration, /after update of state, active_segment_started_at on public\.focus_rooms/i);
  assert.match(migration, /after update of left_at on public\.focus_room_members/i);
  for (const rpc of [
    'set_focusmate_leaderboard_visibility(text)',
    'get_focusmate_leaderboard(text, text, integer, integer)',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${rpc.replace(/[()]/g, '\\$&')}[\\s\\S]*?from public, anon, authenticated`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${rpc.replace(/[()]/g, '\\$&')}[\\s\\S]*?to authenticated`, 'i'));
  }
  assert.match(migration, /current_user_id uuid := \(select auth\.uid\(\)\)/i);
  assert.match(migration, /profile\.id = current_user_id/i);
  assert.doesNotMatch(migration, /p_(?:user_id|score|seconds|xp|rank)\b/i);
});

test('only finished, server-timed focus intervals count; pauses, breaks, and abandoned rooms do not', () => {
  assert.match(migration, /new\.state = 'focusing'[\s\S]*?new\.active_segment_started_at/i);
  assert.match(migration, /new\.break_started_at[\s\S]*?new\.finished_at[\s\S]*?new\.updated_at/i);
  assert.match(migration, /floor\(extract\(epoch from[\s\S]*?segment\.started_at/i);
  assert.match(migration, /room\.state = 'finished'/i);
  assert.match(migration, /where room\.state = 'focusing'[\s\S]*?on conflict \(room_id, user_id, started_at\) do nothing/i);
  assert.match(migration, /primary key \(room_id, user_id, started_at\)/i);
});

test('UTC interval overlap, accepted-friend scope, opt-in privacy, deterministic ranks, and bounded paging are enforced', () => {
  assert.match(migration, /date_trunc\('week', now\(\) at time zone 'UTC'\) at time zone 'UTC'/i);
  assert.match(migration, /segment\.started_at < utc_week_end and segment\.ended_at > utc_week_start/i);
  assert.match(migration, /least\(segment\.ended_at, utc_week_end\)[\s\S]*?greatest\(segment\.started_at, utc_week_start\)/i);
  assert.match(migration, /friendship\.status = 'accepted'/i);
  assert.match(migration, /leaderboard_visibility text not null default 'private'/i);
  assert.match(migration, /leaderboard_visibility in \('private', 'friends', 'public'\)/i);
  assert.match(migration, /leaderboard_visibility = 'public'/i);
  assert.match(migration, /leaderboard_visibility in \('friends', 'public'\)/i);
  assert.match(migration, /row_number\(\) over \([\s\S]*?end desc,\s*lower\(visible\.username\),\s*visible\.user_id/i);
  assert.match(migration, /p_limit is null or p_limit not between 1 and 50[\s\S]*?p_offset is null or p_offset not between 0 and 10000/i);
  assert.match(migration, /page\.rank > p_offset[\s\S]*?page\.rank <= p_offset \+ p_limit/i);
  assert.match(migration, /competitor\.user_id <> current_user_id[\s\S]*?competitor\.weekly_seconds > own\.weekly_seconds/i);
  assert.match(migration, /'entries', coalesce\([\s\S]*?'\[\]'::jsonb/i);
});

test('leaderboard UI strings are translated in every language and Arabic direction remains unchanged', async () => {
  const component = await readFile(new URL('../src/LeaderboardPage.jsx', import.meta.url), 'utf8');
  const keys = [...new Set([...component.matchAll(/t\('([^']+)'\)/g)].map((match) => `leaderboard.${match[1]}`))];
  for (const language of supportedLanguages) {
    for (const key of [
      ...keys,
      'leaderboard.weekly',
      'leaderboard.all_time',
      'leaderboard.global',
      'leaderboard.friends',
      'leaderboard.visibility.private',
      'leaderboard.visibility.friends',
      'leaderboard.visibility.public',
      'leaderboard.error.offline',
      'leaderboard.error.generic',
      'nav.leaderboard',
      'heading.leaderboardTitle',
    ]) {
      assert.notEqual(translate(language, key), key, `${language} is missing ${key}`);
    }
  }
  assert.equal(textDirection('ar'), 'rtl');
  assert.match(component, /navigator\.onLine/);
  assert.match(component, /leaderboard\.error\.offline/);
});
