import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  elapsedParticipantFocusSeconds,
  elapsedRoomFocusSeconds,
  remainingRoomFocusSeconds,
  roomTimerStateFromSnapshot,
} from '../src/room-timer-sync.js';

test('room timer restores the shared start and duration from the server snapshot', () => {
  const state = roomTimerStateFromSnapshot({
    id: 'room-id',
    status: 'focusing',
    session_started_at: '2026-10-11T10:00:00.000Z',
    session_duration_seconds: 1500,
    elapsed_seconds: 120,
    active_segment_started_at: '2026-10-11T10:02:00.000Z',
    server_now: '2026-10-11T10:02:05.000Z',
  }, null, 500);

  assert.equal(state.roomId, 'room-id');
  assert.equal(state.sessionStartedAt, '2026-10-11T10:00:00.000Z');
  assert.equal(elapsedRoomFocusSeconds(state, 1500), 126);
  assert.equal(remainingRoomFocusSeconds(state, 1500), 1374);
});

test('paused and break snapshots retain remaining time without restarting the session', () => {
  const state = roomTimerStateFromSnapshot({
    id: 'room-id',
    status: 'break',
    session_started_at: '2026-10-11T10:00:00.000Z',
    session_duration_seconds: 3600,
    elapsed_seconds: 900,
    active_segment_started_at: null,
    server_now: '2026-10-11T10:20:00.000Z',
  }, null, 500);

  assert.equal(elapsedRoomFocusSeconds(state, 1500), 900);
  assert.equal(remainingRoomFocusSeconds(state, 1500), 2700);
  assert.equal(roomTimerStateFromSnapshot({
    id: state.roomId,
    status: 'waiting',
    server_now: new Date(state.serverNow).toISOString(),
    session_duration_seconds: state.durationSeconds,
    elapsed_seconds: state.elapsedSeconds,
  }), null);
});

test('late joins use the current active segment while server completion excludes pre-join time', async () => {
  const lateJoin = roomTimerStateFromSnapshot({
    id: 'room-id',
    status: 'focusing',
    session_started_at: '2026-10-11T10:00:00.000Z',
    session_duration_seconds: 3600,
    elapsed_seconds: 300,
    active_segment_started_at: '2026-10-11T10:05:00.000Z',
    server_now: '2026-10-11T10:05:15.000Z',
    participants: [{
      user_id: 'late-user',
      focused_seconds: 0,
      focus_segment_started_at: '2026-10-11T10:05:10.000Z',
    }],
  }, 'late-user', 500);
  assert.equal(remainingRoomFocusSeconds(lateJoin, 1500), 3284);
  assert.equal(elapsedParticipantFocusSeconds(lateJoin, 1500), 6);

  const migration = await readFile(
    new URL('../../supabase/migrations/20261012130000_room_late_join.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /target_room\.state not in \('waiting', 'focusing', 'paused', 'break'\)/i);
  assert.match(migration, /greatest\(target_room\.active_segment_started_at, member_joined_at\)/i);
  assert.match(migration, /'focused_seconds'[\s\S]*?private\.focusmate_verified_focus_segments/i);
  assert.match(migration, /'focus_segment_started_at'[\s\S]*?segment\.ended_at is null/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.match(migration, /grant execute on function public\.join_focus_room\(text\) to authenticated/i);
});
