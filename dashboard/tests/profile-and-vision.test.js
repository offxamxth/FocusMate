import assert from 'node:assert/strict';
import { test } from 'node:test';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
globalThis.window = { location: { origin: 'http://localhost' } };

const { api, levelForXp } = await import('../src/local-api.js');
const {
  dailyFocusSeconds,
  generateDailyQuests,
  localDateKey,
  refreshDailyQuests,
  studyStreak,
} = await import('../src/progress-data.js');
const { browserLanguage, textDirection, translate } = await import('../src/i18n.js');
const { achievementProgress, awardEligibleAchievements } = await import('../src/achievement-data.js');
const { detectMetrics } = await import('../src/vision.js');
const {
  defaultDetectionConfiguration,
  isDetectionOverlayEnabled,
  isDetectionSignalMonitored,
  normalizeDetectionConfiguration,
  visionTasksForConfiguration,
} = await import('../src/session-detection.js');

function post(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

test('levels are derived consistently from normalized XP', () => {
  assert.equal(levelForXp(-10), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(199), 2);
  assert.equal(levelForXp(200), 3);
});

test('username lookup and sign-in are case-insensitive and preserve existing profile data', async () => {
  values.clear();
  const created = await post('/api/login', { username: 'Alex', name: 'Alex One' });
  assert.equal(created.existing, false);
  const saved = await api('/api/state?username=alex', {
    method: 'PUT',
    body: JSON.stringify({ profile: { total_xp: 420, player_name: 'Alex One', achievements: ['first-session'] } }),
  });
  assert.equal(saved.profile.total_xp, 420);

  const lookup = await api('/api/username?username=%40ALEX');
  assert.deepEqual(lookup, { valid: true, exists: true });
  const signedIn = await post('/api/login', { username: 'aLeX', name: 'Someone Else' });
  assert.equal(signedIn.existing, true);
  assert.equal(signedIn.profile.player_name, 'Alex One');
  assert.equal(signedIn.profile.total_xp, 420);
  assert.deepEqual(signedIn.profile.achievements, ['first-session']);
});

test('a new username requires a name and invalid usernames cannot create profiles', async () => {
  values.clear();
  await assert.rejects(post('/api/login', { username: 'new.user' }), /Enter your name/);
  await assert.rejects(post('/api/login', { username: 'not valid', name: 'Nope' }), /Enter a username/);
  assert.equal((await api('/api/username?username=not%20valid')).valid, false);
  assert.equal(values.size, 0);
});

test('a legacy profile key with different casing cannot be registered as a new profile', async () => {
  values.clear();
  values.set('focusmate-profile:ExistingCase', JSON.stringify({ username: 'ExistingCase', player_name: 'Kept Profile', total_xp: 90 }));
  assert.deepEqual(await api('/api/username?username=existingcase'), { valid: true, exists: true });
  const signedIn = await post('/api/login', { username: 'existingcase', name: 'Replacement' });
  assert.equal(signedIn.existing, true);
  assert.equal(signedIn.profile.player_name, 'Kept Profile');
  assert.equal(signedIn.profile.total_xp, 90);
});

test('malformed profile data is preserved and reported instead of replaced with defaults', async () => {
  values.clear();
  const rawProfile = '{"player_name":';
  values.set('focusmate-profile:brokenprofile', rawProfile);

  await assert.rejects(
    api('/api/state?username=brokenprofile'),
    /original data was left untouched/,
  );
  assert.equal(values.get('focusmate-profile:brokenprofile'), rawProfile);
});

test('personalization preferences persist independently for each profile', async () => {
  values.clear();
  await post('/api/login', { username: 'settingsone', name: 'Settings One' });
  await api('/api/state?username=settingsone', {
    method: 'PUT',
    body: JSON.stringify({
      profile: {
        session_preferences: {
          theme: 'light',
          study_style: 'quiet',
          study_goal_type: 'coding',
          time_format: '24-hour',
        },
      },
    }),
  });
  await post('/api/login', { username: 'settingstwo', name: 'Settings Two' });

  const firstAgain = await post('/api/login', { username: 'settingsone', name: 'Ignored' });
  const second = await api('/api/state?username=settingstwo');
  assert.equal(firstAgain.profile.session_preferences.theme, 'light');
  assert.equal(firstAgain.profile.session_preferences.study_style, 'quiet');
  assert.equal(firstAgain.profile.session_preferences.study_goal_type, 'coding');
  assert.equal(firstAgain.profile.session_preferences.time_format, '24-hour');
  assert.equal(second.profile.session_preferences.theme, 'system');
  assert.equal(second.profile.session_preferences.study_style, 'normal');
});

test('a camera session left active by a reload is interrupted without creating a false completed session', async () => {
  values.clear();
  await post('/api/login', { username: 'reloadcamera', name: 'Reload Camera' });
  await api('/api/webcam/start?username=reloadcamera', {
    method: 'POST',
    body: JSON.stringify({ subject: 'Coding', goal: 'Keep the session safe' }),
  });

  const reloadedApi = await import(`../src/local-api.js?reload=${Date.now()}`);
  const restored = await reloadedApi.api('/api/state?username=reloadcamera');
  assert.equal(restored.live.session_active, false);
  assert.equal(restored.live.session_interrupted, true);
  assert.equal(restored.live.session_completed, false);
  assert.equal(restored.profile.session_history.length, 0);
  assert.match(restored.live.status, /interrupted after reload/);
});

test('XP, levels, sessions, and achievements persist per username across sign-ins', async () => {
  values.clear();
  await post('/api/login', { username: 'testuser1', name: 'First User' });
  const legacyProfile = {
    total_xp: '490',
    sessions_completed: 3,
    session_history: [{ session_id: 'kept-session', seconds: 600 }],
    achievements: [
      { id: 'old-achievement', title: 'Kept achievement', xp: 10 },
      { id: 'old-achievement', title: 'Duplicate achievement', xp: 10 },
    ],
  };
  await api('/api/state?username=testuser1', {
    method: 'PUT',
    body: JSON.stringify({ profile: legacyProfile }),
  });
  await api('/api/state?username=testuser1', {
    method: 'PUT',
    body: JSON.stringify({ profile: { player_name: 'First User' } }),
  });

  const migrated = (await api('/api/state?username=testuser1')).profile;
  assert.equal(migrated.total_xp, 490);
  assert.equal(migrated.schema_version, 3);
  assert.equal(migrated.achievements.filter((item) => item.id === 'old-achievement').length, 1);
  assert.equal(migrated.daily_quests.quests.length, 4);
  assert.equal(levelForXp(migrated.total_xp), 5);
  assert.equal(JSON.parse(values.get('focusmate-profile:testuser1')).schema_version, 3);

  await post('/api/login', { username: 'testuser2', name: 'Second User' });
  await api('/api/state?username=testuser2', {
    method: 'PUT',
    body: JSON.stringify({ profile: { total_xp: 75, achievements: [{ id: 'second-user-award' }] } }),
  });
  const firstAgain = await post('/api/login', { username: 'TESTUSER1', name: 'Replacement Name' });
  assert.equal(firstAgain.existing, true);
  assert.equal(firstAgain.profile.total_xp, 490);
  assert.equal(firstAgain.profile.player_name, 'First User');
  assert.equal(firstAgain.profile.session_history[0].session_id, 'kept-session');
  assert.ok(firstAgain.profile.achievements.some((item) => item.id === 'old-achievement'));
  assert.equal(levelForXp(firstAgain.profile.total_xp), 5);

  const secondAgain = await post('/api/login', { username: 'testuser2', name: 'Replacement Name' });
  assert.equal(secondAgain.profile.total_xp, 75);
  assert.deepEqual(secondAgain.profile.achievements.map((item) => item.id), ['second-user-award']);
  assert.equal(levelForXp(secondAgain.profile.total_xp), 1);
});

test('finishing a camera session saves session history, XP, and awards together', async () => {
  values.clear();
  await post('/api/login', { username: 'sessionuser', name: 'Session User' });
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    await api('/api/webcam/start?username=sessionuser', {
      method: 'POST',
      body: JSON.stringify({ subject: 'Coding', goal: 'Finish a feature' }),
    });
    now += 10 * 60 * 1000;
    const stopped = await post('/api/webcam/stop?username=sessionuser', {});
    const signedInAgain = await post('/api/login', { username: 'sessionuser', name: 'Ignored' });
    assert.equal(signedInAgain.profile.sessions_completed, 1);
    assert.equal(signedInAgain.profile.session_history.length, 1);
    assert.ok(signedInAgain.profile.total_xp >= 25);
    assert.ok(signedInAgain.profile.achievements.length > 0);
    const sessionXp = signedInAgain.profile.session_history[0].focus_challenge_xp;
    const questXp = signedInAgain.profile.daily_quest_claims.reduce((total, claim) => total + claim.xp, 0);
    const achievementXp = signedInAgain.profile.achievements.reduce((total, achievement) => total + achievement.xp, 0);
    assert.equal(signedInAgain.profile.total_xp, sessionXp + achievementXp + questXp);
    assert.equal(levelForXp(signedInAgain.profile.total_xp), Math.floor(signedInAgain.profile.total_xp / 100) + 1);
  } finally {
    Date.now = originalNow;
  }
});

