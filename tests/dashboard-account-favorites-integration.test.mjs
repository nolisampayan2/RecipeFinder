import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const match = app.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Expected ${name} in app.js`);
  return match[0];
}

const pagehideMatch = app.match(/window\.addEventListener\('pagehide', \(\) => \{([\s\S]*?)\n\}, \{ once: true \}\);/);
assert.ok(pagehideMatch, 'Expected the page retirement callback');

function createLifecycleHarness() {
  const guestIds = ['guest-only'];
  const renders = [];
  const handledAuthStates = [];
  const handledCatalogResults = [];
  const clients = [];
  let adapterCreates = 0;
  let subscriptions = 0;
  let activeSubscriptions = 0;
  let adapterCleanups = 0;
  let loaderCleanups = 0;
  let authCleanups = 0;
  let adapterListener = null;
  let adapterState = Object.freeze({
    mode: 'guest', favoriteIds: Object.freeze([...guestIds]), pendingRecipeIds: Object.freeze([]), message: '',
  });
  let resolveCatalog;
  const catalogPromise = new Promise((resolve) => { resolveCatalog = resolve; });

  const adapter = {
    handleAuthState(state) {
      handledAuthStates.push(state);
      if (state.status === 'guest') {
        adapterState = Object.freeze({
          mode: 'guest', favoriteIds: Object.freeze([...guestIds]), pendingRecipeIds: Object.freeze([]), message: '',
        });
      } else if (state.status === 'authenticated' || state.status === 'loading') {
        adapterState = Object.freeze({
          mode: 'account-loading', favoriteIds: Object.freeze([]), pendingRecipeIds: Object.freeze([]), message: 'Loading account favorites.',
        });
      } else {
        adapterState = Object.freeze({
          mode: 'account-error', favoriteIds: Object.freeze([]), pendingRecipeIds: Object.freeze([]), message: 'Account favorites are unavailable.',
        });
      }
      adapterListener?.(adapterState);
      return Promise.resolve(true);
    },
    subscribe(listener) {
      subscriptions += 1;
      activeSubscriptions += 1;
      adapterListener = listener;
      listener(adapterState);
      let active = true;
      return () => {
        if (!active) return false;
        active = false;
        activeSubscriptions -= 1;
        adapterListener = null;
        return true;
      };
    },
    handleCatalogResult(result) { handledCatalogResults.push(result); return true; },
    setGuestFavorites() { return true; },
    toggleFavorite() { return Promise.resolve(Object.freeze({ ok: true, code: 'SUCCESS', recipeId: 'database-a' })); },
    cleanup() { adapterCleanups += 1; adapterListener = null; return true; },
  };

  const createDashboardAccountFavorites = ({ client, guestFavorites }) => {
    adapterCreates += 1;
    clients.push(['adapter', client]);
    assert.deepEqual([...guestFavorites], guestIds);
    return adapter;
  };
  const createDashboardRecipeCatalogLoader = ({ client }) => {
    clients.push(['loader', client]);
    return {
      load: () => catalogPromise,
      cleanup() { loaderCleanups += 1; return true; },
    };
  };

  const factory = Function(
    'createDashboardAccountFavorites', 'createDashboardRecipeCatalogLoader', 'state', 'renders', 'dashboardAuth',
    'publishAdapterState',
    `${extractFunction('acceptDashboardClient')}
     ${extractFunction('acceptDashboardAuthState')}
     let dashboardAccountFavorites = null;
     let unsubscribeAccountFavorites = null;
     let recipeCatalogLoader = null;
      let dashboardAdminLink = null;
     let latestAuthState = Object.freeze({ status: 'loading', userId: null });
     let favoritesPresentation = Object.freeze({
       mode: 'account-loading', favoriteIds: Object.freeze([]), pendingRecipeIds: Object.freeze([]), message: 'Loading account favorites.',
     });
     let pageRetired = false;
     function renderDashboard() { renders.push(favoritesPresentation); }
     function applyPrimaryCatalogResult(result) {
       if (pageRetired || result?.stale || !result?.catalog) return false;
       dashboardAccountFavorites?.handleCatalogResult(result);
       return true;
     }
     function retire() { ${pagehideMatch[1]} }
     return {
       acceptDashboardClient,
       acceptDashboardAuthState,
       retire,
       getPresentation: () => favoritesPresentation,
       publishAdapter: (next) => publishAdapterState(next),
     };`,
  )(
    createDashboardAccountFavorites,
    createDashboardRecipeCatalogLoader,
    { favorites: new Set(guestIds) },
    renders,
    { cleanup() { authCleanups += 1; return true; } },
    (next) => adapterListener?.(next),
  );

  return {
    ...factory,
    renders,
    handledAuthStates,
    handledCatalogResults,
    clients,
    counts: () => ({ adapterCreates, subscriptions, activeSubscriptions, adapterCleanups, loaderCleanups, authCleanups }),
  };
}

const guestLifecycle = createLifecycleHarness();
assert.deepEqual(guestLifecycle.getPresentation().favoriteIds, []);
assert.equal(guestLifecycle.getPresentation().mode, 'account-loading');
assert.equal(guestLifecycle.acceptDashboardAuthState(Object.freeze({ status: 'guest', userId: null })), true);
assert.deepEqual(guestLifecycle.getPresentation().favoriteIds, ['guest-only']);
const sharedGuestClient = Object.freeze({ name: 'shared-guest-client' });
assert.equal(guestLifecycle.acceptDashboardClient(sharedGuestClient), true);
assert.deepEqual(guestLifecycle.handledAuthStates, [{ status: 'guest', userId: null }]);
assert.equal(guestLifecycle.counts().adapterCreates, 1);
assert.equal(guestLifecycle.counts().subscriptions, 1);
assert.equal(guestLifecycle.counts().activeSubscriptions, 1);
assert.deepEqual(guestLifecycle.clients, [['adapter', sharedGuestClient], ['loader', sharedGuestClient]]);
assert.equal(guestLifecycle.acceptDashboardClient(sharedGuestClient), false);

const USER_A = '11111111-1111-4111-8111-111111111111';
const authLifecycle = createLifecycleHarness();
const bufferedAuthenticated = Object.freeze({ status: 'authenticated', userId: USER_A });
authLifecycle.acceptDashboardAuthState(bufferedAuthenticated);
assert.equal(authLifecycle.getPresentation().mode, 'account-error');
assert.deepEqual(authLifecycle.getPresentation().favoriteIds, []);
assert.equal(authLifecycle.acceptDashboardClient(Object.freeze({ name: 'shared-auth-client' })), true);
assert.equal(authLifecycle.getPresentation().mode, 'account-loading');
assert.deepEqual(authLifecycle.getPresentation().favoriteIds, []);
assert.equal(authLifecycle.handledAuthStates.at(-1), bufferedAuthenticated);

const accountError = Object.freeze({
  mode: 'account-error', favoriteIds: Object.freeze([]), pendingRecipeIds: Object.freeze([]), message: 'Account favorites are unavailable.',
});
authLifecycle.publishAdapter(accountError);
assert.equal(authLifecycle.getPresentation(), accountError);
assert.deepEqual(authLifecycle.getPresentation().favoriteIds, []);

const rendersBeforeRetire = authLifecycle.renders.length;
authLifecycle.retire();
authLifecycle.retire();
assert.deepEqual(authLifecycle.counts(), {
  adapterCreates: 1, subscriptions: 1, activeSubscriptions: 0, adapterCleanups: 1, loaderCleanups: 1, authCleanups: 1,
});
authLifecycle.publishAdapter(Object.freeze({
  mode: 'account-ready', favoriteIds: Object.freeze(['database-a']), pendingRecipeIds: Object.freeze([]), message: '',
}));
assert.equal(authLifecycle.renders.length, rendersBeforeRetire);

function createClickHarness(initialPresentation, recipes, operationResult = { ok: true, code: 'SUCCESS', recipeId: 'database-a' }) {
  let clickListener = null;
  let localWrites = 0;
  let adapterWrites = 0;
  let guestSnapshots = 0;
  let renders = 0;
  const toasts = [];
  const state = { favorites: new Set(['guest-only']) };
  const dashboardAccountFavorites = {
    setGuestFavorites(ids) { guestSnapshots += 1; assert.deepEqual([...ids], [...state.favorites]); return true; },
    toggleFavorite(recipe) { adapterWrites += 1; assert.equal(recipe.source, 'database'); return Promise.resolve(operationResult); },
  };
  const document = { addEventListener(type, listener) { if (type === 'click') clickListener = listener; } };
  const dashboardCatalog = { getById(id) { return recipes.get(id) ?? null; } };
  const toggleFavorite = (id) => {
    localWrites += 1;
    if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  };
  const getFavoriteActionId = (button) => button.actionId ?? null;

  const harness = Function(
    'document', 'getFavoriteActionId', 'state', 'toggleFavorite', 'dashboardAccountFavorites', 'dashboardCatalog',
    'renderDashboard', 'showToast', 'initialPresentation', 'dispatchClick',
    `let favoritesPresentation = initialPresentation;
     let pageRetired = false;
     ${extractFunction('initializePageActions')}
     initializePageActions();
     return {
       click(button) { dispatchClick(button); },
       setPresentation(next) { favoritesPresentation = next; },
       retire() { pageRetired = true; },
     };`,
  )(
    document, getFavoriteActionId, state, toggleFavorite, dashboardAccountFavorites, dashboardCatalog,
    () => { renders += 1; }, (message) => { toasts.push(message); }, initialPresentation,
    (button) => clickListener({ target: { closest: (selector) => selector.includes('favorite') ? button : null } }),
  );

  return { ...harness, state, metrics: () => ({ localWrites, adapterWrites, guestSnapshots, renders, toasts: [...toasts] }) };
}

const databaseRecipe = Object.freeze({ id: 'database-a', source: 'database' });
const builtInRecipe = Object.freeze({ id: 'built-in-a', source: 'built-in' });
const transientRecipe = Object.freeze({ id: 'external:themealdb:1', source: 'external' });
const recipes = new Map([[databaseRecipe.id, databaseRecipe], [builtInRecipe.id, builtInRecipe], [transientRecipe.id, transientRecipe]]);
const guestPresentation = Object.freeze({ mode: 'guest', favoriteIds: Object.freeze(['guest-only']), pendingRecipeIds: Object.freeze([]), message: '' });
const clickHarness = createClickHarness(guestPresentation, recipes);
clickHarness.click({ actionId: 'database-a' });
assert.deepEqual(clickHarness.metrics(), {
  localWrites: 1, adapterWrites: 0, guestSnapshots: 1, renders: 1, toasts: ['Favorites updated'],
});

const accountReady = Object.freeze({ mode: 'account-ready', favoriteIds: Object.freeze([]), pendingRecipeIds: Object.freeze([]), message: '' });
clickHarness.setPresentation(accountReady);
clickHarness.click({ actionId: 'database-a' });
await Promise.resolve();
await Promise.resolve();
assert.equal(clickHarness.metrics().adapterWrites, 1);
assert.equal(clickHarness.metrics().localWrites, 1);

clickHarness.click({ actionId: 'built-in-a' });
clickHarness.click({ actionId: 'external:themealdb:1' });
clickHarness.click({ actionId: null, disabled: true });
assert.equal(clickHarness.metrics().adapterWrites, 1);

for (const mode of ['account-loading', 'account-error']) {
  clickHarness.setPresentation(Object.freeze({ mode, favoriteIds: Object.freeze([]), pendingRecipeIds: Object.freeze([]), message: '' }));
  clickHarness.click({ actionId: 'database-a' });
}
assert.equal(clickHarness.metrics().adapterWrites, 1);
assert.equal(clickHarness.metrics().localWrites, 1);

const failedHarness = createClickHarness(accountReady, recipes, { ok: false, code: 'FAILED', recipeId: 'database-a' });
failedHarness.click({ actionId: 'database-a' });
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(failedHarness.metrics().toasts, ['Account favorites could not be updated']);
const staleHarness = createClickHarness(accountReady, recipes, { ok: false, code: 'STALE', recipeId: 'database-a' });
staleHarness.click({ actionId: 'database-a' });
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(staleHarness.metrics().toasts, []);

assert.match(html, /id="favorites-status"[^>]*role="status"[^>]*aria-live="polite"/);
assert.doesNotMatch(app, /createClient\s*\(|innerHTML\s*=|insertAdjacentHTML|document\.write/);
assert.doesNotMatch(app, /guest[^\n]*addOwn|addOwn[^\n]*guest/i);

console.log('Behavioral dashboard account Favorites integration tests passed with in-memory fakes only.');
