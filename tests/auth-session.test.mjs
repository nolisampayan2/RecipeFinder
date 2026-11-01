import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AUTH_SESSION_STATUS,
  createAuthSessionService,
  isEmailConfirmed,
} from '../js/auth-session.js';

const confirmedUser = Object.freeze({
  id: 'confirmed-user',
  email: 'confirmed@example.test',
  email_confirmed_at: '2026-10-29T00:00:00Z',
});
const legacyConfirmedUser = Object.freeze({
  id: 'legacy-confirmed-user',
  email: 'legacy@example.test',
  confirmed_at: '2026-10-29T00:00:00Z',
});
const unconfirmedUser = Object.freeze({
  id: 'pending-user',
  email: 'pending@example.test',
  user_metadata: { email_verified: true },
});
const FIXED_NOW_MILLISECONDS = Date.UTC(2026, 10, 1, 12, 0, 0);
const FIXED_NOW_SECONDS = Math.floor(FIXED_NOW_MILLISECONDS / 1000);
const VALID_EXPIRY_SECONDS = 4102444800;

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function sessionFor(user = confirmedUser) {
  return {
    access_token: 'fixture-access-token',
    refresh_token: 'fixture-refresh-token',
    expires_at: VALID_EXPIRY_SECONDS,
    user,
  };
}

function createFakeClient({
  session = null,
  getSessionResult,
  getSessionError,
  signOutResult,
  signOut,
  subscriptionResult,
} = {}) {
  let authListener = null;
  let getSessionCalls = 0;
  let subscriptionCalls = 0;
  let unsubscribeCalls = 0;
  let signOutCalls = 0;
  const auth = {
    async getSession() {
      getSessionCalls += 1;
      if (getSessionError) throw getSessionError;
      return getSessionResult ? await getSessionResult() : { data: { session }, error: null };
    },
    onAuthStateChange(listener) {
      subscriptionCalls += 1;
      authListener = listener;
      return subscriptionResult ?? { data: { subscription: { unsubscribe() { unsubscribeCalls += 1; } } } };
    },
    async signOut(options) {
      signOutCalls += 1;
      assert.deepEqual(options, { scope: 'local' });
      if (signOut) return signOut(options);
      return signOutResult === undefined ? { error: null } : signOutResult;
    },
  };
  return {
    client: { auth },
    emit(event, nextSession) { authListener?.(event, nextSession); },
    counts() { return { getSessionCalls, subscriptionCalls, unsubscribeCalls, signOutCalls }; },
  };
}

assert.equal(isEmailConfirmed(confirmedUser), true);
assert.equal(isEmailConfirmed({ ...confirmedUser, email_confirmed_at: '2026-10-29T08:30:45.123+08:00' }), true);
assert.equal(isEmailConfirmed(legacyConfirmedUser), false, 'Generic confirmation must not prove email verification');
assert.equal(isEmailConfirmed(unconfirmedUser), false, 'User-controlled metadata must not confirm an account');
assert.equal(isEmailConfirmed(null), false);
for (const emailConfirmedAt of [
  undefined,
  null,
  '',
  '   ',
  'not-a-timestamp',
  '2026-02-29T00:00:00Z',
  '2026-04-31T00:00:00Z',
  '2026-10-29T00:00:00',
  '2026-10-29 00:00:00Z',
  '2026-10-29T24:00:00Z',
  '2026-10-29T00:00:00+14:01',
  1761696000000,
]) {
  assert.equal(isEmailConfirmed({ email_confirmed_at: emailConfirmedAt }), false, `Must reject ${String(emailConfirmedAt)}`);
}
assert.throws(() => createAuthSessionService(), /compatible Supabase Auth session client/);
assert.throws(() => createAuthSessionService({ auth: {} }), /compatible Supabase Auth session client/);

const guestFake = createFakeClient();
const guestService = createAuthSessionService(guestFake.client);
assert.deepEqual(guestService.getState(), { status: AUTH_SESSION_STATUS.LOADING, user: null });
const guestSnapshots = [];
const unsubscribeGuest = guestService.subscribe((state) => guestSnapshots.push(state));
const guestBootstrap = guestService.bootstrap();
assert.equal(guestService.bootstrap(), guestBootstrap, 'Bootstrap must be idempotent');
assert.deepEqual(await guestBootstrap, { status: AUTH_SESSION_STATUS.GUEST, user: null });
assert.deepEqual(guestFake.counts(), { getSessionCalls: 1, subscriptionCalls: 1, unsubscribeCalls: 0, signOutCalls: 0 });
assert.equal(unsubscribeGuest(), true);
assert.equal(unsubscribeGuest(), false, 'Listener cleanup must be idempotent');

