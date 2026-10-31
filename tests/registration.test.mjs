import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  REGISTRATION_MESSAGES,
  REGISTRATION_STATUS,
  createRegistrationService,
  validateRegistrationInput,
} from '../js/registration.js';
import {
  REGISTRATION_CLIENT_STATE,
  createRegistrationClientActivation,
  createRegistrationComposition,
  createRegistrationControllerActivation,
  createRegistrationPageInitialization,
} from '../js/registration-browser.js';
import {
  activateRegistrationSubmitController,
  createAuthFormSubmitHandler,
  createRegistrationSubmitController,
  deactivateRegistrationSubmitController,
} from '../js/auth-ui.js';
import {
  SUPABASE_CLIENT_PROFILE,
  SupabaseConfigurationError,
  getSupabaseClientOptions,
} from '../js/supabase-client.js';

assert.equal(typeof createRegistrationClientActivation, 'function', 'The inert browser import seam must resolve');

const offlinePublicConfig = Object.freeze({
  url: 'https://recipefinder-test.supabase.co',
  publishableKey: 'sb_publishable_test_abcdefghijklmnopqrstuvwxyz',
});
let browserClientCreations = 0;
const offlineBrowserClient = Object.freeze({ auth: Object.freeze({}) });
const offlineSdk = Object.freeze({
  createClient(url, key, options) {
    browserClientCreations += 1;
    assert.equal(url, offlinePublicConfig.url);
    assert.equal(key, offlinePublicConfig.publishableKey);
    assert.equal(options.auth.skipAutoInitialize, true);
    return offlineBrowserClient;
  },
});

assert.equal(browserClientCreations, 0, 'Importing the live entrypoint must not create a client');
const activation = createRegistrationClientActivation({ config: offlinePublicConfig, sdk: offlineSdk });
assert.equal(browserClientCreations, 0, 'Creating an activation context must remain inert');
assert.equal(activation.activate(), offlineBrowserClient);
assert.equal(activation.activate(), offlineBrowserClient);
assert.equal(browserClientCreations, 1, 'One activation context must create at most one client');

assert.throws(
  () => createRegistrationClientActivation({ config: offlinePublicConfig }).activate(),
  /is not loaded/i
);
assert.throws(
  () => createRegistrationClientActivation({
    config: { ...offlinePublicConfig, publishableKey: 'service_role_forbidden_browser_key' },
    sdk: offlineSdk,
  }).activate(),
  /forbidden/i
);
assert.equal(browserClientCreations, 1, 'Rejected activation must not reach the SDK');

const controllerModule = await import('../js/registration-browser.js');
let preparedSubmitCalls = 0;
let installedController;
const controllerActivation = controllerModule.createRegistrationControllerActivation({
  registrationService: {
    async submit(input) {
      preparedSubmitCalls += 1;
      return { status: REGISTRATION_STATUS.SUBMITTED, message: REGISTRATION_MESSAGES.SUBMITTED, input };
    },
  },
  installController(controller) {
    installedController = controller;
    return true;
  },
});
assert.equal(preparedSubmitCalls, 0, 'Preparing controller activation must remain inert');
assert.equal(controllerActivation.activate(), true);
assert.equal(controllerActivation.activate(), true, 'Controller activation must be idempotent');
assert.equal(typeof installedController?.submit, 'function');
assert.equal(preparedSubmitCalls, 0, 'Explicit activation must not submit registration');
assert.equal(controllerModule.createRegistrationControllerActivation({}).activate(), false);
assert.equal(createRegistrationControllerActivation({ createController: null }).activate(), false);

let compositionClientInitializations = 0;
let compositionSignUpCalls = 0;
let compositionController;
const compositionClient = {
  auth: {
    async signUp() {
      compositionSignUpCalls += 1;
      return { data: { user: { id: 'composition-user' }, session: null }, error: null };
    },
    async signOut() {
      return { error: null };
    },
  },
};
const composition = createRegistrationComposition({
  clientActivation: {
    activate() {
      compositionClientInitializations += 1;
      return compositionClient;
    },
  },
  installController(controller) {
    compositionController = controller;
    return true;
  },
  removeController(controller) {
    assert.equal(controller, compositionController);
    return true;
  },
});
assert.equal(compositionClientInitializations, 0, 'Composition construction must remain import-inert');
assert.equal(compositionSignUpCalls, 0, 'Composition construction must not call Auth');
assert.equal(composition.activate(), true, 'Explicit composition activation must prepare the controller');
assert.equal(composition.activate(), true, 'Composition activation must be idempotent');
assert.equal(compositionClientInitializations, 1, 'The composed client activation must be cached');
assert.equal(compositionSignUpCalls, 0, 'Activation alone must not call signUp');
assert.equal(composition.cleanup(), true);
assert.equal(composition.cleanup(), false, 'Composition cleanup must be idempotent');
assert.equal(createRegistrationComposition({}).activate(), false, 'Missing composition dependencies must fail closed');
assert.equal(createRegistrationComposition({ createClientActivation: null }).activate(), false);
assert.equal(createRegistrationComposition({
  createClientActivation() { throw new Error('offline initializer fixture'); },
}).activate(), false, 'Synchronous dependency failures must remain contained');

