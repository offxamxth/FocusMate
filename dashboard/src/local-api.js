import { awardEligibleAchievements } from './achievement-data.js';

const PROFILE_PREFIX = 'focusmate-profile:';
const LIVE_PREFIX = 'focusmate-live:';
const cameraSessions = new Map();

function normalizeUsername(value) {
  const username = String(value || '').trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_.-]{1,32}$/.test(username) ? username : '';
}

function profileStorageKey(username) {
  const canonicalKey = `${PROFILE_PREFIX}${username}`;
  if (localStorage.getItem(canonicalKey) !== null) return canonicalKey;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(PROFILE_PREFIX) && normalizeUsername(key.slice(PROFILE_PREFIX.length)) === username) return key;
  }
  return null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function freshProfile(username, name = 'Focus friend') {
  return {
    username,
    player_name: name,
    total_xp: 0,
    sessions_completed: 0,
    total_study_seconds: 0,
    session_history: [],
    session_reflections: [],
    achievements: [],
    quest_claims: [],
    tasks: [],
    active_session_plan: {},
    session_wellbeing: { sleep_hours: 0, water_glasses: 0, reflection: '' },
    water_glasses_today: 0,
    water_glasses_last_reset: today(),
    focus_timer_seconds_today: 0,
    focus_timer_date: today(),
    focus_timer_total_seconds: 0,
    focus_timer_history: [],
    session_preferences: {
      focus_monitoring: true,
      posture_alerts: true,
      mood_checkins: true,
      session_chimes: false,
      session_length_minutes: 25,
      daily_goal_minutes: 180,
    },
  };
}

