import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { adaptDashboardPreviewCatalogResult } from '../js/dashboard-preview-catalog-adapter.js';
import { createRecipePreviewCatalog } from '../js/recipe-preview-catalog.js';
import { BUILT_IN_RECIPE_PREVIEWS } from '../js/recipe-previews.js';
import { FICTIONAL_RECIPE_PREVIEWS } from './fixtures/fictional-recipe-previews.mjs';
import { ADMIN_PREVIEW_OUTPUT_FILES, PRODUCTION_OUTPUT_FILES } from '../scripts/build-vercel-static.mjs';

const cms = Object.freeze({
  id: 'cms:11111111-2222-4333-8444-555555555555',
  name: 'Aurora Lentil Bowl',
  category: 'Soup',
  cuisine: 'Filipino',
  image: 'assets/beef-stew.png',
  description: 'A bright public summary.',
  source: 'database',
  databaseSourceType: 'cms',
  detailLevel: 'preview',
});
const page = (recipes, databasePage = {
  hasMore: false, nextOffset: null, offset: 0, pageSize: 24,
  continuationAvailable: false, limitReached: false,
}, error = null, stale = false) => ({ data: { recipes, databasePage }, error, stale });

const allowed = new Set([
  'id', 'name', 'category', 'cuisine', 'image', 'fallbackImage', 'description',
  'source', 'detailLevel', 'databaseSourceType', 'externalProvider', 'externalId',
]);
const protectedNames = /ingredients|instructions|tutorial|measurement|createdby|internalnotes/i;
function assertSafe(recipe) {
  assert.equal(Object.isFrozen(recipe), true);
  assert.ok(Object.keys(recipe).every((key) => allowed.has(key)));
  for (const [key, value] of Object.entries(recipe)) {
    assert.doesNotMatch(key, protectedNames);
    assert.ok(value === '' || typeof value === 'string');
  }
  assert.equal(Object.keys(recipe).some((key) => typeof recipe[key] === 'object'), false);
}

const rpcCalls = [];
const previewSource = {
  listPublished(options) {
    rpcCalls.push(options);
    return { data: { recipes: [cms], hasMore: false, nextOffset: null }, error: null, stale: false };
  },
};
const composed = await createRecipePreviewCatalog({
  builtInPreviews: BUILT_IN_RECIPE_PREVIEWS,
  fictionalPreviews: FICTIONAL_RECIPE_PREVIEWS,
  previewSource,
}).list();
const adapted = adaptDashboardPreviewCatalogResult(composed);
assert.equal(adapted.error, null);
assert.equal(adapted.partial, false);
assert.equal(adapted.stale, false);
assert.equal(adapted.catalog.list().length, 17);
assert.deepEqual(adapted.catalog.list().map((item) => item.id), [
  ...BUILT_IN_RECIPE_PREVIEWS.map((item) => item.id),
  ...FICTIONAL_RECIPE_PREVIEWS.map((item) => item.id),
  cms.id,
]);
assert.equal(rpcCalls.length, 1);
assert.equal(adapted.catalog.getById(cms.id)?.databaseSourceType, 'cms');
assert.equal(adapted.catalog.getById('missing'), null);
assert.equal(adapted.catalog.withRecipes, undefined);
assert.equal(Object.isFrozen(adapted.catalog.list()), true);
for (const recipe of adapted.catalog.list()) assertSafe(recipe);
assert.deepEqual(adapted.databasePage, {
  hasMore: false, nextOffset: null, offset: 0, pageSize: 24,
  continuationAvailable: false, limitReached: false,
});

assert.deepEqual(adapted.catalog.filter('  LENTIL  ').map((item) => item.id), [cms.id]);
assert.deepEqual(adapted.catalog.filter('', '  FILIPINO ').map((item) => item.id), [cms.id]);
assert.deepEqual(adapted.catalog.filter('bright', 'soup').map((item) => item.id), [cms.id]);
assert.deepEqual(adapted.catalog.filter('Bowl A bright').map((item) => item.id), [cms.id]);
assert.deepEqual(adapted.catalog.filter('ingredient-secret'), []);
assert.deepEqual(adapted.catalog.filter('', 'unmatched'), []);
assert.deepEqual(adapted.catalog.filter('\u00a0lentil\u00a0').map((item) => item.id), [cms.id]);
assert.deepEqual(adapted.catalog.filter('x'.repeat(101)), []);
assert.deepEqual(adapted.catalog.filter('', 'x'.repeat(81)), []);
assert.deepEqual(adapted.catalog.filter(null), []);

