import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_RECIPE_DETAIL_SELECT,
  ADMIN_RECIPE_SELECT,
  createSupabaseAdminRecipeSource,
  normalizeAdminRecipeDetailRow,
  normalizeAdminRecipeRow,
} from '../js/supabase-admin-recipes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2026-11-04T09:20:30.000Z';
const UPDATED_AT = '2026-11-04T10:20:30.000Z';
const MICROSECOND_UPDATED_AT = '2026-11-04T10:20:30.987654+00:00';
const OFFSET_UPDATED_AT = '2026-11-04T18:20:30.123456+08:00';

function row(overrides = {}) {
  return {
    id: 'cms:recipe-one',
    name: 'Recipe One',
    status: 'draft',
    category: { name: 'Dinner' },
    cuisine: { name: 'Filipino' },
    ...overrides,
  };
}

function fakeClient(response) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        calls.push(['from', table]);
        return {
          select(fields) {
            calls.push(['select', fields]);
            return {
              async order(field, options) {
                calls.push(['order', field, options]);
                return typeof response === 'function' ? response() : response;
              },
            };
          },
        };
      },
    },
  };
}

function detailRow(overrides = {}) {
  return {
    id: 'cms:recipe-one',
    name: 'Recipe One',
    description: 'A complete draft recipe.',
    category_id: 1,
    cuisine_id: 2,
    image_url: 'https://images.example.test/recipe.jpg',
    fallback_image_url: null,
    tutorial_url: 'https://video.example.test/recipe',
    ingredients: [{ name: 'Rice', measurement: '1 cup' }],
    instructions: 'Cook the recipe.',
    status: 'draft',
    source_type: 'cms',
    external_provider: null,
    external_id: null,
    created_by: USER_ID,
    published_at: null,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    category: { name: 'Dinner' },
    cuisine: { name: 'Filipino' },
    ...overrides,
  };
}

