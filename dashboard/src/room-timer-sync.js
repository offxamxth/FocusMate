const subscribers = new Set();
let currentTimerState = null;

export function roomTimerStateFromSnapshot(room, userId, receivedAt = performance.now()) {
  if (!room || !['focusing', 'paused', 'break', 'finished'].includes(room.status)) return null;
  const serverNow = Date.parse(room.server_now || '');
  const durationSeconds = Number(room.session_duration_seconds);
  const elapsedSeconds = Number(room.elapsed_seconds);
  if (!Number.isFinite(serverNow) || !Number.isFinite(durationSeconds) || !Number.isFinite(elapsedSeconds)) {
    return null;
  }
  const participant = room.participants?.find((entry) => entry.user_id === userId);
  return {
    roomId: room.id,
    sessionStartedAt: room.session_started_at,
    durationSeconds,
    status: room.status,
    elapsedSeconds,
    activeSegmentStartedAt: room.active_segment_started_at,
    participantFocusedSeconds: Number(participant?.focused_seconds) || 0,
    participantSegmentStartedAt: participant?.focus_segment_started_at || null,
    serverNow,
    receivedAt,
  };
}

export function elapsedRoomFocusSeconds(timerState, clientPerformanceNow = performance.now()) {
  if (!timerState) return 0;
  let elapsed = Math.max(0, Number(timerState.elapsedSeconds) || 0);
  if (timerState.status === 'focusing' && timerState.activeSegmentStartedAt) {
    const segmentStartedAt = Date.parse(timerState.activeSegmentStartedAt);
    const serverNow = timerState.serverNow + Math.max(0, clientPerformanceNow - timerState.receivedAt);
    if (Number.isFinite(segmentStartedAt)) {
      elapsed += Math.max(0, Math.floor((serverNow - segmentStartedAt) / 1000));
    }
  }
  return Math.min(timerState.durationSeconds, Math.floor(elapsed));
}

export function remainingRoomFocusSeconds(timerState, clientPerformanceNow = performance.now()) {
  if (!timerState) return 0;
  return Math.max(0, timerState.durationSeconds - elapsedRoomFocusSeconds(timerState, clientPerformanceNow));
}

export function elapsedParticipantFocusSeconds(timerState, clientPerformanceNow = performance.now()) {
  if (!timerState) return 0;
  let elapsed = Math.max(0, timerState.participantFocusedSeconds);
  if (timerState.status === 'focusing' && timerState.participantSegmentStartedAt) {
    const segmentStartedAt = Date.parse(timerState.participantSegmentStartedAt);
    const serverNow = timerState.serverNow + Math.max(0, clientPerformanceNow - timerState.receivedAt);
    if (Number.isFinite(segmentStartedAt)) {
      elapsed += Math.max(0, Math.floor((serverNow - segmentStartedAt) / 1000));
    }
  }
  return Math.min(timerState.durationSeconds, Math.floor(elapsed));
}

export function publishRoomTimerState(room, userId) {
  currentTimerState = roomTimerStateFromSnapshot(room, userId);
  subscribers.forEach((subscriber) => subscriber(currentTimerState));
}

export function subscribeToRoomTimerState(subscriber) {
  subscribers.add(subscriber);
  subscriber(currentTimerState);
  return () => subscribers.delete(subscriber);
}
