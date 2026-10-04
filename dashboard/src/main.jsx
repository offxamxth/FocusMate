import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, levelForXp } from './local-api.js';
import { achievementCatalog, achievementProgress } from './achievement-data.js';
import AuthGate from './AuthGate.jsx';
import { createVisionLandmarkers, detectMetrics } from './vision.js';
import { claimTimerCompletion, playSessionCompletionBeep } from './timer-completion.js';
import { supabase, updatePrivateProfile } from './lib/supabase.js';
import { dailyFocusSeconds, localDateKey, studyStreak, weekStudyDays } from './progress-data.js';
import { browserLanguage, supportedLanguages, textDirection, translate } from './i18n.js';
import ContactPage from './ContactPage.jsx';
import {
  Activity, ArrowUpRight, Award, BarChart3, BookOpen, Check, ChevronDown, CircleHelp,
  Clock3, Coffee, Droplets, Flame, Focus, Heart, Home, LockKeyhole, LogOut, Moon,
  Pause, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Sun, Timer, Trophy,
  UserRound, Video, VideoOff, X,
} from 'lucide-react';
import './style.css';

const pages = [
  { id: 'overview', label: 'Overview', group: 'Your space', icon: Home },
  { id: 'focus-room', label: 'Focus room', group: 'Your space', icon: Timer },
  { id: 'insights', label: 'My Progress', group: 'Your space', icon: BarChart3 },
  { id: 'session-results', label: 'Session results', group: 'Your space', icon: Sparkles },
  { id: 'achievements', label: 'Achievements', group: 'Build good habits', icon: Trophy },
  { id: 'quests', label: 'Daily quests', group: 'Build good habits', icon: Award },
  { id: 'session-preferences', label: 'Session preferences', group: 'Build good habits', icon: Settings2 },
  { id: 'profile', label: 'Profile & wellbeing', group: 'Build good habits', icon: UserRound },
  { id: 'contact', label: 'Contact Us', group: 'Build good habits', icon: CircleHelp },
];

const achievements = achievementCatalog;

function pageFromLocation() {
  if (window.location.pathname.replace(/\/+$/, '') === '/contact') return 'contact';
  return pages.find((item) => item.id === window.location.hash.slice(1))?.id || 'overview';
}

function saveProfile(username, profile) {
  return api(`/api/state?username=${encodeURIComponent(username)}`, {
    method: 'PUT', body: JSON.stringify({ profile }),
  });
}

function cameraStatusText(state, live) {
  if (state === 'unavailable') return 'Camera unavailable';
  if (state === 'permission-denied') return 'Camera permission denied';
  if (state === 'starting') return 'Camera starting';
  if (state === 'analysis-error') return 'Camera active · Analysis unavailable';
  if (state === 'analysis-unavailable') return 'Camera analysis unavailable';
  if (state !== 'active') return 'Camera off';
  if (!live.last_updated) return 'Camera active · Waiting for camera signals';
  if (!live.face_detected) return 'Camera active · Face not detected';
  if (live.pose_detection_status === 'temporarily-missing') return 'Camera active · Shoulders temporarily not detected';
  if (live.pose_detection_status === 'checking') return 'Camera active · Checking for shoulders';
  if (live.pose_detection_status === 'missing') return 'Camera active · Reframe to include shoulders';
  if (live.pose_detection_status === 'detected') {
    const detail = live.status && live.status !== 'No alert signals' ? ` · ${live.status}` : '';
    return `Camera active · Shoulders detected${detail}`;
  }
  return `Camera active · ${live.status || 'Analyzing camera signals'}`;
}

