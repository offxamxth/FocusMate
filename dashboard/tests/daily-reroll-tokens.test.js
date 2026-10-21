import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { rerollFocusmateDailyQuest } from '../src/room-progress.js';
import { supportedLanguages, translate } from '../src/i18n.js';

const migrationUrl = new URL(
  '../../supabase/migrations/20261018120000_verified_daily_quest_reroll_tokens.sql',
  import.meta.url,
);
const rewardMigrationUrl = new URL(
  '../../supabase/migrations/20261020120000_fix_daily_quest_token_threshold.sql',
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
  assert.match(progress, /completed_at >= \(p_quest_date::timestamp at time zone 'UTC'\)/);
  assert.match(migration, /primary key \(user_id, quest_date\)/);
  assert.match(refresh, /on conflict \(user_id, quest_date\) do nothing/);
  assert.match(refresh, /assignment\.quest_date = p_quest_date\s+for update/);
  assert.match(refresh, /pg_catalog\.gen_random_uuid\(\)/);
  assert.match(refresh, /'verified', true/);
  assert.match(refresh, /'rewardXP', 0/);
  assert.doesNotMatch(refresh, /adjust_focusmate_profile_xp|total_xp/);
  assert.match(migration, /award_type text not null check \(award_type in \('daily_quests', 'streak', 'achievement'\)\)/);
  assert.match(migration, /streak_days >= 7 and streak_days % 7 = 0/);
  assert.match(migration, /private\.award_focusmate_reroll_token\(\s*new\.user_id,\s*'achievement'/);
  assert.match(migration, /primary key \(user_id, award_type, award_key\)/);
  const award = migration.match(
    /create or replace function private\.award_focusmate_reroll_token\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(award);
  assert.match(award, /on conflict \(user_id, award_type, award_key\) do nothing/);
  assert.match(award, /if found then[\s\S]*?set balance = balance \+ 1/);
});

test('verified daily quest migration adds the missing progress contract and private token storage', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const progressRpc = migration.match(
    /create or replace function public\.get_focusmate_room_progress\(\)[\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(progressRpc);
  assert.match(progressRpc, /current_user_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(progressRpc, /if current_user_id is null then[\s\S]*?Authentication required/);
  assert.match(progressRpc, /'daily_quests', jsonb_build_object\([\s\S]*?daily_quest_set/);
  assert.match(progressRpc, /'reroll_tokens', token_balance/);
  assert.match(progressRpc, /'rerolls_remaining_today', greatest\(0, 3 - rerolls_used_today\)/);
  assert.match(progressRpc, /private\.refresh_focusmate_daily_quests/);
  assert.match(migration, /create or replace function public\.reroll_focusmate_daily_quest\(\s*p_quest_id text,\s*p_request_id uuid\s*\)/i);
  for (const table of [
    'focusmate_daily_quest_assignments',
    'focusmate_reroll_token_wallets',
    'focusmate_reroll_token_awards',
    'focusmate_daily_reroll_requests',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists private\\.${table}`));
    assert.match(migration, new RegExp(`private\\.${table}[\\s\\S]*?enable row level security`));
  }
  assert.match(migration, /grant execute on function public\.get_focusmate_room_progress\(\)\s+to authenticated/i);
  assert.match(migration, /grant execute on function public\.reroll_focusmate_daily_quest\(text, uuid\)\s+to authenticated/i);
});

test('three verified completed quests award one token per UTC quest date', async () => {
  const migration = await readFile(rewardMigrationUrl, 'utf8');
  const refresh = migration.match(
    /create or replace function private\.refresh_focusmate_daily_quests\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(refresh);
  assert.match(refresh, /completed_eligible_quests integer/);
  assert.match(refresh, /where coalesce\(\(quest\.value ->> 'verified'\)::boolean, false\)[\s\S]*?and coalesce\(\(quest\.value ->> 'completed'\)::boolean, false\)[\s\S]*?and quest\.value ->> 'category' in \([\s\S]*?'focus_time'[\s\S]*?'session_count'[\s\S]*?'session_xp'[\s\S]*?'room_host_sessions'/);
  assert.match(refresh, /if completed_eligible_quests >= 3 then[\s\S]*?award_focusmate_reroll_token\([\s\S]*?'daily_quests',[\s\S]*?p_quest_date::text/);
  assert.doesNotMatch(refresh, /jsonb_array_length\(next_quests\) = 4/);
  assert.doesNotMatch(refresh, /where not coalesce\(\(quest\.value ->> 'completed'\)::boolean, false\)/);
  assert.match(refresh, /where coalesce\(\(quest\.value ->> 'verified'\)::boolean, false\)[\s\S]*?and coalesce\(\(quest\.value ->> 'completed'\)::boolean, false\)/);
  assert.match(migration, /revoke all on function private\.refresh_focusmate_daily_quests\(uuid, date\)[\s\S]*?from public, anon, authenticated, service_role/i);
});

test('verified daily quest unavailability is described without assuming the environment', () => {
  const message = translate('en', 'quests.serverUpdateRequired');
  assert.equal(
    message,
    'Verified daily quests are temporarily unavailable because the required database support is unavailable.',
  );
  for (const language of supportedLanguages) {
    const localizedMessage = translate(language, 'quests.serverUpdateRequired');
    assert.notEqual(localizedMessage, 'quests.serverUpdateRequired', `${language} translation`);
    assert.doesNotMatch(
      localizedMessage,
      /non-production environment|entorno no productivo|hors production|غير الإنتاجية|गैर-उत्पादन/i,
      `${language} message must not assume the deployment environment`,
    );
  }
});

test('daily reroll RPC randomizes eligible replacements, serializes spending and is idempotent', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const reroll = migration.match(
    /create or replace function public\.reroll_focusmate_daily_quest\([\s\S]*?\n\$\$;/i,
  )?.[0];
  assert.ok(reroll);
  assert.match(reroll, /current_user_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(reroll, /assignment\.user_id = current_user_id[\s\S]*?for update/);
  assert.match(reroll, /wallet\.user_id = current_user_id[\s\S]*?for update/);
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
  assert.match(reroll, /current_quest ->> 'category'[\s\S]*?candidate\.category = quest_category/);
  assert.match(reroll, /or coalesce\(\(current_quest ->> 'completed'\)::boolean, false\)/);
  assert.ok(
    reroll.indexOf('if replacement is null then') < reroll.indexOf('balance = balance - 1'),
    'an unavailable replacement fails before token spending',
  );
  assert.ok(
    reroll.indexOf('if token_balance < 1 then') < reroll.indexOf('balance = balance - 1'),
    'an insufficient token balance fails before token spending',
  );
  assert.ok(
    reroll.indexOf('update private.focusmate_daily_quest_assignments')
      < reroll.indexOf('insert into private.focusmate_daily_reroll_requests'),
    'the replacement and idempotency response are committed by the same RPC transaction',
  );
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
  assert.match(dailyComponent, /countCompletedVerifiedDailyQuests\(daily\.quests\) >= 3/);
  assert.match(dailyComponent, /: completed === 4/);
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
