import { normalizeDetectionConfiguration, visionTasksForConfiguration } from './session-detection.js';

export function roomCameraEligibility({ roomStatus, pageActive, preferences }) {
  const configuration = normalizeDetectionConfiguration(preferences);
  const tasks = visionTasksForConfiguration(configuration);
  return roomStatus === 'focusing'
    && pageActive === true
    && preferences?.focus_monitoring === true
    && (tasks.face || tasks.pose);
}
