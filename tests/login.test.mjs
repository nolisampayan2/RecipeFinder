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
import {
  createLoginControllerActivation,
  createLoginPageComposition,
} from '../js/login-browser.js';
import {
  SUPABASE_CLIENT_PROFILE,
  SupabaseConfigurationError,
  getSupabaseClientOptions,
} from '../js/supabase-client.js';

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

const offlinePageConfig = Object.freeze({
  url: 'https://recipefinder-test.supabase.co',
  publishableKey: 'sb_publishable_test_abcdefghijklmnopqrstuvwxyz',
});
let pageClientCreations = 0;
let pageSignInCalls = 0;
let pageSignUpCalls = 0;
let pageSubscriptionCalls = 0;
let pageSessionCalls = 0;
let pageSignOutCalls = 0;
const sharedPageClient = Object.freeze({
  auth: Object.freeze({
    signInWithPassword() { pageSignInCalls += 1; },
    signUp() { pageSignUpCalls += 1; },
    onAuthStateChange() { pageSubscriptionCalls += 1; },
    getSession() { pageSessionCalls += 1; },
    signOut() { pageSignOutCalls += 1; },
  }),
});
const loginPageComposition = createLoginPageComposition({
  clientDependencies: {
    config: offlinePageConfig,
    sdk: {
      createClient(url, key, options) {
        pageClientCreations += 1;
        assert.equal(url, offlinePageConfig.url);
        assert.equal(key, offlinePageConfig.publishableKey);
        assert.deepEqual(
          options,
          getSupabaseClientOptions(SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION)
        );
        return sharedPageClient;
      },
    },
  },
});
assert.equal(loginPageComposition.profile, SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
assert.equal(pageClientCreations, 0, 'Login page composition construction must remain lazy');
assert.equal(loginPageComposition.prepareClient(), sharedPageClient);
assert.equal(loginPageComposition.prepareClient(), sharedPageClient);
assert.equal(pageClientCreations, 1, 'Repeated preparation must share one page client');

let preparedControllerClient;
let preparedControllerActivations = 0;
const preparedController = loginPageComposition.prepareController({
  createService(client) {
    preparedControllerClient = client;
    return { submit: async () => ({ status: LOGIN_STATUS.UNAVAILABLE }) };
  },
  installController() {
    preparedControllerActivations += 1;
    return true;
  },
  removeController: () => true,
});
assert.equal(preparedControllerClient, undefined, 'Controller preparation must not create the login service');
assert.equal(preparedControllerActivations, 0, 'Controller preparation must not install a live controller');
assert.equal(preparedController.activate(), true);
assert.equal(preparedControllerClient, sharedPageClient);
assert.equal(preparedControllerActivations, 1);
assert.equal(preparedController.cleanup(), true);
assert.equal(pageClientCreations, 1, 'Prepared consumers must reuse the shared client identity');
assert.deepEqual(
  { pageSignInCalls, pageSignUpCalls, pageSubscriptionCalls, pageSessionCalls, pageSignOutCalls },
  { pageSignInCalls: 0, pageSignUpCalls: 0, pageSubscriptionCalls: 0, pageSessionCalls: 0, pageSignOutCalls: 0 },
  'Preparation and controller installation must not perform Auth operations'
);

let transientClientAttempts = 0;
const transientClient = Object.freeze({ auth: Object.freeze({}) });
const retryingComposition = createLoginPageComposition({
  clientDependencies: {
    config: offlinePageConfig,
    sdk: {
      createClient() {
        transientClientAttempts += 1;
        if (transientClientAttempts === 1) throw new Error('private SDK initialization detail');
        return transientClient;
      },
    },
  },
});
assert.throws(
  () => retryingComposition.prepareClient(),
  (error) => /initialization failed/i.test(error.message) && !/private|SDK/i.test(error.message)
);
assert.equal(retryingComposition.prepareClient(), transientClient);
assert.equal(retryingComposition.prepareClient(), transientClient);
assert.equal(transientClientAttempts, 2, 'A transient failure must permit one explicit retry');

let malformedClientAttempts = 0;
const malformedComposition = createLoginPageComposition({
  clientDependencies: {
    config: offlinePageConfig,
    sdk: { createClient() { malformedClientAttempts += 1; return {}; } },
  },
});
assert.throws(() => malformedComposition.prepareClient(), /initialization failed/i);
assert.throws(() => malformedComposition.prepareClient(), /initialization failed/i);
assert.equal(malformedClientAttempts, 2, 'Malformed clients must not become cached');

function assertSanitizedPreparationFailure(composition, privatePattern) {
  assert.throws(
    () => composition.prepareClient(),
    (error) => error.message === 'Supabase client initialization failed.'
      && !privatePattern.test(error.message)
  );
}

function assertSanitizedBoundaryFailure(operation, privatePattern) {
  assert.throws(
    operation,
    (error) => error.message === 'Supabase client initialization failed.'
      && !privatePattern.test(error.message)
  );
}

for (const property of [
  'clientOwner',
  'clientDependencies',
  'createClientOwner',
  'createControllerActivation',
]) {
  const options = {};
  const privatePattern = new RegExp(`PRIVATE_OUTER_${property.toUpperCase()}`);
  Object.defineProperty(options, property, {
    enumerable: true,
    get() { throw new Error(`PRIVATE_OUTER_${property.toUpperCase()}`); },
  });
  assertSanitizedBoundaryFailure(
    () => createLoginPageComposition(options),
    privatePattern
  );
}

const outerGetProxy = new Proxy({}, {
  get() { throw new Error('PRIVATE_OUTER_GET_TRAP'); },
});
assertSanitizedBoundaryFailure(
  () => createLoginPageComposition(outerGetProxy),
  /PRIVATE_OUTER_GET_TRAP/
);

const omittedOptionsComposition = createLoginPageComposition();
assert.throws(
  () => omittedOptionsComposition.prepareClient(),
  /Supabase public configuration is missing\./
);

let transientOuterFailure = true;
let transientOuterOwnerCalls = 0;
const transientOuterOptionsTarget = {
  clientDependencies: {},
  createClientOwner() {
    transientOuterOwnerCalls += 1;
    return { initialize: () => sharedPageClient };
  },
};
const transientOuterOptions = new Proxy(transientOuterOptionsTarget, {
  get(target, property, receiver) {
    if (property === 'clientOwner' && transientOuterFailure) {
      transientOuterFailure = false;
      throw new Error('PRIVATE_TRANSIENT_OUTER_GETTER');
    }
    return Reflect.get(target, property, receiver);
  },
});
assertSanitizedBoundaryFailure(
  () => createLoginPageComposition(transientOuterOptions),
  /PRIVATE_TRANSIENT_OUTER_GETTER/
);
const recoveredOuterComposition = createLoginPageComposition(transientOuterOptions);
assert.equal(recoveredOuterComposition.prepareClient(), sharedPageClient);
assert.equal(recoveredOuterComposition.prepareClient(), sharedPageClient);
assert.equal(transientOuterOwnerCalls, 1);

for (const [name, options] of [
  ['ownKeys', new Proxy({}, {
    ownKeys() { throw new Error('PRIVATE_CONTROLLER_OWN_KEYS'); },
  })],
  ['descriptor', new Proxy({ createService: () => ({ submit: async () => ({}) }) }, {
    getOwnPropertyDescriptor() { throw new Error('PRIVATE_CONTROLLER_DESCRIPTOR'); },
  })],
  ['get', new Proxy({ createService: () => ({ submit: async () => ({}) }) }, {
    getOwnPropertyDescriptor(target, property) {
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    get() { throw new Error('PRIVATE_CONTROLLER_GET'); },
  })],
]) {
  assertSanitizedBoundaryFailure(
    () => loginPageComposition.prepareController(options),
    new RegExp(`PRIVATE_CONTROLLER_${name.toUpperCase()}`)
  );
  assert.equal(loginPageComposition.prepareClient(), sharedPageClient);
  assert.equal(pageClientCreations, 1, 'Failed controller preparation must preserve the shared client');
}

const throwingControllerOptions = {};
Object.defineProperty(throwingControllerOptions, 'createService', {
  enumerable: true,
  get() { throw new Error('PRIVATE_CONTROLLER_ENUMERABLE_GETTER'); },
});
assertSanitizedBoundaryFailure(
  () => loginPageComposition.prepareController(throwingControllerOptions),
  /PRIVATE_CONTROLLER_ENUMERABLE_GETTER/
);

let retriedControllerClient;
const retriedPreparedController = loginPageComposition.prepareController({
  client: { auth: { signInWithPassword() { throw new Error('must not be used'); } } },
  createService(client) {
    retriedControllerClient = client;
    return { submit: async () => ({ status: LOGIN_STATUS.UNAVAILABLE }) };
  },
  installController: () => true,
  removeController: () => true,
});
assert.equal(retriedPreparedController.activate(), true);
assert.equal(retriedControllerClient, sharedPageClient);
assert.equal(retriedPreparedController.cleanup(), true);
assert.equal(pageClientCreations, 1);

for (const property of ['config', 'sdk', 'unrelated']) {
  let getterCalls = 0;
  let ownerCalls = 0;
  const privatePattern = new RegExp(`PRIVATE_${property.toUpperCase()}_GETTER`);
  const dependencies = {};
  Object.defineProperty(dependencies, property, {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error(`PRIVATE_${property.toUpperCase()}_GETTER`);
    },
  });
  const composition = createLoginPageComposition({
    clientDependencies: dependencies,
    createClientOwner() {
      ownerCalls += 1;
      return { initialize: () => sharedPageClient };
    },
  });
  assertSanitizedPreparationFailure(composition, privatePattern);
  assert.equal(getterCalls, 1);
  assert.equal(ownerCalls, 0, 'Dependency extraction failure must not construct or cache an owner');
}

for (const [name, dependencies] of [
  ['ownKeys', new Proxy({}, {
    ownKeys() { throw new Error('PRIVATE_OWN_KEYS_TRAP'); },
  })],
  ['descriptor', new Proxy({ config: offlinePageConfig }, {
    getOwnPropertyDescriptor() { throw new Error('PRIVATE_DESCRIPTOR_TRAP'); },
  })],
  ['get', new Proxy({ config: offlinePageConfig }, {
    getOwnPropertyDescriptor(target, property) {
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    get() { throw new Error('PRIVATE_GET_TRAP'); },
  })],
]) {
  let ownerCalls = 0;
  const composition = createLoginPageComposition({
    clientDependencies: dependencies,
    createClientOwner() {
      ownerCalls += 1;
      return { initialize: () => sharedPageClient };
    },
  });
  assertSanitizedPreparationFailure(composition, new RegExp(`PRIVATE_${name.toUpperCase()}`));
  assert.equal(ownerCalls, 0, `${name} trap failure must not cache an owner`);
}

let transientGetterCalls = 0;
let transientGetterOwnerCalls = 0;
const transientGetterDependencies = {};
Object.defineProperty(transientGetterDependencies, 'config', {
  enumerable: true,
  get() {
    transientGetterCalls += 1;
    if (transientGetterCalls === 1) throw new Error('PRIVATE_TRANSIENT_GETTER');
    return offlinePageConfig;
  },
});
Object.defineProperty(transientGetterDependencies, 'sdk', {
  enumerable: true,
  value: { createClient: () => sharedPageClient },
});
const transientGetterComposition = createLoginPageComposition({
  clientDependencies: transientGetterDependencies,
  createClientOwner(options) {
    transientGetterOwnerCalls += 1;
    assert.equal(options.profile, SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
    return {
      initialize(profile) {
        assert.equal(profile, SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
        return sharedPageClient;
      },
    };
  },
});
assertSanitizedPreparationFailure(transientGetterComposition, /PRIVATE_TRANSIENT_GETTER/);
assert.equal(transientGetterOwnerCalls, 0);
assert.equal(transientGetterComposition.prepareClient(), sharedPageClient);
assert.equal(transientGetterComposition.prepareClient(), sharedPageClient);
assert.equal(transientGetterOwnerCalls, 1, 'Successful retry must cache one owner');

const unhandledClientRejections = [];
const captureClientRejection = (reason) => unhandledClientRejections.push(reason);
process.on('unhandledRejection', captureClientRejection);
for (const candidate of [
  Promise.resolve(sharedPageClient),
  Promise.reject(new Error('PRIVATE_REJECTED_CLIENT')),
]) {
  const composition = createLoginPageComposition({
    clientDependencies: {
      config: offlinePageConfig,
      sdk: { createClient: () => candidate },
    },
  });
  assertSanitizedPreparationFailure(composition, /PRIVATE_REJECTED_CLIENT/);
}
await new Promise((resolve) => setImmediate(resolve));
process.removeListener('unhandledRejection', captureClientRejection);
assert.deepEqual(unhandledClientRejections, []);

let customThenCalls = 0;
const customThenableComposition = createLoginPageComposition({
  clientDependencies: {
    config: offlinePageConfig,
    sdk: {
      createClient: () => ({
        auth: {},
        then() { customThenCalls += 1; },
      }),
    },
  },
});
assertSanitizedPreparationFailure(customThenableComposition, /private/i);
assert.equal(customThenCalls, 0, 'Custom thenable rejection must not invoke then()');

const hostileInjectedError = new Proxy(new Error('PRIVATE_HOSTILE_PROXY'), {
  getPrototypeOf() { throw new Error('PRIVATE_GET_PROTOTYPE_TRAP'); },
});
assertSanitizedPreparationFailure(createLoginPageComposition({
  clientOwner: {
    initialize() { throw hostileInjectedError; },
  },
}), /PRIVATE_HOSTILE_PROXY|PRIVATE_GET_PROTOTYPE_TRAP/);

assertSanitizedPreparationFailure(createLoginPageComposition({
  clientOwner: {
    initialize() {
      throw new SupabaseConfigurationError('PRIVATE_INJECTED_CONFIGURATION_ERROR');
    },
  },
}), /PRIVATE_INJECTED_CONFIGURATION_ERROR/);

assertSanitizedPreparationFailure(createLoginPageComposition({
  clientOwner: {
    initialize() { throw new Error('PRIVATE_INJECTED_OWNER_ERROR'); },
  },
}), /PRIVATE_INJECTED_OWNER_ERROR/);

const forgedConfigurationError = new Error('PRIVATE_FORGED_CONFIGURATION_ERROR');
forgedConfigurationError.name = 'SupabaseConfigurationError';
assertSanitizedPreparationFailure(createLoginPageComposition({
  clientOwner: {
    initialize() { throw forgedConfigurationError; },
  },
}), /PRIVATE_FORGED_CONFIGURATION_ERROR/);

const trustedConfigurationComposition = createLoginPageComposition({
  clientDependencies: {
    config: {
      url: 'http://unsafe.example',
      publishableKey: offlinePageConfig.publishableKey,
    },
    sdk: { createClient: () => sharedPageClient },
  },
});
assert.throws(
  () => trustedConfigurationComposition.prepareClient(),
  (error) => error instanceof SupabaseConfigurationError
    && error.message === 'Supabase Project URL must be an HTTPS origin without credentials, paths, query parameters, or fragments.'
    && error.cause === undefined
);

const injectedSafeMessageError = new SupabaseConfigurationError(
  'Supabase Project URL is missing or malformed.'
);
injectedSafeMessageError.cause = new Error('PRIVATE_ALLOWLISTED_CAUSE');
const injectedSafeMessageConfig = {
  publishableKey: offlinePageConfig.publishableKey,
};
Object.defineProperty(injectedSafeMessageConfig, 'url', {
  get() { throw injectedSafeMessageError; },
});
assert.throws(
  () => createLoginPageComposition({
    clientDependencies: {
      config: injectedSafeMessageConfig,
      sdk: { createClient: () => sharedPageClient },
    },
  }).prepareClient(),
  (error) => error !== injectedSafeMessageError
    && error.message === 'Supabase Project URL is missing or malformed.'
    && error.cause === undefined
    && !JSON.stringify(error).includes('PRIVATE_ALLOWLISTED_CAUSE')
);

for (const [property, marker, thrownError] of [
  ['url', 'PRIVATE_REAL_URL', new SupabaseConfigurationError('PRIVATE_REAL_URL')],
  ['publishableKey', 'PRIVATE_REAL_KEY', new SupabaseConfigurationError('PRIVATE_REAL_KEY')],
  ['url', 'PRIVATE_ORDINARY_URL', new Error('PRIVATE_ORDINARY_URL')],
]) {
  const config = {
    url: offlinePageConfig.url,
    publishableKey: offlinePageConfig.publishableKey,
  };
  Object.defineProperty(config, property, {
    get() { throw thrownError; },
  });
  assertSanitizedPreparationFailure(createLoginPageComposition({
    clientDependencies: {
      config,
      sdk: { createClient: () => sharedPageClient },
    },
  }), new RegExp(marker));
}

const hostileTrustedMessage = new SupabaseConfigurationError('PRIVATE_HOSTILE_MESSAGE');
Object.defineProperty(hostileTrustedMessage, 'message', {
  get() { throw new Error('PRIVATE_HOSTILE_MESSAGE_GETTER'); },
});
const hostileTrustedConfig = {
  publishableKey: offlinePageConfig.publishableKey,
};
Object.defineProperty(hostileTrustedConfig, 'url', {
  get() { throw hostileTrustedMessage; },
});
assertSanitizedPreparationFailure(createLoginPageComposition({
  clientDependencies: {
    config: hostileTrustedConfig,
    sdk: { createClient: () => sharedPageClient },
  },
}), /PRIVATE_HOSTILE_MESSAGE|PRIVATE_HOSTILE_MESSAGE_GETTER/);

const hostileTrustedProxy = new Proxy(
  new SupabaseConfigurationError('PRIVATE_TRUSTED_PROXY'),
  {
    getPrototypeOf() { throw new Error('PRIVATE_TRUSTED_PROTOTYPE'); },
  }
);
const hostileTrustedProxyConfig = {
  publishableKey: offlinePageConfig.publishableKey,
};
Object.defineProperty(hostileTrustedProxyConfig, 'url', {
  get() { throw hostileTrustedProxy; },
});
assertSanitizedPreparationFailure(createLoginPageComposition({
  clientDependencies: {
    config: hostileTrustedProxyConfig,
    sdk: { createClient: () => sharedPageClient },
  },
}), /PRIVATE_TRUSTED_PROXY|PRIVATE_TRUSTED_PROTOTYPE/);

let transientPrivateConfigFailure = true;
let transientPrivateConfigCreations = 0;
const transientPrivateConfig = {
  publishableKey: offlinePageConfig.publishableKey,
};
Object.defineProperty(transientPrivateConfig, 'url', {
  get() {
    if (transientPrivateConfigFailure) {
      transientPrivateConfigFailure = false;
      throw new SupabaseConfigurationError('PRIVATE_TRANSIENT_CONFIGURATION');
    }
    return offlinePageConfig.url;
  },
});
const transientPrivateConfigComposition = createLoginPageComposition({
  clientDependencies: {
    config: transientPrivateConfig,
    sdk: {
      createClient() {
        transientPrivateConfigCreations += 1;
        return sharedPageClient;
      },
    },
  },
});
assertSanitizedPreparationFailure(
  transientPrivateConfigComposition,
  /PRIVATE_TRANSIENT_CONFIGURATION/
);
assert.equal(transientPrivateConfigComposition.prepareClient(), sharedPageClient);
assert.equal(transientPrivateConfigComposition.prepareClient(), sharedPageClient);
assert.equal(transientPrivateConfigCreations, 1);

let transientOwnerFactoryCalls = 0;
const transientOwnerFactoryComposition = createLoginPageComposition({
  clientDependencies: { config: offlinePageConfig, sdk: {} },
  createClientOwner() {
    transientOwnerFactoryCalls += 1;
    if (transientOwnerFactoryCalls === 1) {
      throw new SupabaseConfigurationError('PRIVATE_OWNER_CREATION_ERROR');
    }
    return { initialize: () => sharedPageClient };
  },
});
assertSanitizedPreparationFailure(
  transientOwnerFactoryComposition,
  /PRIVATE_OWNER_CREATION_ERROR/
);
assert.equal(transientOwnerFactoryComposition.prepareClient(), sharedPageClient);
assert.equal(transientOwnerFactoryComposition.prepareClient(), sharedPageClient);
assert.equal(transientOwnerFactoryCalls, 2, 'Failed owner creation must not cache a partial owner');

let ownerFactoryCalls = 0;
let ownerInitializeCalls = 0;
const injectedOwnerClient = Object.freeze({ auth: Object.freeze({}) });
const injectedOwnerComposition = createLoginPageComposition({
  clientDependencies: {
    config: offlinePageConfig,
    sdk: {},
    profile: SUPABASE_CLIENT_PROFILE.FOUNDATION,
  },
  createClientOwner(options) {
    ownerFactoryCalls += 1;
    assert.equal(options.profile, SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
    return {
      initialize(profile) {
        ownerInitializeCalls += 1;
        assert.equal(profile, SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
        return injectedOwnerClient;
      },
    };
  },
});
assert.equal(ownerFactoryCalls, 0);
assert.equal(injectedOwnerComposition.prepareClient(), injectedOwnerClient);
assert.equal(injectedOwnerComposition.prepareClient(), injectedOwnerClient);
assert.equal(ownerFactoryCalls, 1, 'One login lifecycle must create one owner');
assert.equal(ownerInitializeCalls, 2, 'Repeated consumers may request the same owner client');

let reentrantComposition;
let reentrantClientCreations = 0;
let nestedPreparationError = '';
const reentrantClient = Object.freeze({ auth: Object.freeze({}) });
reentrantComposition = createLoginPageComposition({
  clientDependencies: {
    config: offlinePageConfig,
    sdk: {
      createClient() {
        reentrantClientCreations += 1;
        try {
          reentrantComposition.prepareClient();
        } catch (error) {
          nestedPreparationError = error.message;
        }
        return reentrantClient;
      },
    },
  },
});
assert.equal(reentrantComposition.prepareClient(), reentrantClient);
assert.match(nestedPreparationError, /already in progress/i);
assert.equal(reentrantClientCreations, 1, 'Reentrant preparation must not construct a second client');
assert.equal(reentrantComposition.prepareClient(), reentrantClient);

let independentPageCreations = 0;
const independentPageSdk = {
  createClient() {
    independentPageCreations += 1;
    return Object.freeze({ page: independentPageCreations, auth: Object.freeze({}) });
  },
};
const firstLoginPage = createLoginPageComposition({
  clientDependencies: { config: offlinePageConfig, sdk: independentPageSdk },
});
const secondLoginPage = createLoginPageComposition({
  clientDependencies: { config: offlinePageConfig, sdk: independentPageSdk },
});
assert.notEqual(firstLoginPage.prepareClient(), secondLoginPage.prepareClient());
assert.equal(independentPageCreations, 2, 'Independent page lifecycles must own independent clients');

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
assert.doesNotMatch(
  browserSource,
  /addEventListener|\bcreateClient\s*\(|initializeSupabaseClient|supabase-config|\bfetch\s*\(|localStorage|sessionStorage/
);
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
