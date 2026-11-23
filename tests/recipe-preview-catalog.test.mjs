import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUILT_IN_RECIPE_PREVIEWS,
  FICTIONAL_RECIPE_PREVIEWS,
} from '../js/recipe-previews.js';
import { createRecipePreviewCatalog } from '../js/recipe-preview-catalog.js';
import { createPublishedRecipePreviewService } from '../js/supabase-recipe-previews.js';
import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const INACTIVE_MODULE = 'js/recipe-preview-catalog.js';
const PROTECTED_FIELDS = [
  'ingredients', 'instructions', 'tutorial', 'tutorialUrl', 'tutorial_url',
  'createdBy', 'created_by', 'creator', 'internalNotes', 'internal_notes',
];

function databasePreview(overrides = {}) {
  return {
    id: 'cms:11111111-2222-4333-8444-555555555555',
    name: 'CMS Lentil Stew',
    category: 'Soup',
    cuisine: 'Filipino',
    image: 'assets/beef-stew.png',
    fallbackImage: '',
    description: 'A safe public summary.',
    source: 'database',
    databaseSourceType: 'cms',
    detailLevel: 'preview',
    ...overrides,
  };
}

function databaseRpcRow(id) {
  return {
    id,
    name: `Database ${id}`,
    description: 'Safe preview description.',
    category: 'Soup',
    cuisine: 'Filipino',
    image_url: 'assets/beef-stew.png',
    fallback_image_url: null,
    source_type: 'seed',
    external_provider: null,
    external_id: null,
  };
}

function rpcResult(recipes = [], { hasMore = false, nextOffset = null } = {}) {
  return Object.freeze({
    data: Object.freeze({
      recipes: Object.freeze(recipes),
      hasMore,
      nextOffset,
    }),
    error: null,
    stale: false,
  });
}

function sourceFor(resultOrFactory) {
  const calls = [];
  return {
    calls,
    source: {
      async listPublished(options) {
        calls.push(options);
        return typeof resultOrFactory === 'function'
          ? resultOrFactory(options)
          : resultOrFactory;
      },
    },
  };
}

function createCatalog({ builtInPreviews = [], fictionalPreviews = [], previewSource }) {
  return createRecipePreviewCatalog({ builtInPreviews, fictionalPreviews, previewSource });
}

const localOnlySource = sourceFor(rpcResult());
const localOnly = await createCatalog({
  builtInPreviews: BUILT_IN_RECIPE_PREVIEWS,
  fictionalPreviews: FICTIONAL_RECIPE_PREVIEWS,
  previewSource: localOnlySource.source,
}).list();
assert.equal(localOnly.error, null);
assert.equal(localOnly.stale, false);
assert.equal(localOnly.data.recipes.length, 16);
assert.deepEqual(
  localOnly.data.recipes.slice(0, BUILT_IN_RECIPE_PREVIEWS.length).map(({ id }) => id),
  BUILT_IN_RECIPE_PREVIEWS.map(({ id }) => id),
);
assert.deepEqual(
  localOnly.data.recipes.slice(BUILT_IN_RECIPE_PREVIEWS.length).map(({ id }) => id),
  FICTIONAL_RECIPE_PREVIEWS.map(({ id }) => id),
);

for (const recipe of localOnly.data.recipes) {
  assert.equal(Object.isFrozen(recipe), true);
  for (const field of PROTECTED_FIELDS) assert.equal(Object.hasOwn(recipe, field), false);
}
assert.equal(Object.isFrozen(localOnly.data), true);
assert.equal(Object.isFrozen(localOnly.data.recipes), true);
assert.deepEqual(localOnly.data.databasePage, {
  hasMore: false,
  nextOffset: null,
  offset: 0,
  pageSize: 24,
  continuationAvailable: false,
  limitReached: false,
});

const emptySource = sourceFor(rpcResult());
const emptyCatalog = await createCatalog({
  builtInPreviews: [],
  fictionalPreviews: [],
  previewSource: emptySource.source,
}).list();
assert.equal(emptyCatalog.error, null);
assert.deepEqual(emptyCatalog.data.recipes, []);
assert.equal(emptyCatalog.data.databasePage.hasMore, false);

