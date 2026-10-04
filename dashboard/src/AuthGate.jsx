import { useEffect, useState } from 'react';
import { ArrowUpRight, Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { api } from './local-api.js';
import {
  authErrorMessage,
  getPrivateProfile,
  localIdentityForAuthUser,
  supabase,
  supabaseConfigured,
  validCloudUsername,
} from './lib/supabase.js';

function profileForLocalApp(profile) {
  const defaults = {
    language: 'system',
    focus_monitoring: true,
    posture_alerts: true,
    mood_checkins: true,
    session_chimes: false,
    session_length_minutes: 25,
    daily_goal_minutes: 60,
  };
  return {
    theme: profile.theme,
    study_style: profile.study_style,
    study_goal_type: profile.study_goal,
    time_format: profile.time_format,
    ...defaults,
    ...(profile.session_preferences || {}),
  };
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(supabaseConfigured);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [profileError, setProfileError] = useState('');
  const [localMode, setLocalMode] = useState(!supabaseConfigured);
  const [recoveryMode, setRecoveryMode] = useState(
    () => new URLSearchParams(window.location.search).get('recovery') === '1',
  );

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setProfile(null);
      setProfileError('');
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      else if (event === 'SIGNED_OUT') setRecoveryMode(false);
    });
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setProfileError(authErrorMessage(error));
        setSession(data?.session || null);
        setAuthLoading(false);
        if (!data?.session && new URLSearchParams(window.location.search).get('recovery') === '1') {
          setProfileError('This recovery link is invalid or expired. Request a new password reset link.');
        }
      })
      .catch((error) => {
        if (active) {
          setProfileError(authErrorMessage(error));
          setAuthLoading(false);
        }
      });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user) return undefined;
    let active = true;
    setProfileLoading(true);
    setProfileError('');
    const load = async () => {
      const row = await getPrivateProfile(supabase, session.user.id);
      const storageUsername = localIdentityForAuthUser(session.user.id);
      const local = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          username: storageUsername,
          name: row.display_name || 'Focus friend',
        }),
      });
      const sessionPreferences = profileForLocalApp(row);
      const nextProfile = {
        ...local.profile,
        player_name: row.display_name || local.profile.player_name,
        username: row.username,
        session_preferences: {
          ...local.profile.session_preferences,
          ...sessionPreferences,
        },
      };
      await api(`/api/state?username=${encodeURIComponent(storageUsername)}`, {
        method: 'PUT',
        body: JSON.stringify({ profile: nextProfile }),
      });
      if (active) setProfile({ ...row, storageUsername });
    };
    load()
      .catch((error) => {
        if (active) setProfileError(authErrorMessage(error));
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.user?.id, profileAttempt]);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setProfile(null);
    setRecoveryMode(false);
  };

  if (!supabaseConfigured || localMode) {
    return children({
      account: null,
      onCloudSignOut: null,
      onCloudLogin: supabaseConfigured ? () => setLocalMode(false) : null,
    });
  }

  if (authLoading) {
    return (
      <main className="boot-screen" role="status">
        <span className="brand-mark">f<span>✳</span></span>
        <span>Loading your FocusMate session…</span>
      </main>
    );
  }

  if (recoveryMode) {
    return (
      <AuthScreen
        mode="recovery"
        initialError={profileError}
        onBack={() => {
          setRecoveryMode(false);
          setProfileError('');
          window.history.replaceState({}, '', '/');
        }}
        onPasswordUpdated={async () => {
          setRecoveryMode(false);
          setProfileError('');
          window.history.replaceState({}, '', '/');
          if (session) setProfileLoading(true);
        }}
      />
    );
  }

  if (!session) {
    return (
      <AuthScreen
        mode="auth"
        initialError={profileError}
        onLocal={() => setLocalMode(true)}
        onSignedIn={(nextSession) => {
          setProfileError('');
          setSession(nextSession);
          setRecoveryMode(false);
          window.history.replaceState({}, '', '/');
        }}
      />
    );
  }

  if (profileLoading) {
    return (
      <main className="boot-screen" role="status">
        <span className="brand-mark">f<span>✳</span></span>
        <span>Loading your FocusMate profile…</span>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="welcome-page">
        <section className="welcome-form" role="alert">
          <div className="welcome-kicker">CLOUD PROFILE UNAVAILABLE</div>
          <h1>Your account is safe.</h1>
          <p>{profileError || 'FocusMate could not load your private profile. Your local study data has not been changed.'}</p>
          <button className="primary-button" onClick={() => setProfileAttempt((attempt) => attempt + 1)}>Try again</button>
          <button className="outline-button" onClick={() => signOut().catch((error) => setProfileError(authErrorMessage(error)))}>Sign out</button>
          <small className="privacy-note">Your existing browser-local profiles remain available from local sign-in.</small>
          <button className="text-button" onClick={() => setLocalMode(true)}>Continue with a local profile</button>
        </section>
      </main>
    );
  }

  return children({
    account: {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      storageUsername: profile.storageUsername,
      email: session.user.email || '',
      profile,
    },
    onCloudSignOut: signOut,
    onCloudLogin: null,
  });
}

