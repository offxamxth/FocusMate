import { getFocusRoomVideoToken } from './room-video-api.js';

function mediaErrorCode(error) {
  if (error?.code === 'VIDEO_MEDIA_UNAVAILABLE') return 'VIDEO_MEDIA_UNAVAILABLE';
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'VIDEO_PERMISSION_DENIED';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'VIDEO_DEVICE_MISSING';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'VIDEO_DEVICE_IN_USE';
    default:
      return 'VIDEO_MEDIA_FAILED';
  }
}

function sessionErrorCode(error) {
  const code = String(error?.code || '');
  if ([
    'VIDEO_PROVIDER_NOT_CONFIGURED',
    'ROOM_MEMBERSHIP_REQUIRED',
    'AUTHENTICATION_REQUIRED',
    'VIDEO_PROVIDER_UNAVAILABLE',
    'VIDEO_MEDIA_UNAVAILABLE',
  ].includes(code)) return code;
  return 'VIDEO_CONNECTION_FAILED';
}

function safeVideoError(code) {
  const messages = {
    VIDEO_PERMISSION_DENIED: 'Camera or microphone permission was denied.',
    VIDEO_DEVICE_MISSING: 'The selected camera or microphone is unavailable.',
    VIDEO_DEVICE_IN_USE: 'The selected camera or microphone is in use by another application.',
    VIDEO_MEDIA_UNAVAILABLE: 'Media capture is unavailable in this browser.',
    VIDEO_CONNECTION_REQUIRED: 'Connect to room video before enabling a device.',
    VIDEO_CONNECTION_FAILED: 'Focus Room video could not complete that operation.',
  };
  const error = new Error(messages[code] || messages.VIDEO_CONNECTION_FAILED);
  error.code = code;
  return error;
}

