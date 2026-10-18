import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { rerollFocusmateDailyQuest } from '../src/room-progress.js';
import { supportedLanguages, translate } from '../src/i18n.js';

const migrationUrl = new URL(
  '../../supabase/migrations/20261018120000_verified_daily_quest_reroll_tokens.sql',
  import.meta.url,
);

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

test('daily rerolls call the server without accepting a client-selected replacement', async () => {
  const response = {
    daily_quests: { date: '2026-10-18', quests: [] },
    reroll_tokens: 2,
    rerolls_remaining_today: 2,
  };
  const { client, calls } = fakeRpcClient([{ data: response, error: null }]);
  const requestId = 'c659c9a1-f2b7-42a6-b62e-28f72638cab9';

  assert.equal(await rerollFocusmateDailyQuest(client, 'focus_15', requestId), response);
  assert.deepEqual(calls, [[
    'reroll_focusmate_daily_quest',
    { p_quest_id: 'focus_15', p_request_id: requestId },
  ]]);
});

test('the database derives daily quest state only from verified room completions', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const progress = migration.match(
    /create or replace function private\.focusmate_daily_quest_progress\([\s\S]*?\n\$\$;/i,
  )?.[0];
  const refresh = migration.match(
    /create or replace function private\.refresh_focusmate_daily_quests\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(progress);
  assert.ok(refresh);
  assert.match(progress, /private\.focusmate_room_session_completions/);
  assert.match(progress, /completion\.focus_seconds/);
  assert.match(progress, /completion\.was_host/);
  assert.match(refresh, /pg_catalog\.gen_random_uuid\(\)/);
  assert.match(refresh, /'verified', true/);
  assert.match(refresh, /'rewardXP', 0/);
  assert.doesNotMatch(refresh, /adjust_focusmate_profile_xp|total_xp/);
  assert.match(migration, /award_type text not null check \(award_type in \('daily_quests', 'streak', 'achievement'\)\)/);
  assert.match(migration, /streak_days >= 7 and streak_days % 7 = 0/);
  assert.match(migration, /private\.award_focusmate_reroll_token\(\s*new\.user_id,\s*'achievement'/);
  assert.match(migration, /primary key \(user_id, award_type, award_key\)/);
});

test('daily reroll RPC randomizes eligible replacements, serializes spending and is idempotent', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const reroll = migration.match(
    /create or replace function public\.reroll_focusmate_daily_quest\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(reroll);
  assert.match(reroll, /private\.refresh_focusmate_daily_quests/);
  assert.match(reroll, /for update/);
  assert.match(reroll, /request\.request_id = p_request_id/);
  assert.ok(
    reroll.indexOf('if found then') < reroll.indexOf('balance = balance - 1'),
    'a repeated request returns before spending another token',
  );
  assert.match(reroll, /candidate\.target > current_progress/);
  assert.match(reroll, /not \(reroll_history \? candidate\.quest_id\)/);
  assert.match(reroll, /order by pg_catalog\.gen_random_uuid\(\)/);
  assert.match(reroll, /rerolls_used_today >= 3/);
  assert.match(reroll, /token_balance < 1/);
  assert.match(reroll, /balance = balance - 1/);
  assert.doesNotMatch(reroll, /p_replacement|adjust_focusmate_profile_xp|balance = balance - 5/);
  assert.match(migration, /revoke all on function public\.reroll_focusmate_profile_quest\(text, text, uuid\)[\s\S]*?from public, anon, authenticated/i);
});

test('daily quest UI confirms token spending and reports verified state and reroll limits', async () => {
  const appSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const localApiSource = await readFile(new URL('../src/local-api.js', import.meta.url), 'utf8');
  const dailyStart = appSource.indexOf('function DailyQuests(');
  const roomStart = appSource.indexOf('function RoomDailyQuests(');
  const dailyComponent = appSource.slice(dailyStart, roomStart);
  assert.ok(dailyStart >= 0 && roomStart > dailyStart);
  assert.match(dailyComponent, /role="dialog"/);
  assert.match(dailyComponent, /setConfirmingQuestId\(quest\.id\)/);
  assert.match(dailyComponent, /onClick=\{\(\) => void reroll\(confirmingQuest\.id\)\}/);
  assert.match(dailyComponent, /rerollsRemaining > 0/);
  assert.match(dailyComponent, /quest\.verified \? translate\(language, 'quests\.tokenMilestone'\)/);
  assert.match(dailyComponent, /quests\.verifiedDailySubtitle/);
  assert.match(dailyComponent, /quests\.dailyTokenEarned/);
  assert.match(dailyComponent, /quest\.completed && !quest\.verified && <small className="quest-reward-note">\+\{quest\.rewardXP\} XP/);
  assert.doesNotMatch(dailyComponent, /onClick=\{\(\) => void reroll\(quest\.id\)\}/);
  assert.doesNotMatch(localApiSource, /\/api\/quests\/reroll/);
  assert.doesNotMatch(appSource, /reroll_focusmate_profile_quest|reroll-preview/);

  for (const language of supportedLanguages) {
    for (const key of [
      'quests.reroll',
      'quests.roomReroll',
      'quests.rerollInsufficientTokens',
      'quests.rerollDailyLimit',
      'quests.rerollConfirmTitle',
      'quests.rerollConfirm',
      'quests.rerollCancel',
      'quests.rerollConfirmButton',
      'quests.tokenBalance',
      'quests.tokensNeedCloudAccount',
      'quests.serverProgressLoading',
      'quests.serverUpdateRequired',
      'quests.verifiedFocusDescription',
      'quests.verifiedSessionsTitle',
      'quests.verifiedSessionsDescription',
      'quests.verifiedXpDescription',
      'quests.verifiedDailySubtitle',
      'quests.tokenMilestone',
      'quests.tokenMilestoneProgress',
      'quests.dailyTokenEarned',
      'quests.dailyTokenEarnedDescription',
    ]) {
      assert.notEqual(translate(language, key), key, `${language}:${key}`);
    }
  }
});
