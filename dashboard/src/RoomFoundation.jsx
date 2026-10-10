import { useEffect, useState } from 'react';
import { Check, Coffee, Copy, DoorOpen, LogIn, Pause, Play, Plus, Timer, Users } from 'lucide-react';
import { supabase } from './lib/supabase.js';
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
} from './room-api.js';
import { translate } from './i18n.js';
import { reportPwaSessionActivity } from './pwa-session-state.js';
import RoomCameraMonitor from './RoomCameraMonitor.jsx';
import { getFocusmateRoomProgress, publishFocusmateRoomProgress } from './room-progress.js';

const focusDurations = [900, 1500, 2700, 3600, 5400, 7200];
const breakDurations = [60, 300, 600, 900, 1800];

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function roomClock(room, clientPerformanceNow) {
  const serverNow = Date.parse(room?.server_now || '');
  const receivedAt = Number(room?.received_at);
  if (!Number.isFinite(serverNow) || !Number.isFinite(receivedAt)) return NaN;
  return serverNow + Math.max(0, clientPerformanceNow - receivedAt);
}

function activeElapsedSeconds(room, serverNow) {
  const accumulated = Number(room?.elapsed_seconds) || 0;
  if (room?.status !== 'focusing' || !room.active_segment_started_at || !Number.isFinite(serverNow)) {
    return accumulated;
  }
  const segmentStart = Date.parse(room.active_segment_started_at);
  if (!Number.isFinite(segmentStart)) return accumulated;
  return accumulated + Math.max(0, Math.floor((serverNow - segmentStart) / 1000));
}

