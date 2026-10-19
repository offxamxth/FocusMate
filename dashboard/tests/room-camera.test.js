import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { supportedLanguages, translate } from '../src/i18n.js';
import { roomCameraEligibility } from '../src/room-camera.js';

const enabledPreferences = {
  focus_monitoring: true,
  monitor_looking_away: true,
  monitor_posture: true,
};

test('room camera requires an active focus, visible room page, and enabled preferences', () => {
  assert.equal(roomCameraEligibility({
    roomStatus: 'focusing',
    pageActive: true,
    preferences: enabledPreferences,
  }), true);

  for (const input of [
    { roomStatus: 'paused', pageActive: true, preferences: enabledPreferences },
    { roomStatus: 'break', pageActive: true, preferences: enabledPreferences },
    { roomStatus: 'focusing', pageActive: false, preferences: enabledPreferences },
    { roomStatus: 'focusing', pageActive: true, preferences: { ...enabledPreferences, focus_monitoring: false } },
    {
      roomStatus: 'focusing',
      pageActive: true,
      preferences: {
        focus_monitoring: true,
        monitor_looking_away: false,
        monitor_posture: false,
        monitor_eye_closure: false,
        monitor_face_missing: false,
        monitor_distance: false,
        show_detection_overlay: false,
      },
    },
  ]) {
    assert.equal(roomCameraEligibility(input), false);
  }
});

test('room camera privacy and error messages are localized in every supported language', () => {
  for (const language of supportedLanguages) {
    for (const key of ['privacy', 'permissionDenied', 'disabledInSettings', 'analysisUnavailable']) {
      assert.notEqual(translate(language, `room.camera.${key}`), `room.camera.${key}`);
      if (language !== 'en') {
        assert.notEqual(translate(language, `room.camera.${key}`), translate('en', `room.camera.${key}`));
      }
    }
    for (const key of [
      'title',
      'privacy',
      'connect',
      'connecting',
      'reconnecting',
      'connected',
      'disconnected',
      'leave',
      'cameraOn',
      'cameraOffButton',
      'microphoneOn',
      'microphoneOffButton',
      'microphoneOff',
      'cameraOff',
      'waitingForVideo',
      'yourPreview',
      'participantPreview',
      'unknownParticipant',
      'you',
      'notConnected',
      'enableSpeaker',
      'sessionFinished',
      'openRoomPage',
      'notConfigured',
      'membershipRequired',
      'signInAgain',
      'unavailable',
      'mediaUnavailable',
      'permissionDenied',
      'deviceMissing',
      'deviceInUse',
      'connectFirst',
      'connectionFailed',
    ]) {
      assert.notEqual(translate(language, `room.video.${key}`), `room.video.${key}`);
      if (language !== 'en') {
        assert.notEqual(translate(language, `room.video.${key}`), translate('en', `room.video.${key}`));
      }
    }
  }
});

test('room camera analysis consumes the shared local stream and has no network or signaling path', async () => {
  const source = await readFile(new URL('../src/RoomCameraMonitor.jsx', import.meta.url), 'utf8');
  assert.match(source, /stream,/);
  assert.match(source, /video\.srcObject = stream \|\| null/);
  assert.doesNotMatch(source, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.doesNotMatch(source, /\/api\/webcam\/start|fetch\(|\bapi\(|supabase|presence\.track|rpc\(/);
});

test('Focus page starts its camera from Start Focus and keeps the existing preview markup', async () => {
  const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(source, /void onStartCamera\(plan\)/);
  assert.doesNotMatch(source, /onClick=\{\(\) => void onStartCamera/);
  assert.match(source, /className="camera-preview"/);
  assert.match(source, /className="camera-placeholder"/);
  assert.match(source, /t\('workingOn'\).*Mathematics/s);
  assert.match(source, /t\('sessionGoal'\).*t\('feeling'\)/s);
});

test('restored focus timers complete their persisted active session after reload', async () => {
  const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!started && !live\.session_active && !sessionId\) \{[\s\S]*?throw new Error\('The focus session could not be started for saving/);
  assert.match(source, /return onStopSession\(\{ completed, sessionId \}\)/);
  assert.match(source, /sessionLifecyclePromiseRef\.current = Promise\.resolve\(onBeginSession\(plan\)\)/);
});
