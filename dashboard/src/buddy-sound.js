export async function playFocusBuddyAppearanceSound(context) {
  if (!context || typeof context.createOscillator !== 'function'
    || typeof context.createGain !== 'function') return false;
  try {
    if (context.state === 'suspended') await context.resume();
    if (context.state !== 'running') return false;

    const notes = [
      { frequency: 587.33, delay: 0 },
      { frequency: 783.99, delay: 0.09 },
    ];
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = note.frequency;
      const startAt = context.currentTime + note.delay;
      volume.gain.setValueAtTime(0.0001, startAt);
      volume.gain.exponentialRampToValueAtTime(0.045, startAt + 0.025);
      volume.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.2);
      oscillator.connect(volume);
      volume.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.21);
    }
    return true;
  } catch {
    return false;
  }
}
