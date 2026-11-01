import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('shared Focus Rooms and individual focus sessions remain mounted', async () => {
  const app = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(app, /<RoomFoundation account=\{account\} language=\{language\} \/>/);
  assert.doesNotMatch(app, /sharedFocusRoomsAvailable/);
  assert.match(app, /<FocusRoom profile=\{profile\} live=\{live\}/);
});

test('daily quest rerolls remain connected to local and cloud handlers', async () => {
  const app = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(app, /onReroll=\{account \? rerollQuest : null\}/);
  assert.match(app, /rerollFocusmateDailyQuest/);
  assert.match(app, /rerollFocusmateRoomQuest/);
});
