import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExternalRecipeController } from '../js/external-recipe-controller.js';
import { createMealDbRecipeSource } from '../js/mealdb-recipe-source.js';

const fullMeal = (id, name = `Fictional Meal ${id}`) => ({
  idMeal: String(id),
  strMeal: name,
  strCategory: 'Fictional Category',
  strArea: 'Fictional Area',
  strMealThumb: `https://www.themealdb.com/images/media/meals/${id}.jpg`,
  strIngredient1: 'Ingredient',
  strMeasure1: '1 unit',
  strInstructions: 'Cook the fictional meal.',
  strYoutube: 'https://www.youtube.com/watch?v=fictional',
});
const summaryMeal = (id, name = `Fictional Summary ${id}`) => ({
  idMeal: String(id),
  strMeal: name,
  strMealThumb: `https://www.themealdb.com/images/media/meals/${id}.jpg`,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};
const abortError = () => Object.assign(new Error('offline abort'), { code: 'ABORTED' });

const calls = [];
const client = {
  async search(value, options) { calls.push(['search', value, options]); return [fullMeal(70001)]; },
  async filterByCategory(value, options) { calls.push(['category', value, options]); return [summaryMeal(70002)]; },
  async filterByArea(value, options) { calls.push(['area', value, options]); return [summaryMeal(70003)]; },
  async lookup(value, options) { calls.push(['lookup', value, options]); return [fullMeal(value)]; },
};
const source = createMealDbRecipeSource({ client });
assert.equal((await source.search('fictional'))[0].detailLevel, 'full');
assert.deepEqual(calls.at(-1).slice(0, 2), ['search', 'fictional']);
const categoryResult = await source.filterCategory('Fictional Category');
assert.equal(categoryResult[0].detailLevel, 'summary');
assert.equal(categoryResult[0].category, 'Fictional Category');
const cuisineResult = await source.filterCuisine('Fictional Area');
assert.equal(cuisineResult[0].cuisine, 'Fictional Area');
const details = await source.getDetails('external:themealdb:70004');
assert.equal(details.id, 'external:themealdb:70004');
assert.deepEqual(calls.at(-1).slice(0, 2), ['lookup', '70004']);

const emptyClient = { ...client, search: async () => [], lookup: async () => [] };
assert.deepEqual(await createMealDbRecipeSource({ client: emptyClient }).search('empty'), []);
await assert.rejects(createMealDbRecipeSource({ client: emptyClient }).getDetails('external:themealdb:1'), (error) => error.code === 'NOT_FOUND');
await assert.rejects(
  createMealDbRecipeSource({ client: { ...client, lookup: async () => [fullMeal(2)] } }).getDetails('external:themealdb:1'),
  (error) => error.code === 'IDENTITY_MISMATCH',
);
await assert.rejects(
  createMealDbRecipeSource({ client: { ...client, search: async () => [fullMeal(1), fullMeal(1)] } }).search('duplicates'),
  /Duplicate external recipe identity/,
);

const fixture = fullMeal(70005);
const fixtureSnapshot = structuredClone(fixture);
await createMealDbRecipeSource({ client: { ...client, search: async () => [fixture] } }).search('immutable');
assert.deepEqual(fixture, fixtureSnapshot);

const readyController = createExternalRecipeController({ source });
assert.deepEqual(readyController.getState(), { status: 'idle', recipes: [], error: null, generation: 0 });
const readyRequest = readyController.search('fictional');
assert.equal(readyController.getState().status, 'loading');
const readyState = await readyRequest;
assert.equal(readyState.status, 'ready');
assert.equal(readyState.recipes[0].id, 'external:themealdb:70001');
assert.ok(Object.isFrozen(readyState));
assert.ok(Object.isFrozen(readyState.recipes));
assert.ok(Object.isFrozen(readyState.recipes[0]));

const emptyController = createExternalRecipeController({ source: createMealDbRecipeSource({ client: emptyClient }) });
assert.equal((await emptyController.search('empty')).status, 'empty');

for (const [providerError, expectedCode] of [
  [Object.assign(new Error('raw timeout'), { code: 'TIMEOUT' }), 'timeout'],
  [Object.assign(new Error('raw network'), { code: 'NETWORK_ERROR' }), 'network'],
  [Object.assign(new Error('raw http'), { code: 'HTTP_ERROR' }), 'service'],
  [new TypeError('raw malformed data'), 'invalid'],
]) {
  const errorController = createExternalRecipeController({
    source: { ...source, search: async () => { throw providerError; } },
  });
  const errorResult = await errorController.search('error');
  assert.equal(errorResult.status, 'error');
  assert.equal(errorResult.error.code, expectedCode);
  assert.equal(JSON.stringify(errorResult).includes(providerError.message), false);
}

const malformedController = createExternalRecipeController({ source: { ...source, search: async () => ({}) } });
assert.equal((await malformedController.search('malformed')).error.code, 'invalid');

let preCancelledCalls = 0;
const preCancelledController = createExternalRecipeController({
  source: { ...source, search: async () => { preCancelledCalls += 1; return []; } },
});
const preCancelledSignal = new AbortController();
preCancelledSignal.abort();
assert.equal((await preCancelledController.search('cancelled-before-dispatch', { signal: preCancelledSignal.signal })).status, 'idle');
assert.equal(preCancelledCalls, 0);

let cancellationSignal;
const cancellationController = createExternalRecipeController({
  source: {
    ...source,
    search: (_value, { signal }) => new Promise((_resolve, reject) => {
      cancellationSignal = signal;
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    }),
  },
});
const externalAbort = new AbortController();
const cancelled = cancellationController.search('cancel', { signal: externalAbort.signal });
await Promise.resolve();
externalAbort.abort();
assert.equal((await cancelled).status, 'idle');
assert.equal(cancellationSignal.aborted, true);

const first = deferred();
const second = deferred();
let searchNumber = 0;
const staleController = createExternalRecipeController({
  source: { ...source, search: () => (++searchNumber === 1 ? first.promise : second.promise) },
});
const firstRequest = staleController.search('first');
await Promise.resolve();
const secondRequest = staleController.search('second');
second.resolve([{ ...details, id: 'external:themealdb:70006', externalId: '70006' }]);
assert.equal((await secondRequest).recipes[0].id, 'external:themealdb:70006');
first.resolve([{ ...details, id: 'external:themealdb:70007', externalId: '70007' }]);
await firstRequest;
assert.equal(staleController.getState().recipes[0].id, 'external:themealdb:70006');

const navigationDeferred = deferred();
const navigationController = createExternalRecipeController({ source: { ...source, search: () => navigationDeferred.promise } });
const navigationRequest = navigationController.search('pending');
navigationController.invalidateCollection();
assert.equal(navigationController.getState().status, 'idle');
navigationDeferred.resolve([{ ...details, id: 'external:themealdb:70008', externalId: '70008' }]);
await navigationRequest;
assert.equal(navigationController.getState().status, 'idle');

let detailCalls = 0;
const detailDeferred = deferred();
const detailController = createExternalRecipeController({
  source: { ...source, getDetails: () => { detailCalls += 1; return detailDeferred.promise; } },
});
const detailOne = detailController.getDetails('external:themealdb:70009');
const detailTwo = detailController.getDetails('external:themealdb:70009');
assert.equal(detailOne, detailTwo);
detailDeferred.resolve({ ...details, id: 'external:themealdb:70009', externalId: '70009' });
const hydrated = await detailOne;
assert.equal(hydrated.id, 'external:themealdb:70009');
assert.equal(detailCalls, 1);
assert.equal(await detailController.getDetails('external:themealdb:70009'), hydrated);
assert.equal(detailCalls, 1);
assert.equal(detailController.getCachedDetails('external:themealdb:70009'), hydrated);
await assert.rejects(detailController.getDetails('themealdb:70009'), (error) => error.code === 'INVALID_ID');

const invalidDetailController = createExternalRecipeController({
  source: { ...source, getDetails: async () => ({ ...details, id: 'external:themealdb:99999' }) },
});
await assert.rejects(invalidDetailController.getDetails('external:themealdb:70010'), (error) => error.code === 'INVALID_DATA');

const invalidationDeferred = deferred();
const invalidationController = createExternalRecipeController({
  source: { ...source, getDetails: (_id, { signal }) => {
    signal.addEventListener('abort', () => invalidationDeferred.reject(abortError()), { once: true });
    return invalidationDeferred.promise;
  } },
});
const invalidatedDetail = invalidationController.getDetails('external:themealdb:70011');
await Promise.resolve();
invalidationController.invalidateDetails('external:themealdb:70011');
await assert.rejects(invalidatedDetail, (error) => error.code === 'CANCELLED');

let importFetchCalls = 0;
globalThis.fetch = () => { importFetchCalls += 1; throw new Error('must stay offline'); };
await import(`../js/mealdb-recipe-source.js?inert=${Date.now()}`);
await import(`../js/external-recipe-controller.js?inert=${Date.now()}`);
assert.equal(importFetchCalls, 0);
delete globalThis.fetch;

for (const file of ['../js/mealdb-recipe-source.js', '../js/external-recipe-controller.js']) {
  const productionSource = await readFile(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(productionSource, /document\.|window\.|localStorage|sessionStorage|innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(productionSource, /supabase|signUp|signIn|exchangeCodeForSession/i);
}

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
assert.doesNotMatch(appSource, /mealdb-recipe-source|external-recipe-controller/);

console.log('Offline TheMealDB source and async controller tests passed with injected fictional clients only.');
