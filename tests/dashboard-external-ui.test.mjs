import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExternalRecipeController } from '../js/external-recipe-controller.js';
import {
  createFictionalExternalRecipeController,
  createFictionalExternalRecipeSource,
} from '../js/fictional-external-recipe-source.js';
import { createRecipeCatalog, recipeCatalog } from '../js/recipe-catalog.js';

let fetchCalls = 0;
globalThis.fetch = () => { fetchCalls += 1; throw new Error('Fictional source must remain offline'); };
await import(`../js/fictional-external-recipe-source.js?inert=${Date.now()}`);
const source = createFictionalExternalRecipeSource();
assert.equal(fetchCalls, 0);

const mutableFixture = [{
  id: 'external:fictional-offline:991000',
  name: 'Mutable Fictional Fixture',
  category: 'Vegetarian',
  cuisine: 'Italian',
  description: 'A fictional fixture.',
  ingredients: [['Ingredient', '1 unit']],
  detailLevel: 'full',
  source: 'external',
}];
const fixtureSnapshot = structuredClone(mutableFixture);
createFictionalExternalRecipeSource({ recipes: mutableFixture });
assert.deepEqual(mutableFixture, fixtureSnapshot, 'Source construction must not mutate injected records');
assert.throws(
  () => createFictionalExternalRecipeSource({ recipes: [mutableFixture[0], mutableFixture[0]] }),
  /Duplicate fictional recipe ID/,
);

const searchResults = await source.search('citrus');
assert.deepEqual(searchResults.map(({ id }) => id), ['external:fictional-offline:990002']);
assert.equal(searchResults[0].detailLevel, 'full');
assert.equal(searchResults[0].externalProvider, 'fictional-offline');
assert.equal(searchResults[0].image, 'assets/recipefinder-favicon.svg');
const categoryResults = await source.filterCategory('Vegetarian');
assert.equal(categoryResults[0].detailLevel, 'summary');
assert.deepEqual(categoryResults[0].ingredients, []);
assert.equal((await source.filterCuisine('Italian'))[0].id, 'external:fictional-offline:990006');
assert.equal((await source.getDetails('external:fictional-offline:990001')).detailLevel, 'full');
await assert.rejects(source.getDetails('external:fictional-offline:1'), (error) => error.code === 'NOT_FOUND');
await assert.rejects(source.getDetails('unsafe-id'), /valid fictional recipe ID/);

const cancelled = new AbortController();
cancelled.abort();
await assert.rejects(source.search('garden', { signal: cancelled.signal }), (error) => error.code === 'ABORTED');
assert.equal(fetchCalls, 0);
delete globalThis.fetch;

const originalDemoIds = recipeCatalog.list().map(({ id }) => id);
const mixedCatalog = recipeCatalog.withRecipes(categoryResults);
assert.deepEqual(mixedCatalog.list().slice(0, originalDemoIds.length).map(({ id }) => id), originalDemoIds);
assert.equal(mixedCatalog.list().at(-1).source, 'external');
assert.equal(recipeCatalog.getById(categoryResults[0].id), null, 'Demo singleton must remain demo-only');
assert.throws(() => recipeCatalog.withRecipes([recipeCatalog.list()[0]]), /Duplicate recipe ID/);

const controller = createFictionalExternalRecipeController();
const allPreviews = await controller.discoverAll();
assert.equal(allPreviews.status, 'ready');
assert.equal(allPreviews.recipes.length, 6);
assert.deepEqual(allPreviews.recipes.map(({ id }) => id), [
  'external:fictional-offline:990001', 'external:fictional-offline:990002', 'external:fictional-offline:990003',
  'external:fictional-offline:990004', 'external:fictional-offline:990005', 'external:fictional-offline:990006',
]);
const pendingSearch = controller.search('citrus');
assert.equal(controller.getState().status, 'loading');
assert.equal((await pendingSearch).status, 'ready');
assert.equal((await controller.filterCategory('Vegetarian')).recipes[0].detailLevel, 'summary');
assert.equal((await controller.filterCuisine('Italian')).recipes[0].cuisine, 'Italian');
assert.equal((await controller.search('no fictional match')).status, 'empty');