const isolatedListenerFake = createFakeClient();
const isolatedListenerService = createAuthSessionService(isolatedListenerFake.client);
const isolatedSnapshots = [];
assert.doesNotThrow(() => isolatedListenerService.subscribe(() => { throw new Error('private subscriber failure'); }));
isolatedListenerService.subscribe((state) => isolatedSnapshots.push(state.status));
assert.equal((await isolatedListenerService.bootstrap()).status, AUTH_SESSION_STATUS.GUEST);
isolatedListenerFake.emit('SIGNED_IN', sessionFor());
assert.equal(isolatedListenerService.getState().status, AUTH_SESSION_STATUS.AUTHENTICATED);
assert.deepEqual(isolatedSnapshots, [AUTH_SESSION_STATUS.LOADING, AUTH_SESSION_STATUS.LOADING, AUTH_SESSION_STATUS.GUEST, AUTH_SESSION_STATUS.AUTHENTICATED]);

const confirmedFake = createFakeClient({ session: { ...sessionFor(), access_token: 'never-public' } });
const confirmedService = createAuthSessionService(confirmedFake.client);
assert.deepEqual(await confirmedService.bootstrap(), {
  status: AUTH_SESSION_STATUS.AUTHENTICATED,
  user: { id: confirmedUser.id, email: confirmedUser.email },
});
assert.doesNotMatch(JSON.stringify(confirmedService.getState()), /never-public|access_token|refresh_token/);

for (const expiresAt of [
  undefined,
  null,
  '',
  String(FIXED_NOW_SECONDS + 60),
  Number.NaN,
  Number.POSITIVE_INFINITY,
  FIXED_NOW_SECONDS + 0.5,
  0,
  -1,
  FIXED_NOW_SECONDS,
  FIXED_NOW_SECONDS - 1,
]) {
  const expiryFake = createFakeClient({ session: { ...sessionFor(), expires_at: expiresAt } });
  const expiryService = createAuthSessionService(expiryFake.client, { now: () => FIXED_NOW_MILLISECONDS });
  assert.equal(
    (await expiryService.bootstrap()).status,
    AUTH_SESSION_STATUS.ERROR,
    `Expiry evidence ${String(expiresAt)} must fail closed`,
  );
  assert.doesNotMatch(JSON.stringify(expiryService.getState()), /expires_at|fixture-access-token|fixture-refresh-token/);
}

const validExpiryFake = createFakeClient({
  session: { ...sessionFor(), expires_at: FIXED_NOW_SECONDS + 1 },
});
const validExpiryService = createAuthSessionService(validExpiryFake.client, {
  now: () => FIXED_NOW_MILLISECONDS,
});
assert.equal((await validExpiryService.bootstrap()).status, AUTH_SESSION_STATUS.AUTHENTICATED);

const throwingExpirySession = { ...sessionFor() };
Object.defineProperty(throwingExpirySession, 'expires_at', {
  get() { throw new Error('PRIVATE_EXPIRY_GETTER'); },
});
const throwingExpiryFake = createFakeClient({ session: throwingExpirySession });
const throwingExpiryService = createAuthSessionService(throwingExpiryFake.client, {
  now: () => FIXED_NOW_MILLISECONDS,
});
assert.equal((await throwingExpiryService.bootstrap()).status, AUTH_SESSION_STATUS.ERROR);
assert.doesNotMatch(JSON.stringify(throwingExpiryService.getState()), /PRIVATE_EXPIRY_GETTER/);

const refreshedExpiryFake = createFakeClient({
  session: { ...sessionFor(), expires_at: FIXED_NOW_SECONDS - 1 },
});
const refreshedExpiryService = createAuthSessionService(refreshedExpiryFake.client, {
  now: () => FIXED_NOW_MILLISECONDS,
});
assert.equal((await refreshedExpiryService.bootstrap()).status, AUTH_SESSION_STATUS.ERROR);
refreshedExpiryFake.emit('TOKEN_REFRESHED', {
  ...sessionFor(),
  expires_at: FIXED_NOW_SECONDS + 3600,
});
assert.equal(
  refreshedExpiryService.getState().status,
  AUTH_SESSION_STATUS.AUTHENTICATED,
  'A later provider-refreshed session with valid expiry may authenticate',
);

const pendingFake = createFakeClient({ session: sessionFor(unconfirmedUser) });
const pendingService = createAuthSessionService(pendingFake.client);
assert.equal((await pendingService.bootstrap()).status, AUTH_SESSION_STATUS.PENDING_CONFIRMATION);
pendingFake.emit('USER_UPDATED', { ...sessionFor(), refresh_token: 'never-public-refresh' });
assert.deepEqual(pendingService.getState(), {
  status: AUTH_SESSION_STATUS.AUTHENTICATED,
  user: { id: confirmedUser.id, email: confirmedUser.email },
});
pendingFake.emit('SIGNED_OUT', null);
assert.deepEqual(pendingService.getState(), { status: AUTH_SESSION_STATUS.GUEST, user: null });

const logoutFake = createFakeClient({ session: sessionFor() });
const logoutService = createAuthSessionService(logoutFake.client);
await logoutService.bootstrap();
assert.deepEqual(await logoutService.logout(), { status: AUTH_SESSION_STATUS.GUEST, user: null });
assert.equal(logoutFake.counts().signOutCalls, 1);
assert.equal(logoutService.cleanup(), true);
assert.equal(logoutService.cleanup(), false);
assert.equal(logoutFake.counts().unsubscribeCalls, 1);

