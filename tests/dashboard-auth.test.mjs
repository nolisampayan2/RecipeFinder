import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuthSessionService } from '../js/auth-session.js';
import { createDashboardAuthIntegration, shouldInitializeAdminDashboardLink } from '../js/dashboard-auth.js';
import { createDashboardAdminLink } from '../js/dashboard-admin-link.js';

for (const hostname of ['localhost', '127.0.0.1']) {
  assert.equal(shouldInitializeAdminDashboardLink({ adminLocalDevelopmentAvailable: true }, hostname), true);
  assert.equal(shouldInitializeAdminDashboardLink({ adminLocalDevelopmentAvailable: false }, hostname), false);
  assert.equal(shouldInitializeAdminDashboardLink({}, hostname), false);
}
for (const hostname of ['example.com', 'admin.localhost', 'localhost.example.com', '127.0.0.2', '', null]) {
  assert.equal(shouldInitializeAdminDashboardLink({ adminLocalDevelopmentAvailable: true }, hostname), false);
}
assert.equal(shouldInitializeAdminDashboardLink({ adminPreviewAvailable: true }, 'example.com'), true);
assert.equal(shouldInitializeAdminDashboardLink({ adminProductionAvailable: true }, 'example.com'), true);
assert.equal(shouldInitializeAdminDashboardLink({ adminProductionAvailable: 'true' }, 'example.com'), false);
assert.equal(shouldInitializeAdminDashboardLink({ adminPreviewAvailable: 'true' }, 'example.com'), false);
assert.equal(shouldInitializeAdminDashboardLink({ adminLocalDevelopmentAvailable: 'true' }, 'localhost'), false);
assert.equal(shouldInitializeAdminDashboardLink({ get adminPreviewAvailable() { throw Error('private'); } }, 'localhost'), false);

const confirmedUser = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'cook@example.test',
  email_confirmed_at: '2026-11-01T00:00:00Z',
  user_metadata: Object.freeze({ display_name: '  Admin Cook  ' }),
});
const VALID_EXPIRY_SECONDS = 4102444800;

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.dataset = {};
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.listeners = new Map();
    this.children = new Map();
  }

  querySelector(selector) { return this.children.get(selector) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  click() { this.listeners.get('click')?.({ currentTarget: this }); }
}

function createFakeDocument() {
  const root = new FakeElement();
  const label = new FakeElement();
  const identity = new FakeElement();
  const signIn = new FakeElement();
  const logout = new FakeElement();
  root.children.set('[data-auth-label]', label);
  root.children.set('[data-auth-identity]', identity);
  root.children.set('[data-auth-sign-in]', signIn);
  root.children.set('[data-auth-logout]', logout);
  return {
    root, label, identity, signIn, logout,
    documentLike: { querySelector: (selector) => selector === '[data-dashboard-auth]' ? root : null },
  };
}

function sessionFor(user = confirmedUser) {
  return {
    access_token: 'never-render-access',
    refresh_token: 'never-render-refresh',
    expires_at: VALID_EXPIRY_SECONDS,
    user,
  };
}

function createFakeClient({ session = null, getSession, signOutResult = { error: null }, signOut } = {}) {
  let listener = null;
  const counts = { getSession: 0, subscribe: 0, unsubscribe: 0, signOut: 0 };
  const client = {
    auth: {
      async getSession() {
        counts.getSession += 1;
        return getSession ? getSession() : { data: { session }, error: null };
      },
      onAuthStateChange(nextListener) {
        counts.subscribe += 1;
        listener = nextListener;
        return { data: { subscription: { unsubscribe() { counts.unsubscribe += 1; } } } };
      },
      async signOut(options) {
        counts.signOut += 1;
        assert.deepEqual(options, { scope: 'local' });
        if (signOut) return signOut(options);
        return signOutResult;
      },
    },
  };
  return { client, counts, emit(event, sessionValue) { listener?.(event, sessionValue); } };
}

const publicConfig = Object.freeze({
  url: 'https://offline-dashboard.supabase.co',
  publishableKey: 'sb_publishable_offline_dashboard_fixture_123456789',
});

