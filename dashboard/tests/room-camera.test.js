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
  }
});

test('room camera processing has no FocusMate network or room-payload path', async () => {
  const source = await readFile(new URL('../src/RoomCameraMonitor.jsx', import.meta.url), 'utf8');
  assert.match(source, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(source, /getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.doesNotMatch(source, /\/api\/webcam\/start|fetch\(|\bapi\(|supabase|presence\.track|rpc\(/);
});
