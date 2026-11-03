import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CONFIRMATION_RESEND_COOLDOWN_MS,
  CONFIRMATION_RESEND_MESSAGES,
  CONFIRMATION_RESEND_STATUS,
  createConfirmationResendService,
} from '../js/confirmation-resend.js';
import {
  activateConfirmationResendController,
  createConfirmationResendFormSubmitHandler,
  createConfirmationResendSubmitController,
  deactivateConfirmationResendController,
} from '../js/auth-ui.js';
import {
  REGISTRATION_CLIENT_STATE,
  createLiveRegistrationPageActivation,
  createRegistrationPageInitialization,
} from '../js/registration-browser.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function fakeClient(response) {
  if (arguments.length === 0) response = { data: {}, error: null };
  const calls = [];
  return {
    calls,
    client: {
      auth: {
        async resend(request) {
          calls.push(request);
          return typeof response === 'function' ? response(request) : response;
        },
      },
    },
  };
}

let now = 1_000;
const successFake = fakeClient();
const service = createConfirmationResendService(successFake.client, { now: () => now });
assert.equal(successFake.calls.length, 0, 'Construction must not send a confirmation email');
const submitted = await service.request('  Cook@Example.test  ');
assert.deepEqual(successFake.calls, [{
  type: 'signup',
  email: 'Cook@Example.test',
  options: { emailRedirectTo: 'http://localhost/RecipeFinder/auth-callback.html' },
}]);
assert.equal(submitted.status, CONFIRMATION_RESEND_STATUS.SUBMITTED);
assert.equal(submitted.message, CONFIRMATION_RESEND_MESSAGES.SUBMITTED);
assert.equal(submitted.retryAfterMs, CONFIRMATION_RESEND_COOLDOWN_MS);
assert.equal(Object.isFrozen(submitted), true);
assert.doesNotMatch(submitted.message, /cook|exists|verified|unknown|sent/i);

const cooldown = await service.request('cook@example.test');
assert.equal(cooldown.status, CONFIRMATION_RESEND_STATUS.COOLDOWN);
assert.equal(cooldown.retryAfterMs, CONFIRMATION_RESEND_COOLDOWN_MS);
assert.equal(successFake.calls.length, 1, 'Cooldown must not call the provider');
now += CONFIRMATION_RESEND_COOLDOWN_MS;
assert.equal((await service.request('cook@example.test')).status, CONFIRMATION_RESEND_STATUS.SUBMITTED);
assert.equal(successFake.calls.length, 2);

for (const input of [null, undefined, '', ' ', 'not-an-email', {}, []]) {
  const invalidFake = fakeClient();
  const invalidService = createConfirmationResendService(invalidFake.client);
  assert.equal((await invalidService.request(input)).status, CONFIRMATION_RESEND_STATUS.INVALID);
  assert.equal(invalidFake.calls.length, 0);
}

for (const accountState of ['unknown', 'verified', 'unverified']) {
  const neutralFake = fakeClient({ data: { fixture: accountState }, error: null });
  const neutralService = createConfirmationResendService(neutralFake.client);
  const result = await neutralService.request(`${accountState}@example.test`);
  assert.deepEqual(
    { status: result.status, message: result.message },
    { status: CONFIRMATION_RESEND_STATUS.SUBMITTED, message: CONFIRMATION_RESEND_MESSAGES.SUBMITTED }
  );
  assert.equal(result.message.includes(accountState), false);
}

