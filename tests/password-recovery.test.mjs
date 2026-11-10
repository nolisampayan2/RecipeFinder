import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PASSWORD_RECOVERY_MESSAGES,
  PASSWORD_RECOVERY_STATUS,
  classifyPasswordRecoveryCallback,
  createPasswordRecoveryController,
  createPasswordRecoveryRequestService,
  resolvePasswordResetUrl,
  scrubPasswordRecoveryUrl,
  validateNewPassword,
} from '../js/password-recovery.js';
import { createPasswordResetActivation } from '../js/password-recovery-browser.js';

const productionRequest = 'https://recipefinder.example/forgot-password.html';
const productionReset = 'https://recipefinder.example/reset-password.html';

assert.equal(resolvePasswordResetUrl(productionRequest), productionReset);
assert.equal(
  resolvePasswordResetUrl(`${productionRequest}?utm_source=classroom&utm_campaign=demo`),
  productionReset
);
assert.equal(
  resolvePasswordResetUrl('http://localhost/RecipeFinder/forgot-password.html'),
  'http://localhost/RecipeFinder/reset-password.html'
);
for (const unsafe of [
  'http://recipefinder.example/forgot-password.html',
  'https://user:password@recipefinder.example/forgot-password.html',
  'https://recipefinder.example/forgot-password.html?next=https://attacker.example',
  'https://recipefinder.example/forgot-password.html#fragment',
]) assert.throws(() => resolvePasswordResetUrl(unsafe), TypeError);

assert.equal(classifyPasswordRecoveryCallback(`${productionReset}?code=one-time-code`).kind, 'pkce');
for (const invalid of [
  productionReset,
  `${productionReset}?code=`,
  `${productionReset}?code=one&code=two`,
  `${productionReset}?code=one&next=https://attacker.example`,
  `${productionReset}?code=one#access_token=secret`,
  'http://recipefinder.example/reset-password.html?code=one',
  'https://user:password@recipefinder.example/reset-password.html?code=one',
]) assert.equal(classifyPasswordRecoveryCallback(invalid).kind, 'invalid');
assert.equal(classifyPasswordRecoveryCallback(`${productionReset}?error=access_denied`).kind, 'provider-error');

const historyCalls = [];
assert.equal(scrubPasswordRecoveryUrl(
  { pathname: '/reset-password.html', search: '?code=sensitive', hash: '' },
  { replaceState(...args) { historyCalls.push(args); } }
), true);
assert.deepEqual(historyCalls, [[null, '', '/reset-password.html']]);
assert.equal(scrubPasswordRecoveryUrl({}, { replaceState() { throw new Error('private failure'); } }), false);

assert.equal(validateNewPassword({ password: 'StrongPass1', confirmPassword: 'StrongPass1' }).valid, true);
for (const input of [
  { password: '', confirmPassword: '' },
  { password: 'short1A', confirmPassword: 'short1A' },
  { password: 'lowercase1', confirmPassword: 'lowercase1' },
  { password: 'UPPERCASE1', confirmPassword: 'UPPERCASE1' },
  { password: 'NoNumberPass', confirmPassword: 'NoNumberPass' },
  { password: 'StrongPass1', confirmPassword: 'DifferentPass1' },
]) assert.equal(validateNewPassword(input).valid, false);
const hostilePasswordInput = new Proxy({}, { get() { throw new Error('secret hostile getter'); } });
const hostilePasswordResult = validateNewPassword(hostilePasswordInput);
assert.equal(hostilePasswordResult.valid, false);
assert.doesNotMatch(JSON.stringify(hostilePasswordResult), /secret|hostile getter/i);

const requestCalls = [];
const requestClient = {
  auth: {
    async resetPasswordForEmail(email, options) {
      requestCalls.push({ email, options });
      return { data: {}, error: null };
    },
  },
};
const requestService = createPasswordRecoveryRequestService(requestClient, {
  redirectTo: productionReset,
  applicationOrigin: 'https://recipefinder.example',
});
assert.equal((await requestService.request('invalid')).status, PASSWORD_RECOVERY_STATUS.INVALID);
const requestA = requestService.request(' cook@example.test ');
const requestB = requestService.request('cook@example.test');
assert.equal(requestA, requestB, 'Duplicate recovery requests must share one pending operation.');
assert.equal((await requestA).status, PASSWORD_RECOVERY_STATUS.SUBMITTED);
assert.deepEqual(requestCalls, [{
  email: 'cook@example.test',
  options: { redirectTo: productionReset },
}]);

