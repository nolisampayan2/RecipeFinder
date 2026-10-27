import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPkceBrowserInitializer } from '../js/supabase-browser.js';

const validConfig = Object.freeze({
  url: 'https://recipefinder-test.supabase.co',
  publishableKey: 'sb_publishable_test_abcdefghijklmnopqrstuvwxyz',
});

let createClientCalls = 0;
const fakeClient = Object.freeze({ auth: Object.freeze({}) });
const fakeSdk = Object.freeze({
  createClient(url, key, options) {
    createClientCalls += 1;
    assert.equal(url, validConfig.url);
    assert.equal(key, validConfig.publishableKey);
    assert.deepEqual(options, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'pkce',
        skipAutoInitialize: true,
      },
    });
    return fakeClient;
  },
});

const initializer = createPkceBrowserInitializer({ config: validConfig, sdk: fakeSdk });
assert.equal(createClientCalls, 0, 'Creating an initialization context must not create a client');
assert.equal(initializer.initialize(), fakeClient);
assert.equal(initializer.initialize(), fakeClient);
assert.equal(createClientCalls, 1, 'One initialization context must create at most one client');

const secondInitializer = createPkceBrowserInitializer({ config: validConfig, sdk: fakeSdk });
assert.equal(secondInitializer.initialize(), fakeClient);
assert.equal(createClientCalls, 2, 'A separate context may explicitly create its own client');

assert.throws(() => createPkceBrowserInitializer({ config: validConfig }).initialize(), /is not loaded/i);
assert.throws(() => createPkceBrowserInitializer({ sdk: fakeSdk }).initialize(), /configuration is missing/i);
assert.throws(
  () => createPkceBrowserInitializer({
    config: { ...validConfig, publishableKey: 'service_role_forbidden_browser_key' },
    sdk: fakeSdk,
  }).initialize(),
  /forbidden/i
);
assert.equal(createClientCalls, 2, 'Rejected initialization must not reach the SDK');

const initializerSource = await readFile(new URL('../js/supabase-browser.js', import.meta.url), 'utf8');
assert.doesNotMatch(
  initializerSource,
  /signUp|signInWithPassword|exchangeCodeForSession|onAuthStateChange|\bfetch\s*\(|XMLHttpRequest|WebSocket/i
);
assert.doesNotMatch(initializerSource, /localStorage|sessionStorage|console\./i);

for (const page of ['../index.html', '../login.html', '../register.html', '../verify-email.html', '../auth-callback.html']) {
  const html = await readFile(new URL(page, import.meta.url), 'utf8');
  assert.doesNotMatch(html, /supabase-browser\.js|createPkceBrowserInitializer/i, `${page} must remain disconnected`);
}

console.log('Offline PKCE browser initializer tests passed with injected fakes only.');