let configLoads = 0;
const readinessRoot = { dataset: {} };
const pageInitialization = createRegistrationPageInitialization({
  loadConfig: async () => {
    configLoads += 1;
    return { SUPABASE_CONFIG: offlinePublicConfig };
  },
  sdk: offlineSdk,
  root: readinessRoot,
});
const firstPageInitialization = pageInitialization.initialize();
const secondPageInitialization = pageInitialization.initialize();
assert.equal(firstPageInitialization, secondPageInitialization, 'Page initialization must reuse one promise');
assert.equal(await firstPageInitialization, REGISTRATION_CLIENT_STATE.READY);
assert.equal(configLoads, 1, 'The ignored configuration module must be requested once per page context');
assert.equal(browserClientCreations, 2, 'Simulated page activation must construct exactly one additional client');
assert.equal(readinessRoot.dataset.supabaseClientState, REGISTRATION_CLIENT_STATE.READY);

let sharedCompositionClient;
let sharedCompositionInstalls = 0;
const sharedPageComposition = pageInitialization.createComposition({
  clientActivation: { activate() { throw new Error('must be replaced by the page owner'); } },
  createService(client) {
    sharedCompositionClient = client;
    return { submit: async () => ({ status: REGISTRATION_STATUS.UNAVAILABLE }) };
  },
  installController() {
    sharedCompositionInstalls += 1;
    return true;
  },
  removeController: () => true,
});
assert.equal(sharedPageComposition.activate(), true);
assert.equal(sharedCompositionClient, offlineBrowserClient, 'Readiness and controller composition must share one client');
assert.equal(sharedCompositionInstalls, 1);
assert.equal(browserClientCreations, 2, 'Preparing the controller must not construct a second page client');
assert.equal(sharedPageComposition.cleanup(), true);

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
  const unavailableInitialization = createRegistrationPageInitialization({ ...unavailableCase, root });
  assert.equal(await unavailableInitialization.initialize(), REGISTRATION_CLIENT_STATE.UNAVAILABLE, unavailableCase.name);
  assert.equal(root.dataset.supabaseClientState, REGISTRATION_CLIENT_STATE.UNAVAILABLE, unavailableCase.name);
}
assert.equal(browserClientCreations, 2, 'Failed page initialization must not reach the SDK');

const INITIALIZATION_FAILURE = 'Supabase client initialization failed.';
function assertSanitizedRegistrationFailure(operation, privatePattern) {
  assert.throws(
    operation,
    (error) => error.message === INITIALIZATION_FAILURE && !privatePattern.test(error.message)
  );
}

let gatedClientCreations = 0;
let gatedClientSeen;
const gatedClient = Object.freeze({ auth: Object.freeze({}) });
const gatedPage = createRegistrationPageInitialization({
  loadConfig: async () => ({ SUPABASE_CONFIG: offlinePublicConfig }),
  sdk: {
    createClient(url, key, options) {
      gatedClientCreations += 1;
      assert.equal(url, offlinePublicConfig.url);
      assert.equal(key, offlinePublicConfig.publishableKey);
      assert.deepEqual(options, getSupabaseClientOptions(SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION));
      return gatedClient;
    },
  },
  root: { dataset: {} },
});
const gatedComposition = gatedPage.createComposition({
  createService(client) {
    gatedClientSeen = client;
    return { submit: async () => ({ status: REGISTRATION_STATUS.UNAVAILABLE }) };
  },
  installController: () => true,
  removeController: () => true,
});
assert.equal(gatedComposition.activate(), false, 'Composition must fail closed before readiness succeeds');
assert.equal(gatedClientCreations, 0);
assert.equal(await gatedPage.initialize(), REGISTRATION_CLIENT_STATE.READY);
assert.equal(gatedComposition.activate(), true, 'The same prepared composition may activate after readiness');
assert.equal(gatedClientSeen, gatedClient);
assert.equal(gatedClientCreations, 1);
assert.equal(gatedComposition.cleanup(), true);

let transientReadinessAttempts = 0;
const transientReadinessClient = Object.freeze({ auth: Object.freeze({}) });
const transientReadinessPage = createRegistrationPageInitialization({
  loadConfig: async () => ({ SUPABASE_CONFIG: offlinePublicConfig }),
  sdk: {
    createClient() {
      transientReadinessAttempts += 1;
      if (transientReadinessAttempts === 1) throw new Error('PRIVATE_TRANSIENT_READINESS');
      return transientReadinessClient;
    },
  },
  root: { dataset: {} },
});
assert.equal(await transientReadinessPage.initialize(), REGISTRATION_CLIENT_STATE.UNAVAILABLE);
const retryComposition = transientReadinessPage.createComposition({
  createService(client) {
    assert.equal(client, transientReadinessClient);
    return { submit: async () => ({ status: REGISTRATION_STATUS.UNAVAILABLE }) };
  },
  installController: () => true,
});
assert.equal(retryComposition.activate(), false, 'Failed readiness must not authorize composition');
assert.equal(await transientReadinessPage.initialize(), REGISTRATION_CLIENT_STATE.READY);
assert.equal(retryComposition.activate(), true);
assert.equal(transientReadinessAttempts, 2, 'Only explicit readiness retry may reconstruct the client');

