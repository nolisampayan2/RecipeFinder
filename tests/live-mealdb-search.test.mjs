import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLiveMealDbSearch } from '../js/live-mealdb-search.js';
import { createMealDbClient } from '../js/mealdb-client.js';

const fullMeal = (id) => ({
  idMeal: String(id),
  strMeal: `Meal ${id}`,
  strCategory: 'Vegetarian',
  strArea: 'Fictionland',
  strMealThumb: 'https://www.themealdb.com/images/media/meals/fictional.jpg',
  strInstructions: 'Prepare safely.',
  strIngredient1: 'Ingredient',
  strMeasure1: '1 cup',
});

let importRequests = 0;
globalThis.fetch = () => { importRequests += 1; throw new Error('Import must remain inert'); };
await import(`../js/live-mealdb-search.js?inert=${Date.now()}`);
assert.equal(importRequests, 0);
delete globalThis.fetch;

const requests = [];
let clientCreations = 0;
const coordinator = createLiveMealDbSearch({
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ meals: [fullMeal(101)] }) };
  },
  createClient(options) {
    clientCreations += 1;
    return createMealDbClient(options);
  },
});
assert.equal(requests.length, 0, 'Construction must not request data');
assert.equal(clientCreations, 0, 'Construction must not create a client');
assert.equal((await coordinator.retry()).status, 'idle');
assert.equal(requests.length, 0, 'Retry before a failed search must do nothing');
assert.equal((await coordinator.search('   ')).status, 'idle');
assert.equal(clientCreations, 0, 'Blank search must not create a client');
const readyRequest = coordinator.search('spicy & sweet');
assert.equal(coordinator.getState().status, 'loading');
const ready = await readyRequest;
assert.equal(clientCreations, 1);
assert.equal(ready.status, 'ready');
assert.equal(ready.provider, 'themealdb');
assert.equal(ready.recipes[0].id, 'external:themealdb:101');
assert.equal(new URL(requests[0].url).searchParams.get('s'), 'spicy & sweet');
assert.equal(requests[0].options.credentials, 'omit');
assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
await coordinator.retry();
assert.equal(requests.length, 1, 'A successful search must not become retry eligible');
assert.equal(coordinator.reset().status, 'idle');
assert.equal(coordinator.getState().query, '');
assert.equal(coordinator.getState().recipes.length, 0, 'Reset must remove live results from the active view');

const empty = createLiveMealDbSearch({
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ meals: null }) }),
});
assert.equal((await empty.search('missing')).status, 'empty');
await empty.retry();
assert.equal(empty.getState().status, 'empty', 'An empty search must not become retry eligible');

for (const response of [
  { ok: false, status: 429, json: async () => ({}) },
  { ok: false, status: 500, json: async () => ({}) },
  { ok: true, status: 200, json: async () => { throw new SyntaxError('fictional'); } },
  { ok: true, status: 200, json: async () => ({ meals: 'invalid' }) },
]) {
  const failing = createLiveMealDbSearch({ fetchImpl: async () => response });
  assert.equal((await failing.search('meal')).status, 'error');
  assert.equal(failing.getState().recipes.length, 0);
}

let resolveOld;
const rapid = createLiveMealDbSearch({
  fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
    if (new URL(url).searchParams.get('s') === 'old') {
      resolveOld = () => resolve({ ok: true, status: 200, json: async () => ({ meals: [fullMeal(201)] }) });
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      return;
    }
    resolve({ ok: true, status: 200, json: async () => ({ meals: [fullMeal(202)] }) });
  }),
});
const oldRequest = rapid.search('old');
await Promise.resolve();
const newest = await rapid.search('new');
resolveOld?.();
await oldRequest;
assert.equal(newest.recipes[0].id, 'external:themealdb:202');
assert.equal(rapid.getState().recipes[0].id, 'external:themealdb:202');

let ignoredAbortResolve;
let ignoredAbortState = { status: 'idle', recipes: [], error: null, generation: 0 };
const resetDuringRequest = createLiveMealDbSearch({
  fetchImpl: () => {},
  createClient: () => ({}),
  createSource: () => ({}),
  createController: () => ({
    getState: () => ignoredAbortState,
    search: () => new Promise((resolve) => {
      ignoredAbortResolve = () => {
        ignoredAbortState = { status: 'ready', recipes: [{ id: 'external:themealdb:301' }], error: null, generation: 1 };
        resolve(ignoredAbortState);
      };
    }),
    invalidateCollection: () => {},
  }),
});
const resetPending = resetDuringRequest.search('cancel me');
await Promise.resolve();
assert.equal(resetDuringRequest.reset().status, 'idle');
ignoredAbortResolve();
const staleAfterReset = await resetPending;
assert.equal(staleAfterReset.status, 'idle');
assert.equal(staleAfterReset.query, '');
assert.equal(staleAfterReset.recipes.length, 0);
assert.equal(resetDuringRequest.getState().recipes.length, 0);

