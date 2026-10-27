import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  REGISTRATION_MESSAGES,
  REGISTRATION_STATUS,
  createRegistrationService,
  validateRegistrationInput,
} from '../js/registration.js';

const validInput = Object.freeze({
  displayName: '  Test Cook  ',
  email: '  cook@example.com  ',
  password: 'StrongPass1',
  confirmPassword: 'StrongPass1',
});

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
assert.doesNotMatch(registerHtml, /registration\.js|supabase-client\.js|supabase-config\.js|supabase-js/i);

const source = await readFile(new URL('../js/registration.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|console\./i);

console.log('Offline registration preparation tests passed with fake clients only.');
