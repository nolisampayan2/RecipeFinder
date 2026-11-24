import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  PUBLISHED_RECIPE_PREVIEW_RPC,
  createPublishedRecipePreviewService,
} from '../js/supabase-recipe-previews.js';
import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';

const RPC = 'list_published_recipe_previews_v1';
const FICTIONAL_ID = 'external:fictional-offline:000123';

function row(overrides = {}) {
  return {
    id: 'creamy-garlic-pasta',
    name: 'Creamy Garlic Pasta',
    description: 'Silky pasta with roasted garlic.',
    category: 'Pasta',
    cuisine: 'Italian',
    image_url: 'https://images.example.test/pasta.jpg',
    fallback_image_url: 'assets/recipe.png',
    source_type: 'seed',
    external_provider: null,
    external_id: null,
    ...overrides,
  };
}

function fictionalRow(overrides = {}) {
  return row({
    id: FICTIONAL_ID,
    source_type: 'external',
    external_provider: 'fictional-offline',
    external_id: '000123',
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

function harness(responseOrFactory) {
  const calls = [];
  let requests = 0;
  return {
    calls,
    get requests() { return requests; },
    client: {
      rpc(name, args) {
        requests += 1;
        calls.push([name, args]);
        return typeof responseOrFactory === 'function'
          ? responseOrFactory(requests, name, args)
          : Promise.resolve(responseOrFactory);
      },
    },
  };
}

const unavailable = {
  data: null,
  error: { code: 'UNAVAILABLE', message: 'Recipe previews are unavailable.' },
  stale: false,
};

assert.equal(PUBLISHED_RECIPE_PREVIEW_RPC, RPC);

const defaultHarness = harness({ data: [row()], error: null });
const defaultResult = await createPublishedRecipePreviewService(defaultHarness.client).listPublished();
assert.equal(defaultResult.error, null);
assert.deepEqual(defaultHarness.calls, [[RPC, {
  p_search: null,
  p_filter: null,
  p_limit: 25,
  p_offset: 0,
}]]);
assert.deepEqual(defaultResult.data.recipes[0], {
  id: 'creamy-garlic-pasta',
  name: 'Creamy Garlic Pasta',
  category: 'Pasta',
  cuisine: 'Italian',
  image: 'https://images.example.test/pasta.jpg',
  fallbackImage: 'assets/recipe.png',
  description: 'Silky pasta with roasted garlic.',
  source: 'database',
  databaseSourceType: 'seed',
  detailLevel: 'preview',
});
assert.equal(defaultResult.data.hasMore, false);
assert.equal(defaultResult.data.nextOffset, null);
assert.equal(Object.isFrozen(defaultResult), true);
assert.equal(Object.isFrozen(defaultResult.data), true);
assert.equal(Object.isFrozen(defaultResult.data.recipes), true);
assert.equal(Object.isFrozen(defaultResult.data.recipes[0]), true);

const literalSearch = String.raw`  50%_off\special  `;
const inputHarness = harness({ data: [row({ id: 'cms:123', source_type: 'cms' })], error: null });
const inputResult = await createPublishedRecipePreviewService(inputHarness.client).listPublished({
  search: literalSearch,
  filter: '  Italian  ',
  pageSize: 1,
  offset: 7,
});
assert.equal(inputResult.data?.recipes[0].databaseSourceType, 'cms');
assert.deepEqual(inputHarness.calls[0], [RPC, {
  p_search: String.raw`50%_off\special`,
  p_filter: 'Italian',
  p_limit: 2,
  p_offset: 7,
}]);
assert.deepEqual(Object.keys(inputHarness.calls[0][1]).sort(), ['p_filter', 'p_limit', 'p_offset', 'p_search']);

const fictionalHarness = harness({ data: [fictionalRow()], error: null });
const fictionalResult = await createPublishedRecipePreviewService(fictionalHarness.client).listPublished();
assert.deepEqual(fictionalResult.data?.recipes[0], {
  id: FICTIONAL_ID,
  name: 'Creamy Garlic Pasta',
  category: 'Pasta',
  cuisine: 'Italian',
  image: 'https://images.example.test/pasta.jpg',
  fallbackImage: 'assets/recipe.png',
  description: 'Silky pasta with roasted garlic.',
  source: 'external',
  externalProvider: 'fictional-offline',
  externalId: '000123',
  detailLevel: 'summary',
});

for (const options of [
  null,
  1,
  { search: null },
  { search: 'x'.repeat(101) },
  { search: 'bad\u0000value' },
  { filter: null },
  { filter: 'x'.repeat(81) },
  { filter: 'bad\u007fvalue' },
  { pageSize: 0 },
  { pageSize: 51 },
  { pageSize: 1.5 },
  { pageSize: Number.MAX_SAFE_INTEGER + 1 },
  { offset: -1 },
  { offset: 10001 },
  { offset: 1.5 },
]) {
  const invalidHarness = harness({ data: [], error: null });
  const result = await createPublishedRecipePreviewService(invalidHarness.client).listPublished(options);
  assert.equal(result.error.code, 'INVALID_INPUT');
  assert.equal(invalidHarness.calls.length, 0);
}

const boundaryHarness = harness({ data: [], error: null });
await createPublishedRecipePreviewService(boundaryHarness.client).listPublished({
  search: 's'.repeat(100), filter: 'f'.repeat(80), pageSize: 50, offset: 10000,
});
assert.deepEqual(boundaryHarness.calls[0][1], {
  p_search: 's'.repeat(100), p_filter: 'f'.repeat(80), p_limit: 51, p_offset: 10000,
});

let throwingInputReads = 0;
const throwingInputHarness = harness({ data: [], error: null });
const throwingInput = await createPublishedRecipePreviewService(throwingInputHarness.client).listPublished({
  get search() { throwingInputReads += 1; throw new Error('PRIVATE_INPUT'); },
});
assert.equal(throwingInputReads, 1);
assert.equal(throwingInput.error.code, 'INVALID_INPUT');
assert.equal(throwingInputHarness.calls.length, 0);
assert.doesNotMatch(JSON.stringify(throwingInput), /PRIVATE_INPUT/);

for (const testCase of [
  { field: 'search', first: 'first', second: null, argument: 'p_search', expected: 'first' },
  { field: 'filter', first: 'Pasta', second: null, argument: 'p_filter', expected: 'Pasta' },
  { field: 'pageSize', first: 5, second: 0, argument: 'p_limit', expected: 6 },
  { field: 'offset', first: 7, second: -1, argument: 'p_offset', expected: 7 },
]) {
  let reads = 0;
  const options = {};
  Object.defineProperty(options, testCase.field, {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? testCase.first : testCase.second;
    },
  });
  const changingHarness = harness({ data: [], error: null });
  const result = await createPublishedRecipePreviewService(changingHarness.client).listPublished(options);
  assert.equal(result.error, null);
  assert.equal(reads, 1, `${testCase.field} must be captured exactly once`);
  assert.equal(changingHarness.calls[0][1][testCase.argument], testCase.expected);
}

for (const testCase of [
  { field: 'search', invalid: null, valid: 'later' },
  { field: 'filter', invalid: null, valid: 'later' },
  { field: 'pageSize', invalid: 0, valid: 5 },
  { field: 'offset', invalid: -1, valid: 7 },
]) {
  let reads = 0;
  const options = {};
  Object.defineProperty(options, testCase.field, {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? testCase.invalid : testCase.valid;
    },
  });
  const changingHarness = harness({ data: [], error: null });
  const result = await createPublishedRecipePreviewService(changingHarness.client).listPublished(options);
  assert.equal(result.error.code, 'INVALID_INPUT');
  assert.equal(reads, 1, `${testCase.field} invalid snapshot must be read once`);
  assert.equal(changingHarness.requests, 0);
}

for (const field of ['search', 'filter', 'pageSize', 'offset']) {
  let reads = 0;
  const options = {};
  Object.defineProperty(options, field, {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error(`PRIVATE_${field.toUpperCase()}_GETTER`);
    },
  });
  const throwingHarness = harness({ data: [], error: null });
  const result = await createPublishedRecipePreviewService(throwingHarness.client).listPublished(options);
  assert.equal(result.error.code, 'INVALID_INPUT');
  assert.equal(reads, 1, `${field} throwing getter must be read once`);
  assert.equal(throwingHarness.requests, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|GETTER/);
}

