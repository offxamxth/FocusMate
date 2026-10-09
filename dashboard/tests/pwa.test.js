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
