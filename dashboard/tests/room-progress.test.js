import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  claimFocusmateRoomQuest,
  getFocusmateRoomProgress,
  rerollFocusmateProfileQuest,
  rerollFocusmateRoomQuest,
} from '../src/room-progress.js';
import { achievementCatalog } from '../src/achievement-data.js';
import { supportedLanguages, translate, translateAchievement } from '../src/i18n.js';

function fakeRpcClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(...args) {
        calls.push(args);
        return responses.shift() || { data: null, error: null };
      },
    },
  };
}

test('cloud room XP, daily quest and profile rerolls use authenticated RPCs with idempotency keys', async () => {
  const response = { xp_balance: 15, total_xp: 80 };
  const { client, calls } = fakeRpcClient([
    { data: response, error: null },
    { data: response, error: null },
    { data: response, error: null },
    { data: response, error: null },
  ]);
  const requestId = 'd2cebcdd-e76e-4e88-a06d-5f3b250888ea';

  assert.equal(await getFocusmateRoomProgress(client), response);
  assert.equal(await rerollFocusmateRoomQuest(client, 'room_sessions_1', requestId), response);
  assert.equal(await claimFocusmateRoomQuest(client, 'room_sessions_1', requestId), response);
  assert.equal(await rerollFocusmateProfileQuest(client, 'focus_15', 'focus_25', requestId), response);
  assert.deepEqual(calls, [
    ['get_focusmate_room_progress', {}],
    ['reroll_focusmate_room_quest', { p_quest_id: 'room_sessions_1', p_request_id: requestId }],
    ['claim_focusmate_room_quest', { p_quest_id: 'room_sessions_1', p_request_id: requestId }],
    ['reroll_focusmate_profile_quest', {
      p_quest_id: 'focus_15',
      p_replacement_id: 'focus_25',
      p_request_id: requestId,
    }],
  ]);
});

test('room progress errors are explicit and do not expose backend details', async () => {
  const { client } = fakeRpcClient([
    { data: null, error: { code: 'P0001', message: 'internal database detail' } },
    { data: null, error: { code: 'PGRST202', message: 'Could not find the function in schema cache' } },
  ]);
  await assert.rejects(rerollFocusmateRoomQuest(client, 'room_sessions_1', crypto.randomUUID()), (error) => {
    assert.equal(error.code, 'QUEST_REROLL_INSUFFICIENT_XP');
    assert.match(error.message, /5 verified room XP/);
    assert.doesNotMatch(error.message, /internal database detail/);
    return true;
  });
  await assert.rejects(getFocusmateRoomProgress(client), /database update is applied/);
});

test('trusted room progress loads for cloud accounts outside the Focus Room page', async () => {
  const [roomSource, appSource] = await Promise.all([
    readFile(new URL('../src/RoomFoundation.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(appSource, /if \(!account \|\| !profile\) return undefined;[\s\S]*?getFocusmateRoomProgress\(supabase\)[\s\S]*?setRoomProgress\(progress\)/);
  assert.match(appSource, /presentProfile = \(value, trustedProgress = roomProgressRef\.current\)/);
  assert.match(appSource, /roomProgressRef\.current = next/);
  assert.match(roomSource, /if \(!account \|\| room\?\.status !== 'finished'\) return undefined;[\s\S]*?getFocusmateRoomProgress\(supabase\)/);
  assert.doesNotMatch(roomSource, /if \(!account \|\| !pageActive\)/);
});

test('all 20 room and accepted-friend achievements have progress and localization', () => {
  const roomAchievements = achievementCatalog.filter(([id]) => id.startsWith('room_') || id.startsWith('friend_'));
  assert.equal(roomAchievements.filter(([id]) => id.startsWith('room_')).length, 15);
  assert.equal(roomAchievements.filter(([id]) => id.startsWith('friend_')).length, 5);
  for (const [id, title, description] of roomAchievements) {
    assert.ok(id);
    assert.ok(description);
    for (const language of supportedLanguages) {
      assert.ok(translateAchievement(language, id, 'title', title), `${language}: ${id} title`);
      assert.ok(translateAchievement(language, id, 'description', description), `${language}: ${id} description`);
      assert.notEqual(
        translate(language, `achievements.group.${id.startsWith('friend_') ? 'Friends' : 'Multiplayer'}`),
        `achievements.group.${id.startsWith('friend_') ? 'Friends' : 'Multiplayer'}`,
      );
    }
  }
});

test('trusted room progress migration uses server-timed completions, unique awards, and atomic wallet RPCs', async () => {
  const migration = await readFile(
    new URL('../../supabase/migrations/20261011120000_trusted_room_progress.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /primary key \(user_id, achievement_id\)/i);
  assert.match(migration, /primary key \(room_id, user_id\)/i);
  assert.match(migration, /primary key \(user_id, request_id\)/i);
  assert.match(migration, /after update of state on public\.focus_rooms[\s\S]*?new\.state = 'finished'/i);
  assert.match(migration, /private\.focusmate_verified_focus_segments/i);
  assert.match(migration, /friendship\.status = 'accepted'/i);
  assert.match(migration, /balance = balance - 5/i);
  assert.match(migration, /update public\.profiles[\s\S]*?set app_data = jsonb_set/i);
  assert.match(migration, /profile_data -> 'achievements'/i);
  assert.doesNotMatch(migration, /set\s+xp\s*:=\s*old\.xp|set\s+achievements\s*:=\s*old\.achievements/i);
  assert.match(migration, /reroll_focusmate_profile_quest/i);
  assert.match(migration, /grant execute on function public\.reroll_focusmate_profile_quest[\s\S]*?to authenticated/i);
});

test('room quest rerolls cannot select the current quest as its own replacement', async () => {
  const migration = await readFile(
    new URL('../../supabase/migrations/20261012120000_room_quest_reroll_guard.sql', import.meta.url),
    'utf8',
  );
  assert.match(
    migration,
    /where current_value < \(candidate\.value ->> 'target'\)::numeric\s+and candidate\.value ->> 'id' <> p_quest_id/i,
  );
  assert.match(migration, /if replacement is null then[\s\S]*?raise exception 'No eligible room quest replacement/i);
  assert.ok(
    migration.indexOf('if replacement is null then') < migration.indexOf('set balance = balance - 5'),
    'an unavailable replacement must be rejected before charging XP',
  );
});
