import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createPkceBrowserInitializer,
  createSupabasePageClientOwner,
} from '../js/supabase-browser.js';
import {
  SUPABASE_CLIENT_PROFILE,
  getSupabaseClientOptions,
} from '../js/supabase-client.js';

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

let authSubscriptionCalls = 0;
let signInCalls = 0;
let signOutCalls = 0;
const sharedClient = Object.freeze({
  auth: Object.freeze({
    onAuthStateChange() { authSubscriptionCalls += 1; },
    signInWithPassword() { signInCalls += 1; },
    signOut() { signOutCalls += 1; },
  }),
});
let sharedClientCreations = 0;
const sharedSdk = Object.freeze({
  createClient(url, key, options) {
    sharedClientCreations += 1;
    assert.equal(url, validConfig.url);
    assert.equal(key, validConfig.publishableKey);
    assert.deepEqual(options, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        skipAutoInitialize: true,
      },
    });
    return sharedClient;
  },
});

const pageOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: sharedSdk,
  profile: SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION,
});
assert.equal(pageOwner.profile, SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
assert.equal(sharedClientCreations, 0, 'Constructing a page owner must remain lazy');
const consumerA = () => pageOwner.initialize();
const consumerB = () => pageOwner.initialize(SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
assert.equal(consumerA(), sharedClient);
assert.equal(consumerB(), sharedClient);
assert.equal(pageOwner.initialize(), sharedClient);
assert.equal(sharedClientCreations, 1, 'All consumers of one page owner must share one client');
assert.deepEqual(
  { authSubscriptionCalls, signInCalls, signOutCalls },
  { authSubscriptionCalls: 0, signInCalls: 0, signOutCalls: 0 },
  'Client ownership must not start Auth work'
);

assert.throws(
  () => pageOwner.initialize(SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION),
  /cannot change profiles/i
);
assert.equal(sharedClientCreations, 1, 'A conflicting profile must not replace the existing client');

for (const profile of Object.values(SUPABASE_CLIENT_PROFILE)) {
  let profileCreations = 0;
  const profileClient = Object.freeze({ profile, auth: Object.freeze({}) });
  const owner = createSupabasePageClientOwner({
    config: validConfig,
    profile,
    sdk: {
      createClient(_url, _key, options) {
        profileCreations += 1;
        assert.deepEqual(options, getSupabaseClientOptions(profile));
        return profileClient;
      },
    },
  });
  assert.equal(owner.profile, profile);
  assert.equal(owner.initialize(), profileClient);
  assert.equal(owner.initialize(), profileClient);
  assert.equal(profileCreations, 1);
}
assert.throws(
  () => createSupabasePageClientOwner({ config: validConfig, sdk: sharedSdk, profile: 'unknown' }),
  /unknown supabase client profile/i
);

assert.throws(
  () => createSupabasePageClientOwner({ sdk: sharedSdk }).initialize(),
  /configuration is missing/i
);
assert.throws(
  () => createSupabasePageClientOwner({
    config: { ...validConfig, publishableKey: 'service_role_forbidden_browser_key' },
    sdk: sharedSdk,
  }).initialize(),
  /forbidden/i
);

let initializationAttempts = 0;
const retryClient = Object.freeze({ auth: Object.freeze({}) });
const retryOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: {
    createClient() {
      initializationAttempts += 1;
      if (initializationAttempts === 1) throw new Error('private sdk credential detail');
      return retryClient;
    },
  },
});
assert.throws(
  () => retryOwner.initialize(),
  (error) => /initialization failed/i.test(error.message)
    && !/credential|private sdk/i.test(error.message)
);
assert.equal(retryOwner.initialize(), retryClient, 'A failed attempt must be safely retryable');
assert.equal(retryOwner.initialize(), retryClient);
assert.equal(initializationAttempts, 2, 'A successful retry must become the only cached client');

let malformedAttempts = 0;
const malformedOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: { createClient() { malformedAttempts += 1; return null; } },
});
assert.throws(() => malformedOwner.initialize(), /initialization failed/i);
assert.throws(() => malformedOwner.initialize(), /initialization failed/i);
assert.equal(malformedAttempts, 2, 'Malformed results must not become cached clients');

for (const candidate of [
  undefined,
  false,
  0,
  '',
  [],
  {},
  new Date('2026-10-30T00:00:00Z'),
  { auth: null },
  { auth: false },
  { auth: [] },
]) {
  const owner = createSupabasePageClientOwner({
    config: validConfig,
    sdk: { createClient() { return candidate; } },
  });
  assert.throws(() => owner.initialize(), /initialization failed/i);
}

const promisedClientOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: { createClient() { return Promise.resolve(sharedClient); } },
});
assert.throws(() => promisedClientOwner.initialize(), /initialization failed/i);
assert.throws(() => promisedClientOwner.initialize(), /initialization failed/i);

