export const defaultDetectionConfiguration = Object.freeze({
  monitor_looking_away: true,
  monitor_posture: true,
  monitor_eye_closure: true,
  monitor_face_missing: true,
  monitor_distance: true,
  posture_reminders: true,
  show_detection_overlay: false,
});

const signalPreferences = {
  looking_away: 'monitor_looking_away',
  slouching: 'monitor_posture',
  eyes_closed: 'monitor_eye_closure',
  face_missing: 'monitor_face_missing',
  distance_alert: 'monitor_distance',
};

export function normalizeDetectionConfiguration(configuration = {}) {
  return Object.fromEntries(
    Object.entries(defaultDetectionConfiguration).map(([key, defaultValue]) => [
      key,
      key === 'show_detection_overlay'
        ? configuration[key] === true
        : key === 'posture_reminders'
          ? configuration[key] !== false && configuration.posture_alerts !== false
        : configuration[key] !== false && defaultValue,
    ]),
  );
}

export function isDetectionSignalMonitored(session, signal) {
  const preference = signalPreferences[signal];
  if (!preference) return true;
  return normalizeDetectionConfiguration(session?.detection_configuration)[preference];
}

export function visionTasksForConfiguration(configuration = {}) {
  const settings = normalizeDetectionConfiguration(configuration);
  return {
    face: settings.monitor_looking_away
      || settings.monitor_eye_closure
      || settings.monitor_face_missing
      || settings.monitor_distance
      || settings.show_detection_overlay,
    pose: settings.monitor_posture,
  };
}

export function isDetectionOverlayEnabled(configuration = {}, hidden = false) {
  return !hidden && normalizeDetectionConfiguration(configuration).show_detection_overlay;
}
