import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONFIRMATION_MESSAGES,
  CONFIRMATION_STATUS,
  callbackView,
  classifyAuthCallback,
  cleanCallbackUrl,
  createPkceConfirmationController,
  initializeAuthCallback,
  renderCallbackView,
} from '../js/auth-callback.js';
import {
  CALLBACK_CLIENT_STATE,
  createCallbackClientInitialization,
  createCallbackPageInitialization,
} from '../js/auth-callback-browser.js';

const callback = 'http://localhost/RecipeFinder/auth-callback.html';
const secret = 'sensitive-test-value';
const sdkUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
const sdkIntegrity = 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';

const offlinePublicConfig = Object.freeze({
  url: 'https://recipefinder-test.supabase.co',
  publishableKey: 'sb_publishable_test_abcdefghijklmnopqrstuvwxyz',
});
let callbackClientCreations = 0;
const offlineCallbackClient = Object.freeze({ auth: Object.freeze({}) });
const offlineSdk = Object.freeze({
  createClient(url, key, options) {
    callbackClientCreations += 1;
    assert.equal(url, offlinePublicConfig.url);
    assert.equal(key, offlinePublicConfig.publishableKey);
    assert.deepEqual(options, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'pkce',
        skipAutoInitialize: true,
      },
    });
    return offlineCallbackClient;
  },
});

const callbackClientInitialization = createCallbackClientInitialization({
  config: offlinePublicConfig,
  sdk: offlineSdk,
});
assert.equal(callbackClientCreations, 0, 'Importing and preparing the callback initializer must remain inert');
assert.equal(callbackClientInitialization.initialize(), offlineCallbackClient);
assert.equal(callbackClientInitialization.initialize(), offlineCallbackClient);
assert.equal(callbackClientCreations, 1, 'One callback context must cache one client');
assert.throws(
  () => createCallbackClientInitialization({ config: offlinePublicConfig }).initialize(),
  /is not loaded/i
);
assert.throws(
  () => createCallbackClientInitialization({ sdk: offlineSdk }).initialize(),
  /configuration is missing/i
);
assert.equal(callbackClientCreations, 1, 'Rejected callback initialization must not reach the SDK');

let callbackConfigLoads = 0;
const readinessRoot = { dataset: {} };
const callbackPageInitialization = createCallbackPageInitialization({
  loadConfig: async () => {
    callbackConfigLoads += 1;
    return { SUPABASE_CONFIG: offlinePublicConfig };
  },
  sdk: offlineSdk,
  root: readinessRoot,
});
const firstPageInitialization = callbackPageInitialization.initialize();
const secondPageInitialization = callbackPageInitialization.initialize();
assert.equal(firstPageInitialization, secondPageInitialization, 'Callback page initialization must reuse one promise');
assert.equal(await firstPageInitialization, CALLBACK_CLIENT_STATE.READY);
assert.equal(callbackConfigLoads, 1, 'The ignored configuration module must be requested once per callback context');
assert.equal(callbackClientCreations, 2, 'Callback page initialization must construct exactly one additional client');
assert.equal(readinessRoot.dataset.supabaseClientState, CALLBACK_CLIENT_STATE.READY);

for (const unavailableCase of [
  {
    name: 'missing configuration module',
    loadConfig: async () => { throw new Error('offline missing-module fixture'); },
    sdk: offlineSdk,
  },
  {
    name: 'missing SDK',
    loadConfig: async () => ({ SUPABASE_CONFIG: offlinePublicConfig }),
    sdk: undefined,
  },
  {
    name: 'invalid configuration',
    loadConfig: async () => ({ SUPABASE_CONFIG: { ...offlinePublicConfig, url: 'http://unsafe.example' } }),
    sdk: offlineSdk,
  },
]) {
  const root = { dataset: {} };
  const unavailableInitialization = createCallbackPageInitialization({ ...unavailableCase, root });
  assert.equal(await unavailableInitialization.initialize(), CALLBACK_CLIENT_STATE.UNAVAILABLE, unavailableCase.name);
  assert.equal(root.dataset.supabaseClientState, CALLBACK_CLIENT_STATE.UNAVAILABLE, unavailableCase.name);
}
assert.equal(callbackClientCreations, 2, 'Failed callback page initialization must not reach the SDK');

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

function callbackContext(url) {
  const parsed = new URL(url);
  const cleanupCalls = [];
  return {
    cleanupCalls,
    context: {
      location: {
        href: parsed.href,
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash,
      },
      history: { replaceState: (...args) => cleanupCalls.push(args) },
    },
  };
}

let exchangeCalls = 0;
let cleanupObservedBeforeExchange = false;
const validContext = callbackContext(`${callback}?code=${secret}`);
const confirmationController = createPkceConfirmationController({
  exchangeAuthorizationCode: async (code) => {
    exchangeCalls += 1;
    cleanupObservedBeforeExchange = validContext.cleanupCalls.length === 1;
    assert.equal(code, secret);
    return { data: { session: { access_token: 'fake-session-value' } }, error: null };
  },
});
const firstProcessing = confirmationController.process(validContext.context);
const duplicateProcessing = confirmationController.process(validContext.context);
assert.equal(firstProcessing, duplicateProcessing, 'Concurrent processing must reuse one promise');
assert.deepEqual(await firstProcessing, {
  status: CONFIRMATION_STATUS.CONFIRMED,
  message: CONFIRMATION_MESSAGES.CONFIRMED,
});
assert.equal(exchangeCalls, 1, 'A controller must exchange at most once');
assert.equal(cleanupObservedBeforeExchange, true, 'The callback URL must be scrubbed before exchange');
assert.deepEqual(validContext.cleanupCalls, [[null, '', '/RecipeFinder/auth-callback.html']]);