for (const malformedRow of [
  { ...row(), ingredients: [{ name: 'Secret', measurement: '1 cup' }] },
  { ...row(), instructions: 'Secret instructions' },
  { ...row(), tutorial_url: 'https://example.test/secret' },
  { ...row(), created_by: '11111111-1111-4111-8111-111111111111' },
  { ...row(), updated_at: '2026-01-01T00:00:00Z' },
  { ...row(), unknown: 'unexpected' },
  { ...row(), id: 'bad id' },
  { ...row(), name: 'bad\u0000name' },
  { ...row(), category: '' },
  { ...row(), image_url: 'javascript:alert(1)' },
  { ...row(), image_url: 'https://user:secret@example.test/image.jpg' },
  { ...row(), fallback_image_url: '../private/image.png' },
  { ...row(), source_type: 'seed', external_provider: 'fictional-offline', external_id: '1' },
  { ...row(), source_type: 'cms', id: 'external:fictional-offline:1' },
  fictionalRow({ external_provider: 'themealdb' }),
  fictionalRow({ external_id: '123' }),
  fictionalRow({ id: 'external:fictional-offline:not-digits' }),
  fictionalRow({ id: 'external:themealdb:000123', external_provider: 'themealdb' }),
  fictionalRow({ source_type: 'unknown' }),
]) {
  const malformedHarness = harness({ data: [malformedRow], error: null });
  const result = await createPublishedRecipePreviewService(malformedHarness.client).listPublished();
  assert.deepEqual(result, unavailable);
  assert.doesNotMatch(JSON.stringify(result), /Secret|PRIVATE|javascript:|user:secret/i);
}

