import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recipes as builtInRecipes } from '../js/data.js';
import { recipeCatalog } from '../js/recipe-catalog.js';
import { composePublishedRecipeCatalog } from '../js/recipe-catalog-composition.js';
import { createPublishedRecipeSource } from '../js/supabase-recipe-source.js';

function databaseRecipe(overrides = {}) {
  return {
    id: 'database-only-recipe',
    source: 'database',
    databaseSourceType: 'cms',
    name: 'Database Only Recipe',
    category: 'Vegetarian',
    cuisine: 'Mediterranean',
    image: 'assets/database-only-recipe.png',
    fallbackImage: '',
    description: 'A validated database recipe.',
    ingredients: [['Ingredient', '1 cup']],
    instructions: 'Prepare and serve.',
    tutorial: '',
    ...overrides,
  };
}

const originalIds = recipeCatalog.list().map(({ id }) => id);
const originalFirstName = recipeCatalog.list()[0].name;

const selected = composePublishedRecipeCatalog({
  data: [databaseRecipe()],
  error: null,
});
assert.equal(selected.origin, 'database');
assert.equal(selected.databaseStatus, 'success');
assert.deepEqual(selected.catalog.list().map(({ id }) => id), ['database-only-recipe']);
assert.equal(selected.catalog.getById('database-only-recipe')?.name, 'Database Only Recipe');
assert.deepEqual(selected.catalog.filter('ingredient', '').map(({ id }) => id), ['database-only-recipe']);
assert.deepEqual(selected.catalog.filter('', 'Vegetarian').map(({ id }) => id), ['database-only-recipe']);
assert.ok(Object.isFrozen(selected));
assert.ok(Object.isFrozen(selected.catalog));
assert.ok(Object.isFrozen(selected.catalog.list()));
assert.ok(Object.isFrozen(selected.catalog.list()[0]));
assert.ok(Object.isFrozen(selected.catalog.list()[0].ingredients));

const mutableInput = databaseRecipe();
const immutableSelection = composePublishedRecipeCatalog({ data: [mutableInput], error: null });
mutableInput.name = 'Changed after composition';
mutableInput.ingredients[0][0] = 'Changed ingredient';
assert.equal(immutableSelection.catalog.getById('database-only-recipe')?.name, 'Database Only Recipe');
assert.equal(immutableSelection.catalog.getById('database-only-recipe')?.ingredients[0][0], 'Ingredient');

const overlappingId = builtInRecipes[0].id;
const replacement = composePublishedRecipeCatalog({
  data: [databaseRecipe({ id: overlappingId, name: 'Authoritative Database Version' })],
  error: null,
});
assert.equal(replacement.origin, 'database');
assert.equal(replacement.catalog.list().length, 1);
assert.equal(replacement.catalog.getById(overlappingId)?.name, 'Authoritative Database Version');
assert.equal(replacement.catalog.getById('database-only-recipe'), null);

const empty = composePublishedRecipeCatalog({ data: [], error: null });
assert.equal(empty.origin, 'database');
assert.equal(empty.databaseStatus, 'success');
assert.deepEqual(empty.catalog.list(), []);
assert.notEqual(empty.catalog, recipeCatalog);

const originalDefect = composePublishedRecipeCatalog({
  data: [{ id: 'incomplete', source: 'database', databaseSourceType: 'cms' }],
  error: null,
});
assert.equal(originalDefect.catalog, recipeCatalog);
assert.equal(originalDefect.origin, 'built-in');
assert.equal(originalDefect.databaseStatus, 'invalid');

for (const missingField of [
  'name',
  'description',
  'category',
  'cuisine',
  'image',
  'ingredients',
  'instructions',
]) {
  const incompleteRecipe = databaseRecipe();
  delete incompleteRecipe[missingField];
  const incompleteResult = composePublishedRecipeCatalog({ data: [incompleteRecipe], error: null });
  assert.equal(incompleteResult.catalog, recipeCatalog, `${missingField} must be required`);
  assert.equal(incompleteResult.databaseStatus, 'invalid');
}

