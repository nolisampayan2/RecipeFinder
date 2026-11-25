import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_IMAGE_MAX_BYTES,
  ADMIN_IMAGE_MAX_DIMENSION,
  createAdminImageSelection,
  inspectAdminImageFile,
} from '../js/admin-image-selection.js';
import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

const headers = Object.freeze({
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0],
  png: [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0],
  webp: [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80],
});
function file(name, type, bytes, size = 100) {
  return {
    name, type, size,
    slice(start, end) {
      assert.equal(start, 0);
      assert.equal(end, 12);
      return { async arrayBuffer() { return Uint8Array.from(bytes).buffer; } };
    },
  };
}
const jpeg = () => file('meal.JPG', 'image/jpeg', headers.jpeg);
const png = () => file('meal.png', 'image/png', headers.png);
const webp = () => file('meal.webp', 'image/webp', headers.webp);
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = { values: new Map(), toggle: (name, value) => { this.classList.values.set(name, value); } };
    this.textContent = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.files = [];
    this.clicks = 0;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name, listener) { if (this.listeners.get(name) === listener) this.listeners.delete(name); }
  emit(name) { this.listeners.get(name)?.(); }
  click() { this.clicks += 1; this.emit('click'); }
}
const documentLike = {
  createElement(name) { return new FakeElement(name); },
  createTextNode(value) { const node = new FakeElement('#text'); node.textContent = value; return node; },
};
function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children ?? []) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}
function harness(decodeImage = async () => ({ width: 100, height: 100 })) {
  const active = new Set();
  const revoked = [];
  let serial = 0;
  const urlApi = {
    createObjectURL() { const url = `blob:admin-image-${++serial}`; active.add(url); return url; },
    revokeObjectURL(url) { active.delete(url); revoked.push(url); },
  };
  const view = createAdminImageSelection({ documentLike, urlApi, decodeImage });
  const input = find(view.element, (node) => node.tagName === 'input' && node.type === 'file');
  const manual = find(view.element, (node) => node.tagName === 'input' && node.type === 'url');
  const preview = find(view.element, (node) => node.tagName === 'img');
  const filename = find(view.element, (node) => node.className === 'admin-image-selection-name');
  const status = find(view.element, (node) => node.className === 'admin-image-selection-status');
  const change = find(view.element, (node) => node.textContent === 'Change image');
  const remove = find(view.element, (node) => node.textContent === 'Remove selection');
  return { view, active, revoked, input, manual, preview, filename, status, change, remove };
}

