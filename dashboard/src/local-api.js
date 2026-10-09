import { awardEligibleAchievements } from './achievement-data.js';
import { localDateKey, refreshDailyQuests } from './progress-data.js';
import { defaultDetectionConfiguration, normalizeDetectionConfiguration } from './session-detection.js';

const PROFILE_PREFIX = 'focusmate-profile:';
const LIVE_PREFIX = 'focusmate-live:';
const PROFILE_SCHEMA_VERSION = 3;
const cameraSessions = new Map();

function normalizeUsername(value) {
  const username = String(value || '').trim().replace(/^@/, '').toLowerCase();
  if (/^cloud_[a-f0-9]{32}$/.test(username)) return username;
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
  return localDateKey();
}

function freshProfile(username, name = 'Focus friend') {
  return {
    schema_version: PROFILE_SCHEMA_VERSION,
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
    daily_quests: null,
    daily_quest_claims: [],
    session_preferences: {
      focus_monitoring: true,
      posture_alerts: true,
      ...defaultDetectionConfiguration,
      mood_checkins: true,
      session_chimes: false,
      session_length_minutes: 25,
      daily_goal_minutes: 60,
      language: 'system',
      theme: 'system',
      study_style: 'normal',
      study_goal_type: 'self-study',
      time_format: 'system',
    },
  };
}

function read(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function normalizeXp(value) {
  const xp = Number(value);
  return Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
}

function normalizeSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

export function levelForXp(value) {
  return Math.floor(normalizeXp(value) / 100) + 1;
}

function readProfile(username) {
  const defaults = freshProfile(username);
  const storageKey = profileStorageKey(username) || `${PROFILE_PREFIX}${username}`;
  const storedValue = localStorage.getItem(storageKey);
  let storedProfile = {};
  if (storedValue !== null) {
    try {
      storedProfile = JSON.parse(storedValue);
    } catch {
      throw new Error('FocusMate could not read this saved profile. The original data was left untouched.');
    }
    if (!storedProfile || typeof storedProfile !== 'object' || Array.isArray(storedProfile)) {
      throw new Error('FocusMate could not read this saved profile. The original data was left untouched.');
    }
  }
  const profile = {
    ...defaults,
    ...storedProfile,
    schema_version: PROFILE_SCHEMA_VERSION,
    username,
  };
  profile.total_xp = normalizeXp(profile.total_xp);
  profile.sessions_completed = normalizeXp(profile.sessions_completed);
  profile.total_study_seconds = normalizeXp(profile.total_study_seconds);
  profile.focus_timer_seconds_today = normalizeSeconds(profile.focus_timer_seconds_today);
  profile.focus_timer_total_seconds = normalizeSeconds(profile.focus_timer_total_seconds);
  profile.session_preferences = { ...defaults.session_preferences, ...profile.session_preferences };
  Object.assign(profile.session_preferences, normalizeDetectionConfiguration(profile.session_preferences));
  const preferences = profile.session_preferences;
  const sessionLength = Number(preferences.session_length_minutes);
  const dailyGoal = Number(preferences.daily_goal_minutes);
  preferences.session_length_minutes = Number.isFinite(sessionLength) && sessionLength >= 15 && sessionLength <= 120
    ? Math.round(sessionLength)
    : defaults.session_preferences.session_length_minutes;
  preferences.daily_goal_minutes = Number.isFinite(dailyGoal) && dailyGoal >= 30 && dailyGoal <= 720
    ? Math.round(dailyGoal)
    : defaults.session_preferences.daily_goal_minutes;
  if (!['system', 'en', 'es', 'fr', 'ar', 'hi'].includes(preferences.language)) {
    preferences.language = defaults.session_preferences.language;
  }
  if (!['system', 'light', 'dark'].includes(preferences.theme)) {
    preferences.theme = defaults.session_preferences.theme;
  }
  if (!['quiet', 'normal', 'competitive'].includes(preferences.study_style)) {
    preferences.study_style = defaults.session_preferences.study_style;
  }
  if (!['school', 'university', 'self-study', 'reading', 'coding', 'exam-preparation'].includes(preferences.study_goal_type)) {
    preferences.study_goal_type = defaults.session_preferences.study_goal_type;
  }
  if (!['system', '12-hour', '24-hour'].includes(preferences.time_format)) {
    preferences.time_format = defaults.session_preferences.time_format;
  }
  profile.session_wellbeing = { ...defaults.session_wellbeing, ...profile.session_wellbeing };
  for (const key of ['session_history', 'session_reflections', 'achievements', 'quest_claims', 'tasks', 'focus_timer_history', 'daily_quest_claims']) {
    if (!Array.isArray(profile[key])) profile[key] = [];
  }
  profile.focus_timer_history = profile.focus_timer_history
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ ...item, seconds: normalizeSeconds(item.seconds) }));
  const achievementIds = new Set();
  profile.achievements = profile.achievements.filter((item) => {
    if (typeof item === 'string') {
      if (achievementIds.has(item)) return false;
      achievementIds.add(item);
      return true;
    }
    if (!item || typeof item !== 'object') return false;
    if (typeof item.id !== 'string') return true;
    if (achievementIds.has(item.id)) return false;
    achievementIds.add(item.id);
    return true;
  });
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

