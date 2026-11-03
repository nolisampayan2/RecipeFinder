import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_RECIPE_SELECT,
  createSupabaseAdminRecipeSource,
  normalizeAdminRecipeRow,
} from '../js/supabase-admin-recipes.js';

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

const sourceText = await readFile(new URL('../js/supabase-admin-recipes.js', import.meta.url), 'utf8');
assert.doesNotMatch(sourceText, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(|createClient|service_role/i);

console.log('Offline read-only admin recipe source tests passed with fake clients only.');
