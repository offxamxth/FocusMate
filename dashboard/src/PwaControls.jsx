import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { browserLanguage, supportedLanguages, translate } from './i18n.js';
import { SESSION_ACTIVITY_EVENT } from './pwa-session-state.js';

function standaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
}

function installInstructionsKey() {
  const userAgent = navigator.userAgent;
  const isIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/.test(userAgent) || isIPad) return 'pwa.instructionsIos';
  if (/Android/i.test(userAgent)) return 'pwa.instructionsAndroid';
  if (/\bEdg\//.test(userAgent) || /\bChrome\//.test(userAgent)) {
    return 'pwa.instructionsDesktop';
  }
  return 'pwa.instructionsOther';
}

export default function PwaControls() {
  const [online, setOnline] = useState(navigator.onLine);
  const [installed, setInstalled] = useState(standaloneMode);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [activeSessions, setActiveSessions] = useState({});
  const [applyUpdate, setApplyUpdate] = useState(null);
  const [error, setError] = useState('');
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('focusmate-language');
    return supportedLanguages.includes(saved) ? saved : browserLanguage();
  });
  const t = (key) => translate(language, key);
  const activeSession = Object.values(activeSessions).some(Boolean);

  useEffect(() => {
    const syncOnline = () => setOnline(navigator.onLine);
    const syncInstalled = () => setInstalled(standaloneMode());
    const onInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowInstructions(false);
    };
    const onSessionActivity = (event) => {
      const { source, active } = event.detail || {};
      if (source !== 'timer' && source !== 'camera' && source !== 'room') return;
      setActiveSessions((current) => ({ ...current, [source]: Boolean(active) }));
    };
    const onLanguageChanged = () => {
      const saved = localStorage.getItem('focusmate-language');
      setLanguage(supportedLanguages.includes(saved) ? saved : browserLanguage());
    };
    const displayMode = window.matchMedia('(display-mode: standalone)');
    displayMode.addEventListener?.('change', syncInstalled);
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener(SESSION_ACTIVITY_EVENT, onSessionActivity);
    window.addEventListener('focusmate:language-changed', onLanguageChanged);
    if (!('serviceWorker' in navigator)) return () => {
      displayMode.removeEventListener?.('change', syncInstalled);
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener(SESSION_ACTIVITY_EVENT, onSessionActivity);
      window.removeEventListener('focusmate:language-changed', onLanguageChanged);
    };

    const update = registerSW({
      immediate: true,
      onNeedRefresh: () => setUpdateReady(true),
      onRegisterError: (registrationError) => {
        console.error('FocusMate service worker registration failed.', registrationError);
        setError(t('pwa.registrationError'));
      },
    });
    setApplyUpdate(() => update);
    return () => {
      displayMode.removeEventListener?.('change', syncInstalled);
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener(SESSION_ACTIVITY_EVENT, onSessionActivity);
      window.removeEventListener('focusmate:language-changed', onLanguageChanged);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) {
      setShowInstructions(true);
      return;
    }
    const prompt = installPrompt;
    setInstallPrompt(null);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      else setShowInstructions(true);
    } catch (promptError) {
      console.error('FocusMate installation prompt failed.', promptError);
      setError(t('pwa.installError'));
    }
  };

  const update = async () => {
    if (activeSession || !applyUpdate) return;
    if (!window.confirm(t('pwa.confirmUpdate'))) return;
    try {
      await applyUpdate();
    } catch (updateError) {
      console.error('FocusMate update activation failed.', updateError);
      setError(t('pwa.updateError'));
    }
  };

  if (online && installed && !updateReady && !error) return null;

  return (
    <>
      <aside className="pwa-dock" aria-label="FocusMate app status">
        {!online && (
          <section className="pwa-message" role="status">
            <strong>{t('pwa.offlineTitle')}</strong>
            <p>{t('pwa.offlineMessage')}</p>
          </section>
        )}
        {updateReady && (
          <section className="pwa-message" role="status">
            <strong>{t('pwa.updateTitle')}</strong>
            <p>{activeSession ? t('pwa.updateBlocked') : t('pwa.updateMessage')}</p>
            <button className="pwa-action" disabled={activeSession} onClick={update}>
              {t('pwa.update')}
            </button>
          </section>
        )}
        {error && <p className="pwa-error" role="alert">{error}</p>}
        {!installed && online && (
          <button className="pwa-install" onClick={install}>
            {installPrompt ? t('pwa.install') : t('pwa.howToInstall')}
          </button>
        )}
      </aside>
      {showInstructions && (
        <div className="pwa-dialog-backdrop">
          <section
            aria-labelledby="pwa-dialog-title"
            aria-modal="true"
            className="pwa-dialog"
            role="dialog"
          >
            <button
              aria-label={t('pwa.close')}
              className="pwa-dialog-close"
              onClick={() => setShowInstructions(false)}
            >
              ×
            </button>
            <h2 id="pwa-dialog-title">{t('pwa.instructionsTitle')}</h2>
            <p>{t(installInstructionsKey())}</p>
            <p>{t('pwa.installAccountNote')}</p>
            <button className="pwa-action" onClick={() => setShowInstructions(false)}>
              {t('pwa.close')}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
