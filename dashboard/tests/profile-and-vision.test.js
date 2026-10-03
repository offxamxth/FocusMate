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

const { api } = await import('../src/local-api.js');
const { detectMetrics } = await import('../src/vision.js');

function post(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

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

function visionFixture({ shoulderTilt = 8, shoulderSpan = 0.2, earVisibility = 0.1 } = {}) {
  const points = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9, presence: 0.9 }));
  const rise = Math.tan((shoulderTilt * Math.PI) / 180) * shoulderSpan * 640 / 480;
  const leftX = 0.5 - shoulderSpan / 2;
  const rightX = 0.5 + shoulderSpan / 2;
  points[11] = { x: leftX, y: 0.5, visibility: 0.9, presence: 0.9 };
  points[12] = { x: rightX, y: 0.5 + rise, visibility: 0.9, presence: 0.9 };
  points[7] = { x: leftX, y: 0.3, visibility: earVisibility, presence: earVisibility };
  points[8] = { x: rightX, y: 0.3 + rise, visibility: earVisibility, presence: earVisibility };
  const face = Array.from({ length: 455 }, () => ({ x: 0.5, y: 0.5 }));
  face[234] = { x: 0.4, y: 0.5 };
  face[454] = { x: 0.6, y: 0.5 };
  return {
    face: { detectForVideo: () => ({ faceLandmarks: [face] }) },
    pose: { detectForVideo: () => ({ poseLandmarks: [points] }) },
  };
}

const video = { videoWidth: 640, videoHeight: 480 };

test('visible shoulders are not reported out of frame when ear landmarks are uncertain', () => {
  const detectors = visionFixture();
  const metrics = detectMetrics(detectors, video, 1);
  assert.equal(metrics.pose_detected, true);
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