test('daily quests are four distinct stable, category-balanced local-day challenges', async () => {
  values.clear();
  const first = await post('/api/login', { username: 'questuser', name: 'Quest User' });
  const today = localDateKey();
  const quests = first.profile.daily_quests.quests;
  assert.equal(first.profile.daily_quests.date, today);
  assert.equal(quests.length, 4);
  assert.equal(new Set(quests.map((quest) => quest.id)).size, 4);
  assert.equal(new Set(quests.map((quest) => quest.category)).size, 4);
  const before = quests.map((quest) => quest.id);

  const afterRefresh = (await api('/api/state?username=questuser')).profile.daily_quests;
  const afterSignIn = (await post('/api/login', { username: 'QUESTUSER', name: 'Ignored' })).profile.daily_quests;
  assert.deepEqual(afterRefresh.quests.map((quest) => quest.id), before);
  assert.deepEqual(afterSignIn.quests.map((quest) => quest.id), before);
});

test('daily quest rewards are based on actual timer data and are awarded once', async () => {
  values.clear();
  const initial = await post('/api/login', { username: 'questreward', name: 'Quest Reward' });
  const focusQuest = initial.profile.daily_quests.quests.find((quest) => quest.category === 'focus_time');
  const otherQuestIds = initial.profile.daily_quests.quests.filter((quest) => quest.id !== focusQuest.id).map((quest) => quest.id);
  const startingXp = initial.profile.total_xp;
  const seconds = focusQuest.target * 60;

  const credit = await post('/api/timer/credit?username=questreward', { seconds });
  const earned = credit.profile.daily_quests.quests.find((quest) => quest.id === focusQuest.id);
  assert.equal(earned.completed, true);
  assert.equal(earned.rewardClaimed, true);
  assert.equal(credit.profile.total_xp, startingXp + focusQuest.rewardXP);
  assert.deepEqual(credit.profile.daily_quests.quests.filter((quest) => quest.id !== focusQuest.id).map((quest) => quest.id), otherQuestIds);

  const nextRead = (await api('/api/state?username=questreward')).profile;
  assert.equal(nextRead.total_xp, credit.profile.total_xp);
  assert.equal(nextRead.daily_quest_claims.filter((claim) => claim.quest_id === focusQuest.id && claim.date === localDateKey()).length, 1);
});

