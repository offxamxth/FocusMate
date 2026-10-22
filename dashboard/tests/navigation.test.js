import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isUnknownPath,
  mobileDestinationFromLocation,
  navigationPath,
  pageFromLocation,
  publicPageFromLocation,
} from '../src/navigation.js';

function location(pathname = '/', hash = '') {
  return { pathname, hash };
}

test('mobile destinations resolve to the existing application pages', () => {
  assert.equal(pageFromLocation(location('/', '#overview')), 'overview');
  assert.equal(pageFromLocation(location('/', '#tasks')), 'overview');
  assert.equal(pageFromLocation(location('/', '#focus')), 'focus-room');
  assert.equal(pageFromLocation(location('/', '#rooms')), 'focus-room');
  assert.equal(pageFromLocation(location('/', '#profile')), 'profile');
});

test('legacy and secondary destinations remain directly addressable', () => {
  assert.equal(pageFromLocation(location('/', '#focus-room')), 'focus-room');
  assert.equal(mobileDestinationFromLocation(location('/', '#focus-room')), 'focus');
  assert.equal(pageFromLocation(location('/', '#leaderboard')), 'overview');
  assert.equal(pageFromLocation(location('/contact')), 'contact');
});

test('Global XP leaderboard is absent from application navigation and page routes', async () => {
  const appSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /import LeaderboardPage from '\.\/LeaderboardPage\.jsx'/);
  assert.doesNotMatch(appSource, /\{\s*id: 'leaderboard',/);
  assert.doesNotMatch(appSource, /page === 'leaderboard'/);
});

test('public pages resolve from clean paths without changing authenticated hash routes', () => {
  for (const page of ['about', 'contact', 'privacy']) {
    assert.equal(publicPageFromLocation(location(`/${page}`)), page);
    assert.equal(pageFromLocation(location(`/${page}`)), page);
  }
  assert.equal(publicPageFromLocation(location('/documentation.html')), 'documentation');
  assert.equal(pageFromLocation(location('/documentation.html')), 'documentation');
  assert.equal(navigationPath('about'), '/about');
  assert.equal(navigationPath('contact'), '/#contact');
  assert.equal(navigationPath('privacy'), '/privacy');
  assert.equal(publicPageFromLocation(location('/privacy/')), 'privacy');
  assert.equal(publicPageFromLocation(location('/#privacy')), null);
  assert.equal(pageFromLocation(location('/', '#privacy')), 'overview');
  assert.equal(isUnknownPath(location('/unknown')), true);
  assert.equal(isUnknownPath(location('/unknown/')), true);
  assert.equal(isUnknownPath(location('/')), false);
  assert.equal(isUnknownPath(location('/index.html')), false);
  assert.equal(isUnknownPath(location('/contact/')), false);
});

test('navigation paths retain the existing contact path and hash routes', () => {
  assert.equal(navigationPath('overview'), '/#overview');
  assert.equal(navigationPath('tasks'), '/#tasks');
  assert.equal(navigationPath('leaderboard'), '/#leaderboard');
  assert.equal(navigationPath('contact'), '/#contact');
  assert.equal(navigationPath('documentation'), '/#documentation');
  assert.equal(navigationPath('privacy'), '/privacy');
});

test('cloud-only deep links and all leaderboard deep links return to overview', async () => {
  const appSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /VITE_FOCUSMATE_GLOBAL_LEADERBOARD_ENABLED|globalLeaderboardEnabled/);
  assert.match(appSource, /\(!account && pages\.some\(\(item\) => item\.id === page && item\.requiresCloud\)\)/);
  assert.match(appSource, /\{cloudAccount && <button type="button" onClick=\{\(\) => onNavigate\('friends'\)\}/);
  assert.doesNotMatch(appSource, /\{hasCloudAccount &&/);
  assert.match(appSource, /\{ id: 'friends'.*requiresCloud: true/);
  assert.equal(pageFromLocation(location('/', '#leaderboard')), 'overview');
});

test('documentation is available in the app navigation and public page shell', async () => {
  const appSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const publicSource = await readFile(new URL('../src/PublicPages.jsx', import.meta.url), 'utf8');
  const docsSource = await readFile(new URL('../src/DocumentationPage.jsx', import.meta.url), 'utf8');
  const viteConfig = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  const docsHtml = await readFile(new URL('../documentation.html', import.meta.url), 'utf8');
  const vercelConfig = await readFile(new URL('../../vercel.json', import.meta.url), 'utf8');
  assert.match(appSource, /\{ id: 'documentation', label: 'nav\.documentation'/);
  assert.match(appSource, /\{page === 'documentation' && <DocumentationPage \/>}/);
  assert.match(appSource, /className="welcome-documentation-link" href="\/documentation\.html"/);
  assert.match(publicSource, /page === 'documentation' && <DocumentationPage publicPage \/>/);
  assert.match(viteConfig, /documentation: resolve\(dashboardRoot, 'documentation\.html'\)/);
  assert.match(viteConfig, /documentation\\\.html/);
  assert.doesNotMatch(vercelConfig, /"source":\s*"\/documentation\.html"/);
  assert.match(docsHtml, /<title>Documentation \| FocusMate<\/title>/);
  assert.match(docsHtml, /canonical" href="https:\/\/getfocusmate\.vercel\.app\/documentation\.html"/);
  for (const section of [
    'getting-started',
    'focus-sessions',
    'features',
    'focus-score',
    'privacy',
    'troubleshooting',
    'updates',
  ]) {
    assert.match(docsSource, new RegExp(`id="${section}"`));
  }
  assert.match(docsSource, /FocusMate does not currently show a Focus Score/);
  assert.match(docsSource, /commit: 'e824c4b'/);
});