for (const [event, eventSession] of [
  ['SIGNED_IN', sessionFor()],
  ['TOKEN_REFRESHED', sessionFor()],
  ['SIGNED_OUT', null],
]) {
  const signOutRequest = deferred();
  const fake = createFakeClient({
    session: sessionFor(),
    signOut: () => signOutRequest.promise,
  });
  const service = createAuthSessionService(fake.client);
  await service.bootstrap();
  const firstLogout = service.logout();
  const duplicateLogout = service.logout();
  assert.equal(duplicateLogout, firstLogout, 'Duplicate logout must share the pending operation');
  assert.deepEqual(service.getState(), { status: AUTH_SESSION_STATUS.LOADING, user: null });
  fake.emit(event, eventSession);
  assert.deepEqual(
    service.getState(),
    { status: AUTH_SESSION_STATUS.LOADING, user: null },
    `${event} must not publish while logout owns the state`,
  );
  signOutRequest.resolve({ error: null });
  assert.deepEqual(await firstLogout, { status: AUTH_SESSION_STATUS.GUEST, user: null });
  assert.equal(fake.counts().signOutCalls, 1);
  fake.emit('SIGNED_IN', sessionFor());
  assert.equal(
    service.getState().status,
    AUTH_SESSION_STATUS.AUTHENTICATED,
    'Legitimate Auth events must resume after logout settles',
  );
}

const logoutRestorationRequest = deferred();
const logoutRestorationSignOut = deferred();
const logoutRestorationFake = createFakeClient({
  getSessionResult: () => logoutRestorationRequest.promise,
  signOut: () => logoutRestorationSignOut.promise,
});
const logoutRestorationService = createAuthSessionService(logoutRestorationFake.client);
const logoutRestorationBootstrap = logoutRestorationService.bootstrap();
const logoutDuringRestoration = logoutRestorationService.logout();
logoutRestorationRequest.resolve({ data: { session: sessionFor() }, error: null });
await logoutRestorationBootstrap;
assert.equal(logoutRestorationService.getState().status, AUTH_SESSION_STATUS.LOADING);
logoutRestorationSignOut.resolve({ error: null });
assert.equal((await logoutDuringRestoration).status, AUTH_SESSION_STATUS.GUEST);

const pendingFailedSignOut = deferred();
const pendingFailedLogoutFake = createFakeClient({
  session: sessionFor(),
  signOut: () => pendingFailedSignOut.promise,
});
const pendingFailedLogoutService = createAuthSessionService(pendingFailedLogoutFake.client);
await pendingFailedLogoutService.bootstrap();
const pendingFailedLogout = pendingFailedLogoutService.logout();
pendingFailedLogoutFake.emit('SIGNED_IN', sessionFor());
pendingFailedSignOut.resolve({ error: new Error('PRIVATE_PENDING_LOGOUT_FAILURE') });
assert.equal((await pendingFailedLogout).status, AUTH_SESSION_STATUS.ERROR);
assert.equal(pendingFailedLogoutService.getState().user, null);
assert.doesNotMatch(JSON.stringify(pendingFailedLogoutService.getState()), /PRIVATE_PENDING_LOGOUT_FAILURE/);

const cleanupLogoutRequest = deferred();
const cleanupLogoutFake = createFakeClient({
  session: sessionFor(),
  signOut: () => cleanupLogoutRequest.promise,
});
const cleanupLogoutService = createAuthSessionService(cleanupLogoutFake.client);
await cleanupLogoutService.bootstrap();
const cleanupPendingLogout = cleanupLogoutService.logout();
assert.equal(cleanupLogoutService.cleanup(), true);
cleanupLogoutFake.emit('SIGNED_IN', sessionFor());
cleanupLogoutRequest.resolve({ error: null });
assert.equal((await cleanupPendingLogout).status, AUTH_SESSION_STATUS.LOADING);
assert.equal(cleanupLogoutService.getState().status, AUTH_SESSION_STATUS.LOADING);
assert.equal(cleanupLogoutFake.counts().signOutCalls, 1);

const failedLogoutFake = createFakeClient({
  session: sessionFor(),
  signOutResult: { error: new Error('raw offline sign-out error') },
});
const failedLogoutService = createAuthSessionService(failedLogoutFake.client);
await failedLogoutService.bootstrap();
assert.equal((await failedLogoutService.logout()).status, AUTH_SESSION_STATUS.ERROR);
assert.doesNotMatch(JSON.stringify(failedLogoutService.getState()), /raw offline sign-out error/);

