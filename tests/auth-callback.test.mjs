import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  callbackView,
  classifyAuthCallback,
  cleanCallbackUrl,
  initializeAuthCallback,
  renderCallbackView,
} from '../js/auth-callback.js';

const callback = 'http://localhost/RecipeFinder/auth-callback.html';
const secret = 'sensitive-test-value';

assert.deepEqual(classifyAuthCallback(`${callback}?code=${secret}`), { kind: 'pkce' });
assert.deepEqual(classifyAuthCallback(callback), { kind: 'none' });
assert.deepEqual(classifyAuthCallback(`${callback}?code=`), { kind: 'invalid' });
assert.deepEqual(classifyAuthCallback(`${callback}?code=one&code=two`), { kind: 'invalid' });
assert.deepEqual(classifyAuthCallback(`${callback}?code=${secret}&token_hash=${secret}&type=email`), { kind: 'invalid' });
assert.deepEqual(classifyAuthCallback(`${callback}?error=access_denied&error_description=${secret}`), { kind: 'provider-error' });
assert.deepEqual(classifyAuthCallback(`${callback}#error=access_denied&error_description=${secret}`), { kind: 'provider-error' });
assert.deepEqual(classifyAuthCallback(`${callback}#access_token=${secret}&refresh_token=${secret}`), { kind: 'token-fragment' });
assert.deepEqual(classifyAuthCallback(`${callback}#access_token=${secret}`), { kind: 'invalid' });
assert.deepEqual(classifyAuthCallback(`${callback}?token_hash=${secret}&type=email`), { kind: 'token-hash' });
assert.deepEqual(classifyAuthCallback(`${callback}?token_hash=${secret}&type=signup`), { kind: 'invalid' });

const replacements = [];
assert.equal(
  cleanCallbackUrl(
    { pathname: '/RecipeFinder/auth-callback.html', search: `?code=${secret}`, hash: `#access_token=${secret}` },
    { replaceState: (...args) => replacements.push(args) }
  ),
  true
);
assert.deepEqual(replacements, [[null, '', '/RecipeFinder/auth-callback.html']]);
assert.equal(JSON.stringify(replacements).includes(secret), false, 'URL cleanup must not retain callback secrets');

function textNode() {
  return { textContent: '' };
}
const nodes = new Map([
  ['[data-callback-icon]', textNode()],
  ['[data-callback-kicker]', textNode()],
  ['[data-callback-title]', textNode()],
  ['[data-callback-message]', textNode()],
]);
const fakeRoot = { querySelector: (selector) => nodes.get(selector) || null };
const unavailable = callbackView('pkce');
assert.equal(renderCallbackView(fakeRoot, unavailable), true);
assert.equal(nodes.get('[data-callback-title]').textContent, 'Confirmation unavailable');
assert.equal([...nodes.values()].some((node) => /verified|successful/i.test(node.textContent)), false);
assert.equal([...nodes.values()].some((node) => node.textContent.includes(secret)), false);

const invalid = callbackView('provider-error');
assert.equal(invalid.title, 'Invalid or expired link');
assert.equal(JSON.stringify(invalid).includes(secret), false);

const initializationReplacements = [];
const fakeDocument = { querySelector: (selector) => nodes.get(selector) || null };
const initializationOptions = {
  location: {
    href: `${callback}?code=${secret}&next=https%3A%2F%2Fevil.example`,
    pathname: '/RecipeFinder/auth-callback.html',
    search: `?code=${secret}&next=https%3A%2F%2Fevil.example`,
    hash: '',
  },
  history: { replaceState: (...args) => initializationReplacements.push(args) },
  document: fakeDocument,
};
assert.equal(initializeAuthCallback(initializationOptions), true);
assert.equal(initializeAuthCallback(initializationOptions), false, 'Callback initialization must run only once');
assert.deepEqual(initializationReplacements, [[null, '', '/RecipeFinder/auth-callback.html']]);
assert.equal(JSON.stringify(initializationReplacements).includes('evil.example'), false, 'Unsafe return destinations must be discarded');

const source = await readFile(new URL('../js/auth-callback.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /exchangeCodeForSession|verifyOtp|setSession|signUp|signIn|\bfetch\s*\(|XMLHttpRequest|WebSocket/i);
assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|\.innerHTML\s*=|insertAdjacentHTML|document\.write/i);

const html = await readFile(new URL('../auth-callback.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /supabase-js|cdn\.jsdelivr|Email Verified|Authentication Successful/i);
assert.match(html, /href="login\.html"/);
assert.match(html, /href="register\.html"/);
assert.match(html, /href="index\.html"/);
assert.match(html, /name="referrer" content="no-referrer"/);

console.log('Offline auth callback tests passed without network or authentication side effects.');
