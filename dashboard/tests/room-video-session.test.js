import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomVideoSession } from '../src/room-video-session.js';

const roomId = 'c8c3877e-7c4d-4cf0-bdb7-7f04f4dd83de';

const RoomEvent = {
  Connected: 'connected',
  Reconnecting: 'reconnecting',
  Reconnected: 'reconnected',
  Disconnected: 'disconnected',
  ConnectionStateChanged: 'connectionStateChanged',
  ParticipantConnected: 'participantConnected',
  ParticipantDisconnected: 'participantDisconnected',
  TrackPublished: 'trackPublished',
  TrackUnpublished: 'trackUnpublished',
  TrackSubscribed: 'trackSubscribed',
  TrackUnsubscribed: 'trackUnsubscribed',
  TrackMuted: 'trackMuted',
  TrackUnmuted: 'trackUnmuted',
  LocalTrackPublished: 'localTrackPublished',
  LocalTrackUnpublished: 'localTrackUnpublished',
};

class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  constructor(tracks) {
    this.tracks = tracks;
  }

  getTracks() {
    return this.tracks;
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

class FakeParticipant {
  constructor(identity) {
    this.identity = identity;
    this.publications = new Map();
  }

  getTrackPublication(source) {
    return this.publications.get(source);
  }

  get isCameraEnabled() {
    return Boolean(this.publications.get('camera') && !this.publications.get('camera').isMuted);
  }

  get isMicrophoneEnabled() {
    return Boolean(this.publications.get('microphone') && !this.publications.get('microphone').isMuted);
  }

  async publishTrack(track, { source }) {
    this.publications.set(source, { track, isMuted: false });
  }

  async unpublishTrack(track) {
    for (const [source, publication] of this.publications) {
      if (publication.track === track) this.publications.delete(source);
    }
  }
}

class FakeRoom {
  constructor(options) {
    this.options = options;
    this.localParticipant = new FakeParticipant('self');
    this.remoteParticipants = new Map();
    this.listeners = new Map();
    this.connectArgs = null;
    this.disconnectArgs = [];
  }

  on(event, handler) {
    const handlers = this.listeners.get(event) || new Set();
    handlers.add(handler);
    this.listeners.set(event, handlers);
    return this;
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  emit(event, ...args) {
    for (const handler of this.listeners.get(event) || []) handler(...args);
  }

  async connect(url, token, options) {
    this.connectArgs = [url, token, options];
  }

  async disconnect(stopTracks) {
    this.disconnectArgs.push(stopTracks);
  }

  async startAudio() {}
}

function fixture(options = {}) {
  const rooms = [];
  const states = [];
  const mediaRequests = [];
  const mediaTracks = [];
  const session = createRoomVideoSession({
    client: {},
    roomId,
    onState: (state) => states.push(state),
    tokenProvider: options.tokenProvider || (async () => ({ url: 'wss://video.example.test', token: 'ephemeral' })),
    loadSdk: options.loadSdk || (async () => ({
      Room: class extends FakeRoom {
        constructor(roomOptions) {
          super(roomOptions);
          rooms.push(this);
        }
      },
      RoomEvent,
      Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
    })),
    getUserMedia: options.getUserMedia || (async (constraints) => {
      mediaRequests.push(constraints);
      const track = new FakeTrack(constraints.video ? 'video' : 'audio');
      mediaTracks.push(track);
      return new FakeStream([track]);
    }),
    createMediaStream: (tracks) => new FakeStream(tracks),
  });
  return { session, rooms, states, mediaRequests, mediaTracks };
}

test('video session joins with an ephemeral token and observes existing and late participants', async () => {
  const { session, rooms, states } = fixture();
  await session.connect();
  const room = rooms[0];
  assert.deepEqual(room.connectArgs, [
    'wss://video.example.test',
    'ephemeral',
    { autoSubscribe: true },
  ]);
  assert.deepEqual(room.options, { adaptiveStream: true, dynacast: true });
  assert.equal(session.getState().status, 'connected');

  const peer = new FakeParticipant('peer-user-id');
  room.remoteParticipants.set(peer.identity, peer);
  room.emit(RoomEvent.ParticipantConnected, peer);
  assert.ok(session.getState().participants.some((participant) => participant.identity === peer.identity));

  room.emit(RoomEvent.Reconnecting);
  assert.equal(session.getState().status, 'reconnecting');
  room.emit(RoomEvent.Reconnected);
  assert.equal(session.getState().status, 'connected');
  assert.ok(states.some((state) => state.status === 'reconnecting'));

  room.remoteParticipants.delete(peer.identity);
  room.emit(RoomEvent.ParticipantDisconnected, peer);
  assert.equal(session.getState().participants.some((participant) => participant.identity === peer.identity), false);
});

test('camera and microphone controls publish only after user opt-in and stop tracks when disabled', async () => {
  const { session, rooms, mediaRequests, mediaTracks } = fixture();
  await session.connect();
  await session.setCameraEnabled(true);
  await session.setMicrophoneEnabled(true);
  assert.deepEqual(mediaRequests, [
    { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: false, audio: true },
  ]);
  assert.equal(session.getState().cameraEnabled, true);
  assert.equal(session.getState().microphoneEnabled, true);
  assert.equal(session.getState().localVideoStream.getVideoTracks()[0], mediaTracks[0]);

  await session.setCameraEnabled(false);
  await session.setMicrophoneEnabled(false);
  assert.equal(mediaTracks[0].stopped, true);
  assert.equal(mediaTracks[1].stopped, true);
  assert.equal(session.getState().cameraEnabled, false);
  assert.equal(session.getState().microphoneEnabled, false);
  assert.equal(session.getState().localVideoStream, null);
  assert.deepEqual([...rooms[0].localParticipant.publications.keys()], []);
});

test('permission errors are surfaced and do not retain media tracks', async () => {
  const { session } = fixture({
    getUserMedia: async () => {
      const error = new Error('browser-specific private detail');
      error.name = 'NotAllowedError';
      throw error;
    },
  });
  await session.connect();
  await assert.rejects(session.setCameraEnabled(true), (error) => {
    assert.equal(error.code, 'VIDEO_PERMISSION_DENIED');
    assert.doesNotMatch(error.message, /private detail/);
    return true;
  });
  assert.equal(session.getState().cameraBusy, false);
  assert.equal(session.getState().errorCode, 'VIDEO_PERMISSION_DENIED');
  assert.equal(session.getState().localVideoStream, null);
});

test('leaving disconnects the SFU and stops camera and microphone tracks', async () => {
  const { session, rooms, mediaTracks } = fixture();
  await session.connect();
  await session.setCameraEnabled(true);
  await session.setMicrophoneEnabled(true);
  await session.leave();
  assert.deepEqual(rooms[0].disconnectArgs, [true]);
  assert.ok(mediaTracks.every((track) => track.stopped));
  assert.equal(session.getState().status, 'disconnected');
  assert.equal(session.getState().participants.length, 0);
});

test('a late token response cannot connect after the session has been left', async () => {
  let resolveToken;
  let sdkLoads = 0;
  const { session } = fixture({
    tokenProvider: () => new Promise((resolve) => { resolveToken = resolve; }),
    loadSdk: async () => {
      sdkLoads += 1;
      return {};
    },
  });
  const connectPromise = session.connect();
  await Promise.resolve();
  await session.leave();
  resolveToken({ url: 'wss://video.example.test', token: 'ephemeral' });
  await connectPromise;
  assert.equal(sdkLoads, 0);
  assert.equal(session.getState().status, 'disconnected');
});