let reentrantActivation;
let reentrantConstructions = 0;
let reentrantError = '';
const reentrantRegistrationClient = Object.freeze({ auth: Object.freeze({}) });
reentrantActivation = createRegistrationClientActivation({
  config: offlinePublicConfig,
  sdk: {
    createClient() {
      reentrantConstructions += 1;
      try {
        reentrantActivation.activate();
      } catch (error) {
        reentrantError = error.message;
      }
      return reentrantRegistrationClient;
    },
  },
  profile: SUPABASE_CLIENT_PROFILE.FOUNDATION,
});
assert.equal(reentrantActivation.profile, SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION);
assert.equal(reentrantActivation.activate(), reentrantRegistrationClient);
assert.match(reentrantError, /already in progress/i);
assert.equal(reentrantConstructions, 1);
assert.equal(reentrantActivation.activate(), reentrantRegistrationClient);

let isolatedConstructions = 0;
const isolatedSdk = {
  createClient() {
    isolatedConstructions += 1;
    return Object.freeze({ page: isolatedConstructions, auth: Object.freeze({}) });
  },
};
const isolatedA = createRegistrationClientActivation({ config: offlinePublicConfig, sdk: isolatedSdk });
const isolatedB = createRegistrationClientActivation({ config: offlinePublicConfig, sdk: isolatedSdk });
assert.notEqual(isolatedA.activate(), isolatedB.activate());
assert.equal(isolatedConstructions, 2);

for (const [name, candidate] of [
  ['empty', {}],
  ['array', []],
  ['resolved promise', Promise.resolve(offlineBrowserClient)],
]) {
  const malformedPage = createRegistrationPageInitialization({
    loadConfig: async () => ({ SUPABASE_CONFIG: offlinePublicConfig }),
    sdk: { createClient: () => candidate },
    root: { dataset: {} },
  });
  assert.equal(await malformedPage.initialize(), REGISTRATION_CLIENT_STATE.UNAVAILABLE, name);
}

const unhandledRegistrationRejections = [];
const captureRegistrationRejection = (reason) => unhandledRegistrationRejections.push(reason);
process.on('unhandledRejection', captureRegistrationRejection);
const rejectedRegistrationClient = Promise.reject(new Error('PRIVATE_REJECTED_REGISTRATION_CLIENT'));
const rejectedRegistrationPage = createRegistrationPageInitialization({
  loadConfig: async () => ({ SUPABASE_CONFIG: offlinePublicConfig }),
  sdk: { createClient: () => rejectedRegistrationClient },
  root: { dataset: {} },
});
assert.equal(await rejectedRegistrationPage.initialize(), REGISTRATION_CLIENT_STATE.UNAVAILABLE);
await new Promise((resolve) => setImmediate(resolve));
process.removeListener('unhandledRejection', captureRegistrationRejection);
assert.deepEqual(unhandledRegistrationRejections, []);

let customThenCalls = 0;
const thenableRegistrationPage = createRegistrationPageInitialization({
  loadConfig: async () => ({ SUPABASE_CONFIG: offlinePublicConfig }),
  sdk: {
    createClient: () => ({
      auth: {},
      then() { customThenCalls += 1; },
    }),
  },
  root: { dataset: {} },
});
assert.equal(await thenableRegistrationPage.initialize(), REGISTRATION_CLIENT_STATE.UNAVAILABLE);
assert.equal(customThenCalls, 0);

for (const property of ['config', 'sdk', 'owner', 'createClientOwner']) {
  const options = {};
  Object.defineProperty(options, property, {
    get() { throw new Error(`PRIVATE_REGISTRATION_${property.toUpperCase()}`); },
  });
  assertSanitizedRegistrationFailure(
    () => createRegistrationClientActivation(options),
    new RegExp(`PRIVATE_REGISTRATION_${property.toUpperCase()}`)
  );
}
assertSanitizedRegistrationFailure(
  () => createRegistrationClientActivation(new Proxy({}, {
    get() { throw new Error('PRIVATE_REGISTRATION_OPTIONS_PROXY'); },
  })),
  /PRIVATE_REGISTRATION_OPTIONS_PROXY/
);

for (const property of ['loadConfig', 'sdk', 'root', 'createClientActivation', 'createComposition']) {
  const options = {};
  Object.defineProperty(options, property, {
    get() { throw new Error(`PRIVATE_REGISTRATION_PAGE_${property.toUpperCase()}`); },
  });
  assertSanitizedRegistrationFailure(
    () => createRegistrationPageInitialization(options),
    new RegExp(`PRIVATE_REGISTRATION_PAGE_${property.toUpperCase()}`)
  );
}
assertSanitizedRegistrationFailure(
  () => createRegistrationPageInitialization(new Proxy({}, {
    get() { throw new Error('PRIVATE_REGISTRATION_PAGE_PROXY'); },
  })),
  /PRIVATE_REGISTRATION_PAGE_PROXY/
);

for (const root of [
  Object.defineProperty({}, 'dataset', {
    get() { throw new Error('PRIVATE_REGISTRATION_ROOT_DATASET'); },
  }),
  { dataset: new Proxy({}, {
    set() { throw new Error('PRIVATE_REGISTRATION_ROOT_SETTER'); },
  }) },
]) {
  const rootBoundaryPage = createRegistrationPageInitialization({
    loadConfig: async () => ({ SUPABASE_CONFIG: offlinePublicConfig }),
    sdk: offlineSdk,
    root,
  });
  assert.equal(await rootBoundaryPage.initialize(), REGISTRATION_CLIENT_STATE.READY);
}

const nullFactoryPage = createRegistrationPageInitialization({
  loadConfig: async () => ({ SUPABASE_CONFIG: offlinePublicConfig }),
  sdk: offlineSdk,
  createClientActivation: null,
});
assert.equal(await nullFactoryPage.initialize(), REGISTRATION_CLIENT_STATE.UNAVAILABLE);

