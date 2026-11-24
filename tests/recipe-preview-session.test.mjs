import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRecipePreviewSession } from '../js/recipe-preview-session.js';
import { BUILT_IN_RECIPE_PREVIEWS, FICTIONAL_RECIPE_PREVIEWS } from '../js/recipe-previews.js';
import { RECIPE_DETAIL_RESULT } from '../js/recipe-detail-access-controller.js';
import { PRODUCTION_OUTPUT_FILES, ADMIN_PREVIEW_OUTPUT_FILES } from '../scripts/build-vercel-static.mjs';

const USER_A = '123e4567-e89b-42d3-a456-426614174000';
const USER_B = '223e4567-e89b-42d3-a456-426614174000';
const cms = Object.freeze({
  id: 'cms:11111111-2222-4333-8444-555555555555',
  name: 'Safe CMS Preview', description: 'Public metadata only',
  category: 'Vegetarian', cuisine: 'Filipino', image: 'assets/recipefinder-favicon.svg',
  fallbackImage: '', source: 'database', databaseSourceType: 'cms', detailLevel: 'preview',
});
const page = (recipes = [cms]) => ({ data: { recipes, hasMore: false, nextOffset: null }, error: null, stale: false });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const fullDetail = (id, sourceType = 'seed') => Object.freeze({
  id, source: 'database', databaseSourceType: sourceType,
  name: 'Protected detail', category: 'Pasta', cuisine: 'Italian',
  image: 'assets/recipefinder-favicon.svg', fallbackImage: '', description: 'Protected description',
  ingredients: Object.freeze([Object.freeze(['Secret ingredient', '1 cup'])]),
  instructions: 'Secret instructions', tutorial: '',
});
const mealDb = Object.freeze({
  id: 'external:themealdb:52772', source: 'external', externalProvider: 'themealdb',
  externalId: '52772', detailLevel: 'full', name: 'Public MealDB Recipe',
  category: 'Chicken', cuisine: 'Japanese', image: 'assets/recipefinder-favicon.svg',
  description: 'Public recipe', ingredients: Object.freeze([Object.freeze(['Chicken', '1 cup'])]),
  instructions: 'Cook.', tutorial: '',
});

function fixture({ previewResult = page(), detailResult } = {}) {
  const calls = { previews: [], details: [], gates: 0, clears: 0, invalidations: 0 };
  const previewSource = {
    listPublished(options) { calls.previews.push(options); return previewResult; },
    invalidate() { calls.invalidations += 1; },
    cleanup() {},
  };
  const detailService = {
    getPublishedById(id, auth) {
      calls.details.push({ id, auth });
      return detailResult ?? { data: fullDetail(id, id.startsWith('cms:') ? 'cms' : 'seed'), error: null, stale: false };
    },
    invalidate() { calls.invalidations += 1; },
    cleanup() {},
  };
  const loginGate = {
    open() { calls.gates += 1; return true; },
    close() {}, cleanup() {},
  };
  return { calls, session: createRecipePreviewSession({
    builtInPreviews: BUILT_IN_RECIPE_PREVIEWS,
    fictionalPreviews: FICTIONAL_RECIPE_PREVIEWS,
    previewSource, detailService, loginGate,
    clearProtectedDetail() { calls.clears += 1; },
  }) };
}

const { session, calls } = fixture();
assert.equal(session.getCatalog(), null);
const loaded = await session.load();
assert.equal(loaded.error, null);
assert.equal(loaded.catalog.list().length, 17);
assert.deepEqual(loaded.catalog.list().slice(0, 2).map(({ id }) => id), ['creamy-garlic-pasta', 'lemon-chicken']);
assert.equal(loaded.catalog.getById(cms.id)?.databaseSourceType, 'cms');
for (const recipe of loaded.catalog.list()) {
  for (const protectedField of ['ingredients', 'instructions', 'tutorial', 'tutorial_url']) {
    assert.equal(Object.hasOwn(recipe, protectedField), false);
  }
}
assert.equal(session.filter('secret ingredient').length, 0, 'Search cannot inspect protected ingredients');
assert.equal(session.filter('', 'fIlIpInO').length, 1);
assert.equal(session.random(0)?.id, 'creamy-garlic-pasta');
assert.equal(session.random(17), null);
assert.deepEqual(session.resolveFavoriteIds(['creamy-garlic-pasta', 'missing']).map(({ resolved }) => resolved), [true, false]);
session.handleAuthState({ status: 'guest' });
assert.equal((await session.requestRecipeFinderDetail('creamy-garlic-pasta')).status, RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);
assert.equal((await session.requestRecipeFinderDetail('external:fictional-offline:990001')).status, RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);
assert.equal((await session.requestRecipeFinderDetail(cms.id)).status, RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);
assert.equal((await session.requestRecipeFinderPreviewDetail(loaded.catalog.getById(cms.id))).status,
  RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);
assert.equal(calls.details.length, 0, 'Guest recipe requests must never call the detail service');
assert.equal(calls.gates, 4);
assert.equal(session.dismissDetail(), true);
assert.equal(session.getCatalog(), loaded.catalog, 'Dismissing a gate must preserve public previews');
assert.equal((await session.requestRecipeFinderDetail('creamy-garlic-pasta')).status,
  RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);

