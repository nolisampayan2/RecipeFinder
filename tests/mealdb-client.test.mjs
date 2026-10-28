import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMealDbClient, MealDbClientError } from '../js/mealdb-client.js';

const jsonResponse = (body, overrides = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
  ...overrides,
});

const requests = [];
const client = createMealDbClient({
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (url.includes('categories.php')) return jsonResponse({ categories: [{ idCategory: '1' }] });
    if (url.includes('list.php')) return jsonResponse({ meals: [{ strArea: 'Fictionland' }] });
    return jsonResponse({ meals: [{ idMeal: '100' }] });
  },
});

assert.deepEqual(await client.search('spicy & sweet'), [{ idMeal: '100' }]);
assert.equal(new URL(requests.at(-1).url).pathname, '/api/json/v1/1/search.php');
assert.equal(new URL(requests.at(-1).url).searchParams.get('s'), 'spicy & sweet');
assert.deepEqual(await client.lookup('100'), [{ idMeal: '100' }]);
assert.equal(new URL(requests.at(-1).url).searchParams.get('i'), '100');
assert.deepEqual(await client.categories(), [{ idCategory: '1' }]);
assert.deepEqual(await client.filterByCategory('Plant Based'), [{ idMeal: '100' }]);
assert.equal(new URL(requests.at(-1).url).searchParams.get('c'), 'Plant Based');
assert.deepEqual(await client.filterByArea('Fictionland'), [{ idMeal: '100' }]);
assert.equal(new URL(requests.at(-1).url).searchParams.get('a'), 'Fictionland');
assert.deepEqual(await client.listAreas(), [{ strArea: 'Fictionland' }]);
assert.equal(new URL(requests.at(-1).url).searchParams.get('a'), 'list');
assert.ok(requests.every(({ url }) => new URL(url).origin === 'https://www.themealdb.com'));
assert.ok(requests.every(({ options }) => options.method === 'GET' && options.headers.Accept === 'application/json'));
assert.ok(requests.every(({ options }) => options.credentials === 'omit'));
assert.ok(requests.every(({ options }) => options.referrerPolicy === 'no-referrer'));

const emptyClient = createMealDbClient({ fetchImpl: async () => jsonResponse({ meals: null }) });
assert.deepEqual(await emptyClient.search('nothing'), []);

for (const operation of [
  () => createMealDbClient(),
  () => createMealDbClient({ fetchImpl: async () => jsonResponse({ meals: [] }), timeoutMs: 0 }),
  () => client.search(''),
  () => client.lookup('../100'),
  () => client.filterByCategory('\n'),
]) {
  assert.throws(operation, MealDbClientError);
}

await assert.rejects(
  createMealDbClient({ fetchImpl: async () => jsonResponse({}, { ok: false, status: 429 }) }).search('meal'),
  (error) => error.code === 'HTTP_ERROR' && error.status === 429,
);
await assert.rejects(
  createMealDbClient({ fetchImpl: async () => jsonResponse({ meals: 'wrong' }) }).search('meal'),
  (error) => error.code === 'INVALID_RESPONSE',
);
await assert.rejects(
  createMealDbClient({ fetchImpl: async () => jsonResponse({ categories: null }) }).categories(),
  (error) => error.code === 'INVALID_RESPONSE',
);
await assert.rejects(
  createMealDbClient({ fetchImpl: async () => jsonResponse(null, { json: async () => { throw new SyntaxError('fictional'); } }) }).search('meal'),
  (error) => error.code === 'INVALID_JSON',
);
await assert.rejects(
  createMealDbClient({ fetchImpl: async () => { throw new Error('fictional offline failure'); } }).search('meal'),
  (error) => error.code === 'NETWORK_ERROR',
);

const preCancelled = new AbortController();
preCancelled.abort();
await assert.rejects(client.search('meal', { signal: preCancelled.signal }), (error) => error.code === 'ABORTED');

const cancellableClient = createMealDbClient({
  fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }),
  timeoutMs: 1000,
});
const cancellation = new AbortController();
const cancelledRequest = cancellableClient.search('meal', { signal: cancellation.signal });
cancellation.abort();
await assert.rejects(cancelledRequest, (error) => error.code === 'ABORTED');

const timeoutClient = createMealDbClient({
  fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }),
  timeoutMs: 100,
});
await assert.rejects(timeoutClient.search('meal'), (error) => error.code === 'TIMEOUT');

const bodyTimeoutClient = createMealDbClient({
  fetchImpl: async (_url, { signal }) => jsonResponse(null, {
    json: () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  }),
  timeoutMs: 100,
});
await assert.rejects(bodyTimeoutClient.search('meal'), (error) => error.code === 'TIMEOUT');

let importFetchCalls = 0;
globalThis.fetch = () => { importFetchCalls += 1; throw new Error('must not run'); };
await import(`../js/mealdb-client.js?inert=${Date.now()}`);
assert.equal(importFetchCalls, 0, 'Importing the client module must not perform a request');
delete globalThis.fetch;

const source = await readFile(new URL('../js/mealdb-client.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.|window\.|localStorage|sessionStorage/);
assert.doesNotMatch(source, /supabase|signUp|signIn|exchangeCodeForSession/i);

console.log('Offline TheMealDB client tests passed with injected fictional fetch responses only.');
