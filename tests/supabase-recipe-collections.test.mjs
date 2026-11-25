import assert from 'node:assert/strict';
import { createSupabaseRecipeCollectionsService, normalizeCollectionName,
  normalizeCollectionReference } from '../js/supabase-recipe-collections.js';

const USER = '123e4567-e89b-42d3-a456-426614174000';
const COLLECTION = '223e4567-e89b-42d3-a456-426614174000';
const ITEM = '323e4567-e89b-42d3-a456-426614174000';
const row = { id: COLLECTION, name: 'Weeknight meals' };
const item = { id: ITEM, collection_id: COLLECTION, recipe_id: 'creamy-garlic-pasta', mealdb_id: null };

function fakeClient(responses) {
  const calls = [];
  return { calls, from(table) {
    const call = { table, steps: [] };
    calls.push(call);
    const query = {
      select(...args) { call.steps.push(['select', ...args]); return query; },
      insert(...args) { call.steps.push(['insert', ...args]); return query; },
      update(...args) { call.steps.push(['update', ...args]); return query; },
      delete(...args) { call.steps.push(['delete', ...args]); return query; },
      eq(...args) { call.steps.push(['eq', ...args]); return query; },
      in(...args) { call.steps.push(['in', ...args]); return query; },
      order(...args) { call.steps.push(['order', ...args]); return Promise.resolve(responses.shift()); },
      single() { call.steps.push(['single']); return Promise.resolve(responses.shift()); },
    };
    return query;
  } };
}

assert.equal(normalizeCollectionName('  Family dinners  '), 'Family dinners');
for (const invalid of ['', '   ', {}, 'a'.repeat(81), 'A\u202eB', 'A\nB']) {
  assert.equal(normalizeCollectionName(invalid), null);
}
assert.deepEqual(normalizeCollectionReference({ id: 'creamy-garlic-pasta', source: 'built-in' }),
  { recipe_id: 'creamy-garlic-pasta', mealdb_id: null });
assert.deepEqual(normalizeCollectionReference({ id: 'external:fictional-offline:990001',
  source: 'external', externalProvider: 'fictional-offline', externalId: '990001' }),
{ recipe_id: 'external:fictional-offline:990001', mealdb_id: null });
assert.deepEqual(normalizeCollectionReference({ id: 'external:themealdb:52772',
  source: 'external', externalProvider: 'themealdb', externalId: '52772',
  ingredients: [['Secret', '1 cup']], instructions: 'Private detail' }),
{ recipe_id: null, mealdb_id: '52772' });
for (const invalid of [
  { id: 'external:themealdb:52772', source: 'external', externalProvider: 'themealdb', externalId: '1' },
  { id: 'external:evil:1', source: 'external', externalProvider: 'evil', externalId: '1' },
  { id: 'external:fictional-offline:990001', source: 'built-in' },
]) assert.equal(normalizeCollectionReference(invalid), null);

const client = fakeClient([
  { data: [row], count: 1, error: null }, { data: [item], count: 1, error: null },
  { data: row, error: null }, { data: { ...row, name: 'Quick meals' }, error: null },
  { data: item, error: null },
  { data: { ...item, recipe_id: null, mealdb_id: '52772' }, error: null },
  { data: { id: ITEM }, error: null }, { data: { id: COLLECTION }, error: null },
]);
const service = createSupabaseRecipeCollectionsService(client);
assert.equal((await service.listOwn('bad')).error.code, 'DENIED');
assert.equal(client.calls.length, 0);
const listed = await service.listOwn(USER);
assert.equal(listed.error, null);
assert.deepEqual(listed.data[0].items.map((entry) => entry.recipeId), ['creamy-garlic-pasta']);
assert.equal(Object.isFrozen(listed.data[0].items), true);
assert.equal(JSON.stringify(listed).includes('ingredients'), false);
assert.deepEqual(client.calls[0].steps.map((entry) => entry[0]), ['select', 'eq', 'order']);
assert.deepEqual(client.calls[1].steps.map((entry) => entry[0]), ['select', 'in', 'order']);
assert.equal((await service.createOwn(USER, ' Weeknight meals ')).data.name, 'Weeknight meals');
assert.equal((await service.renameOwn(USER, COLLECTION, 'Quick meals')).data.name, 'Quick meals');
assert.equal((await service.addOwn(USER, COLLECTION, { id: 'creamy-garlic-pasta', source: 'built-in' })).data.recipeId,
  'creamy-garlic-pasta');
assert.equal((await service.addOwn(USER, COLLECTION, { id: 'external:themealdb:52772', source: 'external',
  externalProvider: 'themealdb', externalId: '52772' })).data.recipeId, 'external:themealdb:52772');
assert.equal((await service.removeOwn(USER, COLLECTION, ITEM)).data.id, ITEM);
assert.equal((await service.deleteOwn(USER, COLLECTION)).data.id, COLLECTION);
assert.equal(client.calls[3].steps.some((entry) => entry[0] === 'eq' && entry[1] === 'user_id'), true,
  'Rename must include user predicate');
assert.deepEqual(client.calls[4].steps[0][1], { collection_id: COLLECTION,
  recipe_id: 'creamy-garlic-pasta', mealdb_id: null }, 'Only safe references are written');
assert.equal(client.calls[5].steps[0][1].ingredients, undefined);

const duplicate = createSupabaseRecipeCollectionsService(fakeClient([
  { data: null, error: { code: '23505', message: 'private provider detail' } },
]));
const conflict = await duplicate.createOwn(USER, 'Duplicate');
assert.equal(conflict.error.code, 'DUPLICATE');
assert.equal(JSON.stringify(conflict).includes('private provider detail'), false);
const malformed = createSupabaseRecipeCollectionsService(fakeClient([{ data: [
  { ...row, instructions: 'Forbidden detail' },
], count: 1, error: null }]));
assert.equal((await malformed.listOwn(USER)).error.code, 'UNAVAILABLE');
const truncated = createSupabaseRecipeCollectionsService(fakeClient([{ data: [row], count: 2, error: null }]));
assert.equal((await truncated.listOwn(USER)).error.code, 'UNAVAILABLE',
  'A truncated provider page must not appear to be a complete collection list');
assert.equal((await service.addOwn('invalid', COLLECTION, { id: 'creamy-garlic-pasta', source: 'built-in' })).error.code,
  'DENIED');
console.log('Collections service safe-reference and fake-provider contracts passed.');