export default function RoomFoundation({ account, language, profile, pageActive }) {
  const [room, setRoom] = useState(null);
  const [roomCode, setRoomCode] = useState('');
  const [presence, setPresence] = useState({});
  const [connection, setConnection] = useState('connecting');
  const [loading, setLoading] = useState(Boolean(account));
  const [busy, setBusy] = useState(false);
  const [focusDuration, setFocusDuration] = useState(1500);
  const [breakDuration, setBreakDuration] = useState(300);
  const [clientPerformanceNow, setClientPerformanceNow] = useState(() => performance.now());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const t = (key) => translate(language, `room.${key}`);
  const sessionHost = room?.host_id === account?.id;
  const serverNow = roomClock(room, clientPerformanceNow);
  const elapsedSeconds = activeElapsedSeconds(room, serverNow);
  const focusRemaining = Math.max(0, (Number(room?.session_duration_seconds) || 0) - elapsedSeconds);
  const participants = room?.participants || [];
  const ownParticipant = participants.find((participant) => participant.user_id === account?.id);
  const allParticipantsReady = participants.length > 0
    && participants.every((participant) => participant.is_ready === true);
  const breakStartedAt = Date.parse(room?.break_started_at || '');
  const breakElapsed = Number.isFinite(breakStartedAt) && Number.isFinite(serverNow)
    ? Math.max(0, Math.floor((serverNow - breakStartedAt) / 1000))
    : 0;
  const breakRemaining = Math.max(0, (Number(room?.break_duration_seconds) || 0) - breakElapsed);

  useEffect(() => {
    const active = room?.status === 'focusing' || room?.status === 'break';
    reportPwaSessionActivity('room', active);
    return () => reportPwaSessionActivity('room', false);
  }, [room?.status]);

  useEffect(() => {
    if (!room || !['focusing', 'break'].includes(room.status)) return undefined;
    const interval = window.setInterval(() => setClientPerformanceNow(performance.now()), 1000);
    return () => window.clearInterval(interval);
  }, [room?.id, room?.status]);

  useEffect(() => {
    if (!account || room?.status !== 'finished') return undefined;
    let active = true;
    getFocusmateRoomProgress(supabase)
      .then((progress) => {
        if (active) publishFocusmateRoomProgress(progress);
      })
      .catch((progressError) => {
        if (active) setError(progressError.message);
      });
    return () => { active = false; };
  }, [account?.id, room?.status]);

  const setRoomSnapshot = (snapshot) => {
    if (snapshot) setRoom({ ...snapshot, received_at: performance.now() });
    else setRoom(null);
  };

  useEffect(() => {
    let active = true;
    if (!account) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    getMyFocusRoom(supabase)
      .then((currentRoom) => {
        if (active) setRoomSnapshot(currentRoom);
      })
      .catch((loadError) => {
        if (active) setError(t(focusRoomErrorTranslationKey(loadError)));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [account?.id]);

  useEffect(() => {
    setPresence({});
    if (!room || room.status === 'closed' || !account) {
      setConnection('offline');
      return undefined;
    }

    let active = true;
    const refreshRoom = async () => {
      try {
        const nextRoom = await getFocusRoom(supabase, room.id);
        if (active) setRoomSnapshot(nextRoom);
      } catch (refreshError) {
        if (active) setError(t(focusRoomErrorTranslationKey(refreshError)));
      }
    };
    const stop = subscribeToFocusRoom(supabase, room, account.id, {
      onPresence: (nextPresence) => { if (active) setPresence(nextPresence); },
      onConnection: (status) => { if (active) setConnection(status); },
      onRoomChange: () => { void refreshRoom(); },
    });

    return () => {
      active = false;
      stop();
    };
  }, [account?.id, room?.id]);

  const runRoomAction = async (action, successMessage) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (result) setRoomSnapshot(result);
      if (successMessage) setNotice(successMessage);
    } catch (actionError) {
      setError(t(focusRoomErrorTranslationKey(actionError)));
    } finally {
      setBusy(false);
    }
  };

  const createRoom = () => runRoomAction(
    () => createFocusRoom(supabase),
    '',
  );

  const joinRoom = (event) => {
    event.preventDefault();
    return runRoomAction(() => joinFocusRoom(supabase, roomCode), '');
  };

  const leaveRoom = async () => {
    if (!room) return;
    const leavingHost = room.host_id === account?.id;
    await runRoomAction(async () => {
      await leaveFocusRoom(supabase, room.id);
      setRoomSnapshot(null);
      setPresence({});
      setConnection('offline');
      return null;
    }, leavingHost ? t('roomClosed') : t('leftRoom'));
  };

  const startSession = () => runRoomAction(
    () => startFocusRoomSession(supabase, room.id, focusDuration),
    '',
  );
  const pauseSession = () => runRoomAction(
    () => pauseFocusRoomSession(supabase, room.id),
    '',
  );
  const resumeSession = () => runRoomAction(
    () => resumeFocusRoomSession(supabase, room.id),
    '',
  );
  const startBreak = () => runRoomAction(
    () => startFocusRoomBreak(supabase, room.id, breakDuration),
    '',
  );
  const finishSession = () => runRoomAction(
    () => finishFocusRoomSession(supabase, room.id),
    '',
  );
  const toggleReady = () => runRoomAction(
    () => setFocusRoomReady(supabase, room.id, !ownParticipant?.is_ready),
    '',
  );

  const timerUnavailable = connection !== 'online';
  const roomIsActive = room && room.status !== 'closed';

  const copyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(room.room_code);
      setNotice(t('codeCopied'));
      setError('');
    } catch {
      setError(t('copyFailed'));
    }
  };

  if (!account) {
    return (
      <section className="surface-panel room-auth-note" id="room-foundation">
        <span className="eyebrow">{t('eyebrow')}</span>
        <h2>{t('title')}</h2>
        <p>{t('signInRequired')}</p>
      </section>
    );
  }

  return (
    <section className="room-foundation" id="room-foundation" aria-labelledby="room-foundation-title">
      <div className="surface-panel room-foundation-panel">
        <div className="section-heading room-foundation-heading">
          <div>
            <span className="eyebrow">{t('eyebrow')}</span>
            <h2 id="room-foundation-title">{room ? room.name : t('title')}</h2>
            <p>{room ? t('waitingDescription') : t('description')}</p>
          </div>
          {room && (
            <span className={`room-connection is-${connection}`} role="status">
              <i aria-hidden="true" />
              {t(`connection.${connection}`)}
            </span>
          )}
        </div>

        {loading && <p className="room-message" role="status">{t('loading')}</p>}
        {error && <p className="room-message is-error" role="alert">{error}</p>}
        {notice && <p className="room-message" role="status">{notice}</p>}

        {!loading && !room && (
          <div className="room-entry-grid">
            <div className="room-entry-card">
              <div className="room-entry-icon"><Plus size={18} /></div>
              <h3>{t('createTitle')}</h3>
              <p>{t('createDescription')}</p>
              <button className="primary-button" type="button" disabled={busy} onClick={() => void createRoom()}>
                <Plus size={16} /> {busy ? t('working') : t('create')}
              </button>
            </div>
            <form className="room-entry-card" onSubmit={joinRoom}>
              <div className="room-entry-icon"><LogIn size={18} /></div>
              <label htmlFor="focus-room-code">{t('joinTitle')}</label>
              <p>{t('joinDescription')}</p>
              <input
                id="focus-room-code"
                className="room-code-input"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={8}
                minLength={8}
                pattern="[A-HJ-NP-Z2-9]{8}"
                placeholder={t('codePlaceholder')}
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
              />
              <button className="outline-button" type="submit" disabled={busy || roomCode.length !== 8}>
                <LogIn size={16} /> {busy ? t('working') : t('join')}
              </button>
            </form>
          </div>
        )}

        {!loading && roomIsActive && (
          <>
            <div className="room-code-banner">
              <div>
                <span>{t('roomCode')}</span>
                <strong aria-label={t('roomCode')}>{room.room_code}</strong>
              </div>
              <button className="outline-button" type="button" onClick={() => void copyRoomCode()}>
                <Copy size={15} /> {t('copyCode')}
              </button>
            </div>
            <div className="room-participants-heading">
              <div><Users size={17} /><h3>{t('participants')}</h3></div>
              <span>{room.participants?.length || 0} / {room.capacity}</span>
            </div>
            <ul className="room-participant-list">
              {participants.map((participant) => {
                const online = presence[participant.user_id] === 'online';
                const state = connection === 'unavailable'
                  ? 'unavailable'
                  : online ? 'online' : 'offline';
                return (
                  <li className="room-participant" key={participant.user_id}>
                    <span className="room-participant-avatar" aria-hidden="true">
                      {(participant.display_name || participant.username || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="room-participant-copy">
                      <strong>{participant.display_name || participant.username}</strong>
                      <small>@{participant.username}</small>
                    </span>
                    <span className={`room-role is-${participant.role}`}>{t(`role.${participant.role}`)}</span>
                    <span className={`room-participant-ready ${participant.is_ready ? 'is-ready' : ''}`}>
                      {t(participant.is_ready ? 'session.ready' : 'session.notReady')}
                    </span>
                    <span className={`room-participant-status is-${state}`}>
                      <i aria-hidden="true" /> {t(`presence.${state}`)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="room-session" aria-labelledby="room-session-title">
              <div className="room-session-heading">
                <div><Timer size={17} /><h3 id="room-session-title">{t('session.title')}</h3></div>
                <span className={`room-session-phase is-${room.status}`} role="status">{t(`session.phase.${room.status}`)}</span>
              </div>
              {room.status === 'waiting' ? (
                sessionHost ? (
                  <div className="room-session-controls">
                    <label htmlFor="room-focus-duration">{t('session.focusDuration')}</label>
                    <select
                      id="room-focus-duration"
                      value={focusDuration}
                      disabled={busy || timerUnavailable}
                      onChange={(event) => setFocusDuration(Number(event.target.value))}
                    >
                      {focusDurations.map((seconds) => (
                        <option key={seconds} value={seconds}>{seconds / 60} {t('session.minutes')}</option>
                      ))}
                    </select>
                    <button className="primary-button" type="button" disabled={busy || timerUnavailable || !allParticipantsReady} onClick={() => void startSession()}>
                      <Play size={16} /> {busy ? t('working') : t('session.start')}
                    </button>
                    {!allParticipantsReady && <p className="room-host-note">{t('session.waitingForReady')}</p>}
                  </div>
                ) : <p className="room-host-note">{t('session.hostControls')}</p>
              ) : (
                <>
                  <div className="room-session-clock" aria-label={t('session.timerLabel')} aria-live="off">
                    {formatDuration(room.status === 'break'
                      ? breakRemaining
                      : room.status === 'finished' ? elapsedSeconds : focusRemaining)}
                  </div>
                  <div className="room-session-details">
                    <span>{t('session.elapsed')}: {formatDuration(elapsedSeconds)}</span>
                    <span>{t('session.remaining')}: {formatDuration(focusRemaining)}</span>
                  </div>
                  {(room.status === 'focusing' && focusRemaining === 0)
                    || (room.status === 'break' && breakRemaining === 0)
                    ? <p className="room-host-note" role="status">{t('session.targetReached')}</p>
                    : null}
                  {room.status === 'finished' && (
                    <p className="room-host-note" role="status">{t('session.finished', { elapsed: formatDuration(elapsedSeconds) })}</p>
                  )}
                  {room.status === 'focusing' && (
                    <RoomCameraMonitor
                      roomStatus={room.status}
                      pageActive={pageActive}
                      preferences={profile?.session_preferences}
                      language={language}
                    />
                  )}
                  {sessionHost && room.status !== 'finished' && (
                    <div className="room-session-controls">
                      {room.status === 'focusing' && (
                        <>
                          <button className="outline-button" type="button" disabled={busy || timerUnavailable} onClick={() => void pauseSession()}>
                            <Pause size={16} /> {t('session.pause')}
                          </button>
                          <label htmlFor="room-break-duration">{t('session.breakDuration')}</label>
                          <select
                            id="room-break-duration"
                            value={breakDuration}
                            disabled={busy || timerUnavailable}
                            onChange={(event) => setBreakDuration(Number(event.target.value))}
                          >
                            {breakDurations.map((seconds) => (
                              <option key={seconds} value={seconds}>{seconds / 60} {t('session.minutes')}</option>
                            ))}
                          </select>
                          <button className="outline-button" type="button" disabled={busy || timerUnavailable} onClick={() => void startBreak()}>
                            <Coffee size={16} /> {t('session.startBreak')}
                          </button>
                        </>
                      )}
                      {(room.status === 'paused' || room.status === 'break') && (
                        <button className="primary-button" type="button" disabled={busy || timerUnavailable} onClick={() => void resumeSession()}>
                          <Play size={16} /> {t('session.resume')}
                        </button>
                      )}
                      <button className="outline-button" type="button" disabled={busy || timerUnavailable} onClick={() => void finishSession()}>
                        <Check size={16} /> {t('session.finish')}
                      </button>
                    </div>
                  )}
                  {!sessionHost && room.status !== 'finished' && (
                    <p className="room-host-note">{t('session.hostControls')}</p>
                  )}
                </>
              )}
              {room.status === 'waiting' && (
                <div className="room-ready-control">
                  <p>{t('session.readyDescription')}</p>
                  <button
                    className={ownParticipant?.is_ready ? 'outline-button' : 'primary-button'}
                    type="button"
                    aria-pressed={Boolean(ownParticipant?.is_ready)}
                    disabled={busy || timerUnavailable || !ownParticipant}
                    onClick={() => void toggleReady()}
                  >{t(ownParticipant?.is_ready ? 'session.setNotReady' : 'session.setReady')}</button>
                </div>
              )}
              <p className="room-host-note">{t('session.serverAuthority')}</p>
            </div>
            {sessionHost && <p className="room-host-note">{t('hostLeaveNote')}</p>}
            <button className="outline-button room-leave-button" type="button" disabled={busy} onClick={() => void leaveRoom()}>
              <DoorOpen size={16} /> {t('leave')}
            </button>
          </>
        )}

        {!loading && room && room.status === 'closed' && (
          <div className="room-closed">
            <p role="status">{t('roomClosedDescription')}</p>
            <button className="primary-button" type="button" disabled={busy} onClick={() => void leaveRoom()}>
              <DoorOpen size={16} /> {t('returnToRooms')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
