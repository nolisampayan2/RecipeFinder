import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONFIRMATION_MESSAGES,
  CONFIRMATION_STATUS,
  createPkceConfirmationController,
  prepareAuthCallbackRequest,
} from '../js/auth-callback.js';
import { createPkceCodeExchangeAdapter } from '../js/auth-callback-exchange.js';
import {
  createCallbackConfirmationComposition,
  createManualLoginConfirmationOrchestration,
} from '../js/auth-callback-browser.js';

const callback = 'http://localhost/RecipeFinder/auth-callback.html';
const fakeCode = 'offline-fake-authorization-code';
const fakeAccessToken = 'offline-fake-access-token';
const fakeRefreshToken = 'offline-fake-refresh-token';
const confirmedUser = Object.freeze({
  id: 'offline-confirmed-user',
  email_confirmed_at: '2026-10-29T08:00:00Z',
});

function confirmedSession() {
  return {
    access_token: fakeAccessToken,
    refresh_token: fakeRefreshToken,
    user: { ...confirmedUser },
  };
}

const emptyUserArray = [];
const decoratedUserArray = Object.assign([], confirmedUser);
const decoratedUserArrayWithArbitraryProperties = Object.assign([], confirmedUser, {
  arbitraryProviderClaim: 'must-not-be-trusted',
});
const emptyDataArray = [];
const decoratedDataArray = Object.assign([], { session: confirmedSession() });
const emptySessionArray = [];
const decoratedSessionArray = Object.assign([], confirmedSession());

let exchangeCalls = 0;
let receivedCode;
const exchangeAdapter = createPkceCodeExchangeAdapter({
  auth: {
    async exchangeCodeForSession(code) {
      exchangeCalls += 1;
      receivedCode = code;
      return {
        data: {
          session: confirmedSession(),
        },
        error: null,
      };
    },
  },
});

const safeSuccess = await exchangeAdapter(fakeCode);
assert.equal(exchangeCalls, 1);
assert.equal(receivedCode, fakeCode, 'The validated code must be passed unchanged');
assert.deepEqual(safeSuccess, { data: { confirmed: true }, error: null });
assert.equal(JSON.stringify(safeSuccess).includes(fakeAccessToken), false);
assert.equal(JSON.stringify(safeSuccess).includes(fakeRefreshToken), false);
assert.equal(JSON.stringify(safeSuccess).includes('session'), false);

for (const code of ['', ' ', ' padded-code', 'padded-code ', 'line\nbreak', 'x'.repeat(4097)]) {
  assert.deepEqual(await exchangeAdapter(code), { data: null, error: true });
}
assert.equal(exchangeCalls, 1, 'Invalid codes must not reach the injected client');

for (const response of [
  null,
  undefined,
  false,
  'malformed-response',
  [],
  {},
  { data: null, error: null },
  { data: undefined, error: null },
  { data: false, error: null },
  { data: 'malformed-data', error: null },
  { data: emptyDataArray, error: null },
  { data: decoratedDataArray, error: null },
  { data: {}, error: null },
  { data: { session: null }, error: null },
  { data: { session: undefined }, error: null },
  { data: { session: false }, error: null },
  { data: { session: 'malformed-session' }, error: null },
  { data: { session: emptySessionArray }, error: null },
  { data: { session: decoratedSessionArray }, error: null },
  { data: { session: {} }, error: null },
  { data: { session: { access_token: fakeAccessToken } }, error: null },
  { data: { session: confirmedSession() } },
  { data: { session: confirmedSession() }, error: undefined },
  { data: { session: { ...confirmedSession(), access_token: '   ' } }, error: null },
  { data: { session: { ...confirmedSession(), refresh_token: '   ' } }, error: null },
  { data: { session: { ...confirmedSession(), user: { ...confirmedUser, id: '   ' } } }, error: null },
  { data: { session: { ...confirmedSession(), user: null } }, error: null },
  { data: { session: { ...confirmedSession(), user: emptyUserArray } }, error: null },
  { data: { session: { ...confirmedSession(), user: decoratedUserArray } }, error: null },
  { data: { session: { ...confirmedSession(), user: decoratedUserArrayWithArbitraryProperties } }, error: null },
  { data: { session: { ...confirmedSession(), user: { id: 'missing-confirmation' } } }, error: null },
  { data: { session: { ...confirmedSession(), user: { id: 'generic-only', confirmed_at: '2026-10-29T08:00:00Z' } } }, error: null },
  { data: { session: { ...confirmedSession(), user: { id: 'metadata-only', raw_user_meta_data: { email_confirmed_at: '2026-10-29T08:00:00Z' } } } }, error: null },
  { data: { session: { ...confirmedSession(), user: { id: 'invalid-confirmation', email_confirmed_at: '2026-02-29T00:00:00Z' } } }, error: null },
  { data: { session: {} }, error: new Error('raw provider error') },
]) {
  const adapter = createPkceCodeExchangeAdapter({
    auth: { exchangeCodeForSession: async () => response },
  });
  assert.deepEqual(await adapter(fakeCode), { data: null, error: true });
}

