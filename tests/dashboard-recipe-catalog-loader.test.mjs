import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recipeCatalog } from '../js/recipe-catalog.js';
import { createDashboardRecipeCatalogLoader } from '../js/dashboard-recipe-catalog-loader.js';

function rawRecipe(overrides = {}) {
  return {
    id: 'database-loader-recipe',
    name: 'Database Loader Recipe',
    description: 'A fictional published recipe.',
    image_url: 'assets/beef-stew.png',
    fallback_image_url: null,
    tutorial_url: 'https://example.test/tutorial',
    ingredients: [{ name: 'Ingredient', measurement: '1 cup' }],
    instructions: 'Prepare and serve.',
    status: 'published',
    source_type: 'seed',
    external_provider: null,
    external_id: null,
    category: { name: 'Beef' },
    cuisine: { name: 'British' },
    ...overrides,
  };
}

function fakeClient(response) {
  const calls = [];
  const query = {
    select(fields) { calls.push(['select', fields]); return this; },
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    order(column, options) { calls.push(['order', column, options]); return Promise.resolve(response); },
  };
  return {
    calls,
    client: {
      from(table) { calls.push(['from', table]); return query; },
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

const originalBuiltInIds = recipeCatalog.list().map(({ id }) => id);

const successfulClient = fakeClient({ data: [rawRecipe()], error: null });
const successfulLoader = createDashboardRecipeCatalogLoader({ client: successfulClient.client });
assert.equal(successfulClient.calls.length, 0, 'Construction must remain inert');
const successful = await successfulLoader.load();
assert.equal(successful.origin, 'database');
assert.equal(successful.databaseStatus, 'success');
assert.equal(successful.stale, false);
assert.equal(successful.catalog.getById('database-loader-recipe')?.name, 'Database Loader Recipe');
assert.deepEqual(successful.catalog.getById('database-loader-recipe')?.ingredients, [['Ingredient', '1 cup']]);
assert.ok(Object.isFrozen(successful));
assert.ok(Object.isFrozen(successful.catalog.list()[0]));
assert.deepEqual(successfulClient.calls.map(([operation]) => operation), ['from', 'select', 'eq', 'order']);

const curatedClient = fakeClient({
  data: [rawRecipe({
    id: 'external:curated:loader',
    source_type: 'external',
    external_provider: 'curated-provider',
    external_id: 'loader',
  })],
  error: null,
});
const curated = await createDashboardRecipeCatalogLoader({ client: curatedClient.client }).load();
assert.equal(curated.catalog.list()[0].source, 'database');
assert.equal(curated.catalog.list()[0].externalProvider, 'curated-provider');

const empty = await createDashboardRecipeCatalogLoader({
  client: fakeClient({ data: [], error: null }).client,
}).load();
assert.equal(empty.origin, 'database');
assert.equal(empty.databaseStatus, 'success');
assert.deepEqual(empty.catalog.list(), []);

for (const loader of [
  createDashboardRecipeCatalogLoader(),
  createDashboardRecipeCatalogLoader({}),
  createDashboardRecipeCatalogLoader({ client: null }),
]) {
  const missing = await loader.load();
  assert.equal(missing.catalog, recipeCatalog);
  assert.equal(missing.origin, 'built-in');
  assert.equal(missing.databaseStatus, 'missing');
}

const providerFailure = await createDashboardRecipeCatalogLoader({
  client: fakeClient({ data: null, error: new Error('PRIVATE_PROVIDER_ERROR') }).client,
}).load();
assert.equal(providerFailure.catalog, recipeCatalog);
assert.equal(providerFailure.databaseStatus, 'failed');
assert.doesNotMatch(JSON.stringify(providerFailure), /PRIVATE_PROVIDER_ERROR/);

for (const response of [
  { data: [rawRecipe({ name: undefined })], error: null },
  { data: [rawRecipe(), rawRecipe()], error: null },
]) {
  const invalid = await createDashboardRecipeCatalogLoader({ client: fakeClient(response).client }).load();
  assert.equal(invalid.catalog, recipeCatalog);
  assert.equal(invalid.databaseStatus, 'failed');
}

const throwingSource = {
  listPublished() { throw new Error('PRIVATE_SOURCE_ERROR'); },
};
const thrown = await createDashboardRecipeCatalogLoader({ source: throwingSource }).load();
assert.equal(thrown.catalog, recipeCatalog);
assert.equal(thrown.databaseStatus, 'failed');
assert.doesNotMatch(JSON.stringify(thrown), /PRIVATE_SOURCE_ERROR/);

let sourceCalls = 0;
const pendingResult = deferred();
const deferredSource = {
  listPublished() {
    sourceCalls += 1;
    return pendingResult.promise;
  },
};
const lifecycleLoader = createDashboardRecipeCatalogLoader({ source: deferredSource });
const firstPending = lifecycleLoader.load();
const duplicatePending = lifecycleLoader.load();
assert.equal(firstPending, duplicatePending);
assert.equal(sourceCalls, 1);
assert.equal(lifecycleLoader.cancelPending(), true);
pendingResult.resolve({ data: [], error: null });
const canceled = await firstPending;
assert.equal(canceled.catalog, recipeCatalog);
assert.equal(canceled.databaseStatus, 'canceled');
assert.equal(canceled.stale, true);

const retiredLoader = createDashboardRecipeCatalogLoader({ source: throwingSource });
assert.equal(retiredLoader.cleanup(), true);
assert.equal(retiredLoader.cleanup(), false);
const retired = await retiredLoader.load();
assert.equal(retired.databaseStatus, 'canceled');
assert.equal(retired.stale, true);

assert.deepEqual(recipeCatalog.list().map(({ id }) => id), originalBuiltInIds);

let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { fetchCalls += 1; throw new Error('Unexpected network request'); };
await createDashboardRecipeCatalogLoader({ source: { listPublished: async () => ({ data: [], error: null }) } }).load();
globalThis.fetch = originalFetch;
assert.equal(fetchCalls, 0);

const sourceText = await readFile(new URL('../js/dashboard-recipe-catalog-loader.js', import.meta.url), 'utf8');
assert.doesNotMatch(sourceText, /supabase-config|createClient|service.?role|sb_secret_|\bfetch\s*\(|localStorage|sessionStorage|document\.|innerHTML|insertAdjacentHTML/i);

console.log('Offline dashboard recipe catalog loader tests passed with injected fakes only.');