assertSanitizedRegistrationFailure(
  () => createRegistrationClientActivation({
    createClientOwner() { throw new Error('PRIVATE_REGISTRATION_OWNER_FACTORY'); },
  }).activate(),
  /PRIVATE_REGISTRATION_OWNER_FACTORY/
);
assertSanitizedRegistrationFailure(
  () => createRegistrationClientActivation({
    owner: { initialize() { throw new SupabaseConfigurationError('PRIVATE_REGISTRATION_OWNER'); } },
  }).activate(),
  /PRIVATE_REGISTRATION_OWNER/
);

let selfThrowingRegistrationProxy;
selfThrowingRegistrationProxy = new Proxy(new Error('PRIVATE_REGISTRATION_PROXY'), {
  getPrototypeOf() { throw selfThrowingRegistrationProxy; },
});
assertSanitizedRegistrationFailure(
  () => createRegistrationClientActivation({
    owner: { initialize() { throw selfThrowingRegistrationProxy; } },
  }).activate(),
  /PRIVATE_REGISTRATION_PROXY/
);

for (const [property, marker, thrownError] of [
  ['url', 'PRIVATE_REGISTRATION_URL', new SupabaseConfigurationError('PRIVATE_REGISTRATION_URL')],
  ['publishableKey', 'PRIVATE_REGISTRATION_KEY', new SupabaseConfigurationError('PRIVATE_REGISTRATION_KEY')],
  ['url', 'PRIVATE_REGISTRATION_ORDINARY', new Error('PRIVATE_REGISTRATION_ORDINARY')],
]) {
  const hostileConfig = { ...offlinePublicConfig };
  Object.defineProperty(hostileConfig, property, { get() { throw thrownError; } });
  assertSanitizedRegistrationFailure(
    () => createRegistrationClientActivation({ config: hostileConfig, sdk: offlineSdk }).activate(),
    new RegExp(marker)
  );
}

const hostileRegistrationMessage = new SupabaseConfigurationError('PRIVATE_REGISTRATION_MESSAGE');
Object.defineProperty(hostileRegistrationMessage, 'message', {
  get() { throw new Error('PRIVATE_REGISTRATION_MESSAGE_GETTER'); },
});
const hostileMessageConfig = { publishableKey: offlinePublicConfig.publishableKey };
Object.defineProperty(hostileMessageConfig, 'url', {
  get() { throw hostileRegistrationMessage; },
});
assertSanitizedRegistrationFailure(
  () => createRegistrationClientActivation({ config: hostileMessageConfig, sdk: offlineSdk }).activate(),
  /PRIVATE_REGISTRATION_MESSAGE|PRIVATE_REGISTRATION_MESSAGE_GETTER/
);

const hostileRegistrationPrototype = new Proxy(
  new SupabaseConfigurationError('PRIVATE_REGISTRATION_PROTOTYPE'),
  { getPrototypeOf() { throw new Error('PRIVATE_REGISTRATION_PROTOTYPE_TRAP'); } }
);
const hostilePrototypeConfig = { publishableKey: offlinePublicConfig.publishableKey };
Object.defineProperty(hostilePrototypeConfig, 'url', {
  get() { throw hostileRegistrationPrototype; },
});
assertSanitizedRegistrationFailure(
  () => createRegistrationClientActivation({ config: hostilePrototypeConfig, sdk: offlineSdk }).activate(),
  /PRIVATE_REGISTRATION_PROTOTYPE|PRIVATE_REGISTRATION_PROTOTYPE_TRAP/
);

const safeRegistrationError = new SupabaseConfigurationError('Supabase Project URL is missing or malformed.');
safeRegistrationError.cause = new Error('PRIVATE_REGISTRATION_CAUSE');
const safeErrorConfig = { publishableKey: offlinePublicConfig.publishableKey };
Object.defineProperty(safeErrorConfig, 'url', { get() { throw safeRegistrationError; } });
assert.throws(
  () => createRegistrationClientActivation({ config: safeErrorConfig, sdk: offlineSdk }).activate(),
  (error) => error !== safeRegistrationError
    && error.message === 'Supabase Project URL is missing or malformed.'
    && error.cause === undefined
);

for (const hostileControllerOptions of [
  new Proxy({}, { get() { throw new Error('PRIVATE_CONTROLLER_GET'); } }),
  new Proxy({}, { ownKeys() { throw new Error('PRIVATE_COMPOSITION_KEYS'); } }),
]) {
  assert.doesNotThrow(() => createRegistrationControllerActivation(hostileControllerOptions));
  assert.equal(createRegistrationControllerActivation(hostileControllerOptions).activate(), false);
  assert.equal(createRegistrationComposition(hostileControllerOptions).activate(), false);
  assert.equal(gatedPage.createComposition(hostileControllerOptions).activate(), false);
}

const validInput = Object.freeze({
  displayName: '  Test Cook  ',
  email: '  cook@example.com  ',
  password: 'StrongPass1',
  confirmPassword: 'StrongPass1',
});

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

