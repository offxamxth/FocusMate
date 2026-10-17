import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claimWaterReminderResponse,
  focusBuddyCharacters,
  focusMoods,
  normalizeFocusBuddyPreferences,
  readWaterReminderSchedule,
  scheduleNextWaterReminder,
  waterReminderDelayMs,
  waterReminderStorageKey,
} from '../src/focus-buddy.js';
import { supportedLanguages, translate } from '../src/i18n.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('each supported focus mood has its own supportive tip', () => {
  assert.deepEqual(focusMoods, ['Calm', 'Focused', 'Okay', 'Tired', 'Stressed']);
  for (const mood of focusMoods) {
    const tip = translate('en', `focus.moodTip.${mood}`);
    assert.ok(tip.length > 40);
  }
});

test('Focus Buddy and every mood tip are translated in every supported language', () => {
  const keys = [
    'focusBuddy.title', 'focusBuddy.description', 'focusBuddy.enabled',
    'focusBuddy.enabledHelp', 'focusBuddy.character', 'focusBuddy.webHero',
    'focusBuddy.capeHero', 'focusBuddy.cat', 'focusBuddy.frog',
    'focusBuddy.interval', 'focusBuddy.snooze', 'focusBuddy.greetByName',
    'focusBuddy.duringSessions', 'focusBuddy.duringSessionsHelp',
    'focusBuddy.greeting', 'focusBuddy.greetingFallback', 'focusBuddy.done',
    'focusBuddy.later', 'focusBuddy.snoozed', 'focusBuddy.thanks',
    ...focusMoods.map((mood) => `focus.moodTip.${mood}`),
  ];
  for (const language of supportedLanguages) {
    for (const key of keys) {
      const translated = translate(language, key, { name: 'Alex' });
      assert.notEqual(translated, key, `${language} is missing ${key}`);
      assert.ok(!translated.includes('{name}'), `${language} did not interpolate ${key}`);
      if (language !== 'en') assert.notEqual(translated, translate('en', key, { name: 'Alex' }), `${language} fell back to English for ${key}`);
    }
  }
  for (const language of supportedLanguages) {
    assert.match(translate(language, 'focusBuddy.greeting', { name: 'Alex' }), /Alex/);
  }
});

test('Focus Buddy preferences validate character and reminder intervals', () => {
  const preferences = normalizeFocusBuddyPreferences({
    focus_buddy_character: 'frog',
    focus_buddy_interval_minutes: 30,
    focus_buddy_snooze_minutes: 5,
    focus_buddy_enabled: false,
    focus_buddy_greet_by_name: false,
    focus_buddy_during_sessions: true,
  });
  assert.deepEqual(preferences, {
    focus_buddy_enabled: false,
    focus_buddy_character: 'frog',
    focus_buddy_interval_minutes: 30,
    focus_buddy_snooze_minutes: 5,
    focus_buddy_greet_by_name: false,
    focus_buddy_during_sessions: true,
  });
  assert.equal(focusBuddyCharacters.includes('cape-hero'), true);
  assert.deepEqual(
    normalizeFocusBuddyPreferences({ focus_buddy_character: 'copied-hero', focus_buddy_interval_minutes: 1 }),
    normalizeFocusBuddyPreferences(),
  );
});

test('water reminder deadlines persist across refreshes and snooze starts a future deadline', () => {
  const storage = createStorage();
  const key = waterReminderStorageKey('alex');
  const now = 1_800_000_000_000;
  const first = readWaterReminderSchedule(storage, key, 60, now);
  assert.equal(first, now + 60 * 60_000);
  assert.equal(readWaterReminderSchedule(storage, key, 30, now + 1000), first);

  const snoozed = scheduleNextWaterReminder(storage, key, 5, now + 2000);
  assert.equal(snoozed, now + 5 * 60_000 + 2000);
  assert.equal(readWaterReminderSchedule(storage, key, 60, now + 3000), snoozed);
  assert.equal(waterReminderDelayMs(first, now + 1000), first - now - 1000);
  assert.equal(waterReminderDelayMs(first, first), 0);
  assert.equal(waterReminderDelayMs(first, first + 1), 0);
});

test('reminder responses are idempotent until the next reminder is presented', () => {
  const responseState = { current: false };
  assert.equal(claimWaterReminderResponse(responseState), true);
  assert.equal(claimWaterReminderResponse(responseState), false);
  responseState.current = false;
  assert.equal(claimWaterReminderResponse(responseState), true);
});

test('reminder schedules are isolated by account', () => {
  assert.notEqual(waterReminderStorageKey('alex'), waterReminderStorageKey('sam'));
});

test('invalid reminder schedule data is replaced without an immediate reminder', () => {
  const storage = createStorage();
  const key = waterReminderStorageKey('alex');
  const now = 1_800_000_000_000;
  storage.setItem(key, 'not json');
  assert.equal(readWaterReminderSchedule(storage, key, 15, now), now + 15 * 60_000);
  assert.deepEqual(JSON.parse(storage.getItem(key)), { nextAt: now + 15 * 60_000 });
});