test('daily quest rotation changes by local date and avoids repeating the previous full set', () => {
  const previous = generateDailyQuests('rotate-user', '2026-03-10').map((quest) => quest.id);
  const next = generateDailyQuests('rotate-user', '2026-03-11', previous);
  assert.equal(next.length, 4);
  assert.notDeepEqual(next.map((quest) => quest.id), previous);
  assert.notDeepEqual(generateDailyQuests('rotate-user', '2026-03-10').map((quest) => quest.id), next.map((quest) => quest.id));
});

test('camera-alert quests treat disabled session signals as unmonitored, not zero alerts', async () => {
  values.clear();
  const initial = await post('/api/login', { username: 'quest-exclusion', name: 'Quest Exclusion' });
  const date = localDateKey();
  const disabledProfile = JSON.parse(JSON.stringify(initial.profile));
  const disabledQuest = disabledProfile.daily_quests.quests.find((quest) => quest.category === 'camera_alerts');
  disabledQuest.signal = 'posture_alerts';
  disabledProfile.session_history.push({
    date,
    seconds: 1,
    posture_alerts: null,
    detection_configuration: { ...defaultDetectionConfiguration, monitor_posture: false },
  });
  refreshDailyQuests(disabledProfile, {}, date);
  const disabledAfter = disabledProfile.daily_quests.quests.find((quest) => quest.id === disabledQuest.id);
  assert.equal(disabledAfter.progress, 0);
  assert.equal(disabledAfter.completed, false);
  assert.equal(disabledAfter.rewardClaimed, false);
  assert.equal(disabledProfile.daily_quest_claims.some((claim) => claim.quest_id === disabledQuest.id), false);

  const legacyProfile = JSON.parse(JSON.stringify(initial.profile));
  const legacyQuest = legacyProfile.daily_quests.quests.find((quest) => quest.category === 'camera_alerts');
  legacyQuest.signal = 'posture_alerts';
  legacyProfile.session_history.push({ date, seconds: 1, posture_alerts: 0 });
  refreshDailyQuests(legacyProfile, {}, date);
  const legacyAfter = legacyProfile.daily_quests.quests.find((quest) => quest.id === legacyQuest.id);
  assert.equal(legacyAfter.progress, 1);
  assert.equal(legacyAfter.completed, true);
  assert.equal(legacyAfter.rewardClaimed, true);
});

