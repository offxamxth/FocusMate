import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { supportedLanguages, translate } from '../src/i18n.js';

test('shared Focus Rooms are disabled while individual focus sessions remain mounted', async () => {
  const app = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(app, /const sharedFocusRoomsAvailable = false;/);
  assert.match(app, /sharedFocusRoomsAvailable \? \([\s\S]*?<RoomFoundation account=\{account\} language=\{language\} \/>/);
  assert.match(app, /<FocusRoom profile=\{profile\} live=\{live\}/);
});

test('shared-room launch notice is translated for all supported languages', () => {
  for (const language of supportedLanguages) {
    assert.notEqual(translate(language, 'room.launchUnavailable'), 'room.launchUnavailable');
  }
});