const staleRequest = deferred();
const staleFake = createFakeClient({ getSessionResult: () => staleRequest.promise });
const staleService = createAuthSessionService(staleFake.client);
const staleBootstrap = staleService.bootstrap();
staleFake.emit('SIGNED_IN', sessionFor());
staleRequest.resolve({ data: { session: null }, error: null });
assert.equal((await staleBootstrap).status, AUTH_SESSION_STATUS.AUTHENTICATED, 'Late restoration must not overwrite a newer Auth event');

const failingFake = createFakeClient({ getSessionError: new Error('raw offline provider error') });
const failingService = createAuthSessionService(failingFake.client);
assert.deepEqual(await failingService.bootstrap(), {
  status: AUTH_SESSION_STATUS.ERROR,
  user: null,
  error: { code: 'AUTH_UNAVAILABLE', message: 'Account status is temporarily unavailable.' },
});
assert.doesNotMatch(JSON.stringify(failingService.getState()), /raw offline provider error/);
const failedBootstrapPromise = failingService.bootstrap();
assert.equal(failedBootstrapPromise, failingService.bootstrap(), 'Terminal bootstrap failure must remain cached');
assert.equal((await failedBootstrapPromise).status, AUTH_SESSION_STATUS.ERROR);
assert.equal(failingFake.counts().getSessionCalls, 1, 'Retry requires a fresh service instance');

const malformedSubscriptionService = createAuthSessionService({
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: null } }),
    signOut: async () => ({ error: null }),
  },
});
assert.equal((await malformedSubscriptionService.bootstrap()).status, AUTH_SESSION_STATUS.ERROR);

async function bootstrapResult(result) {
  const fake = createFakeClient({ getSessionResult: () => Promise.resolve(result) });
  const service = createAuthSessionService(fake.client);
  return { fake, service, state: await service.bootstrap() };
}

const decoratedResponse = Object.assign([], {
  data: { session: sessionFor() },
  error: null,
});
const decoratedData = Object.assign([], { session: sessionFor() });
const decoratedSession = Object.assign([], sessionFor());
const decoratedUser = Object.assign([], confirmedUser);

for (const result of [
  null,
  undefined,
  false,
  [],
  decoratedResponse,
  {},
  { data: { session: sessionFor() } },
  { data: { session: sessionFor() }, error: undefined },
  { data: null, error: null },
  { data: false, error: null },
  { data: [], error: null },
  { data: decoratedData, error: null },
  { data: {}, error: null },
  { data: { session: undefined }, error: null },
  { data: { session: false }, error: null },
  { data: { session: decoratedSession }, error: null },
  { data: { session: { ...sessionFor(), user: decoratedUser } }, error: null },
  { data: { session: { ...sessionFor(), user: { ...confirmedUser, id: '' } } }, error: null },
  { data: { session: { ...sessionFor(), user: { ...confirmedUser, id: '   ' } } }, error: null },
  { data: { session: { ...sessionFor(), access_token: '' } }, error: null },
  { data: { session: { ...sessionFor(), access_token: '   ' } }, error: null },
  { data: { session: { ...sessionFor(), refresh_token: null } }, error: null },
  { data: { session: { ...sessionFor(), refresh_token: '\t' } }, error: null },
]) {
  const { state } = await bootstrapResult(result);
  assert.deepEqual(state, {
    status: AUTH_SESSION_STATUS.ERROR,
    user: null,
    error: { code: 'AUTH_UNAVAILABLE', message: 'Account status is temporarily unavailable.' },
  });
}

const throwingDataResult = { error: null };
Object.defineProperty(throwingDataResult, 'data', {
  enumerable: true,
  get() { throw new Error('raw data getter detail'); },
});
const throwingSessionData = {};
Object.defineProperty(throwingSessionData, 'session', {
  enumerable: true,
  get() { throw new Error('raw session getter detail'); },
});
const throwingUserSession = {
  access_token: 'fixture-access-token',
  refresh_token: 'fixture-refresh-token',
};
Object.defineProperty(throwingUserSession, 'user', {
  enumerable: true,
  get() { throw new Error('raw user getter detail'); },
});
const throwingSessionProxy = new Proxy(sessionFor(), {
  get(target, property, receiver) {
    if (property === 'access_token') throw new Error('raw proxy detail');
    return Reflect.get(target, property, receiver);
  },
});

for (const result of [
  throwingDataResult,
  { data: throwingSessionData, error: null },
  { data: { session: throwingUserSession }, error: null },
  { data: { session: throwingSessionProxy }, error: null },
]) {
  const { state } = await bootstrapResult(result);
  assert.equal(state.status, AUTH_SESSION_STATUS.ERROR);
  assert.doesNotMatch(JSON.stringify(state), /getter|proxy|fixture-access-token/i);
}

const malformedConfirmation = await bootstrapResult({
  data: { session: sessionFor({ ...confirmedUser, email_confirmed_at: '2026-02-29T00:00:00Z' }) },
  error: null,
});
assert.equal(malformedConfirmation.state.status, AUTH_SESSION_STATUS.PENDING_CONFIRMATION);