function postureStatusText(state, live) {
  if (state === 'starting') return 'Camera starting';
  if (state === 'permission-denied') return 'Unavailable · Camera permission denied';
  if (state === 'unavailable') return 'Unavailable · Camera not available';
  if (state === 'analysis-error') return 'Unavailable · Camera analysis error';
  if (state === 'analysis-unavailable') return 'Unavailable · Camera analysis could not start';
  if (state !== 'active' || !live.last_updated) return 'Waiting for camera signals';
  if (live.pose_detection_status === 'temporarily-missing') return 'Shoulders temporarily not detected';
  if (live.pose_detection_status === 'checking') return 'Checking for shoulders';
  if (live.pose_detection_status === 'missing') return 'Reframe to include shoulders';
  return live.pose_detected ? live.posture || 'Unknown' : 'Checking for shoulders';
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

function FocusMateApp({ account = null, onCloudSignOut = null, onCloudLogin = null }) {
  const [username, setUsername] = useState(account?.storageUsername || localStorage.getItem('focusmate-user') || '');
  const [profile, setProfile] = useState(null);
  const [live, setLive] = useState({});
  const [page, setPage] = useState(pageFromLocation);
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
  const language = profile?.session_preferences?.language && profile.session_preferences.language !== 'system'
    ? profile.session_preferences.language
    : browserLanguage();
  const videoRef = useRef(null);
  const miniVideoRef = useRef(null);
  const visionRef = useRef(null);
  const postureNoticeRef = useRef('');

  const presentProfile = (value) => account
    ? { ...value, username: account.username }
    : value;

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
  }, [language]);

  useEffect(() => {
    const syncPage = () => setPage(pageFromLocation());
    window.addEventListener('popstate', syncPage);
    window.addEventListener('hashchange', syncPage);
    return () => {
      window.removeEventListener('popstate', syncPage);
      window.removeEventListener('hashchange', syncPage);
    };
  }, []);

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
        const metrics = detectMetrics(detectors, video, performance.now());
        const data = await api(`/api/camera/telemetry?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify(metrics) });
        if (!stopped) {
          setLive(data.live);
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
        if (!detectors) {
          detectors = await createVisionLandmarkers();
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
      detectors?.face.close();
      detectors?.pose.close();
      if (visionRef.current === detectors) visionRef.current = null;
    };
  }, [stream, camera, username]);

  const updateProfile = async (change) => {
    setProfile((current) => current ? presentProfile({ ...current, ...change }) : current);
    try {
      await saveProfile(username, change);
      if (account && (Object.hasOwn(change, 'player_name') || Object.hasOwn(change, 'session_preferences'))) {
        await updatePrivateProfile(supabase, account.id, change);
      }
    } catch (error) {
      setNotice(account
        ? `Your local changes were saved, but the cloud profile could not be updated: ${error.message}`
        : error.message);
    }
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
    if (!live.posture_alert_pending || !profile?.session_preferences?.posture_alerts) return;
    if (postureNoticeRef.current === live.session_id) return;
    postureNoticeRef.current = live.session_id;
    inform('A gentle posture check-in: relax your shoulders or take a short stretch.');
  }, [live.posture_alert_pending, live.session_id, profile?.session_preferences?.posture_alerts]);

  const login = async (name, handle) => {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ name, username: handle }) });
    setUsername(data.profile.username);
    if (!account) localStorage.setItem('focusmate-user', data.profile.username);
    setProfile(data.profile);
    setLive(data.live);
    const destination = window.location.pathname.replace(/\/+$/, '') === '/contact' ? 'contact' : 'overview';
    setPage(destination);
    window.history.replaceState({}, '', destination === 'contact' ? '/contact' : '/#overview');
  };

  const logout = async () => {
    if (live.session_active) {
      try {
        const data = await api(`/api/webcam/stop?username=${encodeURIComponent(username)}`, { method: 'POST', body: '{}' });
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
    let nextStream;
    let detectors;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable');
      setCameraError('This browser does not provide webcam access. Use a supported browser on HTTPS or localhost.');
      return;
    }
    setCameraState('starting');
    setCameraError('');
    try {
      nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      detectors = await createVisionLandmarkers();
      const data = await api(`/api/webcam/start?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify(plan) });
      visionRef.current = detectors;
      setCameraState('active');
      setCamera(data); setLive(data.live); setStream(nextStream); inform(data.message);
    } catch (error) {
      detectors?.face.close();
      detectors?.pose.close();
      nextStream?.getTracks().forEach((track) => track.stop());
      const permissionDenied = !nextStream && ['NotAllowedError', 'SecurityError'].includes(error.name);
      setCameraState(permissionDenied ? 'permission-denied' : nextStream ? 'analysis-unavailable' : 'unavailable');
      setCameraError(error.message || 'The camera could not be started.');
      inform(error.message || 'Camera permission was denied.');
    }
  };

  const stopCamera = async () => {
    try {
      const data = await api(`/api/webcam/stop?username=${encodeURIComponent(username)}`, { method: 'POST', body: '{}' });
      setLive(data.live || {}); inform(data.message);
    } catch (error) { inform(error.message); }
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null); setCamera(null);
    setCameraState(navigator.mediaDevices?.getUserMedia ? 'off' : 'unavailable');
    setCameraError('');
  };

  if (loading) return <div className="boot-screen"><span className="brand-mark">f<span>✳</span></span><span>Opening your study space</span></div>;
  if (!profile) return <Welcome onLogin={login} onCloudLogin={onCloudLogin} notice={notice} />;

  const current = pages.find((item) => item.id === page) || pages[0];
  const xp = Number(profile.total_xp || 0);
  const level = levelForXp(xp);
  const focusActive = Boolean(live.session_active);
  const changePage = (id) => {
    setPage(id);
    window.history.replaceState({}, '', id === 'contact' ? '/contact' : `/#${id}`);
  };

  return (
    <div className={`app-shell ${collapsed ? 'nav-collapsed' : ''}`} data-study-style={profile.session_preferences?.study_style || 'normal'}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <a className="brand-lockup" href="#overview" aria-label="FocusMate home" onClick={() => changePage('overview')}>focus<span>mate</span><i>✳</i></a>
          <div className="sidebar-actions">
            <button className="icon-button theme-toggle" aria-label="Toggle theme" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="icon-button collapse-button" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={() => setCollapsed((value) => !value)}><ChevronDown size={17} /></button>
          </div>
        </div>
        <div className="user-block">
          <div className="avatar">{(profile.player_name || 'F').slice(0, 1).toUpperCase()}</div>
          <div className="user-copy"><span>WELCOME BACK</span><strong>{profile.player_name}</strong><small>@{profile.username}</small></div>
          <button className="icon-button mobile-logout" title="Switch profile" onClick={logout}><LogOut size={16} /></button>
        </div>
        <div className="level-block">
          <div className="level-copy"><span>LEVEL {level}</span><strong>{xp.toLocaleString()} <small>XP</small></strong></div>
          <div className="level-track"><span style={{ width: `${xp % 100}%` }} /></div>
          <small>{100 - (xp % 100)} XP to your next level</small>
        </div>
        {['Your space', 'Build good habits'].map((group) => (
          <nav className="nav-group" key={group} aria-label={group}>
            <span className="nav-label">{group}</span>
            {pages.filter((item) => item.group === group).map((item) => {
              const Icon = item.icon;
              return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => changePage(item.id)} title={item.label} aria-label={item.label} aria-current={page === item.id ? 'page' : undefined}><Icon size={18} /><span>{item.label}</span>{item.id === 'focus-room' && focusActive && <i className="live-dot" />}</button>;
            })}
          </nav>
        ))}
        <div className="sidebar-bottom">
          {stream && <div className="camera-mini"><video ref={miniVideoRef} autoPlay muted playsInline /><div><span className="live-dot" /> CAMERA ON</div></div>}
          <p>Progress, not perfection.<br />Take care of yourself.</p>
          <button className="switch-profile" onClick={logout}><LogOut size={15} /> Switch profile</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="mobile-header"><a className="brand-lockup" href="#overview" aria-label="FocusMate home" onClick={() => changePage('overview')}>focus<span>mate</span><i>✳</i></a><div className="mobile-header-actions"><button className="icon-button theme-toggle" aria-label="Toggle theme" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button><button className="icon-button" onClick={logout} aria-label="Switch profile"><LogOut size={18} /></button></div></header>
        <PageHeading page={current} profile={profile} />
        {notice && <div className="notice" role="status"><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}
        {page === 'overview' && <Overview profile={profile} live={live} language={language} onNavigate={changePage} onSave={updateProfile} />}
        <div hidden={page !== 'focus-room'} aria-hidden={page !== 'focus-room'}>
          <FocusRoom profile={profile} live={live} stream={stream} videoRef={videoRef} onStartCamera={startCamera} onStopCamera={stopCamera} onUpdateProfile={updateProfile} onNotice={inform} username={username} cameraState={cameraState} cameraError={cameraError} />
        </div>
        {page === 'insights' && <Insights profile={profile} />}
        {page === 'session-results' && <SessionResults live={live} profile={profile} username={username} onProfile={setProfile} onGoal={async (outcome) => { const data = await api(`/api/session/goal?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ outcome }) }); setLive(data.live); }} />}
        {page === 'achievements' && <Achievements profile={profile} />}
        {page === 'quests' && <Quests profile={profile} language={language} />}
        {page === 'session-preferences' && <Preferences profile={profile} onSave={updateProfile} />}
        {page === 'profile' && <Profile profile={profile} onSave={updateProfile} onExport={() => downloadProfile(profile)} cloudAccount={account} />}
        {page === 'contact' && <ContactPage username={account?.username || username} />}
        <footer className="page-footer">FocusMate <span>·</span> Progress, not perfection. Be kind to yourself.</footer>
      </main>
      <nav className="mobile-nav" aria-label="Primary navigation">{pages.map((item) => { const Icon = item.icon; return <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => changePage(item.id)} aria-label={item.label} aria-current={page === item.id ? 'page' : undefined} title={item.label}><Icon size={19} /><small>{item.label === 'My Progress' ? 'Progress' : item.label.replace(' room', '')}</small></button>; })}</nav>
    </div>
  );
}

function Welcome({ onLogin, onCloudLogin, notice }) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState(notice || '');
  const [usernameStatus, setUsernameStatus] = useState('idle');

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
      setError('Enter your name to create a new profile.');
      return;
    }
    try { await onLogin(usernameStatus === 'existing' ? '' : name, handle); } catch (exception) { setError(exception.message); }
  };
  const checking = usernameStatus === 'checking';
  const canSubmit = usernameStatus === 'existing' || (usernameStatus === 'available' && Boolean(name.trim()));
  return <main className="welcome-page"><div className="welcome-art"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="welcome-cross">✳</span><div className="welcome-wordmark">focus<span>mate</span><i>✳</i></div><p>A quieter place to do your best work.</p><div className="welcome-art-meta"><span>01 / TAKE A BREATH</span><span>YOUR STUDY SPACE</span></div></div><form className="welcome-form" onSubmit={submit}><div className="welcome-kicker">A FRESH START, AT YOUR PACE</div><h1>Make room for<br />your best work.</h1><p>Sign in with your username, or create a new local profile.</p><label>Username<input autoComplete="username" maxLength="33" value={handle} onChange={(event) => { setHandle(event.target.value); setError(''); }} placeholder="letters, numbers, . _ -" required /></label><div className="username-feedback" aria-live="polite">{checking ? 'Checking username…' : usernameStatus === 'existing' ? 'Welcome back. Your saved profile will be opened.' : usernameStatus === 'available' ? 'This username is available. Add your name to create a profile.' : usernameStatus === 'invalid' ? 'Use 1–32 letters, numbers, dots, dashes, or underscores.' : ''}</div>{usernameStatus === 'available' && <label>Your name<input autoComplete="name" maxLength="80" value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?" required /></label>}{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button" type="submit" disabled={!canSubmit}>{usernameStatus === 'existing' ? 'Sign in to your profile' : 'Create profile'} <ArrowUpRight size={17} /></button>{onCloudLogin && <button className="outline-button auth-local-link" type="button" onClick={onCloudLogin}>Sign in with email</button>}<small className="privacy-note"><LockKeyhole size={14} /> Your profile stays on this computer.</small></form></main>;
}

function PageHeading({ page, profile }) {
  const content = {
    overview: ['YOUR PERSONAL STUDY SPACE', `Make room for your best work, ${profile.player_name || 'friend'}.`, 'Small, steady sessions add up. Settle in, choose one thing to focus on, and remember breaks are part of the plan.'],
    'focus-room': ['FOCUS ROOM', 'Settle in. Start small.', 'A distraction-friendly space for one task, one timer, and a little breathing room.'],
    insights: ['MY PROGRESS', 'See how you’re building your rhythm.', 'Review recorded camera signals, study time, and completed sessions.'],
    'session-results': ['SESSION RESULTS', 'A reflection on your session.', 'A short review based only on the final statistics recorded by FocusMate.'],
    achievements: ['ACHIEVEMENTS', 'Small wins add up.', 'Earn badges for showing up, building routines, and reaching your own study milestones.'],
    quests: ['DAILY QUESTS', 'Build momentum with real study activity.', 'Four local-day challenges, saved with your profile. Session-only camera challenges are clearly identified.'],
    'session-preferences': ['SESSION PREFERENCES', 'Set your session up your way.', 'Choose how FocusMate monitors, reminds, and supports your study time.'],
    profile: ['YOUR SPACE', 'Make it yours.', 'Your name, wellbeing notes, and saved progress stay in your local FocusMate profile.'],
    contact: ['HELP & SUPPORT', 'Need help? We’re here.', 'Get help with technical problems, report bugs, or share feedback with the FocusMate team.'],
  }[page.id];
  if (page.id === 'overview') return null;
  return <header className="page-heading"><span className="eyebrow">{content[0]}</span><h1>{content[1]}</h1><p>{content[2]}</p></header>;
}

function Stat({ label, value, note, icon: Icon }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span>{Icon && <Icon size={17} />}</div><strong>{value}</strong><small>{note}</small></div>;
}

function Overview({ profile, live, language, onNavigate, onSave }) {
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
  const languageNames = {
    en: 'English', es: 'Español', fr: 'Français', ar: 'العربية', hi: 'हिन्दी',
  };
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
          <button className="primary-button" onClick={() => onNavigate('focus-room')}><Focus size={17} /> {translate(language, 'dashboard.startSession')}</button>
        </div>
      </section>

      <div className="overview-metrics">
        <section className="surface-panel overview-goal">
          <div className="section-heading"><div><span className="eyebrow">{translate(language, 'dashboard.goal')}</span><h3>{hourCount ? `${hourCount}h ` : ''}{minuteCount} / {goalMinutes} min</h3></div><span className="ring-meter" style={{ '--progress': `${goalPercent}%` }}><b>{Math.round(goalPercent)}%</b></span></div>
          <div className="progress-track" role="progressbar" aria-label={translate(language, 'dashboard.goal')} aria-valuemin="0" aria-valuemax={goalMinutes} aria-valuenow={Math.min(goalMinutes, Math.floor(todaySeconds / 60))}><span style={{ width: `${goalPercent}%` }} /></div>
          <label className="goal-select">{translate(language, 'dashboard.setGoal')}<select value={goalMinutes} onChange={(event) => updateGoal(event.target.value)} aria-label={translate(language, 'dashboard.setGoal')}>
            {[30, 60, 90, 120, ...( [30, 60, 90, 120].includes(goalMinutes) ? [] : [goalMinutes] )].sort((a, b) => a - b).map((minutes) => <option value={minutes} key={minutes}>{minutes} min</option>)}
          </select></label>
        </section>
        <Stat label={translate(language, 'dashboard.studyTime')} value={`${hourCount ? `${hourCount}h ` : ''}${minuteCount}m`} note={live.session_active ? 'Active camera session included' : 'Completed timer and camera study time'} icon={Clock3} />
        <Stat label={translate(language, 'dashboard.focusScore')} value={translate(language, 'dashboard.noScore')} note={translate(language, 'dashboard.noScoreHelp')} icon={Activity} />
        <Stat label={translate(language, 'dashboard.studyStreak')} value={`${streak} ${streak === 1 ? 'day' : 'days'}`} note={translate(language, 'dashboard.streakNote')} icon={Flame} />
        <section className="surface-panel overview-xp">
          <div className="section-heading"><div><span className="eyebrow">{translate(language, 'dashboard.xpLevel')}</span><h3>Level {level}</h3></div><strong>{xp.toLocaleString(language)} XP</strong></div>
          <div className="progress-track" role="progressbar" aria-label={`Level ${level} progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={levelProgress}><span style={{ width: `${levelProgress}%` }} /></div>
          <small>{levelProgress} / 100 XP · {100 - levelProgress} {translate(language, 'dashboard.toNextLevel')}</small>
        </section>
        <section className="surface-panel overview-achievements">
          <div className="section-heading"><div><span className="eyebrow">{translate(language, 'dashboard.achievements')}</span><h3>{achievementCount} / {achievementCatalog.length} {translate(language, 'dashboard.unlocked')}</h3></div><Trophy size={19} /></div>
          {nextAchievement ? <p>Next: {nextAchievement[1]}</p> : <p>{translate(language, 'quests.completedAll')}</p>}
          <button className="text-button" onClick={() => onNavigate('achievements')}>{translate(language, 'dashboard.viewAchievements')} <ArrowUpRight size={15} /></button>
        </section>
      </div>

      <section className="surface-panel streak-panel">
        <div className="section-heading"><div><span className="eyebrow">{translate(language, 'dashboard.week')}</span><h3><Flame size={17} /> {streak} day {translate(language, 'dashboard.studyStreak').toLowerCase()}</h3></div><small>{translate(language, 'dashboard.streakNote')}</small></div>
        <div className="week-calendar" aria-label={translate(language, 'dashboard.week')}>
          {week.map((day) => <div key={day.date} aria-label={`${day.date}: ${day.completed ? 'study completed' : 'no study recorded'}`} className={day.completed ? 'completed' : ''}><span>{day.label}</span><strong>{day.completed ? '✓' : '·'}</strong></div>)}
        </div>
      </section>

      <DailyQuests profile={profile} language={language} onViewAll={() => onNavigate('quests')} />
    </div>
  );
}

const questIcons = {
  focus_time: Focus,
  session_count: BookOpen,
  session_xp: Sparkles,
  camera_alerts: Activity,
};

function questCopy(quest, language) {
  const target = quest.target;
  if (quest.category === 'focus_time') return {
    title: translate(language, 'quests.focusTitle', { target }),
    description: translate(language, 'quests.focusDescription'),
    unit: 'min',
    max: target,
    current: Math.floor(Number(quest.progress || 0)),
  };
  if (quest.category === 'session_count') return {
    title: translate(language, 'quests.sessionsTitle', { target }),
    description: translate(language, 'quests.sessionsDescription'),
    unit: 'sessions',
    max: target,
    current: Math.floor(Number(quest.progress || 0)),
  };
  if (quest.category === 'session_xp') return {
    title: translate(language, 'quests.xpTitle', { target }),
    description: translate(language, 'quests.xpDescription'),
    unit: 'XP',
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

function DailyQuests({ profile, language, onViewAll }) {
  const daily = profile.daily_quests;
  if (!daily || !Array.isArray(daily.quests) || daily.quests.length !== 4) {
    return <section className="surface-panel daily-quests" role="alert"><h3>{translate(language, 'quests.title')}</h3><p>{translate(language, 'quests.unavailable')}</p></section>;
  }
  const completed = daily.quests.filter((quest) => quest.completed).length;
  return <section className="daily-quests">
    <div className="section-heading">
      <div><span className="eyebrow">{translate(language, 'quests.available')}</span><h3>{translate(language, 'quests.title')}</h3><p>{translate(language, 'quests.subtitle')}</p></div>
      {onViewAll && <button className="outline-button" onClick={onViewAll}>{translate(language, 'quests.viewAll')}</button>}
    </div>
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
          <div className="quest-card-footer"><span className="xp-pill">+{quest.rewardXP} XP</span><span className={`quest-state ${quest.completed ? 'complete' : ''}`}>{quest.completed ? <><Check size={15} /> {translate(language, 'quests.completed')}</> : translate(language, 'quests.inProgress')}</span></div>
          {quest.completed && <small className="quest-reward-note">+{quest.rewardXP} XP {translate(language, 'quests.earned')}</small>}
        </article>;
      })}
    </div>
    {completed === 4 && <div className="quest-all-complete" role="status"><strong>🎉 {translate(language, 'quests.completedAll')}</strong><span>{translate(language, 'quests.congratulations')}</span></div>}
  </section>;
}

function TimerPanel({ profile, username, onNotice }) {
  const defaultDuration = Number(profile.session_preferences?.session_length_minutes || 25);
  const durations = [...new Set([15, 25, 45, 60, 90, 120, defaultDuration])].sort((a, b) => a - b);
  const [duration, setDuration] = useState(defaultDuration);
  const [remaining, setRemaining] = useState(defaultDuration * 60);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const started = useRef(0);
  const creditedSeconds = useRef(0);
  const completionHandled = useRef(false);
  const chimeContext = useRef(null);
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
  useEffect(() => () => { chimeContext.current?.close(); }, []);
  useEffect(() => {
    if (!running) return undefined;
    const interval = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [running]);
  useEffect(() => {
    if (!running) {
      setDuration(defaultDuration);
      setRemaining(defaultDuration * 60);
    }
  }, [defaultDuration]);
  useEffect(() => {
    if (remaining !== 0 || !running) return;
    if (!claimTimerCompletion(completionHandled)) return;
    setCompleted(true);
    setRunning(false);
    void playSessionCompletionBeep(chimeContext.current);
    const secondsToCredit = Math.max(0, duration * 60 - creditedSeconds.current);
    creditedSeconds.current = 0;
    api(`/api/timer/credit?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ seconds: secondsToCredit }) })
      .then(() => onNotice('Your focus session is complete. Your study time has been saved.'))
      .catch((error) => onNotice(error.message));
  }, [remaining, running, duration, username, onNotice]);
  const chooseDuration = (value) => { if (!running) { completionHandled.current = false; setCompleted(false); creditedSeconds.current = 0; setDuration(value); setRemaining(value * 60); } };
  const start = () => {
    started.current = Date.now();
    completionHandled.current = false;
    setCompleted(false);
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
    setRunning(true);
  };
  const pause = async () => {
    const elapsed = Math.max(0, Math.round((Date.now() - started.current) / 1000));
    creditedSeconds.current += elapsed;
    setRunning(false);
    try { await api(`/api/timer/credit?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ seconds: elapsed }) }); }
    catch (error) { onNotice(error.message); }
  };
  const reset = () => { completionHandled.current = false; creditedSeconds.current = 0; setCompleted(false); setRunning(false); setRemaining(duration * 60); };
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  return <section className="timer-panel"><div className="timer-top"><span className="eyebrow">A CALM LITTLE POMODORO</span><label className="select-wrap"><select value={duration} disabled={running} onChange={(event) => chooseDuration(Number(event.target.value))}>{durations.map((item) => <option key={item} value={item}>{item} minutes</option>)}</select><ChevronDown size={15} /></label></div><div className={`timer-display ${running ? 'is-running' : ''}`} aria-label={`Timer ${minutes} minutes ${seconds} seconds`}>{minutes}<span>:</span>{seconds}</div><div className="progress-track timer-progress"><span style={{ width: `${100 - (remaining / (duration * 60)) * 100}%` }} /></div><p className="timer-caption">A steady pace is a good pace</p>{completed && <div className="timer-complete" role="status" aria-live="polite"><strong>🎉 Session complete!</strong><span>Your focus session has ended.</span></div>}<div className="timer-actions">{running ? <button className="primary-button" onClick={pause}><Pause size={17} /> Pause</button> : <button className="primary-button" disabled={remaining === 0} onClick={start}><Play size={17} />{remaining < duration * 60 ? 'Resume' : 'Start focus'}</button>}<button className="outline-button" onClick={reset}><RotateCcw size={16} /> Reset</button></div><small className="muted-note">This timer is a gentle guide; it does not control or record webcam sessions.</small></section>;
}