const dbSource = sourceFor(rpcResult([
  databasePreview(),
  databasePreview({ id: 'seed-adobo', name: 'Seed Adobo', databaseSourceType: 'seed' }),
]));
const withDatabase = await createCatalog({
  builtInPreviews: [BUILT_IN_RECIPE_PREVIEWS[0]],
  fictionalPreviews: [FICTIONAL_RECIPE_PREVIEWS[0]],
  previewSource: dbSource.source,
}).list();
assert.equal(withDatabase.error, null);
assert.deepEqual(withDatabase.data.recipes.map(({ id }) => id), [
  'creamy-garlic-pasta',
  'external:fictional-offline:990001',
  'cms:11111111-2222-4333-8444-555555555555',
  'seed-adobo',
]);
assert.equal(withDatabase.data.recipes[2].source, 'database');
assert.equal(withDatabase.data.recipes[2].detailLevel, 'preview');
assert.equal(Object.hasOwn(withDatabase.data.recipes[2], 'instructions'), false);

const filteredSource = sourceFor(rpcResult([databasePreview({
  id: 'cms:33333333-2222-4333-8444-555555555555',
  name: 'Aurora Garden Plate',
  category: 'Vegetarian',
  cuisine: 'Mediterranean',
})]));
const filtered = await createCatalog({
  builtInPreviews: BUILT_IN_RECIPE_PREVIEWS,
  fictionalPreviews: FICTIONAL_RECIPE_PREVIEWS,
  previewSource: filteredSource.source,
}).list({ search: '  AURORA  ', filter: '  mediterranean ', pageSize: 3, offset: 9 });
assert.equal(filtered.error, null);
assert.deepEqual(filtered.data.recipes.map(({ id }) => id), [
  'external:fictional-offline:990001',
  'cms:33333333-2222-4333-8444-555555555555',
]);
assert.deepEqual(filteredSource.calls, [{ search: 'AURORA', filter: 'mediterranean', pageSize: 3, offset: 9 }]);

const searchSource = sourceFor(rpcResult([databasePreview({ name: 'Pasta Supper', category: 'Pasta' })]));
const searched = await createCatalog({
  builtInPreviews: BUILT_IN_RECIPE_PREVIEWS,
  fictionalPreviews: FICTIONAL_RECIPE_PREVIEWS,
  previewSource: searchSource.source,
}).list({ search: 'pasta' });
assert.ok(searched.data.recipes.some(({ id }) => id === 'creamy-garlic-pasta'));
assert.ok(searched.data.recipes.some(({ id }) => id.startsWith('cms:')));
assert.equal(searched.data.recipes.some(({ id }) => id === 'lemon-chicken'), false);

const paginationSource = sourceFor(rpcResult(
  [databasePreview()],
  { hasMore: true, nextOffset: 7 },
));
const paginated = await createCatalog({
  builtInPreviews: [],
  fictionalPreviews: [],
  previewSource: paginationSource.source,
}).list({ pageSize: 1, offset: 6 });
assert.deepEqual(paginated.data.databasePage, {
  hasMore: true,
  nextOffset: 7,
  offset: 6,
  pageSize: 1,
  continuationAvailable: true,
  limitReached: false,
});
assert.equal(paginated.data.recipes.length, 1);

const boundaryCalls = [];
const boundaryPreviewService = createPublishedRecipePreviewService({
  async rpc(_name, args) {
    boundaryCalls.push(args);
    return {
      data: [databaseRpcRow('seed-boundary-a'), databaseRpcRow('seed-boundary-b')],
      error: null,
    };
  },
});
const inRangeBoundaryCatalog = createCatalog({
  builtInPreviews: [],
  fictionalPreviews: [],
  previewSource: boundaryPreviewService,
});
const inRangeBoundaryPage = await inRangeBoundaryCatalog.list({ pageSize: 1, offset: 9999 });
assert.equal(inRangeBoundaryPage.error, null);
assert.deepEqual(inRangeBoundaryPage.data.databasePage, {
  hasMore: true,
  nextOffset: 10000,
  offset: 9999,
  pageSize: 1,
  continuationAvailable: true,
  limitReached: false,
});

