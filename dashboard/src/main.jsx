import React, { memo, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, levelForXp } from './local-api.js';
import { achievementCatalog, achievementProgress } from './achievement-data.js';
import AuthGate from './AuthGate.jsx';
import {
  claimTimerCompletion,
  pauseLocalFocusTimer,
  playSessionCompletionBeep,
  remainingFocusSeconds,
  restoreLocalFocusTimer,
  resumeLocalFocusTimer,
} from './timer-completion.js';
import {
  supabase,
  supabaseConfigurationError,
  updatePrivateProfile,
} from './lib/supabase.js';
import { dailyFocusSeconds, localDateKey, studyStreak, weekStudyDays } from './progress-data.js';
import {
  browserLanguage,
  supportedLanguages,
  textDirection,
  translate,
  translateAchievement,
} from './i18n.js';
import SocialPage from './SocialPage.jsx';
import LeaderboardPage from './LeaderboardPage.jsx';
import RoomFoundation from './RoomFoundation.jsx';
import FocusBuddyCharacter from './FocusBuddyCharacter.jsx';
import {
  claimFocusmateRoomQuest,
  getFocusmateRoomProgress,
  publishFocusmateRoomProgress,
  rerollFocusmateDailyQuest,
  rerollFocusmateRoomQuest,
} from './room-progress.js';
import ContactPage from './ContactPage.jsx';
import DocumentationPage from './DocumentationPage.jsx';
import PublicPages, { PUBLIC_PAGE_METADATA } from './PublicPages.jsx';
import PwaControls from './PwaControls.jsx';
import { pwaSurfaceForApp } from './pwa-presentation.js';
import {
  isUnknownPath,
  mobileDestinationFromLocation,
  navigationPath,
  pageFromLocation,
  publicPageFromLocation,
} from './navigation.js';
import { reportPwaSessionActivity } from './pwa-session-state.js';
import {
  focusBuddyCharacters,
  focusMoods,
  normalizeFocusBuddyPreferences,
  claimWaterReminderResponse,
  readWaterReminderSchedule,
  scheduleNextWaterReminder,
  waterReminderIntervals,
  waterReminderSnoozes,
  waterReminderDelayMs,
  waterReminderStorageKey,
  transitionFocusBuddyAnimation,
  waterReminderDelayForAction,
} from './focus-buddy.js';
import {
  elapsedParticipantFocusSeconds,
  remainingRoomFocusSeconds,
  subscribeToRoomTimerState,
} from './room-timer-sync.js';
import {
  Activity, ArrowUpRight, Award, BarChart3, BookOpen, Check, ChevronDown, CircleHelp,
  Clock3, Coffee, Droplets, Flame, Focus, Heart, Home, ListTodo, LockKeyhole, LogOut,
  Moon, MoreHorizontal, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles,
  Sun, Timer, Trophy, UserRound, Users, Video, VideoOff, X,
} from 'lucide-react';
import './style.css';
import {
  defaultDetectionConfiguration,
  isDetectionOverlayEnabled,
  isDetectionSignalMonitored,
  normalizeDetectionConfiguration,
  visionTasksForConfiguration,
} from './session-detection.js';

const pages = [
  { id: 'overview', label: 'nav.overview', group: 'nav.yourSpace', icon: Home },
  { id: 'focus-room', label: 'nav.focusRoom', group: 'nav.yourSpace', icon: Timer },
  { id: 'friends', label: 'nav.friends', group: 'nav.social', icon: Users, requiresCloud: true },
  { id: 'leaderboard', label: 'nav.leaderboard', group: 'nav.social', icon: Trophy, requiresCloud: true },
  { id: 'insights', label: 'nav.progress', group: 'nav.yourSpace', icon: BarChart3 },
  { id: 'session-results', label: 'nav.sessionResults', group: 'nav.yourSpace', icon: Sparkles },
  { id: 'achievements', label: 'nav.achievements', group: 'nav.habits', icon: Trophy },
  { id: 'quests', label: 'nav.quests', group: 'nav.habits', icon: Award },
  { id: 'session-preferences', label: 'nav.preferences', group: 'nav.habits', icon: Settings2 },
  { id: 'profile', label: 'nav.profile', group: 'nav.habits', icon: UserRound },
  { id: 'contact', label: 'nav.contact', group: 'nav.habits', icon: CircleHelp },
  { id: 'documentation', label: 'nav.documentation', group: 'nav.habits', icon: BookOpen },
];

const mobileDestinations = [
  { id: 'overview', page: 'overview', target: null, label: 'nav.overview', icon: Home },
  { id: 'tasks', page: 'overview', target: 'today-tasks', label: 'nav.tasks', icon: ListTodo },
  { id: 'focus', page: 'focus-room', target: 'focus-timer', label: 'nav.focus', icon: Focus },
  { id: 'rooms', page: 'focus-room', target: 'room-foundation', label: 'nav.rooms', icon: Users },
  { id: 'profile', page: 'profile', target: null, label: 'nav.profileShort', icon: UserRound },
];
const mobileDestinationIds = new Set(mobileDestinations.map((item) => item.id));

const achievements = achievementCatalog;
const cameraSignalSubscribers = new Set();

function publishCameraSignals(live) {
  cameraSignalSubscribers.forEach((subscriber) => subscriber(live));
}

const CameraDetectionOverlay = memo(function CameraDetectionOverlay({ live, configuration, language }) {
  const [signals, setSignals] = useState(live);
  const [hidden, setHidden] = useState(false);
  const [technical, setTechnical] = useState(false);
  const t = (key) => translate(language, `focus.${key}`);

  useEffect(() => {
    const update = (value) => setSignals(value);
    cameraSignalSubscribers.add(update);
    return () => cameraSignalSubscribers.delete(update);
  }, []);
  useEffect(() => setSignals((current) => ({
    ...live,
    ...(current.session_id === live.session_id
      ? Object.fromEntries(['ear', 'head_turn_ratio', 'posture_angle', 'shoulder_tilt_angle', 'distance_ratio', 'thresholds']
        .filter((key) => current[key] !== undefined)
        .map((key) => [key, current[key]]))
      : {}),
  })), [
    live.face_detected,
    live.looking_away,
    live.eyes_closed,
    live.posture,
    live.ear,
    live.head_turn_ratio,
    live.posture_angle,
    live.shoulder_tilt_angle,
    live.distance_ratio,
    live.thresholds,
    live.last_updated,
  ]);
  useEffect(() => {
    setHidden(false);
    setTechnical(false);
  }, [live.session_id]);

  const monitoredValue = (enabled, value) => !enabled
    ? t('notMonitored')
    : value === null || value === undefined ? t('waitingSignals') : value;
  const faceEnabled = configuration.monitor_face_missing;
  const faceValue = !faceEnabled
    ? t('notMonitored')
    : signals.face_detected === null || signals.face_detected === undefined
      ? t('waitingSignals') : signals.face_detected ? t('detected') : t('notDetected');
  const lookingValue = monitoredValue(
    configuration.monitor_looking_away,
    signals.looking_away === null || signals.looking_away === undefined
      ? null : signals.looking_away ? t('yes') : t('no'),
  );
  const postureValue = monitoredValue(
    configuration.monitor_posture,
    signals.posture && signals.posture !== 'Unknown' && signals.posture !== 'Not monitored'
      ? translate(language, `focus.postureState.${signals.posture}`) : null,
  );
  const eyesValue = monitoredValue(
    configuration.monitor_eye_closure,
    signals.eyes_closed === null || signals.eyes_closed === undefined
      ? null : signals.eyes_closed ? t('detected') : t('notDetected'),
  );
  const distanceValue = monitoredValue(
    configuration.monitor_distance,
    signals.distance_status && signals.distance_status !== 'Unknown' && signals.distance_status !== 'Not monitored'
      ? translate(language, `focus.distanceState.${signals.distance_status === 'Too Far' ? 'tooFar' : 'good'}`)
      : null,
  );

  if (!isDetectionOverlayEnabled(configuration)) return null;
  return (
    <>
      {hidden ? (
        <button className="detection-overlay-show" onClick={() => setHidden(false)}>{t('showOverlay')}</button>
      ) : (
        <section className="detection-overlay" aria-label={t('detectionOverlay')}>
          <div className="detection-overlay-heading">
            <strong>{t('detectionOverlay')}</strong>
            <button className="detection-overlay-action" onClick={() => setHidden(true)}>{t('hideOverlay')}</button>
          </div>
          <dl>
            <div><dt>{t('face')}</dt><dd>{faceValue}</dd></div>
            <div><dt>{t('lookingAway')}</dt><dd>{lookingValue}</dd></div>
            <div><dt>{t('posture')}</dt><dd>{postureValue}</dd></div>
            <div><dt>{t('eyeClosure')}</dt><dd>{eyesValue}</dd></div>
            <div><dt>{t('screenDistance')}</dt><dd>{distanceValue}</dd></div>
          </dl>
          <button className="detection-overlay-action" aria-expanded={technical} onClick={() => setTechnical((value) => !value)}>{technical ? t('hideTechnical') : t('showTechnical')}</button>
          {technical && (
            <dl className="detection-technical">
              <div><dt>EAR</dt><dd>{configuration.monitor_eye_closure ? signals.ear ?? '—' : t('notMonitored')} {configuration.monitor_eye_closure && <small>{t('below')} {signals.thresholds?.ear_closed_below ?? 0.2}</small>}</dd></div>
              <div><dt>{t('headTurnProxy')}</dt><dd>{configuration.monitor_looking_away ? signals.head_turn_ratio ?? '—' : t('notMonitored')} {configuration.monitor_looking_away && <small>{t('threshold')} {signals.thresholds?.head_turn_ratio_above ?? 0.24}</small>}</dd></div>
              <div><dt>{t('postureAngle')}</dt><dd>{configuration.monitor_posture ? signals.posture_angle ?? '—' : t('notMonitored')} {configuration.monitor_posture && <small>{t('below')} {signals.thresholds?.slouch_angle_below_degrees ?? 52}°</small>}</dd></div>
              <div><dt>{t('shoulderTilt')}</dt><dd>{configuration.monitor_posture ? signals.shoulder_tilt_angle ?? '—' : t('notMonitored')} {configuration.monitor_posture && <small>{signals.thresholds?.shoulder_tilt_activate_degrees ?? 17}° / {signals.thresholds?.shoulder_tilt_clear_degrees ?? 12}°</small>}</dd></div>
              <div><dt>{t('screenDistance')}</dt><dd>{configuration.monitor_distance ? signals.distance_ratio ?? '—' : t('notMonitored')} {configuration.monitor_distance && <small>{t('below')} {signals.thresholds?.distance_face_width_below ?? 0.12}</small>}</dd></div>
            </dl>
          )}
        </section>
      )}
    </>
  );
});

function saveProfile(username, profile) {
  return api(`/api/state?username=${encodeURIComponent(username)}`, {
    method: 'PUT', body: JSON.stringify({ profile }),
  });
}

function cameraStatusText(state, live, language) {
  const t = (key) => translate(language, `focus.${key}`);
  if (state === 'unavailable') return t('cameraUnavailable');
  if (state === 'permission-denied') return t('permissionDenied');
  if (state === 'starting') return t('cameraStarting');
  if (state === 'analysis-error') return t('analysisUnavailable');
  if (state === 'analysis-unavailable') return t('cameraAnalysisUnavailable');
  if (state !== 'active') return t('cameraOff');
  if (!live.last_updated) return t('waitingSignals');
  if (live.face_detected === false) return t('faceNotDetected');
  if (live.pose_detection_status === 'temporarily-missing') return t('shouldersTemporary');
  if (live.pose_detection_status === 'checking') return t('checkingShoulders');
  if (live.pose_detection_status === 'missing') return t('includeShoulders');
  if (live.pose_detection_status === 'detected') {
    const detail = live.status && live.status !== 'No alert signals' ? ` · ${live.status}` : '';
    return `${t('shouldersDetected')}${detail}`;
  }
  return `${t('cameraActive')} · ${live.status || t('analyzingSignals')}`;
}

function postureStatusText(state, live, language) {
  const t = (key) => translate(language, `focus.${key}`);
  if (state === 'starting') return t('cameraStarting');
  if (state === 'permission-denied') return t('permissionDenied');
  if (state === 'unavailable') return t('cameraUnavailable');
  if (state === 'analysis-error' || state === 'analysis-unavailable') return t('cameraAnalysisUnavailable');
  if (state !== 'active' || !live.last_updated) return t('waitingSignals');
  if (live.pose_detection_status === 'temporarily-missing') return t('shouldersTemporary');
  if (live.pose_detection_status === 'checking') return t('checkingShoulders');
  if (live.pose_detection_status === 'missing') return t('includeShoulders');
  return live.pose_detected ? live.posture || t('unknown') : t('checkingShoulders');
}

class AppErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) console.error('FocusMate render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="welcome-page">
        <section className="welcome-form" role="alert">
          <div className="welcome-kicker">FOCUSMATE NEEDS A MOMENT</div>
          <h1>Your profile is still saved.</h1>
          <p>Something went wrong while opening this page. Reload FocusMate to try again. Your saved profile and progress have not been deleted.</p>
          {import.meta.env.DEV && <pre>{this.state.error.message}</pre>}
          <button className="primary-button" onClick={() => window.location.reload()}>Reload FocusMate</button>
        </section>
      </main>
    );
  }
}