const accessorRow = row();
Object.defineProperty(accessorRow, 'name', { enumerable: true, get() { throw new Error('PRIVATE_GETTER'); } });
const accessorResult = await createPublishedRecipePreviewService(harness({
  data: [accessorRow], error: null,
}).client).listPublished();
assert.deepEqual(accessorResult, unavailable);
assert.doesNotMatch(JSON.stringify(accessorResult), /PRIVATE_GETTER/);

const hostileRow = new Proxy(row(), { ownKeys() { throw new Error('PRIVATE_PROXY'); } });
const hostileResult = await createPublishedRecipePreviewService(harness({
  data: [hostileRow], error: null,
}).client).listPublished();
assert.deepEqual(hostileResult, unavailable);
assert.doesNotMatch(JSON.stringify(hostileResult), /PRIVATE_PROXY/);

const hostileResponse = new Proxy({}, {
  ownKeys() { throw new Error('PRIVATE_RESPONSE_PROXY'); },
});
const hostileResponseResult = await createPublishedRecipePreviewService(harness(hostileResponse).client)
  .listPublished();
assert.deepEqual(hostileResponseResult, unavailable);
assert.doesNotMatch(JSON.stringify(hostileResponseResult), /PRIVATE_RESPONSE_PROXY/);

const sparse = new Array(1);
const customArray = [row()];
customArray.map = () => [];
for (const response of [
  null,
  {},
  { data: null, error: null },
  { data: {}, error: null },
  { data: [row()], error: new Error('PRIVATE_PROVIDER') },
  { data: sparse, error: null },
  { data: customArray, error: null },
  { data: [row(), row()], error: null },
]) {
  const result = await createPublishedRecipePreviewService(harness(response).client).listPublished();
  assert.deepEqual(result, unavailable);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER/);
}

const pageRows = [
  row({ id: 'one' }),
  row({ id: 'two' }),
  row({ id: 'three' }),
];
const pageResult = await createPublishedRecipePreviewService(harness({
  data: pageRows, error: null,
}).client).listPublished({ pageSize: 2, offset: 4 });
assert.deepEqual(pageResult.data.recipes.map((recipe) => recipe.id), ['one', 'two']);
assert.equal(pageResult.data.hasMore, true);
assert.equal(pageResult.data.nextOffset, 6);

const malformedLookaheadResult = await createPublishedRecipePreviewService(harness({
  data: [row({ id: 'one' }), row({ id: 'two' }), { ...row({ id: 'three' }), instructions: 'secret' }],
  error: null,
}).client).listPublished({ pageSize: 2 });
assert.deepEqual(malformedLookaheadResult, unavailable);

const tooManyResult = await createPublishedRecipePreviewService(harness({
  data: [...pageRows, row({ id: 'four' })], error: null,
}).client).listPublished({ pageSize: 2 });
assert.deepEqual(tooManyResult, unavailable);

let oversizedOwnKeysCalls = 0;
const oversizedRows = new Proxy(new Array(4), {
  ownKeys() {
    oversizedOwnKeysCalls += 1;
    throw new Error('OVERSIZED_ROWS_MUST_NOT_BE_ENUMERATED');
  },
});
const oversizedEarlyResult = await createPublishedRecipePreviewService(harness({
  data: oversizedRows, error: null,
}).client).listPublished({ pageSize: 2 });
assert.deepEqual(oversizedEarlyResult, unavailable);
assert.equal(oversizedOwnKeysCalls, 0, 'Oversized arrays must fail before descriptor enumeration');