for (const signOutResult of [
  null,
  [],
  Object.assign([], { error: null }),
  {},
  { error: undefined },
  { error: new Error('raw logout detail') },
]) {
  const fake = createFakeClient({ session: sessionFor(), signOutResult });
  const service = createAuthSessionService(fake.client);
  await service.bootstrap();
  assert.equal((await service.logout()).status, AUTH_SESSION_STATUS.ERROR);
  assert.equal(fake.counts().signOutCalls, 1);
  assert.doesNotMatch(JSON.stringify(service.getState()), /raw logout detail|fixture-access-token/i);
}

for (const signOut of [
  () => undefined,
  () => { throw new Error('raw synchronous logout detail'); },
  () => Promise.reject(new Error('raw rejected logout detail')),
]) {
  const fake = createFakeClient({ session: sessionFor(), signOut });
  const service = createAuthSessionService(fake.client);
  await service.bootstrap();
  assert.equal((await service.logout()).status, AUTH_SESSION_STATUS.ERROR);
  assert.equal(fake.counts().signOutCalls, 1);
}

const throwingLogoutResult = {};
Object.defineProperty(throwingLogoutResult, 'error', {
  enumerable: true,
  get() { throw new Error('raw logout getter detail'); },
});
const throwingLogoutFake = createFakeClient({ session: sessionFor(), signOutResult: throwingLogoutResult });
const throwingLogoutService = createAuthSessionService(throwingLogoutFake.client);
await throwingLogoutService.bootstrap();
assert.equal((await throwingLogoutService.logout()).status, AUTH_SESSION_STATUS.ERROR);
assert.equal(throwingLogoutFake.counts().signOutCalls, 1);

const eventFake = createFakeClient({ session: sessionFor() });
const eventService = createAuthSessionService(eventFake.client);
await eventService.bootstrap();
for (const malformedEventSession of [
  decoratedSession,
  { ...sessionFor(), user: decoratedUser },
  { ...sessionFor(), user: { ...confirmedUser, id: ' ' } },
  { user: confirmedUser },
  throwingUserSession,
  throwingSessionProxy,
]) {
  eventFake.emit('SIGNED_IN', sessionFor());
  assert.equal(eventService.getState().status, AUTH_SESSION_STATUS.AUTHENTICATED);
  assert.doesNotThrow(() => eventFake.emit('TOKEN_REFRESHED', malformedEventSession));
  assert.equal(eventService.getState().status, AUTH_SESSION_STATUS.ERROR);
}
eventFake.emit('SIGNED_IN', sessionFor());
eventFake.emit('SIGNED_IN', null);
assert.equal(eventService.getState().status, AUTH_SESSION_STATUS.ERROR);
eventFake.emit('SIGNED_OUT', sessionFor());
assert.equal(eventService.getState().status, AUTH_SESSION_STATUS.ERROR);
eventFake.emit('SIGNED_OUT', null);
assert.deepEqual(eventService.getState(), { status: AUTH_SESSION_STATUS.GUEST, user: null });
eventFake.emit('TOKEN_REFRESHED', sessionFor());
assert.equal(eventService.getState().status, AUTH_SESSION_STATUS.AUTHENTICATED);

const logoutDuringRestoreRequest = deferred();
const logoutDuringRestoreFake = createFakeClient({ getSessionResult: () => logoutDuringRestoreRequest.promise });
const logoutDuringRestoreService = createAuthSessionService(logoutDuringRestoreFake.client);
const restoringBootstrap = logoutDuringRestoreService.bootstrap();
const restoringLogout = logoutDuringRestoreService.logout();
logoutDuringRestoreRequest.resolve({ data: { session: sessionFor() }, error: null });
assert.equal((await restoringBootstrap).status, AUTH_SESSION_STATUS.GUEST);
assert.equal((await restoringLogout).status, AUTH_SESSION_STATUS.GUEST);
assert.equal(logoutDuringRestoreService.getState().status, AUTH_SESSION_STATUS.GUEST);

const cleanupRaceRequest = deferred();
const cleanupRaceFake = createFakeClient({ getSessionResult: () => cleanupRaceRequest.promise });
const cleanupRaceService = createAuthSessionService(cleanupRaceFake.client);
const cleanupRaceBootstrap = cleanupRaceService.bootstrap();
assert.equal(cleanupRaceService.cleanup(), true);
cleanupRaceRequest.resolve({ data: { session: sessionFor() }, error: null });
assert.equal((await cleanupRaceBootstrap).status, AUTH_SESSION_STATUS.LOADING);
cleanupRaceFake.emit('SIGNED_IN', sessionFor());
assert.equal(cleanupRaceService.getState().status, AUTH_SESSION_STATUS.LOADING);