test('study streak uses recorded local study dates, including timer-only activity', () => {
  const date = new Date(2026, 2, 10, 12);
  const profile = {
    session_history: [{ date: '2026-03-08', seconds: 600 }],
    focus_timer_history: [{ date: '2026-03-09', seconds: 300 }, { date: '2026-03-10', seconds: 1 }],
  };
  assert.equal(studyStreak(profile, date), 3);
  assert.equal(studyStreak({ ...profile, focus_timer_history: [{ date: '2026-03-07', seconds: 300 }] }, date), 0);
  assert.equal(studyStreak({ session_history: [], focus_timer_history: [] }, date, 20), 1);
});

test('malformed saved timer values do not create NaN dashboard statistics', () => {
  const today = localDateKey();
  assert.equal(dailyFocusSeconds({
    focus_timer_date: today,
    focus_timer_seconds_today: 'not-a-number',
    session_history: [{ date: today, seconds: 'bad' }],
  }), 0);
});

test('language selection supports browser fallback and right-to-left Arabic', () => {
  assert.equal(browserLanguage(['fr-CA', 'en-US']), 'fr');
  assert.equal(browserLanguage(['de-DE']), 'en');
  assert.equal(textDirection('ar'), 'rtl');
  assert.equal(textDirection('hi'), 'ltr');
  assert.equal(translate('es', 'quests.focusTitle', { target: 15 }), 'Concéntrate durante 15 minutos');
});

test('detection settings, overlay, and result labels have localized text in every supported language', () => {
  const keys = [
    'preferences.detectionHeading',
    'preferences.lookingAwayMonitoring',
    'preferences.postureMonitoring',
    'preferences.eyeClosureMonitoring',
    'preferences.faceMissingMonitoring',
    'preferences.distanceMonitoring',
    'preferences.detectionOverlaySetting',
    'focus.detectionOverlay',
    'focus.notMonitored',
    'results.signalCounts',
    'results.faceMissing',
    'insights.unmonitoredNote',
  ];
  for (const language of ['en', 'es', 'fr', 'ar', 'hi']) {
    for (const key of keys) {
      assert.notEqual(translate(language, key), key, `${language}:${key}`);
    }
  }
  assert.notEqual(translate('es', 'preferences.postureMonitoring'), translate('en', 'preferences.postureMonitoring'));
  assert.notEqual(translate('fr', 'results.notMonitored'), translate('en', 'results.notMonitored'));
});

