import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LOGIN_MESSAGES,
  LOGIN_STATUS,
  createLoginService,
} from '../js/login.js';
import {
  activateLoginSubmitController,
  createAuthFormSubmitHandler,
  createLoginSubmitController,
  deactivateLoginSubmitController,
} from '../js/auth-ui.js';
import { createLoginControllerActivation } from '../js/login-browser.js';

const validInput = Object.freeze({ email: '  cook@example.test  ', password: 'StrongPass1' });
const confirmedUser = Object.freeze({
  id: 'confirmed-user',
  email: 'cook@example.test',
  email_confirmed_at: '2026-10-29T08:00:00+08:00',
});

function authData(user = confirmedUser) {
  return {
    user,
    session: {
      user: { ...user },
      access_token: 'fixture-access-token',
      refresh_token: 'fixture-refresh-token',
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function createFakeClient({ signIn, signOut } = {}) {
  const calls = { signIn: [], signOut: [] };
  return {
    client: {
      auth: {
        async signInWithPassword(credentials) {
          calls.signIn.push(credentials);
          return signIn ? signIn(credentials) : { data: authData(), error: null };
        },
        async signOut(options) {
          calls.signOut.push(options);
          return signOut ? signOut(options) : { error: null };
        },
      },
    },
    calls,
  };
}

const confirmedFake = createFakeClient();
const confirmedResult = await createLoginService(confirmedFake.client).submit(validInput);
assert.deepEqual(confirmedResult, {
  status: LOGIN_STATUS.AUTHENTICATED,
  message: LOGIN_MESSAGES.AUTHENTICATED,
});
assert.deepEqual(confirmedFake.calls.signIn, [{ email: 'cook@example.test', password: 'StrongPass1' }]);
assert.deepEqual(confirmedFake.calls.signOut, []);
assert.equal(Object.isFrozen(confirmedResult), true);

for (const [input, expectedField] of [
  [{ ...validInput, email: 'not-an-email' }, 'email'],
  [{ ...validInput, password: '' }, 'password'],
]) {
  const fake = createFakeClient();
  const result = await createLoginService(fake.client).submit(input);
  assert.equal(result.status, LOGIN_STATUS.INVALID);
  assert.ok(result.errors[expectedField]);
  assert.equal(fake.calls.signIn.length, 0);
  assert.equal(fake.calls.signOut.length, 0);
}

const rejectedCredentialsFake = createFakeClient({
  signIn: async () => ({ data: null, error: new Error('Invalid login credentials') }),
});
const rejectedCredentialsResult = await createLoginService(rejectedCredentialsFake.client).submit(validInput);
assert.deepEqual(rejectedCredentialsResult, { status: LOGIN_STATUS.UNAVAILABLE, message: LOGIN_MESSAGES.UNAVAILABLE });
assert.deepEqual(rejectedCredentialsFake.calls.signOut, [], 'An explicit provider failure without session evidence needs no cleanup');

for (const response of [
  { error: new Error('missing data') },
  { data: undefined, error: new Error('undefined data') },
  { data: {}, error: new Error('empty data') },
  { data: { session: undefined }, error: new Error('undefined session') },
  { data: null, error: false },
  { data: null, error: 0 },
  { data: null, error: '' },
  { data: null, error: {} },
  { data: null, error: { message: '   ' } },
]) {
  const fake = createFakeClient({ signIn: async () => response });
  const result = await createLoginService(fake.client).submit(validInput);
  assert.deepEqual(result, { status: LOGIN_STATUS.UNAVAILABLE, message: LOGIN_MESSAGES.UNAVAILABLE });
  assert.deepEqual(
    fake.calls.signOut,
    [{ scope: 'local' }],
    'Malformed provider failure envelopes require exactly one local containment attempt'
  );
  assert.doesNotMatch(JSON.stringify(result), /missing data|undefined data|empty data|undefined session|token|password/i);
}

for (const signIn of [
  async () => { throw new Error('offline network detail'); },
  () => Promise.reject(new Error('offline rejected provider detail')),
]) {
  const fake = createFakeClient({ signIn });
  const result = await createLoginService(fake.client).submit(validInput);
  assert.deepEqual(result, { status: LOGIN_STATUS.UNAVAILABLE, message: LOGIN_MESSAGES.UNAVAILABLE });
  assert.deepEqual(fake.calls.signOut, [{ scope: 'local' }], 'An uncertain provider exception requires one containment attempt');
  assert.doesNotMatch(JSON.stringify(result), /network detail|rejected provider|StrongPass1|fixture-access-token/);
}

for (const response of [
  { data: authData() },
  { data: authData(), error: undefined },
]) {
  const fake = createFakeClient({ signIn: async () => response });
  assert.deepEqual(await createLoginService(fake.client).submit(validInput), {
    status: LOGIN_STATUS.UNAVAILABLE,
    message: LOGIN_MESSAGES.UNAVAILABLE,
  }, 'Sign-in success requires an explicit own error property equal to null');
  assert.deepEqual(fake.calls.signOut, [{ scope: 'local' }]);
}

const pendingRequest = deferred();
const pendingFake = createFakeClient({ signIn: () => pendingRequest.promise });
const pendingService = createLoginService(pendingFake.client);
const firstRequest = pendingService.submit(validInput);
assert.deepEqual(await pendingService.submit(validInput), { status: LOGIN_STATUS.PENDING });
assert.equal(pendingFake.calls.signIn.length, 1, 'A concurrent submission must not call Auth twice');
pendingRequest.resolve({ data: authData(), error: null });
assert.equal((await firstRequest).status, LOGIN_STATUS.AUTHENTICATED);

for (const user of [
  { id: 'pending-user', email: 'cook@example.test', email_confirmed_at: null },
  { id: 'pending-user', email: 'cook@example.test', email_confirmed_at: '2026-02-29T00:00:00Z' },
  { id: 'pending-user', email: 'cook@example.test', confirmed_at: '2026-10-29T00:00:00Z' },
]) {
  const fake = createFakeClient({ signIn: async () => ({ data: authData(user), error: null }) });
  const result = await createLoginService(fake.client).submit(validInput);
  assert.deepEqual(result, {
    status: LOGIN_STATUS.PENDING_CONFIRMATION,
    message: LOGIN_MESSAGES.PENDING_CONFIRMATION,
  });
  assert.deepEqual(fake.calls.signOut, [{ scope: 'local' }]);
}

for (const signOut of [
  async () => null,
  async () => [],
  async () => ({}),
  async () => ({ data: null }),
  async () => ({ error: undefined }),
  async () => ({ error: new Error('local sign-out failed') }),
  () => { throw new Error('synchronous local sign-out exception'); },
  () => Promise.reject(new Error('rejected local sign-out promise')),
  async () => { throw new Error('local sign-out exception'); },
]) {
  const pendingUser = { id: 'pending-user', email_confirmed_at: null };
  const fake = createFakeClient({
    signIn: async () => ({ data: authData(pendingUser), error: null }),
    signOut,
  });
  assert.deepEqual(await createLoginService(fake.client).submit(validInput), {
    status: LOGIN_STATUS.UNAVAILABLE,
    message: LOGIN_MESSAGES.UNAVAILABLE,
  });
  assert.deepEqual(fake.calls.signOut, [{ scope: 'local' }]);
}

assert.throws(() => createLoginService(), /compatible Supabase Auth login client/);
assert.throws(() => createLoginService({ auth: {} }), /compatible Supabase Auth login client/);
assert.throws(
  () => createLoginService({ auth: { signInWithPassword() {} } }),
  /compatible Supabase Auth login client/
);

const decoratedData = [];
decoratedData.user = confirmedUser;
decoratedData.session = authData().session;
const decoratedResponse = [];
decoratedResponse.data = authData();
decoratedResponse.error = null;
const decoratedSession = [];
decoratedSession.user = { ...confirmedUser };
decoratedSession.access_token = 'fixture-access-token';
decoratedSession.refresh_token = 'fixture-refresh-token';
const decoratedUser = [];
decoratedUser.id = confirmedUser.id;
decoratedUser.email_confirmed_at = confirmedUser.email_confirmed_at;

for (const response of [
  null,
  undefined,
  false,
  [],
  decoratedResponse,
  {},
  { data: null, error: null },
  { data: false, error: null },
  { data: decoratedData, error: null },
  { data: { user: confirmedUser }, error: null },
  { data: { user: false, session: authData().session }, error: null },
  { data: { user: confirmedUser, session: false }, error: null },
  { data: { user: confirmedUser, session: {} }, error: null },
  { data: { user: confirmedUser, session: decoratedSession }, error: null },
  { data: { user: decoratedUser, session: authData().session }, error: null },
  { data: { user: confirmedUser, session: { ...authData().session, access_token: '   ' } }, error: null },
  { data: { user: confirmedUser, session: { ...authData().session, refresh_token: '\t' } }, error: null },
  { data: { user: { ...confirmedUser, id: ' ' }, session: authData().session }, error: null },
  { data: { user: confirmedUser, session: { ...authData().session, user: { ...confirmedUser, id: '\n' } } }, error: null },
  {
    data: {
      user: confirmedUser,
      session: { user: { ...confirmedUser, id: 'different-user' } },
    },
    error: null,
  },
]) {
  const fake = createFakeClient({ signIn: async () => response });
  assert.deepEqual(await createLoginService(fake.client).submit(validInput), {
    status: LOGIN_STATUS.UNAVAILABLE,
    message: LOGIN_MESSAGES.UNAVAILABLE,
  });
  assert.deepEqual(fake.calls.signOut, [{ scope: 'local' }], 'Malformed or mismatched success responses require containment');
}

function withThrowingGetter(target, property, message) {
  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: true,
    get() { throw new Error(message); },
  });
  return target;
}

const throwingDataResponse = withThrowingGetter({ error: null }, 'data', 'raw data getter detail');
const throwingErrorResponse = withThrowingGetter({ data: authData() }, 'error', 'raw error getter detail');
const throwingSessionData = withThrowingGetter({ user: confirmedUser }, 'session', 'raw session getter detail');
const throwingUserData = withThrowingGetter({ session: authData().session }, 'user', 'raw user getter detail');
const throwingTokenSession = withThrowingGetter(
  { refresh_token: 'fixture-refresh-token', user: { ...confirmedUser } },
  'access_token',
  'raw token getter detail'
);
const throwingIdentityUser = withThrowingGetter(
  { email_confirmed_at: confirmedUser.email_confirmed_at },
  'id',
  'raw identity getter detail'
);
const throwingConfirmationUser = withThrowingGetter(
  { id: confirmedUser.id },
  'email_confirmed_at',
  'raw confirmation getter detail'
);
const throwingValidationProxy = new Proxy(authData(), {
  get(target, property, receiver) {
    if (property === 'user') throw new Error('raw validation proxy detail');
    return Reflect.get(target, property, receiver);
  },
});
const throwingEvidenceProxy = new Proxy({}, {
  get(_target, property) {
    if (property === 'session') throw new Error('raw evidence proxy detail');
    return undefined;
  },
});

for (const response of [
  throwingDataResponse,
  throwingErrorResponse,
  { data: throwingSessionData, error: null },
  { data: throwingUserData, error: null },
  { data: { user: confirmedUser, session: throwingTokenSession }, error: null },
  { data: { user: throwingIdentityUser, session: authData().session }, error: null },
  {
    data: {
      user: throwingConfirmationUser,
      session: { ...authData().session, user: throwingConfirmationUser },
    },
    error: null,
  },
  { data: throwingValidationProxy, error: null },
  { data: throwingEvidenceProxy, error: new Error('explicit provider failure with uncertain session evidence') },
]) {
  const fake = createFakeClient({ signIn: async () => response });
  const result = await createLoginService(fake.client).submit(validInput);
  assert.deepEqual(result, { status: LOGIN_STATUS.UNAVAILABLE, message: LOGIN_MESSAGES.UNAVAILABLE });
  assert.deepEqual(
    fake.calls.signOut,
    [{ scope: 'local' }],
    'A throwing accessor or proxy must trigger exactly one local containment attempt'
  );
  assert.doesNotMatch(JSON.stringify(result), /getter|proxy|provider failure|token|session|password/i);
}

for (const response of [
  { data: authData(), error: new Error('provider error with session') },
  { data: { session: 'possible-session' }, error: new Error('provider error with malformed session') },
]) {
  const fake = createFakeClient({ signIn: async () => response });
  const result = await createLoginService(fake.client).submit(validInput);
  assert.deepEqual(result, { status: LOGIN_STATUS.UNAVAILABLE, message: LOGIN_MESSAGES.UNAVAILABLE });
  assert.deepEqual(fake.calls.signOut, [{ scope: 'local' }]);
  assert.doesNotMatch(JSON.stringify(result), /provider error|possible-session|fixture-access-token/);
}

const neverSettlingCleanup = deferred();
let neverSettlingSignInCalls = 0;
const neverSettlingFake = createFakeClient({
  signIn: async () => {
    neverSettlingSignInCalls += 1;
    return { data: authData({ ...confirmedUser, email_confirmed_at: null }), error: null };
  },
  signOut: () => neverSettlingCleanup.promise,
});
const neverSettlingService = createLoginService(neverSettlingFake.client);
const cleanupRequest = neverSettlingService.submit(validInput);
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(await neverSettlingService.submit(validInput), { status: LOGIN_STATUS.PENDING });
assert.equal(neverSettlingSignInCalls, 1);
assert.deepEqual(neverSettlingFake.calls.signOut, [{ scope: 'local' }]);
neverSettlingCleanup.resolve({ error: null });
assert.equal((await cleanupRequest).status, LOGIN_STATUS.PENDING_CONFIRMATION);

let recoveryAttempt = 0;
const recoveryFake = createFakeClient({
  signIn: async () => {
    recoveryAttempt += 1;
    return recoveryAttempt === 1
      ? { data: null, error: new Error('fixture failure') }
      : { data: authData(), error: null };
  },
});
const recoveryService = createLoginService(recoveryFake.client);
assert.equal((await recoveryService.submit(validInput)).status, LOGIN_STATUS.UNAVAILABLE);
assert.equal((await recoveryService.submit(validInput)).status, LOGIN_STATUS.AUTHENTICATED);
assert.equal(recoveryFake.calls.signIn.length, 2, 'A settled failure must allow a later explicit retry');

const serializedResults = JSON.stringify([
  confirmedResult,
  await recoveryService.submit(validInput),
]);
assert.doesNotMatch(serializedResults, /StrongPass1|fixture-access-token|fixture-refresh-token|cook@example\.test/);

const source = await readFile(new URL('../js/login.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /console\.|localStorage|sessionStorage|\bfetch\s*\(|XMLHttpRequest|WebSocket/);
assert.doesNotMatch(source, /createClient|initializeSupabaseClient|location\.|window\.|document\./);
assert.doesNotMatch(source, /raw_user_meta_data|user_metadata/);

class FakeInput {
  constructor(name, value) {
    this.name = name;
    this.value = value;
    this.attributes = new Map();
    this.focusCalls = 0;
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() { this.focusCalls += 1; }
}

globalThis.HTMLInputElement = FakeInput;

function createFakeForm({ email = validInput.email, password = validInput.password } = {}) {
  const fields = new Map([
    ['email', new FakeInput('email', email)],
    ['password', new FakeInput('password', password)],
  ]);
  const errors = new Map([
    ['email', { textContent: '' }],
    ['password', { textContent: '' }],
  ]);
  const status = {
    textContent: '',
    classList: { isError: false, toggle(_name, enabled) { this.isError = enabled; } },
  };
  const submitButton = { disabled: false };
  const attributes = new Map();
  return {
    dataset: { authForm: 'login' },
    elements: { namedItem: (name) => fields.get(name) ?? null },
    setAttribute: (name, value) => attributes.set(name, value),
    querySelector(selector) {
      if (selector === '[type="submit"]') return submitButton;
      if (selector === '[data-form-status]') return status;
      if (selector === '[aria-invalid="true"]') {
        return [...fields.values()].find((field) => field.attributes.get('aria-invalid') === 'true') ?? null;
      }
      const match = /^\[data-error-for="(.+)"\]$/.exec(selector);
      return match ? errors.get(match[1]) ?? null : null;
    },
    fields,
    errors,
    status,
    submitButton,
    attributes,
  };
}

let releaseControllerRequest;
let controllerSubmitCalls = 0;
const submitController = createLoginSubmitController(() => {
  controllerSubmitCalls += 1;
  return new Promise((resolve) => {
    releaseControllerRequest = () => resolve({
      status: LOGIN_STATUS.AUTHENTICATED,
      message: LOGIN_MESSAGES.AUTHENTICATED,
    });
  });
});
const controllerForm = createFakeForm();
const controlledRequest = submitController.submit(validInput, { form: controllerForm });
assert.equal(controllerForm.submitButton.disabled, true);
assert.equal(controllerForm.attributes.get('aria-busy'), 'true');
assert.deepEqual(await submitController.submit(validInput, { form: controllerForm }), { status: LOGIN_STATUS.PENDING });
assert.equal(controllerSubmitCalls, 1);
releaseControllerRequest();
assert.equal((await controlledRequest).status, LOGIN_STATUS.AUTHENTICATED);
assert.equal(controllerForm.submitButton.disabled, false);
assert.equal(controllerForm.attributes.get('aria-busy'), 'false');
assert.equal(controllerForm.fields.get('password').value, '');

const invalidForm = createFakeForm({ email: 'invalid', password: '' });
const invalidHandler = createAuthFormSubmitHandler(invalidForm);
await invalidHandler({ preventDefault() {} });
assert.equal(invalidForm.fields.get('email').focusCalls, 1, 'The first invalid field must receive focus');
assert.equal(invalidForm.status.textContent, 'Please review the highlighted fields.');
assert.equal(invalidForm.status.classList.isError, true);

const sanitizedForm = createFakeForm();
const sanitizedController = createLoginSubmitController(async () => ({
  status: 'unknown-provider-status',
  message: 'raw provider secret',
  session: { access_token: 'never-render' },
}));
const sanitizedResult = await sanitizedController.submit(validInput, { form: createFakeForm() });
assert.deepEqual(sanitizedResult, {
  status: LOGIN_STATUS.UNAVAILABLE,
  message: LOGIN_MESSAGES.UNAVAILABLE,
});
assert.doesNotMatch(JSON.stringify(sanitizedResult), /provider|secret|token|session/);
assert.equal(activateLoginSubmitController(sanitizedController), true);
await createAuthFormSubmitHandler(sanitizedForm)({ preventDefault() {} });
assert.equal(sanitizedForm.status.textContent, LOGIN_MESSAGES.UNAVAILABLE);
assert.doesNotMatch(sanitizedForm.status.textContent, /provider|secret|token/);
assert.equal(deactivateLoginSubmitController(sanitizedController), true);

const missingResultForm = createFakeForm();
const missingResultController = createLoginSubmitController(async () => null);
assert.equal((await missingResultController.submit(validInput, { form: missingResultForm })).status, LOGIN_STATUS.UNAVAILABLE);
assert.equal(missingResultForm.fields.get('password').value, '');
assert.throws(() => createLoginSubmitController(), /submit function is required/i);

let installedController;
let removedController;
let serviceCreations = 0;
const activation = createLoginControllerActivation({
  client: { kind: 'offline-fake-client' },
  createService(client) {
    serviceCreations += 1;
    assert.deepEqual(client, { kind: 'offline-fake-client' });
    return { submit: async () => ({ status: LOGIN_STATUS.AUTHENTICATED }) };
  },
  installController(controller) {
    installedController = controller;
    return true;
  },
  removeController(controller) {
    removedController = controller;
    return true;
  },
});
assert.equal(serviceCreations, 0, 'Creating the activation context must remain inert');
assert.equal(activation.activate(), true);
assert.equal(activation.activate(), true);
assert.equal(serviceCreations, 1, 'Repeated activation must reuse one controller context');
assert.equal(typeof installedController.submit, 'function');
assert.equal(activation.cleanup(), true);
assert.equal(removedController, installedController);
assert.equal(activation.cleanup(), false, 'Cleanup must be idempotent');
assert.equal(createLoginControllerActivation({}).activate(), false, 'Missing dependencies must fail closed');

const defaultClientFake = createFakeClient();
let defaultController;
const defaultActivation = createLoginControllerActivation({
  client: defaultClientFake.client,
  installController(controller) {
    defaultController = controller;
    return true;
  },
  removeController: () => true,
});
assert.equal(defaultActivation.activate(), true, 'An explicitly supplied client must use the login service');
assert.equal((await defaultController.submit(validInput, { form: createFakeForm() })).status, LOGIN_STATUS.AUTHENTICATED);
assert.equal(defaultClientFake.calls.signIn.length, 1);
assert.equal(defaultActivation.cleanup(), true);

const cleanupFailureActivation = createLoginControllerActivation({
  loginService: { submit: async () => ({ status: LOGIN_STATUS.AUTHENTICATED }) },
  installController: () => true,
  removeController: () => { throw new Error('offline cleanup fixture'); },
});
assert.equal(cleanupFailureActivation.activate(), true);
assert.equal(cleanupFailureActivation.cleanup(), false, 'Cleanup dependency failures must remain contained');

function deferredLoginResult() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

const lifecycleRequests = [];
let lifecycleServiceCalls = 0;
const lifecycleActivation = createLoginControllerActivation({
  loginService: {
    submit() {
      lifecycleServiceCalls += 1;
      const request = deferredLoginResult();
      lifecycleRequests.push(request);
      return request.promise;
    },
  },
});
assert.equal(lifecycleActivation.activate(), true);
const lifecycleForm = createFakeForm();
const lifecycleHandler = createAuthFormSubmitHandler(lifecycleForm);
const firstLifecycleSubmission = lifecycleHandler({ preventDefault() {} });
assert.equal(lifecycleServiceCalls, 1);
assert.equal(lifecycleForm.submitButton.disabled, true);
assert.equal(lifecycleForm.attributes.get('aria-busy'), 'true');
assert.equal(lifecycleActivation.cleanup(), true);
assert.equal(lifecycleForm.submitButton.disabled, false, 'Cleanup must restore the pending button state');
assert.equal(lifecycleForm.attributes.get('aria-busy'), 'false');
assert.equal(lifecycleForm.fields.get('password').value, validInput.password, 'Cleanup must not clear the password');
assert.equal(lifecycleActivation.activate(), true, 'The same controller context must support reactivation');
assert.equal(lifecycleForm.submitButton.disabled, true, 'Reactivation must restore the outstanding pending state');
const blockedLifecycleSubmission = lifecycleHandler({ preventDefault() {} });
await blockedLifecycleSubmission;
assert.equal(lifecycleServiceCalls, 1, 'Reactivation must not bypass the outstanding request guard');
lifecycleRequests[0].resolve({ status: LOGIN_STATUS.AUTHENTICATED });
await firstLifecycleSubmission;
assert.notEqual(lifecycleForm.status.textContent, LOGIN_MESSAGES.AUTHENTICATED, 'A stale handler must not publish success');
assert.equal(lifecycleForm.submitButton.disabled, false);
assert.equal(lifecycleForm.attributes.get('aria-busy'), 'false');
assert.equal(lifecycleForm.fields.get('password').value, validInput.password, 'A stale completion must not clear the password');

const nextLifecycleSubmission = lifecycleHandler({ preventDefault() {} });
assert.equal(lifecycleServiceCalls, 2, 'A new submission may proceed after the old request settles');
lifecycleRequests[1].resolve({ status: LOGIN_STATUS.AUTHENTICATED });
await nextLifecycleSubmission;
assert.equal(lifecycleForm.status.textContent, LOGIN_MESSAGES.AUTHENTICATED);
assert.equal(lifecycleForm.fields.get('password').value, '');
assert.equal(lifecycleActivation.cleanup(), true);
assert.equal(lifecycleActivation.cleanup(), false);
assert.equal(lifecycleActivation.activate(), true);
assert.equal(lifecycleActivation.activate(), true);
assert.equal(lifecycleActivation.cleanup(), true);

for (const settle of ['failure', 'rejection']) {
  const request = deferredLoginResult();
  const form = createFakeForm();
  const activation = createLoginControllerActivation({
    loginService: {
      submit: settle === 'failure'
        ? () => request.promise
        : () => request.promise,
    },
  });
  assert.equal(activation.activate(), true);
  const submission = createAuthFormSubmitHandler(form)({ preventDefault() {} });
  assert.equal(activation.cleanup(), true);
  if (settle === 'failure') {
    request.resolve({ status: LOGIN_STATUS.UNAVAILABLE, message: LOGIN_MESSAGES.UNAVAILABLE });
  } else {
    request.reject(new Error('offline rejected service fixture'));
  }
  await submission;
  assert.equal(form.status.textContent, '', `Late ${settle} must not publish status`);
  assert.equal(form.fields.get('password').value, validInput.password, `Late ${settle} must not clear password`);
  assert.equal(form.submitButton.disabled, false);
  assert.equal(form.attributes.get('aria-busy'), 'false');
}

const synchronousFailureForm = createFakeForm();
const synchronousFailureController = createLoginSubmitController(() => {
  throw new Error('offline synchronous service fixture');
});
assert.deepEqual(await synchronousFailureController.submit(validInput, { form: synchronousFailureForm }), {
  status: LOGIN_STATUS.UNAVAILABLE,
  message: LOGIN_MESSAGES.UNAVAILABLE,
});
assert.equal(synchronousFailureForm.submitButton.disabled, false);
assert.equal(synchronousFailureForm.attributes.get('aria-busy'), 'false');

const crossContextRequestA = deferredLoginResult();
const crossContextRequestB = deferredLoginResult();
let crossContextCallsA = 0;
let crossContextCallsB = 0;
const crossContextActivationA = createLoginControllerActivation({
  loginService: {
    submit() {
      crossContextCallsA += 1;
      return crossContextRequestA.promise;
    },
  },
});
assert.equal(crossContextActivationA.activate(), true);
const crossContextFormA = createFakeForm();
const crossContextSubmissionA = createAuthFormSubmitHandler(crossContextFormA)({ preventDefault() {} });
assert.equal(crossContextCallsA, 1);
assert.equal(crossContextActivationA.cleanup(), true);

let crossContextControllerB;
const crossContextActivationB = createLoginControllerActivation({
  loginService: {
    submit() {
      crossContextCallsB += 1;
      return crossContextRequestB.promise;
    },
  },
  createController(submitLogin) {
    crossContextControllerB = createLoginSubmitController(submitLogin);
    return crossContextControllerB;
  },
});
assert.equal(crossContextActivationB.activate(), false, 'Replacement activation must fail while older work is pending');
assert.deepEqual(await crossContextControllerB.submit(validInput, { form: createFakeForm() }), {
  status: LOGIN_STATUS.UNAVAILABLE,
  message: LOGIN_MESSAGES.UNAVAILABLE,
});
assert.equal(crossContextCallsB, 0, 'A rejected replacement controller must not call its service');
assert.equal(crossContextActivationB.cleanup(), false);

crossContextRequestA.resolve({ status: LOGIN_STATUS.AUTHENTICATED });
await crossContextSubmissionA;
assert.equal(crossContextFormA.status.textContent, '', 'Retired work must not publish after cleanup');
assert.equal(crossContextFormA.fields.get('password').value, validInput.password);
assert.equal(crossContextActivationB.activate(), true, 'Replacement activation must succeed after settlement');
const crossContextFormB = createFakeForm();
const crossContextSubmissionB = createAuthFormSubmitHandler(crossContextFormB)({ preventDefault() {} });
assert.equal(crossContextCallsA + crossContextCallsB, 2, 'Only a post-settlement submission may create call two');
crossContextRequestB.resolve({ status: LOGIN_STATUS.AUTHENTICATED });
await crossContextSubmissionB;
assert.equal(crossContextFormB.status.textContent, LOGIN_MESSAGES.AUTHENTICATED);
assert.equal(crossContextActivationB.cleanup(), true);
assert.equal(crossContextActivationB.cleanup(), false);

const loginHtml = await readFile(new URL('../login.html', import.meta.url), 'utf8');
assert.doesNotMatch(loginHtml, /login-browser\.js|supabase-client\.js|supabase-config\.js|supabase\.js/i);
assert.match(loginHtml, /<script type="module" src="js\/auth-ui\.js"><\/script>/);
assert.match(loginHtml, /Authentication is not connected yet\. This form never sends or stores your credentials\./);
const browserSource = await readFile(new URL('../js/login-browser.js', import.meta.url), 'utf8');
assert.doesNotMatch(browserSource, /addEventListener|createClient|initializeSupabaseClient|supabase-config|\bfetch\s*\(|localStorage|sessionStorage/);
const authUiSource = await readFile(new URL('../js/auth-ui.js', import.meta.url), 'utf8');
assert.match(authUiSource, /let pendingLoginOwnerToken = null;/, 'The shared pending owner must be an opaque token slot');
assert.match(authUiSource, /const ownerToken = Symbol\(['"]login-operation-owner['"]\);/);
assert.match(authUiSource, /const loginControllerOwnerTokens = new WeakMap\(\);/);
assert.match(authUiSource, /pendingLoginOwnerToken = ownerToken;/);
assert.doesNotMatch(authUiSource, /pendingLoginController/, 'The module must not retain a controller as pending owner');
assert.doesNotMatch(
  authUiSource,
  /pendingLoginOwnerToken\s*=\s*(?:controller|client|service|submitLogin|promise)/,
  'The pending owner must never retain a controller, client, service, function, or promise'
);

console.log('Offline login service tests passed with injected fake clients only.');