const throwingAdapter = createPkceCodeExchangeAdapter({
  auth: {
    exchangeCodeForSession: async () => {
      throw new Error('raw provider failure with sensitive detail');
    },
  },
});
assert.deepEqual(await throwingAdapter(fakeCode), { data: null, error: true });
assert.throws(() => createPkceCodeExchangeAdapter(), /client is required/i);
assert.throws(() => createPkceCodeExchangeAdapter({}), /client is required/i);
assert.throws(() => createPkceCodeExchangeAdapter({ auth: {} }), /client is required/i);

const cleanupCalls = [];
let integratedExchangeCalls = 0;
let cleanupObservedBeforeExchange = false;
const integratedAdapter = createPkceCodeExchangeAdapter({
  auth: {
    async exchangeCodeForSession(code) {
      integratedExchangeCalls += 1;
      cleanupObservedBeforeExchange = cleanupCalls.length === 1;
      assert.equal(code, fakeCode);
      return {
        data: { session: confirmedSession() },
        error: null,
      };
    },
  },
});
const controller = createPkceConfirmationController({
  exchangeAuthorizationCode: integratedAdapter,
});
const context = {
  location: {
    href: `${callback}?code=${fakeCode}`,
    pathname: '/RecipeFinder/auth-callback.html',
    search: `?code=${fakeCode}`,
    hash: '',
  },
  history: { replaceState: (...args) => cleanupCalls.push(args) },
};
const integratedPreparedCallback = prepareAuthCallbackRequest(context.location, context.history);
const firstProcessing = controller.process({ preparedCallback: integratedPreparedCallback });
const duplicateProcessing = controller.process({ preparedCallback: integratedPreparedCallback });
assert.equal(firstProcessing, duplicateProcessing, 'The controller must retain duplicate-exchange protection');
assert.deepEqual(await firstProcessing, {
  status: CONFIRMATION_STATUS.CONFIRMED,
  message: CONFIRMATION_MESSAGES.CONFIRMED,
});
assert.equal(integratedExchangeCalls, 1);
assert.equal(cleanupObservedBeforeExchange, true);
assert.deepEqual(cleanupCalls, [[null, '', '/RecipeFinder/auth-callback.html']]);

const orchestrationEvents = [];
const orchestrationPreparedCallback = prepareAuthCallbackRequest({
  href: `${callback}?code=${fakeCode}`,
  pathname: '/RecipeFinder/auth-callback.html',
  search: `?code=${fakeCode}`,
  hash: '',
}, {
  replaceState() { orchestrationEvents.push('cleaned'); },
});
let signOutCalls = 0;
const manualLoginOrchestration = createManualLoginConfirmationOrchestration({
  client: {
    auth: {
      async exchangeCodeForSession(code) {
        orchestrationEvents.push('exchanged');
        assert.equal(code, fakeCode);
        return {
          data: { session: confirmedSession() },
          error: null,
        };
      },
      async signOut(options) {
        signOutCalls += 1;
        orchestrationEvents.push('signed-out');
        assert.deepEqual(options, { scope: 'local' });
        return { error: null };
      },
    },
  },
  preparedCallback: orchestrationPreparedCallback,
});
const firstActivation = manualLoginOrchestration.activate();
const duplicateActivation = manualLoginOrchestration.activate();
assert.equal(firstActivation, duplicateActivation, 'Orchestration activation must reuse one promise');
assert.deepEqual(await firstActivation, {
  status: CONFIRMATION_STATUS.CONFIRMED,
  message: CONFIRMATION_MESSAGES.CONFIRMED,
});
assert.deepEqual(orchestrationEvents, ['cleaned', 'exchanged', 'signed-out']);
assert.equal(signOutCalls, 1);

