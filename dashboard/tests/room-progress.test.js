import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  claimFocusmateRoomQuest,
  getFocusmateRoomProgress,
  rerollFocusmateDailyQuest,
  rerollFocusmateRoomQuest,
  roomProgressErrorTranslationKey,
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

test('cloud room XP and daily-token rerolls use authenticated RPCs with idempotency keys', async () => {
  const response = {
    xp_balance: 15,
    total_xp: 80,
    daily_quests: {
      date: '2026-10-21',
      quests: Array.from({ length: 4 }, (_, index) => ({
        id: `quest_${index}`,
        verified: true,
      })),
    },
    reroll_tokens: 1,
    rerolls_remaining_today: 3,
  };
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
  assert.equal(await rerollFocusmateDailyQuest(client, 'focus_15', requestId), response);
  assert.deepEqual(calls, [
    ['get_focusmate_room_progress', {}],
    ['reroll_focusmate_room_quest', { p_quest_id: 'room_sessions_1', p_request_id: requestId }],
    ['claim_focusmate_room_quest', { p_quest_id: 'room_sessions_1', p_request_id: requestId }],
    ['reroll_focusmate_daily_quest', {
      p_quest_id: 'focus_15',
      p_request_id: requestId,
    }],
  ]);
  assert.equal(response.daily_quests.quests.length, 4);
});

