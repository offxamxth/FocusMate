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
const { detectMetrics } = await import('../src/vision.js');

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

  const hydrationClaim = await post('/api/quests/claim?username=testuser1', { quest_id: 'hydration' });
  assert.equal(hydrationClaim.profile.total_xp, 525);
  assert.equal(hydrationClaim.profile.schema_version, 1);
  assert.equal(hydrationClaim.profile.achievements.filter((item) => item.id === 'old-achievement').length, 1);
  assert.ok(hydrationClaim.profile.achievements.some((item) => item.id === 'xp_collector'));
  assert.equal(levelForXp(hydrationClaim.profile.total_xp), 6);
  assert.equal(JSON.parse(values.get('focusmate-profile:testuser1')).schema_version, 1);

  await post('/api/login', { username: 'testuser2', name: 'Second User' });
  await api('/api/state?username=testuser2', {
    method: 'PUT',
    body: JSON.stringify({ profile: { total_xp: 75, achievements: [{ id: 'second-user-award' }] } }),
  });
  const firstAgain = await post('/api/login', { username: 'TESTUSER1', name: 'Replacement Name' });
  assert.equal(firstAgain.existing, true);
  assert.equal(firstAgain.profile.total_xp, 525);
  assert.equal(firstAgain.profile.player_name, 'First User');
  assert.equal(firstAgain.profile.session_history[0].session_id, 'kept-session');
  assert.ok(firstAgain.profile.achievements.some((item) => item.id === 'xp_collector'));
  assert.equal(levelForXp(firstAgain.profile.total_xp), 6);

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
    assert.equal(
      signedInAgain.profile.total_xp,
      stopped.live.focus_challenge_xp + signedInAgain.profile.achievements.reduce((total, item) => total + item.xp, 0),
    );
    assert.equal(levelForXp(signedInAgain.profile.total_xp), Math.floor(signedInAgain.profile.total_xp / 100) + 1);
  } finally {
    Date.now = originalNow;
  }
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
    pose: { detectForVideo: () => ({ poseLandmarks: currentPose ? [currentPose] : [] }) },
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

test('temporary shoulder landmark loss is smoothed and genuine loss is reported after three frames', () => {
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
  const sustainedMiss = detectMetrics(detectors, video, 5);
  assert.equal(sustainedMiss.pose_detected, false);
  assert.equal(sustainedMiss.pose_detection_status, 'missing');
  assert.equal(sustainedMiss.status, 'Reframe to include shoulders');

  detectors.setPose(detectors.points);
  assert.equal(detectMetrics(detectors, video, 6).pose_detection_status, 'missing');
  assert.equal(detectMetrics(detectors, video, 7).pose_detection_status, 'detected');
});

test('transient shoulder loss does not clear an active posture alert', () => {
  const detectors = visionFixture({ shoulderTilt: 24, earVisibility: 0.9 });
  detectMetrics(detectors, video, 1);
  assert.equal(detectMetrics(detectors, video, 2).status, 'Reframe to align shoulders');
  const missingShoulders = detectors.points.map((point) => ({ ...point }));
  missingShoulders[11].presence = 0.1;
  missingShoulders[12].presence = 0.1;
  detectors.setPose(missingShoulders);
  assert.equal(detectMetrics(detectors, video, 3).status, 'Shoulders temporarily not detected');
  assert.equal(detectMetrics(detectors, video, 4).status, 'Shoulders temporarily not detected');
  assert.equal(detectMetrics(detectors, video, 5).status, 'Reframe to include shoulders');
  detectors.setPose(detectors.points);
  detectMetrics(detectors, video, 6);
  assert.equal(detectMetrics(detectors, video, 7).status, 'Reframe to align shoulders');
});

test('shoulders are checked before warning and confidence and frame bounds are respected', () => {
  const detectors = visionFixture({ shoulderVisibility: 0.4, shoulderPresence: 0.4 });
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
  assert.equal(detectMetrics(detectors, video, 5).pose_detected, false);
});