const neutralMessages = [];
for (const behavior of ['success', 'provider-error', 'throw']) {
  const service = createPasswordRecoveryRequestService({ auth: {
    async resetPasswordForEmail() {
      if (behavior === 'throw') throw new Error('account missing secret provider detail');
      return behavior === 'success' ? { data: {}, error: null } : { data: null, error: { message: 'account missing' } };
    },
  } }, { redirectTo: productionReset, applicationOrigin: 'https://recipefinder.example' });
  neutralMessages.push((await service.request('person@example.test')).message);
}
assert.deepEqual(neutralMessages, Array(3).fill(PASSWORD_RECOVERY_MESSAGES.SUBMITTED));
assert.throws(
  () => createPasswordRecoveryRequestService(requestClient, {
    redirectTo: 'https://attacker.example/reset-password.html',
    applicationOrigin: 'https://recipefinder.example',
  }),
  TypeError
);

let settleLateRequest;
const staleRequestService = createPasswordRecoveryRequestService({ auth: {
  resetPasswordForEmail() { return new Promise((resolve) => { settleLateRequest = resolve; }); },
} }, { redirectTo: productionReset, applicationOrigin: 'https://recipefinder.example' });
const staleRequest = staleRequestService.request('person@example.test');
staleRequestService.cleanup();
settleLateRequest({ data: {}, error: null });
assert.equal((await staleRequest).status, PASSWORD_RECOVERY_STATUS.STALE);

function makeRecoveryHarness({ event = 'PASSWORD_RECOVERY', initializeError = null, updateError = null, signOut = 'success' } = {}) {
  const listeners = new Set();
  const calls = { initialize: 0, update: [], signOut: [], unsubscribe: 0 };
  const user = Object.freeze({ id: '00000000-0000-4000-8000-000000000001' });
  const client = { auth: {
    onAuthStateChange(listener) {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe() { calls.unsubscribe += 1; listeners.delete(listener); } } } };
    },
    async initialize() {
      calls.initialize += 1;
      if (initializeError) return { error: initializeError };
      for (const listener of listeners) listener(event, { user });
      return { error: null };
    },
    async updateUser(attributes) {
      calls.update.push(attributes);
      if (updateError === 'throw') throw new Error('raw provider password token');
      if (updateError) return { data: { user: null }, error: { message: 'raw provider error' } };
      for (const listener of listeners) listener('USER_UPDATED', { user });
      return { data: { user }, error: null };
    },
    async signOut(options) {
      calls.signOut.push(options);
      if (signOut === 'throw') throw new Error('raw signout provider detail');
      if (signOut === 'error') return { error: { message: 'raw signout provider detail' } };
      for (const listener of listeners) listener('SIGNED_OUT', null);
      return { error: null };
    },
  } };
  return { client, calls, emit(name, session) { for (const listener of listeners) listener(name, session); }, user };
}