test('locked achievements show progress calculated only from saved profile activity', () => {
  const today = localDateKey();
  const profile = {
    total_xp: 420,
    total_study_seconds: 900,
    focus_timer_total_seconds: 300,
    sessions_completed: 2,
    session_history: [
      { date: today, seconds: 600 },
      { date: today, seconds: 300 },
    ],
    focus_timer_history: [],
    session_reflections: [],
    achievements: [],
  };
  assert.deepEqual(achievementProgress(profile, 'getting_started'), {
    current: 2,
    target: 3,
    unit: 'sessions',
  });
  assert.deepEqual(achievementProgress(profile, 'xp_collector'), {
    current: 420,
    target: 500,
    unit: 'XP',
  });
  assert.equal(achievementProgress(profile, 'unknown-achievement'), null);
});

test('legacy string achievements are not awarded a second time', () => {
  const profile = {
    total_xp: 15,
    sessions_completed: 1,
    total_study_seconds: 60,
    session_history: [{ seconds: 60, date: localDateKey() }],
    session_reflections: [],
    focus_timer_history: [],
    achievements: ['first_step'],
  };
  const added = awardEligibleAchievements(profile, { type: 'session' });
  assert.equal(added.some((item) => item.id === 'first_step'), false);
  assert.equal(profile.total_xp >= 15, true);
});

test('legacy sessions default to prior all-enabled monitoring and preserve completion XP', () => {
  const legacy = { seconds: 900, posture_alerts: 0, distance_alerts: 0 };
  for (const signal of ['slouching', 'distance_alert', 'looking_away', 'eyes_closed', 'face_missing']) {
    assert.equal(isDetectionSignalMonitored(legacy, signal), true);
  }
  assert.deepEqual(normalizeDetectionConfiguration(), defaultDetectionConfiguration);
  assert.equal(normalizeDetectionConfiguration({ posture_alerts: false }).posture_reminders, false);
  assert.equal(visionTasksForConfiguration({ ...defaultDetectionConfiguration, monitor_face_missing: false }).face, true);
});

test('all detection exclusions skip both detector tasks, while overlay visibility remains independent', () => {
  const configuration = Object.fromEntries(
    Object.keys(defaultDetectionConfiguration).map((key) => [key, false]),
  );
  let faceCalls = 0;
  let poseCalls = 0;
  const metrics = detectMetrics({
    face: { detectForVideo() { faceCalls += 1; throw new Error('face detector should be skipped'); } },
    pose: { detectForVideo() { poseCalls += 1; throw new Error('pose detector should be skipped'); } },
  }, video, 1, configuration);
  assert.equal(faceCalls, 0);
  assert.equal(poseCalls, 0);
  assert.equal(metrics.face_detected, null);
  assert.equal(metrics.posture, 'Not monitored');
  assert.equal(visionTasksForConfiguration(configuration).face, false);
  assert.equal(visionTasksForConfiguration(configuration).pose, false);
  assert.equal(isDetectionOverlayEnabled(configuration), false);
  assert.equal(isDetectionOverlayEnabled({ ...configuration, show_detection_overlay: true }), true);
  assert.equal(isDetectionOverlayEnabled({ ...configuration, show_detection_overlay: true }, true), false);
  assert.equal(visionTasksForConfiguration({ ...configuration, show_detection_overlay: true }).face, true);
});

