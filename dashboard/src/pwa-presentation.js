export function pwaSurfaceForAuth({ authLoading, session, localMode }) {
  if (authLoading || session || localMode) return 'hidden';
  return 'login';
}

export function pwaSurfaceForApp({ loading, profile, page }) {
  if (loading) return 'hidden';
  if (!profile) return 'login';
  return page === 'contact' ? 'contact' : 'hidden';
}

export function pwaUiForSurface(surface, { installed, hasStatus }) {
  return {
    showLoginDock: surface === 'login' && (!installed || hasStatus),
    showInstallOption: surface === 'login' && !installed,
    showStatusPanel: surface !== 'login' && hasStatus,
  };
}

export function installationInstructionsKey(userAgent, platform = '', maxTouchPoints = 0) {
  const isIPad = platform === 'MacIntel' && maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/i.test(userAgent) || isIPad) return 'pwa.instructionsIos';
  if (/Android/i.test(userAgent)) {
    return /Chrome\//i.test(userAgent) ? 'pwa.instructionsAndroid' : 'pwa.instructionsOther';
  }
  if (/\bEdg\//i.test(userAgent) || /\bChrome\//i.test(userAgent)) {
    return 'pwa.instructionsDesktop';
  }
  return 'pwa.instructionsOther';
}