function read(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

function readProfile(username) {
  const defaults = freshProfile(username);
  const profile = { ...defaults, ...read(profileStorageKey(username) || `${PROFILE_PREFIX}${username}`, {}), username };
  profile.session_preferences = { ...defaults.session_preferences, ...profile.session_preferences };
  profile.session_wellbeing = { ...defaults.session_wellbeing, ...profile.session_wellbeing };
  for (const key of ['session_history', 'session_reflections', 'achievements', 'quest_claims', 'tasks', 'focus_timer_history']) {
    if (!Array.isArray(profile[key])) profile[key] = [];
  }
  profile.session_history = profile.session_history.filter((item) => item && typeof item === 'object').map((item) => {
    const clean = { ...item };
    delete clean.focus_score;
    return clean;
  });
  profile.session_reflections = profile.session_reflections.filter((item) => item && typeof item === 'object').map((item) => {
    if (!/focus estimate|focus score|behavioral score/i.test(item.summary || '')) return item;
    return { ...item, summary: 'This older camera summary used an unvalidated numeric score. New sessions report observed camera signals instead.' };
  });
  if (profile.water_glasses_last_reset !== today()) {
    profile.water_glasses_today = 0;
    profile.water_glasses_last_reset = today();
  }
  if (profile.focus_timer_date !== today()) {
    profile.focus_timer_seconds_today = 0;
    profile.focus_timer_date = today();
  }
  return profile;
}

function writeProfile(username, profile) {
  const value = { ...profile, username };
  localStorage.setItem(`${PROFILE_PREFIX}${username}`, JSON.stringify(value));
  return value;
}

function readLive(username) {
  const key = `${LIVE_PREFIX}${username}`;
  const live = read(key, {});
  if (Object.hasOwn(live, 'focus_score')) {
    delete live.focus_score;
    localStorage.setItem(key, JSON.stringify(live));
  }
  return live;
}

function writeLive(username, live) {
  localStorage.setItem(`${LIVE_PREFIX}${username}`, JSON.stringify(live));
  return live;
}

function requireUsername(url) {
  const username = normalizeUsername(url.searchParams.get('username'));
  if (!username) throw new Error('Enter a valid username.');
  return username;
}

function parseBody(options) {
  if (!options.body || typeof options.body !== 'string') return {};
  try { return JSON.parse(options.body); } catch { return {}; }
}

function reflectionFor(live) {
  const minutes = Math.round(Number(live.session_seconds || 0) / 60);
  const alerts = {
    posture: Number(live.posture_alerts || 0),
    screen_distance: Number(live.distance_alerts || 0),
    looking_away: Number(live.looking_away_alerts || 0),
    fatigue_related: Number(live.fatigue_signals || 0),
  };
  const highest = Object.entries(alerts).sort((a, b) => b[1] - a[1])[0];
  const suggestions = {
    posture: 'Try a quick posture check when you change tasks.',
    screen_distance: 'Adjust your seat or screen to keep a comfortable distance.',
    looking_away: 'Choose one small task and reduce nearby distractions.',
    fatigue_related: 'If you notice tiredness, try a short break before your next block.',
  };
  const alertCount = Object.values(alerts).reduce((total, value) => total + value, 0);
  return {
    session_id: live.session_id,
    generated_at: new Date().toISOString(),
    source: 'Local summary',
    summary: `FocusMate recorded ${alertCount} visual signal alerts during this ${minutes}-minute session. These are camera observations, not a measure of concentration or mental state.`,
    what_went_well: [`You completed ${minutes} minutes of study time.`, 'Your camera frames were analyzed in this browser and were not saved.'],
    try_next: highest[1] > 0 ? [suggestions[highest[0]]] : ['Keep the setup that worked and take a short break before your next block.'],
    stats: { duration_minutes: minutes, alert_counts: alerts, final_signals: { posture: live.posture || 'Unknown', screen_distance: live.distance_status || 'Unknown' } },
  };
}

function finishCameraSession(username) {
  const runtime = cameraSessions.get(username);
  const live = readLive(username);
  if (!live.session_active) throw new Error('There is no active camera session to stop.');
  const now = Date.now();
  const elapsed = Math.max(0, (now - runtime.startedAt) / 1000);
  const profile = readProfile(username);
  live.session_active = false;
  live.session_completed = true;
  live.session_seconds = Math.round(elapsed);
  live.session_minutes = Math.round(elapsed / 60 * 100) / 100;
  live.last_updated = new Date(now).toISOString();
  for (const [key, startedAt] of Object.entries(runtime.signalStarts)) {
    if (startedAt && (now - startedAt) / 1000 >= 2) {
      runtime.counts[key] += 1;
    }
  }
  live.posture_alerts = runtime.counts.slouching;
  live.distance_alerts = runtime.counts.distance_alert;
  live.looking_away_alerts = runtime.counts.looking_away;
  live.fatigue_signals = runtime.counts.eyes_closed;
  const plan = profile.active_session_plan || {};
  const challengeCount = Math.floor(live.session_seconds / 600);
  const challengeXp = challengeCount * 25;
  const history = {
    session_id: live.session_id,
    date: today(),
    session_started_at: live.session_started_at,
    seconds: live.session_seconds,
    posture_alerts: live.posture_alerts,
    distance_alerts: live.distance_alerts,
    looking_away_alerts: live.looking_away_alerts,
    fatigue_signals: live.fatigue_signals,
    pose_detected: live.pose_detected,
    face_detected: live.face_detected,
    subject: plan.subject || 'Other',
    goal: plan.goal || '',
    challenge_count: challengeCount,
    focus_challenge_xp: challengeXp,
    xp: challengeXp,
  };
  profile.session_history.push(history);
  profile.session_history = profile.session_history.slice(-1000);
  profile.sessions_completed += 1;
  profile.total_study_seconds += live.session_seconds;
  profile.active_session_plan = {};
  profile.total_xp += challengeXp;
  const unlocked = awardEligibleAchievements(profile, { type: 'session', live });
  const achievementXp = unlocked.reduce((total, item) => total + item.xp, 0);
  history.achievements_unlocked = unlocked.map((item) => item.id);
  history.xp = challengeXp + achievementXp;
  live.achievements_unlocked = unlocked.map((item) => item.id);
  live.focus_challenge_xp = challengeXp;
  live.study_subject = history.subject;
  live.study_goal = history.goal;
  const reflection = reflectionFor(live);
  profile.session_reflections.push(reflection);
  profile.session_reflections = profile.session_reflections.slice(-100);
  writeProfile(username, profile);
  writeLive(username, live);
  cameraSessions.delete(username);
  return { ok: true, message: 'Session ended. Your progress has been saved.', live };
}

function applyTelemetry(username, metrics) {
  const runtime = cameraSessions.get(username);
  if (!runtime) throw new Error('The camera session is no longer active.');
  const now = Date.now();
  const elapsed = Math.min(3, Math.max(0, (now - runtime.lastFrameAt) / 1000));
  runtime.lastFrameAt = now;
  const preferences = readProfile(username).session_preferences;
  const bad = {
    eyes_closed: Boolean(metrics.eyes_closed),
    face_missing: !metrics.face_detected,
    slouching: metrics.posture === 'Slouching',
    distance_alert: metrics.distance_status === 'Too Far',
    looking_away: Boolean(metrics.looking_away),
  };
  for (const [key, active] of Object.entries(bad)) {
    runtime.durations[key] += active ? elapsed : 0;
    if (active && !runtime.signalStarts[key]) runtime.signalStarts[key] = now;
    if (!active && runtime.signalStarts[key]) {
      const duration = (now - runtime.signalStarts[key]) / 1000;
      if (duration >= 2) runtime.counts[key] += 1;
      runtime.signalStarts[key] = 0;
    }
  }
  if (bad.slouching) {
    if (!runtime.postureAlertAt) runtime.postureAlertAt = now;
    if (preferences.posture_alerts !== false && !runtime.postureAlerted && now - runtime.postureAlertAt >= 120_000) {
      runtime.postureAlertPending = true;
      runtime.postureAlerted = true;
    }
  } else {
    runtime.postureAlertAt = 0;
    runtime.postureAlertPending = false;
    runtime.postureAlerted = false;
  }
  if (preferences.posture_alerts === false) runtime.postureAlertPending = false;
  const sessionSeconds = Math.max(1, (now - runtime.startedAt) / 1000);
  const live = readLive(username);
  Object.assign(live, {
    session_active: true,
    session_seconds: Math.round(sessionSeconds),
    session_minutes: Math.round(sessionSeconds / 60 * 100) / 100,
    posture_alerts: runtime.counts.slouching,
    distance_alerts: runtime.counts.distance_alert,
    looking_away_alerts: runtime.counts.looking_away,
    fatigue_signals: runtime.counts.eyes_closed,
    posture: metrics.posture || 'Unknown',
    pose_detected: Boolean(metrics.pose_detected),
    posture_alert_pending: runtime.postureAlertPending,
    distance_status: metrics.distance_status || 'Unknown',
    face_detected: Boolean(metrics.face_detected),
    eyes_closed: Boolean(metrics.eyes_closed),
    looking_away: Boolean(metrics.looking_away),
    ear: metrics.ear ?? null,
    posture_angle: metrics.posture_angle ?? null,
    status: metrics.status || 'Starting',
    last_updated: new Date(now).toISOString(),
  });
  if (now - runtime.lastHistoryAt >= 5000) {
    live.history = [...(live.history || []), {
      minute: Math.round(sessionSeconds / 60 * 100) / 100,
      posture_alerts: runtime.counts.slouching,
      distance_alerts: runtime.counts.distance_alert,
      looking_away_alerts: runtime.counts.looking_away,
      fatigue_signals: runtime.counts.eyes_closed,
    }].slice(-120);
    runtime.lastHistoryAt = now;
  }
  writeLive(username, live);
  return { ok: true, live };
}

export async function api(path, options = {}) {
  const url = new URL(path, window.location.origin);
  const method = options.method || 'GET';
  const body = parseBody(options);
  if (url.pathname === '/api/username' && method === 'GET') {
    const username = normalizeUsername(url.searchParams.get('username'));
    return { valid: Boolean(username), exists: Boolean(username && profileStorageKey(username)) };
  }
  if (url.pathname === '/api/login' && method === 'POST') {
    const username = normalizeUsername(body.username);
    const name = String(body.name || '').trim().slice(0, 80);
    if (!username) throw new Error('Enter a username using letters, numbers, dots, dashes, or underscores.');
    const existing = Boolean(profileStorageKey(username));
    if (!existing && !name) throw new Error('Enter your name to create a new profile.');
    const profile = existing ? readProfile(username) : writeProfile(username, freshProfile(username, name));
    return { profile, live: readLive(username), existing };
  }

  const username = requireUsername(url);
  if (url.pathname === '/api/state' && method === 'GET') return { profile: readProfile(username), live: readLive(username) };
  if (url.pathname === '/api/state' && method === 'PUT') {
    if (!body.profile || typeof body.profile !== 'object') throw new Error('Profile data is required.');
    const profile = writeProfile(username, { ...readProfile(username), ...body.profile, username });
    return { profile };
  }
  if (url.pathname === '/api/timer/credit' && method === 'POST') {
    const seconds = Math.max(0, Math.min(86400, Math.trunc(Number(body.seconds) || 0)));
    if (!seconds) throw new Error('No study time to save.');
    const profile = readProfile(username);
    profile.focus_timer_seconds_today += seconds;
    profile.focus_timer_total_seconds += seconds;
    const last = profile.focus_timer_history.at(-1);
    if (last?.date === today()) last.seconds += seconds;
    else profile.focus_timer_history.push({ date: today(), seconds });
    profile.focus_timer_history = profile.focus_timer_history.slice(-730);
    awardEligibleAchievements(profile, { type: 'study_time' });
    return { ok: true, profile: writeProfile(username, profile) };
  }
  if (url.pathname === '/api/quests/claim' && method === 'POST') {
    const rewards = { focus_sprint: 30, recharge: 15, hydration: 10, reflection: 10 };
    const reward = rewards[body.quest_id];
    if (!reward) throw new Error('Unknown quest.');
    const profile = readProfile(username);
    const live = readLive(username);
    const completedToday = profile.session_history.filter((item) => String(item.date || '').slice(0, 10) === today()).reduce((total, item) => total + Number(item.seconds || 0), 0);
    if (body.quest_id === 'focus_sprint' && profile.focus_timer_seconds_today + completedToday < 900 && !(live.session_active && live.session_seconds >= 900)) throw new Error('Complete a 15-minute study session to unlock this quest.');
    if (profile.quest_claims.some((item) => item.quest_id === body.quest_id && item.date === today())) throw new Error('This quest has already been claimed today.');
    profile.total_xp += reward;
    profile.quest_claims.push({ quest_id: body.quest_id, date: today(), xp: reward, claimed_at: new Date().toISOString() });
    awardEligibleAchievements(profile, { type: 'xp' });
    return { ok: true, profile: writeProfile(username, profile) };
  }
  if (url.pathname === '/api/session/reflection' && method === 'POST') {
    const profile = readProfile(username);
    if (profile.session_reflections.length) {
      awardEligibleAchievements(profile, { type: 'reflection' });
      writeProfile(username, profile);
    }
    return { ok: true, profile };
  }
  if (url.pathname === '/api/session/goal' && method === 'POST') {
    if (!['Yes', 'Partially', 'Not yet'].includes(body.outcome)) throw new Error('Choose a goal outcome.');
    const live = readLive(username);
    if (!live.session_completed) throw new Error('The session is not complete yet.');
    live.goal_outcome = body.outcome;
    const profile = readProfile(username);
    const entry = profile.session_history.find((item) => item.session_id === live.session_id);
    if (entry) entry.goal_outcome = body.outcome;
    writeProfile(username, profile);
    writeLive(username, live);
    return { ok: true, live };
  }
  if (url.pathname === '/api/webcam/start' && method === 'POST') {
    const profile = readProfile(username);
    if (!profile.session_preferences.focus_monitoring) throw new Error('Webcam monitoring is turned off in session preferences.');
    if (cameraSessions.has(username)) return { ok: true, message: 'Your study session is already running.' };
    const now = Date.now();
    const sessionId = crypto.randomUUID();
    profile.active_session_plan = { subject: String(body.subject || 'Other').slice(0, 40), goal: String(body.goal || '').slice(0, 200) };
    if (body.mood) profile.session_wellbeing = { ...profile.session_wellbeing, mood: String(body.mood), mood_checkin_date: today(), mood_updated_at: new Date(now).toISOString() };
    writeProfile(username, profile);
    writeLive(username, { session_active: true, session_completed: false, session_id: sessionId, session_started_at: new Date(now).toISOString(), session_seconds: 0, posture_alerts: 0, distance_alerts: 0, looking_away_alerts: 0, fatigue_signals: 0, history: [], status: 'Waiting for camera signals', posture: 'Unknown', pose_detected: false, distance_status: 'Unknown', face_detected: false });
    cameraSessions.set(username, { startedAt: now, lastFrameAt: now, lastHistoryAt: now, postureAlertAt: 0, postureAlerted: false, postureAlertPending: false, signalStarts: {}, counts: { eyes_closed: 0, face_missing: 0, slouching: 0, distance_alert: 0, looking_away: 0 }, durations: { eyes_closed: 0, face_missing: 0, slouching: 0, distance_alert: 0, looking_away: 0 } });
    return { ok: true, message: 'Your study session has started.' };
  }
  if (url.pathname === '/api/camera/telemetry' && method === 'POST') return applyTelemetry(username, body);
  if (url.pathname === '/api/webcam/stop' && method === 'POST') return finishCameraSession(username);
  throw new Error('This feature is not available in the browser-only deployment.');
}