test('each disabled event is suppressed while other enabled event counts and the session snapshot persist', async () => {
  const originalNow = Date.now;
  let now = 100_000;
  Date.now = () => now;
  const signals = [
    ['monitor_looking_away', 'looking_away_alerts'],
    ['monitor_posture', 'posture_alerts'],
    ['monitor_eye_closure', 'fatigue_signals'],
    ['monitor_face_missing', 'face_missing_alerts'],
    ['monitor_distance', 'distance_alerts'],
  ];
  const metricSet = {
    face_detected: false,
    looking_away: true,
    eyes_closed: true,
    posture: 'Slouching',
    posture_angle: 40,
    pose_detected: true,
    pose_detection_status: 'detected',
    distance_status: 'Too Far',
    ear: 0.1,
  };
  const earnedXp = [];
  const achievementsBySetting = [];
  try {
    for (const [disabledSetting, disabledField] of signals) {
      values.clear();
      const username = 'exclude-signal-test';
      await post('/api/login', { username, name: 'Signal Test' });
      const configuration = { ...defaultDetectionConfiguration, [disabledSetting]: false };
      const started = await post(`/api/webcam/start?username=${username}`, {
        subject: 'Coding',
        goal: 'Test exclusions',
        session_configuration: configuration,
      });
      assert.deepEqual(started.live.session_configuration, configuration);
      assert.deepEqual(
        (await api(`/api/state?username=${username}`)).profile.active_session_plan.detection_configuration,
        configuration,
      );

      await api(`/api/state?username=${username}`, {
        method: 'PUT',
        body: JSON.stringify({
          profile: {
            session_preferences: {
              ...configuration,
              [disabledSetting]: true,
            },
          },
        }),
      });

      now += 1_000;
      await post(`/api/camera/telemetry?username=${username}`, metricSet);
      now += 3_000;
      const telemetry = await post(`/api/camera/telemetry?username=${username}`, {
        ...metricSet,
        face_detected: true,
        looking_away: false,
        eyes_closed: false,
        posture: 'Good',
        distance_status: 'Good',
      });
      const finished = await post(`/api/webcam/stop?username=${username}`, {});
      const fieldBySetting = Object.fromEntries(signals.map(([setting, field]) => [setting, field]));
      assert.equal(telemetry.live.session_configuration[disabledSetting], false);
      assert.equal(telemetry.live[fieldBySetting[disabledSetting]], null);
      for (const [setting, field] of signals) {
        assert.equal(finished.live[field], setting === disabledSetting ? null : 1, `${setting} event count`);
      }
      const history = (await api(`/api/state?username=${username}`)).profile.session_history[0];
      assert.equal(history.detection_configuration[disabledSetting], false);
      assert.equal(history[disabledField], null);
      const savedProfile = (await api(`/api/state?username=${username}`)).profile;
      earnedXp.push(savedProfile.total_xp);
      achievementsBySetting.push(`${disabledSetting}=${savedProfile.achievements.map((item) => item.id).join('|')}`);
    }
    assert.equal(new Set(earnedXp).size, 1, `disabling different signals must not change XP rewards: ${earnedXp.join(', ')}; ${achievementsBySetting.join('; ')}`);
  } finally {
    Date.now = originalNow;
  }
});

test('all optional event signals disabled remain Not monitored and never become zero-event results', async () => {
  values.clear();
  await post('/api/login', { username: 'multiple-exclusions', name: 'Multiple Exclusions' });
  const configuration = {
    ...defaultDetectionConfiguration,
    monitor_looking_away: false,
    monitor_posture: false,
    monitor_eye_closure: false,
    monitor_face_missing: false,
    monitor_distance: false,
  };
  await post('/api/webcam/start?username=multiple-exclusions', {
    session_configuration: configuration,
  });
  const telemetry = await post('/api/camera/telemetry?username=multiple-exclusions', {
    face_detected: false,
    looking_away: true,
    eyes_closed: true,
    posture: 'Slouching',
    distance_status: 'Too Far',
  });
  assert.equal(telemetry.live.posture_alerts, null);
  assert.equal(telemetry.live.fatigue_signals, null);
  assert.equal(telemetry.live.face_missing_alerts, null);
  assert.equal(telemetry.live.distance_alerts, null);
  assert.equal(telemetry.live.looking_away_alerts, null);
  assert.equal(telemetry.live.posture, 'Not monitored');
  await post('/api/webcam/stop?username=multiple-exclusions', {});
});