function controllerFor(harness, href = `${productionReset}?code=one-time-code`) {
  const location = { href, pathname: '/reset-password.html', search: '?code=one-time-code', hash: '' };
  const scrubbed = [];
  const controller = createPasswordRecoveryController(harness.client, {
    location,
    history: { replaceState(...args) { scrubbed.push(args); } },
    setTimer() { return 1; },
    clearTimer() {},
  });
  return { controller, scrubbed };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeResetForm() {
  const handlers = new Map();
  const fields = { disabled: false };
  const status = { textContent: '', classList: { toggle() {} } };
  const password = { value: 'StrongPass1', setAttribute() {}, focus() {} };
  const confirmPassword = { value: 'StrongPass1', setAttribute() {}, focus() {} };
  const errors = {
    password: { textContent: '' },
    confirmPassword: { textContent: '' },
  };
  const form = {
    attributes: new Map(),
    elements: {
      namedItem(name) { return { password, confirmPassword }[name] ?? null; },
    },
    querySelector(selector) {
      if (selector === '[data-recovery-fields]') return fields;
      if (selector === '[data-form-status]') return status;
      if (selector === '[data-error-for="password"]') return errors.password;
      if (selector === '[data-error-for="confirmPassword"]') return errors.confirmPassword;
      if (selector === '[aria-invalid="true"]') return null;
      return null;
    },
    setAttribute(name, value) { this.attributes.set(name, value); },
    addEventListener(name, listener) { handlers.set(name, listener); },
    removeEventListener(name, listener) { if (handlers.get(name) === listener) handlers.delete(name); },
    dispatch(name) { return handlers.get(name)?.({ preventDefault() {} }); },
  };
  return { form, fields, status, password, confirmPassword, handlers };
}

function makeResetActivationController({ updateStatus = PASSWORD_RECOVERY_STATUS.UPDATED } = {}) {
  let listener = null;
  const calls = { cleanup: 0, unsubscribe: 0, update: 0 };
  const controller = {
    subscribe(nextListener) {
      listener = nextListener;
      listener(frozenBrowserState(PASSWORD_RECOVERY_STATUS.VERIFYING));
      return () => { calls.unsubscribe += 1; listener = null; };
    },
    async activate() {
      listener?.(frozenBrowserState(PASSWORD_RECOVERY_STATUS.READY));
      return frozenBrowserState(PASSWORD_RECOVERY_STATUS.READY);
    },
    getState() { return frozenBrowserState(PASSWORD_RECOVERY_STATUS.READY); },
    async update() {
      calls.update += 1;
      const result = frozenBrowserState(updateStatus);
      listener?.(result);
      return result;
    },
    cleanup() { calls.cleanup += 1; },
  };
  return { controller, calls, publish(state) { listener?.(state); } };
}

function frozenBrowserState(status) {
  const message = status === PASSWORD_RECOVERY_STATUS.SIGN_OUT_FAILED
    ? PASSWORD_RECOVERY_MESSAGES.SIGN_OUT_FAILED
    : status === PASSWORD_RECOVERY_STATUS.UPDATED
      ? PASSWORD_RECOVERY_MESSAGES.UPDATED
      : status === PASSWORD_RECOVERY_STATUS.READY
        ? PASSWORD_RECOVERY_MESSAGES.READY
        : PASSWORD_RECOVERY_MESSAGES.VERIFYING;
  return Object.freeze({ status, message });
}

const successfulHarness = makeRecoveryHarness();
const { controller: successfulController, scrubbed } = controllerFor(successfulHarness);
assert.equal((await successfulController.activate()).status, PASSWORD_RECOVERY_STATUS.READY);
assert.deepEqual(scrubbed, [[null, '', '/reset-password.html']]);
assert.equal(successfulHarness.calls.initialize, 1);
const updated = await successfulController.update({ password: 'StrongPass1', confirmPassword: 'StrongPass1' });
assert.equal(updated.status, PASSWORD_RECOVERY_STATUS.UPDATED);
assert.deepEqual(successfulHarness.calls.update, [{ password: 'StrongPass1' }]);
assert.deepEqual(successfulHarness.calls.signOut, [{ scope: 'global' }]);
assert.doesNotMatch(JSON.stringify(updated), /access_token|refresh_token|authorization code|verifier|raw provider/i);

for (const signOut of ['error', 'throw']) {
  const harness = makeRecoveryHarness({ signOut });
  const { controller } = controllerFor(harness);
  await controller.activate();
  const result = await controller.update({ password: 'StrongPass1', confirmPassword: 'StrongPass1' });
  assert.equal(result.status, PASSWORD_RECOVERY_STATUS.SIGN_OUT_FAILED);
  assert.match(result.message, /password was updated/i);
  assert.doesNotMatch(result.message, /raw|token|provider/i);
}

for (const scenario of [
  { event: 'SIGNED_IN' },
  { initializeError: { message: 'expired recovery code' } },
]) {
  const harness = makeRecoveryHarness(scenario);
  const { controller } = controllerFor(harness);
  assert.equal((await controller.activate()).status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.equal(harness.calls.update.length, 0);
}

const invalidCallbackHarness = makeRecoveryHarness();
const { controller: invalidCallbackController } = controllerFor(invalidCallbackHarness, productionReset);
assert.equal((await invalidCallbackController.activate()).status, PASSWORD_RECOVERY_STATUS.INVALID);
assert.equal(invalidCallbackHarness.calls.initialize, 0, 'Invalid callbacks must not initialize Auth.');

const accountSwitchHarness = makeRecoveryHarness();
const { controller: accountSwitchController } = controllerFor(accountSwitchHarness);
await accountSwitchController.activate();
accountSwitchHarness.emit('SIGNED_IN', { user: { id: '00000000-0000-4000-8000-000000000002' } });
assert.equal(accountSwitchController.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);

for (const transition of ['account-switch', 'logout']) {
  for (const outcome of ['success', 'failure']) {
    const harness = makeRecoveryHarness();
    const pendingUpdate = deferred();
    harness.client.auth.updateUser = () => pendingUpdate.promise;
    const { controller } = controllerFor(harness);
    await controller.activate();
    const update = controller.update({ password: 'StrongPass1', confirmPassword: 'StrongPass1' });
    if (transition === 'account-switch') {
      harness.emit('SIGNED_IN', { user: { id: '00000000-0000-4000-8000-000000000002' } });
    } else {
      harness.emit('SIGNED_OUT', null);
    }
    assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
    if (outcome === 'success') {
      pendingUpdate.resolve({ data: { user: harness.user }, error: null });
    } else {
      pendingUpdate.reject(new Error('private late provider failure'));
    }
    assert.equal((await update).status, PASSWORD_RECOVERY_STATUS.STALE);
    assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
    assert.equal(harness.calls.signOut.length, 0, 'A stale update must not sign out a replacement session.');
  }
}

{
  const harness = makeRecoveryHarness();
  const pendingSignOut = deferred();
  harness.client.auth.signOut = (options) => {
    harness.calls.signOut.push(options);
    return pendingSignOut.promise;
  };
  const { controller } = controllerFor(harness);
  await controller.activate();
  const update = controller.update({ password: 'StrongPass1', confirmPassword: 'StrongPass1' });
  await Promise.resolve();
  assert.deepEqual(harness.calls.signOut, [{ scope: 'global' }]);
  harness.emit('SIGNED_IN', { user: { id: '00000000-0000-4000-8000-000000000002' } });
  pendingSignOut.resolve({ error: null });
  assert.equal((await update).status, PASSWORD_RECOVERY_STATUS.STALE);
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
}

for (const terminalTransition of ['timeout', 'logout', 'account-switch', 'cleanup']) {
  const harness = makeRecoveryHarness();
  harness.client.auth.initialize = async () => ({ error: null });
  let timeoutCallback = null;
  const location = {
    href: `${productionReset}?code=late-recovery-code`,
    pathname: '/reset-password.html',
    search: '?code=late-recovery-code',
    hash: '',
  };
  const controller = createPasswordRecoveryController(harness.client, {
    location,
    history: { replaceState() {} },
    setTimer(callback) { timeoutCallback = callback; return 1; },
    clearTimer() {},
  });
  await controller.activate();
  if (terminalTransition === 'timeout') timeoutCallback();
  if (terminalTransition === 'logout') harness.emit('SIGNED_OUT', null);
  if (terminalTransition === 'account-switch') {
    harness.emit('SIGNED_IN', { user: { id: '00000000-0000-4000-8000-000000000002' } });
  }
  if (terminalTransition === 'cleanup') controller.cleanup();
  const beforeLateEvent = controller.getState().status;
  if (terminalTransition === 'cleanup') assert.equal(beforeLateEvent, PASSWORD_RECOVERY_STATUS.INVALID);
  harness.emit('PASSWORD_RECOVERY', { user: harness.user });
  assert.notEqual(controller.getState().status, PASSWORD_RECOVERY_STATUS.READY);
  assert.equal(controller.getState().status, beforeLateEvent);
}

{
  const harness = makeRecoveryHarness();
  harness.client.auth.onAuthStateChange = () => ({ data: { subscription: null } });
  const { controller, scrubbed: malformedScrubs } = controllerFor(harness);
  assert.equal((await controller.activate()).status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.deepEqual(malformedScrubs, [[null, '', '/reset-password.html']]);
}

{
  const harness = makeRecoveryHarness();
  const pendingInitialization = deferred();
  harness.client.auth.initialize = () => pendingInitialization.promise;
  let timeoutCallback = null;
  const location = {
    href: `${productionReset}?code=sensitive-timeout-code`,
    pathname: '/reset-password.html',
    search: '?code=sensitive-timeout-code',
    hash: '',
  };
  const scrubbedOnTimeout = [];
  const controller = createPasswordRecoveryController(harness.client, {
    location,
    history: { replaceState(...args) { scrubbedOnTimeout.push(args); } },
    setTimer(callback) { timeoutCallback = callback; return 1; },
    clearTimer() {},
  });
  void controller.activate();
  timeoutCallback();
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.deepEqual(scrubbedOnTimeout, [[null, '', '/reset-password.html']]);
  pendingInitialization.resolve({ error: null });
}

{
  const harness = makeRecoveryHarness();
  const pendingInitialization = deferred();
  harness.client.auth.initialize = () => pendingInitialization.promise;
  const location = {
    href: `${productionReset}?code=sensitive-cleanup-code`,
    pathname: '/reset-password.html',
    search: '?code=sensitive-cleanup-code',
    hash: '',
  };
  const cleanupScrubs = [];
  const controller = createPasswordRecoveryController(harness.client, {
    location,
    history: { replaceState(...args) { cleanupScrubs.push(args); } },
    setTimer() { return 1; },
    clearTimer() {},
  });
  const activation = controller.activate();
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.VERIFYING);
  assert.equal(controller.cleanup(), true);
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.deepEqual(cleanupScrubs, [[null, '', '/reset-password.html']]);
  assert.equal(harness.calls.unsubscribe, 1);
  assert.equal(controller.cleanup(), false, 'Cleanup must be idempotent.');
  assert.equal(cleanupScrubs.length, 1, 'Successful cleanup scrubbing must not repeat.');
  harness.emit('PASSWORD_RECOVERY', { user: harness.user });
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
  pendingInitialization.resolve({ error: null });
  assert.equal((await activation).status, PASSWORD_RECOVERY_STATUS.STALE);
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.equal(cleanupScrubs.length, 1);
}

{
  const harness = makeRecoveryHarness();
  const { controller, scrubbed: readyCleanupScrubs } = controllerFor(harness);
  assert.equal((await controller.activate()).status, PASSWORD_RECOVERY_STATUS.READY);
  assert.equal(readyCleanupScrubs.length, 1);
  assert.equal(controller.cleanup(), true);
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.equal(readyCleanupScrubs.length, 1, 'Cleanup must reuse the successful normal-path scrub.');
  harness.emit('PASSWORD_RECOVERY', { user: harness.user });
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
}

{
  const harness = makeRecoveryHarness();
  const pendingInitialization = deferred();
  harness.client.auth.initialize = () => pendingInitialization.promise;
  let scrubAttempts = 0;
  const controller = createPasswordRecoveryController(harness.client, {
    location: {
      href: `${productionReset}?code=unscrubbable-cleanup-code`,
      pathname: '/reset-password.html',
      search: '?code=unscrubbable-cleanup-code',
      hash: '',
    },
    history: { replaceState() { scrubAttempts += 1; throw new Error('private history failure'); } },
    setTimer() { return 1; },
    clearTimer() {},
  });
  void controller.activate();
  assert.equal(controller.cleanup(), true);
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.equal(scrubAttempts, 1);
  assert.equal((await controller.update({
    password: 'StrongPass1',
    confirmPassword: 'StrongPass1',
  })).status, PASSWORD_RECOVERY_STATUS.STALE);
  pendingInitialization.resolve({ error: null });
}

{
  const harness = makeRecoveryHarness();
  harness.client.auth.initialize = async () => { throw new Error('private initialization failure'); };
  const { controller, scrubbed: rejectionScrubs } = controllerFor(harness);
  assert.equal((await controller.activate()).status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.deepEqual(rejectionScrubs, [[null, '', '/reset-password.html']]);
}

{
  const harness = makeRecoveryHarness();
  const location = {
    href: `${productionReset}?code=one&code=two`,
    pathname: '/reset-password.html',
    search: '?code=one&code=two',
    hash: '',
  };
  const invalidScrubs = [];
  const controller = createPasswordRecoveryController(harness.client, {
    location,
    history: { replaceState(...args) { invalidScrubs.push(args); } },
  });
  assert.equal((await controller.activate()).status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.deepEqual(invalidScrubs, [[null, '', '/reset-password.html']]);
  assert.equal(harness.calls.initialize, 0);
}

{
  const harness = makeRecoveryHarness();
  const location = {
    href: `${productionReset}?code=sensitive-scrub-failure`,
    pathname: '/reset-password.html',
    search: '?code=sensitive-scrub-failure',
    hash: '',
  };
  const controller = createPasswordRecoveryController(harness.client, {
    location,
    history: { replaceState() { throw new Error('private history failure'); } },
    setTimer() { return 1; },
    clearTimer() {},
  });
  assert.equal((await controller.activate()).status, PASSWORD_RECOVERY_STATUS.INVALID);
  assert.equal(controller.getState().status, PASSWORD_RECOVERY_STATUS.INVALID);
}

let settleUpdate;
const lateHarness = makeRecoveryHarness();
lateHarness.client.auth.updateUser = () => new Promise((resolve) => { settleUpdate = resolve; });
const { controller: lateController } = controllerFor(lateHarness);
await lateController.activate();
const lateUpdate = lateController.update({ password: 'StrongPass1', confirmPassword: 'StrongPass1' });
lateController.cleanup();
settleUpdate({ data: { user: lateHarness.user }, error: null });
assert.equal((await lateUpdate).status, PASSWORD_RECOVERY_STATUS.STALE);
assert.equal(lateHarness.calls.signOut.length, 0);

const duplicateHarness = makeRecoveryHarness();
let settleDuplicate;
duplicateHarness.client.auth.updateUser = (attributes) => {
  duplicateHarness.calls.update.push(attributes);
  return new Promise((resolve) => { settleDuplicate = resolve; });
};
const { controller: duplicateController } = controllerFor(duplicateHarness);
await duplicateController.activate();
const duplicateA = duplicateController.update({ password: 'StrongPass1', confirmPassword: 'StrongPass1' });
const duplicateB = duplicateController.update({ password: 'StrongPass1', confirmPassword: 'StrongPass1' });
assert.equal(duplicateA, duplicateB);
settleDuplicate({ data: { user: duplicateHarness.user }, error: null });
await duplicateA;
assert.equal(duplicateHarness.calls.update.length, 1);

for (const terminalStatus of [PASSWORD_RECOVERY_STATUS.UPDATED, PASSWORD_RECOVERY_STATUS.SIGN_OUT_FAILED]) {
  const view = makeResetForm();
  const fakeController = makeResetActivationController({ updateStatus: terminalStatus });
  const configLoad = deferred();
  const activation = createPasswordResetActivation({
    documentLike: { querySelector() { return view.form; } },
    locationLike: {
      href: `${productionReset}?code=browser-code`,
      pathname: '/reset-password.html',
      search: '?code=browser-code',
      hash: '',
    },
    historyLike: { replaceState() {} },
    loadConfig: () => configLoad.promise,
    createClientOwner: () => ({ initialize() { return {}; } }),
    createController: () => fakeController.controller,
  });
  const activating = activation.activate();
  assert.equal(view.fields.disabled, true, 'The reset form must start locked.');
  configLoad.resolve({ SUPABASE_CONFIG: Object.freeze({}) });
  assert.equal(await activating, true);
  assert.equal(view.fields.disabled, false, 'Only verified recovery authorization unlocks the form.');
  await view.form.dispatch('submit');
  assert.equal(view.fields.disabled, true);
  assert.equal(view.password.value, '');
  assert.equal(view.confirmPassword.value, '');
  if (terminalStatus === PASSWORD_RECOVERY_STATUS.SIGN_OUT_FAILED) {
    assert.match(view.status.textContent, /could not confirm account-wide sign-out/i);
  }
  assert.equal(activation.cleanup(), true);
  assert.equal(fakeController.calls.unsubscribe, 1);
  assert.equal(fakeController.calls.cleanup, 1);
  assert.equal(view.handlers.has('submit'), false);
}

{
  const view = makeResetForm();
  const fakeController = makeResetActivationController();
  const activation = createPasswordResetActivation({
    documentLike: { querySelector() { return view.form; } },
    locationLike: {
      href: `${productionReset}?code=browser-code`,
      pathname: '/reset-password.html',
      search: '?code=browser-code',
      hash: '',
    },
    historyLike: { replaceState() {} },
    loadConfig: async () => ({ SUPABASE_CONFIG: Object.freeze({}) }),
    createClientOwner: () => ({ initialize() { return {}; } }),
    createController: () => fakeController.controller,
  });
  await activation.activate();
  fakeController.publish(Object.freeze({
    status: PASSWORD_RECOVERY_STATUS.INVALID,
    message: PASSWORD_RECOVERY_MESSAGES.INVALID,
  }));
  assert.equal(view.fields.disabled, true, 'Terminal invalidation must relock the reset form.');
  activation.cleanup();
}

{
  const view = makeResetForm();
  const pendingInitialization = deferred();
  const pageListeners = new Map();
  const historyCalls = [];
  let initializeCalls = 0;
  let unsubscribeCalls = 0;
  const savedGlobals = new Map(
    ['document', 'location', 'history', 'supabase', 'addEventListener'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ])
  );
  const installGlobal = (name, value) => Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  try {
    installGlobal('document', {
      body: { dataset: { passwordRecoveryPage: 'reset' } },
      querySelector() { return view.form; },
    });
    installGlobal('location', {
      href: `${productionReset}?code=pagehide-sensitive-code`,
      pathname: '/reset-password.html',
      search: '?code=pagehide-sensitive-code',
      hash: '',
    });
    installGlobal('history', { replaceState(...args) { historyCalls.push(args); } });
    installGlobal('supabase', {
      createClient() {
        return { auth: {
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() { unsubscribeCalls += 1; } } } };
          },
          initialize() {
            initializeCalls += 1;
            return pendingInitialization.promise;
          },
          async updateUser() { return { data: null, error: { message: 'not used' } }; },
          async signOut() { return { error: null }; },
        } };
      },
    });
    installGlobal('addEventListener', (name, listener) => { pageListeners.set(name, listener); });
    await import(`../js/password-recovery-browser.js?pagehide-cleanup=${Date.now()}`);
    for (let attempt = 0; attempt < 10 && initializeCalls === 0; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(initializeCalls, 1);
    assert.equal(typeof pageListeners.get('pagehide'), 'function');
    assert.equal(view.fields.disabled, true);
    pageListeners.get('pagehide')();
    assert.equal(view.fields.disabled, true);
    assert.equal(view.password.value, '');
    assert.equal(view.confirmPassword.value, '');
    assert.deepEqual(historyCalls, [[null, '', '/reset-password.html']]);
    assert.equal(unsubscribeCalls, 1);
    pendingInitialization.resolve({ error: null });
  } finally {
    for (const [name, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

const loginHtml = await readFile(new URL('../login.html', import.meta.url), 'utf8');
const requestHtml = await readFile(new URL('../forgot-password.html', import.meta.url), 'utf8');
const resetHtml = await readFile(new URL('../reset-password.html', import.meta.url), 'utf8');
const browserSource = await readFile(new URL('../js/password-recovery-browser.js', import.meta.url), 'utf8');
assert.match(loginHtml, /href="forgot-password\.html"/);
assert.doesNotMatch(loginHtml, /data-forgot-password|href="#forgot-password"/);
assert.match(requestHtml, /data-password-recovery-request/);
assert.match(resetHtml, /data-password-reset/);
assert.match(resetHtml, /autocomplete="new-password"/g);
assert.doesNotMatch(`${requestHtml}${resetHtml}${browserSource}`, /service.?role|sb_secret_|console\.|access_token|refresh_token/i);
assert.doesNotMatch(browserSource, /createClient\s*\(/, 'Recovery pages must use the shared page-client owner.');

console.log('Offline password recovery tests passed with fake Supabase clients only.');