function FocusMateApp({
  account = null,
  onCloudSignOut = null,
  onCloudLogin = null,
  cloudConfigurationError = '',
  onPwaSurfaceChange,
}) {
  const [username, setUsername] = useState(account?.storageUsername || localStorage.getItem('focusmate-user') || '');
  const [profile, setProfile] = useState(null);
  const [roomProgress, setRoomProgress] = useState(null);
  const roomProgressRef = useRef(null);
  const [live, setLive] = useState({});
  const [page, setPage] = useState(() => pageFromLocation(window.location));
  const [mobileDestination, setMobileDestination] = useState(
    () => mobileDestinationFromLocation(window.location),
  );
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [loading, setLoading] = useState(Boolean(account?.storageUsername || username));
  const [notice, setNotice] = useState('');
  const [camera, setCamera] = useState(null);
  const [cameraState, setCameraState] = useState(
    () => navigator.mediaDevices?.getUserMedia ? 'off' : 'unavailable',
  );
  const [cameraError, setCameraError] = useState('');
  const [stream, setStream] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('focusmate-theme') || 'dark');
  const storedLanguage = localStorage.getItem('focusmate-language');
  const profileLanguage = profile?.session_preferences?.language;
  const language = supportedLanguages.includes(storedLanguage)
    ? storedLanguage
    : supportedLanguages.includes(profileLanguage) ? profileLanguage : browserLanguage();
  const activeDetectionConfiguration = normalizeDetectionConfiguration(
    camera?.live?.session_configuration || defaultDetectionConfiguration,
  );
  const activeVisionTasks = visionTasksForConfiguration(activeDetectionConfiguration);
  const videoRef = useRef(null);
  const miniVideoRef = useRef(null);
  const visionRef = useRef(null);
  const streamRef = useRef(null);
  const cameraStartGenerationRef = useRef(0);
  const cameraBackendActiveRef = useRef(false);
  const detectionConfigurationRef = useRef(activeDetectionConfiguration);
  const detectionConfigurationVersionRef = useRef(
    camera?.live?.detection_configuration_version ?? null,
  );
  const postureNoticeRef = useRef('');
  detectionConfigurationRef.current = activeDetectionConfiguration;
  detectionConfigurationVersionRef.current = camera?.live?.detection_configuration_version ?? null;

  useEffect(() => {
    onPwaSurfaceChange?.(pwaSurfaceForApp({ loading, profile, page }));
  }, [loading, onPwaSurfaceChange, page, profile]);

  const presentProfile = (value, trustedProgress = roomProgressRef.current) => {
    if (!account) return value;
    const trustedAwards = new Map(
      (trustedProgress?.achievements || []).map((record) => [record.id, record]),
    );
    const existingAwards = (value.achievements || []).filter((record) => {
      const id = typeof record === 'string' ? record : record?.id;
      return !String(id || '').startsWith('room_') && !String(id || '').startsWith('friend_');
    });
    for (const [id, record] of trustedAwards) {
      existingAwards.push(record);
    }
    return {
      ...value,
      username: account.username,
      total_xp: Number.isFinite(Number(trustedProgress?.total_xp))
        ? Number(trustedProgress.total_xp)
        : value.total_xp,
      available_xp: trustedProgress?.xp_balance === null || trustedProgress?.xp_balance === undefined
        ? null
        : Number.isFinite(Number(trustedProgress.xp_balance))
          ? Number(trustedProgress.xp_balance)
          : null,
      room_progress: trustedProgress?.room_progress || {},
      room_daily_quests: trustedProgress?.room_daily_quests || value.room_daily_quests || null,
      daily_quests: trustedProgress?.daily_quests || null,
      reroll_tokens: trustedProgress?.reroll_tokens ?? null,
      rerolls_remaining_today: trustedProgress?.rerolls_remaining_today ?? null,
      achievements: existingAwards,
    };
  };

  useEffect(() => {
    const updateRoomProgress = (event) => {
      const update = event.detail || {};
      setRoomProgress((current) => {
        const next = { ...current, ...update };
        roomProgressRef.current = next;
        return next;
      });
    };
    window.addEventListener('focusmate:room-progress-updated', updateRoomProgress);
    return () => window.removeEventListener('focusmate:room-progress-updated', updateRoomProgress);
  }, []);

  useEffect(() => {
    roomProgressRef.current = null;
    setRoomProgress(null);
  }, [account?.id]);

  useEffect(() => {
    if (!account || !profile) return undefined;
    let active = true;
    getFocusmateRoomProgress(supabase)
      .then((progress) => {
        if (active) {
          roomProgressRef.current = progress;
          setRoomProgress(progress);
        }
      })
      .catch((progressError) => {
        if (active) setNotice(progressError.message);
      });
    return () => { active = false; };
  }, [account?.id, Boolean(profile)]);

  useEffect(() => {
    if (!roomProgress) return;
    setProfile((current) => {
      if (!current) return current;
      const next = presentProfile(current, roomProgress);
      void api(`/api/state?username=${encodeURIComponent(username)}`, {
        method: 'PUT',
        body: JSON.stringify({ profile: next }),
      }).catch((error) => inform(error.message));
      return next;
    });
  }, [roomProgress]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('focusmate-theme', theme);
  }, [theme]);

  useEffect(() => {
    const preference = profile?.session_preferences?.theme || 'system';
    if (preference !== 'system') {
      setTheme(preference);
      return undefined;
    }
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!media) {
      setTheme('dark');
      return undefined;
    }
    const syncTheme = () => setTheme(media.matches ? 'light' : 'dark');
    syncTheme();
    media.addEventListener?.('change', syncTheme);
    return () => media.removeEventListener?.('change', syncTheme);
  }, [profile?.username, profile?.session_preferences?.theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = textDirection(language);
    window.dispatchEvent(new Event('focusmate:language-changed'));
  }, [language]);

  useEffect(() => {
    reportPwaSessionActivity('camera', Boolean(live.session_active));
    return () => reportPwaSessionActivity('camera', false);
  }, [live.session_active]);

  useEffect(() => {
    const syncError = (event) => inform(event.detail?.message || 'Cloud profile sync failed.');
    window.addEventListener('focusmate:cloud-sync-error', syncError);
    return () => window.removeEventListener('focusmate:cloud-sync-error', syncError);
  }, []);

  useEffect(() => {
    const syncPage = () => {
      setPage(pageFromLocation(window.location));
      setMobileDestination(mobileDestinationFromLocation(window.location));
      setMobileMoreOpen(false);
    };
    window.addEventListener('popstate', syncPage);
    window.addEventListener('hashchange', syncPage);
    return () => {
      window.removeEventListener('popstate', syncPage);
      window.removeEventListener('hashchange', syncPage);
    };
  }, []);

  useEffect(() => {
    if (!mobileMoreOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileMoreOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileMoreOpen]);

  useEffect(() => {
    if (!account && page === 'friends') {
      setPage('overview');
      setMobileDestination('overview');
      window.history.replaceState({}, '', navigationPath('overview'));
    }
  }, [account, page]);

  useEffect(() => {
    const destination = mobileDestinations.find((item) => item.id === mobileDestination);
    if (!profile) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (destination?.target) {
        document.getElementById(destination.target)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobileDestination, page, Boolean(profile)]);

  useEffect(() => {
    if (!username) {
      setProfile(null);
      setLive({});
      setLoading(false);
      return undefined;
    }
    let current = true;
    setLoading(true);
    api(`/api/state?username=${encodeURIComponent(username)}`)
      .then((data) => {
        if (current) {
          setProfile(presentProfile(data.profile));
          setLive(data.live);
          if (data.live.session_interrupted) {
            setNotice('Your camera session was interrupted by a reload. Only the last recorded session time was kept.');
          }
        }
      })
      .catch((error) => {
        if (current) { setNotice(error.message); setUsername(''); localStorage.removeItem('focusmate-user'); }
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [username]);

  useEffect(() => {
    if (!username) return undefined;
    let current = true;
    const timer = window.setInterval(() => {
      api(`/api/state?username=${encodeURIComponent(username)}`)
        .then((data) => { if (current) { setLive(data.live); setProfile(presentProfile(data.profile)); } })
        .catch(() => {});
    }, 2200);
    return () => { current = false; window.clearInterval(timer); };
  }, [username]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
    if (miniVideoRef.current && stream) miniVideoRef.current.srcObject = stream;
  }, [stream, page]);

  useEffect(() => {
    if (!stream || !camera) return undefined;
    let stopped = false;
    let busy = false;
    let analysisFailed = false;
    let detectors = visionRef.current;
    let detectFrameMetrics;
    let timeout;
    const analyze = async () => {
      if (stopped || busy) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        timeout = window.setTimeout(analyze, 300);
        return;
      }
      busy = true;
      try {
        const configuration = detectionConfigurationRef.current;
        const metrics = detectFrameMetrics(detectors, video, performance.now(), configuration);
        const configurationVersion = detectionConfigurationVersionRef.current;
        const data = await api(`/api/camera/telemetry?username=${encodeURIComponent(username)}`, {
          method: 'POST',
          body: JSON.stringify({
            ...metrics,
            detection_configuration_version: configurationVersion,
          }),
        });
        if (!stopped && !data.ignored_stale_configuration) {
          publishCameraSignals({ ...data.live, ...metrics });
          if (analysisFailed) {
            analysisFailed = false;
            setCameraState('active');
            setCameraError('');
          }
        }
      } catch (error) {
        if (!stopped && !analysisFailed) {
          analysisFailed = true;
          setCameraState('analysis-error');
          setCameraError(error.message || 'Webcam analysis stopped unexpectedly.');
          inform(error.message || 'Webcam analysis stopped unexpectedly.');
        }
      } finally {
        busy = false;
        if (!stopped) timeout = window.setTimeout(analyze, 1400);
      }
    };
    const loadAndAnalyze = async () => {
      try {
        const { createVisionLandmarkers, detectMetrics } = await import('./vision.js');
        detectFrameMetrics = detectMetrics;
        if (!detectors) {
          const loadedDetectors = await createVisionLandmarkers(detectionConfigurationRef.current);
          if (stopped) {
            loadedDetectors?.face?.close();
            loadedDetectors?.pose?.close();
            return;
          }
          detectors = loadedDetectors;
          visionRef.current = detectors;
        }
        if (!stopped) analyze();
      } catch (error) {
        if (!stopped) {
          setCameraState('analysis-error');
          setCameraError(error.message || 'Webcam analysis could not be loaded.');
          inform(`Could not load webcam analysis: ${error.message}`);
        }
      }
    };
    loadAndAnalyze();
    return () => {
      stopped = true;
      window.clearTimeout(timeout);
      detectors?.face?.close();
      detectors?.pose?.close();
      if (visionRef.current === detectors) visionRef.current = null;
    };
  }, [stream, username, activeVisionTasks.face, activeVisionTasks.pose]);

  const updateProfile = async (change) => {
    const previousPreferences = profile?.session_preferences || {};
    const nextPreferences = change.session_preferences;
    const previousConfiguration = normalizeDetectionConfiguration(previousPreferences);
    const nextConfiguration = nextPreferences
      ? normalizeDetectionConfiguration(nextPreferences)
      : null;
    const detectionConfigurationChanged = nextPreferences && Object.keys(defaultDetectionConfiguration).some(
      (key) => previousConfiguration[key] !== nextConfiguration[key],
    );
    setProfile((current) => current ? presentProfile({ ...current, ...change }) : current);
    try {
      await saveProfile(username, change);
    } catch (error) {
      setNotice(error.message);
      return;
    }
    if (live.session_active && detectionConfigurationChanged && nextConfiguration) {
      try {
        const data = await api(`/api/webcam/configuration?username=${encodeURIComponent(username)}`, {
          method: 'POST',
          body: JSON.stringify({ session_configuration: nextConfiguration }),
        });
        setLive(data.live);
        setCamera((current) => current ? { ...current, live: data.live } : current);
      } catch (error) {
        setNotice(`Preferences were saved, but active-session detection settings could not be applied: ${error.message}`);
      }
    }
    if (account && (Object.hasOwn(change, 'player_name') || Object.hasOwn(change, 'session_preferences'))) {
      try {
        await updatePrivateProfile(supabase, account.id, change);
      } catch (error) {
        setNotice(`Your local changes were saved, but the cloud profile could not be updated: ${error.message}`);
      }
    }
  };

  const rerollQuest = async (questId) => {
    if (!account) throw new Error('Verified reroll tokens require a cloud account.');
    const result = await rerollFocusmateDailyQuest(
      supabase,
      questId,
      window.crypto.randomUUID(),
    );
    publishFocusmateRoomProgress(result);
  };

  const rerollRoomQuest = async (questId) => {
    const result = await rerollFocusmateRoomQuest(
      supabase,
      questId,
      window.crypto.randomUUID(),
    );
    publishFocusmateRoomProgress(result);
  };

  const claimRoomQuest = async (questId) => {
    const result = await claimFocusmateRoomQuest(
      supabase,
      questId,
      window.crypto.randomUUID(),
    );
    publishFocusmateRoomProgress(result);
  };

  const inform = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3600);
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    if (profile) {
      updateProfile({
        session_preferences: {
          ...profile.session_preferences,
          theme: nextTheme,
        },
      });
    }
  };

  useEffect(() => {
    const reminderEnabled = live.session_configuration
      ? live.session_configuration.posture_reminders
      : profile?.session_preferences?.posture_alerts;
    if (!live.posture_alert_pending || !reminderEnabled) return;
    if (postureNoticeRef.current === live.session_id) return;
    postureNoticeRef.current = live.session_id;
    inform('A gentle posture check-in: relax your shoulders or take a short stretch.');
  }, [live.posture_alert_pending, live.session_id, live.session_configuration?.posture_reminders, profile?.session_preferences?.posture_alerts]);

  const login = async (name, handle) => {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ name, username: handle }) });
    setUsername(data.profile.username);
    if (!account) localStorage.setItem('focusmate-user', data.profile.username);
    setProfile(presentProfile(data.profile));
    setLive(data.live);
    const destination = window.location.pathname.replace(/\/+$/, '') === '/contact' ? 'contact' : 'overview';
    setPage(destination);
    setMobileDestination(destination);
    window.history.replaceState({}, '', navigationPath(destination));
  };

  const logout = async () => {
    if (live.session_active) {
      try {
        const data = await api(`/api/webcam/stop?username=${encodeURIComponent(username)}`, { method: 'POST', body: '{}' });
        cameraBackendActiveRef.current = false;
        setLive(data.live || {});
      } catch (error) {
        inform(`The active camera session could not be saved: ${error.message}`);
        return;
      }
    }
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (account && onCloudSignOut) {
      try {
        await onCloudSignOut();
      } catch (error) {
        inform(`You could not be signed out: ${error.message}`);
      }
      return;
    }
    setStream(null); setCamera(null); setProfile(null); setUsername('');
    setCameraState(navigator.mediaDevices?.getUserMedia ? 'off' : 'unavailable');
    setCameraError('');
    localStorage.removeItem('focusmate-user');
  };

  const startCamera = async (plan) => {
    const generation = ++cameraStartGenerationRef.current;
    const isCurrent = () => generation === cameraStartGenerationRef.current;
    let nextStream;
    let detectors;
    const sessionConfiguration = normalizeDetectionConfiguration(
      plan.session_configuration || profile.session_preferences,
    );
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      setCameraError('This browser does not provide webcam access. Use a supported browser on HTTPS or localhost.');
      return;
    }
    if (!profile.session_preferences?.focus_monitoring) {
      setCameraState('unavailable');
      setCameraError('Webcam monitoring is turned off in session preferences. Your focus session will continue without the camera.');
      return;
    }
    setCameraState('starting');
    setCameraError('');
    try {
      // Invoke getUserMedia directly from the Start Focus action. Do not let a
      // module download delay the browser's permission request.
      const mediaRequest = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      nextStream = await mediaRequest;
      if (!isCurrent()) {
        nextStream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = nextStream;
      for (const track of nextStream.getTracks()) {
        track.addEventListener('ended', () => {
          if (streamRef.current !== nextStream) return;
          streamRef.current = null;
          setStream(null);
          setCameraState('unavailable');
          setCameraError('The camera disconnected. Your focus timer is still running.');
        }, { once: true });
      }
      setStream(nextStream);
      setCameraState('active');
      const { createVisionLandmarkers } = await import('./vision.js');
      if (!isCurrent()) return;
      detectors = await createVisionLandmarkers(sessionConfiguration);
      if (!isCurrent()) {
        detectors?.face?.close();
        detectors?.pose?.close();
        nextStream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }
      visionRef.current = detectors;
      setCameraState('active');
    } catch (error) {
      detectors?.face?.close();
      detectors?.pose?.close();
      if (!isCurrent()) return;
      if (!nextStream) {
        nextStream?.getTracks().forEach((track) => track.stop());
        if (streamRef.current === nextStream) streamRef.current = null;
      }
      const permissionDenied = !nextStream && ['NotAllowedError', 'SecurityError'].includes(error.name);
      setCameraState(permissionDenied ? 'permission-denied' : nextStream ? 'analysis-unavailable' : 'unavailable');
      setCameraError(error.message || 'The camera could not be started.');
    }
  };

  const stopCamera = () => {
    cameraStartGenerationRef.current += 1;
    const activeStream = streamRef.current || stream;
    activeStream?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null); setCamera(null);
    setCameraState(navigator.mediaDevices?.getUserMedia ? 'off' : 'unavailable');
    setCameraError('');
  };

  useEffect(() => {
    if (page !== 'focus-room' && (streamRef.current || stream)) stopCamera();
  }, [page]);

  const endFocusSession = async () => {
    stopCamera();
    if (!cameraBackendActiveRef.current && !live.session_active) return;
    cameraBackendActiveRef.current = false;
    try {
      const data = await api(`/api/webcam/stop?username=${encodeURIComponent(username)}`, { method: 'POST', body: '{}' });
      setLive(data.live || {}); inform(data.message);
    } catch (error) {
      inform(`The camera stopped, but its session could not be saved: ${error.message}`);
    }
  };

  const beginFocusSession = async (plan) => {
    try {
      const data = await api(`/api/webcam/start?username=${encodeURIComponent(username)}`, {
        method: 'POST',
        body: JSON.stringify({
          ...plan,
          session_only: true,
          session_configuration: normalizeDetectionConfiguration(
            plan.session_configuration || profile.session_preferences,
          ),
        }),
      });
      if (data.live.session_started_at !== plan.session_started_at) {
        throw new Error('Another focus session is already active. End it before starting a new session.');
      }
      cameraBackendActiveRef.current = true;
      setLive(data.live);
      setCamera({ live: data.live });
      return true;
    } catch (error) {
      inform(`Your timer is running, but this focus session could not be recorded: ${error.message}`);
      return false;
    }
  };

  useEffect(() => {
    const stopTracksOnPageHide = () => {
      cameraStartGenerationRef.current += 1;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    window.addEventListener('pagehide', stopTracksOnPageHide);
    return () => window.removeEventListener('pagehide', stopTracksOnPageHide);
  }, []);

  if (loading) return <div className="boot-screen"><span className="brand-mark">f<span>✳</span></span><span>{translate(language, 'app.opening')}</span></div>;
  if (!profile) return <Welcome onLogin={login} onCloudLogin={onCloudLogin} cloudConfigurationError={cloudConfigurationError} notice={notice} />;

  const visiblePages = pages.filter((item) => !item.requiresCloud || Boolean(account));
  const visibleGroups = ['nav.yourSpace', 'nav.habits', ...(account ? ['nav.social'] : [])];
  const current = visiblePages.find((item) => item.id === page) || visiblePages[0];
  const xp = Number(profile.total_xp || 0);
  const level = levelForXp(xp);
  const focusActive = Boolean(live.session_active);
  const secondaryPages = visiblePages.filter((item) =>
    !mobileDestinationIds.has(item.id) && item.id !== 'focus-room',
  );
  const secondaryPageIsActive = secondaryPages.some((item) => item.id === page);
  const changePage = (id, destination = id) => {
    if (!visiblePages.some((item) => item.id === id)) return;
    setPage(id);
    const nextDestination = destination === 'focus-room' ? 'focus' : destination;
    setMobileDestination(nextDestination);
    setMobileMoreOpen(false);
    const path = navigationPath(destination);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== path) {
      window.history.pushState({}, '', path);
    } else {
      const target = mobileDestinations.find((item) => item.id === destination)?.target;
      if (target) {
        window.requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        }));
      }
    }
  };

  return (
    <div className={`app-shell ${collapsed ? 'nav-collapsed' : ''}`} data-study-style={profile.session_preferences?.study_style || 'normal'}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <a className="brand-lockup" href="#overview" aria-label="FocusMate home" onClick={(event) => { event.preventDefault(); changePage('overview'); }}>focus<span>mate</span><i>✳</i></a>
          <div className="sidebar-actions">
            <button className="icon-button theme-toggle" aria-label="Toggle theme" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="icon-button collapse-button" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed((value) => !value)}><ChevronDown size={17} /></button>
          </div>
        </div>
        <div className="user-block">
          <div className="avatar">{(profile.player_name || 'F').slice(0, 1).toUpperCase()}</div>
          <div className="user-copy"><span>{translate(language, 'app.welcomeBack').toUpperCase()}</span><strong>{profile.player_name}</strong><small>@{account?.username || profile.username}</small></div>
          <button className="icon-button mobile-logout" title={translate(language, 'auth.logOut')} aria-label={translate(language, 'auth.logOut')} onClick={logout}><LogOut size={16} /></button>
        </div>
        <div className="level-block">
          <div className="level-copy"><span>{translate(language, 'app.level')} {level}</span><strong>{xp.toLocaleString(language)} <small>XP</small></strong></div>
          <div className="level-track"><span style={{ width: `${xp % 100}%` }} /></div>
          <small>{100 - (xp % 100)} XP {translate(language, 'app.toNextLevel')}</small>
        </div>
        {visibleGroups.map((group) => (
          <nav className="nav-group" key={group} aria-label={translate(language, group)}>
            <span className="nav-label">{translate(language, group)}</span>
            {visiblePages.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => changePage(item.id)} title={translate(language, item.label)} aria-label={translate(language, item.label)} aria-current={page === item.id ? 'page' : undefined}><Icon size={18} /><span>{translate(language, item.label)}</span>{item.id === 'focus-room' && focusActive && <i className="live-dot" />}</button>;
            })}
          </nav>
        ))}
        <div className="sidebar-bottom">
          {stream && <div className="camera-mini"><video ref={miniVideoRef} autoPlay muted playsInline /><div><span className="live-dot" /> {translate(language, 'focus.cameraOn').toUpperCase()}</div></div>}
          <p>{translate(language, 'app.progressNotPerfection')}<br />{translate(language, 'app.takeCare')}</p>
          <button className="switch-profile" onClick={logout}><LogOut size={15} /> {translate(language, 'auth.logOut')}</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="mobile-header">
          <a className="brand-lockup" href="#overview" aria-label={translate(language, 'app.home')} onClick={(event) => { event.preventDefault(); changePage('overview'); }}>focus<span>mate</span><i>✳</i></a>
          <div className="mobile-header-actions">
            <button className="icon-button theme-toggle" aria-label={translate(language, 'app.toggleTheme')} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
            <button
              className={`icon-button mobile-more-toggle ${secondaryPageIsActive ? 'active' : ''}`}
              type="button"
              aria-label={translate(language, 'app.more')}
              aria-expanded={mobileMoreOpen}
              aria-controls="mobile-secondary-navigation"
              onClick={() => setMobileMoreOpen((open) => !open)}
            ><MoreHorizontal size={20} /></button>
            <button className="icon-button" onClick={logout} aria-label={translate(language, 'auth.logOut')}><LogOut size={18} /></button>
          </div>
        </header>
        <nav id="mobile-secondary-navigation" className="mobile-secondary-nav" hidden={!mobileMoreOpen} aria-label={translate(language, 'app.secondaryNavigation')}>
          {secondaryPages.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" onClick={() => changePage(item.id)} aria-current={page === item.id ? 'page' : undefined}>
              <Icon size={17} /><span>{translate(language, item.label)}</span>
            </button>;
          })}
        </nav>
        <PageHeading page={current} profile={profile} language={language} />
        {notice && <div className="notice" role="status"><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}
        {page === 'overview' && <Overview profile={profile} live={live} language={language} onNavigate={changePage} onSave={updateProfile} onReroll={account ? rerollQuest : null} cloudAccount={Boolean(account)} dailyProgressLoading={Boolean(account && !roomProgress)} />}
        {page === 'friends' && account && <SocialPage account={account} language={language} />}
        {page === 'leaderboard' && account && <LeaderboardPage account={account} language={language} />}
        <div hidden={page !== 'focus-room'} aria-hidden={page !== 'focus-room'}>
          <RoomFoundation account={account} language={language} profile={profile} pageActive={page === 'focus-room'} />
          {account && profile && (
            <RoomDailyQuests
              daily={profile.room_daily_quests}
              availableXp={profile.available_xp}
              language={language}
              onReroll={rerollRoomQuest}
              onClaim={claimRoomQuest}
            />
          )}
          <FocusRoom profile={profile} live={live} stream={stream} videoRef={videoRef} onStartCamera={startCamera} onBeginSession={beginFocusSession} onStopSession={endFocusSession} onStopCamera={stopCamera} onNotice={inform} username={username} cameraState={cameraState} cameraError={cameraError} language={language} />
        </div>
        {page === 'insights' && <Insights profile={profile} language={language} />}
        {page === 'session-results' && <SessionResults live={live} profile={profile} username={username} language={language} onProfile={setProfile} onGoal={async (outcome) => { const data = await api(`/api/session/goal?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ outcome }) }); setLive(data.live); }} />}
        {page === 'achievements' && <Achievements profile={profile} language={language} />}
        {page === 'quests' && <Quests profile={profile} language={language} onReroll={account ? rerollQuest : null} cloudAccount={Boolean(account)} dailyProgressLoading={Boolean(account && !roomProgress)} />}
        {page === 'session-preferences' && <Preferences profile={profile} language={language} onSave={updateProfile} />}
        {page === 'profile' && <Profile profile={profile} language={language} onSave={updateProfile} onExport={() => downloadProfile(profile)} cloudAccount={account} />}
        {page === 'contact' && <ContactPage username={account?.username || username} language={language} accountType={account ? 'cloud' : 'local'} />}
        {page === 'documentation' && <DocumentationPage />}
        <footer className="page-footer">FocusMate <span>·</span> {translate(language, 'app.footer')}</footer>
      </main>
      <FocusBuddy key={username} username={username} profile={profile} live={live} language={language} />
      <nav className="mobile-nav" aria-label={translate(language, 'app.primaryNavigation')}>
        {mobileDestinations.map((item) => {
          const Icon = item.icon;
          return <button
            className={mobileDestination === item.id ? 'active' : ''}
            key={item.id}
            type="button"
            onClick={() => changePage(item.page, item.id)}
            aria-label={translate(language, item.label)}
            aria-current={mobileDestination === item.id ? 'page' : undefined}
            title={translate(language, item.label)}
          ><Icon size={20} /><small>{translate(language, item.label)}</small></button>;
        })}
      </nav>
    </div>
  );
}

function Welcome({ onLogin, onCloudLogin, cloudConfigurationError, notice }) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState(notice || '');
  const [usernameStatus, setUsernameStatus] = useState('idle');
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('focusmate-language');
    return supportedLanguages.includes(saved) ? saved : browserLanguage();
  });
  const t = (key) => translate(language, key);

  useEffect(() => {
    const username = handle.trim();
    if (!username) {
      setUsernameStatus('idle');
      return undefined;
    }
    let current = true;
    setUsernameStatus('checking');
    const timer = window.setTimeout(() => {
      api(`/api/username?username=${encodeURIComponent(username)}`)
        .then((result) => {
          if (current) setUsernameStatus(!result.valid ? 'invalid' : result.exists ? 'existing' : 'available');
        })
        .catch((exception) => {
          if (current) {
            setUsernameStatus('error');
            setError(exception.message);
          }
        });
    }, 150);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [handle]);

  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (usernameStatus === 'checking' || usernameStatus === 'idle' || usernameStatus === 'invalid' || usernameStatus === 'error') return;
    if (usernameStatus === 'available' && !name.trim()) {
      setError(translate(language, 'local.createName'));
      return;
    }
    try { await onLogin(usernameStatus === 'existing' ? '' : name, handle); } catch (exception) { setError(exception.message); }
  };
  const checking = usernameStatus === 'checking';
  const canSubmit = usernameStatus === 'existing' || (usernameStatus === 'available' && Boolean(name.trim()));
  const feedback = checking
    ? t('local.checking')
    : usernameStatus === 'existing'
      ? t('local.returning')
      : usernameStatus === 'available'
        ? t('local.available')
        : usernameStatus === 'invalid'
          ? t('local.invalid')
          : '';
  return (
    <main className="welcome-page" dir={textDirection(language)}>
      <div className="welcome-art">
        <span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="welcome-cross">✳</span>
        <div className="welcome-wordmark">focus<span>mate</span><i>✳</i></div>
        <p>{t('local.tagline')}</p>
        <div className="welcome-art-meta"><span>01 / TAKE A BREATH</span><span>{t('auth.studySpace')}</span></div>
      </div>
      <form className="welcome-form" onSubmit={submit}>
        <div className="auth-language">
          <label htmlFor="local-language">{translate(language, 'preferences.language')}</label>
          <select id="local-language" value={language} onChange={(event) => {
            const selected = event.target.value;
            setLanguage(selected);
            localStorage.setItem('focusmate-language', selected);
            document.documentElement.lang = selected;
            document.documentElement.dir = textDirection(selected);
          }}>
            {supportedLanguages.map((code) => <option key={code} value={code}>{translate(language, `language.${code}`)}</option>)}
          </select>
        </div>
        <div className="welcome-kicker">{t('local.kicker')}</div>
        <h1>{t('local.title')}</h1>
        <p>{t('local.description')}</p>
        <label>{t('local.username')}<input autoComplete="username" maxLength="33" value={handle} onChange={(event) => { setHandle(event.target.value); setError(''); }} placeholder="letters, numbers, . _ -" required /></label>
        <div className="username-feedback" aria-live="polite">{feedback}</div>
        {usernameStatus === 'available' && <label>{t('local.name')}<input autoComplete="name" maxLength="80" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('local.namePlaceholder')} required /></label>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary-button" type="submit" disabled={!canSubmit}>
          {usernameStatus === 'existing' ? t('local.signIn') : t('local.create')} <ArrowUpRight size={17} />
        </button>
        {onCloudLogin && <button className="outline-button auth-local-link" type="button" onClick={onCloudLogin}>{t('local.signInCloud')}</button>}
        {cloudConfigurationError && <small className="privacy-note cloud-config-warning" role="status">{cloudConfigurationError}</small>}
        <small className="privacy-note"><LockKeyhole size={14} /> {t('local.localNote')}</small>
      </form>
    </main>
  );
}

function PageHeading({ page, profile, language }) {
  const content = {
    overview: ['heading.overviewEyebrow', 'heading.overviewTitle', 'heading.overviewText'],
    'focus-room': ['heading.focusEyebrow', 'heading.focusTitle', 'heading.focusText'],
    friends: ['heading.friendsEyebrow', 'heading.friendsTitle', 'heading.friendsText'],
    leaderboard: ['heading.leaderboardEyebrow', 'heading.leaderboardTitle', 'heading.leaderboardText'],
    insights: ['heading.progressEyebrow', 'heading.progressTitle', 'heading.progressText'],
    'session-results': ['heading.resultsEyebrow', 'heading.resultsTitle', 'heading.resultsText'],
    achievements: ['heading.achievementsEyebrow', 'heading.achievementsTitle', 'heading.achievementsText'],
    quests: ['heading.questsEyebrow', 'heading.questsTitle', 'heading.questsText'],
    'session-preferences': ['heading.preferencesEyebrow', 'heading.preferencesTitle', 'heading.preferencesText'],
    profile: ['heading.profileEyebrow', 'heading.profileTitle', 'heading.profileText'],
    contact: ['heading.contactEyebrow', 'heading.contactTitle', 'heading.contactText'],
    documentation: ['heading.documentationEyebrow', 'heading.documentationTitle', 'heading.documentationText'],
  }[page.id];
  if (page.id === 'overview') return null;
  return <header className="page-heading"><span className="eyebrow">{translate(language, content[0])}</span><h1>{translate(language, content[1], { name: profile.player_name || 'friend' })}</h1><p>{translate(language, content[2])}</p></header>;
}

function Stat({ label, value, note, icon: Icon }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span>{Icon && <Icon size={17} />}</div><strong>{value}</strong><small>{note}</small></div>;
}

function Overview({
  profile,
  live,
  language,
  onNavigate,
  onSave,
  onReroll,
  cloudAccount,
  dailyProgressLoading,
}) {
  const now = new Date();
  const hour = now.getHours();
  const greetingKey = hour < 12 ? 'dashboard.morning' : hour < 18 ? 'dashboard.afternoon' : 'dashboard.evening';
  const name = String(profile.player_name || '').trim();
  const xp = Number(profile.total_xp || 0);
  const level = levelForXp(xp);
  const levelProgress = xp % 100;
  const goalMinutes = Math.max(1, Number(profile.session_preferences?.daily_goal_minutes || 60));
  const todaySeconds = dailyFocusSeconds(profile, live, localDateKey(now));
  const goalPercent = Math.min(100, todaySeconds / (goalMinutes * 60) * 100);
  const streak = studyStreak(profile, now, live.session_active ? Number(live.session_seconds || 0) : 0);
  const week = weekStudyDays(profile, now);
  const unlocked = new Set((profile.achievements || []).map((item) => typeof item === 'string' ? item : item?.id));
  const achievementCount = achievementCatalog.filter(([id]) => unlocked.has(id)).length;
  const nextAchievement = achievementCatalog.find(([id]) => !unlocked.has(id));
  const updateGoal = (value) => {
    const sessionPreferences = { ...profile.session_preferences, daily_goal_minutes: Number(value) };
    onSave({ session_preferences: sessionPreferences });
  };
  const hourCount = Math.floor(todaySeconds / 3600);
  const minuteCount = Math.floor((todaySeconds % 3600) / 60);

  return (
    <div className="page-content">
      <section className="overview-intro overview-hero">
        <div>
          <span className="eyebrow">{translate(language, 'dashboard.today')}</span>
          <h2>{name ? `${translate(language, greetingKey)}, ${name} 👋` : `${translate(language, 'dashboard.welcome')} 👋`}</h2>
          <p>{translate(language, 'dashboard.heroText')}</p>
        </div>
      </section>

      <section className="surface-panel overview-goal">
        <div className="section-heading"><div><span className="eyebrow">{translate(language, 'dashboard.goal')}</span><h3>{hourCount ? `${hourCount}h ` : ''}{minuteCount} / {goalMinutes} min</h3></div><span className="ring-meter" style={{ '--progress': `${goalPercent}%` }}><b>{Math.round(goalPercent)}%</b></span></div>
        <div className="progress-track" role="progressbar" aria-label={translate(language, 'dashboard.goal')} aria-valuemin="0" aria-valuemax={goalMinutes} aria-valuenow={Math.min(goalMinutes, Math.floor(todaySeconds / 60))}><span style={{ width: `${goalPercent}%` }} /></div>
        <label className="goal-select">{translate(language, 'dashboard.setGoal')}<select value={goalMinutes} onChange={(event) => updateGoal(event.target.value)} aria-label={translate(language, 'dashboard.setGoal')}>
          {[30, 60, 90, 120, ...([30, 60, 90, 120].includes(goalMinutes) ? [] : [goalMinutes])].sort((a, b) => a - b).map((minutes) => <option value={minutes} key={minutes}>{minutes} min</option>)}
        </select></label>
      </section>

      <section className="surface-panel overview-focus-action">
        <div className="overview-focus-icon"><Focus size={21} /></div>
        <div className="overview-focus-copy">
          <span className="eyebrow">{translate(language, 'dashboard.focusEyebrow')}</span>
          <h3>{translate(language, 'dashboard.focusTitle')}</h3>
          <p>{translate(language, 'dashboard.focusText')}</p>
        </div>
        <button className="primary-button" onClick={() => onNavigate('focus-room', 'focus')}>
          <Focus size={17} /> {translate(language, 'dashboard.startSession')}
        </button>
      </section>

      <TaskList profile={profile} onSave={onSave} language={language} />

      <div className="overview-metrics">
        <Stat label={translate(language, 'dashboard.studyTime')} value={`${hourCount ? `${hourCount}h ` : ''}${minuteCount}m`} note={translate(language, live.session_active ? 'dashboard.activeCameraIncluded' : 'dashboard.completedStudyTime')} icon={Clock3} />
        <Stat label={translate(language, 'dashboard.studyStreak')} value={`${streak} ${translate(language, streak === 1 ? 'dashboard.day' : 'dashboard.days')}`} note={translate(language, 'dashboard.streakNote')} icon={Flame} />
        <section className="surface-panel overview-xp">
          <div className="section-heading"><div><span className="eyebrow">{translate(language, 'dashboard.xpLevel')}</span><h3>{translate(language, 'preferences.level')} {level}</h3></div><strong>{xp.toLocaleString(language)} XP</strong></div>
          <div className="progress-track" role="progressbar" aria-label={translate(language, 'dashboard.levelProgress', { level })} aria-valuemin="0" aria-valuemax="100" aria-valuenow={levelProgress}><span style={{ width: `${levelProgress}%` }} /></div>
          <small>{levelProgress} / 100 XP · {100 - levelProgress} {translate(language, 'dashboard.toNextLevel')}</small>
        </section>
        <section className="surface-panel overview-achievements">
          <div className="section-heading"><div><span className="eyebrow">{translate(language, 'dashboard.achievements')}</span><h3>{achievementCount} / {achievementCatalog.length} {translate(language, 'dashboard.unlocked')}</h3></div><Trophy size={19} /></div>
          {nextAchievement ? <p>{translate(language, 'dashboard.nextAchievement')}: {nextAchievement[1]}</p> : <p>{translate(language, 'quests.completedAll')}</p>}
          <button className="text-button" onClick={() => onNavigate('achievements')}>{translate(language, 'dashboard.viewAchievements')} <ArrowUpRight size={15} /></button>
        </section>
      </div>

      <section className="surface-panel streak-panel">
        <div className="section-heading"><div><span className="eyebrow">{translate(language, 'dashboard.week')}</span><h3>{translate(language, 'dashboard.studyDaysThisWeek')}</h3></div></div>
        <div className="week-calendar" aria-label={translate(language, 'dashboard.week')}>
          {week.map((day) => <div key={day.date} aria-label={`${day.date}: ${translate(language, day.completed ? 'dashboard.studyCompleted' : 'dashboard.noStudyRecorded')}`} className={day.completed ? 'completed' : ''}><span>{day.label}</span><strong>{day.completed ? '✓' : '·'}</strong></div>)}
        </div>
      </section>

      <DailyQuests
        profile={profile}
        language={language}
        onViewAll={() => onNavigate('quests')}
        onReroll={onReroll}
        cloudAccount={cloudAccount}
        dailyProgressLoading={dailyProgressLoading}
      />
      <nav className="overview-shortcuts" aria-label={translate(language, 'dashboard.shortcuts')}>
        <button type="button" onClick={() => onNavigate('insights')}><BarChart3 size={17} /><span>{translate(language, 'nav.progress')}</span><ArrowUpRight size={15} /></button>
        <button type="button" onClick={() => onNavigate('achievements')}><Trophy size={17} /><span>{translate(language, 'nav.achievements')}</span><ArrowUpRight size={15} /></button>
        <button type="button" onClick={() => onNavigate('session-preferences')}><Settings2 size={17} /><span>{translate(language, 'nav.preferences')}</span><ArrowUpRight size={15} /></button>
        {hasCloudAccount && <button type="button" onClick={() => onNavigate('friends')}><Users size={17} /><span>{translate(language, 'nav.friends')}</span><ArrowUpRight size={15} /></button>}
      </nav>
    </div>
  );
}

function TaskList({ profile, onSave, language }) {
  const [newTask, setNewTask] = useState('');
  const tasks = Array.isArray(profile.tasks) ? profile.tasks : [];
  const t = (key) => translate(language, `focus.${key}`);
  const saveTasks = (nextTasks) => onSave({ tasks: nextTasks });
  const addTask = (event) => {
    event.preventDefault();
    if (!newTask.trim()) return;
    saveTasks([...tasks, { id: String(Date.now()), text: newTask.trim(), done: false }].slice(-100));
    setNewTask('');
  };
  const toggleTask = (id) => saveTasks(tasks.map((task) =>
    task.id === id ? { ...task, done: !task.done } : task,
  ));
  const removeTask = (id) => saveTasks(tasks.filter((task) => task.id !== id));

  return <section className="surface-panel task-section" id="today-tasks" aria-labelledby="today-tasks-title">
    <div className="task-heading">
      <div><span className="eyebrow">{t('taskEyebrow')}</span><h3 id="today-tasks-title">{t('taskTitle')}</h3><p>{t('taskIntro')}</p></div>
      <span className="task-count">{tasks.filter((task) => task.done).length}/{tasks.length} {t('done')}</span>
    </div>
    <form className="task-form" onSubmit={addTask}>
      <input
        aria-label={t('taskPlaceholder')}
        maxLength="120"
        value={newTask}
        onChange={(event) => setNewTask(event.target.value)}
        placeholder={t('taskPlaceholder')}
      />
      <button className="outline-button" type="submit"><Plus size={16} /> {t('addTask')}</button>
    </form>
    <div className="task-list">
      {tasks.length ? tasks.map((task) => <div className={`task-row ${task.done ? 'done' : ''}`} key={task.id}>
        <button className="check-button" type="button" onClick={() => toggleTask(task.id)} aria-label={task.done ? t('markIncomplete') : t('completeTask')}>{task.done && <Check size={14} />}</button>
        <span>{task.text}</span>
        <button className="icon-button task-remove" type="button" onClick={() => removeTask(task.id)} aria-label={t('removeTask')}><X size={15} /></button>
      </div>) : <div className="empty-state">{t('taskEmpty')}</div>}
    </div>
  </section>;
}

const questIcons = {
  focus_time: Focus,
  session_count: BookOpen,
  session_xp: Sparkles,
  camera_alerts: Activity,
  room_host_sessions: Users,
};

function questCopy(quest, language) {
  const target = quest.target;
  if (quest.category === 'focus_time') return {
    title: translate(language, 'quests.focusTitle', { target }),
    description: translate(language, quest.verified ? 'quests.verifiedFocusDescription' : 'quests.focusDescription'),
    unit: 'min',
    max: target,
    current: Math.floor(Number(quest.progress || 0)),
  };
  if (quest.category === 'session_count') return {
    title: translate(language, quest.verified ? 'quests.verifiedSessionsTitle' : 'quests.sessionsTitle', { target }),
    description: translate(language, quest.verified ? 'quests.verifiedSessionsDescription' : 'quests.sessionsDescription'),
    unit: 'sessions',
    max: target,
    current: Math.floor(Number(quest.progress || 0)),
  };
  if (quest.category === 'session_xp') return {
    title: translate(language, 'quests.xpTitle', { target }),
    description: translate(language, quest.verified ? 'quests.verifiedXpDescription' : 'quests.xpDescription'),
    unit: 'XP',
    max: target,
    current: Math.floor(Number(quest.progress || 0)),
  };
  if (quest.category === 'room_host_sessions') return {
    title: translate(language, 'quests.roomHostQuestTitle', { target }),
    description: translate(language, 'quests.roomHostQuestDescription'),
    unit: 'sessions',
    max: target,
    current: Math.floor(Number(quest.progress || 0)),
  };
  const signal = translate(language, `quests.${quest.signal === 'posture_alerts' ? 'posture' : quest.signal === 'distance_alerts' ? 'distance' : 'lookingAway'}`);
  return {
    title: translate(language, 'quests.alertsTitle', { signal }),
    description: translate(language, 'quests.alertsDescription', { signal }),
    unit: 'sessions',
    max: 1,
    current: Number(quest.progress || 0),
  };
}

function DailyQuests({
  profile,
  language,
  onViewAll,
  onReroll,
  cloudAccount = false,
  dailyProgressLoading = false,
}) {
  const [rerollingId, setRerollingId] = useState('');
  const [rerollError, setRerollError] = useState('');
  const [confirmingQuestId, setConfirmingQuestId] = useState('');
  const confirmationButtonRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const tokenBalanceRef = useRef(null);
  const rerollTriggerRef = useRef(null);
  const daily = profile.daily_quests;
  useEffect(() => {
    if (!confirmingQuestId) return undefined;
    confirmationButtonRef.current?.focus();
    const handleDialogKey = (event) => {
      if (event.key === 'Escape') {
        setConfirmingQuestId('');
        setRerollError('');
        window.requestAnimationFrame(() => rerollTriggerRef.current?.focus());
      } else if (event.key === 'Tab' && event.shiftKey && document.activeElement === cancelButtonRef.current) {
        event.preventDefault();
        confirmationButtonRef.current?.focus();
      } else if (event.key === 'Tab' && !event.shiftKey && document.activeElement === confirmationButtonRef.current) {
        event.preventDefault();
        cancelButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKey);
    return () => window.removeEventListener('keydown', handleDialogKey);
  }, [confirmingQuestId]);
  if (!daily || !Array.isArray(daily.quests) || daily.quests.length !== 4) {
    const unavailableKey = cloudAccount
      ? dailyProgressLoading ? 'quests.serverProgressLoading' : 'quests.serverUpdateRequired'
      : 'quests.unavailable';
    return <section className="surface-panel daily-quests" role="alert"><h3>{translate(language, 'quests.title')}</h3><p>{translate(language, unavailableKey)}</p></section>;
  }
  const tokenBalance = profile.reroll_tokens === null || profile.reroll_tokens === undefined
    || !Number.isInteger(Number(profile.reroll_tokens))
    ? null
    : Number(profile.reroll_tokens);
  const rerollsRemaining = profile.rerolls_remaining_today === null
    || profile.rerolls_remaining_today === undefined
    || !Number.isInteger(Number(profile.rerolls_remaining_today))
    ? null
    : Number(profile.rerolls_remaining_today);
  const canReroll = Boolean(onReroll && tokenBalance > 0 && rerollsRemaining > 0);
  const completed = daily.quests.filter((quest) => quest.completed).length;
  const confirmingQuest = daily.quests.find((quest) => quest.id === confirmingQuestId);
  const closeRerollConfirmation = (restoreTrigger = true) => {
    setConfirmingQuestId('');
    setRerollError('');
    window.requestAnimationFrame(() => (
      restoreTrigger ? rerollTriggerRef.current?.focus() : tokenBalanceRef.current?.focus()
    ));
  };
  const reroll = async (questId) => {
    if (!onReroll) return;
    setRerollingId(questId);
    setRerollError('');
    try {
      await onReroll(questId);
      closeRerollConfirmation(false);
    } catch (error) {
      const key = error.code === 'QUEST_REROLL_INSUFFICIENT_TOKENS'
        ? 'quests.rerollInsufficientTokens'
        : error.code === 'QUEST_REROLL_DAILY_LIMIT'
          ? 'quests.rerollDailyLimit'
        : error.code === 'QUEST_REROLL_UNAVAILABLE'
          ? 'quests.rerollUnavailable'
          : 'quests.rerollFailed';
      setRerollError(translate(language, key));
    } finally {
      setRerollingId('');
    }
  };
  return <>
    <section className="daily-quests">
      <div className="section-heading">
        <div><span className="eyebrow">{translate(language, 'quests.available')}</span><h3>{translate(language, 'quests.title')}</h3><p>{translate(language, cloudAccount ? 'quests.verifiedDailySubtitle' : 'quests.subtitle')}</p></div>
        {onViewAll && <button className="outline-button" onClick={onViewAll}>{translate(language, 'quests.viewAll')}</button>}
      </div>
      {cloudAccount
        ? <p className="reroll-token-balance" ref={tokenBalanceRef} role="status" tabIndex={-1}>{translate(language, 'quests.tokenBalance', { tokens: tokenBalance ?? '—', remaining: rerollsRemaining ?? '—' })}</p>
        : <p className="muted-note">{translate(language, 'quests.tokensNeedCloudAccount')}</p>}
      <div className="quest-grid">
        {daily.quests.map((quest) => {
          const copy = questCopy(quest, language);
          const Icon = questIcons[quest.category] || Award;
          const difficulty = translate(language, `quests.${String(quest.difficulty || 'Easy').toLowerCase()}`);
          return <article className={`daily-quest-card ${quest.completed ? 'is-complete' : ''}`} key={quest.id}>
            <div className="daily-quest-top"><span className="quest-symbol"><Icon size={18} /></span><span className="difficulty-pill">{difficulty}</span></div>
            <h4>{copy.title}</h4>
            <p>{copy.description}</p>
            {quest.category === 'camera_alerts' && <small className="quest-requirement">{translate(language, 'quests.cameraRequired')}</small>}
            <div className="quest-progress-copy"><span>{translate(language, 'quests.progress')}</span><strong>{copy.current} / {copy.max} {copy.unit}</strong></div>
            <div className="progress-track" role="progressbar" aria-label={copy.title} aria-valuemin="0" aria-valuemax={copy.max} aria-valuenow={Math.min(copy.max, copy.current)}><span style={{ width: `${Math.min(100, copy.current / copy.max * 100)}%` }} /></div>
            <div className="quest-card-footer"><span className="xp-pill">{quest.verified ? translate(language, 'quests.tokenMilestone') : `+${quest.rewardXP} XP`}</span><span className={`quest-state ${quest.completed ? 'complete' : ''}`}>{quest.completed ? <><Check size={15} /> {translate(language, 'quests.completed')}</> : translate(language, 'quests.inProgress')}</span></div>
            {quest.completed && quest.verified && <small className="quest-reward-note">{translate(language, 'quests.tokenMilestoneProgress')}</small>}
            {quest.completed && !quest.verified && <small className="quest-reward-note">+{quest.rewardXP} XP {translate(language, 'quests.earned')}</small>}
            {!quest.completed && onReroll && <button
              className="outline-button quest-reroll"
              type="button"
              disabled={!canReroll || Boolean(rerollingId)}
              onClick={(event) => {
                rerollTriggerRef.current = event.currentTarget;
                setConfirmingQuestId(quest.id);
              }}
            >{rerollingId === quest.id ? translate(language, 'auth.pleaseWait') : translate(language, 'quests.reroll')}</button>}
          </article>;
        })}
      </div>
      {completed === 4 && <div className="quest-all-complete" role="status"><strong>🎉 {translate(language, cloudAccount ? 'quests.dailyTokenEarned' : 'quests.completedAll')}</strong><span>{translate(language, cloudAccount ? 'quests.dailyTokenEarnedDescription' : 'quests.congratulations')}</span></div>}
    </section>
    {confirmingQuest && <div className="quest-reroll-confirmation-backdrop">
      <section
        aria-labelledby="daily-quest-reroll-title"
        aria-modal="true"
        className="quest-reroll-confirmation"
        role="dialog"
      >
        <h2 id="daily-quest-reroll-title">{translate(language, 'quests.rerollConfirmTitle')}</h2>
        <p>{translate(language, 'quests.rerollConfirm', { quest: questCopy(confirmingQuest, language).title })}</p>
        <p>{translate(language, 'quests.tokenBalance', { tokens: tokenBalance ?? '—', remaining: rerollsRemaining ?? '—' })}</p>
        {rerollError && <p className="quest-reroll-error" role="alert">{rerollError}</p>}
        <div className="quest-reroll-confirmation-actions">
          <button className="outline-button" type="button" ref={cancelButtonRef} onClick={() => closeRerollConfirmation()}>{translate(language, 'quests.rerollCancel')}</button>
          <button
            className="primary-button"
            type="button"
            ref={confirmationButtonRef}
            disabled={!canReroll || Boolean(rerollingId)}
            onClick={() => void reroll(confirmingQuest.id)}
          >{rerollingId === confirmingQuest.id ? translate(language, 'quests.rerolling') : translate(language, 'quests.rerollConfirmButton')}</button>
        </div>
      </section>
    </div>}
  </>;
}

function RoomDailyQuests({ daily, availableXp, language, onReroll, onClaim }) {
  const [busyId, setBusyId] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const roomXp = availableXp === null || availableXp === undefined || availableXp === ''
    || !Number.isFinite(Number(availableXp))
    ? null
    : Number(availableXp);
  const t = (key, values) => translate(language, `quests.${key}`, values);
  const runAction = async (questId, actionType, action) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyId(questId);
    setBusyAction(actionType);
    setError('');
    try {
      await action(questId);
    } catch (actionError) {
      setError(actionError.code === 'QUEST_REROLL_INSUFFICIENT_XP'
        ? t('rerollInsufficientXp')
        : actionError.message || t('rerollFailed'));
    } finally {
      busyRef.current = false;
      setBusyId('');
      setBusyAction('');
    }
  };
  const quests = daily?.quests;
  return (
    <section className="room-daily-quests">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t('verifiedRoomQuests')}</span>
          <h3>{t('roomQuestTitle')}</h3>
          <p>{t('roomQuestDescription')}</p>
        </div>
        <span className="xp-pill">{t('verifiedXpBalance', { xp: roomXp ?? '—' })}</span>
      </div>
      {!Array.isArray(quests) ? (
        <p className="muted-note">{t('roomQuestLoading')}</p>
      ) : (
        <div className="quest-grid">
          {quests.map((quest) => {
            const target = Number(quest.target) || 0;
            const current = Number(quest.progress) || 0;
            const focusQuest = quest.category === 'room_focus_minutes';
            const friendQuest = quest.category === 'friend_room_sessions';
            const hostQuest = quest.category === 'room_host_sessions';
            const title = t(
              focusQuest ? 'roomFocusQuestTitle'
                : friendQuest ? 'friendRoomQuestTitle'
                  : hostQuest ? 'roomHostQuestTitle'
                    : 'roomSessionsQuestTitle',
              { target },
            );
            const description = t(
              focusQuest ? 'roomFocusQuestDescription'
                : friendQuest ? 'friendRoomQuestDescription'
                  : hostQuest ? 'roomHostQuestDescription'
                    : 'roomSessionsQuestDescription',
            );
            return (
              <article className={`daily-quest-card ${quest.completed ? 'is-complete' : ''}`} key={quest.id}>
                <div className="daily-quest-top"><span className="quest-symbol"><Users size={18} /></span><span className="difficulty-pill">{t('serverVerified')}</span></div>
                <h4>{title}</h4>
                <p>{description}</p>
                <div className="quest-progress-copy"><span>{t('progress')}</span><strong>{Math.min(target, current)} / {target} {focusQuest ? t('minutesUnit') : t('sessionsUnit')}</strong></div>
                <div className="progress-track" role="progressbar" aria-label={title} aria-valuemin="0" aria-valuemax={target} aria-valuenow={Math.min(target, current)}><span style={{ width: `${target ? Math.min(100, current / target * 100) : 0}%` }} /></div>
                <div className="quest-card-footer"><span className="xp-pill">+{quest.rewardXP} XP</span><span className={`quest-state ${quest.completed ? 'complete' : ''}`}>{quest.rewardClaimed ? t('claimed') : quest.completed ? t('complete') : t('inProgress')}</span></div>
                {quest.completed && !quest.rewardClaimed && onClaim && (
                  <button className="primary-button" type="button" disabled={Boolean(busyId)} onClick={() => void runAction(quest.id, 'claim', onClaim)}>
                    {busyId === quest.id && busyAction === 'claim' ? t('claiming') : t('claimReward')}
                  </button>
                )}
                {!quest.completed && onReroll && (
                  <button className="outline-button quest-reroll" type="button" disabled={Boolean(busyId) || (roomXp !== null && roomXp < 5)} onClick={() => void runAction(quest.id, 'reroll', onReroll)}>
                    {busyId === quest.id && busyAction === 'reroll' ? t('rerolling') : t('roomReroll')}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
      {roomXp !== null && roomXp < 5 && <p className="muted-note">{t('rerollInsufficientXp')}</p>}
      {error && <p className="quest-reroll-error" role="alert">{error}</p>}
    </section>
  );
}

function TimerPanel({
  profile,
  username,
  onNotice,
  language,
  onSessionStart,
  onSessionEnd,
  onSessionPause,
  onSessionResume,
  onSessionStateChange,
  onSessionPauseStateChange,
  canStart,
}) {
  const durationOptions = [15, 25, 45, 60, 90, 120];
  const preferredDuration = Number(profile.session_preferences?.session_length_minutes || 25);
  const defaultDuration = durationOptions.includes(preferredDuration) ? preferredDuration : 25;
  const [roomTimer, setRoomTimer] = useState(null);
  const roomSessionId = roomTimer
    ? `${roomTimer.roomId}:${roomTimer.sessionStartedAt}`
    : '';
  const roomDuration = roomTimer ? roomTimer.durationSeconds / 60 : null;
  const durations = [...new Set([...durationOptions, ...(roomDuration ? [roomDuration] : [])])]
    .sort((a, b) => a - b);
  const [duration, setDuration] = useState(defaultDuration);
  const [remaining, setRemaining] = useState(defaultDuration * 60);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [endedEarly, setEndedEarly] = useState(false);
  const [reloadInterrupted, setReloadInterrupted] = useState(false);
  const [clientPerformanceNow, setClientPerformanceNow] = useState(() => performance.now());
  const startedAtRef = useRef(0);
  const localSessionActiveRef = useRef(false);
  const completionHandled = useRef(false);
  const activeRoomSession = useRef('');
  const chimeContext = useRef(null);
  const timerStorageKey = `focusmate-active-timer:${username}`;
  useEffect(() => subscribeToRoomTimerState(setRoomTimer), []);
  useEffect(() => {
    const saved = sessionStorage.getItem(timerStorageKey);
    if (!saved) return;
    try {
      const state = restoreLocalFocusTimer(
        JSON.parse(saved),
        durationOptions,
      );
      if (!state) throw new Error('Invalid saved timer');
      startedAtRef.current = state.startedAt;
      localSessionActiveRef.current = true;
      completionHandled.current = false;
      setDuration(state.duration);
      setRemaining(state.remaining);
      setPaused(state.paused);
      setRunning(!state.paused);
      onSessionStateChange(true);
      onSessionPauseStateChange(state.paused);
      return;
    } catch {
      sessionStorage.removeItem(timerStorageKey);
      setReloadInterrupted(true);
    }
  }, [timerStorageKey]);
  const playChime = () => {
    if (!profile.session_preferences?.session_chimes || chimeContext.current?.state !== 'running') return;
    const context = chimeContext.current;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.frequency.value = 660;
    volume.gain.setValueAtTime(0.001, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.025);
    volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.32);
    oscillator.connect(volume);
    volume.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.33);
  };
  const endLocalSession = (wasCompleted) => {
    if (!localSessionActiveRef.current || !claimTimerCompletion(completionHandled)) return;
    const remainingAtEnd = paused
      ? remaining
      : remainingFocusSeconds(startedAtRef.current, duration * 60);
    const completedByDeadline = wasCompleted
      || remainingAtEnd === 0;
    localSessionActiveRef.current = false;
    setRunning(false);
    setPaused(false);
    onSessionPauseStateChange(false);
    setCompleted(completedByDeadline);
    setEndedEarly(!completedByDeadline);
    setRemaining(completedByDeadline ? 0 : remainingAtEnd);
    sessionStorage.removeItem(timerStorageKey);
    onSessionStateChange(false);
    onSessionEnd({ completed: completedByDeadline });
    if (completedByDeadline) void playSessionCompletionBeep(chimeContext.current);
  };
  useEffect(() => () => { chimeContext.current?.close(); }, []);
  useEffect(() => {
    reportPwaSessionActivity('timer', running);
    return () => reportPwaSessionActivity('timer', false);
  }, [running]);
  useEffect(() => {
    if (!running) return undefined;
    const refreshClock = () => {
      if (roomTimer) setClientPerformanceNow(performance.now());
      else setRemaining(remainingFocusSeconds(startedAtRef.current, duration * 60));
    };
    const interval = window.setInterval(refreshClock, 1000);
    document.addEventListener('visibilitychange', refreshClock);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshClock);
    };
  }, [duration, roomTimer, running]);
  useEffect(() => {
    if (!roomTimer) {
      if (activeRoomSession.current) {
        activeRoomSession.current = '';
        setDuration(defaultDuration);
        setRemaining(defaultDuration * 60);
        setCompleted(false);
        setRunning(false);
      }
      return;
    }
    if (activeRoomSession.current !== roomSessionId) {
      activeRoomSession.current = roomSessionId;
      completionHandled.current = false;
      setCompleted(false);
      setEndedEarly(false);
    }
    setDuration(roomDuration);
    setRemaining(remainingRoomFocusSeconds(roomTimer, performance.now()));
    setRunning(roomTimer.status === 'focusing'
      && remainingRoomFocusSeconds(roomTimer, performance.now()) > 0);
    setClientPerformanceNow(performance.now());
  }, [defaultDuration, roomDuration, roomSessionId, roomTimer]);
  useEffect(() => {
    if (!roomTimer || roomTimer.status !== 'finished') return;
    setCompleted(true);
  }, [roomTimer]);
  useEffect(() => {
    if (!roomTimer || roomTimer.status !== 'focusing') return;
    setRemaining(remainingRoomFocusSeconds(roomTimer, clientPerformanceNow));
  }, [clientPerformanceNow, roomTimer]);
  useEffect(() => {
    if (roomTimer) {
      const roomFinished = roomTimer.status === 'finished';
      const naturallyFinished = roomTimer.status === 'focusing'
        && remainingRoomFocusSeconds(roomTimer, performance.now()) === 0;
      if ((!roomFinished && !naturallyFinished) || !claimTimerCompletion(completionHandled)) return;
      setCompleted(true);
      setRunning(false);
      const secondsToCredit = elapsedParticipantFocusSeconds(roomTimer, performance.now());
      if (secondsToCredit > 0) {
        const taskText = profile.tasks?.find((task) => !task.done)?.text || '';
        api(`/api/timer/credit?username=${encodeURIComponent(username)}`, {
          method: 'POST',
          body: JSON.stringify({
            seconds: secondsToCredit,
            session_id: roomSessionId,
            session_started_at: roomTimer.sessionStartedAt,
            task_text: taskText,
          }),
        })
          .then(() => onNotice(translate(language, 'focus.timerSaved')))
          .catch((error) => onNotice(error.message));
      }
      if (roomFinished) void playSessionCompletionBeep(chimeContext.current);
      return;
    }
    if (remaining !== 0 || (!running && !paused) || !localSessionActiveRef.current) return;
    endLocalSession(true);
  }, [duration, language, onNotice, onSessionEnd, onSessionStateChange, paused, profile.tasks, remaining, roomSessionId, roomTimer, running, timerStorageKey, username]);
  const chooseDuration = (value) => {
    if (running || !durationOptions.includes(value)) return;
    completionHandled.current = false;
    setCompleted(false);
    setEndedEarly(false);
    setReloadInterrupted(false);
    setPaused(false);
    setDuration(value);
    setRemaining(value * 60);
  };
  const start = () => {
    if (roomTimer || localSessionActiveRef.current || !canStart || completed || endedEarly) return;
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    localSessionActiveRef.current = true;
    completionHandled.current = false;
    setCompleted(false);
    setPaused(false);
    onSessionPauseStateChange(false);
    setReloadInterrupted(false);
    setRemaining(duration * 60);
    sessionStorage.setItem(timerStorageKey, JSON.stringify({
      startedAt,
      duration,
      status: 'running',
    }));
    setRunning(true);
    onSessionStateChange(true);
    onSessionStart({ duration, startedAt });
    if (!chimeContext.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        try {
          chimeContext.current = new AudioContextClass();
        } catch {
          chimeContext.current = null;
        }
      }
    }
    const resumeAudio = chimeContext.current?.resume();
    resumeAudio?.then(() => {
      if (profile.session_preferences?.session_chimes) playChime();
    }).catch(() => {});
  };
  const reset = () => {
    if (roomTimer || running || paused || localSessionActiveRef.current) return;
    completionHandled.current = false;
    setCompleted(false);
    setEndedEarly(false);
    setRemaining(duration * 60);
  };
  const pause = async () => {
    if (roomTimer || paused || !localSessionActiveRef.current) return;
    const remainingSeconds = pauseLocalFocusTimer(
      startedAtRef.current,
      duration * 60,
    );
    if (remainingSeconds === 0) {
      endLocalSession(true);
      return;
    }
    setTransitioning(true);
    try {
      await onSessionPause();
    } catch (error) {
      onNotice(`Your focus timer could not be paused: ${error.message}`);
      return;
    } finally {
      setTransitioning(false);
    }
    setRemaining(remainingSeconds);
    setRunning(false);
    setPaused(true);
    onSessionPauseStateChange(true);
    sessionStorage.setItem(timerStorageKey, JSON.stringify({
      startedAt: startedAtRef.current,
      duration,
      status: 'paused',
      remainingSeconds,
    }));
  };
  const resume = async () => {
    if (roomTimer || !paused || !localSessionActiveRef.current) return;
    if (remaining === 0) {
      endLocalSession(true);
      return;
    }
    setTransitioning(true);
    try {
      await onSessionResume();
    } catch (error) {
      onNotice(`Your focus timer could not be resumed: ${error.message}`);
      return;
    } finally {
      setTransitioning(false);
    }
    const startedAt = resumeLocalFocusTimer(
      duration * 60,
      remaining,
    );
    if (startedAt === null) return;
    startedAtRef.current = startedAt;
    setPaused(false);
    setRunning(true);
    onSessionPauseStateChange(false);
    sessionStorage.setItem(timerStorageKey, JSON.stringify({
      startedAt,
      duration,
      status: 'running',
    }));
  };
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  const t = (key, values) => translate(language, `focus.${key}`, values);
  return <section className="timer-panel" id="focus-timer">
    <div className="timer-top">
      <span className="eyebrow">{t('timerEyebrow')}</span>
      <label className="select-wrap">
        <select value={duration} disabled={running || paused || Boolean(roomTimer)} onChange={(event) => chooseDuration(Number(event.target.value))}>
          {durations.map((item) => <option key={item} value={item}>{item} {t('minutes')}</option>)}
        </select>
        <ChevronDown size={15} />
      </label>
    </div>
    <div className={`timer-display ${running ? 'is-running' : ''}`} aria-label={`${t('timer')} ${minutes} ${t('minutes')} ${seconds}`}>
      {minutes}<span>:</span>{seconds}
    </div>
    <div className="progress-track timer-progress"><span style={{ width: `${100 - (remaining / (duration * 60)) * 100}%` }} /></div>
    <p className="timer-caption">{t('timerCaption')}</p>
    {completed && <div className="timer-complete" role="status" aria-live="polite"><strong>🎉 {t('sessionComplete')}</strong><span>{t('sessionEnded')}</span></div>}
    {endedEarly && <div className="timer-complete" role="status" aria-live="polite"><strong>{t('sessionEndedEarly')}</strong><span>{t('sessionEnded')}</span></div>}
    {reloadInterrupted && <p className="timer-reload-note" role="status">{t('sessionReloadInterrupted')}</p>}
    <div className="timer-actions">
      {running ? (
        <>
          <button className="outline-button" disabled={Boolean(roomTimer) || transitioning} onClick={pause}>
            <Coffee size={16} /> {t('pause')}
          </button>
          <button className="outline-button" disabled={Boolean(roomTimer) || transitioning} onClick={() => endLocalSession(false)}>
            <VideoOff size={16} /> {t('endSession')}
          </button>
        </>
      ) : paused ? (
        <>
          <button className="primary-button" disabled={transitioning} onClick={resume}>
            <Play size={17} /> {t('resume')}
          </button>
          <button className="outline-button" disabled={transitioning} onClick={() => endLocalSession(false)}>
            <VideoOff size={16} /> {t('endSession')}
          </button>
        </>
      ) : (
        <button className="primary-button" disabled={Boolean(roomTimer) || remaining === 0 || completed || endedEarly || !canStart} onClick={start}>
          <Play size={17} /> {t('startFocus')}
        </button>
      )}
      <button className="outline-button" disabled={Boolean(roomTimer) || running || paused || transitioning} onClick={reset}><RotateCcw size={16} /> {t('reset')}</button>
    </div>
    <small className="muted-note">{t('timerNote')}</small>
  </section>;
}

function FocusBuddy({ username, profile, live, language }) {
  const preferences = normalizeFocusBuddyPreferences(profile.session_preferences);
  const [roomTimer, setRoomTimer] = useState(null);
  const [reminder, setReminder] = useState(null);
  const [animationState, setAnimationState] = useState('hidden');
  const [scheduleVersion, setScheduleVersion] = useState(0);
  const animationFallbackTimeout = useRef(null);
  const reminderResponseClaimed = useRef(false);
  const reminderPending = useRef(false);
  const previousUsername = useRef(username);
  const storageKey = waterReminderStorageKey(username);
  const activeSession = Boolean(live.session_active || roomTimer?.status === 'focusing');
  const allowDuringSession = preferences.focus_buddy_during_sessions;
  const t = (key, values) => translate(language, `focusBuddy.${key}`, values);

  useEffect(() => subscribeToRoomTimerState(setRoomTimer), []);
  useEffect(() => {
    if (previousUsername.current === username) return;
    previousUsername.current = username;
    window.clearTimeout(animationFallbackTimeout.current);
    reminderPending.current = false;
    reminderResponseClaimed.current = false;
    setReminder(null);
    setAnimationState('hidden');
  }, [username]);
  useEffect(() => {
    if (!preferences.focus_buddy_enabled) {
      reminderPending.current = false;
      localStorage.removeItem(storageKey);
      setReminder(null);
      setAnimationState('hidden');
      return undefined;
    }
    const nextAt = readWaterReminderSchedule(
      localStorage,
      storageKey,
      preferences.focus_buddy_interval_minutes,
    );
    let timeout;
    let disposed = false;
    const checkReminder = () => {
      if (disposed) return;
      window.clearTimeout(timeout);
      const remaining = waterReminderDelayMs(nextAt);
      if (remaining > 0) {
        timeout = window.setTimeout(checkReminder, Math.min(remaining, 2_147_000_000));
        return;
      }
      if (document.visibilityState === 'hidden') return;
      if (activeSession && !allowDuringSession) {
        setReminder(null);
        reminderPending.current = false;
        setAnimationState('hidden');
        return;
      }
      if (reminderPending.current) return;
      reminderPending.current = true;
      reminderResponseClaimed.current = false;
      setReminder((current) => current || { dueAt: nextAt });
      setAnimationState((current) => transitionFocusBuddyAnimation(current, 'reminderDue'));
    };
    const checkWhenActive = () => {
      if (document.visibilityState !== 'hidden') checkReminder();
    };
    document.addEventListener('visibilitychange', checkWhenActive);
    window.addEventListener('focus', checkWhenActive);
    checkReminder();
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', checkWhenActive);
      window.removeEventListener('focus', checkWhenActive);
    };
  }, [
    activeSession,
    allowDuringSession,
    preferences.focus_buddy_enabled,
    preferences.focus_buddy_interval_minutes,
    scheduleVersion,
    storageKey,
  ]);
  useEffect(() => {
    window.clearTimeout(animationFallbackTimeout.current);
    const fallbackDelays = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? { 'walking-in': 500, 'happy-swinging': 500, 'sad-walking-back': 500 }
      : { 'walking-in': 1400, 'happy-swinging': 2600, 'sad-walking-back': 2200 };
    const fallbackDelay = fallbackDelays[animationState];
    if (!fallbackDelay) return undefined;

    const finishAnimation = () => {
      if (document.visibilityState === 'hidden') {
        animationFallbackTimeout.current = window.setTimeout(finishAnimation, 500);
        return;
      }
      if (animationState === 'walking-in') {
        setAnimationState((current) => transitionFocusBuddyAnimation(current, 'entranceFinished'));
        return;
      }
      setReminder(null);
      reminderPending.current = false;
      setAnimationState((current) => transitionFocusBuddyAnimation(current, 'reactionFinished'));
    };
    animationFallbackTimeout.current = window.setTimeout(finishAnimation, fallbackDelay);
    return () => window.clearTimeout(animationFallbackTimeout.current);
  }, [animationState]);

  if (previousUsername.current !== username || !preferences.focus_buddy_enabled
    || (!reminder && animationState !== 'walking-in' && animationState !== 'waiting'
    && animationState !== 'happy-swinging' && animationState !== 'sad-walking-back')) return null;

  const respond = (action) => {
    const nextAnimationState = transitionFocusBuddyAnimation(animationState, action);
    const delay = waterReminderDelayForAction(preferences, action);
    if (!reminder || delay === null || nextAnimationState === animationState
      || !claimWaterReminderResponse(reminderResponseClaimed)) return;
    scheduleNextWaterReminder(localStorage, storageKey, delay);
    setScheduleVersion((version) => version + 1);
    setAnimationState(nextAnimationState);
  };
  const onCharacterAnimationEnd = (event) => {
    if (event.target !== event.currentTarget) return;
    const expectedAnimations = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? {
        'walking-in': 'buddy-reduced-enter',
        'happy-swinging': 'buddy-reduced-happy',
        'sad-walking-back': 'buddy-reduced-sad',
      }
      : {
        'walking-in': 'buddy-enter',
        'happy-swinging': 'buddy-happy-swing',
        'sad-walking-back': 'buddy-sad-walk',
      };
    if (event.animationName !== expectedAnimations[animationState]) return;
    window.clearTimeout(animationFallbackTimeout.current);
    if (animationState === 'walking-in') {
      setAnimationState((current) => transitionFocusBuddyAnimation(current, 'entranceFinished'));
      return;
    }
    setReminder(null);
    reminderPending.current = false;
    setAnimationState((current) => transitionFocusBuddyAnimation(current, 'reactionFinished'));
  };
  const name = preferences.focus_buddy_greet_by_name
    ? String(profile.player_name || '').trim()
    : '';
  const greeting = animationState === 'happy-swinging'
    ? t('thanks')
    : animationState === 'sad-walking-back'
      ? t('snoozed')
      : name ? t('greeting', { name }) : t('greetingFallback');
  const character = preferences.focus_buddy_character;

  return (
    <div
      className={`focus-buddy-overlay is-${animationState}`}
      dir="ltr"
    >
      <div className="focus-buddy-bubble" role="status" aria-live="polite" dir={textDirection(language)}>
        <p>{greeting}</p>
        {reminder && (animationState === 'walking-in' || animationState === 'waiting') && (
          <div className="focus-buddy-actions">
            <button type="button" className="buddy-done" disabled={animationState !== 'waiting'} onClick={() => respond('done')}>{t('done')}</button>
            <button type="button" className="buddy-later" disabled={animationState !== 'waiting'} onClick={() => respond('later')}>{t('later')}</button>
          </div>
        )}
      </div>
      <FocusBuddyCharacter
        character={character}
        animationState={animationState}
        onAnimationEnd={onCharacterAnimationEnd}
      />
    </div>
  );
}

function FocusRoom({
  profile,
  live,
  stream,
  videoRef,
  onStartCamera,
  onBeginSession,
  onStopSession,
  onStopCamera,
  onNotice,
  username,
  cameraState,
  cameraError,
  language,
}) {
  const [subject, setSubject] = useState('Mathematics');
  const [goal, setGoal] = useState('');
  const [mood, setMood] = useState('');
  const [sessionRunning, setSessionRunning] = useState(false);
  const [sessionPaused, setSessionPaused] = useState(false);
  const sessionLifecyclePromiseRef = useRef(Promise.resolve());
  const sessionConfiguration = normalizeDetectionConfiguration(
    live.session_active && live.session_configuration
      ? live.session_configuration
      : profile.session_preferences,
  );
  const t = (key, values) => translate(language, `focus.${key}`, values);
  const startSession = ({ duration, startedAt }) => {
    const plan = {
      subject,
      goal,
      mood,
      session_started_at: new Date(startedAt).toISOString(),
      session_duration_seconds: duration * 60,
      session_configuration: sessionConfiguration,
    };
    sessionLifecyclePromiseRef.current = Promise.resolve(onBeginSession(plan));
    void onStartCamera(plan);
  };
  const endSession = () => {
    void sessionLifecyclePromiseRef.current
      .then((started) => {
        if (started || live.session_active) return onStopSession();
        return undefined;
      })
      .catch((error) => onNotice(`Your focus session could not be completed: ${error.message}`));
  };
  const pauseSession = async () => {
    const started = await sessionLifecyclePromiseRef.current;
    if (started || live.session_active) {
      const data = await api(`/api/webcam/pause?username=${encodeURIComponent(username)}`, {
        method: 'POST',
        body: '{}',
      });
      setLive(data.live || {});
    }
    onStopCamera();
  };
  const resumeSession = async () => {
    const started = await sessionLifecyclePromiseRef.current;
    if (started || live.session_active) {
      const data = await api(`/api/webcam/resume?username=${encodeURIComponent(username)}`, {
        method: 'POST',
        body: '{}',
      });
      setLive(data.live || {});
    }
  };
  const canStart = Boolean(goal.trim()) && Boolean(mood);
  return <div className="page-content">
    <div className="focus-grid">
      <TimerPanel
        profile={profile}
        username={username}
        onNotice={onNotice}
        language={language}
        onSessionStart={startSession}
        onSessionEnd={endSession}
        onSessionPause={pauseSession}
        onSessionResume={resumeSession}
        onSessionStateChange={setSessionRunning}
        onSessionPauseStateChange={setSessionPaused}
        canStart={canStart}
      />
      <section className="session-panel surface-panel">
        <div className="panel-topline">
          <span className="eyebrow">{t('optionalCamera')}</span>
          <span className={`connection-label ${cameraState === 'active' ? 'connected' : ''}`}>
            <span className="live-dot" />{cameraState === 'active' ? t('live') : t('cameraOff')}
          </span>
        </div>
        <h3>{t('studyBuddy')}</h3>
        <p className="panel-copy">{t('cameraIntro')}</p>
        {stream ? (
          <div className="camera-preview">
            <video ref={videoRef} autoPlay muted playsInline />
            <div className="camera-overlay"><span className="live-dot" /> {t('cameraActive').toUpperCase()}</div>
            <CameraDetectionOverlay live={live} configuration={sessionConfiguration} language={language} />
            <button className="camera-stop" type="button" onClick={onStopCamera}>
              <VideoOff size={16} /> {t('stopCamera')}
            </button>
          </div>
        ) : (
          <div className="camera-placeholder">
            <Video size={25} />
            <span>{t('cameraPreview')}</span>
            <small>{t('cameraLocal')}</small>
            {sessionRunning && !sessionPaused && profile.session_preferences?.focus_monitoring && (
              <button
                className="outline-button"
                type="button"
                onClick={() => onStartCamera({ session_configuration: sessionConfiguration })}
              ><Video size={16} /> {t('enableCamera')}</button>
            )}
          </div>
        )}
        {!sessionRunning && (
          <div className="form-grid">
            <label>{t('workingOn')}<select value={subject} onChange={(event) => setSubject(event.target.value)}>{['Mathematics', 'Science', 'Coding', 'Assignment', 'Other'].map((item) => <option key={item} value={item}>{t(`subject.${item}`)}</option>)}</select></label>
            <label>{t('sessionGoal')}<input maxLength="200" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder={t('goalPlaceholder')} /></label>
            <label>{t('feeling')}<select value={mood} onChange={(event) => setMood(event.target.value)}><option value="">{t('chooseMood')}</option>{focusMoods.map((item) => <option key={item} value={item}>{t(`mood.${item}`)}</option>)}</select></label>
          </div>
        )}
        {mood && !sessionRunning && (
          <div className="mood-focus-tip" role="status" aria-live="polite">
            <Sparkles size={16} aria-hidden="true" />
            <p>{translate(language, `focus.moodTip.${mood}`)}</p>
          </div>
        )}
        {!stream && cameraState !== 'off' && (
          <div className="camera-signals">
            <div><small>{t('cameraStatusLabel')}</small><strong>{cameraStatusText(cameraState, live, language)}</strong></div>
            {cameraError && <p role="status">{cameraError}</p>}
          </div>
        )}
        {stream && <div className="camera-signals">
          <div><small>{t('cameraStatusLabel')}</small><strong>{cameraStatusText(cameraState, live, language)}</strong></div>
          <div><small>{t('posture')}</small><strong>{sessionConfiguration.monitor_posture ? postureStatusText(cameraState, live, language) : t('notMonitored')}</strong></div>
          <div><small>{t('headTurn')}</small><strong>{sessionConfiguration.monitor_looking_away ? live.looking_away === null || live.looking_away === undefined ? t('waitingFace') : live.looking_away ? t('turnDetected') : t('noTurn') : t('notMonitored')}</strong></div>
          <div><small>{t('face')}</small><strong>{sessionConfiguration.monitor_face_missing ? live.face_detected ? t('detected') : t('notDetected') : t('notMonitored')}</strong></div>
          {cameraError && <p role="status">{cameraError}</p>}
          <p>{t('cameraSignalsNote')}</p>
        </div>}
      </section>
    </div>
  </div>;
}

function Insights({ profile, language }) {
  const t = (key, values) => translate(language, `insights.${key}`, values);
  const rows = [...(Array.isArray(profile.session_history) ? profile.session_history : [])]
    .filter((row) => row && row.date && Number(row.seconds) > 0)
    .reverse();
  const timeFormat = profile.session_preferences?.time_format || 'system';
  const sessionStartTime = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const options = { hour: 'numeric', minute: '2-digit' };
    if (timeFormat !== 'system') options.hour12 = timeFormat === '12-hour';
    return date.toLocaleTimeString(language, options);
  };
  const timerHistory = Array.isArray(profile.focus_timer_history) ? profile.focus_timer_history : [];
  const sessions = Number(profile.sessions_completed || 0);
  const seconds = Number(profile.total_study_seconds || 0) + Number(profile.focus_timer_total_seconds || 0);
  const alertsFor = (item) => ({
    posture: isDetectionSignalMonitored(item, 'slouching') ? Math.max(0, Number(item.posture_alerts) || 0) : null,
    distance: isDetectionSignalMonitored(item, 'distance_alert') ? Math.max(0, Number(item.distance_alerts) || 0) : null,
    lookingAway: isDetectionSignalMonitored(item, 'looking_away') ? Math.max(0, Number(item.looking_away_alerts) || 0) : null,
    fatigue: isDetectionSignalMonitored(item, 'eyes_closed') ? Math.max(0, Number(item.fatigue_signals) || 0) : null,
    faceMissing: isDetectionSignalMonitored(item, 'face_missing') ? Math.max(0, Number(item.face_missing_alerts) || 0) : null,
  });
  const alertTotalFor = (item) => Object.values(alertsFor(item))
    .filter(Number.isFinite)
    .reduce((sum, count) => sum + count, 0);
  const hasMonitoredSignals = (item) => Object.values(alertsFor(item)).some(Number.isFinite);
  const totalAlerts = rows.reduce((total, item) => total + alertTotalFor(item), 0);
  const week = weekStudyDays(profile).map((day) => {
    const cameraSeconds = rows.filter((item) => String(item.date).slice(0, 10) === day.date)
      .reduce((total, item) => total + Number(item.seconds || 0), 0);
    const timerSeconds = timerHistory.filter((item) => item.date === day.date)
      .reduce((total, item) => total + Number(item.seconds || 0), 0);
    return { ...day, value: Math.floor((cameraSeconds + timerSeconds) / 60) };
  });
  const weekStart = new Date(`${week[0].date}T12:00:00`);
  weekStart.setDate(weekStart.getDate() - 7);
  const priorWeekKeys = new Set(Array.from({ length: 7 }, (_, index) => {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + index);
    return localDateKey(day);
  }));
  const priorWeekSeconds = rows.filter((item) => priorWeekKeys.has(String(item.date).slice(0, 10)))
    .reduce((total, item) => total + Number(item.seconds || 0), 0)
    + timerHistory.filter((item) => priorWeekKeys.has(item.date))
      .reduce((total, item) => total + Number(item.seconds || 0), 0);
  const priorWeekMinutes = priorWeekSeconds / 60;
  const thisWeekMinutes = week.reduce((total, day) => total + day.value, 0);
  const bestDay = [...week].filter((day) => day.value > 0).sort((a, b) => b.value - a.value)[0];
  const alertTotals = rows.reduce((total, row) => {
    const alerts = alertsFor(row);
    return {
      posture: total.posture + alerts.posture,
      distance: total.distance + alerts.distance,
      lookingAway: total.lookingAway + alerts.lookingAway,
      fatigue: total.fatigue + alerts.fatigue,
    };
  }, { posture: 0, distance: 0, lookingAway: 0, fatigue: 0 });
  const averageCameraMinutes = rows.length
    ? Math.round(rows.reduce((total, item) => total + Number(item.seconds || 0), 0) / rows.length / 60)
    : 0;
  const periods = [
    { name: 'morning', start: 5, end: 12 },
    { name: 'afternoon', start: 12, end: 18 },
    { name: 'evening', start: 18, end: 24 },
    { name: 'night', start: 0, end: 5 },
  ];
  const timedSessions = rows.map((item) => ({ ...item, start: item.session_started_at ? new Date(item.session_started_at) : null }))
    .filter((item) => item.start && Number.isFinite(item.start.getTime()));
  const strongestPeriod = timedSessions.length >= 3
    ? periods.map((period) => {
      const samples = timedSessions.filter((item) => item.start.getHours() >= period.start && item.start.getHours() < period.end);
      return { ...period, count: samples.length, average: samples.length ? samples.reduce((sum, item) => sum + Number(item.seconds || 0), 0) / samples.length : 0 };
    }).filter((period) => period.count > 0).sort((a, b) => b.average - a.average)[0]
    : null;
  const maxWeek = Math.max(30, ...week.map((day) => day.value));
  const exportCsv = () => { const columns = [t('date'), t('subject'), t('goal'), t('task'), t('studyTime'), t('cameraAlerts'), t('xpEarned')]; const lines = [columns, ...rows.map((item) => [item.date, item.subject || '', item.goal || '', item.task_text || '', `${Math.floor(Number(item.seconds || 0) / 60)} ${translate(language, 'preferences.minutes')}`, Object.values(alertsFor(item)).reduce((sum, count) => sum + count, 0), item.xp || 0])].map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(',')); downloadText('focusmate-session-history.csv', lines.join('\n'), 'text/csv'); };
  return (
    <div className="page-content">
      <div className="stats-grid insights-stats">
        <Stat label={t('completedSessions')} value={sessions} note={t('cameraDataCount', { count: rows.length })} icon={BookOpen} />
        <Stat label={t('studyTimeWeek')} value={`${thisWeekMinutes} ${translate(language, 'preferences.minutes')}`} note={t('calendarDays')} icon={Clock3} />
        <Stat label={t('studyDayStreak')} value={`${studyStreak(profile)} ${translate(language, 'dashboard.days')}`} note={t('savedActivityOnly')} icon={Flame} />
        <Stat label={t('averageCamera')} value={rows.length ? `${averageCameraMinutes} ${translate(language, 'preferences.minutes')}` : t('notEnoughData')} note={t('cameraSessionBasis')} icon={Activity} />
      </div>
      <div className="content-columns chart-columns">
        <section className="surface-panel chart-panel">
          <div className="section-heading"><div><span className="eyebrow">{t('calendarWeek')}</span><h3>{t('focusTime')}</h3></div><span className="chart-legend mint"><i /> {t('studyMinutes')}</span></div>
          {thisWeekMinutes ? <div className="week-chart">{week.map((day) => <div className="week-column" key={day.date}><span>{day.value || ''}</span><i style={{ height: `${Math.max(3, day.value / maxWeek * 100)}%` }} /><small>{new Date(`${day.date}T12:00:00`).toLocaleDateString(language, { weekday: 'short' })}</small></div>)}</div> : <div className="empty-state">{t('chartEmpty')}</div>}
          <p className="muted-note">{t('weekSummary', { minutes: thisWeekMinutes })}</p>
        </section>
        <section className="surface-panel analytics-detail">
          <span className="eyebrow">{t('cameraSignals')}</span><h3>{t('sessionAlerts')}</h3>
          {rows.length ? <dl className="analytics-list"><div><dt>{t('postureAlerts')}</dt><dd>{alertTotals.posture}</dd></div><div><dt>{t('lookingAway')}</dt><dd>{alertTotals.lookingAway}</dd></div><div><dt>{t('distanceAlerts')}</dt><dd>{alertTotals.distance}</dd></div><div><dt>{t('fatigue')}</dt><dd>{alertTotals.fatigue}</dd></div></dl> : <div className="empty-state">{t('cameraAnalyticsEmpty')}</div>}
          <p className="muted-note">{t('signalsDisclaimer')}</p>
        </section>
      </div>
      <section className="surface-panel personal-insights">
        <span className="eyebrow">{t('personal')}</span><h3>{t('activityShows')}</h3>
        {!seconds ? <div className="empty-state">{t('insightsEmpty')}</div> : <div className="insight-list">
          {bestDay && <p><strong>{t('bestDay')}</strong><span>{new Date(`${bestDay.date}T12:00:00`).toLocaleDateString(language, { weekday: 'long' })} · {bestDay.value} {translate(language, 'preferences.minutes')}</span></p>}
          {priorWeekMinutes > 0 && thisWeekMinutes !== Math.round(priorWeekMinutes) && <p><strong>{thisWeekMinutes > priorWeekMinutes ? t('studyTimeUp') : t('gentlerWeek')}</strong><span>{Math.abs(Math.round((thisWeekMinutes - priorWeekMinutes) / priorWeekMinutes * 100))}% {thisWeekMinutes > priorWeekMinutes ? t('more') : t('less')} {t('thanLastWeek')}</span></p>}
          {strongestPeriod && <p><strong>{t('strongestPeriod', { period: t(`period.${strongestPeriod.name}`) })}</strong><span>{t('periodBasis', { count: timedSessions.length })}</span></p>}
          {rows.length > 0 && !strongestPeriod && <p><strong>{t('keepStudying')}</strong><span>{t('moreSessionsForComparison')}</span></p>}
          {totalAlerts > 0 && <p><strong>{t('signalSummary')}</strong><span>{t('signalTotal', { count: totalAlerts })}</span></p>}
        </div>}
      </section>
      <section className="history-section">
        <div className="section-heading"><div><span className="eyebrow">{t('yourHistory')}</span><h3>{t('savedSessions')}</h3></div><button className="outline-button" onClick={exportCsv}><ArrowUpRight size={15} /> {t('downloadCsv')}</button></div>
        {rows.length ? <><p className="muted-note">{t('unmonitoredNote')}</p><div className="table-wrap"><table><thead><tr><th>{t('dateTime')}</th><th>{t('subject')}</th><th>{t('goal')}</th><th>{t('studyTime')}</th><th>{t('cameraAlerts')}</th><th>{t('xpEarned')}</th></tr></thead><tbody>{rows.slice(0, 50).map((item, index) => <tr key={`${item.date}-${index}`}><td>{new Date(`${String(item.date).slice(0, 10)}T12:00:00`).toLocaleDateString(language)}{sessionStartTime(item.session_started_at) && <small>{sessionStartTime(item.session_started_at)}</small>}</td><td>{item.subject || '—'}</td><td>{item.goal || item.task_text || '—'}</td><td>{Math.floor(Number(item.seconds || 0) / 60)} {translate(language, 'preferences.minutes')}</td><td>{hasMonitoredSignals(item) ? alertTotalFor(item) : translate(language, 'focus.notMonitored')}</td><td>{item.xp || 0}</td></tr>)}</tbody></table></div></> : <div className="empty-state">{t('historyEmpty')}</div>}
      </section>
    </div>
  );
}

function SessionResults({ live, profile, username, onProfile, onGoal, language }) {
  const t = (key, values) => translate(language, `results.${key}`, values);
  const [outcome, setOutcome] = useState(live.goal_outcome || '');
  const completed = live.session_completed;
  const configuration = normalizeDetectionConfiguration(live.session_configuration);
  const resultSignals = [
    ['posture', configuration.monitor_posture, live.posture_alerts],
    ['distance', configuration.monitor_distance, live.distance_alerts],
    ['lookingAway', configuration.monitor_looking_away, live.looking_away_alerts],
    ['eyeClosure', configuration.monitor_eye_closure, live.fatigue_signals],
    ['faceMissing', configuration.monitor_face_missing, live.face_missing_alerts],
  ];
  const totalAlerts = resultSignals.reduce(
    (total, [, monitored, count]) => total + (monitored ? Number(count) || 0 : 0),
    0,
  );
  const reflection = (profile.session_reflections || []).find((item) => item.session_id === live.session_id);
  const generatedReflection = reflection?.source === 'Local summary' && reflection.stats?.alert_counts;
  const reflectionMinutes = Number(reflection?.stats?.duration_minutes || Math.round(Number(live.session_seconds || 0) / 60));
  const highestSignal = Object.entries(reflection?.stats?.alert_counts || {})
    .filter(([, value]) => Number.isFinite(value))
    .sort((left, right) => right[1] - left[1])[0];
  const reflectionSummary = generatedReflection
    ? t('signalSummary', { count: totalAlerts })
    : reflection?.summary || t('signalSummary', { count: totalAlerts });
  const whatWentWell = generatedReflection
    ? [t('minutesCompleted', { minutes: reflectionMinutes }), t('visibleSignals')]
    : reflection?.what_went_well || [
      t('minutesCompleted', { minutes: reflectionMinutes }),
      t('visibleSignals'),
    ];
  const tryNext = generatedReflection
    ? [highestSignal?.[1] > 0 ? t(`suggestion.${highestSignal[0]}`) : t('nextSuggestion')]
    : reflection?.try_next || [t('nextSuggestion')];
  useEffect(() => {
    if (!completed || !reflection) return;
    api(`/api/session/reflection?username=${encodeURIComponent(username)}`, { method: 'POST', body: '{}' })
      .then((data) => onProfile(data.profile))
      .catch(() => {});
  }, [completed, reflection?.session_id, username, onProfile]);
  const saveOutcome = async (value) => { setOutcome(value); try { await onGoal(value); } catch { setOutcome(''); } };
  return (
    <div className="page-content">
      {!completed ? <div className="surface-panel reflection-empty"><span className="reflection-icon"><Sparkles size={22} /></span><h3>{t('waiting')}</h3><p>{t('waitingText')}</p></div> : <>
        <div className="reflection-banner"><span className="reflection-icon"><Sparkles size={22} /></span><div><span className="eyebrow">{t('eyebrow')}</span><h2>{t('title')}</h2><p>{reflectionSummary}</p></div><span className="local-badge"><ShieldCheck size={14} /> {t('localSummary')}</span></div>
        <div className="stats-grid result-stats"><Stat label={t('duration')} value={`${Math.round(Number(live.session_seconds || 0) / 60)} ${translate(language, 'preferences.minutes')}`} note={t('buddyTime')} icon={Clock3} /><Stat label={t('cameraAlerts')} value={totalAlerts} note={t('visibleCounts')} icon={Activity} /><Stat label={t('posture')} value={!configuration.monitor_posture ? t('notMonitored') : live.pose_detected ? translate(language, `focus.postureState.${live.posture || 'Unknown'}`) : t('notAvailable')} note={!configuration.monitor_posture ? t('notMonitored') : live.pose_detected ? t('visibleLandmarks') : live.pose_detection_status === 'missing' ? t('shouldersMissing') : t('shouldersUnavailable')} icon={UserRound} /></div>
        <section className="surface-panel result-signal-counts" aria-label={t('signalCounts')}>
          <span className="eyebrow">{t('signalCounts')}</span>
          <dl>{resultSignals.map(([name, monitored, count]) => <div key={name}><dt>{t(name)}</dt><dd>{monitored ? Number(count) || 0 : t('notMonitored')}</dd></div>)}</dl>
        </section>
        <div className="content-columns"><section className="surface-panel reflection-list"><span className="eyebrow">{t('wentWell')}</span><h3>{t('giveCredit')}</h3>{whatWentWell.map((item) => <p key={item}>{item}</p>)}</section><section className="surface-panel reflection-list"><span className="eyebrow">{t('tryNext')}</span><h3>{t('smallIdea')}</h3>{tryNext.map((item) => <p key={item}>{item}</p>)}</section></div>
        {live.study_goal && <section className="goal-checkin surface-panel"><span className="eyebrow">{t('sessionGoal')}</span><h3>{live.study_goal}</h3><label>{t('howGo')}<select value={outcome} onChange={(event) => saveOutcome(event.target.value)}><option value="">{t('chooseOne')}</option><option value="Yes">{t('yes')}</option><option value="Partially">{t('partially')}</option><option value="Not yet">{t('notYet')}</option></select></label>{outcome && <small className="saved-note"><Check size={14} /> {t('savedCheckin', { outcome: t(outcome.toLowerCase().replace(' ', '')) })}</small>}</section>}
      </>}
    </div>
  );
}

function Achievements({ profile, language }) {
  const t = (key, values) => translate(language, `achievements.${key}`, values);
  const earnedRecords = new Map((profile.achievements || []).map((item) => [
    typeof item === 'string' ? item : item?.id,
    typeof item === 'string' ? null : item,
  ]));
  const earned = new Set(earnedRecords.keys());
  const groups = [...new Set(achievements.map((item) => item[4]))];
  const count = achievements.filter((item) => earned.has(item[0])).length;
  return (
    <div className="page-content">
      <section className="achievement-progress surface-panel">
        <div><span className="eyebrow">{t('collection')}</span><h3>{t('unlockedCount', { count, total: achievements.length })}</h3></div>
        <div className="progress-track" role="progressbar" aria-label={t('unlocked')} aria-valuemin="0" aria-valuemax={achievements.length} aria-valuenow={count}>
          <span style={{ width: `${count / achievements.length * 100}%` }} />
        </div>
      </section>
      {count === achievements.length && (
        <section className="achievement-full-collection" role="status" aria-live="polite">
          <Trophy size={24} aria-hidden="true" />
          <div><strong>{t('fullCollectionTitle')}</strong><p>{t('fullCollectionDescription')}</p></div>
          <Sparkles size={20} aria-hidden="true" />
        </section>
      )}
      {groups.map((group) => {
        const entries = achievements.filter((item) => item[4] === group);
        return (
          <section className="achievement-group" key={group}>
            <div className="section-heading">
              <div><span className="eyebrow">{t(`group.${group}`)}</span><h3>{t(`group.${group}`)}</h3></div>
              <span className="group-count">{entries.filter((item) => earned.has(item[0])).length} / {entries.length}</span>
            </div>
            <div className="achievement-grid">
              {entries.map(([id, title, description, reward]) => {
                const localizedTitle = translateAchievement(language, id, 'title', title);
                const localizedDescription = translateAchievement(language, id, 'description', description);
                const record = earnedRecords.get(id);
                const progress = record ? null : achievementProgress(profile, id);
                const earnedAt = record?.earned_at && new Date(record.earned_at);
                const earnedDate = earnedAt && Number.isFinite(earnedAt.getTime())
                  ? earnedAt.toLocaleDateString(language)
                  : '';
                return (
                  <article className={`achievement-card ${record || earned.has(id) ? 'earned' : ''}`} key={id}>
                    <div className="achievement-symbol">{earned.has(id) ? <Trophy size={18} /> : <LockKeyhole size={17} />}</div>
                    <div>
                      <h4>{localizedTitle}</h4>
                      <p>{localizedDescription}</p>
                      {earned.has(id)
                        ? <small>{earnedDate ? t('unlockedOn', { date: earnedDate }) : t('unlocked')} · +{reward} XP</small>
                        : <>
                          <small>{t('reward')} · +{reward} XP</small>
                          {progress && (
                            <div className="achievement-progress-detail">
                              <span>{progress.current} / {progress.target} {String(progress.unit).startsWith('room') || ['focusSeconds', 'hostedSessions', 'differentRooms', 'consecutiveDays', 'friendRoomSessions'].includes(progress.unit) ? translate(language, `achievements.progressUnit.${progress.unit}`) : progress.unit}</span>
                              <div className="progress-track" role="progressbar" aria-label={`${localizedTitle} progress`} aria-valuemin="0" aria-valuemax={progress.target} aria-valuenow={progress.current}>
                                <span style={{ width: `${progress.current / progress.target * 100}%` }} />
                              </div>
                            </div>
                          )}
                        </>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Quests({
  profile,
  language,
  onReroll,
  cloudAccount,
  dailyProgressLoading,
}) {
  return <div className="page-content"><DailyQuests profile={profile} language={language} onReroll={onReroll} cloudAccount={cloudAccount} dailyProgressLoading={dailyProgressLoading} /><p className="muted-note">Progress is derived from saved timer activity and completed camera sessions. Camera alert challenges require recorded camera data.</p></div>;
}

function Preferences({ profile, onSave }) {
  const defaults = {
    focus_monitoring: true,
    posture_alerts: true,
    ...defaultDetectionConfiguration,
    mood_checkins: true,
    session_chimes: false,
    focus_buddy_enabled: true,
    focus_buddy_character: 'web-hero',
    focus_buddy_interval_minutes: 60,
    focus_buddy_snooze_minutes: 10,
    focus_buddy_greet_by_name: true,
    focus_buddy_during_sessions: false,
    session_length_minutes: 25,
    daily_goal_minutes: 60,
    language: 'system',
    theme: 'system',
    study_style: 'normal',
    study_goal_type: 'self-study',
    time_format: 'system',
  };
  const [preferences, setPreferences] = useState({ ...defaults, ...(profile.session_preferences || {}) });
  const [saved, setSaved] = useState(false);
  const set = (key, value) => {
    const updated = { ...preferences, [key]: value };
    setPreferences(updated);
    if (key === 'language') {
      if (value === 'system') localStorage.removeItem('focusmate-language');
      else localStorage.setItem('focusmate-language', value);
      window.dispatchEvent(new Event('focusmate:language-changed'));
      void onSave({ session_preferences: updated });
    }
  };
  const save = async () => { await onSave({ session_preferences: preferences }); setSaved(true); window.setTimeout(() => setSaved(false), 2000); };
  const rows = [
    ['focus_monitoring', 'monitoring', 'monitoringHelp'],
    ['posture_alerts', 'postureAlerts', 'postureHelp'],
    ['mood_checkins', 'moodCheckins', 'moodHelp'],
    ['session_chimes', 'sessionChimes', 'chimesHelp'],
  ];
  const detectionRows = [
    ['monitor_looking_away', 'lookingAwayMonitoring', 'lookingAwayMonitoringHelp'],
    ['monitor_posture', 'postureMonitoring', 'postureMonitoringHelp'],
    ['monitor_eye_closure', 'eyeClosureMonitoring', 'eyeClosureMonitoringHelp'],
    ['monitor_face_missing', 'faceMissingMonitoring', 'faceMissingMonitoringHelp'],
    ['monitor_distance', 'distanceMonitoring', 'distanceMonitoringHelp'],
    ['show_detection_overlay', 'detectionOverlaySetting', 'detectionOverlayHelp'],
  ];
  const language = preferences.language !== 'system' && supportedLanguages.includes(preferences.language) ? preferences.language : browserLanguage();
  const selectedLanguage = supportedLanguages.includes(preferences.language) ? preferences.language : 'system';
  const preferenceSelect = (key, title, values) => (
    <label className="language-setting" key={key}>
      <span><strong>{title}</strong></span>
      <select value={key === 'language' ? selectedLanguage : preferences[key]} onChange={(event) => set(key, event.target.value)} aria-label={title}>
        {values.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
  );
  const sessionPresets = [15, 25, 45];
  const selectedSessionLength = sessionPresets.includes(Number(preferences.session_length_minutes))
    ? String(preferences.session_length_minutes)
    : 'custom';
  const selectedDailyGoal = [30, 60, 90, 120].includes(Number(preferences.daily_goal_minutes))
    ? String(preferences.daily_goal_minutes)
    : 'custom';
  return (
    <div className="page-content settings-layout">
      <section className="surface-panel settings-panel">
        <div className="settings-heading">
          <span className="eyebrow">{translate(language, 'preferences.settingsEyebrow')}</span>
          <h3>{translate(language, 'preferences.settingsTitle')}</h3>
          <p>{translate(language, 'preferences.settingsDescription')}</p>
        </div>
        {preferenceSelect('language', translate(language, 'preferences.language'), [
          ['system', translate(language, 'preferences.systemLanguage')],
          ...supportedLanguages.map((code) => [code, translate(language, `language.${code}`)]),
        ])}
        {preferenceSelect('theme', translate(language, 'preferences.theme'), [
          ['system', translate(language, 'preferences.themeSystem')],
          ['light', translate(language, 'preferences.themeLight')],
          ['dark', translate(language, 'preferences.themeDark')],
        ])}
        {preferenceSelect('study_style', translate(language, 'preferences.studyStyle'), [
          ['quiet', translate(language, 'preferences.quiet')],
          ['normal', translate(language, 'preferences.normal')],
          ['competitive', translate(language, 'preferences.competitive')],
        ])}
        {preferenceSelect('study_goal_type', translate(language, 'preferences.mainGoal'), [
          ['school', translate(language, 'preferences.school')],
          ['university', translate(language, 'preferences.university')],
          ['self-study', translate(language, 'preferences.selfStudy')],
          ['reading', translate(language, 'preferences.reading')],
          ['coding', translate(language, 'preferences.coding')],
          ['exam-preparation', translate(language, 'preferences.examPreparation')],
        ])}
        {preferenceSelect('time_format', translate(language, 'preferences.timeFormat'), [
          ['system', translate(language, 'preferences.themeSystem')],
          ['12-hour', translate(language, 'preferences.twelveHour')],
          ['24-hour', translate(language, 'preferences.twentyFourHour')],
        ])}
        {rows.map(([key, titleKey, descriptionKey]) => (
          <label className="setting-row" key={key}>
            <span><strong>{translate(language, `preferences.${titleKey}`)}</strong><small>{translate(language, `preferences.${descriptionKey}`)}</small></span>
            <input type="checkbox" checked={Boolean(preferences[key])} onChange={(event) => set(key, event.target.checked)} />
            <i className="toggle-track" />
          </label>
        ))}
        <div className="focus-buddy-preferences">
          <div className="detection-preferences-heading">
            <span className="eyebrow">{translate(language, 'focusBuddy.title')}</span>
            <p>{translate(language, 'focusBuddy.description')}</p>
          </div>
          <label className="setting-row">
            <span><strong>{translate(language, 'focusBuddy.enabled')}</strong><small>{translate(language, 'focusBuddy.enabledHelp')}</small></span>
            <input type="checkbox" checked={Boolean(preferences.focus_buddy_enabled)} onChange={(event) => set('focus_buddy_enabled', event.target.checked)} />
            <i className="toggle-track" />
          </label>
          <label className="buddy-setting-select">
            <strong>{translate(language, 'focusBuddy.character')}</strong>
            <select disabled={!preferences.focus_buddy_enabled} value={preferences.focus_buddy_character} onChange={(event) => set('focus_buddy_character', event.target.value)}>
              {focusBuddyCharacters.map((character) => <option key={character} value={character}>{translate(language, `focusBuddy.${character === 'web-hero' ? 'webHero' : character === 'cape-hero' ? 'capeHero' : character}`)}</option>)}
            </select>
          </label>
          <div className="buddy-number-settings">
            <label>
              {translate(language, 'focusBuddy.interval')}
              <select disabled={!preferences.focus_buddy_enabled} value={preferences.focus_buddy_interval_minutes} onChange={(event) => set('focus_buddy_interval_minutes', Number(event.target.value))}>
                {waterReminderIntervals.map((minutes) => <option key={minutes} value={minutes}>{minutes} {translate(language, 'focus.minutes')}</option>)}
              </select>
            </label>
            <label>
              {translate(language, 'focusBuddy.snooze')}
              <select disabled={!preferences.focus_buddy_enabled} value={preferences.focus_buddy_snooze_minutes} onChange={(event) => set('focus_buddy_snooze_minutes', Number(event.target.value))}>
                {waterReminderSnoozes.map((minutes) => <option key={minutes} value={minutes}>{minutes} {translate(language, 'focus.minutes')}</option>)}
              </select>
            </label>
          </div>
          <label className="setting-row">
            <span><strong>{translate(language, 'focusBuddy.greetByName')}</strong></span>
            <input type="checkbox" disabled={!preferences.focus_buddy_enabled} checked={Boolean(preferences.focus_buddy_greet_by_name)} onChange={(event) => set('focus_buddy_greet_by_name', event.target.checked)} />
            <i className="toggle-track" />
          </label>
          <label className="setting-row">
            <span><strong>{translate(language, 'focusBuddy.duringSessions')}</strong><small>{translate(language, 'focusBuddy.duringSessionsHelp')}</small></span>
            <input type="checkbox" disabled={!preferences.focus_buddy_enabled} checked={Boolean(preferences.focus_buddy_during_sessions)} onChange={(event) => set('focus_buddy_during_sessions', event.target.checked)} />
            <i className="toggle-track" />
          </label>
        </div>
        <div className="detection-preferences-heading">
          <span className="eyebrow">{translate(language, 'preferences.detectionHeading')}</span>
          <p>{translate(language, 'preferences.detectionDescription')}</p>
        </div>
        {detectionRows.map(([key, titleKey, descriptionKey]) => (
          <label className="setting-row" key={key}>
            <span><strong>{translate(language, `preferences.${titleKey}`)}</strong><small>{translate(language, `preferences.${descriptionKey}`)}</small></span>
            <input type="checkbox" checked={Boolean(preferences[key])} onChange={(event) => set(key, event.target.checked)} />
            <i className="toggle-track" />
          </label>
        ))}
        <div className="number-settings">
          <label>
            {translate(language, 'preferences.sessionLength')}
            <span>
              <select
                value={selectedSessionLength}
                onChange={(event) => set('session_length_minutes', event.target.value === 'custom' ? 30 : Number(event.target.value))}
                aria-label={translate(language, 'preferences.sessionLength')}
              >
                {sessionPresets.map((minutes) => <option value={minutes} key={minutes}>{minutes} {translate(language, 'preferences.minutes')}</option>)}
                <option value="custom">{translate(language, 'preferences.custom')}</option>
              </select>
              {selectedSessionLength === 'custom' && (
                <input
                  type="number"
                  min="15"
                  max="120"
                  step="5"
                  value={preferences.session_length_minutes}
                  onChange={(event) => set('session_length_minutes', Number(event.target.value))}
                  aria-label={`${translate(language, 'preferences.sessionLength')} · ${translate(language, 'preferences.custom')}`}
                />
              )}
            </span>
          </label>
          <label>
            {translate(language, 'preferences.dailyGoal')}
            <span>
              <select
                value={selectedDailyGoal}
                onChange={(event) => set('daily_goal_minutes', event.target.value === 'custom' ? 150 : Number(event.target.value))}
                aria-label={translate(language, 'preferences.dailyGoal')}
              >
                {[30, 60, 90, 120].map((minutes) => <option value={minutes} key={minutes}>{minutes} {translate(language, 'preferences.minutes')}</option>)}
                <option value="custom">{translate(language, 'preferences.custom')}</option>
              </select>
              {selectedDailyGoal === 'custom' && (
                <input
                  type="number"
                  min="30"
                  max="720"
                  step="15"
                  value={preferences.daily_goal_minutes}
                  onChange={(event) => set('daily_goal_minutes', Number(event.target.value))}
                  aria-label={`${translate(language, 'preferences.dailyGoal')} · ${translate(language, 'preferences.custom')}`}
                />
              )}
            </span>
          </label>
        </div>
        <button className="primary-button" onClick={save}><Check size={16} /> {saved ? translate(language, 'app.saved') : translate(language, 'preferences.savePreferences')}</button>
      </section>
      <section className="surface-panel profile-summary">
        <span className="eyebrow">{translate(language, 'preferences.yourProfile')}</span>
        <div className="summary-person">
          <div className="avatar">{(profile.player_name || 'F')[0].toUpperCase()}</div>
          <div><strong>{profile.player_name}</strong><small>@{profile.username}</small></div>
        </div>
        <dl>
          <div><dt>{translate(language, 'preferences.rank')}</dt><dd>{translate(language, 'preferences.level')} {levelForXp(profile.total_xp)}</dd></div>
          <div><dt>{translate(language, 'preferences.studyStyle')}</dt><dd>{translate(language, `preferences.${preferences.study_style}`)}</dd></div>
          <div><dt>{translate(language, 'preferences.sessionLength')}</dt><dd>{preferences.session_length_minutes} {translate(language, 'preferences.minutes')}</dd></div>
          <div><dt>{translate(language, 'preferences.dailyGoal')}</dt><dd>{Math.floor(preferences.daily_goal_minutes / 60)}h {String(preferences.daily_goal_minutes % 60).padStart(2, '0')}m</dd></div>
        </dl>
      </section>
    </div>
  );
}

function Profile({ profile, onSave, onExport, cloudAccount, language }) {
  const [name, setName] = useState(profile.player_name || '');
  const [sleep, setSleep] = useState(profile.session_wellbeing?.sleep_hours || 0);
  const [water, setWater] = useState(profile.water_glasses_today || 0);
  const [reflection, setReflection] = useState(profile.session_wellbeing?.reflection || '');
  const [saved, setSaved] = useState(false);
  const save = async (event) => { event.preventDefault(); const wellbeing = { ...profile.session_wellbeing, sleep_hours: Number(sleep), water_glasses: Number(water), reflection: reflection.slice(0, 500) }; await onSave({ player_name: name, water_glasses_today: Number(water), session_wellbeing: wellbeing }); setSaved(true); window.setTimeout(() => setSaved(false), 2000); };
  const t = (key, values) => translate(language, `profile.${key}`, values);
  return <div className="page-content settings-layout"><form className="surface-panel profile-form" onSubmit={save}><span className="eyebrow">{t('about')}</span><h3>{t('title')}</h3>{cloudAccount && <div className="cloud-profile-note">{t('cloudSync', { username: cloudAccount.username })}</div>}<label>{t('name')}<input maxLength="80" value={name} onChange={(event) => setName(event.target.value)} /></label><div className="form-grid"><label>{t('sleep')}<input type="number" min="0" max="24" step="0.5" value={sleep} onChange={(event) => setSleep(event.target.value)} /></label><label>{t('water')}<input type="number" min="0" max="100" value={water} onChange={(event) => setWater(event.target.value)} /></label></div><label>{t('note')}<textarea maxLength="500" rows="4" value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder={t('notePlaceholder')} /></label><button className="primary-button" type="submit"><Check size={16} /> {saved ? t('saved') : t('save')}</button></form><section className="surface-panel data-panel"><span className="eyebrow">{t('dataEyebrow')}</span><h3>{cloudAccount ? t('cloudTitle') : t('localTitle')}</h3><p>{cloudAccount ? t('cloudData') : t('localData')}</p><button className="outline-button full-button" onClick={onExport}><ArrowUpRight size={15} /> {t('export')}</button><div className="privacy-card"><LockKeyhole size={17} /><span>{cloudAccount ? t('cloudSecurity') : t('localSecurity')}</span></div></section></div>;
}

function downloadText(filename, contents, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([contents], { type })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function downloadProfile(profile) { downloadText('focusmate-profile.json', JSON.stringify(profile, null, 2), 'application/json'); }

function App() {
  const [publicPage, setPublicPage] = useState(() => publicPageFromLocation(window.location));
  const [unknownPath, setUnknownPath] = useState(() => isUnknownPath(window.location));
  const [pwaSurface, setPwaSurface] = useState('hidden');
  useEffect(() => {
    const syncLocation = () => {
      setPublicPage(publicPageFromLocation(window.location));
      setUnknownPath(isUnknownPath(window.location));
    };
    window.addEventListener('popstate', syncLocation);
    window.addEventListener('hashchange', syncLocation);
    return () => {
      window.removeEventListener('popstate', syncLocation);
      window.removeEventListener('hashchange', syncLocation);
    };
  }, []);

  if (publicPage || unknownPath) {
    const page = unknownPath ? 'not-found' : publicPage;
    return (
      <>
        <PwaControls surface="hidden" />
        <PublicPages page={page} metadata={PUBLIC_PAGE_METADATA[page]} />
      </>
    );
  }

  return (
    <>
      <PwaControls surface={pwaSurface} />
      <AuthGate onPwaSurfaceChange={setPwaSurface}>
        {({ account, onCloudSignOut, onCloudLogin, cloudConfigurationError }) => (
          <FocusMateApp
            account={account}
            onCloudSignOut={onCloudSignOut}
            onCloudLogin={onCloudLogin}
            cloudConfigurationError={cloudConfigurationError || supabaseConfigurationError}
            onPwaSurfaceChange={setPwaSurface}
          />
        )}
      </AuthGate>
    </>
  );
}

const container = document.getElementById('root');
const root = window.focusmateRoot || createRoot(container);
window.focusmateRoot = root;
root.render(<AppErrorBoundary><App /></AppErrorBoundary>);
