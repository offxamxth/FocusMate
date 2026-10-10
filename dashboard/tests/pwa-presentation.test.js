import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installationInstructionsKey,
  pwaSurfaceForApp,
  pwaSurfaceForAuth,
  pwaUiForSurface,
} from '../src/pwa-presentation.js';

test('the installation option is confined to the login surface', () => {
  assert.equal(pwaSurfaceForAuth({ authLoading: false, session: null, localMode: false }), 'login');
  assert.equal(pwaSurfaceForAuth({ authLoading: true, session: null, localMode: false }), 'hidden');
  assert.equal(pwaSurfaceForAuth({ authLoading: false, session: {}, localMode: false }), 'hidden');
  assert.equal(pwaSurfaceForAuth({ authLoading: false, session: null, localMode: true }), 'hidden');

  assert.deepEqual(pwaUiForSurface('login', { installed: false, hasStatus: false }), {
    showLoginDock: true,
    showInstallOption: true,
    showStatusPanel: false,
  });
  assert.deepEqual(pwaUiForSurface('hidden', { installed: false, hasStatus: false }), {
    showLoginDock: false,
    showInstallOption: false,
    showStatusPanel: false,
  });
});

test('authenticated pages suppress the installation dock but keep PWA status available', () => {
  assert.equal(pwaSurfaceForApp({ loading: true, profile: null, page: 'overview' }), 'hidden');
  assert.equal(pwaSurfaceForApp({ loading: false, profile: null, page: 'overview' }), 'login');
  assert.equal(pwaSurfaceForApp({ loading: false, profile: {}, page: 'contact' }), 'contact');
  for (const page of [
    'overview',
    'focus-room',
    'friends',
    'leaderboard',
    'insights',
    'session-results',
    'achievements',
    'quests',
    'session-preferences',
    'profile',
  ]) {
    const surface = pwaSurfaceForApp({ loading: false, profile: {}, page });
    assert.equal(surface, 'hidden', `${page} must not show the installation dock`);
    assert.equal(pwaUiForSurface(surface, { installed: false, hasStatus: false }).showLoginDock, false);
  }

  assert.deepEqual(pwaUiForSurface('hidden', { installed: false, hasStatus: true }), {
    showLoginDock: false,
    showInstallOption: false,
    showStatusPanel: true,
  });
  assert.deepEqual(pwaUiForSurface('contact', { installed: false, hasStatus: false }), {
    showLoginDock: false,
    showInstallOption: false,
    showStatusPanel: false,
  });
});

test('installation help selects matching browser and device instructions', () => {
  assert.equal(installationInstructionsKey('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'pwa.instructionsIos');
  assert.equal(installationInstructionsKey('Mozilla/5.0 (Linux; Android 14) Chrome/120.0'), 'pwa.instructionsAndroid');
  assert.equal(installationInstructionsKey('Mozilla/5.0 (Linux; Android 14) Firefox/120.0'), 'pwa.instructionsOther');
  assert.equal(installationInstructionsKey('Mozilla/5.0 (Windows NT 10.0) Edg/120.0'), 'pwa.instructionsDesktop');
  assert.equal(installationInstructionsKey('Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1', 'MacIntel', 0), 'pwa.instructionsOther');
  assert.equal(installationInstructionsKey('Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1', 'MacIntel', 5), 'pwa.instructionsIos');
});
