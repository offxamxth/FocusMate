import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createFocusRoom,
  finishFocusRoomSession,
  focusRoomErrorTranslationKey,
  getFocusRoom,
  getMyFocusRoom,
  joinFocusRoom,
  leaveFocusRoom,
  pauseFocusRoomSession,
  resumeFocusRoomSession,
  setFocusRoomReady,
  startFocusRoomBreak,
  startFocusRoomSession,
  subscribeToFocusRoom,
} from '../src/room-api.js';
import { supportedLanguages, translate } from '../src/i18n.js';

function fakeRpcClient(results) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(...args) {
        calls.push(args);
        const result = results.shift();
        return result || { data: null, error: null };
      },
    },
  };
}

test('room API invokes authenticated creation, lookup, and leave RPCs', async () => {
  const room = { id: 'room-id', room_code: 'ABCDEFG2', status: 'waiting', participants: [] };
  const { client, calls } = fakeRpcClient([
    { data: room, error: null },
    { data: room, error: null },
    { data: room, error: null },
    { data: { closed: false }, error: null },
  ]);

  assert.equal(await createFocusRoom(client), room);
  assert.equal(await getMyFocusRoom(client), room);
  assert.equal(await getFocusRoom(client, 'room-id'), room);
  await leaveFocusRoom(client, 'room-id');
  assert.deepEqual(calls, [
    ['create_focus_room', { p_name: 'Study room' }],
    ['get_my_focus_room', {}],
    ['get_focus_room', { p_room_id: 'room-id' }],
    ['leave_focus_room', { p_room_id: 'room-id' }],
  ]);
});

test('room codes are normalized and validated before requesting a join', async () => {
  const { client, calls } = fakeRpcClient([{ data: { id: 'room-id' }, error: null }]);
  await joinFocusRoom(client, '  abcdefg2 ');
  assert.deepEqual(calls, [['join_focus_room', { p_room_code: 'ABCDEFG2' }]]);
  assert.throws(() => joinFocusRoom(client, 'ABC123'), /8-character room code/);
  assert.throws(() => joinFocusRoom(client, 'ABCIJ023'), /8-character room code/);
  assert.equal(calls.length, 1);
});

test('timer API delegates all authoritative transitions to authenticated room RPCs', async () => {
  const room = { id: 'room-id', status: 'focusing' };
  const { client, calls } = fakeRpcClient([
    { data: room, error: null },
    { data: room, error: null },
    { data: room, error: null },
    { data: room, error: null },
    { data: room, error: null },
  ]);

  assert.equal(await startFocusRoomSession(client, 'room-id', 1500), room);
  assert.equal(await pauseFocusRoomSession(client, 'room-id'), room);
  assert.equal(await resumeFocusRoomSession(client, 'room-id'), room);
  assert.equal(await startFocusRoomBreak(client, 'room-id', 300), room);
  assert.equal(await finishFocusRoomSession(client, 'room-id'), room);
  assert.deepEqual(calls, [
    ['start_focus_room_session', { p_room_id: 'room-id', p_duration_seconds: 1500 }],
    ['pause_focus_room_session', { p_room_id: 'room-id' }],
    ['resume_focus_room_session', { p_room_id: 'room-id' }],
    ['start_focus_room_break', { p_room_id: 'room-id', p_break_duration_seconds: 300 }],
    ['finish_focus_room_session', { p_room_id: 'room-id' }],
  ]);
  assert.ok(calls.every(([, args]) => !Object.hasOwn(args, 'user_id')
    && !Object.hasOwn(args, 'started_at')
    && !Object.hasOwn(args, 'elapsed_seconds')
    && !Object.hasOwn(args, 'state')));
});

test('room readiness is updated through the authenticated RPC without caller identity fields', async () => {
  const snapshot = { id: 'room-id', status: 'waiting', participants: [{ user_id: 'user-id', is_ready: true }] };
  const { client, calls } = fakeRpcClient([{ data: snapshot, error: null }]);
  assert.equal(await setFocusRoomReady(client, 'room-id', true), snapshot);
  assert.deepEqual(calls, [[
    'set_focus_room_ready',
    { p_room_id: 'room-id', p_ready: true },
  ]]);
  assert.equal(focusRoomErrorTranslationKey({ code: '55001' }), 'error.notReady');
});

