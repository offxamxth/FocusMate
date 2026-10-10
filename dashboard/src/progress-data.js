const DAY_MS = 24 * 60 * 60 * 1000;

function positiveSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

import { isDetectionSignalMonitored } from './session-detection.js';

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return new Date(year, month - 1, day);
}

function shiftDateKey(key, days) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function studyDayKeys(profile) {
  const days = new Set();
  for (const session of Array.isArray(profile.session_history) ? profile.session_history : []) {
    const date = String(session?.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number(session.seconds) > 0) days.add(date);
  }
  for (const entry of Array.isArray(profile.focus_timer_history) ? profile.focus_timer_history : []) {
    const date = String(entry?.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number(entry.seconds) > 0) days.add(date);
  }
  return [...days].sort();
}

export function studyStreak(profile, date = new Date(), activeSeconds = 0) {
  const today = localDateKey(date);
  const days = new Set(studyDayKeys(profile));
  if (activeSeconds > 0) days.add(today);
  const mostRecent = days.has(today) ? today : shiftDateKey(today, -1);
  if (!days.has(mostRecent)) return 0;
  let streak = 0;
  let cursor = mostRecent;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

export function weekStudyDays(profile, date = new Date(), activeSeconds = 0) {
  const today = localDateKey(date);
  const weekday = date.getDay();
  const mondayOffset = (weekday + 6) % 7;
  const monday = shiftDateKey(today, -mondayOffset);
  const days = new Set(studyDayKeys(profile));
  if (activeSeconds > 0) days.add(today);
  return Array.from({ length: 7 }, (_, index) => {
    const key = shiftDateKey(monday, index);
    const dateValue = dateFromKey(key);
    return {
      date: key,
      label: dateValue.toLocaleDateString(undefined, { weekday: 'narrow' }),
      completed: days.has(key),
    };
  });
}

const questGroups = [
  [
    { id: 'focus_15', category: 'focus_time', target: 15, rewardXP: 10, difficulty: 'Easy' },
    { id: 'focus_25', category: 'focus_time', target: 25, rewardXP: 20, difficulty: 'Medium' },
    { id: 'focus_40', category: 'focus_time', target: 40, rewardXP: 30, difficulty: 'Hard' },
  ],
  [
    { id: 'camera_session_1', category: 'session_count', target: 1, rewardXP: 10, difficulty: 'Easy' },
    { id: 'camera_session_2', category: 'session_count', target: 2, rewardXP: 20, difficulty: 'Medium' },
    { id: 'camera_session_3', category: 'session_count', target: 3, rewardXP: 30, difficulty: 'Hard' },
  ],
  [
    { id: 'session_xp_20', category: 'session_xp', target: 20, rewardXP: 10, difficulty: 'Easy' },
    { id: 'session_xp_35', category: 'session_xp', target: 35, rewardXP: 20, difficulty: 'Medium' },
    { id: 'session_xp_60', category: 'session_xp', target: 60, rewardXP: 30, difficulty: 'Hard' },
  ],
  [
    { id: 'posture_free', category: 'camera_alerts', signal: 'posture_alerts', target: 1, rewardXP: 20, difficulty: 'Medium' },
    { id: 'distance_free', category: 'camera_alerts', signal: 'distance_alerts', target: 1, rewardXP: 20, difficulty: 'Medium' },
    { id: 'looking_away_free', category: 'camera_alerts', signal: 'looking_away_alerts', target: 1, rewardXP: 20, difficulty: 'Medium' },
  ],
];

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function generateDailyQuests(username, date, previousIds = []) {
  const previous = new Set(previousIds);
  const selected = questGroups.map((group, index) => {
    const start = hash(`${username}|${date}|${index}`) % group.length;
    return group[start];
  });
  if (selected.every((quest) => previous.has(quest.id))) {
    selected.forEach((quest, index) => {
      const group = questGroups[index];
      selected[index] = group[(group.indexOf(quest) + 1) % group.length];
    });
  }
  return selected.map((quest) => ({
    ...quest,
    progress: 0,
    completed: false,
    rewardClaimed: false,
  }));
}

export function rerollDailyQuest(profile, questId, date = localDateKey(), live = {}) {
  const daily = profile.daily_quests;
  if (daily?.date !== date || !Array.isArray(daily.quests)) return null;
  const current = daily.quests.find((quest) => quest.id === questId);
  if (!current || current.completed || current.rewardClaimed) return null;
  const group = questGroups.find((items) => items[0]?.category === current.category);
  if (!group) return null;

  const history = Array.isArray(current.rerollHistory) ? current.rerollHistory : [];
  const excludedIds = new Set([
    current.id,
    ...history,
    ...daily.quests.filter((quest) => quest.id !== current.id).map((quest) => quest.id),
  ]);
  const alternatives = group.filter((quest) =>
    !excludedIds.has(quest.id)
    && questValue(profile, live, quest, date) < quest.target,
  );
  if (!alternatives.length) return null;

  const selected = alternatives[hash(
    `${profile.username}|${date}|${history[0] || current.id}|${history.length}`,
  ) % alternatives.length];
  return {
    ...selected,
    progress: 0,
    completed: false,
    rewardClaimed: false,
    rerollHistory: [...history, current.id],
  };
}

function sessionsForDate(profile, date) {
  return (Array.isArray(profile.session_history) ? profile.session_history : [])
    .filter((session) => String(session?.date || '').slice(0, 10) === date && Number(session.seconds) > 0);
}

export function dailyFocusSeconds(profile, live = {}, date = localDateKey()) {
  const timerSeconds = profile.focus_timer_date === date
    ? positiveSeconds(profile.focus_timer_seconds_today)
    : 0;
  const completedCameraSeconds = sessionsForDate(profile, date)
    .reduce((total, session) => total + positiveSeconds(session.seconds), 0);
  const activeSessionDate = live.session_started_at ? localDateKey(new Date(live.session_started_at)) : '';
  const activeSeconds = live.session_active && activeSessionDate === date
    ? positiveSeconds(live.session_seconds)
    : 0;
  return timerSeconds + completedCameraSeconds + activeSeconds;
}

function questValue(profile, live, quest, date) {
  const sessions = sessionsForDate(profile, date);
  switch (quest.category) {
    case 'focus_time':
      return dailyFocusSeconds(profile, live, date) / 60;
    case 'session_count':
      return sessions.length;
    case 'session_xp':
      return sessions.reduce((total, session) => total + Math.max(0, Number(session.xp) || 0), 0);
    case 'camera_alerts': {
      const monitoredSignal = {
        posture_alerts: 'slouching',
        distance_alerts: 'distance_alert',
        looking_away_alerts: 'looking_away',
      }[quest.signal];
      if (!monitoredSignal) return 0;
      return sessions.some((session) =>
        isDetectionSignalMonitored(session, monitoredSignal)
        && Object.hasOwn(session, quest.signal)
        && Number(session[quest.signal]) === 0,
      ) ? 1 : 0;
    }
    default:
      return 0;
  }
}

export function refreshDailyQuests(profile, live = {}, date = localDateKey()) {
  const previous = profile.daily_quests;
  const validCurrent = previous?.date === date
    && Array.isArray(previous.quests)
    && previous.quests.length === 4
    && new Set(previous.quests.map((quest) => quest?.id)).size === 4
    && new Set(previous.quests.map((quest) => quest?.category)).size === 4
    && previous.quests.every((quest) =>
      quest
      && typeof quest.id === 'string'
      && ['focus_time', 'session_count', 'session_xp', 'camera_alerts'].includes(quest.category)
      && Number.isFinite(Number(quest.target)) && Number(quest.target) > 0
      && Number.isFinite(Number(quest.rewardXP)) && Number(quest.rewardXP) >= 0
      && ['Easy', 'Medium', 'Hard'].includes(quest.difficulty),
    );
  let changed = false;
  if (!validCurrent) {
    const priorIds = Array.isArray(previous?.quests) ? previous.quests.map((quest) => quest?.id) : [];
    profile.daily_quests = { date, quests: generateDailyQuests(profile.username, date, priorIds) };
    changed = true;
  }

  const claims = Array.isArray(profile.daily_quest_claims) ? profile.daily_quest_claims : [];
  profile.daily_quest_claims = claims.filter((claim) =>
    claim && typeof claim.quest_id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(claim.date || ''),
  ).slice(-120);
  for (const quest of profile.daily_quests.quests) {
    const value = Math.max(0, questValue(profile, live, quest, date));
    const progress = quest.category === 'camera_alerts'
      ? Math.min(1, value)
      : Math.min(quest.target, value);
    const completed = progress >= quest.target;
    if (quest.progress !== progress || quest.completed !== completed) changed = true;
    quest.progress = progress;
    quest.completed = completed;
    const claimed = profile.daily_quest_claims.some((claim) =>
      claim.quest_id === quest.id && claim.date === date,
    );
    if (completed && !claimed) {
      profile.total_xp = Number(profile.total_xp || 0) + Number(quest.rewardXP);
      profile.daily_quest_claims.push({
        quest_id: quest.id,
        date,
        xp: quest.rewardXP,
        claimed_at: new Date().toISOString(),
      });
      quest.rewardClaimed = true;
      changed = true;
    } else {
      if (quest.rewardClaimed !== claimed) changed = true;
      quest.rewardClaimed = claimed;
    }
  }
  return { profile, changed };
}