let unsubscribeThrowCalls = 0;
const unsubscribeThrowFake = createFakeClient({
  subscriptionResult: {
    data: {
      subscription: {
        unsubscribe() {
          unsubscribeThrowCalls += 1;
          throw new Error('raw unsubscribe detail');
        },
      },
    },
  },
});
const unsubscribeThrowService = createAuthSessionService(unsubscribeThrowFake.client);
let cleanupNotifications = 0;
unsubscribeThrowService.subscribe(() => { cleanupNotifications += 1; });
await unsubscribeThrowService.bootstrap();
const notificationsBeforeCleanup = cleanupNotifications;
assert.doesNotThrow(() => assert.equal(unsubscribeThrowService.cleanup(), true));
assert.equal(unsubscribeThrowService.cleanup(), false);
assert.equal(unsubscribeThrowCalls, 1);
unsubscribeThrowFake.emit('SIGNED_IN', sessionFor());
assert.equal(cleanupNotifications, notificationsBeforeCleanup);

const malformedSubscriptionFake = createFakeClient({
  subscriptionResult: Object.assign([], {
    data: { subscription: { unsubscribe() {} } },
  }),
});
const malformedSubscriptionArray = createAuthSessionService(malformedSubscriptionFake.client);
assert.equal((await malformedSubscriptionArray.bootstrap()).status, AUTH_SESSION_STATUS.ERROR);
malformedSubscriptionFake.emit('SIGNED_IN', sessionFor());
assert.equal(malformedSubscriptionArray.getState().status, AUTH_SESSION_STATUS.ERROR);

function createSynchronousEventClient(events, getSessionResult, { subscriptionResult, beforeReturn } = {}) {
  let authListener = null;
  let getSessionCalls = 0;
  let unsubscribeCalls = 0;
  const subscription = {
    unsubscribe() { unsubscribeCalls += 1; },
  };
  return {
    client: {
      auth: {
        async getSession() {
          getSessionCalls += 1;
          return getSessionResult;
        },
        onAuthStateChange(listener) {
          authListener = listener;
          events.forEach(([event, session]) => listener(event, session));
          beforeReturn?.();
          return subscriptionResult ?? { data: { subscription } };
        },
        async signOut() { return { error: null }; },
      },
    },
    emit(event, session) { authListener?.(event, session); },
    counts() { return { getSessionCalls, unsubscribeCalls }; },
  };
}

for (const [event, queuedSession, staleSession, expectedStatus] of [
  ['SIGNED_IN', sessionFor(), null, AUTH_SESSION_STATUS.AUTHENTICATED],
  ['INITIAL_SESSION', sessionFor(), null, AUTH_SESSION_STATUS.AUTHENTICATED],
  ['SIGNED_OUT', null, sessionFor(), AUTH_SESSION_STATUS.GUEST],
]) {
  const fake = createSynchronousEventClient(
    [[event, queuedSession]],
    { data: { session: staleSession }, error: null }
  );
  const service = createAuthSessionService(fake.client);
  const snapshots = [];
  service.subscribe((state) => snapshots.push(state.status));
  assert.equal((await service.bootstrap()).status, expectedStatus);
  assert.equal(service.getState().status, expectedStatus);
  assert.equal(snapshots.filter((status) => status === expectedStatus).length, 1);
  assert.equal(fake.counts().getSessionCalls, 1);
}

for (const [events, staleSession, expectedStatus] of [
  [
    [['SIGNED_IN', sessionFor()], ['SIGNED_OUT', null]],
    sessionFor(),
    AUTH_SESSION_STATUS.GUEST,
  ],
  [
    [['SIGNED_OUT', null], ['SIGNED_IN', sessionFor()]],
    null,
    AUTH_SESSION_STATUS.AUTHENTICATED,
  ],
]) {
  const fake = createSynchronousEventClient(events, { data: { session: staleSession }, error: null });
  const service = createAuthSessionService(fake.client);
  assert.equal((await service.bootstrap()).status, expectedStatus, 'The newest synchronous event must win');
}

const malformedQueuedFake = createSynchronousEventClient(
  [['SIGNED_IN', { user: confirmedUser }]],
  { data: { session: sessionFor() }, error: null }
);
const malformedQueuedService = createAuthSessionService(malformedQueuedFake.client);
assert.equal((await malformedQueuedService.bootstrap()).status, AUTH_SESSION_STATUS.ERROR);

const throwingQueuedSession = {
  access_token: 'fixture-access-token',
  refresh_token: 'fixture-refresh-token',
};
Object.defineProperty(throwingQueuedSession, 'user', {
  enumerable: true,
  get() { throw new Error('raw queued getter detail'); },
});
const throwingQueuedFake = createSynchronousEventClient(
  [['TOKEN_REFRESHED', throwingQueuedSession]],
  { data: { session: sessionFor() }, error: null }
);
const throwingQueuedService = createAuthSessionService(throwingQueuedFake.client);
assert.doesNotThrow(() => throwingQueuedService.bootstrap());
assert.equal((await throwingQueuedService.bootstrap()).status, AUTH_SESSION_STATUS.ERROR);
assert.doesNotMatch(JSON.stringify(throwingQueuedService.getState()), /queued getter|fixture-access-token/i);

