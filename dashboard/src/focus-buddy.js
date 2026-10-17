export const focusBuddyCharacters = ['web-hero', 'cape-hero', 'cat', 'frog'];
export const waterReminderIntervals = [15, 30, 45, 60, 90, 120];
export const waterReminderSnoozes = [5, 10, 15, 20, 30];

export const moodFocusTips = {
  Calm: '😌 Feeling calm? Great! Protect that peaceful mindset. Set one clear goal and ease into your focus session.',
  Focused: '🎯 Already feeling focused? Nice! Choose your top priority, silence distractions, and make the most of your momentum.',
  Okay: '🙂 Feeling okay? That’s a good place to start. Take it one step at a time and focus on making steady progress.',
  Tired: '😴 Feeling tired? Are you sure you’re ready for a focus session? Grab some water, stretch, or take a short rest if you need it. If you’re ready, start with a small, manageable goal.',
  Stressed: '😟 Feeling stressed? Are you sure you want to start a session while stressed? Take a moment to cool down, breathe slowly, and settle your mind. When you’re ready, choose one small task to begin with.',
};

const defaults = {
  focus_buddy_enabled: true,
  focus_buddy_character: 'web-hero',
  focus_buddy_interval_minutes: 60,
  focus_buddy_snooze_minutes: 10,
  focus_buddy_greet_by_name: true,
  focus_buddy_during_sessions: false,
};

export function normalizeFocusBuddyPreferences(preferences = {}) {
  return {
    focus_buddy_enabled: preferences.focus_buddy_enabled !== false,
    focus_buddy_character: focusBuddyCharacters.includes(preferences.focus_buddy_character)
      ? preferences.focus_buddy_character
      : defaults.focus_buddy_character,
    focus_buddy_interval_minutes: waterReminderIntervals.includes(Number(preferences.focus_buddy_interval_minutes))
      ? Number(preferences.focus_buddy_interval_minutes)
      : defaults.focus_buddy_interval_minutes,
    focus_buddy_snooze_minutes: waterReminderSnoozes.includes(Number(preferences.focus_buddy_snooze_minutes))
      ? Number(preferences.focus_buddy_snooze_minutes)
      : defaults.focus_buddy_snooze_minutes,
    focus_buddy_greet_by_name: preferences.focus_buddy_greet_by_name !== false,
    focus_buddy_during_sessions: preferences.focus_buddy_during_sessions === true,
  };
}

export function waterReminderStorageKey(username) {
  return `focusmate-water-reminder:${username}`;
}

export function readWaterReminderSchedule(storage, key, intervalMinutes, now = Date.now()) {
  const saved = storage.getItem(key);
  if (saved !== null) {
    try {
      const schedule = JSON.parse(saved);
      if (Number.isFinite(schedule?.nextAt) && schedule.nextAt > 0) return schedule.nextAt;
    } catch {
      storage.removeItem(key);
    }
  }
  const nextAt = now + intervalMinutes * 60_000;
  storage.setItem(key, JSON.stringify({ nextAt }));
  return nextAt;
}

export function scheduleNextWaterReminder(storage, key, delayMinutes, now = Date.now()) {
  const nextAt = now + delayMinutes * 60_000;
  storage.setItem(key, JSON.stringify({ nextAt }));
  return nextAt;
}

export function focusMoodTip(mood) {
  return moodFocusTips[mood] || '';
}