function FocusRoom({ profile, live, stream, videoRef, onStartCamera, onStopCamera, onUpdateProfile, onNotice, username, cameraState, cameraError }) {
  const [tasks, setTasks] = useState(profile.tasks || []);
  const [newTask, setNewTask] = useState('');
  const [subject, setSubject] = useState('Mathematics');
  const [goal, setGoal] = useState('');
  const [mood, setMood] = useState('');
  useEffect(() => setTasks(profile.tasks || []), [profile.tasks]);
  const addTask = (event) => { event.preventDefault(); if (!newTask.trim()) return; const next = [...tasks, { id: String(Date.now()), text: newTask.trim(), done: false }].slice(-100); setTasks(next); onUpdateProfile({ tasks: next }); setNewTask(''); };
  const toggleTask = (id) => { const next = tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task); setTasks(next); onUpdateProfile({ tasks: next }); };
  const removeTask = (id) => { const next = tasks.filter((task) => task.id !== id); setTasks(next); onUpdateProfile({ tasks: next }); };
  const moodNeeded = profile.session_preferences?.mood_checkins !== false && profile.session_wellbeing?.mood_checkin_date !== new Date().toISOString().slice(0, 10);
  return <div className="page-content">
    <div className="focus-grid"><TimerPanel profile={profile} username={username} onNotice={onNotice} />
      <section className="session-panel surface-panel"><div className="panel-topline"><span className="eyebrow">OPTIONAL CAMERA SESSION</span><span className={`connection-label ${live.session_active ? 'connected' : ''}`}><span className="live-dot" />{live.session_active ? 'Live' : 'Camera off'}</span></div><h3>Study buddy</h3><p className="panel-copy">Turn on webcam tracking only if it feels useful. You can use the focus timer and task list without enabling the camera.</p>
        {stream ? <div className="camera-preview"><video ref={videoRef} autoPlay muted playsInline /><div className="camera-overlay"><span className="live-dot" /> CAMERA ACTIVE</div><button className="camera-stop" onClick={onStopCamera}><VideoOff size={16} /> Stop camera</button></div> : <div className="camera-placeholder"><Video size={25} /><span>Camera preview appears here</span><small>Frames are processed locally and are not saved.</small></div>}
        {!stream && <><div className="form-grid"><label>What are you working on?<select value={subject} onChange={(event) => setSubject(event.target.value)}>{['Mathematics', 'Science', 'Coding', 'Assignment', 'Other'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Session goal<input maxLength="200" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="e.g. Complete Chapter 4 exercises" /></label>{moodNeeded && <label>How are you feeling?<select value={mood} onChange={(event) => setMood(event.target.value)}><option value="">Choose a mood</option>{['Calm', 'Focused', 'Okay', 'Tired', 'Stressed'].map((item) => <option key={item}>{item}</option>)}</select></label>}</div><button className="primary-button full-button" disabled={!goal.trim() || (moodNeeded && !mood) || cameraState === 'starting' || cameraState === 'unavailable'} onClick={() => onStartCamera({ subject, goal, mood })}><Video size={17} /> {cameraState === 'starting' ? 'Starting camera…' : 'Start camera'}</button></>}
        {stream && <div className="camera-signals"><div><small>CAMERA STATUS</small><strong>{cameraStatusText(cameraState, live)}</strong></div><div><small>POSTURE</small><strong>{postureStatusText(cameraState, live)}</strong></div><div><small>HEAD TURN PROXY</small><strong>{!live.face_detected ? 'Waiting for face' : live.looking_away ? 'Turn detected' : 'No turn detected'}</strong></div><div><small>FACE</small><strong>{live.face_detected ? 'Detected' : 'Not detected'}</strong></div><p>These are visible camera signals, not a score or a measure of concentration or mental state. Head turn is only a rough proxy for looking away. Video frames stay on this device.</p></div>}
        {!stream && cameraState !== 'off' && <div className="camera-signals"><div><small>CAMERA STATUS</small><strong>{cameraStatusText(cameraState, live)}</strong></div>{cameraError && <p role="status">{cameraError}</p>}</div>}
      </section>
    </div>
    <section className="task-section"><div className="task-heading"><div><span className="eyebrow">KEEP IT LIGHT</span><h3>Your small-step list</h3><p>A few clear next steps are plenty.</p></div><span className="task-count">{tasks.filter((task) => task.done).length}/{tasks.length} done</span></div><form className="task-form" onSubmit={addTask}><input maxLength="120" value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="Add one small next step…" /><button className="outline-button" type="submit"><Plus size={16} /> Add task</button></form><div className="task-list">{tasks.length ? tasks.map((task) => <div className={`task-row ${task.done ? 'done' : ''}`} key={task.id}><button className="check-button" onClick={() => toggleTask(task.id)} aria-label={task.done ? 'Mark task incomplete' : 'Complete task'}>{task.done && <Check size={14} />}</button><span>{task.text}</span><button className="icon-button task-remove" onClick={() => removeTask(task.id)} aria-label="Remove task"><X size={15} /></button></div>) : <div className="empty-state">Your list is clear. Add one small next step when you’re ready.</div>}</div></section>
  </div>;
}

function Insights({ profile }) {
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
    return date.toLocaleTimeString(undefined, options);
  };
  const timerHistory = Array.isArray(profile.focus_timer_history) ? profile.focus_timer_history : [];
  const sessions = Number(profile.sessions_completed || 0);
  const seconds = Number(profile.total_study_seconds || 0) + Number(profile.focus_timer_total_seconds || 0);
  const alertsFor = (item) => ({
    posture: Math.max(0, Number(item.posture_alerts) || 0),
    distance: Math.max(0, Number(item.distance_alerts) || 0),
    lookingAway: Math.max(0, Number(item.looking_away_alerts) || 0),
    fatigue: Math.max(0, Number(item.fatigue_signals) || 0),
  });
  const totalAlerts = rows.reduce((total, item) => total + Object.values(alertsFor(item)).reduce((sum, count) => sum + count, 0), 0);
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
  const exportCsv = () => { const columns = ['Date', 'Subject', 'Goal', 'Task', 'Study time', 'Recorded camera alerts', 'XP earned']; const lines = [columns, ...rows.map((item) => [item.date, item.subject || '', item.goal || '', item.task_text || '', `${Math.floor(Number(item.seconds || 0) / 60)} min`, Object.values(alertsFor(item)).reduce((sum, count) => sum + count, 0), item.xp || 0])].map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(',')); downloadText('focusmate-session-history.csv', lines.join('\n'), 'text/csv'); };
  return (
    <div className="page-content">
      <div className="stats-grid insights-stats">
        <Stat label="Completed sessions" value={sessions} note={`${rows.length} with optional camera data`} icon={BookOpen} />
        <Stat label="Study time this week" value={`${thisWeekMinutes} min`} note="Recorded local-calendar days" icon={Clock3} />
        <Stat label="Study-day streak" value={`${studyStreak(profile)} days`} note="Only saved study activity counts" icon={Flame} />
        <Stat label="Average camera session" value={rows.length ? `${averageCameraMinutes} min` : 'Not enough data'} note="Based on completed camera sessions" icon={Activity} />
      </div>
      <div className="content-columns chart-columns">
        <section className="surface-panel chart-panel">
          <div className="section-heading"><div><span className="eyebrow">LOCAL CALENDAR WEEK</span><h3>Focus time</h3></div><span className="chart-legend mint"><i /> Study minutes</span></div>
          {thisWeekMinutes ? <div className="week-chart">{week.map((day) => <div className="week-column" key={day.date}><span>{day.value || ''}</span><i style={{ height: `${Math.max(3, day.value / maxWeek * 100)}%` }} /><small>{day.label}</small></div>)}</div> : <div className="empty-state">Not enough data yet. Complete a focus session to start your weekly chart.</div>}
          <p className="muted-note">{thisWeekMinutes} minutes this week · saved timer and camera-session time</p>
        </section>
        <section className="surface-panel analytics-detail">
          <span className="eyebrow">RECORDED CAMERA SIGNALS</span><h3>Session alerts</h3>
          {rows.length ? <dl className="analytics-list"><div><dt>Posture alerts</dt><dd>{alertTotals.posture}</dd></div><div><dt>Looking-away signals</dt><dd>{alertTotals.lookingAway}</dd></div><div><dt>Distance alerts</dt><dd>{alertTotals.distance}</dd></div><div><dt>Fatigue-related signals</dt><dd>{alertTotals.fatigue}</dd></div></dl> : <div className="empty-state">Camera alert analytics appear after a completed optional camera session.</div>}
          <p className="muted-note">These are heuristic visual signals, not a measure of concentration or mental state.</p>
        </section>
      </div>
      <section className="surface-panel personal-insights">
        <span className="eyebrow">PERSONAL INSIGHTS</span><h3>What your saved activity shows</h3>
        {!seconds ? <div className="empty-state">Not enough data yet. Complete a few sessions to unlock insights.</div> : <div className="insight-list">
          {bestDay && <p><strong>Your best study day</strong><span>{new Date(`${bestDay.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })} had the most recorded study time this week ({bestDay.value} min).</span></p>}
          {priorWeekMinutes > 0 && thisWeekMinutes !== Math.round(priorWeekMinutes) && <p><strong>{thisWeekMinutes > priorWeekMinutes ? 'Study time is up' : 'A gentler week'}</strong><span>{Math.abs(Math.round((thisWeekMinutes - priorWeekMinutes) / priorWeekMinutes * 100))}% {thisWeekMinutes > priorWeekMinutes ? 'more' : 'less'} saved study time than last week.</span></p>}
          {strongestPeriod && <p><strong>Your longest sessions are often in the {strongestPeriod.name}</strong><span>Based on average duration across {timedSessions.length} completed camera sessions.</span></p>}
          {rows.length > 0 && !strongestPeriod && <p><strong>Keep studying</strong><span>Complete a few more camera sessions to compare session duration by time of day.</span></p>}
          <p><strong>Focus score trend</strong><span>Not available: FocusMate does not record a validated focus score.</span></p>
          {totalAlerts > 0 && <p><strong>Camera signal summary</strong><span>{totalAlerts} visual-signal alerts are recorded across your camera sessions.</span></p>}
        </div>}
      </section>
      <section className="history-section">
        <div className="section-heading"><div><span className="eyebrow">YOUR HISTORY</span><h3>Saved sessions</h3></div><button className="outline-button" onClick={exportCsv}><ArrowUpRight size={15} /> Download CSV</button></div>
        {rows.length ? <div className="table-wrap"><table><thead><tr><th>Date &amp; time</th><th>Subject</th><th>Goal</th><th>Study time</th><th>Camera alerts</th><th>XP earned</th></tr></thead><tbody>{rows.slice(0, 50).map((item, index) => <tr key={`${item.date}-${index}`}><td>{new Date(`${String(item.date).slice(0, 10)}T12:00:00`).toLocaleDateString()}{sessionStartTime(item.session_started_at) && <small>{sessionStartTime(item.session_started_at)}</small>}</td><td>{item.subject || '—'}</td><td>{item.goal || item.task_text || '—'}</td><td>{Math.floor(Number(item.seconds || 0) / 60)} min</td><td>{Object.values(alertsFor(item)).reduce((sum, count) => sum + count, 0)}</td><td>{item.xp || 0}</td></tr>)}</tbody></table></div> : <div className="empty-state">No focus sessions yet. Complete your first optional camera session to see session history.</div>}
      </section>
    </div>
  );
}

function SessionResults({ live, profile, username, onProfile, onGoal }) {
  const [outcome, setOutcome] = useState(live.goal_outcome || '');
  const completed = live.session_completed;
  const totalAlerts = Number(live.posture_alerts || 0) + Number(live.distance_alerts || 0) + Number(live.looking_away_alerts || 0) + Number(live.fatigue_signals || 0);
  const reflection = (profile.session_reflections || []).find((item) => item.session_id === live.session_id);
  useEffect(() => {
    if (!completed || !reflection) return;
    api(`/api/session/reflection?username=${encodeURIComponent(username)}`, { method: 'POST', body: '{}' })
      .then((data) => onProfile(data.profile))
      .catch(() => {});
  }, [completed, reflection?.session_id, username, onProfile]);
  const saveOutcome = async (value) => { setOutcome(value); try { await onGoal(value); } catch { setOutcome(''); } };
  return (
    <div className="page-content">
      {!completed ? <div className="surface-panel reflection-empty"><span className="reflection-icon"><Sparkles size={22} /></span><h3>Your reflection is waiting.</h3><p>Finish a camera session to review the visible signals recorded by FocusMate. Video frames are analyzed in your browser and are not saved.</p></div> : <>
        <div className="reflection-banner"><span className="reflection-icon"><Sparkles size={22} /></span><div><span className="eyebrow">SESSION REFLECTION</span><h2>A little more insight, a little more room.</h2><p>{reflection?.summary || `FocusMate recorded ${totalAlerts} visible-signal alerts. This is not a measure of concentration or mental state.`}</p></div><span className="local-badge"><ShieldCheck size={14} /> Local summary</span></div>
        <div className="stats-grid result-stats"><Stat label="Session duration" value={`${Math.round(Number(live.session_seconds || 0) / 60)} min`} note="Time with your study buddy" icon={Clock3} /><Stat label="Recorded camera alerts" value={totalAlerts} note="Counts for visible camera signals" icon={Activity} /><Stat label="Posture signal" value={live.pose_detected ? live.posture || 'Unknown' : 'Not available'} note={live.pose_detected ? 'From visible ear and shoulder landmarks' : live.pose_detection_status === 'missing' ? 'Shoulders were not reliably detected during the session' : 'Shoulder detection was unavailable for this session'} icon={UserRound} /></div>
        <div className="content-columns"><section className="surface-panel reflection-list"><span className="eyebrow">WHAT WENT WELL</span><h3>Give yourself credit.</h3>{(reflection?.what_went_well || [`You completed ${Math.round(Number(live.session_seconds || 0) / 60)} minutes of study time.`, 'Camera signals describe visible landmarks only.']).map((item) => <p key={item}>{item}</p>)}</section><section className="surface-panel reflection-list"><span className="eyebrow">TRY NEXT TIME</span><h3>One small idea.</h3>{(reflection?.try_next || ['Choose a clear, achievable goal before you begin, then make room for a brief break afterward.']).map((item) => <p key={item}>{item}</p>)}</section></div>
        {live.study_goal && <section className="goal-checkin surface-panel"><span className="eyebrow">YOUR SESSION GOAL</span><h3>{live.study_goal}</h3><label>How did it go?<select value={outcome} onChange={(event) => saveOutcome(event.target.value)}><option value="">Choose one</option><option>Yes</option><option>Partially</option><option>Not yet</option></select></label>{outcome && <small className="saved-note"><Check size={14} /> Goal check-in saved: {outcome}</small>}</section>}
      </>}
    </div>
  );
}

function Achievements({ profile }) {
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
        <div><span className="eyebrow">YOUR COLLECTION</span><h3>{count} of {achievements.length} unlocked</h3></div>
        <div className="progress-track" role="progressbar" aria-label="Achievements unlocked" aria-valuemin="0" aria-valuemax={achievements.length} aria-valuenow={count}>
          <span style={{ width: `${count / achievements.length * 100}%` }} />
        </div>
      </section>
      {groups.map((group) => {
        const entries = achievements.filter((item) => item[4] === group);
        return (
          <section className="achievement-group" key={group}>
            <div className="section-heading">
              <div><span className="eyebrow">{String(group).toUpperCase()}</span><h3>{group}</h3></div>
              <span className="group-count">{entries.filter((item) => earned.has(item[0])).length} / {entries.length}</span>
            </div>
            <div className="achievement-grid">
              {entries.map(([id, title, description, reward]) => {
                const record = earnedRecords.get(id);
                const progress = record ? null : achievementProgress(profile, id);
                const earnedAt = record?.earned_at && new Date(record.earned_at);
                const earnedDate = earnedAt && Number.isFinite(earnedAt.getTime())
                  ? earnedAt.toLocaleDateString()
                  : '';
                return (
                  <article className={`achievement-card ${record || earned.has(id) ? 'earned' : ''}`} key={id}>
                    <div className="achievement-symbol">{earned.has(id) ? <Trophy size={18} /> : <LockKeyhole size={17} />}</div>
                    <div>
                      <h4>{title}</h4>
                      <p>{description}</p>
                      {earned.has(id)
                        ? <small>{earnedDate ? `Unlocked ${earnedDate}` : 'Unlocked'} · +{reward} XP</small>
                        : <>
                          <small>Reward · +{reward} XP</small>
                          {progress && (
                            <div className="achievement-progress-detail">
                              <span>{progress.current} / {progress.target} {progress.unit}</span>
                              <div className="progress-track" role="progressbar" aria-label={`${title} progress`} aria-valuemin="0" aria-valuemax={progress.target} aria-valuenow={progress.current}>
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

function Quests({ profile, language }) {
  return <div className="page-content"><DailyQuests profile={profile} language={language} /><p className="muted-note">Progress is derived from saved timer activity and completed camera sessions. Camera alert challenges require recorded camera data; no self-report or unsupported focus score is used.</p></div>;
}

function Preferences({ profile, onSave }) {
  const defaults = {
    focus_monitoring: true,
    posture_alerts: true,
    mood_checkins: true,
    session_chimes: false,
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
  const set = (key, value) => setPreferences((current) => ({ ...current, [key]: value }));
  const save = async () => { await onSave({ session_preferences: preferences }); setSaved(true); window.setTimeout(() => setSaved(false), 2000); };
  const rows = [['focus_monitoring', 'Focus monitoring', 'Enable optional in-browser face, eye, posture, and distance estimates'], ['posture_alerts', 'Posture alerts', 'Show one gentle reminder after two minutes of slouching'], ['mood_checkins', 'Mood check-ins', 'Ask how I feel before my first camera session each day'], ['session_chimes', 'Session chimes', 'Play a soft tone when the focus timer starts and completes']];
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
          <span className="eyebrow">PERSONALIZE YOUR SPACE</span>
          <h3>Support that feels right.</h3>
          <p>These choices stay with your local profile and can be changed at any time.</p>
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
        {rows.map(([key, title, description]) => (
          <label className="setting-row" key={key}>
            <span><strong>{title}</strong><small>{description}</small></span>
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
        <button className="primary-button" onClick={save}><Check size={16} /> {saved ? 'Saved' : 'Save preferences'}</button>
      </section>
      <section className="surface-panel profile-summary">
        <span className="eyebrow">YOUR PROFILE</span>
        <div className="summary-person">
          <div className="avatar">{(profile.player_name || 'F')[0].toUpperCase()}</div>
          <div><strong>{profile.player_name}</strong><small>@{profile.username}</small></div>
        </div>
        <dl>
          <div><dt>Rank</dt><dd>Level {levelForXp(profile.total_xp)}</dd></div>
          <div><dt>Study style</dt><dd>{preferences.study_style}</dd></div>
          <div><dt>Session length</dt><dd>{preferences.session_length_minutes} minutes</dd></div>
          <div><dt>Daily goal</dt><dd>{Math.floor(preferences.daily_goal_minutes / 60)}h {String(preferences.daily_goal_minutes % 60).padStart(2, '0')}m</dd></div>
        </dl>
      </section>
    </div>
  );
}

function Profile({ profile, onSave, onExport, cloudAccount }) {
  const [name, setName] = useState(profile.player_name || '');
  const [sleep, setSleep] = useState(profile.session_wellbeing?.sleep_hours || 0);
  const [water, setWater] = useState(profile.water_glasses_today || 0);
  const [reflection, setReflection] = useState(profile.session_wellbeing?.reflection || '');
  const [saved, setSaved] = useState(false);
  const save = async (event) => { event.preventDefault(); const wellbeing = { ...profile.session_wellbeing, sleep_hours: Number(sleep), water_glasses: Number(water), reflection: reflection.slice(0, 500) }; await onSave({ player_name: name, water_glasses_today: Number(water), session_wellbeing: wellbeing }); setSaved(true); window.setTimeout(() => setSaved(false), 2000); };
  return <div className="page-content settings-layout"><form className="surface-panel profile-form" onSubmit={save}><span className="eyebrow">A LITTLE ABOUT YOU</span><h3>Your profile, at your pace.</h3>{cloudAccount && <div className="cloud-profile-note">Signed in with {cloudAccount.email}. Your account and profile preferences use Supabase; study sessions, quests, XP, achievements, and wellbeing notes remain in this browser and are not yet synchronized.</div>}<label>What should we call you?<input maxLength="80" value={name} onChange={(event) => setName(event.target.value)} /></label><div className="form-grid"><label>Sleep last night (hours)<input type="number" min="0" max="24" step="0.5" value={sleep} onChange={(event) => setSleep(event.target.value)} /></label><label>Water glasses today<input type="number" min="0" max="100" value={water} onChange={(event) => setWater(event.target.value)} /></label></div><label>A note to yourself<textarea maxLength="500" rows="4" value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="What would help you feel supported today?" /></label><button className="primary-button" type="submit"><Check size={16} /> {saved ? 'Saved' : 'Save check-in'}</button></form><section className="surface-panel data-panel"><span className="eyebrow">YOUR DATA, YOUR CHOICE</span><h3>Local by default.</h3><p>Your profile and completed-session history are stored in this browser's localStorage. They do not sync between browsers or devices, and clearing this site's data can remove them. localhost and your Vercel site have separate profiles. Camera frames are analyzed in this browser and are not saved or sent to FocusMate. Completed camera sessions store duration and counts of posture, distance, head-turn, and eye-closure signals in your local profile. The app downloads MediaPipe code from jsDelivr; support forms are sent separately to Web3Forms.</p><button className="outline-button full-button" onClick={onExport}><ArrowUpRight size={15} /> Export profile as JSON</button><div className="privacy-card"><LockKeyhole size={17} /><span>{cloudAccount ? 'Your email password is managed by Supabase Auth. Your local username is not a password.' : 'Your username selects local data; it is not a password or secure authentication.'}</span></div></section></div>;
}

function downloadText(filename, contents, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([contents], { type })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function downloadProfile(profile) { downloadText('focusmate-profile.json', JSON.stringify(profile, null, 2), 'application/json'); }

function App() {
  return (
    <AuthGate>
      {({ account, onCloudSignOut, onCloudLogin }) => (
        <FocusMateApp
          account={account}
          onCloudSignOut={onCloudSignOut}
          onCloudLogin={onCloudLogin}
        />
      )}
    </AuthGate>
  );
}

const container = document.getElementById('root');
const root = window.focusmateRoot || createRoot(container);
window.focusmateRoot = root;
root.render(<AppErrorBoundary><App /></AppErrorBoundary>);