test('expected room-code and membership failures are surfaced to the UI', async () => {
  const { client } = fakeRpcClient([
    { data: { error: 'missing', code: 'P0002' }, error: null },
    { data: null, error: { code: '42501', message: 'not allowed' } },
    { data: { error: 'throttled', code: '42900' }, error: null },
  ]);
  await assert.rejects(joinFocusRoom(client, 'ABCDEFG2'), /No open room/);
  await assert.rejects(getFocusRoom(client, 'room-id'), /not a member/);
  await assert.rejects(joinFocusRoom(client, 'ABCDEFG2'), /Too many room-code attempts/);
});

test('room failures retain safe codes for localized UI and hide internal server details', async () => {
  const { client } = fakeRpcClient([
    { data: null, error: { code: '42501', message: 'private database detail' } },
    { data: null, error: { code: 'P0002', message: 'private database detail' } },
  ]);
  await assert.rejects(getFocusRoom(client, 'room-id'), (error) => {
    assert.equal(error.code, '42501');
    assert.equal(focusRoomErrorTranslationKey(error), 'error.notMember');
    assert.doesNotMatch(error.message, /private database detail/);
    return true;
  });
  await assert.rejects(getMyFocusRoom(client), (error) => {
    assert.equal(error.code, 'P0002');
    assert.equal(focusRoomErrorTranslationKey(error), 'error.notFound');
    return true;
  });
  assert.throws(() => joinFocusRoom(client, 'bad-code'), (error) => {
    assert.equal(focusRoomErrorTranslationKey(error), 'error.invalidCode');
    return true;
  });
  assert.equal(focusRoomErrorTranslationKey(new TypeError('Failed to fetch')), 'error.network');
  assert.equal(focusRoomErrorTranslationKey(new Error('unexpected internal response')), 'genericError');
});

test('room realtime subscriptions always use private membership-scoped channels', async () => {
  const calls = [];
  const channel = {
    on(type, filter, callback) {
      calls.push({ type, filter });
      if (type === 'presence') this.presenceHandler = callback;
      if (type === 'postgres_changes') this.changeHandler = callback;
      return this;
    },
    subscribe(callback) {
      this.subscribeCallback = callback;
      return this;
    },
    async track(payload) {
      this.tracked = payload;
      return 'ok';
    },
    presenceState() {
      return { 'user-a': [{ status: 'online' }] };
    },
  };
  const removed = [];
  const client = {
    channel(topic, options) {
      calls.push({ topic, options });
      return channel;
    },
    async removeChannel(value) { removed.push(value); },
  };
  const updates = { presence: null, connection: [], changed: 0 };
  const stop = subscribeToFocusRoom(
    client,
    { id: 'room-id', participants: [{ user_id: 'user-a' }] },
    'user-a',
    {
      onPresence: (value) => { updates.presence = value; },
      onConnection: (value) => updates.connection.push(value),
      onRoomChange: () => { updates.changed += 1; },
    },
  );

  assert.deepEqual(calls[0], {
    topic: 'focusmate-room:room-id',
    options: { config: { private: true, presence: { key: 'user-a' } } },
  });
  assert.ok(calls.some((call) => call.type === 'postgres_changes'
    && call.filter.table === 'focus_room_members'
    && call.filter.filter === 'room_id=eq.room-id'));
  channel.subscribeCallback('SUBSCRIBED');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(channel.tracked, { status: 'online' });
  assert.deepEqual(updates.presence, { 'user-a': 'online' });
  assert.equal(updates.connection.at(-1), 'online');
  channel.changeHandler();
  assert.equal(updates.changed, 2);
  stop();
  assert.deepEqual(removed, [channel]);
});

