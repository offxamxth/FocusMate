import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, levelForXp } from './local-api.js';
import { achievementCatalog } from './achievement-data.js';
import { createVisionLandmarkers, detectMetrics } from './vision.js';
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

const quests = [
  { id: 'focus_sprint', title: 'The deep-work sprint', description: 'Spend 15 minutes with one task and no distractions.', reward: 30, icon: '◎' },
  { id: 'recharge', title: 'The recharge break', description: 'Step away, stretch, or rest your eyes for a moment.', reward: 15, icon: '↗' },
  { id: 'hydration', title: 'A little hydration', description: 'Have a glass of water before your next study block.', reward: 10, icon: '◌' },
  { id: 'reflection', title: 'A small reflection', description: 'Write one thing that went well today.', reward: 10, icon: '✳' },
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

function App() {
  const [username, setUsername] = useState(localStorage.getItem('focusmate-user') || '');
  const [profile, setProfile] = useState(null);
  const [live, setLive] = useState({});
  const [page, setPage] = useState(pageFromLocation);
  const [loading, setLoading] = useState(Boolean(username));
  const [notice, setNotice] = useState('');
  const [camera, setCamera] = useState(null);
  const [cameraState, setCameraState] = useState(
    () => navigator.mediaDevices?.getUserMedia ? 'off' : 'unavailable',
  );
  const [cameraError, setCameraError] = useState('');
  const [stream, setStream] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('focusmate-theme') || 'dark');
  const videoRef = useRef(null);
  const miniVideoRef = useRef(null);
  const visionRef = useRef(null);
  const postureNoticeRef = useRef('');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('focusmate-theme', theme);
  }, [theme]);

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
        if (current) { setProfile(data.profile); setLive(data.live); }
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
        .then((data) => { if (current) { setLive(data.live); setProfile(data.profile); } })
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
    setProfile((current) => current ? { ...current, ...change } : current);
    try {
      await saveProfile(username, change);
    } catch (error) { setNotice(error.message); }
  };

  const inform = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3600);
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
    localStorage.setItem('focusmate-user', data.profile.username);
    setProfile(data.profile);
    setLive(data.live);
    const destination = window.location.pathname.replace(/\/+$/, '') === '/contact' ? 'contact' : 'overview';
    setPage(destination);
    window.history.replaceState({}, '', destination === 'contact' ? '/contact' : '/#overview');
  };

  const logout = () => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
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
  if (!profile) return <Welcome onLogin={login} notice={notice} />;

  const current = pages.find((item) => item.id === page) || pages[0];
  const xp = Number(profile.total_xp || 0);
  const level = levelForXp(xp);
  const focusActive = Boolean(live.session_active);
  const changePage = (id) => {
    setPage(id);
    window.history.replaceState({}, '', id === 'contact' ? '/contact' : `/#${id}`);
  };

  return (
    <div className={`app-shell ${collapsed ? 'nav-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <a className="brand-lockup" href="#overview" aria-label="FocusMate home" onClick={() => changePage('overview')}>focus<span>mate</span><i>✳</i></a>
          <div className="sidebar-actions">
            <button className="icon-button theme-toggle" aria-label="Toggle theme" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>
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
        <header className="mobile-header"><a className="brand-lockup" href="#overview" aria-label="FocusMate home" onClick={() => changePage('overview')}>focus<span>mate</span><i>✳</i></a><div className="mobile-header-actions"><button className="icon-button theme-toggle" aria-label="Toggle theme" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button><button className="icon-button" onClick={logout} aria-label="Switch profile"><LogOut size={18} /></button></div></header>
        <PageHeading page={current} profile={profile} />
        {notice && <div className="notice" role="status"><span>{notice}</span><button className="icon-button" onClick={() => setNotice('')} aria-label="Dismiss"><X size={16} /></button></div>}
        {page === 'overview' && <Overview profile={profile} live={live} onNavigate={changePage} onWater={() => updateProfile({ water_glasses_today: Number(profile.water_glasses_today || 0) + 1 })} />}
        <div hidden={page !== 'focus-room'} aria-hidden={page !== 'focus-room'}>
          <FocusRoom profile={profile} live={live} stream={stream} videoRef={videoRef} onStartCamera={startCamera} onStopCamera={stopCamera} onUpdateProfile={updateProfile} onNotice={inform} username={username} cameraState={cameraState} cameraError={cameraError} />
        </div>
        {page === 'insights' && <Insights profile={profile} />}
        {page === 'session-results' && <SessionResults live={live} profile={profile} username={username} onProfile={setProfile} onGoal={async (outcome) => { const data = await api(`/api/session/goal?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ outcome }) }); setLive(data.live); }} />}
        {page === 'achievements' && <Achievements profile={profile} />}
        {page === 'quests' && <Quests profile={profile} onClaim={async (id) => { const data = await api(`/api/quests/claim?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ quest_id: id }) }); setProfile(data.profile); }} />}
        {page === 'session-preferences' && <Preferences profile={profile} onSave={updateProfile} />}
        {page === 'profile' && <Profile profile={profile} onSave={updateProfile} onExport={() => downloadProfile(profile)} />}
        {page === 'contact' && <ContactPage username={username} />}
        <footer className="page-footer">FocusMate <span>·</span> Progress, not perfection. Be kind to yourself.</footer>
      </main>
      <nav className="mobile-nav" aria-label="Primary navigation">{pages.map((item) => { const Icon = item.icon; return <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => changePage(item.id)} aria-label={item.label} aria-current={page === item.id ? 'page' : undefined} title={item.label}><Icon size={19} /><small>{item.label === 'My Progress' ? 'Progress' : item.label.replace(' room', '')}</small></button>; })}</nav>
    </div>
  );
}

function Welcome({ onLogin, notice }) {
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
  return <main className="welcome-page"><div className="welcome-art"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="welcome-cross">✳</span><div className="welcome-wordmark">focus<span>mate</span><i>✳</i></div><p>A quieter place to do your best work.</p><div className="welcome-art-meta"><span>01 / TAKE A BREATH</span><span>YOUR STUDY SPACE</span></div></div><form className="welcome-form" onSubmit={submit}><div className="welcome-kicker">A FRESH START, AT YOUR PACE</div><h1>Make room for<br />your best work.</h1><p>Sign in with your username, or create a new local profile.</p><label>Username<input autoComplete="username" maxLength="33" value={handle} onChange={(event) => { setHandle(event.target.value); setError(''); }} placeholder="letters, numbers, . _ -" required /></label><div className="username-feedback" aria-live="polite">{checking ? 'Checking username…' : usernameStatus === 'existing' ? 'Welcome back. Your saved profile will be opened.' : usernameStatus === 'available' ? 'This username is available. Add your name to create a profile.' : usernameStatus === 'invalid' ? 'Use 1–32 letters, numbers, dots, dashes, or underscores.' : ''}</div>{usernameStatus === 'available' && <label>Your name<input autoComplete="name" maxLength="80" value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we call you?" required /></label>}{error && <div className="form-error" role="alert">{error}</div>}<button className="primary-button" type="submit" disabled={!canSubmit}>{usernameStatus === 'existing' ? 'Sign in to your profile' : 'Create profile'} <ArrowUpRight size={17} /></button><small className="privacy-note"><LockKeyhole size={14} /> Your profile stays on this computer.</small></form></main>;
}

function PageHeading({ page, profile }) {
  const content = {
    overview: ['YOUR PERSONAL STUDY SPACE', `Make room for your best work, ${profile.player_name || 'friend'}.`, 'Small, steady sessions add up. Settle in, choose one thing to focus on, and remember breaks are part of the plan.'],
    'focus-room': ['FOCUS ROOM', 'Settle in. Start small.', 'A distraction-friendly space for one task, one timer, and a little breathing room.'],
    insights: ['MY PROGRESS', 'See how you’re building your rhythm.', 'Review recorded camera signals, study time, and completed sessions.'],
    'session-results': ['SESSION RESULTS', 'A reflection on your session.', 'A short review based only on the final statistics recorded by FocusMate.'],
    achievements: ['ACHIEVEMENTS', 'Small wins add up.', 'Earn badges for showing up, building routines, and reaching your own study milestones.'],
    quests: ['DAILY QUESTS', 'Tiny wins count.', 'Optional, kind-to-yourself challenges. Claim a quest once per day for a little bonus XP.'],
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

function Overview({ profile, live, onNavigate, onWater }) {
  const xp = Number(profile.total_xp || 0);
  const level = levelForXp(xp);
  const todayTotal = Number(profile.focus_timer_seconds_today || 0) + Number(live.session_seconds || 0);
  const target = Number(profile.session_preferences?.daily_goal_minutes || 180) * 60;
  const nextGoal = profile.session_preferences?.daily_goal_minutes || 180;
  const quickActions = [
    { label: 'Focus sprint', detail: 'Start a 25-minute block', onClick: () => onNavigate('focus-room') },
    { label: 'Hydration', detail: 'Log a glass of water', onClick: onWater },
    { label: 'Progress', detail: 'Review your session trend', onClick: () => onNavigate('insights') },
  ];

  return (
    <div className="page-content">
      <section className="overview-intro">
        <div>
          <span className="eyebrow">A GENTLER KIND OF PRODUCTIVITY</span>
          <h2>One thing at a time.</h2>
          <p>Your next small step is enough. Choose a task, settle into a focus block, and let progress take care of itself.</p>
          <div className="feature-pills">
            <span>Low-pressure plans</span>
            <span>Gentle momentum</span>
            <span>Local-first</span>
          </div>
          <button className="primary-button" onClick={() => onNavigate('focus-room')}><Focus size={17} /> Start a focus session</button>
        </div>
        <div className="intro-meta">
          <div className="pulse-card">
            <span>LEVEL {level}</span>
            <strong>{xp.toLocaleString()}</strong>
            <small>XP earned</small>
          </div>
          <div className="intro-stamp"><span>✳</span><small>YOU’RE RIGHT<br />WHERE YOU NEED<br />TO BE</small></div>
        </div>
      </section>

      <div className="stats-grid">
        <Stat label="Study streak" value={`${profile.sessions_completed ? Math.max(1, Math.min(30, Number(profile.sessions_completed)) % 8 + 1) : 0} days`} note="Keep showing up for yourself" icon={Flame} />
        <Stat label="Study sessions" value={Number(profile.sessions_completed || 0)} note="Every session counts" icon={BookOpen} />
        <Stat label="Focus time today" value={`${Math.floor(todayTotal / 3600)}h ${Math.floor((todayTotal % 3600) / 60)}m`} note={`Daily intention · ${nextGoal} minutes`} icon={Clock3} />
      </div>

      <div className="quick-actions-grid">
        {quickActions.map((action) => (
          <button key={action.label} className="quick-card" onClick={action.onClick}>
            <span>{action.label}</span>
            <small>{action.detail}</small>
          </button>
        ))}
      </div>

      <div className="content-columns">
        <section className="surface-panel daily-panel">
          <div className="section-heading">
            <div><span className="eyebrow">A LITTLE MOMENTUM</span><h3>Your daily intention</h3></div>
            <span className="ring-meter" style={{ '--progress': `${Math.min(100, Math.round((todayTotal / target) * 100))}%` }}><b>{Math.min(100, Math.round((todayTotal / target) * 100))}%</b></span>
          </div>
          <div className="progress-track"><span style={{ width: `${Math.min(100, (todayTotal / target) * 100)}%` }} /></div>
          <div className="progress-caption"><span>{Math.floor(todayTotal / 60)} min focused</span><span>{nextGoal} min daily goal</span></div>
          <div className="water-row">
            <div className="water-icon"><Droplets size={18} /></div>
            <div><strong>A small check-in</strong><small>{Number(profile.water_glasses_today || 0)} glasses of water today</small></div>
            <button className="outline-button" onClick={onWater}><Plus size={15} /> Glass of water</button>
          </div>
        </section>

        <section className="surface-panel buddy-panel">
          <span className="eyebrow">YOUR STUDY BUDDY</span>
          <h3>{live.session_active ? 'Here with you.' : 'Ready when you are.'}</h3>
          <p>{live.session_active ? 'Your camera session is active. Keep your attention on the work in front of you.' : 'Webcam monitoring is optional. Your timer and task list work without it.'}</p>
          <div className={`connection-label ${live.session_active ? 'connected' : ''}`}><span className="live-dot" />{live.session_active ? 'Live session' : 'Camera off'}</div>
          <button className="text-button" onClick={() => onNavigate('focus-room')}>Go to focus room <ArrowUpRight size={15} /></button>
        </section>
      </div>

      <div className="recharge-strip">
        <div><span className="eyebrow">A FEW WAYS TO RECHARGE</span><h3>Rest belongs in the plan.</h3></div>
        <div className="recharge-items"><span><Coffee size={17} /> Step away for a moment</span><span><Moon size={17} /> Rest your eyes</span><span><Heart size={17} /> Notice what’s going well</span></div>
      </div>
    </div>
  );
}

function TimerPanel({ profile, username, onNotice }) {
  const defaultDuration = Number(profile.session_preferences?.session_length_minutes || 25);
  const [duration, setDuration] = useState(defaultDuration);
  const [remaining, setRemaining] = useState(defaultDuration * 60);
  const [running, setRunning] = useState(false);
  const started = useRef(0);
  const creditedSeconds = useRef(0);
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
    if (remaining !== 0 || !running) return;
    playChime();
    setRunning(false);
    const secondsToCredit = Math.max(0, duration * 60 - creditedSeconds.current);
    creditedSeconds.current = 0;
    api(`/api/timer/credit?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ seconds: secondsToCredit }) })
      .then(() => onNotice('Block complete. Your study time has been saved.'))
      .catch((error) => onNotice(error.message));
  }, [remaining, running, duration, username, onNotice]);
  const chooseDuration = (value) => { if (!running) { creditedSeconds.current = 0; setDuration(value); setRemaining(value * 60); } };
  const start = () => {
    started.current = Date.now();
    if (profile.session_preferences?.session_chimes) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass && !chimeContext.current) chimeContext.current = new AudioContextClass();
      chimeContext.current?.resume().then(playChime);
    }
    setRunning(true);
  };
  const pause = async () => {
    const elapsed = Math.max(0, Math.round((Date.now() - started.current) / 1000));
    creditedSeconds.current += elapsed;
    setRunning(false);
    try { await api(`/api/timer/credit?username=${encodeURIComponent(username)}`, { method: 'POST', body: JSON.stringify({ seconds: elapsed }) }); }
    catch (error) { onNotice(error.message); }
  };
  const reset = () => { creditedSeconds.current = 0; setRunning(false); setRemaining(duration * 60); };
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  return <section className="timer-panel"><div className="timer-top"><span className="eyebrow">A CALM LITTLE POMODORO</span><label className="select-wrap"><select value={duration} disabled={running} onChange={(event) => chooseDuration(Number(event.target.value))}>{[15, 25, 45, 60, 90, 120].map((item) => <option key={item} value={item}>{item} minutes</option>)}</select><ChevronDown size={15} /></label></div><div className={`timer-display ${running ? 'is-running' : ''}`} aria-label={`Timer ${minutes} minutes ${seconds} seconds`}>{minutes}<span>:</span>{seconds}</div><div className="progress-track timer-progress"><span style={{ width: `${100 - (remaining / (duration * 60)) * 100}%` }} /></div><p className="timer-caption">A steady pace is a good pace</p><div className="timer-actions">{running ? <button className="primary-button" onClick={pause}><Pause size={17} /> Pause</button> : <button className="primary-button" disabled={remaining === 0} onClick={start}><Play size={17} />{remaining < duration * 60 ? 'Resume' : 'Start focus'}</button>}<button className="outline-button" onClick={reset}><RotateCcw size={16} /> Reset</button></div><small className="muted-note">This timer is a gentle guide; it does not control or record webcam sessions.</small></section>;
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
  const rows = [...(profile.session_history || [])].filter((row) => row && row.date).reverse();
  const sessions = Number(profile.sessions_completed || 0);
  const seconds = Number(profile.total_study_seconds || 0) + Number(profile.focus_timer_total_seconds || 0);
  const alertsFor = (item) => Number(item.posture_alerts || 0) + Number(item.distance_alerts || 0) + Number(item.looking_away_alerts || 0) + Number(item.fatigue_signals || 0);
  const maxAlerts = Math.max(1, ...rows.map(alertsFor));
  const totalAlerts = rows.reduce((total, item) => total + alertsFor(item), 0);
  const week = Array.from({ length: 7 }, (_, index) => { const day = new Date(); day.setDate(day.getDate() - 6 + index); const key = day.toISOString().slice(0, 10); const historySeconds = rows.filter((item) => String(item.date).slice(0, 10) === key).reduce((total, item) => total + Number(item.seconds || 0), 0); const timerSeconds = (profile.focus_timer_history || []).filter((item) => item.date === key).reduce((total, item) => total + Number(item.seconds || 0), 0); return { label: day.toLocaleDateString(undefined, { weekday: 'short' }), value: Math.floor((historySeconds + timerSeconds) / 60) }; });
  const maxWeek = Math.max(30, ...week.map((day) => day.value));
  const exportCsv = () => { const columns = ['Date', 'Subject', 'Goal', 'Task', 'Study time', 'Recorded camera alerts', 'XP earned']; const lines = [columns, ...rows.map((item) => [item.date, item.subject || '', item.goal || '', item.task_text || '', `${Math.floor(Number(item.seconds || 0) / 60)} min`, alertsFor(item), item.xp || 0])].map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(',')); downloadText('focusmate-session-history.csv', lines.join('\n'), 'text/csv'); };
  return (
    <div className="page-content">
      <div className="stats-grid insights-stats">
        <Stat label="Camera sessions" value={rows.length} note="Completed optional sessions" icon={Activity} />
        <Stat label="Sessions" value={sessions} note="Completed study sessions" icon={BookOpen} />
        <Stat label="Total study time" value={`${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}m`} note="Webcam and timer-only study" icon={Clock3} />
        <Stat label="Study-day streak" value={`${sessions ? Math.min(7, sessions) : 0} days`} note="Your recent study rhythm" icon={Flame} />
      </div>
      <div className="content-columns chart-columns">
        <section className="surface-panel chart-panel">
          <div className="section-heading"><div><span className="eyebrow">RECENT SESSIONS</span><h3>Recorded camera alerts</h3></div><span className="chart-legend"><i /> Alert count</span></div>
          {rows.length ? <div className="trend-chart">{rows.slice(0, 12).reverse().map((item, index) => <div className="trend-column" key={`${item.date}-${index}`}><span className="trend-tooltip">{alertsFor(item)}</span><i style={{ height: `${Math.max(6, alertsFor(item) / maxAlerts * 100)}%` }} /><small>{new Date(item.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>)}</div> : <div className="empty-state">Recorded camera alerts will appear here after an optional camera session.</div>}
          <p className="muted-note">Alerts are camera observations only. They are not a measure of concentration or mental state.</p>
        </section>
        <section className="surface-panel chart-panel">
          <div className="section-heading"><div><span className="eyebrow">LAST 7 DAYS</span><h3>Study time</h3></div><span className="chart-legend mint"><i /> Study minutes</span></div>
          <div className="week-chart">{week.map((day) => <div className="week-column" key={day.label}><span>{day.value || ''}</span><i style={{ height: `${Math.max(3, day.value / maxWeek * 100)}%` }} /><small>{day.label}</small></div>)}</div>
          <p className="muted-note">{week.reduce((sum, day) => sum + day.value, 0)} minutes this week · webcam sessions and timer-only study</p>
        </section>
      </div>
      <section className="history-section">
        <div className="section-heading"><div><span className="eyebrow">YOUR HISTORY</span><h3>Saved sessions</h3></div><button className="outline-button" onClick={exportCsv}><ArrowUpRight size={15} /> Download CSV</button></div>
        {rows.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Subject</th><th>Goal</th><th>Study time</th><th>Recorded camera alerts</th><th>XP earned</th></tr></thead><tbody>{rows.slice(0, 50).map((item, index) => <tr key={`${item.date}-${index}`}><td>{new Date(item.date).toLocaleDateString()}</td><td>{item.subject || '—'}</td><td>{item.goal || item.task_text || '—'}</td><td>{Math.floor(Number(item.seconds || 0) / 60)} min</td><td>{alertsFor(item)}</td><td>{item.xp || 0}</td></tr>)}</tbody></table></div> : <div className="empty-state">Your story starts whenever you do. Complete a webcam session to see it reflected here.</div>}
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
  const earned = new Set((profile.achievements || []).map((item) => item.id));
  const groups = [...new Set(achievements.map((item) => item[4]))];
  const count = achievements.filter((item) => earned.has(item[0])).length;
  return <div className="page-content"><section className="achievement-progress surface-panel"><div><span className="eyebrow">YOUR COLLECTION</span><h3>{count} of {achievements.length} unlocked</h3></div><div className="progress-track"><span style={{ width: `${count / achievements.length * 100}%` }} /></div></section>{groups.map((group) => { const entries = achievements.filter((item) => item[4] === group); return <section className="achievement-group" key={group}><div className="section-heading"><div><span className="eyebrow">{String(group).toUpperCase()}</span><h3>{group}</h3></div><span className="group-count">{entries.filter((item) => earned.has(item[0])).length} / {entries.length}</span></div><div className="achievement-grid">{entries.map(([id, title, description, reward]) => <article className={`achievement-card ${earned.has(id) ? 'earned' : ''}`} key={id}><div className="achievement-symbol">{earned.has(id) ? <Trophy size={18} /> : <LockKeyhole size={17} />}</div><div><h4>{title}</h4><p>{description}</p><small>{earned.has(id) ? 'Unlocked' : 'Reward'} · +{reward} XP</small></div></article>)}</div></section>; })}</div>;
}

function Quests({ profile, onClaim }) {
  const today = new Date().toISOString().slice(0, 10);
  const claims = profile.quest_claims || [];
  const claimed = (id) => claims.some((item) => item.quest_id === id && item.date === today);
  const count = quests.filter((quest) => claimed(quest.id)).length;
  const [busy, setBusy] = useState('');
  const claim = async (id) => { setBusy(id); try { await onClaim(id); } catch (error) { window.alert(error.message); } finally { setBusy(''); } };
  return <div className="page-content"><section className="quest-progress"><div><span className="eyebrow">TODAY’S QUESTS</span><strong>{count} <small>/ {quests.length} claimed</small></strong></div><div className="progress-track"><span style={{ width: `${count / quests.length * 100}%` }} /></div></section><div className="quest-list">{quests.map((quest) => <article className="quest-card" key={quest.id}><span className="quest-symbol">{quest.icon}</span><div className="quest-copy"><h3>{quest.title}</h3><p>{quest.description}</p></div><span className="xp-pill">+{quest.reward} XP</span>{claimed(quest.id) ? <span className="claimed-label"><Check size={15} /> Claimed</span> : <button className="outline-button" disabled={Boolean(busy)} onClick={() => claim(quest.id)}>{busy === quest.id ? 'Saving…' : 'Claim reward'}</button>}</article>)}</div><p className="muted-note">Self-care quests are self-reported. Take breaks because they feel right for you, not for a reward.</p></div>;
}

function Preferences({ profile, onSave }) {
  const defaults = { focus_monitoring: true, posture_alerts: true, mood_checkins: true, session_chimes: false, session_length_minutes: 25, daily_goal_minutes: 180 };
  const [preferences, setPreferences] = useState({ ...defaults, ...(profile.session_preferences || {}) });
  const [saved, setSaved] = useState(false);
  const set = (key, value) => setPreferences((current) => ({ ...current, [key]: value }));
  const save = async () => { await onSave({ session_preferences: preferences }); setSaved(true); window.setTimeout(() => setSaved(false), 2000); };
  const rows = [['focus_monitoring', 'Focus monitoring', 'Enable optional in-browser face, eye, posture, and distance estimates'], ['posture_alerts', 'Posture alerts', 'Show one gentle reminder after two minutes of slouching'], ['mood_checkins', 'Mood check-ins', 'Ask how I feel before my first camera session each day'], ['session_chimes', 'Session chimes', 'Play a soft tone when the focus timer starts and completes']];
  return <div className="page-content settings-layout"><section className="surface-panel settings-panel"><div className="settings-heading"><span className="eyebrow">MONITORING & REMINDERS</span><h3>Support that feels right.</h3><p>These choices stay with your local profile and can be changed at any time.</p></div>{rows.map(([key, title, description]) => <label className="setting-row" key={key}><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={Boolean(preferences[key])} onChange={(event) => set(key, event.target.checked)} /><i className="toggle-track" /></label>)}<div className="number-settings"><label>Default focus block <span><input type="number" min="15" max="120" step="5" value={preferences.session_length_minutes} onChange={(event) => set('session_length_minutes', Number(event.target.value))} /> min</span></label><label>Daily study goal <span><input type="number" min="30" max="720" step="15" value={preferences.daily_goal_minutes} onChange={(event) => set('daily_goal_minutes', Number(event.target.value))} /> min</span></label></div><button className="primary-button" onClick={save}><Check size={16} /> {saved ? 'Saved' : 'Save preferences'}</button></section><section className="surface-panel profile-summary"><span className="eyebrow">YOUR PROFILE</span><div className="summary-person"><div className="avatar">{(profile.player_name || 'F')[0].toUpperCase()}</div><div><strong>{profile.player_name}</strong><small>@{profile.username}</small></div></div><dl><div><dt>Rank</dt><dd>Level {levelForXp(profile.total_xp)}</dd></div><div><dt>Session length</dt><dd>{preferences.session_length_minutes} minutes</dd></div><div><dt>Daily goal</dt><dd>{Math.floor(preferences.daily_goal_minutes / 60)}h {String(preferences.daily_goal_minutes % 60).padStart(2, '0')}m</dd></div></dl></section></div>;
}

function Profile({ profile, onSave, onExport }) {
  const [name, setName] = useState(profile.player_name || '');
  const [sleep, setSleep] = useState(profile.session_wellbeing?.sleep_hours || 0);
  const [water, setWater] = useState(profile.water_glasses_today || 0);
  const [reflection, setReflection] = useState(profile.session_wellbeing?.reflection || '');
  const [saved, setSaved] = useState(false);
  const save = async (event) => { event.preventDefault(); const wellbeing = { ...profile.session_wellbeing, sleep_hours: Number(sleep), water_glasses: Number(water), reflection: reflection.slice(0, 500) }; await onSave({ player_name: name, water_glasses_today: Number(water), session_wellbeing: wellbeing }); setSaved(true); window.setTimeout(() => setSaved(false), 2000); };
  return <div className="page-content settings-layout"><form className="surface-panel profile-form" onSubmit={save}><span className="eyebrow">A LITTLE ABOUT YOU</span><h3>Your profile, at your pace.</h3><label>What should we call you?<input maxLength="80" value={name} onChange={(event) => setName(event.target.value)} /></label><div className="form-grid"><label>Sleep last night (hours)<input type="number" min="0" max="24" step="0.5" value={sleep} onChange={(event) => setSleep(event.target.value)} /></label><label>Water glasses today<input type="number" min="0" max="100" value={water} onChange={(event) => setWater(event.target.value)} /></label></div><label>A note to yourself<textarea maxLength="500" rows="4" value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="What would help you feel supported today?" /></label><button className="primary-button" type="submit"><Check size={16} /> {saved ? 'Saved' : 'Save check-in'}</button></form><section className="surface-panel data-panel"><span className="eyebrow">YOUR DATA, YOUR CHOICE</span><h3>Local by default.</h3><p>Your profile and completed-session history are stored in this browser's localStorage. They do not sync between browsers or devices, and clearing this site's data can remove them. localhost and your Vercel site have separate profiles. Camera frames are processed in your browser and are not saved.</p><button className="outline-button full-button" onClick={onExport}><ArrowUpRight size={15} /> Export profile as JSON</button><div className="privacy-card"><LockKeyhole size={17} /><span>Your username selects local data; it is not a password or secure authentication.</span></div></section></div>;
}

function downloadText(filename, contents, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([contents], { type })); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function downloadProfile(profile) { downloadText('focusmate-profile.json', JSON.stringify(profile, null, 2), 'application/json'); }

const container = document.getElementById('root');
const root = window.focusmateRoot || createRoot(container);
window.focusmateRoot = root;
root.render(<AppErrorBoundary><App /></AppErrorBoundary>);