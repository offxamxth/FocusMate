import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';
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

function cameraErrorTranslationKey(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'camera.permissionDenied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'camera.notFound';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'camera.inUse';
    default:
      return 'camera.unavailable';
  }
}

function closeDetectors(detectors) {
  detectors?.face?.close();
  detectors?.pose?.close();
}

export default function RoomCameraMonitor({ roomStatus, pageActive, preferences, language }) {
  const [cameraState, setCameraState] = useState('off');
  const [cameraErrorKey, setCameraErrorKey] = useState('');
  const [stream, setStream] = useState(null);
  const [signals, setSignals] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const requestIdRef = useRef(0);
  const eligible = roomCameraEligibility({ roomStatus, pageActive, preferences });
  const eligibleRef = useRef(eligible);
  eligibleRef.current = eligible;
  const configuration = normalizeDetectionConfiguration(preferences);
  const configurationKey = JSON.stringify(configuration);
  const t = (key) => translate(language, `room.camera.${key}`);

  const stopCamera = useCallback(() => {
    requestIdRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setSignals(null);
    setCameraState('off');
    setCameraErrorKey('');
  }, []);

  useEffect(() => {
    if (!eligible) stopCamera();
  }, [eligible, stopCamera]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!stream) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    video.srcObject = stream;
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    if (!stream) return undefined;
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
        if (!cancelled) {
          stopCamera();
          setCameraState('error');
          setCameraErrorKey('camera.analysisUnavailable');
        }
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
        if (!cancelled) {
          stopCamera();
          setCameraState('error');
          setCameraErrorKey('camera.analysisUnavailable');
        }
      }
    };

    setSignals(null);
    void loadDetectors();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      closeDetectors(detectors);
    };
  }, [configurationKey, preferences, stopCamera, stream]);

  const startCamera = async () => {
    if (!eligible || cameraState === 'starting' || streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('error');
      setCameraErrorKey('camera.unavailable');
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setCameraErrorKey('');
    setCameraState('starting');
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user' },
      });
      if (requestId !== requestIdRef.current || !eligibleRef.current) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = nextStream;
      setStream(nextStream);
      setCameraState('active');
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setCameraState('error');
        setCameraErrorKey(cameraErrorTranslationKey(error));
      }
    }
  };

  const reason = preferences?.focus_monitoring !== true
    ? t('disabledInSettings')
    : !(configuration.monitor_looking_away
      || configuration.monitor_posture
      || configuration.monitor_eye_closure
      || configuration.monitor_face_missing
      || configuration.monitor_distance
      || configuration.show_detection_overlay)
      ? t('noSignalsEnabled')
      : !pageActive ? t('openRoomPage') : '';
  const signalKey = signals
    ? signalTranslationKeys[signals.status] || 'camera.noAlert'
    : 'camera.analyzing';

  return (
    <section className="room-local-camera" aria-label={t('title')}>
      <div className="room-local-camera-copy">
        <strong>{t('title')}</strong>
        <p>{t('privacy')}</p>
      </div>
      {eligible ? (
        <div className="room-local-camera-controls">
          {stream ? (
            <button className="outline-button" type="button" onClick={stopCamera}>
              <CameraOff size={15} /> {t('stop')}
            </button>
          ) : (
            <button
              className="outline-button"
              type="button"
              disabled={cameraState === 'starting'}
              onClick={() => void startCamera()}
            >
              <Camera size={15} /> {t(cameraState === 'starting' ? 'starting' : 'start')}
            </button>
          )}
          {cameraErrorKey && <p className="room-local-camera-error" role="alert">{t(cameraErrorKey)}</p>}
          {stream && (
            <div className="room-local-camera-active">
              <video ref={videoRef} autoPlay muted playsInline aria-label={t('preview')} />
              <p role="status">{t(signalKey)}</p>
            </div>
          )}
        </div>
      ) : <p className="room-local-camera-note">{reason}</p>}
    </section>
  );
}
