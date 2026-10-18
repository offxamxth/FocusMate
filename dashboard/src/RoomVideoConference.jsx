import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Mic, MicOff, Play, Radio, Volume2 } from 'lucide-react';
import { supabase } from './lib/supabase.js';
import { translate } from './i18n.js';
import { createRoomVideoSession } from './room-video-session.js';

const videoErrorKeys = {
  VIDEO_PROVIDER_NOT_CONFIGURED: 'room.video.notConfigured',
  ROOM_MEMBERSHIP_REQUIRED: 'room.video.membershipRequired',
  AUTHENTICATION_REQUIRED: 'room.video.signInAgain',
  VIDEO_PROVIDER_UNAVAILABLE: 'room.video.unavailable',
  VIDEO_MEDIA_UNAVAILABLE: 'room.video.mediaUnavailable',
  VIDEO_PERMISSION_DENIED: 'room.video.permissionDenied',
  VIDEO_DEVICE_MISSING: 'room.video.deviceMissing',
  VIDEO_DEVICE_IN_USE: 'room.video.deviceInUse',
  VIDEO_CONNECTION_REQUIRED: 'room.video.connectFirst',
  VIDEO_CONNECTION_FAILED: 'room.video.connectionFailed',
  VIDEO_MEDIA_FAILED: 'room.video.mediaUnavailable',
};

function VideoTile({ participant, member, language, localVideoStream, onVideoPlaybackBlocked }) {
  const videoRef = useRef(null);
  const local = participant?.isLocal === true;
  const videoTrack = local ? null : participant?.cameraTrack;
  const label = member?.display_name || member?.username || translate(language, 'room.video.unknownParticipant');
  const t = (key) => translate(language, `room.video.${key}`);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    if (localVideoStream) {
      video.srcObject = localVideoStream;
      void video.play().catch(() => onVideoPlaybackBlocked());
    } else {
      video.srcObject = null;
    }
    return () => {
      if (video.srcObject === localVideoStream) video.srcObject = null;
    };
  }, [localVideoStream, onVideoPlaybackBlocked]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || local || !videoTrack) return undefined;
    const attachedVideo = videoTrack.attach(video);
    return () => {
      videoTrack.detach(attachedVideo);
      attachedVideo.srcObject = null;
    };
  }, [local, videoTrack]);

  return (
    <article className={`room-video-tile${local ? ' is-local' : ''}`}>
      <div className="room-video-frame">
        {((local && localVideoStream) || (!local && videoTrack)) && (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            aria-label={t(local ? 'yourPreview' : 'participantPreview').replace('{name}', label)}
          />
        )}
        {!localVideoStream && local && (
          <div className="room-video-placeholder" aria-hidden="true">
            <span>{label.slice(0, 1).toUpperCase()}</span>
            <small>{t('cameraOff')}</small>
          </div>
        )}
        {!local && !videoTrack && (
          <div className="room-video-placeholder" aria-hidden="true">
            <span>{label.slice(0, 1).toUpperCase()}</span>
            <small>{t(participant?.cameraEnabled === false ? 'cameraOff' : 'waitingForVideo')}</small>
          </div>
        )}
      </div>
      <div className="room-video-tile-caption">
        <strong>{local ? `${label} · ${t('you')}` : label}</strong>
        <span className={`room-video-participant-state ${participant ? 'is-online' : 'is-offline'}`}>
          <i aria-hidden="true" />
          {t(participant ? 'connected' : 'notConnected')}
        </span>
        {participant && !participant.microphoneEnabled && <small><MicOff size={12} /> {t('microphoneOff')}</small>}
      </div>
    </article>
  );
}

function RemoteAudio({ track, playbackAttempt, onBlocked }) {
  const audioRef = useRef(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return undefined;
    const attachedAudio = track.attach(audio);
    attachedAudio.autoplay = true;
    attachedAudio.muted = false;
    void attachedAudio.play().catch(() => onBlocked());
    return () => {
      track.detach(attachedAudio);
      attachedAudio.srcObject = null;
    };
  }, [onBlocked, playbackAttempt, track]);
  return <audio ref={audioRef} className="room-video-audio" autoPlay />;
}