const saved = adapted.catalog.resolveFavoriteIds(new Set([
  cms.id, 'external:fictional-offline:990001', 'old-unavailable-id',
]));
assert.equal(saved.length, 3);
assert.deepEqual(saved.map((item) => item.id), [
  'external:fictional-offline:990001', cms.id, 'old-unavailable-id',
]);
assert.equal(saved[0].resolved, true);
assert.equal(saved[1].resolved, true);
assert.equal(saved[2].resolved, false);
assert.equal(saved[2].recipe, null);
assertSafe(saved[0].recipe);
assertSafe(saved[1].recipe);
assert.equal(Object.isFrozen(saved), true);
assert.throws(() => adapted.catalog.resolveFavoriteIds(null), /Favorite IDs are invalid/);
const mutableSavedIds = new Set([cms.id]);
const savedSnapshot = adapted.catalog.resolveFavoriteIds(mutableSavedIds);
mutableSavedIds.add('new-unavailable-id');
assert.deepEqual(savedSnapshot.map((item) => item.id), [cms.id]);

const nested = { privateInstructions: 'SECRET DETAIL' };
const hostileRecords = [
  { ...cms, id: 'cms:another', ingredients: [['SECRET', '1']] },
  { ...cms, id: 'cms:nested', description: nested },
  { ...cms, id: 'cms:bad-provider', source: 'external', externalProvider: 'themealdb', externalId: '1', detailLevel: 'full' },
  { ...cms, id: 'external:fictional-offline:123' },
  { ...cms, id: 'cms:missing', description: undefined },
  cms,
  cms,
];
const malformed = adaptDashboardPreviewCatalogResult(page(hostileRecords));
assert.equal(malformed.partial, true);
assert.equal(malformed.error.code, 'PARTIAL');
assert.deepEqual(malformed.catalog.list().map((item) => item.id), [cms.id]);
assert.equal(JSON.stringify(malformed).includes('SECRET DETAIL'), false);
assertSafe(malformed.catalog.getById(cms.id));
const duplicateAcrossSources = adaptDashboardPreviewCatalogResult(page([
  BUILT_IN_RECIPE_PREVIEWS[0],
  { ...cms, id: BUILT_IN_RECIPE_PREVIEWS[0].id },
  FICTIONAL_RECIPE_PREVIEWS[0],
  FICTIONAL_RECIPE_PREVIEWS[0],
]));
assert.equal(duplicateAcrossSources.partial, true);
assert.deepEqual(duplicateAcrossSources.catalog.list().map((item) => item.id), [
  BUILT_IN_RECIPE_PREVIEWS[0].id, FICTIONAL_RECIPE_PREVIEWS[0].id,
]);
assert.equal(duplicateAcrossSources.catalog.getById(BUILT_IN_RECIPE_PREVIEWS[0].id).source, 'built-in');

let getterRuns = 0;
const accessor = Object.defineProperty({ ...cms }, 'name', {
  get() { getterRuns += 1; throw new Error('PRIVATE GETTER DETAIL'); },
});
const revoked = Proxy.revocable({ ...cms }, {});
revoked.revoke();
const oddRecords = adaptDashboardPreviewCatalogResult(page([accessor, revoked.proxy, cms]));
assert.equal(oddRecords.partial, true);
assert.equal(oddRecords.catalog.list().length, 1);
assert.equal(getterRuns, 0);
assert.equal(JSON.stringify(oddRecords).includes('PRIVATE GETTER DETAIL'), false);

const original = { ...cms };
const cloned = adaptDashboardPreviewCatalogResult(page([original]));
original.name = 'Changed after adaptation';
assert.equal(cloned.catalog.getById(cms.id).name, cms.name);
assert.equal(Object.isFrozen(cloned.catalog.getById(cms.id)), true);

const unknown = { hasMore: null, nextOffset: null, offset: null, pageSize: null,
  continuationAvailable: null, limitReached: null };
const failed = adaptDashboardPreviewCatalogResult(page([BUILT_IN_RECIPE_PREVIEWS[0]], unknown,
  { code: 'RAW_SECRET', message: 'provider detail SECRET' }));