const retryCalls = [];
const retryController = createExternalRecipeController({
  source: {
    search: async (value) => {
      retryCalls.push(value);
      if (retryCalls.length === 1) throw Object.assign(new Error('offline failure'), { code: 'NETWORK_ERROR' });
      return searchResults;
    },
    filterCategory: source.filterCategory,
    filterCuisine: source.filterCuisine,
    getDetails: source.getDetails,
  },
});
assert.equal((await retryController.search('citrus')).status, 'error');
assert.equal((await retryController.search('citrus')).status, 'ready');
assert.deepEqual(retryCalls, ['citrus', 'citrus']);

let resolveOld;
const staleController = createExternalRecipeController({
  source: {
    ...source,
    search: (value) => value === 'old'
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(searchResults),
  },
});
const oldRequest = staleController.search('old');
await Promise.resolve();
assert.equal((await staleController.search('new')).status, 'ready');
resolveOld(categoryResults);
await oldRequest;
assert.equal(staleController.getState().recipes[0].id, searchResults[0].id);
staleController.invalidateCollection();
assert.equal(staleController.getState().status, 'idle');

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const renderSource = await readFile(new URL('../js/render.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

assert.match(appSource, /createFictionalExternalRecipeController/);
assert.match(appSource, /createLiveMealDbDashboard/);
assert.match(appSource, /data-external-retry/);
assert.match(appSource, /data-discover-more/);
assert.match(appSource, /invalidateCollection/);
assert.match(appSource, /section === 'categories' \|\| link\.dataset\.section === 'cuisines'/);
const initializeAppBody = appSource.match(/function initializeApp\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.doesNotMatch(initializeAppBody, /discoverExternalRecipes/, 'Page initialization must not start discovery');
assert.doesNotMatch(initializeAppBody, /getLiveDashboard|createLiveMealDbDashboard|\.search\(/, 'Page initialization must not start live search');
assert.doesNotMatch(appSource, /createMealDbClient|mealdb-client|fetch\(|supabase-config|localStorage.*external/i);
assert.match(appSource, /search-source-selector/);
assert.match(appSource, /setSearchSource\('offline'\)/);
assert.match(appSource, /window\.fetch\.bind\(window\)/);
assert.match(appSource, /Enter a recipe name/);
assert.match(appSource, /data-back-to-offline/);
assert.match(renderSource, /Offline recipe preview/);
assert.match(renderSource, /fictional-offline/);
assert.match(renderSource, /TheMealDB recipe/);
assert.match(renderSource, /Results provided by TheMealDB/);
assert.match(renderSource, /dataset\.externalView/);
assert.match(renderSource, /viewButton\.disabled = true/);
assert.match(renderSource, /discoverMore\.hidden = isLiveMealDb \|\| !showingAll/);
assert.match(renderSource, /aria-disabled/);
assert.doesNotMatch(renderSource, /externalState\.error\??\.message/);
assert.doesNotMatch(renderSource, /\.innerHTML\s*=|insertAdjacentHTML/);
assert.match(html, /id="external-status"[^>]+aria-live="polite"/);
assert.match(html, /data-external-retry/);
assert.match(html, /id="discover-more-recipes"[^>]+data-discover-more[^>]+hidden/);
assert.equal((html.match(/<button type="submit">Search<\/button>/g) || []).length, 1);
assert.doesNotMatch(html, /mealdb-search-button|Search TheMealDB/);
assert.match(html, /<fieldset[^>]+id="search-source-selector"/);
assert.match(html, /id="search-source-offline"[^>]+value="offline"[^>]+checked/);
assert.match(html, /id="search-source-online"[^>]+value="online"/);
assert.match(html, /<legend>Recipe source<\/legend>/);
assert.match(html, /Searching TheMealDB sends your search term to an external recipe service\./);
assert.match(html, /Search built-in recipes and fictional offline recipe previews\./);
assert.match(html, /Recipe data and images provided by TheMealDB/);
assert.match(html, /href="https:\/\/www\.themealdb\.com\/"/);
assert.match(html, /rel="noopener noreferrer"/);
assert.match(css, /\.external-status/);
assert.match(css, /\.external-preview/);
assert.match(css, /\.search-source-panel/);
assert.match(css, /@media\(max-width:430px\)[^{]*\{[^}]*\.topbar\{flex-wrap:wrap\}/);
assert.doesNotMatch(css, /@media\(max-width:430px\)[\s\S]*?\.search button\{display:none\}/);
assert.match(css, /\.recipe-view-actions\{[^}]*flex-wrap:wrap/);

const discoverMoreSource = appSource.match(/function discoverMoreRecipes\(\)[\s\S]*?\n\}/)?.[0] || '';
assert.match(discoverMoreSource, /state\.view !== 'all' \|\| externalStatus !== 'idle'/);
assert.match(discoverMoreSource, /discoverExternalRecipes\('discoverAll'\)/);
let simulatedStatus = 'idle';
let explicitDiscoveryCalls = 0;
const simulatedViewState = { view: 'default' };
const executeDiscoverMore = Function(
  'state',
  'externalRecipeController',
  'discoverExternalRecipes',
  'recipeMode',
  'restoreDiscoveryCollection',
  `${discoverMoreSource}\nreturn discoverMoreRecipes;`,
)(
  simulatedViewState,
  { getState: () => ({ status: simulatedStatus }) },
  (operation) => {
    assert.equal(operation, 'discoverAll');
    explicitDiscoveryCalls += 1;
    simulatedStatus = 'loading';
  },
  'offline',
  () => {},
);
assert.equal(executeDiscoverMore(), false, 'Discovery must remain unavailable outside All Recipes');
simulatedViewState.view = 'all';
assert.equal(executeDiscoverMore(), true, 'The explicit All Recipes action must start discovery');
assert.equal(executeDiscoverMore(), false, 'A repeat activation while loading must be ignored');
assert.equal(explicitDiscoveryCalls, 1);

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.focused = false;
    this.listeners = new Map();
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(' ').filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const present = this.className.split(' ').includes(name);
        const enabled = force === undefined ? !present : force;
        this.classList[enabled ? 'add' : 'remove'](name);
        return enabled;
      },
    };
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  focus() { globalThis.document.activeElement = this; this.focused = true; }
  querySelectorAll() { return this.focusables || []; }
  contains(element) { return this === element || (this.focusables || []).includes(element); }
  closest(selector) {
    return selector === '[data-external-view]' && this.dataset.externalView ? this : null;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type) { this.listeners.get(type)?.forEach((listener) => listener({ target: this })); }
}

const elementIds = [
  'fav-count', 'favorite-list', 'favorites-status', 'favorites',
  'external-status', 'external-status-message', 'external-retry',
  'discover-more-recipes', 'back-to-offline', 'mealdb-attribution',
  'recommended', 'recommended-title', 'back-to-discover', 'recommended-view-all', 'recommended-grid',
  'more-grid', 'more-recipes', 'empty-state', 'empty-title', 'empty-message', 'toast',
  'recipe-modal', 'modal-content',
];
const fakeElements = new Map(elementIds.map((id) => [`#${id}`, new FakeElement()]));
fakeElements.set('.modal-close', new FakeElement('button'));
fakeElements.get('#recipe-modal').hidden = true;
fakeElements.get('#recipe-modal').focusables = [fakeElements.get('.modal-close')];
const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;
const hostileIds = [
  '"><img src=x onerror=alert(1)>',
  'external:themealdb:990099',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'malformed favorite with spaces',
];
const storedFavoriteIds = ['lemon-chicken', ...hostileIds];
const storageWrites = [];
globalThis.document = {
  activeElement: null,
  body: { style: {} },
  createElement: (tagName) => new FakeElement(tagName),
  querySelector: (selector) => fakeElements.get(selector) || null,
  querySelectorAll: () => [],
};
globalThis.localStorage = {
  getItem: (key) => key === 'recipefinder:favorites' ? JSON.stringify(storedFavoriteIds) : null,
  setItem: (key, value) => storageWrites.push([key, value]),
};

const renderModule = await import(`../js/render.js?favorites=${Date.now()}`);
const { state: favoriteState, toggleFavorite: toggleGuestFavorite } = await import('../js/state.js');
favoriteState.view = 'favorites';
renderModule.render(recipeCatalog, { status: 'idle', recipes: [], error: null, generation: 0 });

const discoverAction = fakeElements.get('#discover-more-recipes');
assert.equal(discoverAction.hidden, true, 'Discovery action must stay hidden outside All Recipes');
favoriteState.view = 'all';
renderModule.render(recipeCatalog, { status: 'idle', recipes: [], error: null, generation: 0 });
assert.equal(discoverAction.hidden, false);
assert.equal(discoverAction.textContent, 'Discover More Offline Recipes');
assert.equal(discoverAction.attributes['aria-disabled'], 'false');
assert.equal(fakeElements.get('#recommended-grid').children.length, originalDemoIds.length, 'Opening All Recipes must remain demo-only');

renderModule.render(recipeCatalog, { status: 'loading', recipes: [], error: null, generation: 1 });
assert.equal(discoverAction.textContent, 'Discovering Offline Recipes…');
assert.equal(discoverAction.attributes['aria-disabled'], 'true');
assert.equal(fakeElements.get('#recommended').attributes['aria-busy'], 'true');

const allPreviewRecipes = allPreviews.recipes;
const allRecipesCatalog = recipeCatalog.withRecipes(allPreviewRecipes);
renderModule.render(allRecipesCatalog, { status: 'ready', recipes: allPreviewRecipes, error: null, generation: 1 });
assert.equal(discoverAction.textContent, 'Offline Recipes Added');
assert.equal(discoverAction.attributes['aria-disabled'], 'true');
assert.equal(fakeElements.get('#recommended-grid').children.length, originalDemoIds.length + 6);
assert.deepEqual(
  fakeElements.get('#recommended-grid').children.map((card) => card.dataset.id),
  [...originalDemoIds, ...allPreviewRecipes.map(({ id }) => id)],
  'All Recipes must keep demo-first ordering without duplicate IDs',
);
assert.equal(new Set(fakeElements.get('#recommended-grid').children.map((card) => card.dataset.id)).size, originalDemoIds.length + 6);
const fictionalCard = fakeElements.get('#recommended-grid').children[originalDemoIds.length];
const fictionalDetailButton = fictionalCard.children.at(-1).children.at(-1);
assert.equal(fictionalDetailButton.dataset.externalView, allPreviewRecipes[0].id);
assert.equal(fictionalDetailButton.dataset.view, undefined);
assert.notEqual(fictionalDetailButton.disabled, true, 'Validated fictional details must be available');

const liveRecipe = {
  id: 'external:themealdb:12345', source: 'external', externalProvider: 'themealdb', externalId: '12345',
  detailLevel: 'full', name: 'Safe Live Fixture', category: 'Vegetarian', cuisine: 'Fictionland',
  image: '', description: '', ingredients: [['Ingredient', '1 cup']], instructions: 'Prepare safely.', tutorial: '',
};
favoriteState.view = 'default';
renderModule.render(recipeCatalog.withRecipes([liveRecipe]), {
  provider: 'themealdb', status: 'ready', recipes: [liveRecipe], error: null, generation: 7,
});
const liveCard = fakeElements.get('#recommended-grid').children[0];
assert.equal(liveCard.dataset.id, liveRecipe.id);
assert.equal(liveCard.children.some((child) => child.className.includes('heart')), false, 'Live recipes must not expose favorites');
const liveBody = liveCard.children.at(-1);
assert.equal(liveBody.children[0].textContent, 'TheMealDB recipe');
assert.notEqual(liveBody.children.at(-1).disabled, true, 'Full live recipes must expose details');
assert.equal(liveBody.children.at(-1).dataset.externalView, liveRecipe.id);
assert.match(liveBody.children.at(-1).attributes['aria-label'], /View TheMealDB recipe/);
assert.match(fakeElements.get('#external-status-message').textContent, /Results provided by TheMealDB/);
assert.equal(fakeElements.get('#mealdb-attribution').hidden, false);
assert.equal(fakeElements.get('#back-to-offline').hidden, false);
assert.equal(fakeElements.get('#discover-more-recipes').hidden, true);
assert.equal(fakeElements.get('#recommended-view-all').hidden, true);
assert.equal(fakeElements.get('#more-recipes').hidden, true);
assert.equal(fakeElements.get('#recommended-title').textContent, 'TheMealDB search results');

const modalModule = await import(`../js/modal.js?live-click=${Date.now()}`);
const extractAppFunction = (name) => {
  const match = appSource.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Expected ${name} in app.js`);
  return match[0];
};
const pageClickBody = appSource.match(/document\.addEventListener\('click', \(event\) => \{([\s\S]*?)\n  \}\);/)?.[1] || '';
assert.ok(pageClickBody, 'Expected the production delegated click handler');
let liveRegistryHydrations = 0;
const liveClickHarness = Function(
  'dashboardCatalog', 'externalSourceRegistry', 'openRecipeDetails', 'openRecipeLoading', 'openRecipeError',
  'isRecipeModalOpen', 'closeRecipeModal', 'openRecipe',
  `let externalDetailGeneration = 0;
   let recipeMode = 'live';
   ${extractAppFunction('invalidateExternalDetails')}
   ${extractAppFunction('openExternalRecipe')}
   const handlePageClick = (event) => {${pageClickBody}
   };
   return { handlePageClick };`,
)(
  recipeCatalog.withRecipes([liveRecipe]),
  {
    invalidateDetails() {},
    getDetails() { liveRegistryHydrations += 1; throw new Error('Live details must not hydrate'); },
  },
  modalModule.openRecipeDetails,
  modalModule.openRecipeLoading,
  modalModule.openRecipeError,
  modalModule.isRecipeModalOpen,
  modalModule.closeRecipeModal,
  modalModule.openRecipe,
);
const liveViewButton = liveBody.children.at(-1);
const fetchCallsBeforeLiveDetails = fetchCalls;
liveClickHarness.handlePageClick({ target: liveViewButton });
assert.equal(fakeElements.get('#recipe-modal').hidden, false, 'Delegated live-card click must open the real modal');
assert.match(JSON.stringify(fakeElements.get('#modal-content')), /Safe Live Fixture/);
assert.match(JSON.stringify(fakeElements.get('#modal-content')), /TheMealDB recipe/);
assert.equal(liveRegistryHydrations, 0, 'Delegated live-card click must not hydrate through the registry');
assert.equal(fetchCalls, fetchCallsBeforeLiveDetails, 'Delegated live-card click must not fetch or look up details');
modalModule.closeRecipeModal({ restoreFocus: false });

for (const unavailableLiveRecipe of [
  { ...liveRecipe, id: 'external:themealdb:12346', externalId: '12346', detailLevel: 'summary' },
  { ...liveRecipe, id: 'external:themealdb:not-digits', externalId: 'not-digits' },
]) {
  renderModule.render(recipeCatalog.withRecipes([unavailableLiveRecipe]), {
    provider: 'themealdb', status: 'ready', recipes: [unavailableLiveRecipe], error: null, generation: 8,
  });
  const unavailableButton = fakeElements.get('#recommended-grid').children[0].children.at(-1).children.at(-1);
  assert.equal(unavailableButton.disabled, true, 'Summary and malformed live recipes must fail closed');
  assert.equal(unavailableButton.dataset.externalView, undefined);
}

renderModule.render(recipeCatalog, { status: 'empty', recipes: [], error: null, generation: 2 });
assert.equal(discoverAction.textContent, 'No More Offline Recipes');
assert.equal(discoverAction.attributes['aria-disabled'], 'true');
renderModule.render(recipeCatalog, { status: 'error', recipes: [], error: { code: 'network' }, generation: 3 });
assert.equal(discoverAction.textContent, 'Discover More Offline Recipes');
assert.equal(discoverAction.attributes['aria-disabled'], 'true');
assert.equal(fakeElements.get('#external-retry').hidden, false, 'Existing Retry must remain available after errors');

favoriteState.view = 'all';
renderModule.render(recipeCatalog, { status: 'idle', recipes: [], error: null, generation: 4 });
assert.equal(fakeElements.get('#recommended-grid').children.length, originalDemoIds.length, 'Reopening All Recipes must reset to demo-only');
favoriteState.view = 'favorites';
renderModule.render(recipeCatalog, { status: 'idle', recipes: [], error: null, generation: 5 });

assert.equal(fakeElements.get('#fav-count').textContent, storedFavoriteIds.length, 'Count must include unresolved IDs');
assert.equal(fakeElements.get('#favorite-list').children.length, 4, 'Sidebar preview must remain capped at four entries');
assert.equal(fakeElements.get('#recommended-grid').children.length, storedFavoriteIds.length, 'Full view must include every saved ID');
assert.equal(storageWrites.length, 0, 'Rendering must not rewrite or delete stored favorites');

const placeholderCards = fakeElements.get('#recommended-grid').children
  .filter((card) => card.className.includes('unavailable-favorite-card'));
assert.equal(placeholderCards.length, hostileIds.length);
const firstPlaceholder = placeholderCards[0];
const firstPlaceholderBody = firstPlaceholder.children[1];
assert.equal(firstPlaceholderBody.children[0].textContent, 'Preview currently unavailable');
assert.equal(firstPlaceholderBody.children[1].textContent, 'Saved offline recipe');
assert.equal(firstPlaceholderBody.children[2].textContent, 'Find this recipe again using search or filters.');
const placeholderRemove = firstPlaceholderBody.children[3];
assert.equal(placeholderRemove.textContent, 'Remove favorite');
assert.equal(placeholderRemove.attributes['aria-label'], 'Remove saved offline recipe from favorites');
assert.equal(placeholderRemove.dataset.view, undefined, 'Placeholder must not expose a modal action');
assert.deepEqual(placeholderRemove.dataset, {}, 'Opaque ID must not be stored in data attributes');

function serializedVisibleTree(element) {
  return JSON.stringify({
    className: element.className,
    textContent: element.textContent,
    attributes: element.attributes,
    dataset: element.dataset,
    children: element.children.map(serializedVisibleTree),
  });
}
const visibleTree = serializedVisibleTree(fakeElements.get('#recommended-grid'));
hostileIds.forEach((id) => assert.equal(visibleTree.includes(id), false, `Stored ID leaked into rendered output: ${id}`));

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (callback) => { callback(); return 1; };
globalThis.clearTimeout = () => {};
assert.equal(renderModule.getFavoriteActionId(placeholderRemove), hostileIds[0]);
toggleGuestFavorite(renderModule.getFavoriteActionId(placeholderRemove));
renderModule.render(recipeCatalog, { status: 'idle', recipes: [], error: null, generation: 5 });
globalThis.setTimeout = originalSetTimeout;
globalThis.clearTimeout = originalClearTimeout;

assert.equal(fakeElements.get('#fav-count').textContent, storedFavoriteIds.length - 1);
assert.equal(fakeElements.get('#recommended-grid').children.length, storedFavoriteIds.length - 1);
assert.equal(storageWrites.length, 1);
assert.equal(JSON.parse(storageWrites[0][1]).includes(hostileIds[0]), false, 'Remove must use the original opaque ID internally');
const resolvedDemoCard = fakeElements.get('#recommended-grid').children[0];
assert.equal(resolvedDemoCard.dataset.id, 'lemon-chicken');
assert.equal(resolvedDemoCard.children.at(-1).children.at(-1).dataset.view, 'lemon-chicken', 'Resolved demo behavior must remain unchanged');

favoriteState.view = 'default';
const loadingPresentation = Object.freeze({
  mode: 'account-loading', favoriteIds: Object.freeze([]), pendingRecipeIds: Object.freeze([]), message: 'Loading account favorites.',
});
renderModule.render(recipeCatalog, { status: 'idle', recipes: [], error: null, generation: 6 }, loadingPresentation);
assert.equal(fakeElements.get('#fav-count').textContent, 0, 'Auth restoration must not display stored guest favorites');
assert.equal(fakeElements.get('#favorites-status').textContent, 'Loading account favorites.');
assert.equal(fakeElements.get('#favorites-status').hidden, false);
assert.equal(fakeElements.get('#favorites').attributes['aria-busy'], 'true');
const disabledBuiltInHeart = fakeElements.get('#recommended-grid').children[0].children[1];
assert.equal(disabledBuiltInHeart.disabled, true);
assert.equal(disabledBuiltInHeart.attributes['aria-disabled'], 'true');
assert.equal(renderModule.getFavoriteActionId(disabledBuiltInHeart), null);

const errorPresentation = Object.freeze({
  mode: 'account-error', favoriteIds: Object.freeze([]), pendingRecipeIds: Object.freeze([]), message: 'Account favorites are unavailable.',
});
renderModule.render(recipeCatalog, { status: 'idle', recipes: [], error: null, generation: 7 }, errorPresentation);
assert.equal(fakeElements.get('#fav-count').textContent, 0);
assert.equal(fakeElements.get('#favorites-status').textContent, 'Account favorites are unavailable.');
assert.equal(fakeElements.get('#favorites').attributes['aria-busy'], 'false');

const databaseRecipe = Object.freeze({
  ...recipeCatalog.list()[0], id: 'database-beef-stew', source: 'database', databaseSourceType: 'cms',
});
const databaseOnlyCatalog = createRecipeCatalog([databaseRecipe]);
const readyPresentation = Object.freeze({
  mode: 'account-ready', favoriteIds: Object.freeze([databaseRecipe.id]), pendingRecipeIds: Object.freeze([]), message: '',
});
renderModule.render(databaseOnlyCatalog, { status: 'idle', recipes: [], error: null, generation: 8 }, readyPresentation);
assert.equal(fakeElements.get('#fav-count').textContent, 1);
assert.equal(fakeElements.get('#favorite-list').children.length, 1);
const readyDatabaseHeart = fakeElements.get('#recommended-grid').children[0].children[1];
assert.equal(readyDatabaseHeart.disabled, false);
assert.equal(readyDatabaseHeart.className.includes('saved'), true);
assert.equal(renderModule.getFavoriteActionId(readyDatabaseHeart), databaseRecipe.id);

const pendingPresentation = Object.freeze({
  ...readyPresentation, pendingRecipeIds: Object.freeze([databaseRecipe.id]),
});
renderModule.render(databaseOnlyCatalog, { status: 'idle', recipes: [], error: null, generation: 9 }, pendingPresentation);
const pendingDatabaseHeart = fakeElements.get('#recommended-grid').children[0].children[1];
assert.equal(pendingDatabaseHeart.disabled, true);
assert.equal(pendingDatabaseHeart.attributes['aria-disabled'], 'true');
assert.equal(renderModule.getFavoriteActionId(pendingDatabaseHeart), null);

favoriteState.view = 'favorites';
const unavailableAccountId = 'missing-database-recipe';
const unavailableAccountPresentation = Object.freeze({
  mode: 'account-ready', favoriteIds: Object.freeze([unavailableAccountId]), pendingRecipeIds: Object.freeze([]), message: '',
});
renderModule.render(databaseOnlyCatalog, { status: 'idle', recipes: [], error: null, generation: 10 }, unavailableAccountPresentation);
const unavailableAccountCard = fakeElements.get('#recommended-grid').children[0];
const unavailableAccountRemove = unavailableAccountCard.children[1].children[3];
assert.equal(unavailableAccountRemove.disabled, true);
assert.equal(unavailableAccountRemove.attributes['aria-disabled'], 'true');
assert.deepEqual(unavailableAccountRemove.dataset, {});
assert.equal(renderModule.getFavoriteActionId(unavailableAccountRemove), null);
assert.equal(serializedVisibleTree(unavailableAccountCard).includes(unavailableAccountId), false);

globalThis.document = originalDocument;
globalThis.localStorage = originalLocalStorage;

console.log('Offline fictional external recipe dashboard tests passed without network or live API access.');