function detailFakeClient(response) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        calls.push(['from', table]);
        return {
          select(fields) {
            calls.push(['select', fields]);
            return {
              eq(field, value) {
                calls.push(['eq', field, value]);
                return {
                  async limit(valueLimit) {
                    calls.push(['limit', valueLimit]);
                    return typeof response === 'function' ? response() : response;
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

const normalized = normalizeAdminRecipeRow(row());
assert.deepEqual(normalized, {
  id: 'cms:recipe-one',
  name: 'Recipe One',
  category: 'Dinner',
  cuisine: 'Filipino',
  status: 'draft',
});
assert.equal(Object.isFrozen(normalized), true);

const validFake = fakeClient({
  data: [row(), row({ id: 'cms:recipe-two', name: 'Recipe Two', status: 'published' })],
  error: null,
});
const validResult = await createSupabaseAdminRecipeSource(validFake.client).listAll();
assert.equal(validResult.error, null);
assert.equal(validResult.data.length, 2);
assert.equal(Object.isFrozen(validResult.data), true);
assert.deepEqual(validFake.calls, [
  ['from', 'recipes'],
  ['select', ADMIN_RECIPE_SELECT],
  ['order', 'updated_at', { ascending: false }],
]);

const emptyResult = await createSupabaseAdminRecipeSource(
  fakeClient({ data: [], error: null }).client
).listAll();
assert.deepEqual(emptyResult, { data: [], error: null });

for (const response of [
  null,
  {},
  { data: null, error: null },
  { data: [row()], error: { message: 'PRIVATE_RECIPE_ERROR' } },
  { data: [row({ id: 'Bad ID' })], error: null },
  { data: [row({ status: 'archived' })], error: null },
  { data: [row({ category: null })], error: null },
  { data: [row(), row()], error: null },
]) {
  const result = await createSupabaseAdminRecipeSource(fakeClient(response).client).listAll();
  assert.equal(result.data, null);
  assert.equal(result.error.code, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Bad ID|archived/i);
}

const source = createSupabaseAdminRecipeSource(fakeClient({ data: [row()], error: null }).client);
assert.equal(source.invalidate(), true);
assert.equal((await source.listAll()).error, null);
assert.equal(source.cleanup(), true);
assert.equal(source.cleanup(), false);
assert.equal((await source.listAll()).error.code, 'unavailable');

assert.throws(() => createSupabaseAdminRecipeSource(null), /compatible Supabase admin recipe client/i);

const normalizedDetail = normalizeAdminRecipeDetailRow(detailRow());
assert.deepEqual(normalizedDetail, {
  id: 'cms:recipe-one',
  name: 'Recipe One',
  description: 'A complete draft recipe.',
  categoryId: 1,
  cuisineId: 2,
  category: 'Dinner',
  cuisine: 'Filipino',
  imageUrl: 'https://images.example.test/recipe.jpg',
  fallbackImageUrl: null,
  tutorialUrl: 'https://video.example.test/recipe',
  ingredients: [{ name: 'Rice', measurement: '1 cup' }],
  instructions: 'Cook the recipe.',
  status: 'draft',
  sourceType: 'cms',
  externalProvider: null,
  externalId: null,
  createdBy: USER_ID,
  publishedAt: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
});
assert.equal(Object.isFrozen(normalizedDetail), true);
assert.equal(Object.isFrozen(normalizedDetail.ingredients), true);
assert.equal(Object.isFrozen(normalizedDetail.ingredients[0]), true);

for (const token of [UPDATED_AT, MICROSECOND_UPDATED_AT, OFFSET_UPDATED_AT]) {
  const preserved = normalizeAdminRecipeDetailRow(detailRow({ updated_at: token }));
  assert.equal(preserved.updatedAt, token, 'updated_at must remain an exact concurrency token');
}

const publishedDetail = normalizeAdminRecipeDetailRow(detailRow({
  id: 'seed:published',
  status: 'published',
  source_type: 'seed',
  created_by: null,
  published_at: UPDATED_AT,
}));
assert.equal(publishedDetail.status, 'published');
assert.equal(publishedDetail.publishedAt, UPDATED_AT);

const externalDetail = normalizeAdminRecipeDetailRow(detailRow({
  id: 'external:themealdb:123',
  source_type: 'external',
  external_provider: 'themealdb',
  external_id: '123',
}));
assert.equal(externalDetail.externalProvider, 'themealdb');

const validDetailFake = detailFakeClient({ data: [detailRow()], error: null });
const detailResult = await createSupabaseAdminRecipeSource(validDetailFake.client).getById('cms:recipe-one');
assert.deepEqual(detailResult, { data: normalizedDetail, error: null });
assert.deepEqual(validDetailFake.calls, [
  ['from', 'recipes'],
  ['select', ADMIN_RECIPE_DETAIL_SELECT],
  ['eq', 'id', 'cms:recipe-one'],
  ['limit', 2],
]);

const missingDetail = await createSupabaseAdminRecipeSource(
  detailFakeClient({ data: [], error: null }).client,
).getById('cms:missing');
assert.equal(missingDetail.data, null);
assert.equal(missingDetail.error.code, 'not_found');

for (const response of [
  null,
  {},
  { data: null, error: null },
  { data: [detailRow()], error: { message: 'PRIVATE_DETAIL_ERROR' } },
  { data: [detailRow(), detailRow()], error: null },
  { data: [detailRow({ id: 'cms:wrong' })], error: null },
  { data: [detailRow({ status: 'published', published_at: null })], error: null },
  { data: [detailRow({ ingredients: [] })], error: null },
  { data: [detailRow({ updated_at: 'invalid' })], error: null },
  { data: [detailRow({ updated_at: '2026-02-30T10:20:30.000Z' })], error: null },
  { data: [detailRow({ updated_at: '2026-11-04T10:20:30.1234567Z' })], error: null },
  { data: [detailRow({ updated_at: '2026-11-04T10:20:30.000+14:01' })], error: null },
  { data: [detailRow({ updated_at: ' 2026-11-04T10:20:30.000Z' })], error: null },
]) {
  const result = await createSupabaseAdminRecipeSource(detailFakeClient(response).client)
    .getById('cms:recipe-one');
  assert.equal(result.data, null);
  assert.equal(result.error.code, 'unavailable');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DETAIL_ERROR/);
}

const invalidDetailFake = detailFakeClient({ data: [detailRow()], error: null });
assert.equal(
  (await createSupabaseAdminRecipeSource(invalidDetailFake.client).getById('Bad ID')).error.code,
  'unavailable',
);
assert.deepEqual(invalidDetailFake.calls, [], 'Invalid IDs must not reach the provider');

const pendingDetail = deferred();
const staleDetailFake = detailFakeClient(() => pendingDetail.promise);
const staleDetailSource = createSupabaseAdminRecipeSource(staleDetailFake.client);
const staleDetailResult = staleDetailSource.getById('cms:recipe-one');
assert.equal(staleDetailSource.invalidate(), true);
pendingDetail.resolve({ data: [detailRow()], error: null });
assert.equal((await staleDetailResult).error.code, 'unavailable');

const cleanupDetail = deferred();
const cleanupDetailSource = createSupabaseAdminRecipeSource(
  detailFakeClient(() => cleanupDetail.promise).client,
);
const lateDetail = cleanupDetailSource.getById('cms:recipe-one');
assert.equal(cleanupDetailSource.cleanup(), true);
cleanupDetail.resolve({ data: [detailRow()], error: null });
assert.equal((await lateDetail).error.code, 'unavailable');

const sourceText = await readFile(new URL('../js/supabase-admin-recipes.js', import.meta.url), 'utf8');
assert.doesNotMatch(sourceText, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(|createClient|service_role/i);

console.log('Offline read-only admin recipe source tests passed with fake clients only.');
