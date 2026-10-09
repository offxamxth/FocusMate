import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react';
import { api } from './local-api.js';
import {
  authErrorMessage,
  getPrivateProfile,
  localIdentityForAuthUser,
  supabase,
  supabaseConfigured,
  supabaseConfigurationError,
  validCloudUsername,
} from './lib/supabase.js';
import {
  authenticateWithUsernamePin,
  isUsernameUnavailableMessage,
  validatePinAccount,
} from './pin-auth.js';
import { browserLanguage, supportedLanguages, textDirection, translate } from './i18n.js';
import { startOwnPresence } from './presence.js';

function accountLanguage() {
  const saved = localStorage.getItem('focusmate-language');
  return supportedLanguages.includes(saved) ? saved : browserLanguage();
}

function profileForLocalApp(profile) {
  return {
    theme: profile.theme,
    study_style: profile.study_style,
    study_goal_type: profile.study_goal,
    time_format: profile.time_format,
    ...(profile.preferences || {}),
    ...(profile.session_preferences || {}),
  };
}

function isProfileSnapshot(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0;
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(supabaseConfigured);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileAttempt, setProfileAttempt] = useState(0);
  const [profileError, setProfileError] = useState('');
  const [localMode, setLocalMode] = useState(!supabaseConfigured);
  const [presenceState, setPresenceState] = useState('offline');

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (event === 'SIGNED_OUT') setProfile(null);
      setProfileError('');
    });
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setProfileError(authErrorMessage(error));
        setSession(data?.session || null);
        setAuthLoading(false);
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
    const userId = session?.user?.id;
    if (!supabase || !userId) {
      setPresenceState('offline');
      return undefined;
    }

    setPresenceState('connecting');
    try {
      return startOwnPresence(supabase, userId, setPresenceState);
    } catch {
      setPresenceState('unavailable');
      return undefined;
    }
  }, [session?.user?.id]);

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
      const snapshotExists = isProfileSnapshot(row.app_data);
      const sourceProfile = snapshotExists ? row.app_data : local.profile;
      const nextProfile = {
        ...sourceProfile,
        username: storageUsername,
        player_name: row.display_name || sourceProfile.player_name || local.profile.player_name,
        session_preferences: {
          ...local.profile.session_preferences,
          ...(sourceProfile.session_preferences || {}),
          ...profileForLocalApp(row),
        },
      };
      await api(`/api/state?username=${encodeURIComponent(storageUsername)}`, {
        method: 'PUT',
        body: JSON.stringify({ profile: nextProfile }),
      });
      if (!snapshotExists) {
        await supabase
          .from('profiles')
          .update({ app_data: nextProfile })
          .eq('user_id', session.user.id)
          .throwOnError();
      }
      if (active) setProfile({ ...row, app_data: nextProfile, storageUsername });
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

  const syncedSnapshot = useRef('');
  useEffect(() => {
    if (!supabase || !session?.user?.id || !profile?.storageUsername) return undefined;
    let timeout;
    let active = true;
    const handleProfileUpdate = (event) => {
      if (event.detail?.username !== profile.storageUsername || !event.detail.profile) return;
      const snapshot = JSON.stringify(event.detail.profile);
      if (snapshot === syncedSnapshot.current) return;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(async () => {
        try {
          await supabase
            .from('profiles')
            .update({ app_data: event.detail.profile })
            .eq('user_id', session.user.id)
            .throwOnError();
          if (active) syncedSnapshot.current = snapshot;
        } catch (error) {
          if (!active) return;
          window.dispatchEvent(new CustomEvent('focusmate:cloud-sync-error', {
            detail: { message: authErrorMessage(error) },
          }));
        }
      }, 1200);
    };
    syncedSnapshot.current = JSON.stringify(profile.app_data || {});
    window.addEventListener('focusmate:profile-updated', handleProfileUpdate);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.removeEventListener('focusmate:profile-updated', handleProfileUpdate);
    };
  }, [session?.user?.id, profile?.storageUsername]);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setProfile(null);
  };

  if (!supabaseConfigured || localMode) {
    return children({
      account: null,
      onCloudSignOut: null,
      onCloudLogin: supabaseConfigured ? () => setLocalMode(false) : null,
      cloudConfigurationError: supabaseConfigurationError,
    });
  }

  if (authLoading) {
    return (
      <main className="boot-screen" role="status">
        <span className="brand-mark">f<span>✳</span></span>
        <span>{translate(accountLanguage(), 'auth.loading')}</span>
      </main>
    );
  }

  if (!session) {
    return (
      <AuthScreen
        initialError={profileError}
        onLocal={() => setLocalMode(true)}
        onSignedIn={(nextSession) => {
          setProfileError('');
          setSession(nextSession);
        }}
      />
    );
  }

  if (profileLoading) {
    return (
      <main className="boot-screen" role="status">
        <span className="brand-mark">f<span>✳</span></span>
        <span>{translate(accountLanguage(), 'auth.loadingProfile')}</span>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="welcome-page">
        <section className="welcome-form" role="alert">
          <div className="welcome-kicker">{translate(accountLanguage(), 'auth.profileUnavailable')}</div>
          <h1>{translate(accountLanguage(), 'auth.accountSafe')}</h1>
          <p>{profileError || translate(accountLanguage(), 'auth.profileLoadError')}</p>
          <button className="primary-button" onClick={() => setProfileAttempt((attempt) => attempt + 1)}>{translate(accountLanguage(), 'auth.tryAgain')}</button>
          <button className="outline-button" onClick={() => signOut().catch((error) => setProfileError(authErrorMessage(error)))}>{translate(accountLanguage(), 'auth.logOut')}</button>
          <small className="privacy-note">{translate(accountLanguage(), 'auth.localPreserved')}</small>
          <button className="text-button" onClick={() => setLocalMode(true)}>{translate(accountLanguage(), 'auth.useLocal')}</button>
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
      profile,
      presenceState,
    },
    onCloudSignOut: signOut,
    onCloudLogin: null,
  });
}