function AuthScreen({ mode, initialError = '', onSignedIn, onLocal, onBack, onPasswordUpdated }) {
  const [view, setView] = useState(mode === 'recovery' ? 'new-password' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(initialError);
  const signup = view === 'signup';
  const isRecovery = mode === 'recovery' || view === 'new-password';

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    if (busy) return;

    const normalizedEmail = email.trim();
    if (view !== 'new-password' && !normalizedEmail) {
      setError('Please enter your email.');
      return;
    }
    if (view !== 'new-password' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (view === 'reset') {
      setBusy(true);
      try {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/?recovery=1`,
        });
        if (resetError) throw resetError;
        setMessage('If an account matches that address, a password reset link will be sent.');
      } catch (resetError) {
        setError(authErrorMessage(resetError));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (signup) {
      if (!displayName.trim()) {
        setError('Please enter your display name.');
        return;
      }
      if (!validCloudUsername(username)) {
        setError('Username must be 1–32 letters, numbers, dots, dashes, or underscores.');
        return;
      }
      if (password.length < 8) {
        setError('Choose a password with at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    } else if (view === 'new-password') {
      if (password.length < 8) {
        setError('Choose a password with at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    } else if (!password) {
      setError('Please enter your password.');
      return;
    }

    setBusy(true);
    try {
      if (view === 'new-password') {
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        setMessage('Your password has been updated.');
        await onPasswordUpdated();
        return;
      }
      if (signup) {
        const { data, error: signupError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              username: username.trim().toLowerCase(),
              display_name: displayName.trim().slice(0, 80),
            },
            emailRedirectTo: window.location.origin,
          },
        });
        if (signupError) throw signupError;
        if (!data.session) {
          setConfirmationPending(true);
          setMessage('Account created. Check your email to confirm your account before signing in.');
        } else {
          onSignedIn(data.session);
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) throw signInError;
        onSignedIn(data.session);
      }
    } catch (authError) {
      setError(authErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    setBusy(true);
    setError('');
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim() });
      if (resendError) throw resendError;
      setMessage('If confirmation is still required, a new email will be sent.');
    } catch (resendError) {
      setError(authErrorMessage(resendError));
    } finally {
      setBusy(false);
    }
  };

  const heading = isRecovery
    ? 'Choose a new password'
    : view === 'reset'
      ? 'Reset your password'
      : signup
        ? 'Create your account'
        : 'Welcome back';
  const description = isRecovery
    ? 'Use a new password to secure your FocusMate account.'
    : view === 'reset'
      ? 'Enter your account email and we’ll send a secure reset link if an account matches.'
      : signup
        ? 'A calm space for your next study session.'
        : 'Sign in to continue building your study rhythm.';

  return (
    <main className="welcome-page auth-page">
      <section className="welcome-art">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <span className="welcome-cross">✳</span>
        <div className="welcome-wordmark">focus<span>mate</span><i>✳</i></div>
        <p>Focus better. Study smarter.</p>
        <div className="welcome-art-meta"><span>YOUR STUDY SPACE</span><span>PROGRESS, NOT PERFECTION</span></div>
      </section>
      <form className="welcome-form auth-form" onSubmit={submit} noValidate>
        <div className="welcome-kicker">FOCUSMATE ACCOUNT</div>
        <h1>{heading}</h1>
        <p>{description}</p>
        {!isRecovery && view !== 'reset' && (
          <label>Email
            <span className="auth-input-wrap"><Mail size={16} aria-hidden="true" /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span>
          </label>
        )}
        {signup && (
          <>
            <label>Display name
              <span className="auth-input-wrap"><UserRound size={16} aria-hidden="true" /><input autoComplete="name" maxLength="80" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></span>
            </label>
            <label>Username
              <span className="auth-input-wrap"><span aria-hidden="true">@</span><input autoComplete="username" maxLength="32" value={username} onChange={(event) => setUsername(event.target.value)} required /></span>
            </label>
          </>
        )}
        {view !== 'reset' && (
          <>
            <label>{isRecovery ? 'New password' : 'Password'}
              <span className="auth-input-wrap"><LockKeyhole size={16} aria-hidden="true" /><input type={showPassword ? 'text' : 'password'} autoComplete={signup || isRecovery ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" className="password-visibility" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
            </label>
            {(signup || isRecovery) && <label>Confirm password
              <span className="auth-input-wrap"><LockKeyhole size={16} aria-hidden="true" /><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></span>
            </label>}
          </>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        {message && <div className="auth-message" role="status" aria-live="polite">{message}</div>}
        {confirmationPending && <button type="button" className="text-button auth-link" disabled={busy} onClick={resendConfirmation}>Resend confirmation email</button>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isRecovery ? 'Update password' : view === 'reset' ? 'Send reset link' : signup ? 'Create account' : 'Log in'}
          {!busy && <ArrowUpRight size={17} />}
        </button>
        {view === 'login' && <button type="button" className="text-button auth-link" onClick={() => { setView('reset'); setError(''); setMessage(''); }}>Forgot password?</button>}
        {!isRecovery && view !== 'reset' && (
          <p className="auth-switch">
            {signup ? 'Already have an account?' : 'New to FocusMate?'}
            <button type="button" onClick={() => { setView(signup ? 'login' : 'signup'); setError(''); setMessage(''); }}>
              {signup ? 'Log in' : 'Create an account'}
            </button>
          </p>
        )}
        {view === 'reset' && <button type="button" className="text-button auth-link" onClick={() => { setView('login'); setError(''); setMessage(''); }}>Back to log in</button>}
        {isRecovery && <button type="button" className="text-button auth-link" onClick={onBack}>Back to log in</button>}
        {onLocal && <button type="button" className="outline-button auth-local-link" onClick={onLocal}>Use an existing local profile</button>}
        <small className="privacy-note"><LockKeyhole size={14} /> Passwords are handled by Supabase Auth, never saved in FocusMate profiles.</small>
      </form>
    </main>
  );
}
