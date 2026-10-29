import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  LOGIN_MESSAGES,
  LOGIN_STATUS,
  createLoginService,
} from '../js/login.js';

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

for (const signIn of [
  async () => ({ data: null, error: new Error('Invalid login credentials') }),
  async () => { throw new Error('offline network detail'); },
]) {
  const fake = createFakeClient({ signIn });
  const result = await createLoginService(fake.client).submit(validInput);
  assert.deepEqual(result, { status: LOGIN_STATUS.UNAVAILABLE, message: LOGIN_MESSAGES.UNAVAILABLE });
  assert.doesNotMatch(JSON.stringify(result), /Invalid login|network detail|StrongPass1|fixture-access-token/);
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

for (const response of [
  null,
  {},
  { data: null, error: null },
  { data: { user: confirmedUser }, error: null },
  { data: { user: confirmedUser, session: {} }, error: null },
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
}

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
assert.doesNotMatch(source, /access_token|refresh_token|raw_user_meta_data|user_metadata/);

console.log('Offline login service tests passed with injected fake clients only.');