function createFakeForm() {
  const submitButton = { disabled: false };
  const fields = new Map([
    ['displayName', new FakeInput('displayName', validInput.displayName)],
    ['email', new FakeInput('email', validInput.email)],
    ['password', new FakeInput('password', validInput.password)],
    ['confirmPassword', new FakeInput('confirmPassword', validInput.confirmPassword)],
  ]);
  const errors = new Map([
    ['displayName', { textContent: '' }],
    ['email', { textContent: '' }],
    ['password', { textContent: '' }],
    ['confirmPassword', { textContent: '' }],
  ]);
  const status = {
    textContent: '',
    classList: { isError: false, toggle(_name, enabled) { this.isError = enabled; } },
  };
  const attributes = new Map();
  return {
    dataset: { authForm: 'register' },
    submitButton,
    fields,
    errors,
    status,
    attributes,
    querySelector(selector) {
      if (selector === '[type="submit"]') return submitButton;
      if (selector === '[data-form-status]') return status;
      if (selector === '[aria-invalid="true"]') {
        return [...fields.values()].find((field) => field.attributes.get('aria-invalid') === 'true') ?? null;
      }
      const match = /^\[data-error-for="(.+)"\]$/.exec(selector);
      return match ? errors.get(match[1]) ?? null : null;
    },
    elements: { namedItem: (name) => fields.get(name) ?? null },
    setAttribute: (name, value) => attributes.set(name, value),
  };
}

let releaseControllerRequest;
let controllerSubmitCalls = 0;
const submitController = createRegistrationSubmitController(() => {
  controllerSubmitCalls += 1;
  return new Promise((resolve) => {
    releaseControllerRequest = () => resolve({
      status: REGISTRATION_STATUS.SUBMITTED,
      message: REGISTRATION_MESSAGES.SUBMITTED,
    });
  });
});
const controllerForm = createFakeForm();
const controlledRequest = submitController.submit(validInput, { form: controllerForm });
assert.equal(controllerForm.submitButton.disabled, true);
assert.equal(controllerForm.attributes.get('aria-busy'), 'true');
assert.equal(controllerForm.fields.get('password').value, validInput.password);
assert.deepEqual(await submitController.submit(validInput, { form: controllerForm }), {
  status: REGISTRATION_STATUS.PENDING,
});
assert.equal(controllerSubmitCalls, 1, 'The UI controller must block duplicate requests');
releaseControllerRequest();
assert.deepEqual(await controlledRequest, {
  status: REGISTRATION_STATUS.SUBMITTED,
  message: REGISTRATION_MESSAGES.SUBMITTED,
});
assert.equal(controllerForm.submitButton.disabled, false);
assert.equal(controllerForm.attributes.get('aria-busy'), 'false');
assert.equal(controllerForm.fields.get('password').value, '');
assert.equal(controllerForm.fields.get('confirmPassword').value, '');

const failedControllerForm = createFakeForm();
const failedController = createRegistrationSubmitController(async () => {
  throw new Error('sensitive provider detail');
});
assert.deepEqual(await failedController.submit(validInput, { form: failedControllerForm }), {
  status: REGISTRATION_STATUS.UNAVAILABLE,
  message: REGISTRATION_MESSAGES.UNAVAILABLE,
});
assert.equal(failedControllerForm.fields.get('password').value, '');
assert.throws(() => createRegistrationSubmitController(), /submit function is required/i);

