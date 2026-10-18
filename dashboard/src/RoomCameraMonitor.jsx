import { useEffect, useRef, useState } from 'react';
import { translate } from './i18n.js';
import { normalizeDetectionConfiguration } from './session-detection.js';
import { roomCameraEligibility } from './room-camera.js';

const signalTranslationKeys = {
  'No alert signals': 'camera.noAlert',
  'Face Not Detected': 'camera.faceMissing',
  'Checking for shoulders': 'camera.checkingPosture',
  'Reframe to include shoulders': 'camera.includeShoulders',
  'Shoulders temporarily not detected': 'camera.shouldersMissing',
  'Reframe to align shoulders': 'camera.alignShoulders',
  'Head Turn Detected': 'camera.lookingAway',
  'Eyes Closed': 'camera.eyesClosed',
  Slouching: 'camera.slouching',
  'Too Far': 'camera.tooFar',
};

function closeDetectors(detectors) {
  detectors?.face?.close();
  detectors?.pose?.close();
}

export default function RoomCameraMonitor({
  roomStatus,
  pageActive,
  preferences,
  language,
  stream,
}) {
  const [signals, setSignals] = useState(null);
  const [analysisError, setAnalysisError] = useState(false);
  const videoRef = useRef(null);
  const configuration = normalizeDetectionConfiguration(preferences);
  const configurationKey = JSON.stringify(configuration);
  const eligible = roomCameraEligibility({ roomStatus, pageActive, preferences });
  const t = (key) => translate(language, `room.camera.${key}`);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    video.srcObject = stream || null;
    if (stream) {
      void video.play().catch(() => setAnalysisError(true));
    }
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (!eligible || !stream) {
      setSignals(null);
      setAnalysisError(false);
      return undefined;
    }
    let cancelled = false;
    let timeoutId = 0;
    let detectors = null;
    let detecting = false;

    const analyze = async (detectMetrics) => {
      if (cancelled) return;
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || detecting) {
        timeoutId = window.setTimeout(() => void analyze(detectMetrics), 500);
        return;
      }
      detecting = true;
      try {
        const metrics = detectMetrics(
          detectors,
          video,
          performance.now(),
          normalizeDetectionConfiguration(preferences),
        );
        if (!cancelled) setSignals(metrics);
      } catch {
        if (!cancelled) setAnalysisError(true);
        return;
      } finally {
        detecting = false;
      }
      if (!cancelled) timeoutId = window.setTimeout(() => void analyze(detectMetrics), 1400);
    };

    const loadDetectors = async () => {
      try {
        const { createVisionLandmarkers, detectMetrics } = await import('./vision.js');
        detectors = await createVisionLandmarkers(normalizeDetectionConfiguration(preferences));
        if (cancelled) {
          closeDetectors(detectors);
          return;
        }
        await videoRef.current?.play();
        if (!cancelled) void analyze(detectMetrics);
      } catch {
        if (!cancelled) setAnalysisError(true);
      }
    };

    setSignals(null);
    setAnalysisError(false);
    void loadDetectors();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      closeDetectors(detectors);
    };
  }, [configurationKey, eligible, preferences, stream]);

  const reason = preferences?.focus_monitoring !== true
    ? t('disabledInSettings')
    : !(configuration.monitor_looking_away
      || configuration.monitor_posture
      || configuration.monitor_eye_closure
      || configuration.monitor_face_missing
      || configuration.monitor_distance
      || configuration.show_detection_overlay)
      ? t('noSignalsEnabled')
      : !pageActive ? t('openRoomPage') : !stream ? t('waitingForRoomCamera') : '';
  const signalKey = signals
    ? signalTranslationKeys[signals.status] || 'camera.noAlert'
    : 'camera.analyzing';

  return (
    <section className="room-local-camera" aria-label={t('title')}>
      <div className="room-local-camera-copy">
        <strong>{t('title')}</strong>
        <p>{t('privacy')}</p>
      </div>
      {eligible && stream ? (
        <div className="room-local-camera-active">
          <video
            ref={videoRef}
            className="room-analysis-video"
            autoPlay
            muted
            playsInline
            aria-hidden="true"
          />
          {analysisError
            ? <p className="room-local-camera-error" role="alert">{t('analysisUnavailable')}</p>
            : <p role="status">{t(signalKey)}</p>}
        </div>
      ) : <p className="room-local-camera-note">{reason}</p>}
    </section>
  );
}