const deferredSearches = new Map();
let unorderedState = { status: 'idle', recipes: [], error: null, generation: 0 };
const unordered = createLiveMealDbSearch({
  fetchImpl: () => {},
  createClient: () => ({}),
  createSource: () => ({}),
  createController: () => ({
    getState: () => unorderedState,
    search: (query) => new Promise((resolve) => deferredSearches.set(query, () => {
      unorderedState = {
        status: 'ready', recipes: [{ id: `external:themealdb:${query === 'A' ? '401' : '402'}` }], error: null, generation: 1,
      };
      resolve(unorderedState);
    })),
    invalidateCollection: () => {},
  }),
});
const searchA = unordered.search('A');
await Promise.resolve();
const searchB = unordered.search('B');
await Promise.resolve();
deferredSearches.get('B')();
const resultB = await searchB;
deferredSearches.get('A')();
const staleA = await searchA;
assert.equal(resultB.recipes[0].id, 'external:themealdb:402');
assert.equal(staleA.recipes[0].id, 'external:themealdb:402', 'Stale A must return the current B result');
assert.equal(staleA.query, 'B');
assert.equal(unordered.getState().recipes[0].id, 'external:themealdb:402');

let retryRequests = 0;
let resolveRetry;
const retryAfterError = createLiveMealDbSearch({
  fetchImpl: async () => {
    retryRequests += 1;
    if (retryRequests === 1) return { ok: false, status: 429, json: async () => ({}) };
    return new Promise((resolve) => { resolveRetry = () => resolve({ ok: true, status: 200, json: async () => ({ meals: [fullMeal(501)] }) }); });
  },
});
assert.equal((await retryAfterError.search('retryable')).status, 'error');
const retryRequest = retryAfterError.retry();
assert.equal(retryAfterError.getState().status, 'loading');
await retryAfterError.retry();
for (let turn = 0; turn < 5 && retryRequests < 2; turn += 1) await Promise.resolve();
assert.equal(retryRequests, 2, 'Repeated retry during loading must not start another request');
resolveRetry();
assert.equal((await retryRequest).status, 'ready');
await retryAfterError.retry();
assert.equal(retryRequests, 2, 'Successful retry must clear eligibility');
retryAfterError.reset();
await retryAfterError.retry();
assert.equal(retryRequests, 2, 'Reset must clear retry eligibility');

let invalidatedRetryRequests = 0;
const invalidatedRetry = createLiveMealDbSearch({
  fetchImpl: async () => {
    invalidatedRetryRequests += 1;
    return invalidatedRetryRequests === 1
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ meals: [fullMeal(601)] }) };
  },
});
await invalidatedRetry.search('old failure');
await invalidatedRetry.search('new success');
await invalidatedRetry.retry();
assert.equal(invalidatedRetryRequests, 2, 'A new search must invalidate earlier retry eligibility');

let timeoutCalls = 0;
const timedOut = createLiveMealDbSearch({
  timeoutMs: 100,
  fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    timeoutCalls += 1;
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }),
});
assert.equal((await timedOut.search('slow')).status, 'error');
assert.equal(timeoutCalls, 1, 'Timeout must not retry automatically');

for (const [factoryName, dependencies] of [
  ['client', { createClient: () => { throw new Error('secret client failure'); } }],
  ['source', { createClient: () => ({}), createSource: () => { throw new Error('secret source failure'); } }],
  ['controller', { createClient: () => ({}), createSource: () => ({}), createController: () => { throw new Error('secret controller failure'); } }],
]) {
  const failedInitialization = createLiveMealDbSearch({ fetchImpl: () => {}, ...dependencies });
  let synchronousThrow = false;
  let failurePromise;
  try {
    failurePromise = failedInitialization.search('initialize');
  } catch {
    synchronousThrow = true;
  }
  assert.equal(synchronousThrow, false, `${factoryName} failure must not escape synchronously`);
  const failureState = await failurePromise;
  assert.equal(failureState.status, 'error');
  assert.equal(failedInitialization.getState(), failureState);
  assert.equal(JSON.stringify(failureState).includes('secret'), false, 'Raw dependency errors must not be exposed');
  assert.equal(failedInitialization.reset().status, 'idle');
  assert.equal((await failedInitialization.retry()).status, 'idle', 'Reset must clear initialization retry eligibility');
}

const moduleSource = await readFile(new URL('../js/live-mealdb-search.js', import.meta.url), 'utf8');
assert.doesNotMatch(moduleSource, /localStorage|sessionStorage|window\.|document\.|supabase/i);
assert.doesNotMatch(moduleSource, /setInterval/);

console.log('Offline live TheMealDB search coordinator tests passed with injected fake fetch only.');
