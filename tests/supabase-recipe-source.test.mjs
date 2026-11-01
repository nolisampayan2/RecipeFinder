import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRecipeCatalog } from '../js/recipe-catalog.js';
import {
  PUBLISHED_RECIPE_SELECT,
  createPublishedRecipeSource,
  normalizePublishedRecipeRow,
} from '../js/supabase-recipe-source.js';

function validRow(overrides = {}) {
  return {
    id: 'database-recipe',
    name: 'Database Recipe',
    description: 'A published database recipe.',
    image_url: 'https://images.example.test/database-recipe.jpg',
    fallback_image_url: 'assets/database-recipe.png',
    tutorial_url: 'https://www.youtube.com/watch?v=offline-fixture',
    ingredients: [
      { name: 'Ingredient One', measurement: '1 cup' },
      { name: 'Ingredient Two', measurement: '2 tbsp' },
    ],
    instructions: 'Prepare the ingredients and cook safely.',
    status: 'published',
    source_type: 'cms',
    external_provider: null,
    external_id: null,
    category: { name: 'Vegetarian' },
    cuisine: { name: 'Mediterranean' },
    ...overrides,
  };
}

function fakeClient(response, { rejectWith = null } = {}) {
  const calls = [];
  const query = {
    select(fields) {
      calls.push(['select', fields]);
      return this;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return this;
    },
    order(column, options) {
      calls.push(['order', column, options]);
      return rejectWith ? Promise.reject(rejectWith) : Promise.resolve(response);
    },
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push(['from', table]);
        return query;
      },
    },
  };
}

const normalized = normalizePublishedRecipeRow(validRow());
assert.deepEqual(normalized, {
  id: 'database-recipe',
  source: 'database',
  databaseSourceType: 'cms',
  name: 'Database Recipe',
  category: 'Vegetarian',
  cuisine: 'Mediterranean',
  image: 'https://images.example.test/database-recipe.jpg',
  fallbackImage: 'assets/database-recipe.png',
  description: 'A published database recipe.',
  ingredients: [
    ['Ingredient One', '1 cup'],
    ['Ingredient Two', '2 tbsp'],
  ],
  instructions: 'Prepare the ingredients and cook safely.',
  tutorial: 'https://www.youtube.com/watch?v=offline-fixture',
});
assert.ok(Object.isFrozen(normalized));
assert.ok(Object.isFrozen(normalized.ingredients));
assert.ok(Object.isFrozen(normalized.ingredients[0]));

const external = normalizePublishedRecipeRow(validRow({
  id: 'external:curated:42',
  source_type: 'external',
  external_provider: 'curated-provider',
  external_id: '42',
}));
assert.equal(external.source, 'database');
assert.equal(external.databaseSourceType, 'external');
assert.equal(external.externalProvider, 'curated-provider');
assert.equal(external.externalId, '42');
assert.notEqual(external.source, 'external', 'Curated database rows must not enter transient-provider rendering paths');

const catalog = createRecipeCatalog([normalized, external]);
assert.equal(catalog.getById('database-recipe')?.ingredients[0][0], 'Ingredient One');
assert.deepEqual(catalog.filter('ingredient two', '').map(({ id }) => id), [
  'database-recipe',
  'external:curated:42',
]);

const queryHarness = fakeClient({ data: [validRow()], error: null });
const result = await createPublishedRecipeSource(queryHarness.client).listPublished();
assert.equal(result.error, null);
assert.deepEqual(result.data.map(({ id }) => id), ['database-recipe']);
assert.deepEqual(queryHarness.calls, [
  ['from', 'recipes'],
  ['select', PUBLISHED_RECIPE_SELECT],
  ['eq', 'status', 'published'],
  ['order', 'published_at', { ascending: false }],
]);
assert.doesNotMatch(PUBLISHED_RECIPE_SELECT, /\*|created_by|user_id|access_token|refresh_token/i);

const emptyResult = await createPublishedRecipeSource(
  fakeClient({ data: [], error: null }).client
).listPublished();
assert.deepEqual(emptyResult, { data: [], error: null });