for (const error of [
  { code: 'over_email_send_rate_limit', status: 429, message: 'PRIVATE_RATE_DETAIL' },
  { code: 'over_request_rate_limit', status: 429, message: 'PRIVATE_RATE_DETAIL' },
  { code: 'other_private_error', status: 400, message: 'PRIVATE_PROVIDER_DETAIL' },
  { code: 'user_already_confirmed', status: 400, message: 'PRIVATE_ACCOUNT_DETAIL' },
  { code: 'user_not_found', status: 404, message: 'PRIVATE_ACCOUNT_DETAIL' },
  { code: 'network_error', status: 0, message: 'PRIVATE_NETWORK_DETAIL' },
  { code: 'service_unavailable', status: 503, message: 'PRIVATE_SERVICE_DETAIL' },
  { code: 'invalid_api_key', status: 401, message: 'PRIVATE_CONFIGURATION_DETAIL' },
]) {
  const errorFake = fakeClient({ data: null, error });
  const errorService = createConfirmationResendService(errorFake.client);
  const result = await errorService.request('cook@example.test');
  const operationalFailure = error.status === 0
    || error.status === 401
    || error.status >= 500;
  const expected = error.status === 429
    ? CONFIRMATION_RESEND_STATUS.RATE_LIMITED
    : operationalFailure
      ? CONFIRMATION_RESEND_STATUS.UNAVAILABLE
      : CONFIRMATION_RESEND_STATUS.SUBMITTED;
  assert.equal(result.status, expected);
  assert.doesNotMatch(result.message, /PRIVATE|provider|account exists/i);
  if (
    expected === CONFIRMATION_RESEND_STATUS.RATE_LIMITED
    || expected === CONFIRMATION_RESEND_STATUS.SUBMITTED
  ) {
    assert.equal(result.message, CONFIRMATION_RESEND_MESSAGES.SUBMITTED);
  }
}

for (const response of [null, undefined, [], {}, { error: undefined }]) {
  const malformed = fakeClient(response);
  const malformedService = createConfirmationResendService(malformed.client);
  assert.equal(
    (await malformedService.request('cook@example.test')).status,
    CONFIRMATION_RESEND_STATUS.UNAVAILABLE
  );
}

const exceptionFake = fakeClient(() => { throw new Error('PRIVATE_RESEND_EXCEPTION'); });
assert.equal(
  (await createConfirmationResendService(exceptionFake.client).request('cook@example.test')).status,
  CONFIRMATION_RESEND_STATUS.UNAVAILABLE
);

for (const hostileNow of [
  () => { throw new Error('PRIVATE_CLOCK_DETAIL'); },
  () => Number.NaN,
]) {
  const clockFake = fakeClient();
  const clockService = createConfirmationResendService(clockFake.client, { now: hostileNow });
  const result = await clockService.request('cook@example.test');
  assert.equal(result.status, CONFIRMATION_RESEND_STATUS.UNAVAILABLE);
  assert.equal(clockFake.calls.length, 0, 'Invalid clocks must fail before provider dispatch');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|clock/i);
}

const pendingRequest = deferred();
const pendingFake = fakeClient(() => pendingRequest.promise);
const pendingService = createConfirmationResendService(pendingFake.client);
const firstPending = pendingService.request('cook@example.test');
assert.equal((await pendingService.request('cook@example.test')).status, CONFIRMATION_RESEND_STATUS.PENDING);
assert.equal(pendingFake.calls.length, 1);
pendingRequest.resolve({ data: {}, error: null });
assert.equal((await firstPending).status, CONFIRMATION_RESEND_STATUS.SUBMITTED);

const lateRequest = deferred();
const lateFake = fakeClient(() => lateRequest.promise);
const lateService = createConfirmationResendService(lateFake.client);
const lateResult = lateService.request('cook@example.test');
assert.equal(lateService.cleanup(), true);
assert.equal(lateService.cleanup(), false);
lateRequest.resolve({ data: {}, error: null });
assert.equal((await lateResult).status, CONFIRMATION_RESEND_STATUS.STALE);
assert.equal((await lateService.request('cook@example.test')).status, CONFIRMATION_RESEND_STATUS.STALE);

assert.throws(() => createConfirmationResendService({ auth: {} }), /compatible confirmation resend client/i);
assert.throws(
  () => createConfirmationResendService(fakeClient().client, { callbackUrl: 'https://evil.example/callback' }),
  /callback URL is not approved/i
);
assert.doesNotThrow(() => createConfirmationResendService(fakeClient().client, {
  callbackUrl: 'https://recipefinder.example/auth-callback.html',
  applicationOrigin: 'https://recipefinder.example',
}));