export function createRoomVideoSession({
  client,
  roomId,
  onState = () => {},
  tokenProvider = getFocusRoomVideoToken,
  loadSdk = () => import('livekit-client'),
  getUserMedia = (constraints) => {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      const error = new Error('Media capture is unavailable in this browser.');
      error.code = 'VIDEO_MEDIA_UNAVAILABLE';
      throw error;
    }
    return mediaDevices.getUserMedia(constraints);
  },
  createMediaStream = (tracks) => new MediaStream(tracks),
}) {
  let room = null;
  let sdk = null;
  let bindings = [];
  let generation = 0;
  let disposed = false;
  let videoStream = null;
  let audioStream = null;
  let state = {
    status: 'disconnected',
    participants: [],
    localVideoStream: null,
    cameraEnabled: false,
    microphoneEnabled: false,
    cameraBusy: false,
    microphoneBusy: false,
    errorCode: '',
  };

  const emit = (change = {}) => {
    const participants = room && sdk
      ? [
        { participant: room.localParticipant, isLocal: true },
        ...[...room.remoteParticipants.values()].map((participant) => ({ participant, isLocal: false })),
      ].map(({ participant, isLocal }) => {
        const camera = participant.getTrackPublication(sdk.Track.Source.Camera);
        const microphone = participant.getTrackPublication(sdk.Track.Source.Microphone);
        return {
          identity: participant.identity,
          isLocal,
          cameraTrack: camera?.track || null,
          microphoneTrack: microphone?.track || null,
          cameraEnabled: Boolean(camera && !camera.isMuted),
          microphoneEnabled: Boolean(microphone && !microphone.isMuted),
        };
      })
      : [];
    state = { ...state, ...change, participants };
    onState(state);
  };

  const stopStream = (stream) => {
    stream?.getTracks().forEach((track) => track.stop());
  };

  const stopLocalMedia = () => {
    stopStream(videoStream);
    stopStream(audioStream);
    videoStream = null;
    audioStream = null;
    emit({
      localVideoStream: null,
      cameraEnabled: false,
      microphoneEnabled: false,
      cameraBusy: false,
      microphoneBusy: false,
    });
  };

  const removeRoomListeners = (targetRoom) => {
    for (const [event, handler] of bindings) targetRoom.off(event, handler);
    bindings = [];
  };

  const bindRoomEvents = (targetRoom) => {
    const refresh = () => emit();
    const events = [
      'Connected',
      'Reconnecting',
      'Reconnected',
      'Disconnected',
      'ConnectionStateChanged',
      'ParticipantConnected',
      'ParticipantDisconnected',
      'TrackPublished',
      'TrackUnpublished',
      'TrackSubscribed',
      'TrackUnsubscribed',
      'TrackMuted',
      'TrackUnmuted',
      'LocalTrackPublished',
      'LocalTrackUnpublished',
    ];
    for (const name of events) {
      const event = sdk.RoomEvent[name];
      if (!event) continue;
      const handler = (...args) => {
        if (room !== targetRoom || disposed) return;
        if (name === 'Reconnecting') emit({ status: 'reconnecting' });
        else if (name === 'Reconnected' || name === 'Connected') emit({ status: 'connected', errorCode: '' });
        else if (name === 'Disconnected') {
          room = null;
          removeRoomListeners(targetRoom);
          stopLocalMedia();
          emit({ status: 'disconnected' });
        } else if (name === 'ConnectionStateChanged') {
          const connectionState = String(args[0] || '').toLowerCase();
          if (connectionState === 'reconnecting') emit({ status: 'reconnecting' });
          else if (connectionState === 'connected') emit({ status: 'connected' });
          else refresh();
        } else refresh();
      };
      targetRoom.on(event, handler);
      bindings.push([event, handler]);
    }
  };

  const connect = async () => {
    if (disposed) throw new Error('This video session has already been closed.');
    if (room || state.status === 'connecting') return;
    const attempt = ++generation;
    emit({ status: 'connecting', errorCode: '' });
    let nextRoom = null;
    try {
      const connection = await tokenProvider(client, roomId);
      if (disposed || attempt !== generation) return;
      sdk = await loadSdk();
      if (disposed || attempt !== generation) return;
      nextRoom = new sdk.Room({ adaptiveStream: true, dynacast: true });
      room = nextRoom;
      bindRoomEvents(nextRoom);
      await nextRoom.connect(connection.url, connection.token, { autoSubscribe: true });
      if (disposed || attempt !== generation || room !== nextRoom) {
        removeRoomListeners(nextRoom);
        await nextRoom.disconnect(true);
        return;
      }
      emit({ status: 'connected', errorCode: '' });
    } catch (error) {
      if (nextRoom) {
        if (room === nextRoom) room = null;
        removeRoomListeners(nextRoom);
        try {
          await nextRoom.disconnect(true);
        } catch (cleanupError) {
          console.error('Focus Room video cleanup failed.', {
            errorName: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          });
        }
      }
      if (!disposed && attempt === generation) {
        emit({ status: 'error', errorCode: sessionErrorCode(error) });
      }
    }
  };

  const enableSource = async (source) => {
    if (!room || state.status !== 'connected') {
      throw safeVideoError('VIDEO_CONNECTION_REQUIRED');
    }
    const isCamera = source === 'camera';
    const currentStream = isCamera ? videoStream : audioStream;
    if (currentStream) return;
    emit({ [`${source}Busy`]: true, errorCode: '' });
    let nextStream;
    let publishing = false;
    try {
      nextStream = await getUserMedia(isCamera
        ? { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }
        : { video: false, audio: true });
      const tracks = isCamera ? nextStream.getVideoTracks() : nextStream.getAudioTracks();
      const track = tracks[0];
      if (!track) {
        stopStream(nextStream);
        const missing = new Error('No media track was returned.');
        missing.name = 'NotFoundError';
        throw missing;
      }
      if (disposed || !room || state.status !== 'connected') {
        stopStream(nextStream);
        emit({ [`${source}Busy`]: false });
        return;
      }
      const targetRoom = room;
      const previewStream = isCamera ? createMediaStream([track]) : null;
      publishing = true;
      await targetRoom.localParticipant.publishTrack(track, {
        source: isCamera ? sdk.Track.Source.Camera : sdk.Track.Source.Microphone,
      });
      if (disposed || room !== targetRoom || state.status !== 'connected') {
        try {
          await targetRoom.localParticipant.unpublishTrack(track, false);
        } catch (cleanupError) {
          console.error('Focus Room video track cleanup failed.', {
            errorName: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
          });
        } finally {
          stopStream(nextStream);
        }
        emit({ [`${source}Busy`]: false });
        return;
      }
      if (isCamera) {
        videoStream = nextStream;
        emit({ localVideoStream: previewStream, cameraEnabled: true, cameraBusy: false });
      } else {
        audioStream = nextStream;
        emit({ microphoneEnabled: true, microphoneBusy: false });
      }
    } catch (error) {
      if (nextStream && nextStream !== videoStream && nextStream !== audioStream) stopStream(nextStream);
      const code = publishing ? 'VIDEO_CONNECTION_FAILED' : mediaErrorCode(error);
      emit({ [`${source}Busy`]: false, errorCode: code });
      throw safeVideoError(code);
    }
  };

  const disableSource = async (source) => {
    const isCamera = source === 'camera';
    const currentStream = isCamera ? videoStream : audioStream;
    if (!currentStream) return;
    const track = (isCamera ? currentStream.getVideoTracks() : currentStream.getAudioTracks())[0];
    emit({ [`${source}Busy`]: true, errorCode: '' });
    let unpublishError = null;
    try {
      if (room && track) {
        await room.localParticipant.unpublishTrack(track, false);
      }
    } catch (error) {
      unpublishError = error;
    } finally {
      stopStream(currentStream);
      if (isCamera) {
        videoStream = null;
        emit({ localVideoStream: null, cameraEnabled: false, cameraBusy: false });
      } else {
        audioStream = null;
        emit({ microphoneEnabled: false, microphoneBusy: false });
      }
    }
    if (unpublishError) {
      emit({ errorCode: 'VIDEO_CONNECTION_FAILED' });
      throw safeVideoError('VIDEO_CONNECTION_FAILED');
    }
  };

  const toggleSource = async (source, enabled) => {
    if (source !== 'camera' && source !== 'microphone') {
      throw new Error('Unsupported room video device.');
    }
    if (enabled) return enableSource(source);
    return disableSource(source);
  };

  const startAudio = async () => {
    if (!room) return false;
    await room.startAudio();
    return true;
  };

  const leave = async () => {
    generation += 1;
    const currentRoom = room;
    room = null;
    let disconnectError = null;
    try {
      if (currentRoom) {
        removeRoomListeners(currentRoom);
        await currentRoom.disconnect(true);
      }
    } catch (error) {
      disconnectError = safeVideoError(sessionErrorCode(error));
    } finally {
      stopLocalMedia();
      if (!disposed) {
        emit({
          status: 'disconnected',
          errorCode: disconnectError?.code || '',
        });
      }
    }
    if (disconnectError) throw disconnectError;
  };

  const dispose = () => {
    disposed = true;
    return leave();
  };

  return {
    connect,
    dispose,
    getState: () => state,
    leave,
    setCameraEnabled: (enabled) => toggleSource('camera', Boolean(enabled)),
    setMicrophoneEnabled: (enabled) => toggleSource('microphone', Boolean(enabled)),
    startAudio,
  };
}
