import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRecipeCatalog, recipeCatalog } from '../js/recipe-catalog.js';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const match = app.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Expected ${name} in app.js`);
  return match[0];
}

const catalogWithExternalRecipes = Function(
  `${extractFunction('catalogWithExternalRecipes')}\nreturn catalogWithExternalRecipes;`
)();

const databaseCatalog = createRecipeCatalog([{
  id: 'database-only',
  source: 'database',
  databaseSourceType: 'cms',
  name: 'Database Only',
  category: 'Vegetarian',
  cuisine: 'Mediterranean',
  image: 'assets/beef-stew.png',
  fallbackImage: '',
  description: 'Database catalog fixture.',
  ingredients: [['Ingredient', '1 cup']],
  instructions: 'Prepare.',
  tutorial: '',
}]);
const transientRecipe = {
  id: 'external:themealdb:42',
  source: 'external',
  externalProvider: 'themealdb',
  externalId: '42',
  detailLevel: 'full',
  name: 'Transient Recipe',
  category: 'Seafood',
  cuisine: 'Japanese',
  image: '',
  description: '',
  ingredients: [['Ingredient', '1']],
  instructions: 'Prepare.',
  tutorial: '',
};
const collidingDatabaseRecipe = Object.freeze({
  ...transientRecipe,
  source: 'database',
  databaseSourceType: 'external',
});
const collidingDatabaseCatalog = createRecipeCatalog([collidingDatabaseRecipe]);

assert.equal(catalogWithExternalRecipes(databaseCatalog, { status: 'idle', recipes: [] }), databaseCatalog);
const overlaid = catalogWithExternalRecipes(databaseCatalog, {
  status: 'ready',
  recipes: [transientRecipe],
});
assert.equal(overlaid.getById('database-only')?.source, 'database');
assert.equal(overlaid.getById(transientRecipe.id)?.source, 'external');
assert.equal(
  catalogWithExternalRecipes(collidingDatabaseCatalog, { status: 'ready', recipes: [transientRecipe] }),
  collidingDatabaseCatalog,
  'Duplicate IDs must still prevent catalog overlay mutation',
);
assert.deepEqual(collidingDatabaseCatalog.getById(transientRecipe.id), collidingDatabaseRecipe);
assert.equal(collidingDatabaseRecipe.source, 'database');

const appliedRenders = [];
const lifecycle = Function(
  'recipeCatalog',
  'render',
  'externalRecipeController',
  `${extractFunction('catalogWithExternalRecipes')}
   let pageRetired = false;
   let primaryCatalog = recipeCatalog;
   let dashboardCatalog = primaryCatalog;
   let recipeMode = 'offline';
   let liveDashboard = null;
   ${extractFunction('applyPrimaryCatalogResult')}
   return {
     applyPrimaryCatalogResult,
     getPrimary: () => primaryCatalog,
     getDashboard: () => dashboardCatalog,
     retire: () => { pageRetired = true; },
   };`
)(
  recipeCatalog,
  (catalog, externalState) => appliedRenders.push({ catalog, externalState }),
  { getState: () => ({ status: 'idle', recipes: [] }) },
);

assert.equal(lifecycle.getPrimary(), recipeCatalog, 'Built-in catalog must be immediately available');
assert.equal(lifecycle.applyPrimaryCatalogResult({ catalog: databaseCatalog, stale: false }), true);
assert.equal(lifecycle.getPrimary(), databaseCatalog);
assert.equal(lifecycle.getDashboard(), databaseCatalog);
assert.equal(appliedRenders.length, 1);

const emptyCatalog = createRecipeCatalog([]);
assert.equal(lifecycle.applyPrimaryCatalogResult({ catalog: emptyCatalog, stale: false }), true);
assert.deepEqual(lifecycle.getPrimary().list(), [], 'Successful empty catalogs must remain authoritative');
assert.equal(lifecycle.applyPrimaryCatalogResult({ catalog: databaseCatalog, stale: true }), false);
assert.equal(lifecycle.getPrimary(), emptyCatalog, 'Stale results must not replace the current catalog');

lifecycle.retire();
assert.equal(lifecycle.applyPrimaryCatalogResult({ catalog: databaseCatalog, stale: false }), false);
assert.equal(lifecycle.getPrimary(), emptyCatalog, 'Retired pages must reject late catalog results');

let openedRecipe = null;
const modalLookup = Function(
  'dashboardCatalog',
  'invalidateExternalDetails',
  'openRecipeDetails',
  `${extractFunction('openDemoRecipe')}\nreturn openDemoRecipe;`
)(databaseCatalog, () => {}, (recipe) => { openedRecipe = recipe; return true; });
assert.equal(modalLookup('database-only', {}), true);
assert.equal(openedRecipe?.id, 'database-only');
assert.equal(modalLookup('missing', {}), false);

assert.match(app, /let primaryCatalog = recipeCatalog/);
assert.match(app, /const liveState = liveDashboard\?\.getState\(\)/);
assert.match(app, /typeof liveDashboard === 'undefined'/);
assert.match(app, /for \(let index = 0; index < liveState\.recipes\.length; index \+= 1\)/);
assert.match(app, /dashboardCatalog = catalogWithExternalRecipes\(primaryCatalog, liveState\)/);
assert.match(app, /dashboardCatalog = primaryCatalog/);
assert.match(app, /const recipes = primaryCatalog\.list\(\)/);
assert.match(app, /if \(!recipes\.length\)/);
assert.match(app, /createDashboardAuthIntegration\(\{ onClientReady: acceptDashboardClient \}\)/);
assert.match(app, /recipeCatalogLoader\?\.cleanup\(\)/);
assert.match(app, /dashboardAuth\?\.cleanup\(\)/);
assert.doesNotMatch(app, /guest.*import|import.*favorites/i);
assert.doesNotMatch(app, /innerHTML\s*=|insertAdjacentHTML|document\.write/);

console.log('Offline dashboard catalog integration tests passed without live services.');
