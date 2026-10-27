import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { safeExternalUrl, safeImageUrl, setSafeText } from '../js/security.js';

const maliciousMarkup = '<img src=x onerror="globalThis.compromised=true"><script>alert(1)</script>';
const textTarget = { textContent: '' };
setSafeText(textTarget, maliciousMarkup);
assert.equal(textTarget.textContent, maliciousMarkup, 'Untrusted text must remain literal text');

for (const unsafeUrl of [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  '//evil.example/image.jpg',
  'https:\\evil.example\image.jpg',
  '<svg onload=alert(1)>',
  'assets/image.png" onerror="alert(1)',
]) {
  assert.equal(safeImageUrl(unsafeUrl), '', `Unsafe image URL accepted: ${unsafeUrl}`);
  assert.equal(safeExternalUrl(unsafeUrl), '', `Unsafe external URL accepted: ${unsafeUrl}`);
}

assert.equal(safeImageUrl('assets/beef-stew.png'), 'assets/beef-stew.png');
assert.equal(safeImageUrl('./assets/beef-stew.png'), './assets/beef-stew.png');
assert.equal(safeImageUrl('/RecipeFinder/assets/beef-stew.png'), '/RecipeFinder/assets/beef-stew.png');
assert.equal(safeImageUrl('https://images.unsplash.com/photo.jpg'), 'https://images.unsplash.com/photo.jpg');
assert.equal(safeExternalUrl('https://www.youtube.com/watch?v=example'), 'https://www.youtube.com/watch?v=example');
assert.equal(safeExternalUrl('/local/path'), '', 'Tutorial links must be absolute HTTP(S) URLs');

for (const file of ['../js/render.js', '../js/modal.js']) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML\s*=|insertAdjacentHTML|<[^>]+\son[a-z]+\s*=/i, `${file} contains an unsafe HTML sink`);
}

console.log('Security regression tests passed.');
