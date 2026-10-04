export function claimTimerCompletion(state) {
  if (state.current) return false;
  state.current = true;
  return true;
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