test('disabled detection signals cannot grant no-alert achievements; legacy records remain eligible', () => {
  const base = {
    total_xp: 0,
    sessions_completed: 1,
    total_study_seconds: 600,
    session_history: [],
    session_reflections: [],
    focus_timer_history: [],
    achievements: [],
  };
  const disabledSession = {
    seconds: 600,
    pose_detected: true,
    face_detected: true,
    posture_alerts: null,
    distance_alerts: null,
    looking_away_alerts: null,
    fatigue_signals: null,
    detection_configuration: {
      ...defaultDetectionConfiguration,
      monitor_posture: false,
      monitor_distance: false,
      monitor_looking_away: false,
      monitor_eye_closure: false,
    },
  };
  const disabledProfile = { ...base, session_history: [disabledSession] };
  assert.deepEqual(achievementProgress(disabledProfile, 'posture_pro'), {
    current: 0,
    target: 1,
    unit: 'sessions without posture alerts',
  });
  assert.equal(awardEligibleAchievements(disabledProfile, { type: 'session', live: disabledSession })
    .some((achievement) => ['posture_pro', 'perfect_distance', 'eyes_forward', 'clean_session'].includes(achievement.id)), false);

  const legacyProfile = { ...base, session_history: [{ ...disabledSession, detection_configuration: undefined, posture_alerts: 0 }] };
  assert.equal(achievementProgress(legacyProfile, 'posture_pro').current, 1);
});

function visionFixture({ shoulderTilt = 8, shoulderSpan = 0.2, earVisibility = 0.1, shoulderVisibility = 0.9, shoulderPresence = 0.9 } = {}) {
  const points = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9, presence: 0.9 }));
  const rise = Math.tan((shoulderTilt * Math.PI) / 180) * shoulderSpan * 640 / 480;
  const leftX = 0.5 - shoulderSpan / 2;
  const rightX = 0.5 + shoulderSpan / 2;
  points[11] = { x: leftX, y: 0.5, visibility: shoulderVisibility, presence: shoulderPresence };
  points[12] = { x: rightX, y: 0.5 + rise, visibility: shoulderVisibility, presence: shoulderPresence };
  points[7] = { x: leftX, y: 0.3, visibility: earVisibility, presence: earVisibility };
  points[8] = { x: rightX, y: 0.3 + rise, visibility: earVisibility, presence: earVisibility };
  const face = Array.from({ length: 455 }, () => ({ x: 0.5, y: 0.5 }));
  face[234] = { x: 0.4, y: 0.5 };
  face[454] = { x: 0.6, y: 0.5 };
  let currentPose = points;
  return {
    face: { detectForVideo: () => ({ faceLandmarks: [face] }) },
    pose: { detectForVideo: () => ({ landmarks: currentPose ? [currentPose] : [] }) },
    setPose(pose) { currentPose = pose; },
    points,
  };
}

const video = { videoWidth: 640, videoHeight: 480 };

test('visible shoulders are not reported out of frame when ear landmarks are uncertain', () => {
  const detectors = visionFixture();
  detectMetrics(detectors, video, 1);
  const metrics = detectMetrics(detectors, video, 2);
  assert.equal(metrics.pose_detected, true);
  assert.equal(metrics.pose_detection_status, 'detected');
  assert.notEqual(metrics.status, 'Reframe to include shoulders');
});

test('small shoulder differences stay within the alignment dead-zone', () => {
  const detectors = visionFixture({ shoulderTilt: 8, earVisibility: 0.9 });
  assert.notEqual(detectMetrics(detectors, video, 1).status, 'Reframe to align shoulders');
  assert.notEqual(detectMetrics(detectors, video, 2).status, 'Reframe to align shoulders');
});

test('a narrow shoulder span from a turned camera angle does not create a tilt alert', () => {
  const detectors = visionFixture({ shoulderTilt: 35, shoulderSpan: 0.06, earVisibility: 0.9 });
  assert.notEqual(detectMetrics(detectors, video, 1).status, 'Reframe to align shoulders');
  assert.notEqual(detectMetrics(detectors, video, 2).status, 'Reframe to align shoulders');
});

test('a sustained, clearly tilted shoulder line is still detected', () => {
  const detectors = visionFixture({ shoulderTilt: 24, earVisibility: 0.9 });
  assert.notEqual(detectMetrics(detectors, video, 1).status, 'Reframe to align shoulders');
  assert.equal(detectMetrics(detectors, video, 2).status, 'Reframe to align shoulders');
});

