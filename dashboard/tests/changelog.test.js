import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  changelog,
  compareSemanticVersions,
  sortReleasesByVersion,
} from '../src/changelog.js';
import { supportedLanguages, translate } from '../src/i18n.js';

test('changelog separates unreleased commits from unconfirmed release versions', () => {
  assert.equal(changelog.proposedInitialVersion, 'v1.0.0');
  assert.deepEqual(changelog.releases, []);
  assert.equal(changelog.unreleased[0].date, '2026-10-22');
  for (const entry of [...changelog.unreleased, ...changelog.history]) {
    assert.match(entry.commit, /^[a-f0-9]{7}$/);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.title);
    assert.ok(entry.summary);
    assert.ok(entry.category);
  }
});

test('Semantic Version comparison and sorting use major, minor, then patch', () => {
  assert.ok(compareSemanticVersions('v2.0.0', 'v1.9.9') > 0);
  assert.ok(compareSemanticVersions('1.2.0', '1.1.99') > 0);
  assert.ok(compareSemanticVersions('1.2.4', '1.2.3') > 0);
  assert.equal(compareSemanticVersions('v1.2.3', '1.2.3'), 0);
  assert.deepEqual(
    sortReleasesByVersion([
      { version: 'v1.2.0' },
      { version: 'v2.0.0' },
      { version: 'v1.10.1' },
      { version: 'v1.2.1' },
    ]).map(({ version }) => version),
    ['v2.0.0', 'v1.10.1', 'v1.2.1', 'v1.2.0'],
  );
  assert.throws(() => compareSemanticVersions('v1.2', 'v1.0.0'), /Invalid Semantic Version/);
});

test('documentation changelog renders dynamic release groups and usable in-page navigation', async () => {
  const component = await readFile(new URL('../src/DocumentationPage.jsx', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(component, /sortReleasesByVersion\(changelog\.releases\)/);
  assert.match(component, /olderReleases\.map\(renderChange\)/);
  assert.match(component, /changelog\.history\.map\(renderChange\)/);
  for (const id of ['updates', 'unreleased', 'release-policy', 'release-history']) {
    assert.match(component, new RegExp(`id="${id}"`));
  }
  for (const link of ['unreleased', 'release-policy', 'release-history']) {
    assert.match(component, new RegExp(`href="#${link}"`));
  }
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.changelog-card/);
  assert.match(styles, /\.documentation-page a:focus-visible/);
  assert.match(component, /<details className="changelog-disclosure/);
});

test('changelog labels use the existing translation system in every supported language', () => {
  const keys = [
    'changelog.title',
    'changelog.intro',
    'changelog.navigation',
    'changelog.unreleased',
    'changelog.latestActivity',
    'changelog.policy',
    'changelog.format',
    'changelog.history',
    'changelog.versioning',
    'changelog.publishedReleases',
    'changelog.latestRelease',
    'changelog.olderReleases',
    'changelog.confirmedHistory',
    'changelog.historyNote',
    'changelog.noPublishedReleases',
    'changelog.proposedVersion',
    'changelog.proposedVersionNote',
    'changelog.major',
    'changelog.minor',
    'changelog.patch',
    'changelog.footnote',
    'changelog.commit',
    'changelog.category.added',
    'changelog.category.improved',
    'changelog.category.fixed',
    'changelog.category.changed',
    'changelog.category.reliability',
  ];
  for (const language of supportedLanguages) {
    for (const key of keys) {
      assert.notEqual(translate(language, key), key, `${language}:${key}`);
    }
  }
});