test('room realtime retries tracking after reconnect and ignores stale or cleaned-up callbacks', async () => {
  const pendingTracks = [];
  const connections = [];
  let trackCalls = 0;
  const channel = {
    on() { return this; },
    subscribe(callback) { this.subscribeCallback = callback; return this; },
    track() {
      trackCalls += 1;
      return new Promise((resolve) => pendingTracks.push(resolve));
    },
    presenceState() { return {}; },
  };
  const removed = [];
  const client = {
    channel() { return channel; },
    async removeChannel(value) { removed.push(value); },
  };
  const stop = subscribeToFocusRoom(client, { id: 'room-id' }, 'user-a', {
    onPresence() {},
    onConnection: (status) => connections.push(status),
    onRoomChange() {},
  });

  channel.subscribeCallback('SUBSCRIBED');
  assert.equal(trackCalls, 1);
  channel.subscribeCallback('CHANNEL_ERROR');
  pendingTracks[0]('ok');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connections.at(-1), 'unavailable');

  channel.subscribeCallback('SUBSCRIBED');
  assert.equal(trackCalls, 2);
  pendingTracks[1]('ok');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(connections.at(-1), 'online');

  stop();
  channel.subscribeCallback('SUBSCRIBED');
  assert.equal(trackCalls, 2);
  assert.deepEqual(removed, [channel]);
});

test('room foundation migration restricts membership, lifecycle, and private Realtime writes', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261004220000_focus_room_foundation.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /room_code ~ '\^\[A-HJ-NP-Z2-9\]\{8\}\$'/i);
  assert.match(sql, /extensions\.gen_random_bytes\(8\)/i);
  assert.match(sql, /unique index if not exists focus_room_members_one_active_room_per_user_idx/i);
  assert.match(sql, /unique index if not exists focus_room_members_one_host_idx/i);
  assert.match(sql, /left_at is null/i);
  assert.match(sql, /values \(new_room_code, current_user_id, room_name, 'private', 'waiting'\)/i);
  assert.match(sql, /values \(new_room_id, current_user_id, 'host'\)/i);
  assert.match(sql, /values \(target_room\.id, current_user_id, 'member'\)/i);
  assert.match(sql, /on conflict \(room_id, user_id\) do update\s+set role = 'member',\s+joined_at = now\(\),\s+left_at = null/i);
  assert.match(sql, /create or replace function public\.create_focus_room/i);
  assert.match(sql, /create or replace function public\.join_focus_room/i);
  assert.match(sql, /create or replace function public\.leave_focus_room/i);
  assert.match(sql, /create or replace function public\.get_focus_room/i);
  assert.match(sql, /create or replace function public\.get_my_focus_room/i);
  assert.match(sql, /FocusMate room members can read room presence[\s\S]*?realtime\.topic\(\) = 'focusmate-room:'/i);
  assert.match(sql, /FocusMate room members can publish room presence[\s\S]*?realtime\.topic\(\) = 'focusmate-room:'/i);
  assert.match(sql, /member\.user_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /grant execute on function public\.create_focus_room\(text\) to authenticated/i);
  assert.match(sql, /grant execute on function public\.leave_focus_room\(uuid\) to authenticated/i);
  assert.doesNotMatch(sql, /grant execute on function public\.(?:create_focus_room|join_focus_room|leave_focus_room)[^(]*\([^;]+to anon/i);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete|all) on table public\.focus_room/i);
});