assert.equal(ADMIN_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
assert.equal(ADMIN_IMAGE_MAX_DIMENSION, 4096);
for (const candidate of [jpeg(), png(), webp()]) {
  const result = await inspectAdminImageFile(candidate);
  assert.deepEqual(result, { ok: true, mimeType: candidate.type });
}
assert.deepEqual(await inspectAdminImageFile(file('maximum.png', 'image/png', headers.png, ADMIN_IMAGE_MAX_BYTES)),
  { ok: true, mimeType: 'image/png' });
for (const [candidate, code] of [
  [file('empty.png', 'image/png', headers.png, 0), 'empty'],
  [file('large.png', 'image/png', headers.png, ADMIN_IMAGE_MAX_BYTES + 1), 'size'],
  [file('vector.svg', 'image/svg+xml', headers.png), 'format'],
  [file('script.exe', 'image/png', headers.png), 'format'],
  [file('wrong.jpg', 'image/png', headers.png), 'format'],
  [file('wrong.png', 'image/png', headers.jpeg), 'content'],
  [file('short.webp', 'image/webp', [82, 73, 70, 70]), 'content'],
  [{ ...png(), slice() { throw new Error('private file path'); } }, 'content'],
]) assert.deepEqual(await inspectAdminImageFile(candidate), { ok: false, code });
const revokedProxy = Proxy.revocable({}, {});
revokedProxy.revoke();
assert.equal((await inspectAdminImageFile(revokedProxy.proxy)).ok, false);

const ui = harness();
assert.equal(ui.input.accept, '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp');
assert.equal(ui.status.attributes.get('role'), 'status');
assert.equal(ui.status.attributes.get('aria-live'), 'polite');
assert.equal(ui.input.disabled, true, 'Inactive fixture begins disabled until explicitly authorized');
assert.equal(await ui.view.selectFile(png()), false);
ui.view.setAuthorization(true, USER_A);
assert.deepEqual(ui.view.getSelection(), { mode: 'url', imageUrl: '' });
ui.manual.value = 'https://example.com/recipe.png';
assert.deepEqual(ui.view.getSelection(), { mode: 'url', imageUrl: 'https://example.com/recipe.png' });
ui.view.switchMode('file');
assert.equal(find(ui.view.element, (node) => node.children?.includes(ui.manual)).hidden, true);
assert.equal(ui.view.getSelection(), null);
assert.equal(await ui.view.selectFile(jpeg()), true);
assert.equal(ui.preview.hidden, false);
assert.equal(ui.preview.src, 'blob:admin-image-1');
assert.equal(ui.filename.textContent, 'meal.JPG');
assert.match(ui.status.textContent, /not been uploaded or saved/);
assert.equal(ui.view.getSelection().file.name, 'meal.JPG');
assert.equal(ui.view.setAuthorization(true, USER_A.toUpperCase()), true);
assert.equal(ui.view.getSelection().file.name, 'meal.JPG', 'Same-account refresh preserves the selected file');
assert.deepEqual([...ui.active], ['blob:admin-image-1'], 'Same-account refresh retains the local preview');
ui.change.click();
assert.equal(ui.input.clicks, 1, 'Change opens the native picker');
ui.input.files = [];
ui.input.emit('change');
assert.equal(ui.preview.hidden, false, 'Canceling the native picker retains the selected image');
assert.equal(await ui.view.selectFile(file('<img onerror=alert(1)>.png', 'image/png', headers.png)), true);
assert.equal(ui.filename.textContent, '<img onerror=alert(1)>.png', 'Filename is assigned as text');
assert.equal(ui.preview.src, 'blob:admin-image-2');
assert.deepEqual([...ui.active], ['blob:admin-image-2']);
ui.remove.click();
assert.equal(ui.view.getSelection(), null);
assert.equal(ui.preview.hidden, true);
assert.equal(ui.active.size, 0);
assert.equal(ui.filename.textContent, '');
assert.equal(await ui.view.selectFile(webp()), true);
ui.view.switchMode('url');
assert.equal(ui.active.size, 0, 'Switching to manual URL releases the file preview');
assert.deepEqual(ui.view.getSelection(), { mode: 'url', imageUrl: 'https://example.com/recipe.png' });
ui.view.cancel();
assert.equal(ui.manual.value, '');
ui.view.destroy();
assert.equal(ui.view.getSelection(), null);
assert.equal(ui.view.destroy(), false);

const identity = harness();
assert.equal(identity.view.setAuthorization(true), false, 'An authorized flag without an identity is rejected');
assert.equal(identity.view.setAuthorization(true, 'not-a-user-id'), false);
assert.equal(identity.input.disabled, true);
assert.equal(identity.view.getSelection(), null);
assert.equal(identity.view.setAuthorization(true, USER_A), true);
identity.view.switchMode('file');
assert.equal(await identity.view.selectFile(jpeg()), true);
assert.equal(identity.view.setAuthorization(true, USER_B), true, 'Direct authorized account switch is accepted as a new lifecycle');
assert.equal(identity.active.size, 0, 'Account switch revokes the prior object URL');
assert.equal(identity.preview.hidden, true);
assert.equal(identity.view.getSelection().mode, 'url', 'Account switch resets the selection mode');
identity.view.switchMode('file');
assert.equal(await identity.view.selectFile(png()), true);
assert.equal(identity.view.setAuthorization(true, ''), false, 'Invalid replacement identity fails closed');
assert.equal(identity.active.size, 0, 'Invalid identity revokes the current preview');
assert.equal(identity.view.getSelection(), null);
assert.equal(identity.input.disabled, true);
identity.view.destroy();

const dimensions = harness(async () => ({ width: 4097, height: 50 }));
dimensions.view.setAuthorization(true, USER_A);
dimensions.view.switchMode('file');
assert.equal(await dimensions.view.selectFile(png()), false);
assert.equal(dimensions.active.size, 0);
assert.match(dimensions.status.textContent, /4096/);
assert.equal(dimensions.view.getSelection(), null);
const maximumDimensions = harness(async () => ({ width: 4096, height: 4096 }));
maximumDimensions.view.setAuthorization(true, USER_A);
maximumDimensions.view.switchMode('file');
assert.equal(await maximumDimensions.view.selectFile(png()), true);
maximumDimensions.view.destroy();
assert.equal(maximumDimensions.active.size, 0);
const invalidDimensions = harness(async () => ({ width: 0, height: 100 }));
invalidDimensions.view.setAuthorization(true, USER_A);
invalidDimensions.view.switchMode('file');
assert.equal(await invalidDimensions.view.selectFile(png()), false);
assert.equal(invalidDimensions.active.size, 0);
const undecodable = harness(async () => { throw new Error('private source data'); });
undecodable.view.setAuthorization(true, USER_A);
undecodable.view.switchMode('file');
assert.equal(await undecodable.view.selectFile(png()), false);
assert.equal(undecodable.active.size, 0);
assert.doesNotMatch(undecodable.status.textContent, /private source data/);

const oldDecode = deferred();
let decoderCalls = 0;
const race = harness(() => (++decoderCalls === 1 ? oldDecode.promise : Promise.resolve({ width: 200, height: 200 })));
race.view.setAuthorization(true, USER_A);
race.view.switchMode('file');
const first = race.view.selectFile(jpeg());
await new Promise((resolve) => setImmediate(resolve));
assert.equal(race.active.size, 1);
const second = race.view.selectFile(png());
assert.equal(await second, true);
oldDecode.resolve({ width: 100, height: 100 });
assert.equal(await first, false);
assert.equal(race.preview.src, 'blob:admin-image-2');
assert.equal(race.view.getSelection().file.name, 'meal.png');
assert.deepEqual([...race.active], ['blob:admin-image-2']);
assert.deepEqual(race.revoked, ['blob:admin-image-1'], 'Replaced preview URL is revoked once');
race.view.setAuthorization(false);
assert.equal(race.active.size, 0);
assert.equal(race.preview.hidden, true);
assert.equal(race.view.getSelection(), null);

const slowHeader = deferred();
const oldFile = file('old.png', 'image/png', headers.png);
oldFile.slice = () => ({ arrayBuffer: () => slowHeader.promise });
const headerRace = harness();
headerRace.view.setAuthorization(true, USER_A);
headerRace.view.switchMode('file');
const oldSelection = headerRace.view.selectFile(oldFile);
assert.equal(await headerRace.view.selectFile(jpeg()), true);
slowHeader.resolve(Uint8Array.from(headers.png).buffer);
assert.equal(await oldSelection, false);
assert.equal(headerRace.view.getSelection().file.name, 'meal.JPG');
assert.equal(headerRace.active.size, 1, 'Old header read cannot allocate or replace a preview');
headerRace.view.destroy();

const switchingHeader = deferred();
const pendingHeaderFile = file('old.png', 'image/png', headers.png);
pendingHeaderFile.slice = () => ({ arrayBuffer: () => switchingHeader.promise });
const headerAccount = harness();
headerAccount.view.setAuthorization(true, USER_A);
headerAccount.view.switchMode('file');
const pendingHeaderSelection = headerAccount.view.selectFile(pendingHeaderFile);
headerAccount.view.setAuthorization(true, USER_B);
switchingHeader.resolve(Uint8Array.from(headers.png).buffer);
assert.equal(await pendingHeaderSelection, false);
assert.equal(headerAccount.active.size, 0);
assert.equal(headerAccount.view.getSelection().mode, 'url');
headerAccount.view.destroy();

const switchingDecode = deferred();
const decodeAccount = harness(() => switchingDecode.promise);
decodeAccount.view.setAuthorization(true, USER_A);
decodeAccount.view.switchMode('file');
const pendingDecodeSelection = decodeAccount.view.selectFile(jpeg());
await new Promise((resolve) => setImmediate(resolve));
assert.equal(decodeAccount.active.size, 1);
decodeAccount.view.setAuthorization(true, USER_A);
assert.equal(decodeAccount.active.size, 1, 'Same-account refresh leaves pending validation intact');
decodeAccount.view.setAuthorization(true, USER_B);
assert.equal(decodeAccount.active.size, 0, 'Account switch aborts and revokes pending preview');
switchingDecode.resolve({ width: 100, height: 100 });
assert.equal(await pendingDecodeSelection, false);
assert.equal(decodeAccount.view.getSelection().mode, 'url');
assert.equal(decodeAccount.preview.hidden, true);
decodeAccount.view.destroy();

const pending = deferred();
const canceled = harness(() => pending.promise);
canceled.view.setAuthorization(true, USER_A);
canceled.view.switchMode('file');
const selecting = canceled.view.selectFile(jpeg());
await new Promise((resolve) => setImmediate(resolve));
canceled.view.cancel();
pending.resolve({ width: 100, height: 100 });
assert.equal(await selecting, false);
assert.equal(canceled.active.size, 0);
assert.equal(canceled.preview.hidden, true);
canceled.view.destroy();

const lostAuthDecode = deferred();
const lostAuth = harness(() => lostAuthDecode.promise);
lostAuth.view.setAuthorization(true, USER_A);
lostAuth.view.switchMode('file');
const unauthorizedSelection = lostAuth.view.selectFile(png());
await new Promise((resolve) => setImmediate(resolve));
lostAuth.view.setAuthorization(false);
lostAuthDecode.reject(new Error('private decoder detail'));
assert.equal(await unauthorizedSelection, false);
assert.equal(lostAuth.active.size, 0);
assert.equal(lostAuth.status.textContent, '', 'Late decoding failure cannot restore a notice after authorization loss');
lostAuth.view.destroy();

const native = harness();
native.view.setAuthorization(true, USER_A);
native.view.switchMode('file');
native.input.files = [webp()];
native.input.emit('change');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(native.view.getSelection().file.name, 'meal.webp', 'Native file-input change selects the file');
assert.equal(native.input.value, '', 'Native input clears so the same file can be reselected');
native.view.destroy();

const adminHtml = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const editorSource = await readFile(new URL('../js/admin-recipe-editor.js', import.meta.url), 'utf8');
const browserSource = await readFile(new URL('../js/admin-browser.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../admin.css', import.meta.url), 'utf8');
assert.match(adminHtml, /data-editor-field="imageUrl"/);
assert.match(editorSource, /imageUrl: elements\.imageUrl\.value/);
assert.doesNotMatch(adminHtml + editorSource + browserSource, /admin-image-selection|createObjectURL|\.storage\s*\./);
assert.doesNotMatch(await readFile(new URL('../js/admin-image-selection.js', import.meta.url), 'utf8'), /\.storage\s*\.|\.upload\s*\(|fetch\s*\(/);
assert.match(css, /\.admin-image-selection-preview\{[^}]*max-width:100%/);
assert.match(css, /\.admin-image-selection-preview\[hidden\][^{]*\{display:none\}/);
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
assert.equal(PRODUCTION_OUTPUT_FILES.includes('js/admin-image-selection.js'), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes('js/admin-image-selection.js'), false);

console.log('Inactive Admin image selection and preview foundation passed offline fake-browser checks.');