function createIntegration(fake, ui = createFakeDocument(), overrides = {}) {
  let clientCreations = 0;
  const integration = createDashboardAuthIntegration({
    documentLike: ui.documentLike,
    loadConfig: async () => ({ SUPABASE_CONFIG: publicConfig }),
    sdk: {
      createClient() {
        clientCreations += 1;
        return fake.client;
      },
    },
    ...overrides,
  });
  return { integration, ui, clientCreations: () => clientCreations };
}

const guest = createFakeClient();
const readyClients = [];
const guestHarness = createIntegration(guest, createFakeDocument(), {
  onClientReady(client) { readyClients.push(client); },
});
assert.equal(guestHarness.ui.root.dataset.authState, undefined, 'Construction must be inert');
const guestActivation = guestHarness.integration.activate();
assert.equal(guestHarness.integration.activate(), guestActivation, 'Duplicate activation must share one promise');
assert.equal(await guestActivation, true);
assert.equal(guestHarness.ui.root.dataset.authState, 'guest');
assert.equal(guestHarness.ui.identity.textContent, 'Guest');
assert.equal(guestHarness.ui.signIn.hidden, false);
assert.equal(guestHarness.ui.logout.hidden, true);
assert.equal(guestHarness.clientCreations(), 1);
assert.deepEqual(readyClients, [guest.client]);
assert.deepEqual(guest.counts, { getSession: 1, subscribe: 1, unsubscribe: 0, signOut: 0 });

const observedAuthStates = [];
const observedFake = createFakeClient({ session: sessionFor() });
const observedHarness = createIntegration(observedFake, createFakeDocument(), {
  onAuthStateChange(state) { observedAuthStates.push(state); },
});
assert.equal(await observedHarness.integration.activate(), true);
assert.equal(observedAuthStates.length, 4);
assert.equal(observedAuthStates.slice(0, -1).every(({ status, userId }) => status === 'loading' && userId === null), true);
assert.deepEqual(observedAuthStates.at(-1), { status: 'authenticated', userId: confirmedUser.id });
const previewAvailability = [];
const previewHarness = createIntegration(createFakeClient(), createFakeDocument(), {
  loadConfig: async () => ({ SUPABASE_CONFIG: publicConfig, ADMIN_CMS_PREVIEW_AVAILABLE: true }),
  onClientReady(_client, availability) { previewAvailability.push(availability); },
});
assert.equal(await previewHarness.integration.activate(), true);
assert.deepEqual(previewAvailability, [{ adminPreviewAvailable: true, adminProductionAvailable: false, adminLocalDevelopmentAvailable: false }]);
assert.equal(Object.isFrozen(previewAvailability[0]), true);
previewHarness.integration.cleanup();
const productionAvailability = [];
const productionHarness = createIntegration(createFakeClient(), createFakeDocument(), {
  loadConfig: async () => ({ SUPABASE_CONFIG: publicConfig, ADMIN_CMS_PRODUCTION_AVAILABLE: true }),
  onClientReady(_client, availability) { productionAvailability.push(availability); },
});
assert.equal(await productionHarness.integration.activate(), true);
assert.deepEqual(productionAvailability, [{ adminPreviewAvailable: false, adminProductionAvailable: true, adminLocalDevelopmentAvailable: false }]);
productionHarness.integration.cleanup();
const localAvailability = [];
const localHarness = createIntegration(createFakeClient(), createFakeDocument(), {
  loadConfig: async () => ({ SUPABASE_CONFIG: publicConfig, ADMIN_CMS_LOCAL_DEVELOPMENT_AVAILABLE: true }),
  onClientReady(_client, availability) { localAvailability.push(availability); },
});
assert.equal(await localHarness.integration.activate(), true);
assert.deepEqual(localAvailability, [{ adminPreviewAvailable: false, adminProductionAvailable: false, adminLocalDevelopmentAvailable: true }]);
localHarness.integration.cleanup();
assert.equal(observedAuthStates.every(Object.isFrozen), true);
assert.doesNotMatch(JSON.stringify(observedAuthStates), /cook@|never-render|access_token|refresh_token/);
const observedCountBeforeCleanup = observedAuthStates.length;
assert.equal(observedHarness.integration.cleanup(), true);
observedFake.emit('SIGNED_OUT', null);
assert.equal(observedAuthStates.length, observedCountBeforeCleanup, 'Retired Auth must suppress observer callbacks');

