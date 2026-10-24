import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getFocusMateLeaderboard,
  leaderboardErrorTranslationKey,
  setFocusMateLeaderboardVisibility,
} from '../src/leaderboard-api.js';
import {
  supportedLanguages,
  textDirection,
  translate,
  translateLeaderboard,
} from '../src/i18n.js';

const migration = await readFile(
  new URL('../../supabase/migrations/20261004240000_verified_focus_leaderboard.sql', import.meta.url),
  'utf8',
);
const globalXpLeaderboardMigration = await readFile(
  new URL('../../supabase/migrations/20261024162826_global_xp_leaderboard.sql', import.meta.url),
  'utf8',
);

function response(overrides = {}) {
  return {
    scope: 'global',
    entries: [{
      rank: 1,
      username: 'alex',
      display_name: 'Alex',
      global_xp: 3600,
      level: 37,
      user_id: 'private-id',
      email: 'private@example.test',
    }],
    has_more: false,
    total_entries: 1,
    progress: {
      global_xp: 7200,
      level: 73,
      rank: 1,
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

test('leaderboard requests accept only bounded scope and paging selectors, never client scores or identities', async () => {
  const { client, calls } = fakeClient({ data: response(), error: null });
  await getFocusMateLeaderboard(client, {
    scope: 'friends',
    limit: 10,
    offset: 20,
    user_id: 'another-user',
    global_xp: 900000,
  });
  assert.deepEqual(calls, [[
    'get_focusmate_leaderboard',
    { p_scope: 'friends', p_limit: 10, p_offset: 20 },
  ]]);
});

test('leaderboard responses expose only public profile fields and persisted Global XP', async () => {
  const { client } = fakeClient({ data: response(), error: null });
  const result = await getFocusMateLeaderboard(client);
  assert.deepEqual(result.entries, [{
    rank: 1,
    username: 'alex',
    display_name: 'Alex',
    global_xp: 3600,
    level: 37,
  }]);
  assert.deepEqual(result.progress, {
    global_xp: 7200,
    level: 73,
    rank: 1,
    visibility: 'public',
    listed: true,
  });
  assert.equal(Object.hasOwn(result.entries[0], 'user_id'), false);
  assert.equal(Object.hasOwn(result.entries[0], 'email'), false);
  assert.equal(Object.hasOwn(result.progress, 'user_id'), false);
});

test('empty boards and current-user rank beyond the returned page are preserved', async () => {
  const empty = response({
    entries: [],
    total_entries: 0,
    has_more: false,
    progress: {
      global_xp: 0,
      level: 1,
      rank: null,
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
      global_xp: 900,
      level: 10,
      rank: 51,
      visibility: 'public',
      listed: true,
    },
  });
  const { client: pagedClient } = fakeClient({ data: outsideTop, error: null });
  const page = await getFocusMateLeaderboard(pagedClient, { limit: 50 });
  assert.equal(page.entries.length, 0);
  assert.equal(page.has_more, true);
  assert.equal(page.progress.rank, 51);
  assert.deepEqual(calls[0], ['get_focusmate_leaderboard', {
    p_scope: 'global', p_limit: 20, p_offset: 0,
  }]);
});

test('personal progress remains available when privacy excludes the user from ranking entries', async () => {
  const privateProgress = response({
    entries: [],
    total_entries: 0,
    progress: {
      global_xp: 125,
      level: 2,
      rank: 4,
      visibility: 'private',
      listed: false,
    },
  });
  const { client } = fakeClient({ data: privateProgress, error: null });
  const result = await getFocusMateLeaderboard(client);

  assert.deepEqual(result.entries, []);
  assert.equal(result.progress.global_xp, 125);
  assert.equal(result.progress.level, 2);
  assert.equal(result.progress.listed, false);
});

test('null and numeric-string Global XP values are rejected instead of silently becoming zero', async () => {
  for (const invalidResponse of [
    response({ progress: { ...response().progress, global_xp: null } }),
    response({ progress: { ...response().progress, global_xp: '7200' } }),
    response({
      entries: [{ ...response().entries[0], global_xp: '3600' }],
    }),
    response({ entries: [{ ...response().entries[0], level: 0 }] }),
    response({ entries: [{ ...response().entries[0], level: 1 }] }),
  ]) {
    const { client } = fakeClient({ data: invalidResponse, error: null });
    await assert.rejects(getFocusMateLeaderboard(client), /invalid/i);
  }
});

test('invalid filters and malformed server data fail explicitly before displaying rankings', async () => {
  const { client, calls } = fakeClient({ data: response(), error: null });
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

test('missing clients fail gracefully before any RPC call is attempted', async () => {
  await assert.rejects(getFocusMateLeaderboard(null), (error) => {
    assert.equal(leaderboardErrorTranslationKey(error), 'leaderboard.error.signIn');
    assert.match(error.message, /leaderboard/i);
    return true;
  });
  await assert.rejects(setFocusMateLeaderboardVisibility(null, 'friends'), (error) => {
    assert.equal(leaderboardErrorTranslationKey(error), 'leaderboard.error.signIn');
    return true;
  });
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

test('missing leaderboard RPC codes and schema-cache details request a database update', async () => {
  for (const rpcError of [
    { code: 'PGRST202', message: 'Could not find the function in the schema cache' },
    { code: '42883', message: 'function public.get_focusmate_leaderboard does not exist' },
    {
      code: 'PGRST999',
      message: 'RPC error',
      details: 'The function get_focusmate_leaderboard was not found in the schema cache.',
    },
  ]) {
    const { client } = fakeClient({ data: null, error: rpcError });
    await assert.rejects(getFocusMateLeaderboard(client), (error) => {
      assert.equal(error.code, 'MIGRATION_REQUIRED');
      assert.equal(
        leaderboardErrorTranslationKey(error),
        'leaderboard.error.updateRequired',
      );
      return true;
    });
  }
  const { client: visibilityClient } = fakeClient({
    data: null,
    error: { code: '42883', message: 'undefined function' },
  });
  await assert.rejects(
    setFocusMateLeaderboardVisibility(visibilityClient, 'friends'),
    (error) => leaderboardErrorTranslationKey(error) === 'leaderboard.error.updateRequired',
  );
});

test('authentication, permission, network, malformed, and generic RPC failures stay distinguishable', async () => {
  for (const [rpcError, expectedKey] of [
    [{ code: '28000', message: 'auth required' }, 'leaderboard.error.signIn'],
    [{ code: '42501', message: 'permission denied' }, 'leaderboard.error.forbidden'],
    [{ code: 'PGRST000', message: 'Network connection timeout' }, 'leaderboard.error.network'],
    [{ code: 'XX000', message: 'unexpected database error' }, 'leaderboard.error.generic'],
  ]) {
    const { client } = fakeClient({ data: null, error: rpcError });
    await assert.rejects(getFocusMateLeaderboard(client), (error) => {
      assert.equal(leaderboardErrorTranslationKey(error), expectedKey);
      return true;
    });
  }
  const { client } = fakeClient({ data: { entries: 'not-an-array' }, error: null });
  await assert.rejects(getFocusMateLeaderboard(client), (error) => {
    assert.equal(leaderboardErrorTranslationKey(error), 'leaderboard.error.response');
    return true;
  });
});

test('older verified-focus leaderboard responses clearly report a required database update', async () => {
  const oldResponse = {
    scope: 'global',
    entries: [{
      rank: 1,
      username: 'alex',
      display_name: 'Alex',
      focus_seconds: 3600,
    }],
    has_more: false,
    total_entries: 1,
    progress: {
      all_time_seconds: 3600,
      weekly_seconds: 1800,
      rank: 1,
      visibility: 'public',
      listed: true,
    },
  };
  const { client } = fakeClient({ data: oldResponse, error: null });

  await assert.rejects(getFocusMateLeaderboard(client), (error) => {
    assert.equal(error.code, 'MIGRATION_REQUIRED');
    assert.equal(
      leaderboardErrorTranslationKey(error),
      'leaderboard.error.updateRequired',
    );
    return true;
  });
});

test('leaderboard error translation accepts complete keys without duplicating the namespace', () => {
  const key = leaderboardErrorTranslationKey(
    Object.assign(new Error('invalid response'), { code: 'INVALID_RESPONSE' }),
  );
  assert.equal(key, 'leaderboard.error.response');
  assert.equal(
    translateLeaderboard('en', key),
    'The leaderboard returned an invalid response. Refresh and try again.',
  );
  assert.equal(
    translateLeaderboard('en', 'error.response'),
    'The leaderboard returned an invalid response. Refresh and try again.',
  );
  assert.equal(
    translateLeaderboard('en', 'leaderboard.leaderboard.error.response'),
    'The leaderboard returned an invalid response. Refresh and try again.',
  );
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

test('Global XP rankings use the persisted profile XP and level snapshots', () => {
  const leaderboardFunction = globalXpLeaderboardMigration.match(
    /create(?: or replace)? function public\.get_focusmate_leaderboard\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(leaderboardFunction);
  assert.match(leaderboardFunction, /profile\.xp as global_xp/);
  assert.match(leaderboardFunction, /profile\.level/);
  assert.match(leaderboardFunction, /order by visible\.global_xp desc,\s*visible\.user_id/i);
  assert.match(leaderboardFunction, /'global_xp', page\.global_xp[\s\S]*?'level', page\.level/i);
  assert.doesNotMatch(leaderboardFunction, /focus_seconds|focusmate_verified_focus_segments|app_data/);
  assert.doesNotMatch(leaderboardFunction, /email|user_id', page\.user_id/i);
});

test('friends-only visibility cannot leak into global ranking entries', () => {
  const leaderboardFunction = globalXpLeaderboardMigration.match(
    /create(?: or replace)? function public\.get_focusmate_leaderboard\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(leaderboardFunction);
  assert.match(
    leaderboardFunction,
    /visible_scores as \([\s\S]*?where leaderboard_visibility = 'public'\s+or \(p_scope = 'friends' and leaderboard_visibility = 'friends'\)/i,
  );
  assert.match(leaderboardFunction, /friendship\.status = 'accepted'/i);
  assert.match(leaderboardFunction, /'listed', own\.listed/);
  assert.doesNotMatch(leaderboardFunction, /leaderboard_visibility <> 'private'/i);
});

test('client profile snapshots cannot set Global XP; trusted server adjustments update the profile level', () => {
  assert.match(globalXpLeaderboardMigration, /before update of app_data on public\.profiles/i);
  assert.match(globalXpLeaderboardMigration, /focusmate\.trusted_profile_xp/);
  assert.match(globalXpLeaderboardMigration, /to_jsonb\(coalesce\(old\.xp, 0\)\)/i);
  assert.match(globalXpLeaderboardMigration, /set_config\('focusmate\.trusted_profile_xp', 'on', true\)/i);
  assert.match(globalXpLeaderboardMigration, /set_config\('focusmate\.trusted_profile_xp', 'off', true\)/i);
  assert.match(globalXpLeaderboardMigration, /profile\.xp as global_xp[\s\S]*?profile\.level/i);
  assert.match(globalXpLeaderboardMigration, /row_number\(\) over \(\s*order by visible\.global_xp desc, visible\.user_id/i);
  assert.match(globalXpLeaderboardMigration, /revoke all on function public\.get_focusmate_leaderboard\(text, integer, integer\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(globalXpLeaderboardMigration, /grant execute on function public\.get_focusmate_leaderboard\(text, integer, integer\)[\s\S]*?to authenticated/i);
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
      'leaderboard.xp',
      'leaderboard.level',
      'leaderboard.rank',
      'leaderboard.globalXpSource',
      'leaderboard.global',
      'leaderboard.friends',
      'leaderboard.visibility.private',
      'leaderboard.visibility.friends',
      'leaderboard.visibility.public',
      'leaderboard.error.offline',
      'leaderboard.error.generic',
      'leaderboard.error.response',
      'leaderboard.error.updateRequired',
      'nav.leaderboard',
      'heading.leaderboardTitle',
    ]) {
      assert.notEqual(translate(language, key), key, `${language} is missing ${key}`);
    }
  }
  assert.equal(textDirection('ar'), 'rtl');
  assert.match(component, /navigator\.onLine/);
  assert.match(component, /leaderboard\.error\.offline/);
  assert.match(component, /entry\.global_xp/);
  assert.match(component, /entry\.level/);
  assert.match(component, /focusmate:room-progress-updated/);
  assert.match(component, /translateLeaderboard\(language, key\)/);
  assert.doesNotMatch(component, /focus_seconds|all_time_seconds|weekly_seconds/);
});
