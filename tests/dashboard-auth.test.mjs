import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuthSessionService } from '../js/auth-session.js';
import { createDashboardAuthIntegration } from '../js/dashboard-auth.js';

const confirmedUser = Object.freeze({
  id: 'dashboard-user',
  email: 'cook@example.test',
  email_confirmed_at: '2026-11-01T00:00:00Z',
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
const guestHarness = createIntegration(guest);
assert.equal(guestHarness.ui.root.dataset.authState, undefined, 'Construction must be inert');
const guestActivation = guestHarness.integration.activate();
assert.equal(guestHarness.integration.activate(), guestActivation, 'Duplicate activation must share one promise');
assert.equal(await guestActivation, true);
assert.equal(guestHarness.ui.root.dataset.authState, 'guest');
assert.equal(guestHarness.ui.identity.textContent, 'Guest');
assert.equal(guestHarness.ui.signIn.hidden, false);
assert.equal(guestHarness.ui.logout.hidden, true);
assert.equal(guestHarness.clientCreations(), 1);
assert.deepEqual(guest.counts, { getSession: 1, subscribe: 1, unsubscribe: 0, signOut: 0 });

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
assert.equal(confirmedHarness.ui.identity.textContent, confirmedUser.email);
assert.equal(confirmedHarness.ui.logout.hidden, false);
assert.doesNotMatch(confirmedHarness.ui.identity.textContent, /never-render|access_token|refresh_token/);

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
await Promise.resolve();
assert.equal(dashboardLogoutHarness.ui.root.dataset.authState, 'loading');
assert.notEqual(dashboardLogoutHarness.ui.identity.textContent, confirmedUser.email);
dashboardLogoutFake.emit('SIGNED_IN', sessionFor());
assert.equal(dashboardLogoutHarness.ui.root.dataset.authState, 'loading');
assert.notEqual(dashboardLogoutHarness.ui.identity.textContent, confirmedUser.email);
dashboardLogoutRequest.resolve({ error: null });
assert.equal(await dashboardLogout, true);
assert.equal(dashboardLogoutHarness.ui.root.dataset.authState, 'guest');
assert.equal(dashboardLogoutHarness.ui.identity.textContent, 'Guest');
assert.equal(dashboardLogoutHarness.ui.logout.hidden, true);
assert.equal(dashboardLogoutFake.counts.signOut, 1);

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
assert.equal(expiredHarness.ui.identity.textContent, confirmedUser.email);

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
assert.match(index, /<script type="module" src="app\.js"><\/script>[\s\S]*?<script type="module" src="js\/dashboard-auth\.js"><\/script>/);

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
assert.doesNotMatch(app, /dashboard-auth|createAuthSessionService|supabase/i, 'Recipe discovery must remain independent of dashboard Auth');

console.log('Offline dashboard authentication integration tests passed with fake clients only.');