// A real gate refuses a second prompt until dismissal. Closing the dialog must
// retire that gate without discarding the public preview catalog.
let gateActive = false;
const lifecycle = createRecipePreviewSession({
  builtInPreviews: BUILT_IN_RECIPE_PREVIEWS,
  fictionalPreviews: FICTIONAL_RECIPE_PREVIEWS,
  previewSource: { listPublished: () => page(), invalidate() {}, cleanup() {} },
  detailService: { getPublishedById: () => { throw new Error('Guest detail request'); }, invalidate() {}, cleanup() {} },
  loginGate: {
    open() { if (gateActive) return false; gateActive = true; return true; },
    close() { const previous = gateActive; gateActive = false; return previous; },
    cleanup() { gateActive = false; },
  },
  clearProtectedDetail() {},
});
await lifecycle.load();
lifecycle.handleAuthState({ status: 'guest' });
assert.equal((await lifecycle.requestRecipeFinderDetail('creamy-garlic-pasta')).status,
  RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);
assert.equal(gateActive, true);
assert.equal(lifecycle.dismissDetail(), true);
assert.equal(gateActive, false);
assert.equal(lifecycle.getCatalog()?.getById('creamy-garlic-pasta')?.id, 'creamy-garlic-pasta');
assert.equal((await lifecycle.requestRecipeFinderDetail('creamy-garlic-pasta')).status,
  RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);
assert.equal(gateActive, true);
lifecycle.cleanup();
assert.equal((await session.requestPublicMealDbDetail(mealDb)).status, RECIPE_DETAIL_RESULT.PUBLIC_EXTERNAL_DETAIL);
assert.equal((await session.requestRecipeFinderDetail('missing')).status, RECIPE_DETAIL_RESULT.UNAVAILABLE);

session.handleAuthState({ status: 'authenticated', userId: USER_A });
const builtInDetail = await session.requestRecipeFinderDetail('creamy-garlic-pasta');
assert.equal(builtInDetail.status, RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
assert.equal(builtInDetail.data.ingredients[0][0], 'Secret ingredient');
assert.equal((await session.requestRecipeFinderDetail(cms.id)).status, RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
assert.equal((await session.requestRecipeFinderPreviewDetail(loaded.catalog.getById(cms.id))).status,
  RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
assert.equal(calls.details.length, 3);

const pendingDetail = deferred();
const switching = fixture({ detailResult: pendingDetail.promise });
await switching.session.load();
switching.session.handleAuthState({ status: 'authenticated', userId: USER_A });
const oldDetail = switching.session.requestRecipeFinderDetail('creamy-garlic-pasta');
switching.session.handleAuthState({ status: 'authenticated', userId: USER_B });
pendingDetail.resolve({ data: fullDetail('creamy-garlic-pasta'), error: null, stale: false });
assert.equal((await oldDetail).status, RECIPE_DETAIL_RESULT.STALE);
assert.equal(switching.calls.clears > 0, true);
switching.session.handleAuthState({ status: 'guest' });
assert.equal((await switching.session.requestRecipeFinderDetail('creamy-garlic-pasta')).status, RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);

const failed = fixture({ previewResult: Promise.reject(new Error('private backend detail')) });
const partial = await failed.session.load();
assert.equal(partial.partial, true);
assert.equal(partial.catalog.list().length, 16, 'Only safe static previews remain after RPC failure');
assert.equal(JSON.stringify(partial).includes('private backend detail'), false);

const malformed = fixture({ previewResult: page([
  { ...cms, ingredients: [['Do not reveal', '1 cup']] },
  { ...cms, id: 'creamy-garlic-pasta' },
]) });
const rejectedRows = await malformed.session.load();
assert.equal(rejectedRows.catalog.list().length, 16);
assert.equal(JSON.stringify(rejectedRows.catalog.list()).includes('Do not reveal'), false);

const pendingPage = deferred();
const overlapping = fixture({ previewResult: pendingPage.promise });
const staleLoad = overlapping.session.load();
overlapping.session.invalidate();
pendingPage.resolve(page());
assert.equal((await staleLoad).stale, true);
assert.equal(overlapping.session.getCatalog(), null);
overlapping.session.cleanup();
assert.equal((await overlapping.session.load()).stale, true);

const source = await readFile(new URL('../js/recipe-preview-session.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /(?:from|import\()\s*['"](?:\.\/)?(?:data|recipe-catalog|fictional-external-recipe-source|supabase-recipe-source)\.js/);
for (const inventory of [PRODUCTION_OUTPUT_FILES, ADMIN_PREVIEW_OUTPUT_FILES]) {
  assert.equal(inventory.includes('js/recipe-preview-session.js'), false);
}
for (const file of ['app.js', 'index.html', 'js/render.js']) {
  const active = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.equal(active.includes('recipe-preview-session'), false);
}
console.log('Inactive preview session integration passed with fake sources only.');