for (const [sourceResult, expectedStatus] of [
  [undefined, 'missing'],
  [null, 'missing'],
  [{}, 'invalid'],
  [[], 'invalid'],
  [{ data: [], error: undefined }, 'invalid'],
  [{ data: null, error: null }, 'invalid'],
  [{ data: {}, error: null }, 'invalid'],
  [{ data: [databaseRecipe()], error: { message: 'PRIVATE_PROVIDER_ERROR' } }, 'failed'],
  [{ data: [databaseRecipe(), databaseRecipe()], error: null }, 'invalid'],
  [{ data: [databaseRecipe({ source: 'external' })], error: null }, 'invalid'],
  [{ data: [databaseRecipe({ databaseSourceType: 'unknown' })], error: null }, 'invalid'],
  [{ data: [databaseRecipe({
    databaseSourceType: 'external',
    externalProvider: '',
    externalId: '42',
  })], error: null }, 'invalid'],
  [{ data: [databaseRecipe({ externalProvider: 'unexpected' })], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), id: '' }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), id: 'UPPERCASE' }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), name: undefined }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), description: null }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), category: '' }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), cuisine: 7 }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), image: undefined }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), ingredients: null }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), instructions: '   ' }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), ingredients: [] }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), ingredients: [['Salt']] }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), ingredients: [['Salt', '1 tsp', 'extra']] }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), ingredients: [['Salt', 1]] }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), ingredients: [['Salt', '']] }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), image: 'javascript:alert(1)' }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), image: '../assets/traversal.png' }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), fallbackImage: 'data:text/html,unsafe' }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), tutorial: 'http://example.test/tutorial' }], error: null }, 'invalid'],
  [{ data: [{ ...databaseRecipe(), tutorial: 'javascript:alert(1)' }], error: null }, 'invalid'],
]) {
  const result = composePublishedRecipeCatalog(sourceResult);
  assert.equal(result.catalog, recipeCatalog);
  assert.equal(result.origin, 'built-in');
  assert.equal(result.databaseStatus, expectedStatus);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_ERROR/);
}

const hostile = new Proxy({}, {
  getOwnPropertyDescriptor() {
    throw new Error('PRIVATE_PROXY_ERROR');
  },
});
const hostileResult = composePublishedRecipeCatalog(hostile);
assert.equal(hostileResult.catalog, recipeCatalog);
assert.equal(hostileResult.databaseStatus, 'invalid');

const hostileRecipe = new Proxy(databaseRecipe(), {
  get(target, property, receiver) {
    if (property === 'name') throw new Error('PRIVATE_RECIPE_GETTER_ERROR');
    return Reflect.get(target, property, receiver);
  },
});
const hostileRecipeResult = composePublishedRecipeCatalog({ data: [hostileRecipe], error: null });
assert.equal(hostileRecipeResult.catalog, recipeCatalog);
assert.equal(hostileRecipeResult.databaseStatus, 'invalid');
assert.doesNotMatch(JSON.stringify(hostileRecipeResult), /PRIVATE_RECIPE_GETTER_ERROR/);

const overriddenMapRecipes = [databaseRecipe()];
overriddenMapRecipes.map = () => [{
  id: 'incomplete-bypass',
  source: 'database',
  databaseSourceType: 'cms',
}];
const overriddenMapSelection = composePublishedRecipeCatalog({
  data: overriddenMapRecipes,
  error: null,
});
assert.equal(overriddenMapSelection.catalog, recipeCatalog);
assert.equal(overriddenMapSelection.origin, 'built-in');
assert.equal(overriddenMapSelection.databaseStatus, 'invalid');

const emptyOverriddenMapRecipes = [];
emptyOverriddenMapRecipes.map = () => [{
  id: 'incomplete-bypass',
  source: 'database',
  databaseSourceType: 'cms',
}];
const emptyOverriddenMapSelection = composePublishedRecipeCatalog({
  data: emptyOverriddenMapRecipes,
  error: null,
});
assert.equal(emptyOverriddenMapSelection.catalog, recipeCatalog);
assert.equal(emptyOverriddenMapSelection.databaseStatus, 'invalid');

const duplicateBypassRecipes = [databaseRecipe(), databaseRecipe()];
duplicateBypassRecipes.map = () => [databaseRecipe(), databaseRecipe({ id: 'different-id' })];
const duplicateBypassSelection = composePublishedRecipeCatalog({
  data: duplicateBypassRecipes,
  error: null,
});
assert.equal(duplicateBypassSelection.catalog, recipeCatalog);
assert.equal(duplicateBypassSelection.databaseStatus, 'invalid');

const sparseRecipes = new Array(1);
const sparseSelection = composePublishedRecipeCatalog({ data: sparseRecipes, error: null });
assert.equal(sparseSelection.catalog, recipeCatalog);
assert.equal(sparseSelection.databaseStatus, 'invalid');