const boundaryCatalog = createCatalog({
  builtInPreviews: [],
  fictionalPreviews: [],
  previewSource: boundaryPreviewService,
});
const ceilingPage = await boundaryCatalog.list({ pageSize: 1, offset: 10000 });
assert.equal(ceilingPage.error.code, 'UNAVAILABLE');
assert.deepEqual(ceilingPage.data.recipes.map(({ id }) => id), ['seed-boundary-a']);
assert.deepEqual(ceilingPage.data.databasePage, {
  hasMore: true,
  nextOffset: null,
  offset: 10000,
  pageSize: 1,
  continuationAvailable: false,
  limitReached: true,
});
assert.equal(boundaryCalls.length, 2);
assert.deepEqual(boundaryCalls[1], {
  p_search: null,
  p_filter: null,
  p_limit: 2,
  p_offset: 10000,
});
const rejectedFollowup = await boundaryCatalog.list({ pageSize: 1, offset: 10001 });
assert.equal(rejectedFollowup.error.code, 'INVALID_INPUT');
assert.equal(boundaryCalls.length, 2, 'Unsupported continuation offsets must not reach the source');

const malformedPageSource = sourceFor(rpcResult(
  [databasePreview()],
  { hasMore: true, nextOffset: 90 },
));
const malformedPage = await createCatalog({
  builtInPreviews: [BUILT_IN_RECIPE_PREVIEWS[0]],
  fictionalPreviews: [],
  previewSource: malformedPageSource.source,
}).list({ pageSize: 1, offset: 6 });
assert.equal(malformedPage.error.code, 'UNAVAILABLE');
assert.deepEqual(malformedPage.data.recipes.map(({ id }) => id), ['creamy-garlic-pasta']);
assert.deepEqual(malformedPage.data.databasePage, {
  hasMore: null,
  nextOffset: null,
  offset: null,
  pageSize: null,
  continuationAvailable: null,
  limitReached: null,
});

const badRecords = [
  databasePreview({ id: 'external:themealdb:123', databaseSourceType: 'external' }),
  databasePreview({ source: 'external', externalProvider: 'other' }),
  databasePreview({ source: 'external', externalProvider: 'themealdb', externalId: '123' }),
  databasePreview({ instructions: 'protected text' }),
  databasePreview({ tutorial_url: 'https://private.example.test' }),
  databasePreview({ databaseSourceType: 'external' }),
  { ...databasePreview(), get name() { throw new Error('sensitive provider text'); } },
];
const hostileDbSource = sourceFor(rpcResult([
  ...badRecords,
  databasePreview({ id: 'cms:22222222-2222-4333-8444-555555555555', name: 'Valid CMS Preview' }),
]));
const hostileRows = await createCatalog({
  builtInPreviews: [],
  fictionalPreviews: [],
  previewSource: hostileDbSource.source,
}).list();
assert.equal(hostileRows.error, null);
assert.deepEqual(hostileRows.data.recipes.map(({ name }) => name), ['Valid CMS Preview']);
assert.doesNotMatch(JSON.stringify(hostileRows), /sensitive provider text|protected text/);

const revokedStatic = Proxy.revocable({}, {});
revokedStatic.revoke();
const revokedStaticResult = await createCatalog({
  builtInPreviews: [revokedStatic.proxy, BUILT_IN_RECIPE_PREVIEWS[0]],
  fictionalPreviews: [],
  previewSource: sourceFor(rpcResult()).source,
}).list();
assert.equal(revokedStaticResult.error, null);
assert.deepEqual(revokedStaticResult.data.recipes.map(({ id }) => id), ['creamy-garlic-pasta']);