function updateDailyQuests(profile, live = {}) {
  const previousClaims = profile.daily_quest_claims?.length || 0;
  const result = refreshDailyQuests(profile, live, today());
  if ((profile.daily_quest_claims?.length || 0) > previousClaims) {
    awardEligibleAchievements(profile, { type: 'xp' });
    result.changed = true;
  }
  return result.profile;
}

function writeProfile(username, profile) {
  const value = {
    ...profile,
    schema_version: PROFILE_SCHEMA_VERSION,
    total_xp: normalizeXp(profile.total_xp),
    username,
  };
  localStorage.setItem(`${PROFILE_PREFIX}${username}`, JSON.stringify(value));
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('focusmate:profile-updated', {
      detail: { username, profile: value },
    }));
  }
  return value;
}

function readLive(username) {
  const key = `${LIVE_PREFIX}${username}`;
  const live = read(key, {});
  if (Object.hasOwn(live, 'focus_score')) {
    delete live.focus_score;
    localStorage.setItem(key, JSON.stringify(live));
  }
  if (live.session_active && !cameraSessions.has(username)) {
    live.session_active = false;
    live.session_completed = false;
    live.session_interrupted = true;
    live.posture_alert_pending = false;
    live.status = 'Camera session interrupted after reload';
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
    posture: live.posture_alerts,
    screen_distance: live.distance_alerts,
    looking_away: live.looking_away_alerts,
    fatigue_related: live.fatigue_signals,
    face_missing: live.face_missing_alerts,
  };
  const monitoredAlerts = Object.entries(alerts).filter(([, count]) => Number.isFinite(count));
  const highest = monitoredAlerts.sort((a, b) => b[1] - a[1])[0];
  const suggestions = {
    posture: 'Try a quick posture check when you change tasks.',
    screen_distance: 'Adjust your seat or screen to keep a comfortable distance.',
    looking_away: 'Choose one small task and reduce nearby distractions.',
    fatigue_related: 'If you notice tiredness, try a short break before your next block.',
    face_missing: 'Adjust your camera framing if you want face-related signals to be available.',
  };
  const alertCount = monitoredAlerts.reduce((total, [, value]) => total + value, 0);
  return {
    session_id: live.session_id,
    generated_at: new Date().toISOString(),
    source: 'Local summary',
    summary: `FocusMate recorded ${alertCount} visual signal alerts during this ${minutes}-minute session. These are camera observations, not a measure of concentration or mental state.`,
    what_went_well: [`You completed ${minutes} minutes of study time.`, 'Your camera frames were analyzed in this browser and were not saved.'],
    try_next: highest?.[1] > 0 ? [suggestions[highest[0]]] : ['Keep the setup that worked and take a short break before your next block.'],
    stats: { duration_minutes: minutes, alert_counts: alerts, final_signals: { posture: live.posture || 'Unknown', screen_distance: live.distance_status || 'Unknown' } },
  };
}

