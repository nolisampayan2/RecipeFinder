import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  AUTHENTICATED_RECIPE_DETAIL_SELECT,
  createAuthenticatedRecipeDetailService,
} from '../js/supabase-recipe-details.js';
import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';

const AUTH_A = Object.freeze({
  status: 'authenticated',
  userId: '11111111-1111-4111-8111-111111111111',
});
const AUTH_B = Object.freeze({
  status: 'authenticated',
  userId: '22222222-2222-4222-8222-222222222222',
});
const FICTIONAL_ID = 'external:fictional-offline:990001';
const FICTIONAL_ZERO_ID = 'external:fictional-offline:000123';

function validRow(overrides = {}) {
  return {
    id: 'creamy-garlic-pasta',
    name: 'Creamy Garlic Pasta',
    description: 'Silky pasta tossed with roasted garlic, herbs, and parmesan.',
    image_url: 'https://images.example.test/recipe.jpg',
    fallback_image_url: 'assets/recipe.png',
    tutorial_url: 'https://www.youtube.com/watch?v=offline-fixture',
    ingredients: [
      { name: 'Fettuccine', measurement: '300 g' },
      { name: 'Garlic', measurement: '5 cloves' },
    ],
    instructions: 'Cook the pasta.\nFinish with garlic.',
    status: 'published',
    source_type: 'seed',
    external_provider: null,
    external_id: null,
    category: { name: 'Pasta' },
    cuisine: { name: 'Italian' },
    ...overrides,
  };
}