function AuthScreen({ initialError = '', onSignedIn, onLocal }) {
  const [view, setView] = useState('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(initialError);
  const [language, setLanguage] = useState(accountLanguage);
  const signup = view === 'signup';
  const migrating = view === 'migrate';
  const t = (key, values) => translate(language, `auth.${key}`, values);

  const submit = async (event) => {
    event.preventDefault();
    setMessage('');
    setError('');
    const action = signup ? 'signup' : migrating ? 'migrate' : 'login';
    const validationError = validatePinAccount({ username, displayName, pin, action });
    if (validationError) {
      setError(validationError === 'Please enter your username.'
        ? t('usernameRequired')
        : validationError === 'Please enter your display name.'
          ? t('displayNameRequired')
          : t('pinInvalid'));
      return;
    }
    if (username.trim() && !validCloudUsername(username)) {
      setError(t('usernameInvalid'));
      return;
    }
    if (migrating && (!email.trim() || !currentPassword)) {
      setError(t('migrationCredentialsRequired'));
      return;
    }

    setBusy(true);
    try {
      const nextSession = await authenticateWithUsernamePin(supabase, {
        action,
        username,
        displayName,
        language,
        email,
        currentPassword,
        pin,
      });
      onSignedIn(nextSession);
      setPin('');
    } catch (authError) {
      const message = authErrorMessage(authError);
      const isNetworkError = /network|fetch|connection|timeout/i.test(message);
      setError(isNetworkError
        ? t('networkError')
        : isUsernameUnavailableMessage(message)
          ? t('usernameUnavailable')
          : migrating && /does not have a focusmate profile/i.test(message)
            ? t('migrationProfileMissing')
            : signup
              ? t('requestFailure')
              : t('incorrectCredentials'));
    } finally {
      setPin('');
      setCurrentPassword('');
      setBusy(false);
    }
  };

  const selectLanguage = (event) => {
    const nextLanguage = event.target.value;
    setLanguage(nextLanguage);
    if (nextLanguage === 'system') localStorage.removeItem('focusmate-language');
    else localStorage.setItem('focusmate-language', nextLanguage);
    document.documentElement.lang = nextLanguage === 'system' ? browserLanguage() : nextLanguage;
    document.documentElement.dir = textDirection(nextLanguage);
    window.dispatchEvent(new Event('focusmate:language-changed'));
  };

  return (
    <main className="welcome-page auth-page" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <section className="welcome-art">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <span className="welcome-cross">✳</span>
        <div className="welcome-wordmark">focus<span>mate</span><i>✳</i></div>
        <p>{t('tagline')}</p>
        <div className="welcome-art-meta"><span>{t('studySpace')}</span><span>{t('progressNotPerfection')}</span></div>
      </section>
      <form className="welcome-form auth-form" onSubmit={submit} noValidate>
        <div className="auth-language">
          <label htmlFor="auth-language">{translate(language, 'preferences.language')}</label>
          <select id="auth-language" value={language} onChange={selectLanguage}>
            {supportedLanguages.map((code) => (
              <option key={code} value={code}>{translate(language, `language.${code}`)}</option>
            ))}
          </select>
        </div>
        <div className="welcome-kicker">{t('accountLabel')}</div>
        <h1>{signup ? t('createTitle') : migrating ? t('migrateTitle') : t('welcome')}</h1>
        <p>{signup ? t('createDescription') : migrating ? t('migrateDescription') : t('loginDescription')}</p>
        {migrating && (
          <>
            <label>{t('existingEmail')}
              <span className="auth-input-wrap"><span aria-hidden="true">@</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span>
            </label>
            <label>{t('existingPassword')}
              <span className="auth-input-wrap"><LockKeyhole size={16} aria-hidden="true" /><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></span>
            </label>
          </>
        )}
        {signup && (
          <label>{t('displayName')}
            <span className="auth-input-wrap"><UserRound size={16} aria-hidden="true" /><input autoComplete="name" maxLength="80" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></span>
          </label>
        )}
        <label>{migrating ? t('migrationUsername') : t('username')}
          <span className="auth-input-wrap"><span aria-hidden="true">@</span><input autoComplete="username" maxLength="32" value={username} onChange={(event) => setUsername(event.target.value)} required={!migrating} /></span>
          {migrating && <small className="field-hint">{t('migrationUsernameHelp')}</small>}
        </label>
        <label>{t('pin')}
          <span className="auth-input-wrap"><LockKeyhole size={16} aria-hidden="true" /><input type={showPin ? 'text' : 'password'} inputMode="numeric" pattern="[0-9]{6}" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} aria-describedby="pin-help" required /><button type="button" className="password-visibility" aria-label={showPin ? t('hidePin') : t('showPin')} onClick={() => setShowPin((visible) => !visible)}>{showPin ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>
          <small id="pin-help" className="field-hint">{t('pinHelp')}</small>
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        {message && <div className="auth-message" role="status" aria-live="polite">{message}</div>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? t('pleaseWait') : signup ? t('createAccount') : migrating ? t('migrateAccount') : t('logIn')}
          {!busy && <ArrowUpRight size={17} />}
        </button>
        <p className="auth-switch">
          {migrating ? t('alreadyMigrated') : signup ? t('haveAccount') : t('newToFocusMate')}
          <button type="button" onClick={() => { setView(migrating || signup ? 'login' : 'signup'); setError(''); setMessage(''); setPin(''); setCurrentPassword(''); }}>
            {migrating || signup ? t('logIn') : t('createAccount')}
          </button>
        </p>
        {!signup && !migrating && <button className="text-button auth-migrate-link" type="button" onClick={() => { setView('migrate'); setError(''); }}>{t('migrateExisting')}</button>}
        <p className="auth-reset-help">{migrating ? t('migrationPrivacy') : t('contactAdmin')}</p>
        {onLocal && <button type="button" className="outline-button auth-local-link" onClick={onLocal}>{t('useLocal')}</button>}
        <small className="privacy-note"><LockKeyhole size={14} /> {t('pinSecurity')}</small>
      </form>
    </main>
  );
}
