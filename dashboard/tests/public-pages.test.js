import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dashboard = fileURLToPath(new URL('../', import.meta.url));

async function readDashboardFile(relativePath) {
  return readFile(resolve(dashboard, relativePath), 'utf8');
}

test('public pages have distinct indexable metadata and matching canonical URLs', async () => {
  const pages = [
    ['about.html', 'https://getfocusmate.vercel.app/about'],
    ['contact.html', 'https://getfocusmate.vercel.app/contact'],
    ['privacy.html', 'https://getfocusmate.vercel.app/privacy'],
  ];
  const titles = new Set();

  for (const [file, canonical] of pages) {
    const html = await readDashboardFile(file);
    const title = html.match(/<title>(.*?)<\/title>/)?.[1];
    assert.ok(title, `${file} should have a title`);
    assert.ok(!titles.has(title), `${file} should have a page-specific title`);
    titles.add(title);
    assert.match(html, /<meta name="description" content="[^"]+"/);
    assert.match(html, /<meta name="robots" content="index, follow"/);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}"\\s*/?>`));
    assert.match(html, new RegExp(`<meta property="og:url" content="${canonical}"\\s*/?>`));
    assert.match(html, /<meta property="og:image" content="https:\/\/getfocusmate\.vercel\.app\/icons\/focusmate-512\.png"\s*\/?>/);
    assert.match(html, /<meta name="twitter:image" content="https:\/\/getfocusmate\.vercel\.app\/icons\/focusmate-512\.png"\s*\/?>/);
  }
});

test('Vercel clean routes map to the static pages and stay outside the SPA fallback', async () => {
  const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
  for (const page of ['about', 'contact', 'privacy']) {
    assert.ok(config.rewrites.some(({ source, destination }) => (
      source === `/${page}` && destination === `/${page}.html`
    )));
  }

  const viteConfig = await readDashboardFile('vite.config.js');
  assert.match(viteConfig, /navigateFallbackDenylist:[\s\S]*about\|contact\|privacy/);
  assert.match(viteConfig, /globIgnores:[\s\S]*about\.html[\s\S]*contact\.html[\s\S]*privacy\.html/);
  assert.doesNotMatch(viteConfig, /runtimeCaching/);
  assert.match(viteConfig, /navigateFallbackDenylist:[\s\S]*\(\?!\$\|/);
});

test('the sitemap lists each public canonical route and robots references the sitemap', async () => {
  const sitemap = await readDashboardFile('public/sitemap.xml');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(urls, [
    'https://getfocusmate.vercel.app/',
    'https://getfocusmate.vercel.app/about',
    'https://getfocusmate.vercel.app/contact',
    'https://getfocusmate.vercel.app/privacy',
  ]);
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<\/urlset>\s*$/);

  const robots = await readDashboardFile('public/robots.txt');
  assert.match(robots, /User-agent:\s+\*/);
  assert.match(robots, /Allow:\s+\/\s/);
  assert.match(robots, /Sitemap:\s+https:\/\/getfocusmate\.vercel\.app\/sitemap\.xml/);
});

test('privacy content documents current webcam, support, storage, and deletion behavior', async () => {
  const pages = await readDashboardFile('src/PublicPages.jsx');
  for (const statement of [
    'Video frames and face/pose landmarks are processed in the browser.',
    'does not make a network request containing frames or landmarks',
    'Disabling a signal stops that signal from being evaluated and counted while it is off',
    'does not erase earlier timeline points or completed session records',
    'camera processing may continue for other enabled signals or the overlay',
    'timeline of up to 120 points',
    'Web3Forms',
    'Logging out does not delete those local profile copies',
    'tasks, study plans, session history, reflections, and wellbeing entries',
    'Leaderboard results expose rank, username, display name, and verified room-focus seconds',
    'Leaving an active room records a leave time; finishing a room marks it finished',
    'Removing a friend changes the friendship row to a removed status rather than deleting it',
    'no caching rule for API responses or profile data',
    'There is no self-service account-deletion feature',
    'cascading foreign keys for the Auth user’s profile, PIN credential',
    'October 10, 2026',
    'minimum age or a parental-consent process',
  ]) {
    assert.ok(pages.includes(statement), `privacy content should include: ${statement}`);
  }
});

test('public navigation copy is available through each supported language', async () => {
  const i18n = await readDashboardFile('src/i18n.js');
  const publicTranslations = i18n.slice(0, i18n.indexOf('\nconst sharedUiTranslations'));
  for (const key of ['public.about', 'public.privacy', 'public.contact', 'public.language']) {
    assert.equal((publicTranslations.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || []).length, 5);
  }
  for (const faqQuestion of [
    'How do I install FocusMate on my device?',
    '¿Cómo instalo FocusMate en mi dispositivo?',
    'Comment installer FocusMate sur mon appareil ?',
    'كيف أثبّت FocusMate على جهازي؟',
    'अपने डिवाइस पर FocusMate कैसे इंस्टॉल करें?',
  ]) {
    assert.ok(i18n.includes(faqQuestion), `install FAQ should be localized: ${faqQuestion}`);
  }
});