function fakeResendForm() {
  const button = { disabled: false };
  const attributes = new Map();
  return {
    button,
    attributes,
    querySelector(selector) { return selector === '[type="submit"]' ? button : null; },
    setAttribute(name, value) { attributes.set(name, value); },
  };
}

const uiRequest = deferred();
let uiCalls = 0;
let timerCallback;
let timerDelay;
const uiController = createConfirmationResendSubmitController(
  () => {
    uiCalls += 1;
    return uiRequest.promise;
  },
  {
    setTimer(callback, delay) { timerCallback = callback; timerDelay = delay; return 7; },
    clearTimer() {},
  }
);
const uiForm = fakeResendForm();
const uiPending = uiController.submit('cook@example.test', { form: uiForm });
assert.equal(uiForm.button.disabled, true);
assert.equal(uiForm.attributes.get('aria-busy'), 'true');
assert.equal((await uiController.submit('cook@example.test', { form: uiForm })).status, CONFIRMATION_RESEND_STATUS.PENDING);
assert.equal(uiCalls, 1);
uiRequest.resolve({
  status: CONFIRMATION_RESEND_STATUS.SUBMITTED,
  message: CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
  retryAfterMs: CONFIRMATION_RESEND_COOLDOWN_MS,
});
assert.equal((await uiPending).status, CONFIRMATION_RESEND_STATUS.SUBMITTED);
assert.equal(timerDelay, CONFIRMATION_RESEND_COOLDOWN_MS);
assert.equal(uiForm.button.disabled, true, 'Cooldown keeps the button disabled');
timerCallback();
assert.equal(uiForm.button.disabled, false);
assert.equal(uiForm.attributes.get('aria-busy'), 'false');

let cleanupTimerClears = 0;
const cleanupUiForm = fakeResendForm();
const cleanupUiController = createConfirmationResendSubmitController(
  async () => ({
    status: CONFIRMATION_RESEND_STATUS.SUBMITTED,
    message: CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
    retryAfterMs: CONFIRMATION_RESEND_COOLDOWN_MS,
  }),
  {
    setTimer() { return 9; },
    clearTimer(timer) { assert.equal(timer, 9); cleanupTimerClears += 1; },
  }
);
await cleanupUiController.submit('cook@example.test', { form: cleanupUiForm });
assert.equal(cleanupUiForm.button.disabled, true);
assert.equal(cleanupUiController.deactivate(), true);
assert.equal(cleanupTimerClears, 1);
assert.equal(cleanupUiForm.button.disabled, false, 'Cleanup must release a cooldown-disabled form');

const hostileResultForm = fakeResendForm();
const hostileResultController = createConfirmationResendSubmitController(async () => new Proxy({}, {
  get() { throw new Error('PRIVATE_RESULT_DETAIL'); },
}));
const hostileResult = await hostileResultController.submit('cook@example.test', { form: hostileResultForm });
assert.equal(hostileResult.status, CONFIRMATION_RESEND_STATUS.UNAVAILABLE);
assert.equal(hostileResultForm.button.disabled, false);
assert.doesNotMatch(JSON.stringify(hostileResult), /PRIVATE|RESULT_DETAIL/);

