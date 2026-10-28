import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { recipes as demoRecipes } from '../js/data.js';
import { createRecipeCatalog, recipeCatalog } from '../js/recipe-catalog.js';

const demoIds = demoRecipes.map((recipe) => recipe.id);
assert.deepEqual(recipeCatalog.list().map((recipe) => recipe.id), demoIds, 'Demo ordering and IDs must be preserved');
assert.equal(recipeCatalog.getById('beef-stew')?.name, 'Hearty Beef Stew');
assert.equal(recipeCatalog.getById('missing-recipe'), null);
assert.equal(recipeCatalog.getById(null), null);

assert.deepEqual(
  recipeCatalog.filter('', 'Vegetarian').map((recipe) => recipe.id),
  ['garden-salad', 'vegetable-curry'],
  'Category filtering must retain existing semantics',
);
assert.deepEqual(
  recipeCatalog.filter('garlic', '').map((recipe) => recipe.id),
  ['creamy-garlic-pasta', 'lemon-chicken', 'tomato-soup'],
  'Search must retain existing ingredient and text matching semantics',
);
assert.deepEqual(
  recipeCatalog.filter('', 'Italian').map((recipe) => recipe.id),
  ['creamy-garlic-pasta', 'tomato-soup'],
  'Cuisine filtering must retain existing semantics',
);

assert.throws(
  () => createRecipeCatalog([{ ...demoRecipes[0] }, { ...demoRecipes[0] }]),
  /Duplicate recipe ID/,
);
assert.throws(() => createRecipeCatalog([{ name: 'Missing ID' }]), /non-empty string ID/);

const favoriteIds = new Set(['lemon-chicken', 'external:themealdb:99999']);
const favoriteResolution = recipeCatalog.resolveFavoriteIds(favoriteIds);
assert.deepEqual(favoriteResolution.map(({ id, resolved }) => ({ id, resolved })), [
  { id: 'lemon-chicken', resolved: true },
  { id: 'external:themealdb:99999', resolved: false },
]);
assert.equal(favoriteResolution[0].recipe?.id, 'lemon-chicken');
assert.equal(favoriteResolution[1].recipe, null);
assert.deepEqual([...favoriteIds], ['lemon-chicken', 'external:themealdb:99999'], 'Resolution must not delete favorite IDs');
assert.deepEqual(
  recipeCatalog.resolveFavoriteIds(new Set(['tomato-soup', 'creamy-garlic-pasta'])).map(({ id }) => id),
  ['creamy-garlic-pasta', 'tomato-soup'],
  'Resolved favorites must preserve the existing demo recipe order',
);

const mutableSource = [{
  id: 'future:provider:1',
  name: 'Future Recipe',
  category: 'Test',
  cuisine: 'Test',
  description: 'Original description',
  ingredients: [['Ingredient', '1 unit']],
}];
const sourceSnapshot = structuredClone(mutableSource);
const isolatedCatalog = createRecipeCatalog(mutableSource);
assert.deepEqual(mutableSource, sourceSnapshot, 'Catalog construction must not mutate its source');
assert.notEqual(isolatedCatalog.list()[0], mutableSource[0], 'Catalog must own an isolated recipe snapshot');
assert.notEqual(isolatedCatalog.list()[0].ingredients, mutableSource[0].ingredients);
mutableSource[0].name = 'Changed outside catalog';
mutableSource[0].ingredients[0][0] = 'Changed ingredient';
assert.equal(isolatedCatalog.getById('future:provider:1').name, 'Future Recipe');
assert.equal(isolatedCatalog.getById('future:provider:1').ingredients[0][0], 'Ingredient');
assert.ok(Object.isFrozen(isolatedCatalog.list()));
assert.ok(Object.isFrozen(isolatedCatalog.list()[0]));
assert.ok(Object.isFrozen(isolatedCatalog.list()[0].ingredients));

let fetchCalls = 0;
let storageCalls = 0;
globalThis.fetch = () => { fetchCalls += 1; throw new Error('Catalog must not fetch'); };
globalThis.localStorage = new Proxy({}, {
  get() { storageCalls += 1; throw new Error('Catalog must not use storage'); },
});
await import(`../js/recipe-catalog.js?offline=${Date.now()}`);
assert.equal(fetchCalls, 0);
assert.equal(storageCalls, 0);
delete globalThis.fetch;
delete globalThis.localStorage;

for (const file of ['../app.js', '../js/render.js', '../js/modal.js']) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /mealdb-client|mealdb-recipe-source|external-recipe-controller/);
}

console.log('Offline demo recipe catalog tests passed without network or storage access.');