let exchangeFailureSignOutCalls = 0;
const exchangeFailureOrchestration = createManualLoginConfirmationOrchestration({
  client: {
    auth: {
      exchangeCodeForSession: async () => ({ data: null, error: true }),
      signOut: async () => {
        exchangeFailureSignOutCalls += 1;
        return { error: null };
      },
    },
  },
  preparedCallback: orchestrationPreparedCallback,
});
assert.deepEqual(await exchangeFailureOrchestration.activate(), {
  status: CONFIRMATION_STATUS.UNAVAILABLE,
  message: CONFIRMATION_MESSAGES.UNAVAILABLE,
});
assert.equal(exchangeFailureSignOutCalls, 0, 'A failed exchange must not attempt session cleanup');

const invalidSignOutResults = [null, undefined, {}, { error: undefined }, { error: true }];
for (const signOutResult of invalidSignOutResults) {
  const orchestration = createManualLoginConfirmationOrchestration({
    client: {
      auth: {
        exchangeCodeForSession: async () => ({ data: { session: confirmedSession() }, error: null }),
        signOut: async () => signOutResult,
      },
    },
    preparedCallback: orchestrationPreparedCallback,
  });
  assert.deepEqual(await orchestration.activate(), {
    status: CONFIRMATION_STATUS.UNAVAILABLE,
    message: CONFIRMATION_MESSAGES.UNAVAILABLE,
  }, 'Local sign-out success requires an explicit own error property equal to null');
}

for (const failingClient of [
  null,
  { auth: {} },
  { auth: { exchangeCodeForSession: async () => ({ data: null, error: true }) } },
  {
    auth: {
      exchangeCodeForSession: async () => ({
        data: { session: confirmedSession() },
        error: null,
      }),
      signOut: async () => ({ error: new Error('offline sign-out failure') }),
    },
  },
  {
    auth: {
      exchangeCodeForSession: async () => ({
        data: { session: confirmedSession() },
        error: null,
      }),
      signOut: async () => { throw new Error('offline sign-out exception'); },
    },
  },
  {
    auth: {
      exchangeCodeForSession: async () => ({ data: { session: confirmedSession() }, error: null }),
      signOut() { throw new Error('offline synchronous sign-out exception'); },
    },
  },
]) {
  const orchestration = createManualLoginConfirmationOrchestration({
    client: failingClient,
    preparedCallback: orchestrationPreparedCallback,
  });
  assert.deepEqual(await orchestration.activate(), {
    status: CONFIRMATION_STATUS.UNAVAILABLE,
    message: CONFIRMATION_MESSAGES.UNAVAILABLE,
  });
}

let compositionTakeCalls = 0;
let compositionClientInitializations = 0;
let compositionExchangeCalls = 0;
let compositionSignOutCalls = 0;
const compositionRenders = [];
const callbackComposition = createCallbackConfirmationComposition({
  takePreparedCallback() {
    compositionTakeCalls += 1;
    return orchestrationPreparedCallback;
  },
  clientInitialization: {
    initialize() {
      compositionClientInitializations += 1;
      return {
        auth: {
          async exchangeCodeForSession() {
            compositionExchangeCalls += 1;
            return { data: { session: confirmedSession() }, error: null };
          },
          async signOut(options) {
            compositionSignOutCalls += 1;
            assert.deepEqual(options, { scope: 'local' });
            return { error: null };
          },
        },
      };
    },
  },
  root: {},
  createView: (result) => result,
  renderView: (_root, view) => compositionRenders.push(view),
});
assert.equal(compositionTakeCalls, 0, 'Composition construction must not consume the callback');
assert.equal(compositionClientInitializations, 0, 'Composition construction must not initialize the client');
assert.equal(compositionExchangeCalls, 0, 'Composition construction must not exchange a code');
const firstCompositionActivation = callbackComposition.activate();
const duplicateCompositionActivation = callbackComposition.activate();
assert.equal(firstCompositionActivation, duplicateCompositionActivation, 'Duplicate activation must reuse one promise');
assert.deepEqual(await firstCompositionActivation, {
  status: CONFIRMATION_STATUS.CONFIRMED,
  message: CONFIRMATION_MESSAGES.CONFIRMED,
});
assert.equal(compositionTakeCalls, 1, 'The prepared callback must be consumed once');
assert.equal(compositionClientInitializations, 1, 'The callback client must initialize once');
assert.equal(compositionExchangeCalls, 1, 'The authorization code must be exchanged once');
assert.equal(compositionSignOutCalls, 1, 'The temporary session must be signed out once');
assert.equal(compositionRenders.length, 1);
assert.equal(callbackComposition.cleanup(), true);
assert.equal(callbackComposition.cleanup(), false, 'Cleanup must be idempotent');