const hostileIndexedRecipes = [];
Object.defineProperty(hostileIndexedRecipes, 0, {
  configurable: true,
  enumerable: true,
  get() { throw new Error('PRIVATE_INDEX_ERROR'); },
});
hostileIndexedRecipes.length = 1;
const hostileIndexedSelection = composePublishedRecipeCatalog({
  data: hostileIndexedRecipes,
  error: null,
});
assert.equal(hostileIndexedSelection.catalog, recipeCatalog);
assert.equal(hostileIndexedSelection.databaseStatus, 'invalid');

const malformedIngredientArray = [['Salt']];
malformedIngredientArray.map = () => [['Salt', '1 tsp']];
const malformedIngredientSelection = composePublishedRecipeCatalog({
  data: [databaseRecipe({ ingredients: malformedIngredientArray })],
  error: null,
});
assert.equal(malformedIngredientSelection.catalog, recipeCatalog);
assert.equal(malformedIngredientSelection.databaseStatus, 'invalid');

let ingredientNameReads = 0;
const changingTuple = [];
Object.defineProperty(changingTuple, 0, {
  configurable: true,
  enumerable: true,
  get() {
    ingredientNameReads += 1;
    return ingredientNameReads === 1 ? 'Salt' : '';
  },
});
changingTuple[1] = '1 tsp';
const changingTupleSelection = composePublishedRecipeCatalog({
  data: [databaseRecipe({ ingredients: [changingTuple] })],
  error: null,
});
assert.equal(changingTupleSelection.origin, 'database');
assert.equal(changingTupleSelection.catalog.list()[0].ingredients[0][0], 'Salt');
assert.equal(ingredientNameReads, 1);

assert.deepEqual(recipeCatalog.list().map(({ id }) => id), originalIds);
assert.equal(recipeCatalog.list()[0].name, originalFirstName);

const externalDatabaseRecipe = databaseRecipe({
  id: 'external:curated:42',
  databaseSourceType: 'external',
  externalProvider: 'curated-provider',
  externalId: '42',
});
const externalSelection = composePublishedRecipeCatalog({ data: [externalDatabaseRecipe], error: null });
assert.equal(externalSelection.catalog.getById(externalDatabaseRecipe.id)?.source, 'database');
assert.notEqual(externalSelection.catalog.getById(externalDatabaseRecipe.id)?.source, 'external');

const sourceRows = [
  {
    id: 'seed-pipeline-recipe',
    name: 'Seed Pipeline Recipe',
    description: 'A seed-shaped recipe normalized through the source.',
    image_url: 'assets/beef-stew.png',
    fallback_image_url: null,
    tutorial_url: 'https://example.test/tutorial',
    ingredients: [{ name: 'Ingredient', measurement: '1 cup' }],
    instructions: 'Prepare and serve.',
    status: 'published',
    source_type: 'seed',
    external_provider: null,
    external_id: null,
    category: { name: 'Beef' },
    cuisine: { name: 'British' },
  },
  {
    id: 'external:curated:84',
    name: 'Curated Pipeline Recipe',
    description: 'A curated external recipe stored in the database.',
    image_url: 'https://example.test/curated.jpg',
    fallback_image_url: null,
    tutorial_url: null,
    ingredients: [{ name: 'Ingredient', measurement: '2 cups' }],
    instructions: 'Prepare the curated recipe.',
    status: 'published',
    source_type: 'external',
    external_provider: 'curated-provider',
    external_id: '84',
    category: { name: 'Seafood' },
    cuisine: { name: 'Japanese' },
  },
];
const pipelineQuery = {
  select() { return this; },
  eq() { return this; },
  order() { return Promise.resolve({ data: sourceRows, error: null }); },
};
const pipelineSourceResult = await createPublishedRecipeSource({
  from() { return pipelineQuery; },
}).listPublished();
const pipelineSelection = composePublishedRecipeCatalog(pipelineSourceResult);
assert.equal(pipelineSelection.origin, 'database');
assert.equal(pipelineSelection.databaseStatus, 'success');
assert.deepEqual(
  pipelineSelection.catalog.list().map(({ id }) => id),
  ['seed-pipeline-recipe', 'external:curated:84']
);
assert.equal(pipelineSelection.catalog.getById('external:curated:84')?.source, 'database');

let fetchCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  fetchCalls += 1;
  throw new Error('Catalog composition must not perform network requests.');
};
composePublishedRecipeCatalog({ data: [databaseRecipe()], error: null });
globalThis.fetch = originalFetch;
assert.equal(fetchCalls, 0);

const source = await readFile(new URL('../js/recipe-catalog-composition.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /supabase-config|createClient|service.?role|sb_secret_|\bfetch\s*\(|localStorage|sessionStorage/i);

console.log('Offline recipe catalog composition tests passed without network or configuration access.');