test('temporary shoulder landmark loss is smoothed and sustained loss is reported after five frames', () => {
  const detectors = visionFixture({ earVisibility: 0.9 });
  detectMetrics(detectors, video, 1);
  const established = detectMetrics(detectors, video, 2);
  assert.equal(established.pose_detected, true);
  assert.notEqual(established.posture, 'Unknown');

  const missingShoulders = detectors.points.map((point) => ({ ...point }));
  missingShoulders[11].visibility = 0.1;
  missingShoulders[12].visibility = 0.1;
  detectors.setPose(missingShoulders);
  const firstMiss = detectMetrics(detectors, video, 3);
  const secondMiss = detectMetrics(detectors, video, 4);
  assert.equal(firstMiss.pose_detected, true);
  assert.equal(secondMiss.pose_detected, true);
  assert.equal(firstMiss.pose_detection_status, 'temporarily-missing');
  assert.equal(firstMiss.status, 'Shoulders temporarily not detected');
  assert.equal(secondMiss.posture, established.posture);
  assert.equal(detectMetrics(detectors, video, 5).pose_detection_status, 'temporarily-missing');
  assert.equal(detectMetrics(detectors, video, 6).pose_detection_status, 'temporarily-missing');
  const sustainedMiss = detectMetrics(detectors, video, 7);
  assert.equal(sustainedMiss.pose_detected, false);
  assert.equal(sustainedMiss.pose_detection_status, 'missing');
  assert.equal(sustainedMiss.status, 'Reframe to include shoulders');

  detectors.setPose(detectors.points);
  assert.equal(detectMetrics(detectors, video, 8).pose_detection_status, 'missing');
  assert.equal(detectMetrics(detectors, video, 9).pose_detection_status, 'detected');
});

test('transient shoulder loss does not clear an active posture alert', () => {
  const detectors = visionFixture({ shoulderTilt: 24, earVisibility: 0.9 });
  detectMetrics(detectors, video, 1);
  assert.equal(detectMetrics(detectors, video, 2).status, 'Reframe to align shoulders');
  const missingShoulders = detectors.points.map((point) => ({ ...point }));
  missingShoulders[11].visibility = 0.1;
  missingShoulders[12].visibility = 0.1;
  detectors.setPose(missingShoulders);
  assert.equal(detectMetrics(detectors, video, 3).status, 'Shoulders temporarily not detected');
  assert.equal(detectMetrics(detectors, video, 4).status, 'Shoulders temporarily not detected');
  assert.equal(detectMetrics(detectors, video, 5).status, 'Shoulders temporarily not detected');
  assert.equal(detectMetrics(detectors, video, 6).status, 'Shoulders temporarily not detected');
  assert.equal(detectMetrics(detectors, video, 7).status, 'Reframe to include shoulders');
  detectors.setPose(detectors.points);
  detectMetrics(detectors, video, 8);
  assert.equal(detectMetrics(detectors, video, 9).status, 'Reframe to align shoulders');
});

test('shoulders are checked before warning and confidence and frame bounds are respected', () => {
  const detectors = visionFixture({ shoulderVisibility: 0.3, shoulderPresence: 0.1 });
  const first = detectMetrics(detectors, video, 1);
  assert.equal(first.pose_detection_status, 'checking');
  assert.equal(first.status, 'Checking for shoulders');
  const second = detectMetrics(detectors, video, 2);
  assert.equal(second.pose_detected, true);

  const outOfFrame = detectors.points.map((point) => ({ ...point }));
  outOfFrame[11].x = -0.01;
  detectors.setPose(outOfFrame);
  assert.equal(detectMetrics(detectors, video, 3).pose_detected, true);
  assert.equal(detectMetrics(detectors, video, 4).pose_detected, true);
  assert.equal(detectMetrics(detectors, video, 5).pose_detected, true);
  assert.equal(detectMetrics(detectors, video, 6).pose_detected, true);
  assert.equal(detectMetrics(detectors, video, 7).pose_detected, false);
});

test('PoseLandmarker landmarks result keeps face and distance detection available', () => {
  const detectors = visionFixture({ earVisibility: 0.9 });
  const first = detectMetrics(detectors, video, 1);
  const second = detectMetrics(detectors, video, 2);
  assert.equal(first.face_detected, true);
  assert.equal(second.pose_detected, true);
  assert.equal(second.pose_detection_status, 'detected');
  assert.equal(second.distance_status, 'Good');
});