function finishCameraSession(username) {
  const runtime = cameraSessions.get(username);
  const live = readLive(username);
  if (!live.session_active) throw new Error('There is no active camera session to stop.');
  if (!runtime) throw new Error('This camera session was interrupted and cannot be completed after reloading.');
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
  const configuration = runtime.sessionConfiguration;
  live.posture_alerts = configuration.monitor_posture ? runtime.counts.slouching : null;
  live.distance_alerts = configuration.monitor_distance ? runtime.counts.distance_alert : null;
  live.looking_away_alerts = configuration.monitor_looking_away ? runtime.counts.looking_away : null;
  live.fatigue_signals = configuration.monitor_eye_closure ? runtime.counts.eyes_closed : null;
  live.face_missing_alerts = configuration.monitor_face_missing ? runtime.counts.face_missing : null;
  live.session_configuration = configuration;
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
    face_missing_alerts: live.face_missing_alerts,
    detection_configuration: configuration,
    pose_detected: configuration.monitor_posture ? live.pose_detected : null,
    pose_detection_status: live.pose_detection_status || (live.pose_detected ? 'detected' : 'checking'),
    face_detected: configuration.monitor_face_missing || configuration.monitor_looking_away
      || configuration.monitor_eye_closure || configuration.monitor_distance
      ? live.face_detected : null,
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
  updateDailyQuests(profile, live);
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
  const configuration = runtime.sessionConfiguration;
  const bad = {
    eyes_closed: configuration.monitor_eye_closure && Boolean(metrics.eyes_closed),
    face_missing: configuration.monitor_face_missing && metrics.face_detected === false,
    slouching: configuration.monitor_posture && metrics.posture === 'Slouching',
    distance_alert: configuration.monitor_distance && metrics.distance_status === 'Too Far',
    looking_away: configuration.monitor_looking_away && Boolean(metrics.looking_away),
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
    if (configuration.monitor_posture && runtime.postureReminderEnabled && !runtime.postureAlerted && now - runtime.postureAlertAt >= 120_000) {
      runtime.postureAlertPending = true;
      runtime.postureAlerted = true;
    }
  } else {
    runtime.postureAlertAt = 0;
    runtime.postureAlertPending = false;
    runtime.postureAlerted = false;
  }
  if (!configuration.monitor_posture) runtime.postureAlertPending = false;
  const sessionSeconds = Math.max(1, (now - runtime.startedAt) / 1000);
  const live = readLive(username);
  Object.assign(live, {
    session_active: true,
    session_seconds: Math.round(sessionSeconds),
    session_minutes: Math.round(sessionSeconds / 60 * 100) / 100,
    posture_alerts: configuration.monitor_posture ? runtime.counts.slouching : null,
    distance_alerts: configuration.monitor_distance ? runtime.counts.distance_alert : null,
    looking_away_alerts: configuration.monitor_looking_away ? runtime.counts.looking_away : null,
    fatigue_signals: configuration.monitor_eye_closure ? runtime.counts.eyes_closed : null,
    face_missing_alerts: configuration.monitor_face_missing ? runtime.counts.face_missing : null,
    session_configuration: configuration,
    posture: configuration.monitor_posture ? metrics.posture || 'Unknown' : 'Not monitored',
    pose_detected: configuration.monitor_posture ? Boolean(metrics.pose_detected) : null,
    pose_detection_status: configuration.monitor_posture ? metrics.pose_detection_status ||
      (metrics.pose_detected ? 'detected' : 'checking') : 'not-monitored',
    posture_alert_pending: runtime.postureAlertPending,
    distance_status: configuration.monitor_distance ? metrics.distance_status || 'Unknown' : 'Not monitored',
    face_detected: configuration.monitor_face_missing || configuration.monitor_looking_away
      || configuration.monitor_eye_closure || configuration.monitor_distance
      || configuration.show_detection_overlay ? metrics.face_detected ?? null : null,
    eyes_closed: configuration.monitor_eye_closure ? Boolean(metrics.eyes_closed) : null,
    looking_away: configuration.monitor_looking_away ? Boolean(metrics.looking_away) : null,
    status: metrics.status || 'Starting',
    last_updated: new Date(now).toISOString(),
  });
  for (const key of ['ear', 'head_turn_ratio', 'posture_angle', 'shoulder_tilt_angle', 'distance_ratio', 'thresholds']) {
    delete live[key];
  }
  if (now - runtime.lastHistoryAt >= 5000) {
    live.history = [...(live.history || []), {
      minute: Math.round(sessionSeconds / 60 * 100) / 100,
      posture_alerts: configuration.monitor_posture ? runtime.counts.slouching : null,
      distance_alerts: configuration.monitor_distance ? runtime.counts.distance_alert : null,
      looking_away_alerts: configuration.monitor_looking_away ? runtime.counts.looking_away : null,
      fatigue_signals: configuration.monitor_eye_closure ? runtime.counts.eyes_closed : null,
      face_missing_alerts: configuration.monitor_face_missing ? runtime.counts.face_missing : null,
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
    const profile = existing ? readProfile(username) : freshProfile(username, name);
    updateDailyQuests(profile, readLive(username));
    writeProfile(username, profile);
    return { profile, live: readLive(username), existing };
  }

  const username = requireUsername(url);
  if (url.pathname === '/api/state' && method === 'GET') {
    const profile = readProfile(username);
    const live = readLive(username);
    updateDailyQuests(profile, live);
    writeProfile(username, profile);
    return { profile, live };
  }
  if (url.pathname === '/api/state' && method === 'PUT') {
    if (!body.profile || typeof body.profile !== 'object') throw new Error('Profile data is required.');
    const profile = { ...readProfile(username), ...body.profile, username };
    updateDailyQuests(profile, readLive(username));
    writeProfile(username, profile);
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
    updateDailyQuests(profile, readLive(username));
    return { ok: true, profile: writeProfile(username, profile) };
  }
  if (url.pathname === '/api/quests/claim' && method === 'POST') {
    const profile = readProfile(username);
    updateDailyQuests(profile, readLive(username));
    const quest = profile.daily_quests.quests.find((item) => item.id === body.quest_id);
    if (!quest) throw new Error('This quest is not part of today’s set.');
    if (!quest.completed || !quest.rewardClaimed) throw new Error('Complete this quest using recorded study activity to earn its reward.');
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
    const configuration = normalizeDetectionConfiguration(
      body.session_configuration || profile.session_preferences,
    );
    profile.active_session_plan = {
      subject: String(body.subject || 'Other').slice(0, 40),
      goal: String(body.goal || '').slice(0, 200),
      detection_configuration: configuration,
    };
    if (body.mood) profile.session_wellbeing = { ...profile.session_wellbeing, mood: String(body.mood), mood_checkin_date: today(), mood_updated_at: new Date(now).toISOString() };
    writeProfile(username, profile);
    const live = writeLive(username, { session_active: true, session_completed: false, session_id: sessionId, session_started_at: new Date(now).toISOString(), session_seconds: 0, posture_alerts: configuration.monitor_posture ? 0 : null, distance_alerts: configuration.monitor_distance ? 0 : null, looking_away_alerts: configuration.monitor_looking_away ? 0 : null, fatigue_signals: configuration.monitor_eye_closure ? 0 : null, face_missing_alerts: configuration.monitor_face_missing ? 0 : null, session_configuration: configuration, history: [], status: 'Waiting for camera signals', posture: configuration.monitor_posture ? 'Unknown' : 'Not monitored', pose_detected: configuration.monitor_posture ? false : null, pose_detection_status: configuration.monitor_posture ? 'checking' : 'not-monitored', distance_status: configuration.monitor_distance ? 'Unknown' : 'Not monitored', face_detected: configuration.monitor_face_missing || configuration.monitor_looking_away || configuration.monitor_eye_closure || configuration.monitor_distance || configuration.show_detection_overlay ? false : null });
    cameraSessions.set(username, { startedAt: now, lastFrameAt: now, lastHistoryAt: now, postureAlertAt: 0, postureAlerted: false, postureAlertPending: false, sessionConfiguration: configuration, postureReminderEnabled: configuration.posture_reminders, signalStarts: {}, counts: { eyes_closed: 0, face_missing: 0, slouching: 0, distance_alert: 0, looking_away: 0 }, durations: { eyes_closed: 0, face_missing: 0, slouching: 0, distance_alert: 0, looking_away: 0 } });
    return { ok: true, message: 'Your study session has started.', live };
  }
  if (url.pathname === '/api/camera/telemetry' && method === 'POST') return applyTelemetry(username, body);
  if (url.pathname === '/api/webcam/stop' && method === 'POST') return finishCameraSession(username);
  throw new Error('This feature is not available in the browser-only deployment.');
}