const contradictoryQueuedFake = createSynchronousEventClient(
  [['SIGNED_OUT', sessionFor()]],
  { data: { session: sessionFor() }, error: null }
);
const contradictoryQueuedService = createAuthSessionService(contradictoryQueuedFake.client);
assert.equal((await contradictoryQueuedService.bootstrap()).status, AUTH_SESSION_STATUS.ERROR);

const rejectedQueuedFake = createSynchronousEventClient(
  [['SIGNED_IN', sessionFor()]],
  { data: { session: null }, error: null },
  { subscriptionResult: [] }
);
const rejectedQueuedService = createAuthSessionService(rejectedQueuedFake.client);
assert.equal((await rejectedQueuedService.bootstrap()).status, AUTH_SESSION_STATUS.ERROR);
rejectedQueuedFake.emit('SIGNED_IN', sessionFor());
assert.equal(rejectedQueuedService.getState().status, AUTH_SESSION_STATUS.ERROR);

let cleanupBeforeAcceptanceService;
const cleanupBeforeAcceptanceFake = createSynchronousEventClient(
  [['SIGNED_IN', sessionFor()]],
  { data: { session: null }, error: null },
  { beforeReturn: () => cleanupBeforeAcceptanceService.cleanup() }
);
cleanupBeforeAcceptanceService = createAuthSessionService(cleanupBeforeAcceptanceFake.client);
assert.equal((await cleanupBeforeAcceptanceService.bootstrap()).status, AUTH_SESSION_STATUS.LOADING);
assert.deepEqual(cleanupBeforeAcceptanceFake.counts(), { getSessionCalls: 0, unsubscribeCalls: 1 });
cleanupBeforeAcceptanceFake.emit('SIGNED_IN', sessionFor());
assert.equal(cleanupBeforeAcceptanceService.getState().status, AUTH_SESSION_STATUS.LOADING);

function reentrantSession(reenter, { throwAfter = false } = {}) {
  return {
    get access_token() {
      reenter();
      if (throwAfter) throw new Error('raw stale validation detail');
      return 'fixture-access-token';
    },
    refresh_token: 'fixture-refresh-token',
    user: confirmedUser,
  };
}

let replayReenter = () => {};
const replayReentrantFake = createSynchronousEventClient(
  [['SIGNED_IN', reentrantSession(() => replayReenter())]],
  { data: { session: null }, error: null }
);
replayReenter = () => replayReentrantFake.emit('SIGNED_OUT', null);
const replayReentrantService = createAuthSessionService(replayReentrantFake.client);
const replayReentrantSnapshots = [];
replayReentrantService.subscribe((state) => replayReentrantSnapshots.push(state.status));
assert.equal((await replayReentrantService.bootstrap()).status, AUTH_SESSION_STATUS.GUEST);
assert.deepEqual(replayReentrantSnapshots, [
  AUTH_SESSION_STATUS.LOADING,
  AUTH_SESSION_STATUS.LOADING,
  AUTH_SESSION_STATUS.GUEST,
]);

const acceptedReentrantFake = createFakeClient();
const acceptedReentrantService = createAuthSessionService(acceptedReentrantFake.client);
const acceptedReentrantSnapshots = [];
acceptedReentrantService.subscribe((state) => acceptedReentrantSnapshots.push(state.status));
await acceptedReentrantService.bootstrap();
acceptedReentrantFake.emit('SIGNED_IN', reentrantSession(() => acceptedReentrantFake.emit('SIGNED_OUT', null)));
assert.equal(acceptedReentrantService.getState().status, AUTH_SESSION_STATUS.GUEST);
assert.deepEqual(acceptedReentrantSnapshots, [
  AUTH_SESSION_STATUS.LOADING,
  AUTH_SESSION_STATUS.LOADING,
  AUTH_SESSION_STATUS.GUEST,
  AUTH_SESSION_STATUS.GUEST,
]);

const newestReentrantFake = createFakeClient();
const newestReentrantService = createAuthSessionService(newestReentrantFake.client);
const newestReentrantSnapshots = [];
newestReentrantService.subscribe((state) => newestReentrantSnapshots.push(state.status));
await newestReentrantService.bootstrap();
newestReentrantFake.emit('SIGNED_IN', reentrantSession(() => {
  newestReentrantFake.emit('SIGNED_OUT', null);
  newestReentrantFake.emit('SIGNED_IN', sessionFor());
}));
assert.equal(newestReentrantService.getState().status, AUTH_SESSION_STATUS.AUTHENTICATED);
assert.deepEqual(newestReentrantSnapshots.slice(-2), [
  AUTH_SESSION_STATUS.GUEST,
  AUTH_SESSION_STATUS.AUTHENTICATED,
]);

const malformedReentrantFake = createFakeClient();
const malformedReentrantService = createAuthSessionService(malformedReentrantFake.client);
await malformedReentrantService.bootstrap();
malformedReentrantFake.emit('SIGNED_IN', reentrantSession(() => {
  malformedReentrantFake.emit('TOKEN_REFRESHED', { user: confirmedUser });
}));
assert.equal(malformedReentrantService.getState().status, AUTH_SESSION_STATUS.ERROR);