const failedContext = callbackContext(`${callback}?code=fake-failure-code`);
const failedController = createPkceConfirmationController({
  exchangeAuthorizationCode: async () => {
    throw new Error('raw provider failure with fake token');
  },
});
assert.deepEqual(await failedController.process(failedContext.context), {
  status: CONFIRMATION_STATUS.UNAVAILABLE,
  message: CONFIRMATION_MESSAGES.UNAVAILABLE,
});

for (const unsupportedUrl of [
  callback,
  `${callback}?code=`,
  `${callback}?code=one&code=two`,
  `${callback}?code=one&token_hash=two&type=email`,
  `${callback}?token_hash=${secret}&type=email`,
  `${callback}#access_token=${secret}&refresh_token=${secret}`,
]) {
  let unsupportedExchangeCalls = 0;
  const unsupported = callbackContext(unsupportedUrl);
  const controller = createPkceConfirmationController({
    exchangeAuthorizationCode: async () => { unsupportedExchangeCalls += 1; },
  });
  assert.deepEqual(await controller.process(unsupported.context), {
    status: CONFIRMATION_STATUS.UNAVAILABLE,
    message: CONFIRMATION_MESSAGES.UNAVAILABLE,
  });
  assert.equal(unsupportedExchangeCalls, 0, 'Unsupported callback forms must not reach exchange');
}

const missingExchangeContext = callbackContext(`${callback}?code=fake-missing-exchange`);
assert.deepEqual(await createPkceConfirmationController().process(missingExchangeContext.context), {
  status: CONFIRMATION_STATUS.UNAVAILABLE,
  message: CONFIRMATION_MESSAGES.UNAVAILABLE,
});
assert.deepEqual(await createPkceConfirmationController({
  exchangeAuthorizationCode: 'invalid',
}).process(callbackContext(`${callback}?code=fake-invalid-exchange`).context), {
  status: CONFIRMATION_STATUS.UNAVAILABLE,
  message: CONFIRMATION_MESSAGES.UNAVAILABLE,
});
assert.deepEqual(await createPkceConfirmationController({
  exchangeAuthorizationCode: async () => ({ error: new Error('raw provider error') }),
}).process(callbackContext(`${callback}?code=fake-provider-error`).context), {
  status: CONFIRMATION_STATUS.UNAVAILABLE,
  message: CONFIRMATION_MESSAGES.UNAVAILABLE,
});
assert.deepEqual(await createPkceConfirmationController({
  exchangeAuthorizationCode: async () => undefined,
}).process(callbackContext(`${callback}?code=fake-malformed-result`).context), {
  status: CONFIRMATION_STATUS.UNAVAILABLE,
  message: CONFIRMATION_MESSAGES.UNAVAILABLE,
});

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
assert.equal(
  source.match(/createPkceConfirmationController\s*\(/g)?.length,
  1,
  'The prepared confirmation controller must be declared but never invoked by the live entrypoint'
);
assert.equal(source.includes(secret), false, 'Fake authorization values must never enter production source');
assert.doesNotMatch(source, /supabase-client|supabase-browser|supabase-config|createClient/);

const browserSource = await readFile(new URL('../js/auth-callback-browser.js', import.meta.url), 'utf8');
assert.match(browserSource, /createPkceBrowserInitializer/);
assert.match(browserSource, /import\('\.\/supabase-config\.js'\)/, 'The ignored config must be loaded only at runtime');
assert.doesNotMatch(browserSource, /^import\s+.*supabase-config\.js/m, 'The ignored config must not be a static import');
assert.doesNotMatch(browserSource, /createPkceConfirmationController|exchangeCodeForSession|verifyOtp|getSession|signUp|signInWithPassword|onAuthStateChange/);
assert.doesNotMatch(browserSource, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|console\./);
assert.doesNotMatch(browserSource, /globalThis\.[A-Za-z_$][\w$]*\s*=|window\.[A-Za-z_$][\w$]*\s*=/, 'Client state must not be exposed globally');

const renderedText = JSON.stringify([...nodes.values()].map((node) => node.textContent));
assert.equal(renderedText.includes(secret), false);
assert.doesNotMatch(renderedText, /access_token|refresh_token|session|verifier/i);

const html = await readFile(new URL('../auth-callback.html', import.meta.url), 'utf8');
const sdkTag = `<script src="${sdkUrl}" integrity="${sdkIntegrity}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;
assert.ok(html.includes(sdkTag), 'The callback page must use the exact approved SDK tag');
assert.equal(html.split(sdkUrl).length - 1, 1, 'The callback page must load exactly one pinned SDK');
assert.ok(
  html.indexOf(sdkUrl) < html.indexOf('<script type="module" src="js/auth-callback.js"></script>'),
  'The pinned SDK must load before callback modules'
);
assert.ok(
  html.indexOf('<script type="module" src="js/auth-callback.js"></script>')
    < html.indexOf('<script type="module" src="js/auth-callback-browser.js"></script>'),
  'URL classification and cleanup must remain the first callback module'
);
assert.doesNotMatch(html, /Email Verified|Authentication Successful/i);
assert.doesNotMatch(html, /supabase-config|createClient|exchangeCodeForSession|verifyOtp|getSession/);
assert.match(html, /href="login\.html"/);
assert.match(html, /href="register\.html"/);
assert.match(html, /href="index\.html"/);
assert.match(html, /name="referrer" content="no-referrer"/);

console.log('Offline auth callback tests passed without network or authentication side effects.');