const invalidObservedStates = [];
const invalidObservedFake = createFakeClient({
  session: sessionFor({ ...confirmedUser, id: 'not-a-uuid' }),
});
const invalidObservedHarness = createIntegration(invalidObservedFake, createFakeDocument(), {
  onAuthStateChange(state) { invalidObservedStates.push(state); },
});
assert.equal(await invalidObservedHarness.integration.activate(), true);
assert.deepEqual(invalidObservedStates.at(-1), { status: 'error', userId: null });

for (const invalidId of [undefined, null, '', 'malformed-user-id']) {
  const boundaryStates = [];
  const boundaryHarness = createIntegration(createFakeClient(), createFakeDocument(), {
    createSessionService() {
      const state = { status: 'authenticated', user: { id: invalidId, email: '' } };
      return {
        subscribe(listener) { listener(state); return () => true; },
        async bootstrap() { return state; },
        async logout() { return { status: 'guest', user: null }; },
        cleanup() { return true; },
      };
    },
    onAuthStateChange(state) { boundaryStates.push(state); },
  });
  assert.equal(await boundaryHarness.integration.activate(), true);
  assert.deepEqual(boundaryStates.at(-1), { status: 'error', userId: null });
  assert.equal(boundaryStates.some(({ status }) => status === 'authenticated'), false);
}

async function observeInjectedAuthenticatedUser(user) {
  const states = [];
  const harness = createIntegration(createFakeClient(), createFakeDocument(), {
    createSessionService() {
      const state = { status: 'authenticated', user };
      return {
        subscribe(listener) { listener(state); return () => true; },
        async bootstrap() { return state; },
        async logout() { return { status: 'guest', user: null }; },
        cleanup() { return true; },
      };
    },
    onAuthStateChange(state) { states.push(state); },
  });
  assert.equal(await harness.integration.activate(), true);
  return states.at(-1);
}

let validThenInvalidReads = 0;
const validThenInvalid = await observeInjectedAuthenticatedUser({
  email: '',
  get id() {
    validThenInvalidReads += 1;
    return validThenInvalidReads === 1 ? confirmedUser.id : 'invalid-after-validation';
  },
});
assert.equal(validThenInvalidReads, 1);
assert.deepEqual(validThenInvalid, { status: 'authenticated', userId: confirmedUser.id });

const SECOND_VALID_USER_ID = '22222222-2222-4222-8222-222222222222';
let changingValidReads = 0;
const changingValid = await observeInjectedAuthenticatedUser({
  email: '',
  get id() {
    changingValidReads += 1;
    return changingValidReads === 1 ? confirmedUser.id : SECOND_VALID_USER_ID;
  },
});
assert.equal(changingValidReads, 1);
assert.deepEqual(changingValid, { status: 'authenticated', userId: confirmedUser.id });

const throwingIdentity = await observeInjectedAuthenticatedUser({
  email: '',
  get id() { throw new Error('PRIVATE_IDENTITY_GETTER'); },
});
assert.deepEqual(throwingIdentity, { status: 'error', userId: null });
assert.doesNotMatch(JSON.stringify(throwingIdentity), /PRIVATE_IDENTITY_GETTER/);

const throwingStateCallback = createIntegration(createFakeClient(), createFakeDocument(), {
  onAuthStateChange() { throw new Error('PRIVATE_AUTH_STATE_CALLBACK'); },
});
assert.equal(await throwingStateCallback.integration.activate(), true, 'Auth-state observer failures must stay isolated');

const throwingReadyCallback = createIntegration(createFakeClient(), createFakeDocument(), {
  onClientReady() { throw new Error('PRIVATE_CLIENT_READY_ERROR'); },
});
assert.equal(await throwingReadyCallback.integration.activate(), true, 'Client-ready failures must not break Auth');