const unavailable = { data: null, error: { code: 'unavailable', message: 'Published recipes are unavailable.' } };
for (const response of [
  null,
  [],
  {},
  { data: [], error: undefined },
  { data: null, error: null },
  { data: {}, error: null },
  { data: [validRow()], error: new Error('PRIVATE_PROVIDER_ERROR') },
  { data: [validRow(), validRow()], error: null },
  { data: [validRow({ id: 'UPPERCASE' })], error: null },
  { data: [validRow({ ingredients: [] })], error: null },
  { data: [validRow({ ingredients: [{ name: 'Salt' }] })], error: null },
  { data: [validRow({ description: '' })], error: null },
  { data: [validRow({ category: [] })], error: null },
  { data: [validRow({ image_url: 'javascript:alert(1)' })], error: null },
  { data: [validRow({ image_url: '../assets/traversal.png' })], error: null },
  { data: [validRow({ image_url: 'images/not-in-assets.png' })], error: null },
  { data: [validRow({ image_url: 'https://user:password@example.test/private.png' })], error: null },
  { data: [validRow({ image_url: ' https://example.test/spaced.png' })], error: null },
  { data: [validRow({ fallback_image_url: 'data:text/html,unsafe' })], error: null },
  { data: [validRow({ tutorial_url: 'https://user@example.test/tutorial' })], error: null },
  { data: [validRow({ tutorial_url: 'https://user:password@example.test/tutorial' })], error: null },
  { data: [validRow({ tutorial_url: 'http://example.test/insecure' })], error: null },
  { data: [validRow({ tutorial_url: 'not a URL' })], error: null },
  { data: [validRow({ status: 'draft' })], error: null },
  { data: [validRow({ source_type: 'cms', external_provider: 'unexpected' })], error: null },
  { data: [validRow({ source_type: 'external', external_provider: null, external_id: null })], error: null },
]) {
  const failure = await createPublishedRecipeSource(fakeClient(response).client).listPublished();
  assert.deepEqual(failure, unavailable);
  assert.doesNotMatch(JSON.stringify(failure), /PRIVATE_PROVIDER_ERROR|javascript:|data:text|access_token|refresh_token/i);
}

for (const invalidRow of [
  null,
  [],
  { ...validRow(), name: undefined },
  { ...validRow(), cuisine: { name: 7 } },
  { ...validRow(), instructions: '   ' },
]) {
  assert.throws(() => normalizePublishedRecipeRow(invalidRow), TypeError);
}

for (const invalidClient of [
  undefined,
  null,
  {},
  { from: null },
  new Proxy({}, { get() { throw new Error('PRIVATE_CLIENT_ERROR'); } }),
]) {
  assert.throws(
    () => createPublishedRecipeSource(invalidClient),
    (error) => error instanceof TypeError
      && error.message === 'A compatible Supabase recipe client is required.'
  );
}

const rejectedQuery = fakeClient(null, { rejectWith: new Error('PRIVATE_QUERY_ERROR') });
assert.deepEqual(await createPublishedRecipeSource(rejectedQuery.client).listPublished(), unavailable);

const overriddenMapData = [validRow()];
overriddenMapData.map = () => [{ id: 'incomplete-bypass' }];
const overriddenMapResult = await createPublishedRecipeSource(
  fakeClient({ data: overriddenMapData, error: null }).client
).listPublished();
assert.deepEqual(overriddenMapResult, unavailable);

const emptyOverriddenMapData = [];
emptyOverriddenMapData.map = () => [{ id: 'incomplete-bypass' }];
assert.deepEqual(
  await createPublishedRecipeSource(fakeClient({
    data: emptyOverriddenMapData,
    error: null,
  }).client).listPublished(),
  unavailable
);

const duplicateBypassData = [validRow(), validRow()];
duplicateBypassData.map = () => [validRow(), validRow({ id: 'different-id' })];
assert.deepEqual(
  await createPublishedRecipeSource(fakeClient({ data: duplicateBypassData, error: null }).client).listPublished(),
  unavailable
);

const sparseRows = new Array(1);
assert.deepEqual(
  await createPublishedRecipeSource(fakeClient({ data: sparseRows, error: null }).client).listPublished(),
  unavailable
);

const hostileRows = [];
Object.defineProperty(hostileRows, 0, {
  configurable: true,
  enumerable: true,
  get() { throw new Error('PRIVATE_INDEX_ERROR'); },
});
hostileRows.length = 1;
assert.deepEqual(
  await createPublishedRecipeSource(fakeClient({ data: hostileRows, error: null }).client).listPublished(),
  unavailable
);

const malformedIngredients = [{ name: 'Salt' }];
malformedIngredients.map = () => [{ name: 'Salt', measurement: '1 tsp' }];
assert.deepEqual(
  await createPublishedRecipeSource(fakeClient({
    data: [validRow({ ingredients: malformedIngredients })],
    error: null,
  }).client).listPublished(),
  unavailable
);

const sparseIngredients = new Array(1);
assert.deepEqual(
  await createPublishedRecipeSource(fakeClient({
    data: [validRow({ ingredients: sparseIngredients })],
    error: null,
  }).client).listPublished(),
  unavailable
);

let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  fetchCalls += 1;
  throw new Error('The source must not perform its own network request.');
};
await createPublishedRecipeSource(fakeClient({ data: [], error: null }).client).listPublished();
globalThis.fetch = originalFetch;
assert.equal(fetchCalls, 0);

const source = await readFile(new URL('../js/supabase-recipe-source.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /service.?role|sb_secret_|supabase-config|createClient|innerHTML|insertAdjacentHTML|localStorage|sessionStorage|console\./i);
assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);

console.log('Offline Supabase published recipe source tests passed with fake clients only.');
