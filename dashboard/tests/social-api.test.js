import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelFocusMateFriendRequest,
  listFocusMateFriendRequests,
  listFocusMateFriends,
  removeFocusMateFriend,
  respondToFocusMateFriendRequest,
  searchFocusMateUser,
  sendFocusMateFriendRequest,
} from '../src/social-api.js';
import {
  startOwnPresence,
  subscribeToFriendPresence,
} from '../src/presence.js';

function fakeClient(result) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(...args) {
        calls.push(args);
        return result;
      },
    },
  };
}

test('friend search normalizes the username and returns only a real RPC result', async () => {
  const { client, calls } = fakeClient({
    data: [{ username: 'study.friend', display_name: 'Study Friend', relationship_status: 'none' }],
    error: null,
  });
  const result = await searchFocusMateUser(client, '  Study.Friend  ');
  assert.deepEqual(calls, [['search_focusmate_users', { p_username: 'study.friend' }]]);
  assert.equal(result.username, 'study.friend');
});

test('friend search treats an empty RPC result as not found and validates usernames', async () => {
  const { client, calls } = fakeClient({ data: [], error: null });
  assert.equal(await searchFocusMateUser(client, 'missing_user'), null);
  assert.equal(calls.length, 1);
  await assert.rejects(searchFocusMateUser(client, 'not a username'), /valid FocusMate username/);
  assert.equal(calls.length, 1);
});

test('friend and request lists use the authenticated RPCs', async () => {
  const friends = [{ friend_id: 'friend-id', username: 'study.friend' }];
  const requests = [{ request_id: 'request-id', username: 'new.friend', is_sent_by_me: false }];
  const calls = [];
  const client = {
    async rpc(...args) {
      calls.push(args);
      return {
        data: args[0] === 'list_focusmate_friends' ? friends : requests,
        error: null,
      };
    },
  };

  assert.deepEqual(await listFocusMateFriends(client), friends);
  assert.deepEqual(await listFocusMateFriendRequests(client), requests);
  assert.deepEqual(calls, [
    ['list_focusmate_friends', {}],
    ['list_focusmate_friend_requests', {}],
  ]);
});

test('friend mutations send only the target username or server-issued row identifiers', async () => {
  const { client, calls } = fakeClient({ data: [{ request_id: 'request-id', outcome: 'pending' }], error: null });
  await sendFocusMateFriendRequest(client, '  New.Friend ');
  assert.deepEqual(calls[0], ['send_focusmate_friend_request', { p_username: 'new.friend' }]);

  const mutationClient = {
    async rpc(...args) {
      calls.push(args);
      return { data: null, error: null };
    },
  };
  await respondToFocusMateFriendRequest(mutationClient, 'request-id', true);
  await cancelFocusMateFriendRequest(mutationClient, 'request-id');
  await removeFocusMateFriend(mutationClient, 'friend-id');
  assert.deepEqual(calls.slice(1), [
    ['respond_focusmate_friend_request', { p_request_id: 'request-id', p_accept: true }],
    ['cancel_focusmate_friend_request', { p_request_id: 'request-id' }],
    ['remove_focusmate_friend', { p_friend_id: 'friend-id' }],
  ]);
});

test('database permission errors never become username-conflict messages', async () => {
  const { client } = fakeClient({
    data: null,
    error: { code: '42501', message: 'permission denied for table profiles' },
  });
  await assert.rejects(sendFocusMateFriendRequest(client, 'another.user'), /not allowed to perform that action/i);
  await assert.rejects(
    listFocusMateFriends(client),
    /not allowed to perform that action/i,
  );
});

function fakeRealtimeClient() {
  const channels = [];
  const removed = [];
  const client = {
    channels,
    removed,
    channel(topic, options) {
      const channel = {
        topic,
        options,
        handlers: {},
        state: {},
        on(type, filter, callback) {
          this.handlers[`${type}:${filter.event}`] = callback;
          return this;
        },
        subscribe(callback) {
          this.onStatus = callback;
          return this;
        },
        async track(payload) {
          this.tracked = payload;
          return 'ok';
        },
        presenceState() {
          return this.state;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      removed.push(channel);
      return 'ok';
    },
  };
  return client;
}

test('own presence publishes only minimal online state to a private account channel', async () => {
  const client = fakeRealtimeClient();
  const statuses = [];
  const stop = startOwnPresence(client, '123e4567-e89b-12d3-a456-426614174000', (status) => statuses.push(status));
  const [channel] = client.channels;

  assert.equal(channel.topic, 'focusmate-presence:123e4567-e89b-12d3-a456-426614174000');
  assert.deepEqual(channel.options, {
    config: { private: true, presence: { key: '123e4567-e89b-12d3-a456-426614174000' } },
  });
  assert.equal(typeof channel.handlers['presence:sync'], 'function');
  channel.onStatus('SUBSCRIBED');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(channel.tracked, { status: 'online' });
  assert.deepEqual(statuses, ['online']);

  channel.onStatus('CHANNEL_ERROR');
  assert.equal(statuses.at(-1), 'unavailable');
  stop();
  assert.deepEqual(client.removed, [channel]);
  assert.throws(() => startOwnPresence(client, 'not-a-user-id'), /Presence is unavailable/);
});

test('friend presence uses one private channel per unique friend and follows live sync/reconnect state', () => {
  const client = fakeRealtimeClient();
  const updates = [];
  const selfId = '123e4567-e89b-12d3-a456-426614174000';
  const friendId = '123e4567-e89b-12d3-a456-426614174001';
  const secondFriendId = '123e4567-e89b-12d3-a456-426614174002';
  const stop = subscribeToFriendPresence(
    client,
    selfId,
    [friendId, selfId, friendId, secondFriendId],
    (state) => updates.push(state),
  );

  assert.equal(client.channels.length, 2);
  assert.deepEqual(client.channels.map((channel) => channel.topic), [
    `focusmate-presence:${friendId}`,
    `focusmate-presence:${secondFriendId}`,
  ]);
  assert.ok(client.channels.every((channel) => channel.options.config.private));
  const first = client.channels[0];
  first.onStatus('SUBSCRIBED');
  assert.equal(updates.at(-1)[friendId], 'offline');
  first.state = { [friendId]: [{ status: 'online' }] };
  first.handlers['presence:sync']();
  assert.equal(updates.at(-1)[friendId], 'online');
  first.onStatus('TIMED_OUT');
  assert.equal(updates.at(-1)[friendId], 'unavailable');
  first.onStatus('SUBSCRIBED');
  assert.equal(updates.at(-1)[friendId], 'online');

  stop();
  assert.equal(client.removed.length, 2);
});
