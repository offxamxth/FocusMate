export const focusBuddyCharacters = ['web-hero', 'cape-hero', 'cat', 'frog'];
export const focusBuddyImageFiles = [
  'encourage.png',
  'excited.png',
  'happy.png',
  'neutral.png',
  'prepare-swing.png',
  'sad.png',
  'swing-1.png',
  'thinking.png',
  'walk-away.png',
  'walk-in.png',
  'wave.png',
];
export const focusBuddyImageFrames = {
  'walking-in': ['walk-in.png'],
  waiting: ['neutral.png'],
  'happy-swinging': ['happy.png', 'prepare-swing.png', 'swing-1.png'],
  'sad-walking-back': ['sad.png', 'walk-away.png'],
};
export const waterReminderIntervals = [15, 30, 45, 60, 90, 120];
export const waterReminderSnoozes = [5, 10, 15, 20, 30];
export const focusBuddyAnimationStates = [
  'hidden',
  'walking-in',
  'waiting',
  'happy-swinging',
  'sad-walking-back',
  'dismissed',
];

const focusBuddyAnimationTransitions = {
  hidden: { reminderDue: 'walking-in' },
  'walking-in': { entranceFinished: 'waiting' },
  waiting: {
    done: 'happy-swinging',
    later: 'sad-walking-back',
  },
  'happy-swinging': { reactionFinished: 'dismissed' },
  'sad-walking-back': { reactionFinished: 'dismissed' },
  dismissed: { reminderDue: 'walking-in' },
};

export const focusMoods = ['Calm', 'Focused', 'Okay', 'Tired', 'Stressed'];

export function transitionFocusBuddyAnimation(state, event) {
  return focusBuddyAnimationTransitions[state]?.[event] || state;
}

export function waterReminderDelayForAction(preferences, action) {
  if (action === 'done') return preferences.focus_buddy_interval_minutes;
  if (action === 'later') return preferences.focus_buddy_snooze_minutes;
  return null;
}

const defaults = {
  focus_buddy_enabled: true,
  focus_buddy_character: 'web-hero',
  focus_buddy_sounds_enabled: true,
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
    focus_buddy_sounds_enabled: preferences.focus_buddy_sounds_enabled !== false,
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

export function waterReminderDelayMs(nextAt, now = Date.now()) {
  return Number.isFinite(nextAt) ? Math.max(0, nextAt - now) : 0;
}

export function claimWaterReminderResponse(state) {
  if (state.current) return false;
  state.current = true;
  return true;
}

export function claimFocusBuddyAppearanceSound(
  state,
  { visible, character, enabled },
  now = 0,
) {
  const newlyAppeared = visible
    && (!state.visible || state.character !== character);
  state.visible = visible;
  state.character = character;
  if (!newlyAppeared || !enabled || now - state.lastPlayedAt < 250) return false;
  state.lastPlayedAt = now;
  return true;
}
