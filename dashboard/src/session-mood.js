const moodsNeedingConfirmation = new Set(['Tired', 'Stressed']);

export function shouldConfirmSessionMood(mood) {
  return moodsNeedingConfirmation.has(mood);
}
