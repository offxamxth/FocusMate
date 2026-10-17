import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  focusBuddyCharacters,
  focusMoodTip,
  moodFocusTips,
  normalizeFocusBuddyPreferences,
  readWaterReminderSchedule,
  scheduleNextWaterReminder,
  waterReminderStorageKey,
} from '../src/focus-buddy.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('each supported focus mood has its own supportive tip', () => {
  assert.deepEqual(Object.keys(moodFocusTips), ['Calm', 'Focused', 'Okay', 'Tired', 'Stressed']);
  for (const mood of Object.keys(moodFocusTips)) {
    assert.equal(focusMoodTip(mood), moodFocusTips[mood]);
    assert.ok(moodFocusTips[mood].length > 40);
  }
  assert.equal(focusMoodTip('unknown'), '');
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
});

test('invalid reminder schedule data is replaced without an immediate reminder', () => {
  const storage = createStorage();
  const key = waterReminderStorageKey('alex');
  const now = 1_800_000_000_000;
  storage.setItem(key, 'not json');
  assert.equal(readWaterReminderSchedule(storage, key, 15, now), now + 15 * 60_000);
  assert.deepEqual(JSON.parse(storage.getItem(key)), { nextAt: now + 15 * 60_000 });
});
