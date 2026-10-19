export function claimTimerCompletion(state) {
  if (state.current) return false;
  state.current = true;
  return true;
}

export function remainingFocusSeconds(startedAt, durationSeconds, now = Date.now()) {
  if (![startedAt, durationSeconds, now].every(Number.isFinite) || durationSeconds < 0) return 0;
  return Math.max(0, Math.ceil((startedAt + durationSeconds * 1000 - now) / 1000));
}

export function restoreLocalFocusTimer(saved, durationOptions, now = Date.now()) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
  const duration = Number(saved.duration);
  if (!durationOptions.includes(duration) || !Number.isFinite(saved.startedAt)) return null;
  const durationSeconds = duration * 60;
  const sessionId = typeof saved.sessionId === 'string'
    ? { sessionId: saved.sessionId }
    : {};
  if (saved.status === 'save-pending') {
    if (typeof saved.sessionId !== 'string' || !saved.sessionId
      || typeof saved.completed !== 'boolean'
      || !Number.isInteger(saved.remainingSeconds)
      || saved.remainingSeconds < 0
      || saved.remainingSeconds > durationSeconds) return null;
    return {
      duration,
      startedAt: saved.startedAt,
      paused: false,
      remaining: saved.remainingSeconds,
      pendingSave: {
        ...saved,
        status: 'save-pending',
      },
    };
  }
  if (saved.status === 'paused') {
    if (!Number.isInteger(saved.remainingSeconds)
      || saved.remainingSeconds < 0
      || saved.remainingSeconds > durationSeconds) return null;
    return {
      duration,
      startedAt: saved.startedAt,
      paused: true,
      remaining: saved.remainingSeconds,
      ...sessionId,
    };
  }
  if (saved.status !== undefined && saved.status !== 'running') return null;
  return {
    duration,
    startedAt: saved.startedAt,
    paused: false,
    remaining: remainingFocusSeconds(saved.startedAt, durationSeconds, now),
    ...sessionId,
  };
}

export function pauseLocalFocusTimer(startedAt, durationSeconds, now = Date.now()) {
  return remainingFocusSeconds(startedAt, durationSeconds, now);
}

export function resumeLocalFocusTimer(durationSeconds, remainingSeconds, now = Date.now()) {
  if (![durationSeconds, remainingSeconds, now].every(Number.isFinite)
    || durationSeconds < 0
    || !Number.isInteger(remainingSeconds)
    || remainingSeconds < 0
    || remainingSeconds > durationSeconds) return null;
  return now - (durationSeconds - remainingSeconds) * 1000;
}

export async function playSessionCompletionBeep(context) {
  if (!context || typeof context.createOscillator !== 'function' || typeof context.createGain !== 'function') {
    return false;
  }
  try {
    if (context.state === 'suspended') await context.resume();
    if (context.state !== 'running') return false;

    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 740;
    volume.gain.setValueAtTime(0.0001, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.025);
    volume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24);
    oscillator.connect(volume);
    volume.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
    return true;
  } catch {
    return false;
  }
}
