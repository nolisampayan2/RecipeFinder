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
  createRegistrationPageInitialization,
} from '../js/registration-browser.js';
import {
  createRegistrationSubmitController,
} from '../js/auth-ui.js';

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

const validInput = Object.freeze({
  displayName: '  Test Cook  ',
  email: '  cook@example.com  ',
  password: 'StrongPass1',
  confirmPassword: 'StrongPass1',
});

function createFakeForm() {
  const submitButton = { disabled: false };
  const fields = new Map([
    ['password', { value: validInput.password }],
    ['confirmPassword', { value: validInput.confirmPassword }],
  ]);
  const attributes = new Map();
  return {
    submitButton,
    fields,
    attributes,
    querySelector(selector) {
      return selector === '[type="submit"]' ? submitButton : null;
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
  auth: { signUp: async () => ({ data: null, error: new Error('User already registered') }) },
});
assert.deepEqual(await errorService.submit(validInput), {
  status: REGISTRATION_STATUS.UNAVAILABLE,
  message: REGISTRATION_MESSAGES.UNAVAILABLE,
});

const sessionService = createRegistrationService({
  auth: { signUp: async () => ({ data: { session: { access_token: 'offline-placeholder' } }, error: null }) },
});
assert.deepEqual(await sessionService.submit(validInput), {
  status: REGISTRATION_STATUS.CONFIGURATION_MISMATCH,
  message: REGISTRATION_MESSAGES.CONFIGURATION_MISMATCH,
});

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
  },
});
const firstRequest = pendingService.submit(validInput);
assert.deepEqual(await pendingService.submit(validInput), { status: REGISTRATION_STATUS.PENDING });
assert.equal(callCount, 1);
releaseRequest();
await firstRequest;

assert.throws(() => createRegistrationService(null), /client is required/i);
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
assert.doesNotMatch(browserSource, /createRegistrationService/, 'The live entrypoint must not construct a registration service');

const authUiSource = await readFile(new URL('../js/auth-ui.js', import.meta.url), 'utf8');
assert.equal(authUiSource.match(/addEventListener\(['"]submit['"]/g)?.length, 1, 'The form must retain one submit listener');
assert.match(
  authUiSource,
  /Your details look ready\. No account was created and no email was sent\./,
  'Preview-only registration messaging must remain the live default'
);

console.log('Offline registration preparation tests passed with fake clients only.');