function deferredResult() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

for (const lateStatus of [CONFIRMATION_STATUS.CONFIRMED, CONFIRMATION_STATUS.UNAVAILABLE]) {
  const pendingResult = deferredResult();
  const renders = [];
  let takeCalls = 0;
  const composition = createCallbackConfirmationComposition({
    takePreparedCallback() {
      takeCalls += 1;
      return orchestrationPreparedCallback;
    },
    clientInitialization: { initialize: () => ({ auth: {} }) },
    createOrchestration: () => ({ activate: () => pendingResult.promise }),
    root: {},
    createView: (result) => result,
    renderView: (_root, view) => renders.push(view),
  });
  const activation = composition.activate();
  assert.equal(composition.cleanup(), true);
  pendingResult.resolve({
    status: lateStatus,
    message: lateStatus === CONFIRMATION_STATUS.CONFIRMED
      ? CONFIRMATION_MESSAGES.CONFIRMED
      : CONFIRMATION_MESSAGES.UNAVAILABLE,
  });
  await activation;
  assert.equal(takeCalls, 1);
  assert.deepEqual(renders, [], `Late ${lateStatus} must not render after cleanup`);
}

let missingDependencyClientCalls = 0;
const missingDependencyComposition = createCallbackConfirmationComposition({
  clientInitialization: { initialize() { missingDependencyClientCalls += 1; } },
});
assert.deepEqual(await missingDependencyComposition.activate(), {
  status: CONFIRMATION_STATUS.UNAVAILABLE,
  message: CONFIRMATION_MESSAGES.UNAVAILABLE,
});
assert.equal(missingDependencyClientCalls, 0, 'Missing UI dependencies must fail before client initialization');

const adapterSource = await readFile(new URL('../js/auth-callback-exchange.js', import.meta.url), 'utf8');
assert.doesNotMatch(adapterSource, /console\.|localStorage|sessionStorage|\bfetch\s*\(|XMLHttpRequest|WebSocket/);
assert.doesNotMatch(adapterSource, /supabase-config|createClient|getSession|onAuthStateChange|verifyOtp|signUp|signInWithPassword/);

for (const liveModule of [
  '../js/auth-callback.js',
  '../auth-callback.html',
]) {
  const source = await readFile(new URL(liveModule, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /auth-callback-exchange|createPkceCodeExchangeAdapter/, `${liveModule} must not activate the adapter`);
}

const callbackBrowserSource = await readFile(new URL('../js/auth-callback-browser.js', import.meta.url), 'utf8');
assert.equal(
  callbackBrowserSource.match(/createManualLoginConfirmationOrchestration\s*\(/g)?.length,
  1,
  'The manual-login orchestration must be declared but never invoked by page load'
);
assert.equal(
  callbackBrowserSource.match(/createCallbackConfirmationComposition\s*\(/g)?.length,
  1,
  'The callback lifecycle composition must be declared but never invoked by page load'
);

const combinedSafeOutput = JSON.stringify({
  safeSuccess,
  confirmation: {
    status: CONFIRMATION_STATUS.CONFIRMED,
    message: CONFIRMATION_MESSAGES.CONFIRMED,
  },
});
assert.equal(combinedSafeOutput.includes(fakeCode), false);
assert.equal(combinedSafeOutput.includes(fakeAccessToken), false);
assert.equal(combinedSafeOutput.includes(fakeRefreshToken), false);
assert.doesNotMatch(combinedSafeOutput, /verifier|raw provider/i);

console.log('Offline PKCE confirmation exchange adapter tests passed with fake clients only.');