const throwingOlderFake = createFakeClient();
const throwingOlderService = createAuthSessionService(throwingOlderFake.client);
const throwingOlderSnapshots = [];
throwingOlderService.subscribe((state) => throwingOlderSnapshots.push(state.status));
await throwingOlderService.bootstrap();
throwingOlderFake.emit('SIGNED_IN', reentrantSession(
  () => throwingOlderFake.emit('SIGNED_OUT', null),
  { throwAfter: true }
));
assert.equal(throwingOlderService.getState().status, AUTH_SESSION_STATUS.GUEST);
assert.equal(throwingOlderSnapshots.at(-1), AUTH_SESSION_STATUS.GUEST);
assert.doesNotMatch(JSON.stringify(throwingOlderService.getState()), /stale validation|fixture-access-token/i);

const cleanupReentrantFake = createFakeClient();
const cleanupReentrantService = createAuthSessionService(cleanupReentrantFake.client);
const cleanupReentrantSnapshots = [];
cleanupReentrantService.subscribe((state) => cleanupReentrantSnapshots.push(state.status));
await cleanupReentrantService.bootstrap();
const cleanupSnapshotsBeforeEvent = cleanupReentrantSnapshots.length;
cleanupReentrantFake.emit('SIGNED_IN', reentrantSession(() => cleanupReentrantService.cleanup()));
assert.equal(cleanupReentrantService.getState().status, AUTH_SESSION_STATUS.GUEST);
assert.equal(cleanupReentrantSnapshots.length, cleanupSnapshotsBeforeEvent);
assert.equal(cleanupReentrantFake.counts().unsubscribeCalls, 1);

const logoutReentrantFake = createFakeClient();
const logoutReentrantService = createAuthSessionService(logoutReentrantFake.client);
const logoutReentrantSnapshots = [];
logoutReentrantService.subscribe((state) => logoutReentrantSnapshots.push(state.status));
await logoutReentrantService.bootstrap();
let reentrantLogout;
logoutReentrantFake.emit('SIGNED_IN', reentrantSession(() => {
  reentrantLogout = logoutReentrantService.logout();
}));
assert.equal((await reentrantLogout).status, AUTH_SESSION_STATUS.GUEST);
assert.equal(logoutReentrantService.getState().status, AUTH_SESSION_STATUS.GUEST);
assert.deepEqual(logoutReentrantSnapshots.slice(-2), [
  AUTH_SESSION_STATUS.LOADING,
  AUTH_SESSION_STATUS.GUEST,
]);
assert.equal(logoutReentrantFake.counts().signOutCalls, 1);

const nestedReentrantFake = createFakeClient();
const nestedReentrantService = createAuthSessionService(nestedReentrantFake.client);
const nestedReentrantSnapshots = [];
nestedReentrantService.subscribe((state) => nestedReentrantSnapshots.push(state.status));
await nestedReentrantService.bootstrap();
nestedReentrantFake.emit('SIGNED_IN', reentrantSession(() => {
  nestedReentrantFake.emit('SIGNED_OUT', null);
  nestedReentrantFake.emit('SIGNED_IN', sessionFor());
  nestedReentrantFake.emit('USER_UPDATED', sessionFor(unconfirmedUser));
}));
assert.equal(nestedReentrantService.getState().status, AUTH_SESSION_STATUS.PENDING_CONFIRMATION);
assert.deepEqual(nestedReentrantSnapshots.slice(-3), [
  AUTH_SESSION_STATUS.GUEST,
  AUTH_SESSION_STATUS.AUTHENTICATED,
  AUTH_SESSION_STATUS.PENDING_CONFIRMATION,
]);

const rejectedSubscription = Promise.reject(new Error('raw malformed subscription rejection'));
const rejectedPromiseFake = createSynchronousEventClient(
  [['SIGNED_IN', sessionFor()]],
  { data: { session: null }, error: null },
  { subscriptionResult: rejectedSubscription }
);
const rejectedPromiseService = createAuthSessionService(rejectedPromiseFake.client);
assert.equal((await rejectedPromiseService.bootstrap()).status, AUTH_SESSION_STATUS.ERROR);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(rejectedPromiseFake.counts(), { getSessionCalls: 0, unsubscribeCalls: 0 });
rejectedPromiseFake.emit('SIGNED_IN', sessionFor());
assert.equal(rejectedPromiseService.getState().status, AUTH_SESSION_STATUS.ERROR);

const source = await readFile(new URL('../js/auth-session.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /console\.|localStorage|sessionStorage|\bfetch\s*\(|XMLHttpRequest|WebSocket/);
assert.match(source, /isMeaningfulString\(session\.access_token\)/);
assert.match(source, /isMeaningfulString\(session\.refresh_token\)/);
assert.doesNotMatch(source, /supabase-config|createClient|signInWithPassword|signUp|exchangeCodeForSession/);

console.log('Offline authenticated session foundation tests passed with injected fake clients only.');