function fictionalRow(overrides = {}) {
  return validRow({
    id: FICTIONAL_ID,
    source_type: 'external',
    external_provider: 'fictional-offline',
    external_id: '990001',
    ...overrides,
  });
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function fakeClient(responseOrFactory) {
  const calls = [];
  let requests = 0;
  const query = {
    select(columns) {
      calls.push(['select', columns]);
      return this;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return this;
    },
    limit(value) {
      calls.push(['limit', value]);
      requests += 1;
      return typeof responseOrFactory === 'function'
        ? responseOrFactory(requests)
        : Promise.resolve(responseOrFactory);
    },
  };
  return {
    calls,
    get requests() { return requests; },
    client: {
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    },
  };
}

const expectedSelect = [
  'id', 'name', 'description', 'image_url', 'fallback_image_url', 'tutorial_url',
  'ingredients', 'instructions', 'status', 'source_type', 'external_provider',
  'external_id', 'category:recipe_categories!inner(name)', 'cuisine:cuisines!inner(name)',
].join(',');
assert.equal(AUTHENTICATED_RECIPE_DETAIL_SELECT, expectedSelect);
assert.doesNotMatch(AUTHENTICATED_RECIPE_DETAIL_SELECT, /\*|created_by|created_at|updated_at|published_at|user_id/i);

const validHarness = fakeClient({ data: [validRow()], error: null });
const validService = createAuthenticatedRecipeDetailService(validHarness.client);
const validResult = await validService.getPublishedById('creamy-garlic-pasta', AUTH_A);
assert.equal(validResult.error, null);
assert.equal(validResult.stale, false);
assert.equal(validResult.data.id, 'creamy-garlic-pasta');
assert.equal(validResult.data.source, 'database');
assert.equal(validResult.data.databaseSourceType, 'seed');
assert.equal(validResult.data.externalProvider, undefined);
assert.deepEqual(validResult.data.ingredients, [['Fettuccine', '300 g'], ['Garlic', '5 cloves']]);
assert.deepEqual(validHarness.calls, [
  ['from', 'recipes'],
  ['select', AUTHENTICATED_RECIPE_DETAIL_SELECT],
  ['eq', 'id', 'creamy-garlic-pasta'],
  ['eq', 'status', 'published'],
  ['limit', 2],
]);
assert.ok(Object.isFrozen(validResult));
assert.ok(Object.isFrozen(validResult.data));
assert.ok(Object.isFrozen(validResult.data.ingredients));
assert.ok(Object.isFrozen(validResult.data.ingredients[0]));

const fictionalHarness = fakeClient({ data: [fictionalRow()], error: null });
const fictionalResult = await createAuthenticatedRecipeDetailService(fictionalHarness.client)
  .getPublishedById(FICTIONAL_ID, AUTH_A);
assert.equal(fictionalResult.error, null);
assert.equal(fictionalResult.data.id, FICTIONAL_ID);
assert.equal(fictionalResult.data.source, 'database');
assert.equal(fictionalResult.data.databaseSourceType, 'external');
assert.equal(fictionalResult.data.externalProvider, 'fictional-offline');
assert.equal(fictionalResult.data.externalId, '990001');
assert.deepEqual(fictionalHarness.calls, [
  ['from', 'recipes'],
  ['select', AUTHENTICATED_RECIPE_DETAIL_SELECT],
  ['eq', 'id', FICTIONAL_ID],
  ['eq', 'status', 'published'],
  ['eq', 'source_type', 'external'],
  ['eq', 'external_provider', 'fictional-offline'],
  ['eq', 'external_id', '990001'],
  ['limit', 2],
]);

const leadingZeroHarness = fakeClient({ data: [fictionalRow({
  id: FICTIONAL_ZERO_ID,
  external_id: '000123',
})], error: null });
const leadingZeroResult = await createAuthenticatedRecipeDetailService(leadingZeroHarness.client)
  .getPublishedById(FICTIONAL_ZERO_ID, AUTH_A);
assert.equal(leadingZeroResult.data?.id, FICTIONAL_ZERO_ID);
assert.equal(leadingZeroResult.data?.externalId, '000123');
assert.equal(
  leadingZeroHarness.calls.some((call) => call[0] === 'eq' && call[1] === 'external_id' && call[2] === '000123'),
  true,
  'The fictional suffix must remain an exact string'
);

for (const authContext of [
  undefined,
  null,
  {},
  { status: 'loading', userId: null },
  { status: 'guest', userId: null },
  { status: 'pending-confirmation', userId: AUTH_A.userId },
  { status: 'error', userId: AUTH_A.userId },
  { status: 'authenticated', userId: null },
  { status: 'authenticated', userId: 'not-a-uuid' },
  new Proxy({}, { get() { throw new Error('PRIVATE_AUTH_VALUE'); } }),
]) {
  const harness = fakeClient({ data: [validRow()], error: null });
  const result = await createAuthenticatedRecipeDetailService(harness.client)
    .getPublishedById('creamy-garlic-pasta', authContext);
  assert.equal(result.error.code, 'UNAUTHORIZED');
  assert.equal(harness.calls.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_AUTH_VALUE|token|session/i);
}

let changingValidUserIdReads = 0;
const changingValidContext = {
  status: 'authenticated',
  get userId() {
    changingValidUserIdReads += 1;
    return changingValidUserIdReads === 1 ? AUTH_A.userId : 'not-a-uuid';
  },
};
const changingValidHarness = fakeClient({ data: [validRow()], error: null });
const changingValidResult = await createAuthenticatedRecipeDetailService(changingValidHarness.client)
  .getPublishedById('creamy-garlic-pasta', changingValidContext);
assert.equal(changingValidUserIdReads, 1, 'The authenticated user ID must be captured exactly once');
assert.equal(changingValidHarness.requests, 1);
assert.equal(changingValidResult.data?.id, 'creamy-garlic-pasta');

let changingInvalidUserIdReads = 0;
const changingInvalidContext = {
  status: 'authenticated',
  get userId() {
    changingInvalidUserIdReads += 1;
    return changingInvalidUserIdReads === 1 ? 'not-a-uuid' : AUTH_A.userId;
  },
};
const changingInvalidHarness = fakeClient({ data: [validRow()], error: null });
const changingInvalidResult = await createAuthenticatedRecipeDetailService(changingInvalidHarness.client)
  .getPublishedById('creamy-garlic-pasta', changingInvalidContext);
assert.equal(changingInvalidUserIdReads, 1);
assert.equal(changingInvalidResult.error.code, 'UNAUTHORIZED');
assert.equal(changingInvalidHarness.calls.length, 0);

let throwingUserIdReads = 0;
const throwingUserIdHarness = fakeClient({ data: [validRow()], error: null });
const throwingUserIdResult = await createAuthenticatedRecipeDetailService(throwingUserIdHarness.client)
  .getPublishedById('creamy-garlic-pasta', {
    status: 'authenticated',
    get userId() {
      throwingUserIdReads += 1;
      throw new Error('PRIVATE_USER_ID_GETTER');
    },
  });
assert.equal(throwingUserIdReads, 1);
assert.equal(throwingUserIdResult.error.code, 'UNAUTHORIZED');
assert.equal(throwingUserIdHarness.calls.length, 0);
assert.doesNotMatch(JSON.stringify(throwingUserIdResult), /PRIVATE_USER_ID_GETTER/);

for (const recipeId of [
  undefined,
  null,
  '',
  'UPPERCASE',
  '../recipe',
  'external:themealdb:52772',
  'external:curated:42',
  'external:fictional-offline:',
  'external:fictional-offline:not-digits',
  'external:fictional-offline:123/456',
  'External:fictional-offline:123',
  `external:fictional-offline:${'1'.repeat(180)}`,
]) {
  const harness = fakeClient({ data: [validRow()], error: null });
  const result = await createAuthenticatedRecipeDetailService(harness.client)
    .getPublishedById(recipeId, AUTH_A);
  assert.equal(result.error.code, 'INVALID_INPUT');
  assert.equal(harness.calls.length, 0);
}

const cmsResult = await createAuthenticatedRecipeDetailService(fakeClient({
  data: [validRow({ id: 'cms:draft-fixture', source_type: 'cms' })], error: null,
}).client).getPublishedById('cms:draft-fixture', AUTH_A);
assert.equal(cmsResult.data?.databaseSourceType, 'cms');
assert.equal(cmsResult.error, null);

for (const [recipeId, row] of [
  ['creamy-garlic-pasta', validRow({
    source_type: 'external', external_provider: 'curated-provider', external_id: '42',
  })],
  ['cms:11111111-2222-4333-8444-555555555555', validRow({
    id: 'cms:11111111-2222-4333-8444-555555555555',
    source_type: 'external', external_provider: 'curated-provider', external_id: '43',
  })],
  ['curated:42', validRow({
    id: 'curated:42', source_type: 'external',
    external_provider: 'curated-provider', external_id: '42',
  })],
  ['creamy-garlic-pasta', (({ source_type, ...row }) => row)(validRow())],
  ['creamy-garlic-pasta', validRow({ source_type: undefined })],
  ['creamy-garlic-pasta', validRow({ source_type: 'unexpected' })],
]) {
  const result = await createAuthenticatedRecipeDetailService(fakeClient({
    data: [row], error: null,
  }).client).getPublishedById(recipeId, AUTH_A);
  assert.equal(result.data, null);
  assert.equal(result.error.code, 'UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(result), /curated-provider|external_id|source_type/);
}

for (const mismatchedRow of [
  fictionalRow({ external_provider: 'themealdb' }),
  fictionalRow({ external_id: '990002' }),
  fictionalRow({ source_type: 'seed', external_provider: null, external_id: null }),
  fictionalRow({ id: 'external:fictional-offline:990002', external_id: '990002' }),
  fictionalRow({ status: 'draft' }),
]) {
  const mismatchHarness = fakeClient({ data: [mismatchedRow], error: null });
  const mismatchResult = await createAuthenticatedRecipeDetailService(mismatchHarness.client)
    .getPublishedById(FICTIONAL_ID, AUTH_A);
  assert.deepEqual(mismatchResult, {
    data: null,
    error: { code: 'UNAVAILABLE', message: 'Recipe details are unavailable.' },
    stale: false,
  });
}

assert.equal((await createAuthenticatedRecipeDetailService(fakeClient({
  data: [], error: null,
}).client).getPublishedById(FICTIONAL_ID, AUTH_A)).error.code, 'NOT_FOUND');
assert.equal((await createAuthenticatedRecipeDetailService(fakeClient({
  data: [fictionalRow(), fictionalRow()], error: null,
}).client).getPublishedById(FICTIONAL_ID, AUTH_A)).error.code, 'UNAVAILABLE');

const expectedUnavailable = {
  data: null,
  error: { code: 'UNAVAILABLE', message: 'Recipe details are unavailable.' },
  stale: false,
};
const expectedNotFound = {
  data: null,
  error: { code: 'NOT_FOUND', message: 'Recipe details are unavailable.' },
  stale: false,
};
assert.deepEqual(
  await createAuthenticatedRecipeDetailService(fakeClient({ data: [], error: null }).client)
    .getPublishedById('missing-recipe', AUTH_A),
  expectedNotFound
);

const sparse = new Array(1);
const overriddenMap = [validRow()];
overriddenMap.map = () => [validRow({ id: 'bypass' })];
for (const response of [
  null,
  [],
  {},
  { data: null, error: null },
  { data: {}, error: null },
  { data: [validRow()], error: new Error('PRIVATE_PROVIDER_ERROR') },
  { data: [validRow(), validRow()], error: null },
  { data: sparse, error: null },
  { data: overriddenMap, error: null },
  { data: [validRow({ id: 'different-recipe' })], error: null },
  { data: [validRow({ status: 'draft' })], error: null },
  { data: [validRow({ category: null })], error: null },
  { data: [validRow({ cuisine: { name: '' } })], error: null },
  { data: [validRow({ ingredients: [] })], error: null },
  { data: [validRow({ ingredients: [{ name: 'Salt' }] })], error: null },
  { data: [validRow({ instructions: '' })], error: null },
  { data: [validRow({ image_url: 'javascript:alert(1)' })], error: null },
  { data: [validRow({ tutorial_url: 'http://example.test/insecure' })], error: null },
  { data: [validRow({ source_type: 'cms', external_provider: 'unexpected' })], error: null },
  { data: [validRow({ source_type: 'external', external_provider: null, external_id: null })], error: null },
]) {
  const result = await createAuthenticatedRecipeDetailService(fakeClient(response).client)
    .getPublishedById('creamy-garlic-pasta', AUTH_A);
  assert.deepEqual(result, expectedUnavailable);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_ERROR|javascript:|insecure|access_token|refresh_token/i);
}

const rejectionHarness = fakeClient(() => Promise.reject(new Error('PRIVATE_NETWORK_FAILURE')));
const rejected = await createAuthenticatedRecipeDetailService(rejectionHarness.client)
  .getPublishedById('creamy-garlic-pasta', AUTH_A);
assert.deepEqual(rejected, expectedUnavailable);
assert.equal(rejectionHarness.requests, 1, 'Provider failures must not be retried automatically');
assert.doesNotMatch(JSON.stringify(rejected), /PRIVATE_NETWORK_FAILURE/);

for (const client of [undefined, null, {}, { from: null }, new Proxy({}, {
  get() { throw new Error('PRIVATE_CLIENT_FAILURE'); },
})]) {
  assert.throws(
    () => createAuthenticatedRecipeDetailService(client),
    (error) => error instanceof TypeError
      && error.message === 'A compatible Supabase recipe detail client is required.'
  );
}

const duplicateDeferred = deferred();
const duplicateHarness = fakeClient(() => duplicateDeferred.promise);
const duplicateService = createAuthenticatedRecipeDetailService(duplicateHarness.client);
const duplicateA = duplicateService.getPublishedById('creamy-garlic-pasta', AUTH_A);
const duplicateB = duplicateService.getPublishedById('creamy-garlic-pasta', AUTH_A);
assert.equal(duplicateA, duplicateB, 'Identical concurrent requests must share one promise');
assert.equal(duplicateHarness.requests, 1);
duplicateDeferred.resolve({ data: [validRow()], error: null });
assert.equal((await duplicateA).data?.id, 'creamy-garlic-pasta');

const firstDeferred = deferred();
const secondDeferred = deferred();
const newerHarness = fakeClient((request) => request === 1 ? firstDeferred.promise : secondDeferred.promise);
const newerService = createAuthenticatedRecipeDetailService(newerHarness.client);
const olderRequest = newerService.getPublishedById('creamy-garlic-pasta', AUTH_A);
const newerRequest = newerService.getPublishedById('lemon-chicken', AUTH_A);
secondDeferred.resolve({ data: [validRow({ id: 'lemon-chicken' })], error: null });
assert.equal((await newerRequest).data?.id, 'lemon-chicken');
firstDeferred.resolve({ data: [validRow()], error: null });
assert.equal((await olderRequest).error.code, 'STALE');

const logoutDeferred = deferred();
const logoutService = createAuthenticatedRecipeDetailService(fakeClient(() => logoutDeferred.promise).client);
const logoutRequest = logoutService.getPublishedById('creamy-garlic-pasta', AUTH_A);
assert.equal(logoutService.invalidate(), true);
logoutDeferred.resolve({ data: [validRow()], error: null });
assert.equal((await logoutRequest).error.code, 'STALE');

const accountADeferred = deferred();
const accountBDeferred = deferred();
const accountHarness = fakeClient((request) => request === 1 ? accountADeferred.promise : accountBDeferred.promise);
const accountService = createAuthenticatedRecipeDetailService(accountHarness.client);
const accountARequest = accountService.getPublishedById('creamy-garlic-pasta', AUTH_A);
accountService.invalidate();
const accountBRequest = accountService.getPublishedById('lemon-chicken', AUTH_B);
accountADeferred.resolve({ data: [validRow()], error: null });
assert.equal((await accountARequest).error.code, 'STALE');
accountBDeferred.resolve({ data: [validRow({ id: 'lemon-chicken' })], error: null });
assert.equal((await accountBRequest).data?.id, 'lemon-chicken');

const sameRecipeADeferred = deferred();
const sameRecipeBDeferred = deferred();
const sameRecipeHarness = fakeClient((request) => (
  request === 1 ? sameRecipeADeferred.promise : sameRecipeBDeferred.promise
));
const sameRecipeService = createAuthenticatedRecipeDetailService(sameRecipeHarness.client);
const sameRecipeARequest = sameRecipeService.getPublishedById('creamy-garlic-pasta', AUTH_A);
const sameRecipeBRequest = sameRecipeService.getPublishedById('creamy-garlic-pasta', AUTH_B);
assert.notEqual(sameRecipeARequest, sameRecipeBRequest);
assert.equal(sameRecipeHarness.requests, 2);
sameRecipeADeferred.resolve({ data: [validRow()], error: null });
assert.equal((await sameRecipeARequest).error.code, 'STALE');
sameRecipeBDeferred.resolve({ data: [validRow()], error: null });
assert.equal((await sameRecipeBRequest).data?.id, 'creamy-garlic-pasta');

const fictionalAccountADeferred = deferred();
const fictionalAccountBDeferred = deferred();
const fictionalAccountHarness = fakeClient((request) => (
  request === 1 ? fictionalAccountADeferred.promise : fictionalAccountBDeferred.promise
));
const fictionalAccountService = createAuthenticatedRecipeDetailService(fictionalAccountHarness.client);
const fictionalAccountARequest = fictionalAccountService.getPublishedById(FICTIONAL_ID, AUTH_A);
const fictionalAccountBRequest = fictionalAccountService.getPublishedById(FICTIONAL_ID, AUTH_B);
assert.notEqual(fictionalAccountARequest, fictionalAccountBRequest);
assert.equal(fictionalAccountHarness.requests, 2);
fictionalAccountADeferred.resolve({ data: [fictionalRow()], error: null });
assert.equal((await fictionalAccountARequest).error.code, 'STALE');
fictionalAccountBDeferred.resolve({ data: [fictionalRow()], error: null });
assert.equal((await fictionalAccountBRequest).data?.id, FICTIONAL_ID);

const fictionalLogoutDeferred = deferred();
const fictionalLogoutService = createAuthenticatedRecipeDetailService(
  fakeClient(() => fictionalLogoutDeferred.promise).client
);
const fictionalLogoutRequest = fictionalLogoutService.getPublishedById(FICTIONAL_ID, AUTH_A);
assert.equal(fictionalLogoutService.invalidate(), true);
fictionalLogoutDeferred.resolve({ data: [fictionalRow()], error: null });
assert.equal((await fictionalLogoutRequest).error.code, 'STALE');

const fictionalSwitchADeferred = deferred();
const fictionalSwitchBDeferred = deferred();
const fictionalSwitchHarness = fakeClient((request) => (
  request === 1 ? fictionalSwitchADeferred.promise : fictionalSwitchBDeferred.promise
));
const fictionalSwitchService = createAuthenticatedRecipeDetailService(fictionalSwitchHarness.client);
const fictionalSwitchARequest = fictionalSwitchService.getPublishedById(FICTIONAL_ID, AUTH_A);
fictionalSwitchService.invalidate();
const fictionalSwitchBRequest = fictionalSwitchService.getPublishedById(FICTIONAL_ID, AUTH_B);
fictionalSwitchBDeferred.resolve({ data: [fictionalRow()], error: null });
assert.equal((await fictionalSwitchBRequest).data?.id, FICTIONAL_ID);
fictionalSwitchADeferred.resolve({ data: [fictionalRow()], error: null });
assert.equal((await fictionalSwitchARequest).error.code, 'STALE');

const fictionalLateRejectionDeferred = deferred();
const fictionalLateRejectionService = createAuthenticatedRecipeDetailService(
  fakeClient(() => fictionalLateRejectionDeferred.promise).client
);
const fictionalLateRejectionRequest = fictionalLateRejectionService.getPublishedById(FICTIONAL_ID, AUTH_A);
fictionalLateRejectionService.invalidate();
fictionalLateRejectionDeferred.reject(new Error('PRIVATE_FICTIONAL_LATE_REJECTION'));
const fictionalLateRejectionResult = await fictionalLateRejectionRequest;
assert.equal(fictionalLateRejectionResult.error.code, 'STALE');
assert.doesNotMatch(JSON.stringify(fictionalLateRejectionResult), /PRIVATE_FICTIONAL_LATE_REJECTION/);

const lateRejectionDeferred = deferred();
const lateRejectionHarness = fakeClient(() => lateRejectionDeferred.promise);
const lateRejectionService = createAuthenticatedRecipeDetailService(lateRejectionHarness.client);
const lateRejectionRequest = lateRejectionService.getPublishedById('creamy-garlic-pasta', AUTH_A);
lateRejectionService.invalidate();
lateRejectionDeferred.reject(new Error('PRIVATE_LATE_REJECTION'));
const lateRejectionResult = await lateRejectionRequest;
assert.equal(lateRejectionResult.error.code, 'STALE');
assert.doesNotMatch(JSON.stringify(lateRejectionResult), /PRIVATE_LATE_REJECTION/);

const reloginOldDeferred = deferred();
const reloginNewDeferred = deferred();
const reloginHarness = fakeClient((request) => (
  request === 1 ? reloginOldDeferred.promise : reloginNewDeferred.promise
));
const reloginService = createAuthenticatedRecipeDetailService(reloginHarness.client);
const beforeLogoutRequest = reloginService.getPublishedById('creamy-garlic-pasta', AUTH_A);
reloginService.invalidate();
const afterReloginRequest = reloginService.getPublishedById('creamy-garlic-pasta', AUTH_B);
reloginNewDeferred.resolve({ data: [validRow()], error: null });
assert.equal((await afterReloginRequest).data?.id, 'creamy-garlic-pasta');
reloginOldDeferred.resolve({ data: [validRow()], error: null });
assert.equal((await beforeLogoutRequest).error.code, 'STALE');

const cleanupDeferred = deferred();
const cleanupHarness = fakeClient(() => cleanupDeferred.promise);
const cleanupService = createAuthenticatedRecipeDetailService(cleanupHarness.client);
const cleanupRequest = cleanupService.getPublishedById('creamy-garlic-pasta', AUTH_A);
assert.equal(cleanupService.cleanup(), true);
assert.equal(cleanupService.cleanup(), false);
cleanupDeferred.resolve({ data: [validRow()], error: null });
assert.equal((await cleanupRequest).error.code, 'STALE');
const requestsBeforeRetiredCall = cleanupHarness.requests;
assert.equal((await cleanupService.getPublishedById('creamy-garlic-pasta', AUTH_A)).error.code, 'STALE');
assert.equal(cleanupHarness.requests, requestsBeforeRetiredCall);
assert.equal(cleanupService.invalidate(), false);

const fictionalCleanupDeferred = deferred();
const fictionalCleanupHarness = fakeClient(() => fictionalCleanupDeferred.promise);
const fictionalCleanupService = createAuthenticatedRecipeDetailService(fictionalCleanupHarness.client);
const fictionalCleanupRequest = fictionalCleanupService.getPublishedById(FICTIONAL_ID, AUTH_A);
assert.equal(fictionalCleanupService.cleanup(), true);
fictionalCleanupDeferred.resolve({ data: [fictionalRow()], error: null });
assert.equal((await fictionalCleanupRequest).error.code, 'STALE');
const fictionalRequestsBeforeRetiredCall = fictionalCleanupHarness.requests;
assert.equal((await fictionalCleanupService.getPublishedById(FICTIONAL_ID, AUTH_A)).error.code, 'STALE');
assert.equal(fictionalCleanupHarness.requests, fictionalRequestsBeforeRetiredCall);

const serviceSource = await readFile(resolve('js/supabase-recipe-details.js'), 'utf8');
assert.doesNotMatch(serviceSource, /createClient|localStorage|sessionStorage|indexedDB|document\.|window\.|fetch\s*\(|XMLHttpRequest|WebSocket/i);
assert.doesNotMatch(serviceSource, /access_token|refresh_token|service_role|password/i);

const activeRuntimeFiles = [...new Set([...PRODUCTION_OUTPUT_FILES, ...ADMIN_PREVIEW_OUTPUT_FILES])]
  .filter((path) => path.endsWith('.js') && path !== 'js/supabase-config.js');
for (const runtimeFile of activeRuntimeFiles) {
  const source = await readFile(resolve(runtimeFile), 'utf8');
  assert.doesNotMatch(source, /(?:from\s+|import\s*\()(['"])\.\/supabase-recipe-details\.js\1/);
}
assert.equal(PRODUCTION_OUTPUT_FILES.includes('js/supabase-recipe-details.js'), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes('js/supabase-recipe-details.js'), false);

console.log('Authenticated recipe detail service tests passed.');