function deferredRegistrationResult() {
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
let lifecycleController;
const lifecycleActivation = createRegistrationControllerActivation({
  registrationService: {
    submit() {
      lifecycleServiceCalls += 1;
      const request = deferredRegistrationResult();
      lifecycleRequests.push(request);
      return request.promise;
    },
  },
  createController(submitRegistration) {
    lifecycleController = createRegistrationSubmitController(submitRegistration);
    return lifecycleController;
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
assert.equal(lifecycleForm.fields.get('password').value, validInput.password, 'Cleanup must not clear passwords');
assert.equal(lifecycleForm.fields.get('email').focusCalls, 0, 'Cleanup must not move focus');
assert.equal(lifecycleActivation.activate(), true, 'The same controller context must support reactivation');
assert.equal(lifecycleForm.submitButton.disabled, true, 'Reactivation must reflect outstanding work');
assert.deepEqual(await lifecycleController.submit(validInput, { form: createFakeForm() }), {
  status: REGISTRATION_STATUS.PENDING,
});
assert.equal(lifecycleServiceCalls, 1, 'Reactivation must not bypass the outstanding request guard');
lifecycleRequests[0].resolve({ status: REGISTRATION_STATUS.SUBMITTED, message: REGISTRATION_MESSAGES.SUBMITTED });
await firstLifecycleSubmission;
assert.equal(lifecycleForm.status.textContent, '', 'Late success must not publish stale status');
assert.equal(lifecycleForm.fields.get('password').value, validInput.password, 'Late success must not clear passwords');
assert.equal(lifecycleForm.fields.get('email').focusCalls, 0, 'Late success must not move focus');
assert.equal(lifecycleForm.submitButton.disabled, false);
assert.equal(lifecycleForm.attributes.get('aria-busy'), 'false');

const nextLifecycleSubmission = lifecycleHandler({ preventDefault() {} });
assert.equal(lifecycleServiceCalls, 2, 'A new explicit submission may proceed after settlement');
lifecycleRequests[1].resolve({ status: REGISTRATION_STATUS.SUBMITTED, message: REGISTRATION_MESSAGES.SUBMITTED });
await nextLifecycleSubmission;
assert.equal(lifecycleForm.status.textContent, REGISTRATION_MESSAGES.SUBMITTED);
assert.equal(lifecycleForm.fields.get('password').value, '');
assert.equal(lifecycleActivation.cleanup(), true);
assert.equal(lifecycleActivation.cleanup(), false);
assert.equal(lifecycleActivation.activate(), true);
assert.equal(lifecycleActivation.activate(), true);
assert.equal(lifecycleActivation.cleanup(), true);

for (const settle of ['failure', 'rejection']) {
  const request = deferredRegistrationResult();
  const form = createFakeForm();
  const activation = createRegistrationControllerActivation({
    registrationService: { submit: () => request.promise },
  });
  assert.equal(activation.activate(), true);
  const submission = createAuthFormSubmitHandler(form)({ preventDefault() {} });
  assert.equal(activation.cleanup(), true);
  if (settle === 'failure') {
    request.resolve({ status: REGISTRATION_STATUS.UNAVAILABLE, message: REGISTRATION_MESSAGES.UNAVAILABLE });
  } else {
    request.reject(new Error('offline rejected registration fixture'));
  }
  await submission;
  assert.equal(form.status.textContent, '', `Late ${settle} must not publish status`);
  assert.equal(form.fields.get('password').value, validInput.password, `Late ${settle} must not clear passwords`);
  assert.equal(form.fields.get('email').focusCalls, 0, `Late ${settle} must not move focus`);
  assert.equal(form.submitButton.disabled, false);
  assert.equal(form.attributes.get('aria-busy'), 'false');
}

const synchronousFailureForm = createFakeForm();
const synchronousFailureController = createRegistrationSubmitController(() => {
  throw new Error('offline synchronous registration fixture');
});
assert.deepEqual(await synchronousFailureController.submit(validInput, { form: synchronousFailureForm }), {
  status: REGISTRATION_STATUS.UNAVAILABLE,
  message: REGISTRATION_MESSAGES.UNAVAILABLE,
});
assert.equal(synchronousFailureForm.submitButton.disabled, false);
assert.equal(synchronousFailureForm.attributes.get('aria-busy'), 'false');

const crossContextRequestA = deferredRegistrationResult();
const crossContextRequestB = deferredRegistrationResult();
let crossContextCallsA = 0;
let crossContextCallsB = 0;
const crossContextActivationA = createRegistrationControllerActivation({
  registrationService: {
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
const crossContextActivationB = createRegistrationControllerActivation({
  registrationService: {
    submit() {
      crossContextCallsB += 1;
      return crossContextRequestB.promise;
    },
  },
  createController(submitRegistration) {
    crossContextControllerB = createRegistrationSubmitController(submitRegistration);
    return crossContextControllerB;
  },
});
assert.equal(crossContextActivationB.activate(), false, 'Replacement activation must fail while older work is pending');
assert.deepEqual(await crossContextControllerB.submit(validInput, { form: createFakeForm() }), {
  status: REGISTRATION_STATUS.UNAVAILABLE,
  message: REGISTRATION_MESSAGES.UNAVAILABLE,
});
assert.equal(crossContextCallsB, 0, 'A rejected replacement controller must not call its service');
assert.equal(crossContextActivationB.cleanup(), false);

crossContextRequestA.resolve({ status: REGISTRATION_STATUS.SUBMITTED, message: REGISTRATION_MESSAGES.SUBMITTED });
await crossContextSubmissionA;
assert.equal(crossContextFormA.status.textContent, '', 'Retired work must not publish after cleanup');
assert.equal(crossContextFormA.fields.get('password').value, validInput.password);
assert.equal(crossContextActivationB.activate(), true, 'Replacement activation must succeed after settlement');
const crossContextFormB = createFakeForm();
const crossContextSubmissionB = createAuthFormSubmitHandler(crossContextFormB)({ preventDefault() {} });
assert.equal(crossContextCallsA + crossContextCallsB, 2, 'Only a post-settlement submission may create call two');
crossContextRequestB.resolve({ status: REGISTRATION_STATUS.SUBMITTED, message: REGISTRATION_MESSAGES.SUBMITTED });
await crossContextSubmissionB;
assert.equal(crossContextFormB.status.textContent, REGISTRATION_MESSAGES.SUBMITTED);
assert.equal(crossContextActivationB.cleanup(), true);
assert.equal(crossContextActivationB.cleanup(), false);

const valid = validateRegistrationInput(validInput);
assert.equal(valid.valid, true);
assert.equal(valid.values.displayName, 'Test Cook');
assert.equal(valid.values.email, 'cook@example.com');
assert.equal(valid.values.password, validInput.password);

for (const [field, input] of [
  ['displayName', { ...validInput, displayName: ' ' }],
  ['displayName', { ...validInput, displayName: 'x'.repeat(81) }],
  ['email', { ...validInput, email: 'not-an-email' }],
  ['password', { ...validInput, password: 'weak', confirmPassword: 'weak' }],
  ['confirmPassword', { ...validInput, confirmPassword: 'DifferentPass1' }],
]) {
  const result = validateRegistrationInput(input);
  assert.equal(result.valid, false);
  assert.ok(result.errors[field]);
}

let receivedCredentials;
const fakeClient = {
  auth: {
    async signUp(credentials) {
      receivedCredentials = credentials;
      return { data: { user: { id: 'offline-test-user' }, session: null }, error: null };
    },
    async signOut() {
      return { error: null };
    },
  },
};
const service = createRegistrationService(fakeClient);
const submitted = await service.submit(validInput);
assert.deepEqual(submitted, {
  status: REGISTRATION_STATUS.SUBMITTED,
  message: REGISTRATION_MESSAGES.SUBMITTED,
});
assert.deepEqual(receivedCredentials, {
  email: 'cook@example.com',
  password: 'StrongPass1',
  options: {
    emailRedirectTo: 'http://localhost/RecipeFinder/auth-callback.html',
    data: { display_name: 'Test Cook' },
  },
});
assert.doesNotMatch(submitted.message, /account (?:was )?created|already exists|email (?:was )?sent/i);
assert.equal(submitted.message.includes(validInput.email.trim()), false);

const errorService = createRegistrationService({
  auth: {
    signUp: async () => ({ data: null, error: new Error('User already registered') }),
    signOut: async () => ({ error: null }),
  },
});
assert.deepEqual(await errorService.submit(validInput), {
  status: REGISTRATION_STATUS.UNAVAILABLE,
  message: REGISTRATION_MESSAGES.UNAVAILABLE,
});

let unexpectedSessionSignOutCalls = 0;
const sessionService = createRegistrationService({
  auth: {
    signUp: async () => ({
      data: { session: { access_token: 'offline-placeholder', refresh_token: 'offline-refresh-placeholder' } },
      error: null,
    }),
    signOut: async (options) => {
      unexpectedSessionSignOutCalls += 1;
      assert.deepEqual(options, { scope: 'local' });
      return { error: null };
    },
  },
});
assert.deepEqual(await sessionService.submit(validInput), {
  status: REGISTRATION_STATUS.CONFIGURATION_MISMATCH,
  message: REGISTRATION_MESSAGES.CONFIGURATION_MISMATCH,
});
assert.equal(unexpectedSessionSignOutCalls, 1, 'An unexpected session must trigger exactly one local sign-out');

for (const signOutResult of [null, undefined, [], {}, { error: undefined }, { error: true }]) {
  let signOutCalls = 0;
  const cleanupFailureService = createRegistrationService({
    auth: {
      signUp: async () => ({ data: { session: { access_token: 'offline-session' } }, error: null }),
      signOut: async () => {
        signOutCalls += 1;
        return signOutResult;
      },
    },
  });
  assert.deepEqual(await cleanupFailureService.submit(validInput), {
    status: REGISTRATION_STATUS.UNAVAILABLE,
    message: REGISTRATION_MESSAGES.UNAVAILABLE,
  });
  assert.equal(signOutCalls, 1, 'Malformed local sign-out results must not be retried');
}

for (const signOut of [
  () => { throw new Error('raw synchronous sign-out detail'); },
  () => Promise.reject(new Error('raw rejected sign-out detail')),
]) {
  const cleanupExceptionService = createRegistrationService({
    auth: {
      signUp: async () => ({ data: { session: { access_token: 'offline-session' } }, error: null }),
      signOut,
    },
  });
  const result = await cleanupExceptionService.submit(validInput);
  assert.deepEqual(result, {
    status: REGISTRATION_STATUS.UNAVAILABLE,
    message: REGISTRATION_MESSAGES.UNAVAILABLE,
  });
  assert.doesNotMatch(JSON.stringify(result), /synchronous|rejected|sign-out detail/i);
}

for (const malformedResponse of [
  null,
  undefined,
  false,
  'malformed-response',
  [],
  {},
  { data: { session: null } },
  { data: { session: null }, error: undefined },
  { data: null, error: null },
  { data: {}, error: null },
  { data: { session: undefined }, error: null },
]) {
  let signOutCalls = 0;
  const malformedService = createRegistrationService({
    auth: {
      signUp: async () => malformedResponse,
      signOut: async () => {
        signOutCalls += 1;
        return { error: null };
      },
    },
  });
  assert.deepEqual(await malformedService.submit(validInput), {
    status: REGISTRATION_STATUS.UNAVAILABLE,
    message: REGISTRATION_MESSAGES.UNAVAILABLE,
  });
  assert.equal(signOutCalls, 0, 'Responses without session evidence must not sign out');
}

for (const malformedSessionResponse of [
  { data: { session: { access_token: 'possible-session' } } },
  { data: { session: { access_token: 'possible-session' } }, error: undefined },
  { data: { session: { access_token: 'possible-session' } }, error: new Error('raw provider detail') },
  Object.assign([], { data: { session: { access_token: 'possible-session' } }, error: null }),
  { data: Object.assign([], { session: { access_token: 'possible-session' } }), error: null },
  { data: { session: false }, error: null },
  { data: { session: 'possible-session' }, error: null },
]) {
  let signOutCalls = 0;
  const malformedSessionService = createRegistrationService({
    auth: {
      signUp: async () => malformedSessionResponse,
      signOut: async (options) => {
        signOutCalls += 1;
        assert.deepEqual(options, { scope: 'local' });
        return { error: null };
      },
    },
  });
  const result = await malformedSessionService.submit(validInput);
  assert.deepEqual(result, {
    status: REGISTRATION_STATUS.UNAVAILABLE,
    message: REGISTRATION_MESSAGES.UNAVAILABLE,
  });
  assert.equal(signOutCalls, 1, 'Malformed responses with session evidence require one cleanup attempt');
  assert.equal(JSON.stringify(result).includes('possible-session'), false);
  assert.equal(JSON.stringify(result).includes('raw provider detail'), false);
}

let neverSettlingSignUpCalls = 0;
let neverSettlingSignOutCalls = 0;
const neverSettlingSignOut = new Promise(() => {});
const neverSettlingCleanupService = createRegistrationService({
  auth: {
    signUp: async () => {
      neverSettlingSignUpCalls += 1;
      return { data: { session: { access_token: 'offline-pending-session' } }, error: null };
    },
    signOut: () => {
      neverSettlingSignOutCalls += 1;
      return neverSettlingSignOut;
    },
  },
});
void neverSettlingCleanupService.submit(validInput);
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(await neverSettlingCleanupService.submit(validInput), { status: REGISTRATION_STATUS.PENDING });
assert.equal(neverSettlingSignUpCalls, 1, 'Pending cleanup must suppress duplicate signup');
assert.equal(neverSettlingSignOutCalls, 1, 'Pending cleanup must not be duplicated');

let releaseRequest;
let callCount = 0;
const pendingService = createRegistrationService({
  auth: {
    signUp: () => {
      callCount += 1;
      return new Promise((resolve) => {
        releaseRequest = () => resolve({ data: { session: null }, error: null });
      });
    },
    signOut: async () => ({ error: null }),
  },
});
const firstRequest = pendingService.submit(validInput);
assert.deepEqual(await pendingService.submit(validInput), { status: REGISTRATION_STATUS.PENDING });
assert.equal(callCount, 1);
releaseRequest();
await firstRequest;

assert.throws(() => createRegistrationService(null), /client is required/i);
assert.throws(
  () => createRegistrationService({ auth: { signUp: async () => ({ data: { session: null }, error: null }) } }),
  /client is required/i
);
assert.throws(
  () => createRegistrationService(fakeClient, { callbackUrl: 'https://evil.example/callback' }),
  /not approved/i
);

const registerHtml = await readFile(new URL('../register.html', import.meta.url), 'utf8');
const sdkUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
const sdkIntegrity = 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';
const sdkTag = `<script src="${sdkUrl}" integrity="${sdkIntegrity}" crossorigin="anonymous" referrerpolicy="no-referrer"></script>`;
assert.ok(registerHtml.includes(sdkTag), 'The registration page must use the exact approved SDK tag');
assert.equal(registerHtml.split(sdkUrl).length - 1, 1, 'The registration page must load exactly one pinned SDK');
assert.ok(
  registerHtml.indexOf(sdkUrl) < registerHtml.indexOf('<script type="module" src="js/auth-ui.js"></script>'),
  'The pinned SDK must load before the existing native module'
);
const preparationTag = '<script type="module" src="js/registration-browser.js"></script>';
assert.ok(registerHtml.includes(preparationTag), 'The inert registration preparation entrypoint must be loaded');
assert.ok(
  registerHtml.indexOf('<script type="module" src="js/auth-ui.js"></script>') < registerHtml.indexOf(preparationTag),
  'The existing preview UI module must retain ownership of the form before the inert preparation entrypoint'
);
assert.doesNotMatch(registerHtml, /(?:src|href)=["'][^"']*(?:registration\.js|supabase-client\.js|supabase-config\.js)/i);
assert.doesNotMatch(registerHtml, /initializeSupabaseClient|createClient|signUp|signInWithPassword|exchangeCodeForSession/);

const source = await readFile(new URL('../js/registration.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|console\./i);

const browserSource = await readFile(new URL('../js/registration-browser.js', import.meta.url), 'utf8');
assert.match(browserSource, /createRegistrationClientActivation/);
assert.match(browserSource, /import\('\.\/supabase-config\.js'\)/, 'The ignored config must be loaded only at runtime');
assert.doesNotMatch(browserSource, /^import\s+.*supabase-config\.js/m, 'The optional config must not be a static import');
assert.doesNotMatch(browserSource, /createClient\s*\(|signUp\s*\(|signInWithPassword|exchangeCodeForSession|getSession|onAuthStateChange/);
assert.doesNotMatch(browserSource, /localStorage|sessionStorage|location\.(?:search|hash)|URLSearchParams|addEventListener|console\./);
assert.equal(
  browserSource.match(/createRegistrationControllerActivation\s*\(/g)?.length,
  1,
  'The prepared registration controller must be declared but never invoked by the live entrypoint'
);
assert.equal(
  browserSource.match(/createRegistrationComposition\s*\(/g)?.length,
  1,
  'The registration composition must be declared but never invoked by the live entrypoint'
);
assert.match(browserSource, /import \{ createRegistrationService \} from '\.\/registration\.js';/);
assert.doesNotMatch(browserSource, /if \(typeof document !== ['"]undefined['"]\)/, 'Module import must not initialize Supabase');

const authUiSource = await readFile(new URL('../js/auth-ui.js', import.meta.url), 'utf8');
assert.equal(authUiSource.match(/addEventListener\(['"]submit['"]/g)?.length, 1, 'The form must retain one submit listener');
assert.match(authUiSource, /activeRegistrationController/, 'Registration controller ownership must remain intact');
assert.match(authUiSource, /let pendingRegistrationOwnerToken = null;/, 'Registration pending ownership must use an opaque token slot');
assert.match(authUiSource, /const ownerToken = Symbol\(['"]registration-operation-owner['"]\);/);
assert.match(authUiSource, /const registrationControllerOwnerTokens = new WeakMap\(\);/);
assert.doesNotMatch(authUiSource, /pendingRegistrationController/, 'The module must not retain a registration controller as pending owner');
assert.match(
  authUiSource,
  /Your details look ready\. No account was created and no email was sent\./,
  'Preview-only registration messaging must remain the live default'
);

console.log('Offline registration preparation tests passed with fake clients only.');
