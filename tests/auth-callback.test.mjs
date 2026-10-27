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

const renderedText = JSON.stringify([...nodes.values()].map((node) => node.textContent));
assert.equal(renderedText.includes(secret), false);
assert.doesNotMatch(renderedText, /access_token|refresh_token|session|verifier/i);

const html = await readFile(new URL('../auth-callback.html', import.meta.url), 'utf8');
assert.doesNotMatch(html, /supabase-js|cdn\.jsdelivr|Email Verified|Authentication Successful/i);
assert.match(html, /href="login\.html"/);
assert.match(html, /href="register\.html"/);
assert.match(html, /href="index\.html"/);
assert.match(html, /name="referrer" content="no-referrer"/);

console.log('Offline auth callback tests passed without network or authentication side effects.');
