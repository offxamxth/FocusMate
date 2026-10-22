import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getFocusRoomVideoToken } from '../src/room-video-api.js';

const roomId = 'c8c3877e-7c4d-4cf0-bdb7-7f04f4dd83de';

test('video tokens are requested through the authenticated function without client-supplied identity', async () => {
  const calls = [];
  const expected = { url: 'wss://video.example.test', token: 'ephemeral-token' };
  const client = {
    functions: {
      async invoke(...args) {
        calls.push(args);
        return { data: expected, error: null };
      },
    },
  };

  assert.deepEqual(await getFocusRoomVideoToken(client, roomId), expected);
  assert.deepEqual(calls, [[
    'focus-room-video-token',
    { body: { room_id: roomId } },
  ]]);
});

test('video token requests reject invalid room identifiers before calling the function', async () => {
  let called = false;
  const client = { functions: { async invoke() { called = true; return { data: {}, error: null }; } } };
  await assert.rejects(getFocusRoomVideoToken(client, 'not-a-room'), (error) => {
    assert.equal(error.code, 'VIDEO_REQUEST_INVALID');
    return true;
  });
  assert.equal(called, false);
});

test('video token failures are normalized without surfacing provider response details', async () => {
  const cases = [
    [{ data: null, error: new Error('secret provider detail') }, 'VIDEO_PROVIDER_UNAVAILABLE'],
    [{ data: { error: 'VIDEO_PROVIDER_NOT_CONFIGURED' }, error: null }, 'VIDEO_PROVIDER_NOT_CONFIGURED'],
    [{ data: { error: 'ROOM_MEMBERSHIP_REQUIRED' }, error: null }, 'ROOM_MEMBERSHIP_REQUIRED'],
    [{ data: { url: 'https://invalid.test', token: 'secret-token' }, error: null }, 'VIDEO_PROVIDER_UNAVAILABLE'],
  ];
  for (const [result, code] of cases) {
    const client = { functions: { async invoke() { return result; } } };
    await assert.rejects(getFocusRoomVideoToken(client, roomId), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /secret provider detail|secret-token/);
      return true;
    });
  }
});

test('video token issuer derives identity from auth and grants only active room media access', async () => {
  const source = await readFile(
    new URL('../../supabase/functions/focus-room-video-token/index.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /auth\.getUser\(bearerToken\)/);
  assert.match(source, /\.eq\("user_id", user\.id\)[\s\S]*?\.is\("left_at", null\)/);
  assert.match(source, /\.eq\("id", roomId\)[\s\S]*?\.in\("state", allowedRoomStates\)/);
  assert.match(source, /allowedRoomStates = \["waiting", "focusing", "paused", "break"\]/);
  assert.match(source, /identity: user\.id/);
  assert.match(source, /ttl: "15m"/);
  assert.match(source, /canPublishSources: \["camera", "microphone"\]/);
  assert.match(source, /canPublishData: false/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|roomAdmin:\s*true|roomCreate:\s*true/);
});

test('Focus Room omits video UI while keeping participant and session controls', async () => {
  const [roomSource, appSource] = await Promise.all([
    readFile(new URL('../src/RoomFoundation.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.jsx', import.meta.url), 'utf8'),
  ]);
  const renderedRoom = roomSource.slice(roomSource.indexOf('return ('), roomSource.length);
  const focusRoomPage = appSource.match(
    /<div hidden=\{page !== 'focus-room'\}[\s\S]*?<\/div>\s*\{page === 'insights'/,
  )?.[0];
  assert.ok(focusRoomPage);
  assert.doesNotMatch(roomSource, /RoomVideoConference|RoomCameraMonitor|roomVideoStream/);
  assert.doesNotMatch(renderedRoom, /room-video|room-camera|<video|Connect video|Turn camera on|Turn microphone on/);
  assert.doesNotMatch(focusRoomPage, /RoomDailyQuests|room-daily-quests|verifiedRoomQuests|verifiedXpBalance/);
  assert.match(renderedRoom, /className="room-participant-list"/);
  assert.match(renderedRoom, /className="room-session"/);
  assert.match(renderedRoom, /className="room-session-clock"/);
  assert.match(renderedRoom, /t\('create'\)/);
  assert.match(renderedRoom, /t\('join'\)/);
});
