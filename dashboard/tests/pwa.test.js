import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const publicPath = (file) => fileURLToPath(new URL(`../public/${file}`, import.meta.url));

test('web app manifest has the required FocusMate installation metadata', () => {
  const manifest = JSON.parse(readFileSync(publicPath('manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'FocusMate');
  assert.equal(manifest.short_name, 'FocusMate');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.description);
  assert.ok(manifest.theme_color);
  assert.ok(manifest.background_color);

  for (const size of ['192x192', '512x512']) {
    assert.ok(manifest.icons.some((icon) =>
      icon.sizes === size && icon.type === 'image/png' && icon.purpose === 'any',
    ));
  }
  assert.ok(manifest.icons.some((icon) =>
    icon.sizes === '512x512' && icon.type === 'image/png' && icon.purpose === 'maskable',
  ));
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('/icons/'));
    const image = readFileSync(publicPath(icon.src.slice(1)));
    assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(image.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
    assert.equal(image.readUInt32BE(20), Number(icon.sizes.split('x')[1]));
  }
});

test('maskable icon artwork is a separate, purpose-designed asset', () => {
  const manifest = JSON.parse(readFileSync(publicPath('manifest.webmanifest'), 'utf8'));
  const maskable = manifest.icons.find((icon) => icon.purpose === 'maskable');
  assert.ok(maskable);
  assert.notEqual(maskable.src, '/icons/focusmate-512.png');
});

test('public HTML pages advertise the crawlable square PNG FocusMate favicon', () => {
  const pages = ['index.html', 'about.html', 'contact.html', 'privacy.html'];
  const faviconLink = '<link rel="icon" type="image/png" sizes="512x512" href="/icons/focusmate-512.png" />';
  const favicon = readFileSync(publicPath('icons/focusmate-512.png'));
  assert.deepEqual(favicon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(favicon.readUInt32BE(16), 512);
  assert.equal(favicon.readUInt32BE(20), 512);

  for (const page of pages) {
    const html = readFileSync(fileURLToPath(new URL(`../${page}`, import.meta.url)), 'utf8');
    assert.ok(html.includes(faviconLink), `${page} should link to the existing 512x512 PNG`);
    assert.equal((html.match(/<link rel="icon"/g) || []).length, 1, `${page} should have one favicon reference`);
    assert.doesNotMatch(html, /noindex/i, `${page} should not block indexing`);
  }

  const robots = readFileSync(publicPath('robots.txt'), 'utf8');
  assert.match(robots, /User-agent:\s+\*/);
  assert.match(robots, /Allow:\s+\//);
});