const revokedRpc = Proxy.revocable({}, {});
revokedRpc.revoke();
const revokedRpcResult = await createCatalog({
  builtInPreviews: [],
  fictionalPreviews: [],
  previewSource: sourceFor(rpcResult([
    revokedRpc.proxy,
    databasePreview({ id: 'seed-after-revoked-proxy', databaseSourceType: 'seed' }),
  ])).source,
}).list();
assert.equal(revokedRpcResult.error, null);
assert.deepEqual(revokedRpcResult.data.recipes.map(({ id }) => id), ['seed-after-revoked-proxy']);

const duplicateSource = sourceFor(rpcResult([
  databasePreview({ id: 'creamy-garlic-pasta', name: 'Conflicting duplicate' }),
  databasePreview({ id: 'seed-adobo', name: 'First seed', databaseSourceType: 'seed' }),
  databasePreview({ id: 'seed-adobo', name: 'Second seed', databaseSourceType: 'seed' }),
]));
const duplicates = await createCatalog({
  builtInPreviews: [BUILT_IN_RECIPE_PREVIEWS[0]],
  fictionalPreviews: [],
  previewSource: duplicateSource.source,
}).list();
assert.deepEqual(duplicates.data.recipes.map(({ id }) => id), ['creamy-garlic-pasta', 'seed-adobo']);
assert.equal(duplicates.data.recipes[0].name, BUILT_IN_RECIPE_PREVIEWS[0].name);
assert.equal(duplicates.data.recipes[1].name, 'First seed');

const failingSource = sourceFor(async () => { throw new Error('raw provider secret'); });
const sourceFailure = await createCatalog({
  builtInPreviews: [BUILT_IN_RECIPE_PREVIEWS[0]],
  fictionalPreviews: [FICTIONAL_RECIPE_PREVIEWS[0]],
  previewSource: failingSource.source,
}).list();
assert.equal(sourceFailure.error.code, 'UNAVAILABLE');
assert.deepEqual(sourceFailure.data.recipes.map(({ id }) => id), [
  'creamy-garlic-pasta', 'external:fictional-offline:990001',
]);
assert.equal(sourceFailure.data.databasePage.hasMore, null);
assert.doesNotMatch(JSON.stringify(sourceFailure), /raw provider secret/);

const staleSource = sourceFor(Object.freeze({ data: null, error: { code: 'STALE' }, stale: true }));
const stale = await createCatalog({ builtInPreviews: [BUILT_IN_RECIPE_PREVIEWS[0]], previewSource: staleSource.source }).list();
assert.equal(stale.stale, true);
assert.equal(stale.error.code, 'STALE');
assert.equal(stale.data.recipes.length, 1);

for (const invalidOptions of [
  null,
  { search: null },
  { search: 'x'.repeat(101) },
  { filter: 'x'.repeat(81) },
  { pageSize: 0 },
  { pageSize: 51 },
  { offset: -1 },
  { offset: 10001 },
]) {
  const noCallSource = sourceFor(rpcResult());
  const invalid = await createCatalog({ previewSource: noCallSource.source }).list(invalidOptions);
  assert.equal(invalid.error.code, 'INVALID_INPUT');
  assert.equal(noCallSource.calls.length, 0);
}

const noDetailsSource = sourceFor(rpcResult());
const noDetails = await createCatalog({
  builtInPreviews: [{ ...BUILT_IN_RECIPE_PREVIEWS[0], ingredients: [['secret', '1']] }],
  fictionalPreviews: [],
  previewSource: noDetailsSource.source,
}).list();
assert.deepEqual(noDetails.data.recipes, []);
assert.equal(noDetails.error, null);

assert.throws(() => createRecipePreviewCatalog({ previewSource: {} }), /dependencies are invalid/);

const appSource = await readFile(resolve(ROOT, 'app.js'), 'utf8');
const indexSource = await readFile(resolve(ROOT, 'index.html'), 'utf8');
assert.doesNotMatch(appSource, /recipe-preview-catalog\.js/);
assert.doesNotMatch(indexSource, /recipe-preview-catalog\.js/);
assert.equal(PRODUCTION_OUTPUT_FILES.includes(INACTIVE_MODULE), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes(INACTIVE_MODULE), false);
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 59);

console.log('recipe-preview-catalog: offline composition contracts passed');
