import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_CATEGORY_SELECT,
  ADMIN_CUISINE_SELECT,
  createSupabaseAdminTaxonomySource,
} from '../js/supabase-admin-taxonomies.js';

const UPDATED_AT = '2026-11-04T10:20:30.000Z';

function category(overrides = {}) {
  return {
    id: 1,
    slug: 'main-dish',
    name: 'Main Dish',
    emoji: '🍲',
    sort_order: 10,
    is_active: true,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

function cuisine(overrides = {}) {
  return {
    id: 2,
    slug: 'filipino',
    name: 'Filipino',
    flag_emoji: '🇵🇭',
    sort_order: 20,
    is_active: true,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function harness(responses = {}) {
  const calls = [];
  return {
    calls,
    client: {
      from(tableName) {
        calls.push(['from', tableName]);
        return {
          select(fields) {
            calls.push(['select', fields]);
            const builder = {
              order(field, options) {
                calls.push(['order', field, options]);
                if (field === 'name') {
                  const response = responses[tableName];
                  return typeof response === 'function' ? response() : response;
                }
                return builder;
              },
            };
            return builder;
          },
        };
      },
    },
  };
}

const validHarness = harness({
  recipe_categories: { data: [category(), category({ id: 3, slug: 'archived', name: 'Archived', is_active: false })], error: null },
  cuisines: { data: [cuisine(), cuisine({ id: 4, slug: 'retired', name: 'Retired', is_active: false, flag_emoji: null })], error: null },
});
const source = createSupabaseAdminTaxonomySource(validHarness.client);
const categories = await source.listCategories();
const cuisines = await source.listCuisines();
assert.deepEqual(categories, {
  data: [
    { id: 1, slug: 'main-dish', name: 'Main Dish', symbol: '🍲', sortOrder: 10, isActive: true, updatedAt: UPDATED_AT },
    { id: 3, slug: 'archived', name: 'Archived', symbol: '🍲', sortOrder: 10, isActive: false, updatedAt: UPDATED_AT },
  ],
  error: null,
});
assert.deepEqual(cuisines, {
  data: [
    { id: 2, slug: 'filipino', name: 'Filipino', symbol: '🇵🇭', sortOrder: 20, isActive: true, updatedAt: UPDATED_AT },
    { id: 4, slug: 'retired', name: 'Retired', symbol: null, sortOrder: 20, isActive: false, updatedAt: UPDATED_AT },
  ],
  error: null,
});
assert.equal(Object.isFrozen(categories.data), true);
assert.equal(categories.data.every(Object.isFrozen), true);
assert.deepEqual(validHarness.calls, [
  ['from', 'recipe_categories'],
  ['select', ADMIN_CATEGORY_SELECT],
  ['order', 'sort_order', { ascending: true }],
  ['order', 'name', { ascending: true }],
  ['from', 'cuisines'],
  ['select', ADMIN_CUISINE_SELECT],
  ['order', 'sort_order', { ascending: true }],
  ['order', 'name', { ascending: true }],
]);

for (const badRows of [
  null,
  [null],
  [category({ id: 0 })],
  [category({ slug: 'Bad Slug' })],
  [category({ name: '' })],
  [category({ is_active: 'true' })],
  [category(), category()],
  [category(), category({ id: 2 })],
  [category({ updated_at: 'invalid' })],
]) {
  const bad = harness({ recipe_categories: { data: badRows, error: null } });
  const result = await createSupabaseAdminTaxonomySource(bad.client).listCategories();
  assert.equal(result.data, null);
  assert.equal(result.error.code, 'unavailable');
}

const sparse = new Array(2);
sparse[1] = category();
const sparseHarness = harness({ recipe_categories: { data: sparse, error: null } });
assert.equal((await createSupabaseAdminTaxonomySource(sparseHarness.client).listCategories()).error.code, 'unavailable');

for (const response of [
  null,
  {},
  { data: [category()], error: { message: 'PRIVATE_PROVIDER_ERROR' } },
]) {
  const bad = harness({ recipe_categories: response });
  const result = await createSupabaseAdminTaxonomySource(bad.client).listCategories();
  assert.equal(result.error.code, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_ERROR/);
}

const pending = deferred();
const staleHarness = harness({ recipe_categories: () => pending.promise });
const staleSource = createSupabaseAdminTaxonomySource(staleHarness.client);
const staleResult = staleSource.listCategories();
assert.equal(staleSource.invalidate(), true);
pending.resolve({ data: [category()], error: null });
assert.equal((await staleResult).error.code, 'unavailable');

const cleanupPending = deferred();
const cleanupHarness = harness({ cuisines: () => cleanupPending.promise });
const cleanupSource = createSupabaseAdminTaxonomySource(cleanupHarness.client);
const cleanupResult = cleanupSource.listCuisines();
assert.equal(cleanupSource.cleanup(), true);
cleanupPending.resolve({ data: [cuisine()], error: null });
assert.equal((await cleanupResult).error.code, 'unavailable');
assert.equal(cleanupSource.cleanup(), false);
assert.equal((await cleanupSource.listCategories()).error.code, 'unavailable');

assert.throws(() => createSupabaseAdminTaxonomySource(null), /compatible Supabase Admin taxonomy client/i);

const sourceText = await readFile(new URL('../js/supabase-admin-taxonomies.js', import.meta.url), 'utf8');
assert.doesNotMatch(sourceText, /createClient|service_role|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(/i);

console.log('Offline Admin taxonomy read service tests passed with fake clients only.');