const unhandledRejections = [];
const captureUnhandledRejection = (reason) => unhandledRejections.push(reason);
process.on('unhandledRejection', captureUnhandledRejection);
const rejectedClientPromise = Promise.reject(new Error('private rejected client detail'));
const rejectedPromiseOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: { createClient() { return rejectedClientPromise; } },
});
assert.throws(
  () => rejectedPromiseOwner.initialize(),
  (error) => /initialization failed/i.test(error.message)
    && !/private|rejected client/i.test(error.message)
);
await new Promise((resolve) => setImmediate(resolve));
process.removeListener('unhandledRejection', captureUnhandledRejection);
assert.deepEqual(unhandledRejections, [], 'Rejected native client Promises must be consumed privately');

let customThenCalls = 0;
const customThenable = {
  auth: {},
  then() { customThenCalls += 1; },
};
const customThenableOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: { createClient() { return customThenable; } },
});
assert.throws(() => customThenableOwner.initialize(), /initialization failed/i);
assert.equal(customThenCalls, 0, 'Rejecting a custom thenable must not execute its then method');

const throwingThenCandidate = { auth: {} };
Object.defineProperty(throwingThenCandidate, 'then', {
  get() { throw new Error('private then getter detail'); },
});
const throwingThenOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: { createClient() { return throwingThenCandidate; } },
});
assert.throws(
  () => throwingThenOwner.initialize(),
  (error) => /initialization failed/i.test(error.message) && !/private|getter/i.test(error.message)
);

const throwingAuthCandidate = {};
Object.defineProperty(throwingAuthCandidate, 'auth', {
  get() { throw new Error('private auth getter detail'); },
});
const throwingAuthOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: { createClient() { return throwingAuthCandidate; } },
});
assert.throws(
  () => throwingAuthOwner.initialize(),
  (error) => /initialization failed/i.test(error.message) && !/private|getter/i.test(error.message)
);

let malformedRetryCalls = 0;
const validAfterMalformed = Object.freeze({ auth: Object.freeze({}) });
const malformedRetryOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: {
    createClient() {
      malformedRetryCalls += 1;
      return malformedRetryCalls === 1 ? {} : validAfterMalformed;
    },
  },
});
assert.throws(() => malformedRetryOwner.initialize(), /initialization failed/i);
assert.equal(malformedRetryOwner.initialize(), validAfterMalformed);
assert.equal(malformedRetryOwner.initialize(), validAfterMalformed);
assert.equal(malformedRetryCalls, 2, 'A malformed candidate must not remain cached');

const throwingConfig = {};
Object.defineProperty(throwingConfig, 'url', {
  get() { throw new Error('private configuration getter detail'); },
});
assert.throws(
  () => createSupabasePageClientOwner({ config: throwingConfig, sdk: sharedSdk }).initialize(),
  (error) => /initialization failed/i.test(error.message) && !/private|getter/i.test(error.message)
);

const throwingSdk = {};
Object.defineProperty(throwingSdk, 'createClient', {
  get() { throw new Error('private sdk getter detail'); },
});
assert.throws(
  () => createSupabasePageClientOwner({ config: validConfig, sdk: throwingSdk }).initialize(),
  (error) => /initialization failed/i.test(error.message) && !/private|getter/i.test(error.message)
);

let reentrantOwner;
let reentrantConstructionCalls = 0;
let nestedInitializationError = '';
const reentrantClient = Object.freeze({ kind: 'reentrant-client', auth: Object.freeze({}) });
reentrantOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: {
    createClient() {
      reentrantConstructionCalls += 1;
      try {
        reentrantOwner.initialize();
      } catch (error) {
        nestedInitializationError = error.message;
      }
      return reentrantClient;
    },
  },
});
assert.equal(reentrantOwner.initialize(), reentrantClient);
assert.match(nestedInitializationError, /already in progress/i);
assert.equal(reentrantConstructionCalls, 1, 'Nested initialization must not construct a second client');
assert.equal(reentrantOwner.initialize(), reentrantClient);
assert.equal(reentrantConstructionCalls, 1, 'The outer accepted client must remain cached');

let failedReentrantOwner;
let failedReentrantCalls = 0;
let failedNestedError = '';
const recoveredClient = Object.freeze({ kind: 'recovered-client', auth: Object.freeze({}) });
failedReentrantOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: {
    createClient() {
      failedReentrantCalls += 1;
      if (failedReentrantCalls === 1) {
        try {
          failedReentrantOwner.initialize();
        } catch (error) {
          failedNestedError = error.message;
        }
        throw new Error('private outer construction failure');
      }
      return recoveredClient;
    },
  },
});
assert.throws(
  () => failedReentrantOwner.initialize(),
  (error) => /initialization failed/i.test(error.message)
    && !/outer construction|private/i.test(error.message)
);
assert.match(failedNestedError, /already in progress/i);
assert.equal(failedReentrantCalls, 1);
assert.equal(failedReentrantOwner.initialize(), recoveredClient, 'Guard cleanup must permit retry');
assert.equal(failedReentrantOwner.initialize(), recoveredClient);
assert.equal(failedReentrantCalls, 2);