assert.equal(failed.partial, true);
assert.equal(failed.error.code, 'PARTIAL');
assert.equal(failed.databasePage.hasMore, null);
assert.equal(failed.catalog.list().length, 1);
assert.equal(JSON.stringify(failed).includes('SECRET'), false);
const rejectedSource = await createRecipePreviewCatalog({
  builtInPreviews: [BUILT_IN_RECIPE_PREVIEWS[0]],
  fictionalPreviews: [],
  previewSource: { async listPublished() { throw new Error('PRIVATE_BACKEND_SECRET'); } },
}).list();
const rejected = adaptDashboardPreviewCatalogResult(rejectedSource);
assert.equal(rejected.partial, true);
assert.deepEqual(rejected.catalog.list().map((item) => item.id), [BUILT_IN_RECIPE_PREVIEWS[0].id]);
assert.equal(rejected.databasePage.hasMore, null);
assert.equal(JSON.stringify(rejected).includes('PRIVATE_BACKEND_SECRET'), false);
assert.equal(adaptDashboardPreviewCatalogResult({ data: null, error: {}, stale: false }).catalog, null);
assert.equal(adaptDashboardPreviewCatalogResult(page([], unknown, null)).catalog, null);
assert.equal(adaptDashboardPreviewCatalogResult({ data: { recipes: [], databasePage: unknown }, error: null, stale: true }).stale, true);

const ceiling = adaptDashboardPreviewCatalogResult(page([cms], {
  hasMore: true, nextOffset: null, offset: 10000, pageSize: 1,
  continuationAvailable: false, limitReached: true,
}, { code: 'UNAVAILABLE', message: 'untrusted provider error' }));
assert.equal(ceiling.partial, true);
assert.equal(ceiling.databasePage.hasMore, true);
assert.equal(ceiling.databasePage.nextOffset, null);
assert.equal(ceiling.databasePage.continuationAvailable, false);
assert.equal(ceiling.databasePage.limitReached, true);
assert.equal(JSON.stringify(ceiling).includes('untrusted'), false);
const continuing = adaptDashboardPreviewCatalogResult(page([cms], {
  hasMore: true, nextOffset: 10000, offset: 9999, pageSize: 1,
  continuationAvailable: true, limitReached: false,
}));
assert.equal(continuing.error, null);
assert.equal(continuing.databasePage.nextOffset, 10000);
assert.equal(adaptDashboardPreviewCatalogResult(page([cms], {
  hasMore: true, nextOffset: 10001, offset: 10000, pageSize: 1,
  continuationAvailable: true, limitReached: false,
})).catalog, null);
assert.equal(adaptDashboardPreviewCatalogResult(page([cms], {
  hasMore: true, nextOffset: 4, offset: 3, pageSize: 2,
  continuationAvailable: true, limitReached: false,
})).catalog, null);

const sparse = [];
sparse.length = 1;
assert.equal(adaptDashboardPreviewCatalogResult(page(sparse)).catalog, null);
assert.equal(adaptDashboardPreviewCatalogResult(page([], { ...unknown, hasMore: true })).catalog, null);
const throwingPage = Object.defineProperty({}, 'recipes', { get() { throw new Error('SECRET'); } });
assert.equal(adaptDashboardPreviewCatalogResult({ data: throwingPage, error: null, stale: false }).catalog, null);

const adapterSource = await readFile(new URL('../js/dashboard-preview-catalog-adapter.js', import.meta.url), 'utf8');
assert.doesNotMatch(adapterSource, /\b(?:fetch|localStorage|sessionStorage|createClient|\.from\s*\(|\.rpc\s*\()/);
assert.doesNotMatch(adapterSource, /(?:from|import\s*\()\s*['"][^'"]*(?:data\.js|fictional-external-recipe-source\.js|supabase-recipe-source\.js)['"]/);
for (const inventory of [PRODUCTION_OUTPUT_FILES, ADMIN_PREVIEW_OUTPUT_FILES]) {
  assert.equal(inventory.includes('js/dashboard-preview-catalog-adapter.js'), false);
}
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
const activeApp = await readFile(new URL('../app.js', import.meta.url), 'utf8');
assert.equal(activeApp.includes('dashboard-preview-catalog-adapter.js'), false);

console.log('Inactive dashboard preview catalog adapter contracts passed with safe fake preview data.');
