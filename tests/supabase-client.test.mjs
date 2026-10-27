import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SUPABASE_SDK_VERSION,
  SUPABASE_UMD_URL,
  SupabaseConfigurationError,
  initializeSupabaseClient,
  validateSupabaseConfig,
} from '../js/supabase-client.js';

const validConfig = Object.freeze({
  url: 'https://recipefinder-test.supabase.co',
  publishableKey: 'sb_publishable_test_abcdefghijklmnopqrstuvwxyz',
});

assert.equal(SUPABASE_SDK_VERSION, '2.118.0');
assert.equal(
  SUPABASE_UMD_URL,
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js'
);

assert.deepEqual(validateSupabaseConfig(validConfig), validConfig);
assert.throws(() => validateSupabaseConfig(), SupabaseConfigurationError);
assert.throws(() => validateSupabaseConfig({}), SupabaseConfigurationError);
assert.throws(
  () => validateSupabaseConfig({ ...validConfig, url: 'http://recipefinder-test.supabase.co' }),
  /HTTPS origin/
);
assert.throws(
  () => validateSupabaseConfig({ ...validConfig, url: 'https://recipefinder-test.supabase.co/rest/v1' }),
  /HTTPS origin/
);
assert.throws(
  () => validateSupabaseConfig({ ...validConfig, url: 'https://YOUR_PROJECT_REF.supabase.co' }),
  /missing or malformed/
);
assert.throws(
  () => validateSupabaseConfig({ ...validConfig, publishableKey: 'YOUR_SUPABASE_PUBLISHABLE_KEY' }),
  /missing or malformed/
);
assert.throws(
  () => validateSupabaseConfig({ ...validConfig, publishableKey: ['sb', 'secret', 'forbidden-browser-key'].join('_') }),
  /forbidden/
);
assert.throws(
  () => validateSupabaseConfig({ ...validConfig, publishableKey: 'service_role_forbidden_browser_key' }),
  /forbidden/
);
const privilegedJwtPayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
assert.throws(
  () => validateSupabaseConfig({ ...validConfig, publishableKey: `header.${privilegedJwtPayload}.signature-value` }),
  /forbidden/
);

let createClientCalls = 0;
const fakeClient = Object.freeze({ kind: 'offline-test-client' });
const fakeSdk = {
  createClient(url, key, options) {
    createClientCalls += 1;
    assert.equal(url, validConfig.url);
    assert.equal(key, validConfig.publishableKey);
    assert.deepEqual(options, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    return fakeClient;
  },
};

assert.equal(createClientCalls, 0, 'Importing the adapter must not initialize a client');
assert.throws(() => initializeSupabaseClient(validConfig, null), /is not loaded/);
assert.equal(createClientCalls, 0, 'Invalid SDK input must not initialize a client');
assert.equal(initializeSupabaseClient(validConfig, fakeSdk), fakeClient);
assert.equal(createClientCalls, 1, 'Explicit initialization should create exactly one client');

const adapterSource = await readFile(new URL('../js/supabase-client.js', import.meta.url), 'utf8');
assert.doesNotMatch(adapterSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|import\s*\(\s*['"]https?:/i);
assert.doesNotMatch(adapterSource, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/i);

const exampleSource = await readFile(new URL('../js/supabase-config.example.js', import.meta.url), 'utf8');
assert.match(exampleSource, /YOUR_PROJECT_REF/);
assert.match(exampleSource, /YOUR_SUPABASE_PUBLISHABLE_KEY/);
assert.doesNotMatch(exampleSource, /sb_secret_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{10,}|postgres(?:ql)?:\/\//i);

console.log('Supabase client foundation tests passed without network access.');