export default function RoomVideoConference({
  account,
  language,
  onLocalVideoStreamChange,
  pageActive,
  participants,
  roomId,
  roomStatus,
}) {
  const [sessionState, setSessionState] = useState({
    status: 'disconnected',
    participants: [],
    localVideoStream: null,
    cameraEnabled: false,
    microphoneEnabled: false,
    cameraBusy: false,
    microphoneBusy: false,
    errorCode: '',
  });
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const sessionRef = useRef(null);
  const activeRoomStatus = ['waiting', 'focusing', 'paused', 'break'].includes(roomStatus);
  const canConnect = pageActive && activeRoomStatus;
  const t = (key) => translate(language, `room.video.${key}`);
  const onVideoPlaybackBlocked = useCallback(() => {
    setAudioPlaybackBlocked(true);
  }, []);

  useEffect(() => {
    let mounted = true;
    const session = createRoomVideoSession({
      client: supabase,
      roomId,
      onState: (nextState) => {
        if (!mounted) return;
        setSessionState(nextState);
        onLocalVideoStreamChange(nextState.localVideoStream);
      },
    });
    sessionRef.current = session;
    return () => {
      mounted = false;
      sessionRef.current = null;
      onLocalVideoStreamChange(null);
      void session.dispose().catch((error) => {
        console.error('Focus Room video cleanup failed.', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      });
    };
  }, [account?.id, onLocalVideoStreamChange, roomId]);

  useEffect(() => {
    if (canConnect) return;
    const session = sessionRef.current;
    if (!session) return;
    void session.leave().catch((error) => {
      setSessionState((current) => ({
        ...current,
        errorCode: videoErrorKeys[error.code] ? error.code : 'VIDEO_CONNECTION_FAILED',
      }));
    });
  }, [canConnect]);

  const connect = () => {
    setAudioPlaybackBlocked(false);
    void sessionRef.current?.connect();
  };
  const leave = () => {
    void sessionRef.current?.leave().catch((error) => {
      setSessionState((current) => ({
        ...current,
        errorCode: videoErrorKeys[error.code] ? error.code : 'VIDEO_CONNECTION_FAILED',
      }));
    });
  };
  const toggleCamera = () => {
    void sessionRef.current?.setCameraEnabled(!sessionState.cameraEnabled).catch(() => {});
  };
  const toggleMicrophone = () => {
    void sessionRef.current?.setMicrophoneEnabled(!sessionState.microphoneEnabled).catch(() => {});
  };
  const enableSpeakerAudio = async () => {
    try {
      await sessionRef.current?.startAudio();
      setAudioPlaybackBlocked(false);
      setPlaybackAttempt((attempt) => attempt + 1);
    } catch {
      setAudioPlaybackBlocked(true);
    }
  };

  const localIdentity = String(account?.id || '');
  const sessionParticipants = sessionState.participants;
  const remoteAudioTracks = sessionParticipants
    .filter((participant) => !participant.isLocal && participant.microphoneTrack)
    .map((participant) => participant.microphoneTrack);
  const connected = sessionState.status === 'connected';
  const connecting = sessionState.status === 'connecting';
  const reconnecting = sessionState.status === 'reconnecting';
  const errorKey = videoErrorKeys[sessionState.errorCode] || '';
  const statusKey = sessionState.status === 'error'
    ? 'unavailable'
    : sessionState.status === 'connected'
      ? 'connected'
      : sessionState.status === 'connecting'
        ? 'connecting'
        : sessionState.status === 'reconnecting'
          ? 'reconnecting'
          : 'disconnected';

  return (
    <section className="room-video-conference" aria-labelledby="room-video-title">
      <div className="room-video-heading">
        <div>
          <strong id="room-video-title">{t('title')}</strong>
          <p>{t('privacy')}</p>
        </div>
        <span className={`room-video-connection is-${sessionState.status}`} role="status">
          <i aria-hidden="true" />
          {t(statusKey)}
        </span>
      </div>

      <div className="room-video-controls">
        {connected || reconnecting ? (
          <button className="outline-button" type="button" onClick={leave}>
            <Radio size={15} /> {t('leave')}
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            disabled={!canConnect || connecting}
            onClick={connect}
          >
            <Play size={15} /> {t(connecting ? 'connecting' : 'connect')}
          </button>
        )}
        <button
          className={sessionState.cameraEnabled ? 'primary-button' : 'outline-button'}
          type="button"
          disabled={!connected || sessionState.cameraBusy}
          aria-pressed={sessionState.cameraEnabled}
          onClick={toggleCamera}
        >
          {sessionState.cameraEnabled ? <CameraOff size={15} /> : <Camera size={15} />}
          {t(sessionState.cameraBusy ? 'working' : sessionState.cameraEnabled ? 'cameraOffButton' : 'cameraOn')}
        </button>
        <button
          className={sessionState.microphoneEnabled ? 'primary-button' : 'outline-button'}
          type="button"
          disabled={!connected || sessionState.microphoneBusy}
          aria-pressed={sessionState.microphoneEnabled}
          onClick={toggleMicrophone}
        >
          {sessionState.microphoneEnabled ? <MicOff size={15} /> : <Mic size={15} />}
          {t(sessionState.microphoneBusy
            ? 'working'
            : sessionState.microphoneEnabled ? 'microphoneOffButton' : 'microphoneOn')}
        </button>
        {audioPlaybackBlocked && remoteAudioTracks.length > 0 && (
          <button className="outline-button" type="button" onClick={() => void enableSpeakerAudio()}>
            <Volume2 size={15} /> {t('enableSpeaker')}
          </button>
        )}
      </div>

      {errorKey && <p className="room-video-error" role="alert">{t(errorKey)}</p>}
      {!canConnect && <p className="room-video-note" role="status">{t(roomStatus === 'finished' ? 'sessionFinished' : 'openRoomPage')}</p>}

      <div className="room-video-grid">
        {participants.map((member) => {
          const participant = sessionParticipants.find((item) => item.identity === member.user_id);
          const isLocal = member.user_id === localIdentity;
          return (
            <VideoTile
              key={member.user_id}
              participant={participant || (isLocal ? { identity: localIdentity, isLocal: true } : null)}
              member={member}
              language={language}
              localVideoStream={isLocal ? sessionState.localVideoStream : null}
              onVideoPlaybackBlocked={onVideoPlaybackBlocked}
            />
          );
        })}
      </div>

      {remoteAudioTracks.map((track) => (
        <RemoteAudio
          key={track.sid || track.mediaStreamID}
          track={track}
          playbackAttempt={playbackAttempt}
          onBlocked={onVideoPlaybackBlocked}
        />
      ))}
    </section>
  );
}