test('daily-token reroll errors are safe and distinguish token balance, cap, and migration failures', async () => {
  const { client } = fakeRpcClient([
    { data: null, error: { code: 'P0001', details: 'DAILY_REROLL_INSUFFICIENT_TOKENS', message: 'database detail' } },
    { data: null, error: { code: 'P0001', details: 'DAILY_REROLL_DAILY_LIMIT', message: 'database detail' } },
    { data: null, error: { code: 'PGRST202', message: 'Could not find the function in schema cache' } },
  ]);
  await assert.rejects(rerollFocusmateDailyQuest(client, 'focus_15', crypto.randomUUID()), (error) => {
    assert.equal(error.code, 'QUEST_REROLL_INSUFFICIENT_TOKENS');
    assert.match(error.message, /one reroll token/);
    assert.doesNotMatch(error.message, /database detail/);
    return true;
  });
  await assert.rejects(rerollFocusmateDailyQuest(client, 'focus_15', crypto.randomUUID()), (error) => {
    assert.equal(error.code, 'QUEST_REROLL_DAILY_LIMIT');
    assert.match(error.message, /limit/);
    return true;
  });
  await assert.rejects(rerollFocusmateDailyQuest(client, 'focus_15', crypto.randomUUID()), (error) => {
    assert.equal(error.code, 'QUEST_REROLL_UNAVAILABLE');
    assert.match(error.message, /database update/);
    return true;
  });
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

test('daily quest progress distinguishes a missing RPC from unrelated request failures', () => {
  assert.equal(
    roomProgressErrorTranslationKey({
      code: 'PGRST202',
      message: 'Could not find the function in the schema cache',
    }),
    'quests.serverUpdateRequired',
  );
  assert.equal(
    roomProgressErrorTranslationKey({
      code: '42501',
      message: 'private database detail',
    }),
    'quests.serverProgressError',
  );
  assert.equal(
    roomProgressErrorTranslationKey(new TypeError('Failed to fetch')),
    'quests.serverProgressError',
  );
});

test('trusted room progress loads for cloud accounts outside the Focus Room page', async () => {
  const [roomSource, appSource] = await Promise.all([
    readFile(new URL('../src/RoomFoundation.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(appSource, /if \(!account \|\| !profile\) return undefined;[\s\S]*?getFocusmateRoomProgress\(supabase\)[\s\S]*?setRoomProgress\(progress\)/);
  assert.match(appSource, /presentProfile = \(value, trustedProgress = roomProgressRef\.current\)/);
  assert.match(appSource, /roomProgressRef\.current = next/);
  assert.match(appSource, /daily_quests: trustedProgress\?\.daily_quests \|\| null/);
  assert.match(appSource, /setRoomProgressError\(roomProgressErrorTranslationKey\(progressError\)\)/);
  assert.match(appSource, /dailyProgressError=\{roomProgressError\}/);
  assert.match(roomSource, /if \(!account \|\| room\?\.status !== 'finished'\) return undefined;[\s\S]*?getFocusmateRoomProgress\(supabase\)/);
  assert.doesNotMatch(roomSource, /if \(!account \|\| !pageActive\)/);
  assert.match(appSource, /available_xp: trustedProgress\?\.xp_balance/);
});

test('a successful legacy progress response without verified daily quests selects the explicit fallback', async () => {
  const appSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const dailyStart = appSource.indexOf('function DailyQuests(');
  const roomStart = appSource.indexOf('function RoomDailyQuests(');
  const dailyComponent = appSource.slice(dailyStart, roomStart);
  assert.ok(dailyStart >= 0 && roomStart > dailyStart);
  assert.match(appSource, /daily_quests: trustedProgress\?\.daily_quests \|\| null/);
  assert.match(dailyComponent, /if \(!daily \|\| !Array\.isArray\(daily\.quests\) \|\| daily\.quests\.length !== 4\)/);
  assert.match(dailyComponent, /cloudAccount[\s\S]*?dailyProgressError \|\| \(dailyProgressLoading \? 'quests\.serverProgressLoading' : 'quests\.serverUpdateRequired'\)/);
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

test('finished verified rooms award Global XP once through the profile progression record', async () => {
  const [progressMigration, profileMigration, leaderboardMigration] = await Promise.all([
    readFile(new URL('../../supabase/migrations/20261011120000_trusted_room_progress.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/migrations/20261004160000_profile_cloud_fields.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/migrations/20261017120000_global_xp_leaderboard.sql', import.meta.url), 'utf8'),
  ]);
  const completion = progressMigration.match(
    /create or replace function private\.record_focusmate_room_completion\(\)[\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(completion);
  assert.match(completion, /if new\.state <> 'finished' or old\.state = 'finished' then/i);
  assert.match(completion, /on conflict \(room_id, user_id\) do nothing[\s\S]*?if found then/i);
  assert.match(completion, /perform private\.adjust_focusmate_profile_xp\(participant\.user_id, 20\)/i);
  assert.match(profileMigration, /new\.level := new\.xp \/ 100 \+ 1/i);
  assert.match(leaderboardMigration, /order by visible\.global_xp desc, visible\.user_id/i);
});

test('room quest rerolls retain the 5-XP threshold and charge exactly once after validation', async () => {
  const migration = await readFile(
    new URL('../../supabase/migrations/20261011170000_room_quest_reroll_guard.sql', import.meta.url),
    'utf8',
  );
  const originalMigration = await readFile(
    new URL('../../supabase/migrations/20261011120000_trusted_room_progress.sql', import.meta.url),
    'utf8',
  );
  const reroll = migration.match(
    /create or replace function public\.reroll_focusmate_room_quest\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(reroll, 'the ordered guard migration replaces the room reroll RPC');
  assert.match(reroll, /wallet\.user_id = current_user_id\s+for update/i);
  assert.match(reroll, /if wallet_balance < 5 then/i);
  assert.match(reroll, /prior_request_type = 'reroll'/);
  assert.equal(5 < 5, false, 'exactly 5 XP is accepted by the strict less-than guard');
  assert.equal(6 < 5, false, 'balances above 5 XP pass the threshold');
  assert.equal(4 < 5, true, 'balances below 5 XP are rejected');
  assert.match(
    reroll,
    /where current_value < \(candidate\.value ->> 'target'\)::numeric\s+and candidate\.value ->> 'id' <> p_quest_id/i,
  );
  assert.match(reroll, /if replacement is null then[\s\S]*?raise exception 'No eligible room quest replacement/i);
  assert.ok(
    reroll.indexOf('if replacement is null then') < reroll.indexOf('set balance = balance - 5'),
    'invalid rerolls fail before charging XP',
  );
  assert.equal((reroll.match(/set balance = balance - 5/g) || []).length, 1);
  assert.doesNotMatch(reroll, /adjust_focusmate_profile_xp/);
  assert.match(reroll, /'total_xp', \(select profile\.xp/);
  assert.ok(
    reroll.indexOf("if prior_request_type = 'reroll' then") < reroll.indexOf('set balance = balance - 5'),
    'a repeated room-reroll request returns its stored response before charging again',
  );
  assert.ok(
    reroll.indexOf('for update') < reroll.indexOf('request.request_id = p_request_id'),
    'the wallet lock serializes concurrent requests before idempotency is checked',
  );
  assert.ok(
    reroll.indexOf('Request ID was already used for another XP operation')
      < reroll.indexOf('set balance = balance - 5'),
    'an ID used by another operation is rejected before charging',
  );
  assert.match(reroll, /values \(current_user_id, p_request_id, 'reroll', result\)/);
  assert.match(
    originalMigration,
    /grant execute on function public\.reroll_focusmate_room_quest\(text, uuid\)\s+to authenticated/i,
  );
  assert.match(
    originalMigration,
    /request_type text not null check \(request_type in \('reroll', 'profile_reroll', 'claim'\)\)/i,
  );
});

test('forward-only reroll repair restores both canonical RPCs and their separate request types', async () => {
  const [canonicalMigration, repairMigration] = await Promise.all([
    readFile(
      new URL('../../supabase/migrations/20261011170000_room_quest_reroll_guard.sql', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../supabase/migrations/20261016200000_fix_room_quest_reroll_request_type.sql', import.meta.url),
      'utf8',
    ),
  ]);
  const extractRoomReroll = (migration) => migration.match(
    /create or replace function public\.reroll_focusmate_room_quest\([\s\S]*?\n\$\$;/i,
  )?.[0];
  const extractProfileReroll = (migration) => migration.match(
    /create or replace function public\.reroll_focusmate_profile_quest\([\s\S]*?\n\$\$;/i,
  )?.[0];
  const canonicalRoomReroll = extractRoomReroll(canonicalMigration);
  const repairedRoomReroll = extractRoomReroll(repairMigration);
  const canonicalProfileReroll = extractProfileReroll(canonicalMigration);
  const repairedProfileReroll = extractProfileReroll(repairMigration);

  assert.ok(canonicalRoomReroll);
  assert.ok(repairedRoomReroll);
  assert.ok(canonicalProfileReroll);
  assert.ok(repairedProfileReroll);
  assert.equal(repairedRoomReroll, canonicalRoomReroll);
  assert.equal(repairedProfileReroll, canonicalProfileReroll);
  assert.equal((repairMigration.match(/create or replace function/gi) || []).length, 2);
  assert.match(repairedRoomReroll, /prior_request_type = 'reroll'/);
  assert.match(repairedRoomReroll, /values \(current_user_id, p_request_id, 'reroll', result\)/);
  assert.doesNotMatch(repairedRoomReroll, /adjust_focusmate_profile_xp/);
  assert.match(repairedProfileReroll, /prior_request_type = 'profile_reroll'/);
  assert.match(repairedProfileReroll, /values \(current_user_id, p_request_id, 'profile_reroll', result\)/);
  assert.doesNotMatch(repairedProfileReroll, /adjust_focusmate_profile_xp/);
  assert.match(
    repairMigration,
    /revoke all on function public\.reroll_focusmate_room_quest\(text, uuid\)[\s\S]*?from public, anon, authenticated/i,
  );
  assert.match(
    repairMigration,
    /grant execute on function public\.reroll_focusmate_room_quest\(text, uuid\) to authenticated/i,
  );
  assert.match(
    repairMigration,
    /revoke all on function public\.reroll_focusmate_profile_quest\(text, text, uuid\)[\s\S]*?from public, anon, authenticated/i,
  );
  assert.match(
    repairMigration,
    /grant execute on function public\.reroll_focusmate_profile_quest\(text, text, uuid\) to authenticated/i,
  );
  assert.doesNotMatch(repairMigration, /\b(?:drop|delete|truncate)\b/i);
});

test('profile quest rerolls keep their independent request type and profile quest storage', async () => {
  const roomGuard = await readFile(
    new URL('../../supabase/migrations/20261011170000_room_quest_reroll_guard.sql', import.meta.url),
    'utf8',
  );
  const profileReroll = roomGuard.match(
    /create or replace function public\.reroll_focusmate_profile_quest\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(profileReroll);
  assert.match(profileReroll, /prior_request_type = 'profile_reroll'/);
  assert.match(profileReroll, /select request\.response, request\.request_type[\s\S]*?request\.request_id = p_request_id/);
  assert.match(profileReroll, /values \(current_user_id, p_request_id, 'profile_reroll', result\)/);
  assert.match(profileReroll, /'{daily_quests}'/);
  assert.doesNotMatch(profileReroll, /private\.focusmate_room_daily_quests/);
  assert.doesNotMatch(profileReroll, /adjust_focusmate_profile_xp/);
  assert.match(profileReroll, /set balance = balance - 5/);
  assert.match(profileReroll, /'total_xp', \(select profile\.xp/);
  assert.ok(
    profileReroll.indexOf("if prior_request_type = 'profile_reroll' then")
      < profileReroll.indexOf('set balance = balance - 5'),
    'a repeated profile-reroll request returns before charging again',
  );
  assert.ok(
    profileReroll.indexOf('Request ID was already used for another XP operation')
      < profileReroll.indexOf('set balance = balance - 5'),
    'profile rerolls reject IDs belonging to a different operation before charging',
  );
  assert.match(roomGuard, /values \(current_user_id, p_request_id, 'reroll', result\)/);
  assert.match(roomGuard, /values \(current_user_id, p_request_id, 'profile_reroll', result\)/);
  const roomReroll = roomGuard.match(
    /create or replace function public\.reroll_focusmate_room_quest\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(roomReroll);
  assert.match(roomReroll, /prior_request_type = 'reroll'/);
  assert.match(roomReroll, /select request\.response, request\.request_type[\s\S]*?request\.request_id = p_request_id/);
  assert.match(roomReroll, /values \(current_user_id, p_request_id, 'reroll', result\)/);
});

test('room quest UI exposes a known balance, blocks unaffordable rerolls, and locks duplicate clicks', async () => {
  const appSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const dailyQuestsStart = appSource.indexOf('function DailyQuests(');
  const roomDailyQuestsStart = appSource.indexOf('function RoomDailyQuests(');
  const focusRoomPage = appSource.match(
    /<div hidden=\{page !== 'focus-room'\}[\s\S]*?<FocusRoom/,
  )?.[0];
  assert.ok(dailyQuestsStart >= 0 && roomDailyQuestsStart > dailyQuestsStart);
  const dailyQuestsComponent = appSource.slice(dailyQuestsStart, roomDailyQuestsStart);
  assert.doesNotMatch(dailyQuestsComponent, /RoomDailyQuests/);
  assert.match(focusRoomPage || '', /<RoomDailyQuests/);
  assert.match(appSource, /verifiedXpBalance', \{ xp: roomXp \?\? '—' \}/);
  assert.match(appSource, /roomXp !== null && roomXp < 5/);
  assert.match(appSource, /busyRef\.current\) return/);
  assert.match(appSource, /busyAction === 'reroll' \? t\('rerolling'\)/);
  assert.match(appSource, /actionError\.code === 'QUEST_REROLL_INSUFFICIENT_XP'/);
  assert.match(appSource, /available_xp: trustedProgress\?\.xp_balance === null[\s\S]*?: null/);
  for (const language of supportedLanguages) {
    assert.notEqual(translate(language, 'quests.rerolling'), 'quests.rerolling');
  }
});
