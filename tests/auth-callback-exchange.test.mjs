import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONFIRMATION_MESSAGES,
  CONFIRMATION_STATUS,
  createPkceConfirmationController,
} from '../js/auth-callback.js';
import { createPkceCodeExchangeAdapter } from '../js/auth-callback-exchange.js';

const callback = 'http://localhost/RecipeFinder/auth-callback.html';
const fakeCode = 'offline-fake-authorization-code';
const fakeAccessToken = 'offline-fake-access-token';
const fakeRefreshToken = 'offline-fake-refresh-token';

let exchangeCalls = 0;
let receivedCode;
const exchangeAdapter = createPkceCodeExchangeAdapter({
  auth: {
    async exchangeCodeForSession(code) {
      exchangeCalls += 1;
      receivedCode = code;
      return {
        data: {
          session: {
            access_token: fakeAccessToken,
            refresh_token: fakeRefreshToken,
          },
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

for (const code of ['', ' ', ' padded-code', 'padded-code ', 'line\nbreak']) {
  assert.deepEqual(await exchangeAdapter(code), { data: null, error: true });
}
assert.equal(exchangeCalls, 1, 'Invalid codes must not reach the injected client');

for (const response of [
  null,
  undefined,
  {},
  { data: null, error: null },
  { data: {}, error: null },
  { data: { session: null }, error: null },
  { data: { session: {} }, error: null },
  { data: { session: { access_token: fakeAccessToken } }, error: null },
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
        data: { session: { access_token: fakeAccessToken, refresh_token: fakeRefreshToken } },
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
const firstProcessing = controller.process(context);
const duplicateProcessing = controller.process(context);
assert.equal(firstProcessing, duplicateProcessing, 'The controller must retain duplicate-exchange protection');
assert.deepEqual(await firstProcessing, {
  status: CONFIRMATION_STATUS.CONFIRMED,
  message: CONFIRMATION_MESSAGES.CONFIRMED,
});
assert.equal(integratedExchangeCalls, 1);
assert.equal(cleanupObservedBeforeExchange, true);
assert.deepEqual(cleanupCalls, [[null, '', '/RecipeFinder/auth-callback.html']]);

const adapterSource = await readFile(new URL('../js/auth-callback-exchange.js', import.meta.url), 'utf8');
assert.doesNotMatch(adapterSource, /console\.|localStorage|sessionStorage|\bfetch\s*\(|XMLHttpRequest|WebSocket/);
assert.doesNotMatch(adapterSource, /supabase-config|createClient|getSession|onAuthStateChange|verifyOtp|signUp|signInWithPassword/);

for (const liveModule of [
  '../js/auth-callback.js',
  '../js/auth-callback-browser.js',
  '../auth-callback.html',
]) {
  const source = await readFile(new URL(liveModule, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /auth-callback-exchange|createPkceCodeExchangeAdapter/, `${liveModule} must not activate the adapter`);
}

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
