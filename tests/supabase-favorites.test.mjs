import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  FAVORITES_SERVICE_ERROR,
  createSupabaseFavoritesService,
} from '../js/supabase-favorites.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = 'database-recipe';

function fakeClient(responses = {}) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        calls.push(['from', table]);
        let operation = 'list';
        const query = {
          select(fields) { calls.push(['select', fields]); return this; },
          eq(column, value) { calls.push(['eq', column, value]); return this; },
          order(column, options) {
            calls.push(['order', column, options]);
            const response = responses.list;
            return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
          },
          insert(value) { operation = 'insert'; calls.push(['insert', value]); return this; },
          delete() { operation = 'delete'; calls.push(['delete']); return this; },
          single() {
            calls.push(['single']);
            const response = responses[operation];
            return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
          },
        };
        return query;
      },
    },
  };
}

const successHarness = fakeClient({
  list: { data: [{ recipe_id: 'first-recipe' }, { recipe_id: 'second-recipe' }], error: null },
  insert: { data: { recipe_id: RECIPE_ID }, error: null },
  delete: { data: { recipe_id: RECIPE_ID }, error: null },
});
const service = createSupabaseFavoritesService(successHarness.client);

assert.deepEqual(await service.listOwn(USER_ID), {
  data: ['first-recipe', 'second-recipe'],
  error: null,
});
assert.deepEqual(successHarness.calls.slice(0, 4), [
  ['from', 'favorites'],
  ['select', 'recipe_id'],
  ['eq', 'user_id', USER_ID],
  ['order', 'created_at', { ascending: true }],
]);

const added = await service.addOwn(USER_ID, RECIPE_ID);
assert.deepEqual(added, { ok: true, recipeId: RECIPE_ID, error: null });
assert.deepEqual(successHarness.calls.slice(4, 8), [
  ['from', 'favorites'],
  ['insert', { user_id: USER_ID, recipe_id: RECIPE_ID }],
  ['select', 'recipe_id'],
  ['single'],
]);

const removed = await service.removeOwn(USER_ID, RECIPE_ID);
assert.deepEqual(removed, { ok: true, recipeId: RECIPE_ID, error: null });
assert.deepEqual(successHarness.calls.slice(8), [
  ['from', 'favorites'],
  ['delete'],
  ['eq', 'user_id', USER_ID],
  ['eq', 'recipe_id', RECIPE_ID],
  ['select', 'recipe_id'],
  ['single'],
]);

for (const invalidUserId of [undefined, null, '', 'not-a-uuid', '11111111-1111-0111-8111-111111111111']) {
  await assert.rejects(service.listOwn(invalidUserId), /valid authenticated user ID/);
  await assert.rejects(service.addOwn(invalidUserId, RECIPE_ID), /valid authenticated user ID/);
  await assert.rejects(service.removeOwn(invalidUserId, RECIPE_ID), /valid authenticated user ID/);
}
for (const invalidRecipeId of [undefined, null, '', 'UPPERCASE', 'has spaces', '../unsafe']) {
  await assert.rejects(service.addOwn(USER_ID, invalidRecipeId), /valid favorite recipe ID/);
  await assert.rejects(service.removeOwn(USER_ID, invalidRecipeId), /valid favorite recipe ID/);
}

for (const rows of [
  null,
  {},
  [null],
  [{}],
  [{ recipe_id: 'UPPERCASE' }],
  [{ recipe_id: 'duplicate' }, { recipe_id: 'duplicate' }],
  new Array(1),
]) {
  const malformed = createSupabaseFavoritesService(fakeClient({
    list: { data: rows, error: null },
  }).client);
  assert.deepEqual(await malformed.listOwn(USER_ID), {
    data: null,
    error: FAVORITES_SERVICE_ERROR.INVALID_RESPONSE,
  });
}

const overriddenRows = [{ recipe_id: 'safe-id' }];
overriddenRows.map = () => [];
assert.deepEqual(
  await createSupabaseFavoritesService(fakeClient({
    list: { data: overriddenRows, error: null },
  }).client).listOwn(USER_ID),
  { data: null, error: FAVORITES_SERVICE_ERROR.INVALID_RESPONSE }
);

const privateProviderError = new Error('PRIVATE_PROVIDER_MESSAGE');
privateProviderError.code = 'PRIVATE_PROVIDER_CODE';
for (const operation of ['list', 'insert', 'delete']) {
  const responses = {
    list: { data: [], error: null },
    insert: { data: { recipe_id: RECIPE_ID }, error: null },
    delete: { data: { recipe_id: RECIPE_ID }, error: null },
  };
  responses[operation] = { data: null, error: privateProviderError };
  const providerService = createSupabaseFavoritesService(fakeClient(responses).client);
  const result = operation === 'list'
    ? await providerService.listOwn(USER_ID)
    : operation === 'insert'
      ? await providerService.addOwn(USER_ID, RECIPE_ID)
      : await providerService.removeOwn(USER_ID, RECIPE_ID);
  assert.equal(result.error, FAVORITES_SERVICE_ERROR.PROVIDER);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER/);
}

for (const operation of ['list', 'insert', 'delete']) {
  const responses = { list: { data: [], error: null }, insert: null, delete: null };
  responses[operation] = new Error('PRIVATE_NETWORK_MESSAGE');
  const networkService = createSupabaseFavoritesService(fakeClient(responses).client);
  const result = operation === 'list'
    ? await networkService.listOwn(USER_ID)
    : operation === 'insert'
      ? await networkService.addOwn(USER_ID, RECIPE_ID)
      : await networkService.removeOwn(USER_ID, RECIPE_ID);
  assert.equal(result.error, FAVORITES_SERVICE_ERROR.NETWORK);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NETWORK/);
}

for (const invalidClient of [
  undefined,
  null,
  {},
  { from: null },
  new Proxy({}, { get() { throw new Error('PRIVATE_CLIENT_ERROR'); } }),
]) {
  assert.throws(
    () => createSupabaseFavoritesService(invalidClient),
    (error) => error instanceof TypeError
      && error.message === 'A compatible Supabase favorites client is required.'
  );
}

const mismatchedWrite = createSupabaseFavoritesService(fakeClient({
  insert: { data: { recipe_id: 'different-recipe' }, error: null },
  delete: { data: {}, error: null },
}).client);
assert.equal((await mismatchedWrite.addOwn(USER_ID, RECIPE_ID)).error, FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
assert.equal((await mismatchedWrite.removeOwn(USER_ID, RECIPE_ID)).error, FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);

const source = await readFile(new URL('../js/supabase-favorites.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /createClient|supabase-config|service.?role|sb_secret_|access_token|refresh_token|console\.|localStorage|sessionStorage/i);
assert.doesNotMatch(source, /\.upsert\s*\(|\.update\s*\(/);

console.log('Offline Supabase account Favorites service tests passed with fake clients only.');