test('timer migration locks transitions, uses server timestamps, and preserves narrow authorization', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261004230000_room_timer_state_machine.sql', import.meta.url),
    'utf8',
  );
  for (const [name, signature] of [
    ['start_focus_room_session', 'uuid, integer'],
    ['pause_focus_room_session', 'uuid'],
    ['resume_focus_room_session', 'uuid'],
    ['start_focus_room_break', 'uuid, integer'],
    ['finish_focus_room_session', 'uuid'],
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\)\\s*returns jsonb`, 'i'));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(${signature.replace(', ', ',\\s*')}\\)[\\s\\S]*?from public, anon, authenticated`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\(${signature.replace(', ', ',\\s*')}\\) to authenticated`, 'i'));
  }
  assert.equal((sql.match(/for update;/gi) || []).length, 12);
  assert.ok((sql.match(/clock_timestamp\(\)/gi) || []).length >= 6);
  assert.match(sql, /session_duration_seconds[\s\S]*?session_started_at[\s\S]*?active_segment_started_at[\s\S]*?paused_at[\s\S]*?break_started_at[\s\S]*?break_duration_seconds[\s\S]*?elapsed_seconds[\s\S]*?finished_at[\s\S]*?server_now/i);
  assert.match(sql, /p_duration_seconds is null or p_duration_seconds not between 300 and 14400/i);
  assert.match(sql, /p_break_duration_seconds is null[\s\S]*?not between 60 and 3600/i);
  assert.match(sql, /target_room\.state = 'paused'[\s\S]*?return public\.focus_room_snapshot\(p_room_id\)/i);
  assert.match(sql, /target_room\.state = 'break'[\s\S]*?return public\.focus_room_snapshot\(p_room_id\)/i);
  assert.match(sql, /target_room\.state = 'finished'[\s\S]*?return public\.focus_room_snapshot\(p_room_id\)/i);
  assert.match(sql, /member\.user_id = current_user_id[\s\S]*?member\.left_at is null[\s\S]*?for update/i);
  assert.match(sql, /room\.state in \('waiting', 'focusing', 'paused', 'break', 'finished'\)/i);
  assert.match(sql, /create or replace function public\.leave_focus_room\(p_room_id uuid\)[\s\S]*?active_segment_started_at[\s\S]*?elapsed_seconds = target_room\.elapsed_seconds \+ active_segment_seconds[\s\S]*?finished_at = case/i);
  assert.match(sql, /realtime\.messages\.extension = 'presence'/i);
  assert.doesNotMatch(sql, /for\s+(?:select|insert|update|delete)\s+to\s+anon[\s\S]*?using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete|all) on table public\.focus_rooms/i);
  assert.doesNotMatch(sql, /p_(?:user_id|host_id|started_at|elapsed_seconds|state)\b/i);
});

test('room readiness migration gates timer start in trusted SQL and scopes its RPC', async () => {
  const sql = await readFile(
    new URL('../../supabase/migrations/20261010120000_focus_room_readiness.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /add column if not exists is_ready boolean not null default false/i);
  assert.match(sql, /before update of state on public\.focus_rooms/i);
  assert.match(sql, /old\.state = 'waiting'[\s\S]*?new\.state = 'focusing'[\s\S]*?member\.is_ready is not true[\s\S]*?using errcode = '55001'/i);
  assert.match(sql, /where member\.room_id = p_room_id[\s\S]*?member\.user_id = current_user_id[\s\S]*?member\.left_at is null/i);
  assert.match(sql, /new\.left_at is distinct from old\.left_at[\s\S]*?new\.is_ready := false/i);
  assert.match(sql, /revoke all on function public\.set_focus_room_ready\(uuid, boolean\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.set_focus_room_ready\(uuid, boolean\)[\s\S]*?to authenticated/i);
});

test('room foundation labels are translated for all supported languages', () => {
  const keys = [
    'room.create',
    'room.join',
    'room.roomCode',
    'room.participants',
    'room.role.host',
    'room.role.member',
    'room.leave',
    'room.connection.online',
    'room.error.invalidCode',
    'room.error.rateLimited',
    'room.error.signInAgain',
    'room.error.notMember',
    'room.error.full',
    'room.error.unavailable',
    'room.error.notFound',
    'room.error.network',
    'room.error.notReady',
    'room.session.title',
    'room.session.phase.waiting',
    'room.session.phase.focusing',
    'room.session.phase.paused',
    'room.session.phase.break',
    'room.session.phase.finished',
    'room.session.focusDuration',
    'room.session.breakDuration',
    'room.session.ready',
    'room.session.notReady',
    'room.session.readyDescription',
    'room.session.setReady',
    'room.session.setNotReady',
    'room.session.waitingForReady',
    'room.session.start',
    'room.session.pause',
    'room.session.resume',
    'room.session.startBreak',
    'room.session.finish',
    'room.session.elapsed',
    'room.session.remaining',
    'room.session.targetReached',
    'room.session.serverAuthority',
  ];
  for (const language of supportedLanguages) {
    for (const key of keys) {
      assert.notEqual(translate(language, key), key, `${language} is missing ${key}`);
    }
  }
});

test('room join code label is programmatically associated with its input', async () => {
  const component = await readFile(
    new URL('../src/RoomFoundation.jsx', import.meta.url),
    'utf8',
  );
  assert.match(component, /<label htmlFor="focus-room-code">[\s\S]*?<\/label>[\s\S]*?<input[\s\S]*?id="focus-room-code"/);
});