const originalHtmlInputElement = globalThis.HTMLInputElement;
class FakeHtmlInputElement {
  constructor(value = '') {
    this.value = value;
    this.attributes = new Map();
    this.focusCalls = 0;
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() { this.focusCalls += 1; }
}
globalThis.HTMLInputElement = FakeHtmlInputElement;

function fakeHandlerForm(email = 'cook@example.test') {
  const input = new FakeHtmlInputElement(email);
  const error = { textContent: '' };
  const button = { disabled: false };
  const status = {
    textContent: '',
    isError: false,
    classList: { toggle(name, value) { if (name === 'is-error') status.isError = value; } },
  };
  const attributes = new Map();
  const requestedFields = [];
  const form = {
    elements: {
      namedItem(name) {
        requestedFields.push(name);
        return name === 'email' ? input : null;
      },
    },
    querySelector(selector) {
      if (selector === '[data-error-for="email"]') return error;
      if (selector === '[data-form-status]') return status;
      if (selector === '[type="submit"]') return button;
      if (selector === '[aria-invalid="true"]') {
        return input.attributes.get('aria-invalid') === 'true' ? input : null;
      }
      return null;
    },
    setAttribute(name, value) { attributes.set(name, value); },
  };
  return { form, input, error, button, status, attributes, requestedFields };
}

const fakeSubmitEvent = Object.freeze({ preventDefault() {} });

const invalidHandlerUi = fakeHandlerForm('not-an-email');
await createConfirmationResendFormSubmitHandler(invalidHandlerUi.form)(fakeSubmitEvent);
assert.equal(invalidHandlerUi.error.textContent, 'Enter a valid email address.');
assert.equal(invalidHandlerUi.input.attributes.get('aria-invalid'), 'true');
assert.equal(invalidHandlerUi.input.focusCalls, 1);
assert.match(invalidHandlerUi.status.textContent, /review the highlighted field/i);
assert.equal(invalidHandlerUi.status.isError, true);
assert.equal(invalidHandlerUi.requestedFields.length > 0, true);
assert.equal(
  invalidHandlerUi.requestedFields.every((name) => name === 'email'),
  true,
  'Resend validation must never read a password field'
);

async function runHandlerResult(result) {
  const ui = fakeHandlerForm();
  const controller = createConfirmationResendSubmitController(async () => result);
  assert.equal(activateConfirmationResendController(controller), true);
  try {
    await createConfirmationResendFormSubmitHandler(ui.form)(fakeSubmitEvent);
  } finally {
    assert.equal(deactivateConfirmationResendController(controller), true);
    controller.deactivate();
  }
  return ui;
}

const successHandlerUi = await runHandlerResult(Object.freeze({
  status: CONFIRMATION_RESEND_STATUS.SUBMITTED,
  message: CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
  retryAfterMs: 0,
}));
assert.equal(successHandlerUi.status.textContent, CONFIRMATION_RESEND_MESSAGES.SUBMITTED);
assert.equal(successHandlerUi.status.isError, false);
assert.equal(successHandlerUi.input.attributes.get('aria-invalid'), 'false');
assert.equal(successHandlerUi.requestedFields.every((name) => name === 'email'), true);

const unavailableHandlerUi = await runHandlerResult(Object.freeze({
  status: CONFIRMATION_RESEND_STATUS.UNAVAILABLE,
  message: CONFIRMATION_RESEND_MESSAGES.UNAVAILABLE,
  retryAfterMs: 0,
}));
assert.equal(unavailableHandlerUi.status.textContent, CONFIRMATION_RESEND_MESSAGES.UNAVAILABLE);
assert.equal(unavailableHandlerUi.status.isError, true);

const rateLimitHandlerUi = await runHandlerResult(Object.freeze({
  status: CONFIRMATION_RESEND_STATUS.RATE_LIMITED,
  message: CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
  retryAfterMs: CONFIRMATION_RESEND_COOLDOWN_MS,
}));
assert.equal(rateLimitHandlerUi.status.textContent, CONFIRMATION_RESEND_MESSAGES.SUBMITTED);
assert.equal(rateLimitHandlerUi.status.isError, false);

let handlerCooldownCallback;
const cooldownHandlerUi = fakeHandlerForm();
const cooldownHandlerController = createConfirmationResendSubmitController(
  async () => ({
    status: CONFIRMATION_RESEND_STATUS.RATE_LIMITED,
    message: CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
    retryAfterMs: CONFIRMATION_RESEND_COOLDOWN_MS,
  }),
  {
    setTimer(callback, delay) {
      handlerCooldownCallback = callback;
      assert.equal(delay, CONFIRMATION_RESEND_COOLDOWN_MS);
      return 11;
    },
    clearTimer() {},
  }
);
assert.equal(activateConfirmationResendController(cooldownHandlerController), true);
await createConfirmationResendFormSubmitHandler(cooldownHandlerUi.form)(fakeSubmitEvent);
assert.equal(cooldownHandlerUi.button.disabled, true);
assert.equal(cooldownHandlerUi.attributes.get('aria-busy'), 'true');
assert.equal(cooldownHandlerUi.status.textContent, CONFIRMATION_RESEND_MESSAGES.SUBMITTED);
handlerCooldownCallback();
assert.equal(cooldownHandlerUi.button.disabled, false);
assert.equal(cooldownHandlerUi.attributes.get('aria-busy'), 'false');
assert.equal(deactivateConfirmationResendController(cooldownHandlerController), true);
cooldownHandlerController.deactivate();

const duplicateHandlerRequest = deferred();
let duplicateHandlerCalls = 0;
const duplicateHandlerUi = fakeHandlerForm();
const duplicateHandlerController = createConfirmationResendSubmitController(() => {
  duplicateHandlerCalls += 1;
  return duplicateHandlerRequest.promise;
});
assert.equal(activateConfirmationResendController(duplicateHandlerController), true);
const duplicateHandler = createConfirmationResendFormSubmitHandler(duplicateHandlerUi.form);
const firstHandlerSubmission = duplicateHandler(fakeSubmitEvent);
assert.equal(duplicateHandlerUi.button.disabled, true);
assert.equal(duplicateHandlerUi.attributes.get('aria-busy'), 'true');
await duplicateHandler(fakeSubmitEvent);
assert.equal(duplicateHandlerCalls, 1);
assert.match(duplicateHandlerUi.status.textContent, /already in progress/i);
duplicateHandlerRequest.resolve(Object.freeze({
  status: CONFIRMATION_RESEND_STATUS.SUBMITTED,
  message: CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
  retryAfterMs: 0,
}));
await firstHandlerSubmission;
assert.equal(duplicateHandlerUi.status.textContent, CONFIRMATION_RESEND_MESSAGES.SUBMITTED);
assert.equal(duplicateHandlerUi.button.disabled, false);
assert.equal(deactivateConfirmationResendController(duplicateHandlerController), true);
duplicateHandlerController.deactivate();

const lateHandlerRequest = deferred();
const lateHandlerUi = fakeHandlerForm();
const lateHandlerController = createConfirmationResendSubmitController(() => lateHandlerRequest.promise);
assert.equal(activateConfirmationResendController(lateHandlerController), true);
const lateHandlerSubmission = createConfirmationResendFormSubmitHandler(lateHandlerUi.form)(fakeSubmitEvent);
assert.equal(deactivateConfirmationResendController(lateHandlerController), true);
lateHandlerController.deactivate();
const replacementController = createConfirmationResendSubmitController(async () => ({
  status: CONFIRMATION_RESEND_STATUS.SUBMITTED,
  message: CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
  retryAfterMs: 0,
}));
assert.equal(activateConfirmationResendController(replacementController), true);
lateHandlerRequest.resolve(Object.freeze({
  status: CONFIRMATION_RESEND_STATUS.SUBMITTED,
  message: 'PRIVATE_LATE_RESULT',
  retryAfterMs: 0,
}));
await lateHandlerSubmission;
assert.equal(lateHandlerUi.status.textContent, '', 'Removed controllers must not publish late results');
assert.equal(lateHandlerUi.button.disabled, false);
assert.equal(deactivateConfirmationResendController(replacementController), true);
replacementController.deactivate();

const safeTextFake = fakeClient({
  data: null,
  error: { code: 'user_not_found', status: 404, message: '<img src=x onerror=PRIVATE_PROVIDER>' },
});
const safeTextService = createConfirmationResendService(safeTextFake.client);
const safeTextUi = fakeHandlerForm();
const safeTextController = createConfirmationResendSubmitController(
  (email) => safeTextService.request(email)
);
assert.equal(activateConfirmationResendController(safeTextController), true);
await createConfirmationResendFormSubmitHandler(safeTextUi.form)(fakeSubmitEvent);
assert.equal(safeTextUi.status.textContent, CONFIRMATION_RESEND_MESSAGES.SUBMITTED);
assert.doesNotMatch(safeTextUi.status.textContent, /PRIVATE|<img|onerror/i);
assert.equal(deactivateConfirmationResendController(safeTextController), true);
safeTextController.deactivate();
safeTextService.cleanup();

if (originalHtmlInputElement === undefined) delete globalThis.HTMLInputElement;
else globalThis.HTMLInputElement = originalHtmlInputElement;

const clientConfig = Object.freeze({
  url: 'https://recipefinder-test.supabase.co',
  publishableKey: 'sb_publishable_test_abcdefghijklmnopqrstuvwxyz',
});
let clientCreations = 0;
let resendCalls = 0;
const sharedClient = {
  auth: {
    async signUp() { return { data: { session: null }, error: null }; },
    async signOut() { return { error: null }; },
    async resend() { resendCalls += 1; return { data: {}, error: null }; },
  },
};
const pageInitialization = createRegistrationPageInitialization({
  loadConfig: async () => ({ SUPABASE_CONFIG: clientConfig }),
  sdk: { createClient() { clientCreations += 1; return sharedClient; } },
  root: { dataset: {} },
});
assert.equal(await pageInitialization.initialize(), REGISTRATION_CLIENT_STATE.READY);
assert.equal(pageInitialization.getClient(), sharedClient);
assert.equal(pageInitialization.getClient(), sharedClient);
assert.equal(clientCreations, 1, 'Registration and resend must share one page client');
assert.equal(resendCalls, 0, 'Readiness and activation must never send an email');

let acceptedResendClient;
let acceptedResendOptions;
let resendActivationCalls = 0;
const readinessForm = {
  querySelector(selector) {
    if (selector === '[type="submit"]') return { disabled: true };
    if (selector === '[data-form-status]') return { textContent: '', classList: { toggle() {} } };
    return null;
  },
  setAttribute() {},
};
const liveActivation = createLiveRegistrationPageActivation({
  document: { querySelector: () => readinessForm },
  location: { href: 'https://recipefinder.example/register.html' },
  createPageInitialization: () => ({
    initialize: async () => REGISTRATION_CLIENT_STATE.READY,
    getClient: () => sharedClient,
    createComposition: () => ({ activate: () => true, cleanup: () => true }),
  }),
  createResendService(client, options) {
    acceptedResendClient = client;
    acceptedResendOptions = options;
    return { request: async () => ({ status: CONFIRMATION_RESEND_STATUS.SUBMITTED }), cleanup() {} };
  },
  createResendActivation: () => ({
    activate() { resendActivationCalls += 1; return true; },
    cleanup() { return true; },
  }),
});
assert.equal(await liveActivation.activate(), true);
assert.equal(acceptedResendClient, sharedClient);
assert.deepEqual(acceptedResendOptions, {
  callbackUrl: 'https://recipefinder.example/auth-callback.html',
  applicationOrigin: 'https://recipefinder.example',
});
assert.equal(resendActivationCalls, 1);
assert.equal(resendCalls, 0);
assert.equal(liveActivation.cleanup(), true);

const registerHtml = await readFile(new URL('../register.html', import.meta.url), 'utf8');
const callbackHtml = await readFile(new URL('../auth-callback.html', import.meta.url), 'utf8');
assert.match(registerHtml, /id="confirmation-recovery"/);
assert.match(registerHtml, /data-auth-form="resend"/);
assert.doesNotMatch(registerHtml, /data-auth-form="resend"[\s\S]*?type="password"/);
assert.match(callbackHtml, /register\.html#confirmation-recovery/);

const source = await readFile(new URL('../js/confirmation-resend.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /createClient|supabase-config|localStorage|sessionStorage|console\.|signUp|signIn|signOut/);
assert.match(source, /resend\.call\(auth/);
assert.match(source, /type: 'signup'/);

console.log('Offline confirmation resend tests passed with fake clients and fake timers only.');