const duplicateLookaheadResult = await createPublishedRecipePreviewService(harness({
  data: [row(), row()], error: null,
}).client).listPublished({ pageSize: 1 });
assert.deepEqual(duplicateLookaheadResult, unavailable);

const rejectionHarness = harness(() => Promise.reject(new Error('PRIVATE_NETWORK_FAILURE')));
const rejected = await createPublishedRecipePreviewService(rejectionHarness.client).listPublished();
assert.deepEqual(rejected, unavailable);
assert.equal(rejectionHarness.requests, 1);
assert.doesNotMatch(JSON.stringify(rejected), /PRIVATE_NETWORK_FAILURE/);

for (const client of [undefined, null, {}, { rpc: null }, new Proxy({}, {
  get() { throw new Error('PRIVATE_CLIENT'); },
})]) {
  assert.throws(
    () => createPublishedRecipePreviewService(client),
    (error) => error instanceof TypeError
      && error.message === 'A compatible Supabase recipe preview client is required.'
  );
}

const duplicatePending = deferred();
const duplicateHarness = harness(() => duplicatePending.promise);
const duplicateService = createPublishedRecipePreviewService(duplicateHarness.client);
const duplicateA = duplicateService.listPublished({ search: 'pasta' });
const duplicateB = duplicateService.listPublished({ search: 'pasta' });
assert.equal(duplicateA, duplicateB);
await Promise.resolve();
assert.equal(duplicateHarness.requests, 1);
duplicatePending.resolve({ data: [row()], error: null });
assert.equal((await duplicateA).data?.recipes[0].id, 'creamy-garlic-pasta');

let reentrantService;
let reentrantInner;
let reentrantCalls = 0;
const reentrantClient = {
  rpc() {
    reentrantCalls += 1;
    reentrantInner = reentrantService.listPublished({ search: 'same' });
    return Promise.resolve({ data: [row()], error: null });
  },
};
reentrantService = createPublishedRecipePreviewService(reentrantClient);
const reentrantOuter = reentrantService.listPublished({ search: 'same' });
await Promise.resolve();
assert.equal(reentrantInner, reentrantOuter);
assert.equal(reentrantCalls, 1);
assert.equal((await reentrantOuter).data?.recipes[0].id, 'creamy-garlic-pasta');
assert.equal((await reentrantInner).data?.recipes[0].id, 'creamy-garlic-pasta');

let reentrantReplacementService;
let reentrantReplacement;
let reentrantReplacementCalls = 0;
const reentrantReplacementClient = {
  rpc(_name, args) {
    reentrantReplacementCalls += 1;
    if (args.p_search === 'old') {
      reentrantReplacement = reentrantReplacementService.listPublished({ search: 'new' });
      return Promise.resolve({ data: [row({ id: 'old' })], error: null });
    }
    return Promise.resolve({ data: [row({ id: 'new' })], error: null });
  },
};
reentrantReplacementService = createPublishedRecipePreviewService(reentrantReplacementClient);
const reentrantReplaced = reentrantReplacementService.listPublished({ search: 'old' });
await Promise.resolve();
assert.equal((await reentrantReplaced).error.code, 'STALE');
assert.equal((await reentrantReplacement).data?.recipes[0].id, 'new');
assert.equal(reentrantReplacementCalls, 2);

let reentrantInvalidationService;
let reentrantInvalidationCalls = 0;
const reentrantInvalidationClient = {
  rpc() {
    reentrantInvalidationCalls += 1;
    reentrantInvalidationService.invalidate();
    return Promise.resolve({ data: [row()], error: null });
  },
};
reentrantInvalidationService = createPublishedRecipePreviewService(reentrantInvalidationClient);
assert.equal((await reentrantInvalidationService.listPublished()).error.code, 'STALE');
assert.equal(reentrantInvalidationCalls, 1);

let reentrantCleanupService;
let reentrantCleanupCalls = 0;
const reentrantCleanupClient = {
  rpc() {
    reentrantCleanupCalls += 1;
    reentrantCleanupService.cleanup();
    return Promise.resolve({ data: [row()], error: null });
  },
};
reentrantCleanupService = createPublishedRecipePreviewService(reentrantCleanupClient);
assert.equal((await reentrantCleanupService.listPublished()).error.code, 'STALE');
assert.equal(reentrantCleanupCalls, 1);
assert.equal((await reentrantCleanupService.listPublished()).error.code, 'STALE');

