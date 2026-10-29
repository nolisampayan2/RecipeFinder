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

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function createFakeClient({ session = null, getSessionResult, getSessionError, signOutResult } = {}) {
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
      return { data: { subscription: { unsubscribe() { unsubscribeCalls += 1; } } } };
    },
    async signOut(options) {
      signOutCalls += 1;
      assert.deepEqual(options, { scope: 'local' });
      return signOutResult || { error: null };
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
isolatedListenerFake.emit('SIGNED_IN', { user: confirmedUser });
assert.equal(isolatedListenerService.getState().status, AUTH_SESSION_STATUS.AUTHENTICATED);
assert.deepEqual(isolatedSnapshots, [AUTH_SESSION_STATUS.LOADING, AUTH_SESSION_STATUS.LOADING, AUTH_SESSION_STATUS.GUEST, AUTH_SESSION_STATUS.AUTHENTICATED]);

const confirmedFake = createFakeClient({ session: { user: confirmedUser, access_token: 'never-public' } });
const confirmedService = createAuthSessionService(confirmedFake.client);
assert.deepEqual(await confirmedService.bootstrap(), {
  status: AUTH_SESSION_STATUS.AUTHENTICATED,
  user: { id: confirmedUser.id, email: confirmedUser.email },
});
assert.doesNotMatch(JSON.stringify(confirmedService.getState()), /never-public|access_token|refresh_token/);

const pendingFake = createFakeClient({ session: { user: unconfirmedUser } });
const pendingService = createAuthSessionService(pendingFake.client);
assert.equal((await pendingService.bootstrap()).status, AUTH_SESSION_STATUS.PENDING_CONFIRMATION);
pendingFake.emit('USER_UPDATED', { user: confirmedUser, refresh_token: 'never-public-refresh' });
assert.deepEqual(pendingService.getState(), {
  status: AUTH_SESSION_STATUS.AUTHENTICATED,
  user: { id: confirmedUser.id, email: confirmedUser.email },
});
pendingFake.emit('SIGNED_OUT', null);
assert.deepEqual(pendingService.getState(), { status: AUTH_SESSION_STATUS.GUEST, user: null });

const logoutFake = createFakeClient({ session: { user: confirmedUser } });
const logoutService = createAuthSessionService(logoutFake.client);
await logoutService.bootstrap();
assert.deepEqual(await logoutService.logout(), { status: AUTH_SESSION_STATUS.GUEST, user: null });
assert.equal(logoutFake.counts().signOutCalls, 1);
assert.equal(logoutService.cleanup(), true);
assert.equal(logoutService.cleanup(), false);
assert.equal(logoutFake.counts().unsubscribeCalls, 1);

const failedLogoutFake = createFakeClient({
  session: { user: confirmedUser },
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
staleFake.emit('SIGNED_IN', { user: confirmedUser });
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

const source = await readFile(new URL('../js/auth-session.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /console\.|localStorage|sessionStorage|\bfetch\s*\(|XMLHttpRequest|WebSocket/);
assert.doesNotMatch(source, /access_token|refresh_token/);
assert.doesNotMatch(source, /supabase-config|createClient|signInWithPassword|signUp|exchangeCodeForSession/);

console.log('Offline authenticated session foundation tests passed with injected fake clients only.');