const restoration = deferred();
const confirmed = createFakeClient({ getSession: () => restoration.promise });
const confirmedHarness = createIntegration(confirmed);
const confirmedActivation = confirmedHarness.integration.activate();
await Promise.resolve();
await Promise.resolve();
assert.equal(confirmedHarness.ui.root.dataset.authState, 'loading');
assert.equal(confirmedHarness.ui.root.attributes.get('aria-busy'), 'true');
restoration.resolve({ data: { session: sessionFor() }, error: null });
assert.equal(await confirmedActivation, true);
assert.equal(confirmedHarness.ui.root.dataset.authState, 'authenticated');
assert.equal(confirmedHarness.ui.identity.textContent, 'Admin Cook');
assert.equal(confirmedHarness.ui.label.textContent, 'Signed in');
assert.equal(confirmedHarness.ui.logout.hidden, false);
assert.doesNotMatch(confirmedHarness.ui.identity.textContent, /never-render|access_token|refresh_token/);

const regularUser = {
  ...confirmedUser,
  id: '22222222-2222-4222-8222-222222222222',
  email: 'regular@example.test',
  user_metadata: { display_name: 'Regular Cook' },
};
const switchingFake = createFakeClient({ session: sessionFor(confirmedUser) });
const switchingHarness = createIntegration(switchingFake);
assert.equal(await switchingHarness.integration.activate(), true);
assert.equal(switchingHarness.ui.identity.textContent, 'Admin Cook');
switchingFake.emit('SIGNED_IN', sessionFor(regularUser));
assert.equal(switchingHarness.ui.identity.textContent, 'Regular Cook');
switchingFake.emit('SIGNED_OUT', null);
assert.equal(switchingHarness.ui.identity.textContent, 'Guest');
switchingFake.emit('SIGNED_IN', sessionFor({ ...regularUser, user_metadata: {} }));
assert.equal(switchingHarness.ui.identity.textContent, 'Signed-in user');
assert.notEqual(switchingHarness.ui.identity.textContent, regularUser.email);
switchingFake.emit('SIGNED_IN', sessionFor({ ...regularUser, user_metadata: { display_name: '<b>Cook</b>' } }));
assert.equal(switchingHarness.ui.identity.textContent, '<b>Cook</b>', 'HTML-like names remain plain text');
switchingFake.emit('SIGNED_IN', sessionFor({ ...regularUser, user_metadata: { display_name: 'x'.repeat(80) } }));
assert.equal(switchingHarness.ui.identity.textContent, 'x'.repeat(80));
switchingFake.emit('SIGNED_IN', sessionFor({ ...regularUser, user_metadata: { display_name: 'x'.repeat(81) } }));
assert.equal(switchingHarness.ui.identity.textContent, 'Signed-in user');
for (const name of ['Juan Dela Cruz', 'María de la Cruz', 'Zoë Łukasz', 'می\u200cنا', 'क\u200dष']) {
  switchingFake.emit('SIGNED_IN', sessionFor({ ...regularUser, user_metadata: { display_name: name } }));
  assert.equal(switchingHarness.ui.identity.textContent, name);
}
for (const codePoint of [0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
  switchingFake.emit('SIGNED_IN', sessionFor({
    ...regularUser,
    user_metadata: { display_name: `Alice${String.fromCodePoint(codePoint)}Admin` },
  }));
  assert.equal(switchingHarness.ui.identity.textContent, 'Signed-in user');
  assert.notEqual(switchingHarness.ui.identity.textContent, regularUser.email);
}
switchingHarness.integration.cleanup();

const unvalidatedName = `Alice${String.fromCodePoint(0x202e)}Admin`;
const defensiveUi = createFakeDocument();
const defensiveHarness = createIntegration(createFakeClient(), defensiveUi, {
  createSessionService() {
    const state = { status: 'authenticated', user: { id: regularUser.id, email: regularUser.email, displayName: unvalidatedName } };
    return {
      subscribe(listener) { listener(state); return () => true; },
      async bootstrap() { return state; },
      async logout() { return { status: 'guest', user: null }; },
      cleanup() { return true; },
    };
  },
});
assert.equal(await defensiveHarness.integration.activate(), true);
assert.equal(defensiveUi.identity.textContent, 'Signed-in user', 'Renderer must independently reject directional controls');
assert.notEqual(defensiveUi.identity.textContent, regularUser.email);
defensiveHarness.integration.cleanup();

for (const displayName of ['', ' \u00a0 ', 42, 'Bad\nName']) {
  const fake = createFakeClient({ session: sessionFor({ ...regularUser, user_metadata: { display_name: displayName } }) });
  const harness = createIntegration(fake);
  assert.equal(await harness.integration.activate(), true);
  assert.equal(harness.ui.identity.textContent, 'Signed-in user');
  assert.notEqual(harness.ui.identity.textContent, regularUser.email);
  harness.integration.cleanup();
}

confirmed.emit('SIGNED_OUT', null);
assert.equal(confirmedHarness.ui.root.dataset.authState, 'guest');
confirmed.emit('SIGNED_IN', sessionFor());
assert.equal(confirmedHarness.ui.root.dataset.authState, 'authenticated');
await confirmedHarness.integration.logout();
assert.equal(confirmedHarness.ui.root.dataset.authState, 'guest');
assert.equal(confirmed.counts.signOut, 1);

const dashboardLogoutRequest = deferred();
const dashboardLogoutFake = createFakeClient({
  session: sessionFor(),
  signOut: () => dashboardLogoutRequest.promise,
});
const dashboardLogoutHarness = createIntegration(dashboardLogoutFake);
assert.equal(await dashboardLogoutHarness.integration.activate(), true);
const dashboardLogout = dashboardLogoutHarness.integration.logout();
const duplicateDashboardLogout = dashboardLogoutHarness.integration.logout();
assert.equal(duplicateDashboardLogout, dashboardLogout);
assert.equal(dashboardLogoutHarness.ui.root.dataset.authState, 'loading');
assert.equal(dashboardLogoutFake.counts.signOut, 1, 'Logout starts in the same synchronous turn');
assert.notEqual(dashboardLogoutHarness.ui.identity.textContent, 'Admin Cook');
dashboardLogoutFake.emit('SIGNED_IN', sessionFor());
assert.equal(dashboardLogoutHarness.ui.root.dataset.authState, 'loading');
assert.notEqual(dashboardLogoutHarness.ui.identity.textContent, 'Admin Cook');
dashboardLogoutRequest.resolve({ error: null });
assert.equal(await dashboardLogout, true);
assert.equal(dashboardLogoutHarness.ui.root.dataset.authState, 'guest');
assert.equal(dashboardLogoutHarness.ui.identity.textContent, 'Guest');
assert.equal(dashboardLogoutHarness.ui.logout.hidden, true);
assert.equal(dashboardLogoutFake.counts.signOut, 1);

const adminLink = new FakeElement();
adminLink.hidden = true;
const adminLogoutRequest = deferred();
const adminLogoutFake = createFakeClient({
  session: sessionFor(),
  signOut: () => adminLogoutRequest.promise,
});
let adminLinkController;
const adminLogoutHarness = createIntegration(adminLogoutFake, createFakeDocument(), {
  loadConfig: async () => ({ SUPABASE_CONFIG: publicConfig, ADMIN_CMS_PREVIEW_AVAILABLE: true }),
  onClientReady(client, availability) {
    assert.equal(availability.adminPreviewAvailable, true);
    adminLinkController = createDashboardAdminLink({
      client,
      link: adminLink,
      windowLike: null,
      createAccessService: () => ({
        check: () => Promise.resolve({ status: 'authorized' }),
        invalidate() {},
        cleanup() {},
      }),
    });
  },
  onAuthStateChange(state) { void adminLinkController?.handleAuthState(state); },
});
assert.equal(await adminLogoutHarness.integration.activate(), true);
await Promise.resolve();
assert.equal(adminLink.hidden, false, 'Verified Admin link becomes visible');
assert.equal(adminLink.attributes.get('href'), 'admin.html');
adminLogoutHarness.ui.logout.click();
assert.equal(adminLogoutFake.counts.signOut, 1);
assert.equal(adminLogoutHarness.ui.root.dataset.authState, 'loading');
assert.equal(adminLink.hidden, true, 'Logout hides the Admin link synchronously');
assert.equal(adminLink.attributes.has('href'), false, 'Logout removes the destination synchronously');
const adminLogout = adminLogoutHarness.integration.logout();
assert.equal(adminLogoutHarness.integration.logout(), adminLogout);
assert.equal(adminLogoutFake.counts.signOut, 1);
adminLogoutRequest.resolve({ error: null });
assert.equal(await adminLogout, true);
adminLinkController.cleanup();
adminLogoutHarness.integration.cleanup();

const failedLogout = createFakeClient({
  session: sessionFor(),
  signOutResult: { error: new Error('PRIVATE_LOGOUT_FAILURE') },
});
const failedLogoutHarness = createIntegration(failedLogout);
assert.equal(await failedLogoutHarness.integration.activate(), true);
assert.equal(await failedLogoutHarness.integration.logout(), false);
assert.equal(failedLogoutHarness.ui.root.dataset.authState, 'error');
assert.equal(failedLogoutHarness.ui.identity.textContent, 'Account unavailable');
assert.equal(failedLogout.counts.signOut, 1);
assert.doesNotMatch(failedLogoutHarness.ui.identity.textContent, /PRIVATE_LOGOUT_FAILURE/);

const pendingUser = { id: 'pending', email: 'pending@example.test', email_confirmed_at: null };
const pendingHarness = createIntegration(createFakeClient({ session: sessionFor(pendingUser) }));
assert.equal(await pendingHarness.integration.activate(), true);
assert.equal(pendingHarness.ui.root.dataset.authState, 'pending-confirmation');
assert.equal(pendingHarness.ui.identity.textContent, 'Confirm your email');
assert.equal(pendingHarness.ui.logout.hidden, false);

const expired = createFakeClient({ session: { ...sessionFor(), expires_at: 1 } });
const expiredHarness = createIntegration(expired);
assert.equal(await expiredHarness.integration.activate(), true);
assert.equal(expiredHarness.ui.root.dataset.authState, 'error');
assert.equal(expiredHarness.ui.identity.textContent, 'Account unavailable');
expired.emit('TOKEN_REFRESHED', sessionFor());
assert.equal(expiredHarness.ui.root.dataset.authState, 'authenticated');
assert.equal(expiredHarness.ui.identity.textContent, 'Admin Cook');

for (const malformedSession of [
  { ...sessionFor(), user: [] },
  { ...sessionFor(), user: { id: '   ', email_confirmed_at: confirmedUser.email_confirmed_at } },
  { ...sessionFor(), access_token: '   ' },
]) {
  const malformedHarness = createIntegration(createFakeClient({ session: malformedSession }));
  assert.equal(await malformedHarness.integration.activate(), true);
  assert.equal(malformedHarness.ui.root.dataset.authState, 'error');
  assert.equal(malformedHarness.ui.identity.textContent, 'Account unavailable');
}

const staleRestoration = deferred();
const ordered = createFakeClient({ getSession: () => staleRestoration.promise });
const orderedHarness = createIntegration(ordered);
const orderedActivation = orderedHarness.integration.activate();
await Promise.resolve();
await Promise.resolve();
ordered.emit('SIGNED_IN', sessionFor());
staleRestoration.resolve({ data: { session: null }, error: null });
assert.equal(await orderedActivation, true);
assert.equal(orderedHarness.ui.root.dataset.authState, 'authenticated', 'A stale restoration must not replace a newer event');
assert.equal(orderedHarness.ui.identity.textContent, 'Admin Cook');

const staleNameRestore = deferred();
const staleNameFake = createFakeClient({ getSession: () => staleNameRestore.promise });
const staleNameHarness = createIntegration(staleNameFake);
const staleNameActivation = staleNameHarness.integration.activate();
await Promise.resolve();
await Promise.resolve();
staleNameFake.emit('SIGNED_IN', sessionFor(regularUser));
staleNameRestore.resolve({ data: { session: sessionFor(confirmedUser) }, error: null });
assert.equal(await staleNameActivation, true);
assert.equal(staleNameHarness.ui.identity.textContent, 'Regular Cook', 'Stale restoration cannot restore the previous name');
staleNameFake.emit('SIGNED_OUT', null);
assert.equal(staleNameHarness.ui.identity.textContent, 'Guest');
staleNameHarness.integration.cleanup();

const cleanupRestoration = deferred();
const cleanupFake = createFakeClient({ getSession: () => cleanupRestoration.promise });
const cleanupHarness = createIntegration(cleanupFake);
const cleanupActivation = cleanupHarness.integration.activate();
await Promise.resolve();
await Promise.resolve();
const identityBeforeCleanup = cleanupHarness.ui.identity.textContent;
assert.equal(cleanupHarness.integration.cleanup(), true);
assert.equal(cleanupHarness.integration.cleanup(), false);
cleanupRestoration.resolve({ data: { session: sessionFor() }, error: null });
assert.equal(await cleanupActivation, false);
assert.equal(cleanupHarness.ui.identity.textContent, identityBeforeCleanup, 'Late restoration must not mutate retired UI');
assert.equal(cleanupHarness.ui.root.attributes.get('aria-busy'), 'false');
assert.equal(cleanupFake.counts.unsubscribe, 1);

const unavailableUi = createFakeDocument();
const unavailable = createDashboardAuthIntegration({
  documentLike: unavailableUi.documentLike,
  loadConfig: async () => { throw new Error('PRIVATE_CONFIG_FAILURE'); },
  sdk: {},
});
assert.equal(await unavailable.activate(), false);
assert.equal(unavailableUi.root.dataset.authState, 'error');
assert.equal(unavailableUi.identity.textContent, 'Account unavailable');
assert.doesNotMatch(JSON.stringify({
  label: unavailableUi.label.textContent,
  identity: unavailableUi.identity.textContent,
}), /PRIVATE_CONFIG_FAILURE/);

let serviceCreationAttempts = 0;
const retainedClientFake = createFakeClient();
const retainedClientHarness = createIntegration(retainedClientFake, createFakeDocument(), {
  createSessionService(client) {
    serviceCreationAttempts += 1;
    if (serviceCreationAttempts === 1) throw new Error('PRIVATE_TRANSIENT_SERVICE_FAILURE');
    return createAuthSessionService(client);
  },
});
assert.equal(await retainedClientHarness.integration.activate(), false);
await Promise.resolve();
assert.equal(await retainedClientHarness.integration.activate(), true);
assert.equal(retainedClientHarness.clientCreations(), 1, 'Retry must retain the accepted page client');

const unhandledRejections = [];
const captureUnhandled = (reason) => unhandledRejections.push(reason);
process.on('unhandledRejection', captureUnhandled);

const rejectedLogoutHarness = createIntegration(createFakeClient({
  session: sessionFor(),
  signOut: () => Promise.reject(new Error('PRIVATE_ASYNC_LOGOUT_REJECTION')),
}));
assert.equal(await rejectedLogoutHarness.integration.activate(), true);
const rejectedLogout = rejectedLogoutHarness.integration.logout();
assert.equal(rejectedLogoutHarness.ui.root.dataset.authState, 'loading');
assert.equal(await rejectedLogout, false);
assert.equal(rejectedLogoutHarness.ui.root.dataset.authState, 'error');
assert.doesNotMatch(rejectedLogoutHarness.ui.identity.textContent, /PRIVATE_ASYNC_LOGOUT_REJECTION/);

const synchronousLogoutFailure = createIntegration(createFakeClient(), createFakeDocument(), {
  createSessionService() {
    return {
      subscribe(listener) {
        listener({ status: 'authenticated', user: confirmedUser });
        return () => true;
      },
      async bootstrap() { return true; },
      logout() { throw new Error('PRIVATE_SYNC_LOGOUT_FAILURE'); },
      cleanup() {},
    };
  },
});
assert.equal(await synchronousLogoutFailure.integration.activate(), true);
assert.equal(await synchronousLogoutFailure.integration.logout(), false);
assert.equal(synchronousLogoutFailure.ui.root.dataset.authState, 'error');
assert.doesNotMatch(synchronousLogoutFailure.ui.identity.textContent, /PRIVATE_SYNC_LOGOUT_FAILURE/);

for (const createHostileUi of [
  () => {
    const ui = createFakeDocument();
    Object.defineProperty(ui.root, 'dataset', {
      configurable: true,
      get() { throw new Error('PRIVATE_DATASET_GETTER'); },
    });
    return ui;
  },
  () => {
    const ui = createFakeDocument();
    ui.root.setAttribute = () => { throw new Error('PRIVATE_SET_ATTRIBUTE'); };
    return ui;
  },
  () => {
    const ui = createFakeDocument();
    Object.defineProperty(ui.label, 'textContent', {
      configurable: true,
      set() { throw new Error('PRIVATE_TEXT_SETTER'); },
    });
    return ui;
  },
  () => {
    const ui = createFakeDocument();
    Object.defineProperty(ui.signIn, 'hidden', {
      configurable: true,
      set() { throw new Error('PRIVATE_HIDDEN_SETTER'); },
    });
    return ui;
  },
]) {
  const hostileUi = createHostileUi();
  const hostileHarness = createIntegration(createFakeClient(), hostileUi);
  assert.equal(await hostileHarness.integration.activate(), false);
  assert.equal(hostileHarness.clientCreations(), 0, 'Initial rendering failure must precede client construction');
}

const listenerFailureUi = createFakeDocument();
listenerFailureUi.logout.addEventListener = () => { throw new Error('PRIVATE_LISTENER_FAILURE'); };
const listenerFailureHarness = createIntegration(createFakeClient(), listenerFailureUi);
assert.equal(await listenerFailureHarness.integration.activate(), false);
assert.equal(listenerFailureHarness.clientCreations(), 1);

const cleanupDomUi = createFakeDocument();
const cleanupDomHarness = createIntegration(createFakeClient(), cleanupDomUi);
assert.equal(await cleanupDomHarness.integration.activate(), true);
cleanupDomUi.root.setAttribute = () => { throw new Error('PRIVATE_CLEANUP_SETTER'); };
assert.doesNotThrow(() => cleanupDomHarness.integration.cleanup());

const hostileDocument = new Proxy({}, {
  get() { throw new Error('PRIVATE_DOCUMENT_PROXY'); },
});
assert.throws(
  () => createDashboardAuthIntegration({ documentLike: hostileDocument }),
  (error) => error instanceof TypeError
    && error.message === 'Dashboard account controls are unavailable.'
    && !JSON.stringify(error).includes('PRIVATE_DOCUMENT_PROXY'),
);

await new Promise((resolve) => setImmediate(resolve));
process.removeListener('unhandledRejection', captureUnhandled);
assert.deepEqual(unhandledRejections, []);

assert.throws(
  () => createDashboardAuthIntegration({ documentLike: { querySelector: () => null } }),
  /Dashboard account controls are unavailable/
);

const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.match(index, /data-dashboard-auth/);
assert.match(index, /data-auth-message role="status" aria-live="polite" aria-atomic="true"/);
assert.match(index, /@supabase\/supabase-js@2\.118\.0\/dist\/umd\/supabase\.js/);
assert.match(index, /integrity="sha384-TcHRA3zBbn\+Lexh5n\+Oil4guNPOS3rjNDpGRAN46u\/s\/mB2IZ50ceC6TYDU2yvgK"/);
assert.match(index, /<script type="module" src="app\.js"><\/script>/);
assert.doesNotMatch(index, /<script type="module" src="js\/dashboard-auth\.js"><\/script>/);

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
assert.match(app, /createDashboardAuthIntegration/);
assert.match(app, /onClientReady: acceptDashboardClient/);
assert.equal((app.match(/\.activate\(\)/g) || []).length, 1, 'Dashboard Auth must activate exactly once');

console.log('Offline dashboard authentication integration tests passed with fake clients only.');