let configReentrantOwner;
let configReentrantError = '';
let configConstructionCalls = 0;
const reentrantConfig = {
  publishableKey: validConfig.publishableKey,
};
Object.defineProperty(reentrantConfig, 'url', {
  get() {
    try {
      configReentrantOwner.initialize();
    } catch (error) {
      configReentrantError = error.message;
    }
    return validConfig.url;
  },
});
configReentrantOwner = createSupabasePageClientOwner({
  config: reentrantConfig,
  sdk: {
    createClient() {
      configConstructionCalls += 1;
      return Object.freeze({ kind: 'config-reentrant-client', auth: Object.freeze({}) });
    },
  },
});
const configReentrantClient = configReentrantOwner.initialize();
assert.match(configReentrantError, /already in progress/i);
assert.equal(configConstructionCalls, 1);
assert.equal(configReentrantOwner.initialize(), configReentrantClient);

let sdkGetterReentrantOwner;
let sdkGetterReentrantError = '';
let sdkGetterConstructionCalls = 0;
const reentrantSdkGetter = {};
Object.defineProperty(reentrantSdkGetter, 'createClient', {
  get() {
    try {
      sdkGetterReentrantOwner.initialize();
    } catch (error) {
      sdkGetterReentrantError = error.message;
    }
    return function createClient() {
      sdkGetterConstructionCalls += 1;
      return Object.freeze({ kind: 'sdk-getter-reentrant-client', auth: Object.freeze({}) });
    };
  },
});
sdkGetterReentrantOwner = createSupabasePageClientOwner({ config: validConfig, sdk: reentrantSdkGetter });
const sdkGetterReentrantClient = sdkGetterReentrantOwner.initialize();
assert.match(sdkGetterReentrantError, /already in progress/i);
assert.equal(sdkGetterConstructionCalls, 1);
assert.equal(sdkGetterReentrantOwner.initialize(), sdkGetterReentrantClient);

let conflictingReentrantOwner;
let conflictingReentrantError = '';
let conflictingConstructionCalls = 0;
const conflictingClient = Object.freeze({ kind: 'conflicting-reentrant-client', auth: Object.freeze({}) });
conflictingReentrantOwner = createSupabasePageClientOwner({
  config: validConfig,
  sdk: {
    createClient() {
      conflictingConstructionCalls += 1;
      try {
        conflictingReentrantOwner.initialize(SUPABASE_CLIENT_PROFILE.FOUNDATION);
      } catch (error) {
        conflictingReentrantError = error.message;
      }
      return conflictingClient;
    },
  },
});
assert.equal(conflictingReentrantOwner.initialize(), conflictingClient);
assert.match(conflictingReentrantError, /cannot change profiles/i);
assert.equal(conflictingConstructionCalls, 1);
assert.equal(conflictingReentrantOwner.initialize(), conflictingClient);

let independentCreations = 0;
const independentSdk = {
  createClient() {
    independentCreations += 1;
    return Object.freeze({ page: independentCreations, auth: Object.freeze({}) });
  },
};
const firstPageOwner = createSupabasePageClientOwner({ config: validConfig, sdk: independentSdk });
const secondPageOwner = createSupabasePageClientOwner({ config: validConfig, sdk: independentSdk });
assert.notEqual(firstPageOwner.initialize(), secondPageOwner.initialize());
assert.equal(independentCreations, 2, 'Independent simulated pages must own independent clients');

const initializerSource = await readFile(new URL('../js/supabase-browser.js', import.meta.url), 'utf8');
assert.doesNotMatch(
  initializerSource,
  /signUp|signInWithPassword|exchangeCodeForSession|onAuthStateChange|\bfetch\s*\(|XMLHttpRequest|WebSocket/i
);
assert.doesNotMatch(initializerSource, /localStorage|sessionStorage|console\./i);
assert.doesNotMatch(initializerSource, /document\.|window\.|location\.|addEventListener|onAuthStateChange|signInWithPassword|signOut\s*\(/i);

for (const page of ['../index.html', '../login.html', '../register.html', '../verify-email.html', '../auth-callback.html']) {
  const html = await readFile(new URL(page, import.meta.url), 'utf8');
  assert.doesNotMatch(html, /supabase-browser\.js|createPkceBrowserInitializer/i, `${page} must remain disconnected`);
}

console.log('Offline PKCE browser initializer tests passed with injected fakes only.');