const oldDeferred = deferred();
const newDeferred = deferred();
const replacementHarness = harness((request) => request === 1 ? oldDeferred.promise : newDeferred.promise);
const replacementService = createPublishedRecipePreviewService(replacementHarness.client);
const oldRequest = replacementService.listPublished({ search: 'old' });
await Promise.resolve();
const newRequest = replacementService.listPublished({ search: 'new' });
await Promise.resolve();
newDeferred.resolve({ data: [row({ id: 'new' })], error: null });
assert.equal((await newRequest).data?.recipes[0].id, 'new');
oldDeferred.resolve({ data: [row({ id: 'old' })], error: null });
assert.equal((await oldRequest).error.code, 'STALE');

const invalidatedDeferred = deferred();
const invalidatedHarness = harness(() => invalidatedDeferred.promise);
const invalidatedService = createPublishedRecipePreviewService(invalidatedHarness.client);
const invalidatedRequest = invalidatedService.listPublished();
await Promise.resolve();
assert.equal(invalidatedHarness.requests, 1);
assert.equal(invalidatedService.invalidate(), true);
invalidatedDeferred.resolve({ data: [row()], error: null });
assert.equal((await invalidatedRequest).error.code, 'STALE');

const invalidatedBeforeHarness = harness({ data: [row()], error: null });
const invalidatedBeforeService = createPublishedRecipePreviewService(invalidatedBeforeHarness.client);
const invalidatedBeforeRequest = invalidatedBeforeService.listPublished();
assert.equal(invalidatedBeforeService.invalidate(), true);
assert.equal((await invalidatedBeforeRequest).error.code, 'STALE');
assert.equal(invalidatedBeforeHarness.requests, 0);

const cleanupDeferred = deferred();
const cleanupHarness = harness(() => cleanupDeferred.promise);
const cleanupService = createPublishedRecipePreviewService(cleanupHarness.client);
const cleanupRequest = cleanupService.listPublished();
await Promise.resolve();
assert.equal(cleanupService.cleanup(), true);
cleanupDeferred.reject(new Error('PRIVATE_LATE_REJECTION'));
const cleanupResult = await cleanupRequest;
assert.equal(cleanupResult.error.code, 'STALE');
assert.doesNotMatch(JSON.stringify(cleanupResult), /PRIVATE_LATE_REJECTION/);
assert.equal(cleanupService.cleanup(), false);
const requestsBeforeRetiredCall = cleanupHarness.requests;
assert.equal((await cleanupService.listPublished()).error.code, 'STALE');
assert.equal(cleanupHarness.requests, requestsBeforeRetiredCall);
assert.equal(cleanupService.invalidate(), false);

const cleanupSuccessDeferred = deferred();
const cleanupSuccessService = createPublishedRecipePreviewService(
  harness(() => cleanupSuccessDeferred.promise).client
);
const cleanupSuccessRequest = cleanupSuccessService.listPublished();
await Promise.resolve();
assert.equal(cleanupSuccessService.cleanup(), true);
cleanupSuccessDeferred.resolve({ data: [row()], error: null });
assert.equal((await cleanupSuccessRequest).error.code, 'STALE');

const cleanupBeforeHarness = harness({ data: [row()], error: null });
const cleanupBeforeService = createPublishedRecipePreviewService(cleanupBeforeHarness.client);
const cleanupBeforeRequest = cleanupBeforeService.listPublished();
assert.equal(cleanupBeforeService.cleanup(), true);
assert.equal((await cleanupBeforeRequest).error.code, 'STALE');
assert.equal(cleanupBeforeHarness.requests, 0);

const source = await readFile(resolve('js/supabase-recipe-previews.js'), 'utf8');
assert.doesNotMatch(source, /\.from\s*\(|createClient|localStorage|sessionStorage|indexedDB|document\.|window\.|fetch\s*\(|XMLHttpRequest|WebSocket/i);
assert.doesNotMatch(source, /ingredients|instructions|tutorial_url|created_by|service_role|access_token|refresh_token/i);

const runtimeFiles = [...new Set([...PRODUCTION_OUTPUT_FILES, ...ADMIN_PREVIEW_OUTPUT_FILES])]
  .filter((path) => path.endsWith('.js') && path !== 'js/supabase-config.js');
for (const runtimeFile of runtimeFiles) {
  const runtimeSource = await readFile(resolve(runtimeFile), 'utf8');
  assert.equal(runtimeSource.includes('supabase-recipe-previews.js'), false);
}
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
assert.equal(PRODUCTION_OUTPUT_FILES.includes('js/supabase-recipe-previews.js'), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes('js/supabase-recipe-previews.js'), false);

console.log('Inactive Supabase published-recipe preview service tests passed.');
