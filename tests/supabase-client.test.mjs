import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SUPABASE_SDK_VERSION,
  SUPABASE_CLIENT_PROFILE,
  SUPABASE_UMD_URL,
  SUPABASE_UMD_INTEGRITY,
  PKCE_STORAGE_REQUIREMENT,
  SupabaseConfigurationError,
  createSupabaseClientInitializer,
  getSupabaseClientOptions,
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
assert.equal(
  SUPABASE_UMD_INTEGRITY,
  'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK'
);
assert.match(PKCE_STORAGE_REQUIREMENT, /persistent browser storage/i);
assert.match(PKCE_STORAGE_REQUIREMENT, /resulting session/i);
assert.deepEqual(getSupabaseClientOptions(), {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
assert.deepEqual(getSupabaseClientOptions(SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION), {
  auth: {
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: 'pkce',
    skipAutoInitialize: true,
  },
});
assert.equal('storage' in getSupabaseClientOptions(SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION).auth, false);
assert.deepEqual(getSupabaseClientOptions(SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION), {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
    skipAutoInitialize: true,
  },
});
assert.throws(() => getSupabaseClientOptions('unknown'), SupabaseConfigurationError);

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
const receivedOptions = [];
const fakeClient = Object.freeze({ kind: 'offline-test-client' });
const fakeSdk = {
  createClient(url, key, options) {
    createClientCalls += 1;
    assert.equal(url, validConfig.url);
    assert.equal(key, validConfig.publishableKey);
    receivedOptions.push(options);
    return fakeClient;
  },
};

assert.equal(createClientCalls, 0, 'Importing the adapter must not initialize a client');
assert.throws(() => initializeSupabaseClient(validConfig, null), /is not loaded/);
assert.equal(createClientCalls, 0, 'Invalid SDK input must not initialize a client');
assert.equal(initializeSupabaseClient(validConfig, fakeSdk), fakeClient);
assert.equal(createClientCalls, 1, 'Explicit initialization should create exactly one client');
assert.deepEqual(receivedOptions[0], getSupabaseClientOptions());

assert.equal(
  initializeSupabaseClient(validConfig, fakeSdk, SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION),
  fakeClient
);
assert.equal(createClientCalls, 2, 'The PKCE profile must still require explicit initialization');
assert.deepEqual(receivedOptions[1], getSupabaseClientOptions(SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION));

const applicationInitializer = createSupabaseClientInitializer({
  config: validConfig,
  sdk: fakeSdk,
  profile: SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION,
});
assert.equal(createClientCalls, 2, 'Creating an initializer must remain inert');
assert.equal(applicationInitializer.initialize(), fakeClient);
assert.equal(applicationInitializer.initialize(), fakeClient);
assert.equal(createClientCalls, 3, 'One initializer context must create only one application client');
assert.deepEqual(receivedOptions[2], getSupabaseClientOptions(SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION));

const adapterSource = await readFile(new URL('../js/supabase-client.js', import.meta.url), 'utf8');
assert.doesNotMatch(adapterSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|import\s*\(\s*['"]https?:/i);
assert.doesNotMatch(adapterSource, /\.innerHTML\s*=|insertAdjacentHTML|document\.write/i);

const exampleSource = await readFile(new URL('../js/supabase-config.example.js', import.meta.url), 'utf8');
assert.match(exampleSource, /YOUR_PROJECT_REF/);
assert.match(exampleSource, /YOUR_SUPABASE_PUBLISHABLE_KEY/);
assert.doesNotMatch(exampleSource, /sb_secret_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{10,}|postgres(?:ql)?:\/\//i);

console.log('Supabase client foundation tests passed without network access.');
