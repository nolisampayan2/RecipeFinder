import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDashboardAccountFavorites } from '../js/dashboard-account-favorites.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const RECIPE_A = Object.freeze({ id: 'database-a', source: 'database' });
const RECIPE_B = Object.freeze({ id: 'database-b', source: 'database' });
const LIVE_RECIPE = Object.freeze({ id: 'external:themealdb:42', source: 'external' });

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function serviceFixture() {
  const calls = [];
  const loads = [];
  const writes = [];
  return {
    calls,
    loads,
    writes,
    service: {
      listOwn(userId) {
        const pending = deferred();
        calls.push(['listOwn', userId]);
        loads.push({ userId, ...pending });
        return pending.promise;
      },
      addOwn(userId, recipeId) {
        const pending = deferred();
        calls.push(['addOwn', userId, recipeId]);
        writes.push({ kind: 'add', userId, recipeId, ...pending });
        return pending.promise;
      },
      removeOwn(userId, recipeId) {
        const pending = deferred();
        calls.push(['removeOwn', userId, recipeId]);
        writes.push({ kind: 'remove', userId, recipeId, ...pending });
        return pending.promise;
      },
    },
  };
}

function catalogResult(recipes, overrides = {}) {
  return {
    origin: 'database',
    databaseStatus: 'success',
    stale: false,
    catalog: { list: () => recipes },
    ...overrides,
  };
}

function adapterFor(fixture, guestFavorites = ['guest-only']) {
  let serviceCreations = 0;
  const client = Object.freeze({ fixture: 'ordinary-public-client' });
  const adapter = createDashboardAccountFavorites({
    client,
    guestFavorites,
    createService(receivedClient) {
      serviceCreations += 1;
      assert.equal(receivedClient, client);
      return fixture.service;
    },
  });
  assert.equal(serviceCreations, 1, 'The injected client must have exactly one Favorites service owner');
  return adapter;
}

const primaryFixture = serviceFixture();
const primary = adapterFor(primaryFixture);
assert.deepEqual(primary.getState(), {
  mode: 'guest',
  favoriteIds: ['guest-only'],
  pendingRecipeIds: [],
  message: '',
});
const initialSnapshot = primary.getState();
assert.equal(Object.isFrozen(initialSnapshot), true);
assert.equal(Object.isFrozen(initialSnapshot.favoriteIds), true);
assert.equal(Object.isFrozen(initialSnapshot.pendingRecipeIds), true);
assert.equal(await primary.handleAuthState({ status: 'loading', userId: null }), true);
assert.deepEqual(primary.getState(), {
  mode: 'account-loading',
  favoriteIds: [],
  pendingRecipeIds: [],
  message: 'Loading account favorites.',
});
assert.equal(primary.handleCatalogResult(catalogResult([RECIPE_A, RECIPE_B])), true);
const userALoad = primary.handleAuthState({ status: 'authenticated', userId: USER_A });
assert.deepEqual(primaryFixture.calls, [['listOwn', USER_A]]);
primaryFixture.loads[0].resolve({ data: [RECIPE_A.id], error: null });
assert.equal(await userALoad, true);
assert.deepEqual(primary.getState(), {
  mode: 'account-ready',
  favoriteIds: [RECIPE_A.id],
  pendingRecipeIds: [],
  message: '',
});
assert.equal(primaryFixture.calls.some(([name]) => name === 'addOwn'), false, 'Guest favorites must never import automatically');
assert.equal(await primary.handleAuthState({ status: 'authenticated', userId: USER_A }), true);
assert.equal(primaryFixture.calls.filter(([name]) => name === 'listOwn').length, 1, 'Repeated Auth events must not duplicate a ready load');

const switchWrite = primary.toggleFavorite(RECIPE_B);
await Promise.resolve();
const userBLoad = primary.handleAuthState({ status: 'authenticated', userId: USER_B });
primaryFixture.writes[0].resolve({ ok: true, recipeId: RECIPE_B.id, error: null });
assert.deepEqual(await switchWrite, { ok: false, code: 'STALE', recipeId: RECIPE_B.id });
assert.equal(primaryFixture.calls.filter(([name]) => name === 'listOwn').length, 2, 'User A stale work must not reconcile into User B');
primaryFixture.loads[1].resolve({ data: [RECIPE_B.id], error: null });
assert.equal(await userBLoad, true);
assert.deepEqual(primary.getState().favoriteIds, [RECIPE_B.id]);
assert.equal(await primary.handleAuthState({ status: 'guest', userId: null }), true);
assert.deepEqual(primary.getState().favoriteIds, ['guest-only']);

const logoutWriteFixture = serviceFixture();
const logoutWrite = adapterFor(logoutWriteFixture);
logoutWrite.handleCatalogResult(catalogResult([RECIPE_A]));
const logoutWriteLoad = logoutWrite.handleAuthState({ status: 'authenticated', userId: USER_A });
logoutWriteFixture.loads[0].resolve({ data: [], error: null });
await logoutWriteLoad;
const writeDuringLogout = logoutWrite.toggleFavorite(RECIPE_A);
await Promise.resolve();
await logoutWrite.handleAuthState({ status: 'guest', userId: null });
logoutWriteFixture.writes[0].resolve({ ok: true, recipeId: RECIPE_A.id, error: null });
assert.equal((await writeDuringLogout).code, 'STALE');
assert.deepEqual(logoutWrite.getState().favoriteIds, ['guest-only']);

const pendingLoadFixture = serviceFixture();
const pendingLoadAdapter = adapterFor(pendingLoadFixture);
const pendingAccountLoad = pendingLoadAdapter.handleAuthState({ status: 'authenticated', userId: USER_A });
await pendingLoadAdapter.handleAuthState({ status: 'guest', userId: null });
pendingLoadFixture.loads[0].resolve({ data: [RECIPE_A.id], error: null });
assert.equal(await pendingAccountLoad, false);
assert.deepEqual(pendingLoadAdapter.getState().favoriteIds, ['guest-only']);

const failedLoadFixture = serviceFixture();
const failedLoadAdapter = adapterFor(failedLoadFixture);
const failedLoad = failedLoadAdapter.handleAuthState({ status: 'authenticated', userId: USER_A });
failedLoadFixture.loads[0].resolve({
  data: null,
  error: { code: 'PRIVATE_PROVIDER_CODE', message: 'PRIVATE_PROVIDER_MESSAGE' },
});
assert.equal(await failedLoad, false);
assert.deepEqual(failedLoadAdapter.getState(), {
  mode: 'account-error',
  favoriteIds: [],
  pendingRecipeIds: [],
  message: 'Account favorites are unavailable.',
});
assert.doesNotMatch(JSON.stringify(failedLoadAdapter.getState()), /PRIVATE_PROVIDER|guest-only|11111111/);

const catalogFixture = serviceFixture();
const catalogAdapter = adapterFor(catalogFixture);
assert.equal(catalogAdapter.handleCatalogResult(catalogResult([])), true, 'Empty database success is authoritative');
assert.equal(catalogAdapter.handleCatalogResult({
  origin: 'built-in', databaseStatus: 'failed', stale: false, catalog: { list: () => [RECIPE_A] },
}), false);
assert.equal(catalogAdapter.handleCatalogResult(catalogResult([RECIPE_A, LIVE_RECIPE])), false, 'Transient overlays must fail closed');
assert.equal(catalogAdapter.handleCatalogResult(catalogResult([RECIPE_A], { stale: true })), false);
const catalogLoad = catalogAdapter.handleAuthState({ status: 'authenticated', userId: USER_A });
catalogFixture.loads[0].resolve({ data: [], error: null });
await catalogLoad;
assert.deepEqual(await catalogAdapter.toggleFavorite(RECIPE_A), {
  ok: false, code: 'INELIGIBLE', recipeId: null,
});

const reconciliationFixture = serviceFixture();
const reconciliation = adapterFor(reconciliationFixture);
reconciliation.handleCatalogResult(catalogResult([RECIPE_A, RECIPE_B]));
const reconciliationInitialLoad = reconciliation.handleAuthState({ status: 'authenticated', userId: USER_A });
reconciliationFixture.loads[0].resolve({ data: [], error: null });
await reconciliationInitialLoad;
const pendingA = reconciliation.toggleFavorite(RECIPE_A);
const pendingB = reconciliation.toggleFavorite(RECIPE_B);
await Promise.resolve();
reconciliation.handleCatalogResult(catalogResult([]));
reconciliationFixture.writes[0].resolve({ ok: true, recipeId: RECIPE_A.id, error: null });
reconciliationFixture.writes[1].resolve({ ok: true, recipeId: RECIPE_B.id, error: null });
assert.equal((await pendingA).code, 'STALE');
assert.equal((await pendingB).code, 'STALE');
assert.equal(
  reconciliationFixture.calls.filter(([name]) => name === 'listOwn').length,
  2,
  'Several stale writes must share one authoritative reload',
);
assert.equal(reconciliation.getState().mode, 'account-loading');
reconciliationFixture.loads[1].resolve({ data: null, error: { code: 'PRIVATE_RECONCILIATION_FAILURE' } });
await Promise.resolve();
await Promise.resolve();
assert.equal(reconciliation.getState().mode, 'account-error');
assert.equal(reconciliationFixture.calls.filter(([name]) => name === 'listOwn').length, 2, 'Failed reconciliation must not loop');

const deleteFixture = serviceFixture();
const deleteAdapter = adapterFor(deleteFixture);
deleteAdapter.handleCatalogResult(catalogResult([RECIPE_A]));
const deleteLoad = deleteAdapter.handleAuthState({ status: 'authenticated', userId: USER_A });
deleteFixture.loads[0].resolve({ data: [RECIPE_A.id], error: null });
await deleteLoad;
const pendingDelete = deleteAdapter.toggleFavorite(RECIPE_A);
await Promise.resolve();
deleteAdapter.handleCatalogResult(catalogResult([]));
deleteFixture.writes[0].resolve({ ok: true, recipeId: RECIPE_A.id, error: null });
assert.equal((await pendingDelete).code, 'STALE');
assert.equal(deleteFixture.calls.filter(([name]) => name === 'listOwn').length, 2);
deleteFixture.loads[1].resolve({ data: [], error: null });
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(deleteAdapter.getState().favoriteIds, []);

const cleanupFixture = serviceFixture();
const cleanupAdapter = adapterFor(cleanupFixture);
cleanupAdapter.handleCatalogResult(catalogResult([RECIPE_A]));
const cleanupLoad = cleanupAdapter.handleAuthState({ status: 'authenticated', userId: USER_A });
cleanupFixture.loads[0].resolve({ data: [], error: null });
await cleanupLoad;
const cleanupWrite = cleanupAdapter.toggleFavorite(RECIPE_A);
await Promise.resolve();
assert.equal(cleanupAdapter.cleanup(), true);
assert.equal(cleanupAdapter.cleanup(), false);
cleanupFixture.writes[0].resolve({ ok: true, recipeId: RECIPE_A.id, error: null });
assert.equal((await cleanupWrite).code, 'STALE');
assert.deepEqual(await cleanupAdapter.toggleFavorite(RECIPE_A), {
  ok: false, code: 'RETIRED', recipeId: null,
});

const invalidAuthFixture = serviceFixture();
const invalidAuth = adapterFor(invalidAuthFixture);
await invalidAuth.handleAuthState({ status: 'authenticated', userId: 'not-a-uuid' });
assert.equal(invalidAuth.getState().mode, 'account-error');
assert.equal(invalidAuthFixture.calls.length, 0);

const invalidRecipeFixture = serviceFixture();
const invalidRecipeAdapter = adapterFor(invalidRecipeFixture);
invalidRecipeAdapter.handleCatalogResult(catalogResult([RECIPE_A]));
const invalidRecipeLoad = invalidRecipeAdapter.handleAuthState({ status: 'authenticated', userId: USER_A });
invalidRecipeFixture.loads[0].resolve({ data: [], error: null });
await invalidRecipeLoad;
const invalidRecipes = [
  null,
  {},
  { id: null, source: 'database' },
  { id: 'UPPERCASE', source: 'database' },
  { id: 'has spaces', source: 'database' },
  { id: RECIPE_A.id, source: 'external' },
  new Proxy({}, { get(_target, property) {
    if (property === 'id') throw new Error('PRIVATE_RECIPE_ID_GETTER');
    return 'database';
  } }),
  new Proxy({ id: RECIPE_A.id }, { get(target, property) {
    if (property === 'source') throw new Error('PRIVATE_RECIPE_SOURCE_GETTER');
    return target[property];
  } }),
];
for (const invalidRecipe of invalidRecipes) {
  const operation = invalidRecipeAdapter.toggleFavorite(invalidRecipe);
  assert.deepEqual(invalidRecipeAdapter.getState().pendingRecipeIds, []);
  assert.deepEqual(await operation, { ok: false, code: 'INELIGIBLE', recipeId: null });
  assert.deepEqual(invalidRecipeAdapter.getState().pendingRecipeIds, []);
}
assert.equal(invalidRecipeFixture.calls.some(([name]) => name === 'addOwn' || name === 'removeOwn'), false);

invalidRecipeAdapter.handleCatalogResult(catalogResult([RECIPE_A, RECIPE_B]));
let changingRecipeIdReads = 0;
const changingRecipeId = {
  source: 'database',
  get id() {
    changingRecipeIdReads += 1;
    return changingRecipeIdReads === 1 ? RECIPE_A.id : RECIPE_B.id;
  },
};
const capturedIdWrite = invalidRecipeAdapter.toggleFavorite(changingRecipeId);
assert.deepEqual(invalidRecipeAdapter.getState().pendingRecipeIds, [RECIPE_A.id]);
await Promise.resolve();
assert.equal(changingRecipeIdReads, 1);
assert.deepEqual(invalidRecipeFixture.calls.at(-1), ['addOwn', USER_A, RECIPE_A.id]);
invalidRecipeFixture.writes[0].resolve({ ok: true, recipeId: RECIPE_A.id, error: null });
assert.deepEqual(await capturedIdWrite, { ok: true, code: 'SUCCESS', recipeId: RECIPE_A.id });
assert.deepEqual(invalidRecipeAdapter.getState().favoriteIds, [RECIPE_A.id]);

let changingRecipeSourceReads = 0;
const changingRecipeSource = {
  id: RECIPE_B.id,
  get source() {
    changingRecipeSourceReads += 1;
    return changingRecipeSourceReads === 1 ? 'database' : 'external';
  },
};
const capturedSourceWrite = invalidRecipeAdapter.toggleFavorite(changingRecipeSource);
assert.deepEqual(invalidRecipeAdapter.getState().pendingRecipeIds, [RECIPE_B.id]);
await Promise.resolve();
assert.equal(changingRecipeSourceReads, 1);
assert.deepEqual(invalidRecipeFixture.calls.at(-1), ['addOwn', USER_A, RECIPE_B.id]);
invalidRecipeFixture.writes[1].resolve({ ok: true, recipeId: RECIPE_B.id, error: null });
assert.deepEqual(await capturedSourceWrite, { ok: true, code: 'SUCCESS', recipeId: RECIPE_B.id });
assert.deepEqual(new Set(invalidRecipeAdapter.getState().favoriteIds), new Set([RECIPE_A.id, RECIPE_B.id]));

const staleCatalogFixture = serviceFixture();
const staleCatalogAdapter = adapterFor(staleCatalogFixture);
assert.equal(staleCatalogAdapter.handleCatalogResult(catalogResult([RECIPE_A])), true);
assert.equal(staleCatalogAdapter.handleCatalogResult(catalogResult([], { stale: true })), false);
const staleCatalogLoad = staleCatalogAdapter.handleAuthState({ status: 'authenticated', userId: USER_A });
staleCatalogFixture.loads[0].resolve({ data: [], error: null });
await staleCatalogLoad;
const retainedEligibilityWrite = staleCatalogAdapter.toggleFavorite(RECIPE_A);
await Promise.resolve();
assert.deepEqual(staleCatalogFixture.calls.at(-1), ['addOwn', USER_A, RECIPE_A.id]);
staleCatalogFixture.writes[0].resolve({ ok: true, recipeId: RECIPE_A.id, error: null });
assert.equal((await retainedEligibilityWrite).code, 'SUCCESS');

async function beginReconciliation(fixture, adapter) {
  adapter.handleCatalogResult(catalogResult([RECIPE_A]));
  const load = adapter.handleAuthState({ status: 'authenticated', userId: USER_A });
  fixture.loads[0].resolve({ data: [], error: null });
  await load;
  const write = adapter.toggleFavorite(RECIPE_A);
  await Promise.resolve();
  adapter.handleCatalogResult(catalogResult([]));
  fixture.writes[0].resolve({ ok: true, recipeId: RECIPE_A.id, error: null });
  assert.equal((await write).code, 'STALE');
  assert.equal(fixture.loads.length, 2);
}

const reconciliationSwitchFixture = serviceFixture();
const reconciliationSwitch = adapterFor(reconciliationSwitchFixture);
await beginReconciliation(reconciliationSwitchFixture, reconciliationSwitch);
const reconciliationUserBLoad = reconciliationSwitch.handleAuthState({ status: 'authenticated', userId: USER_B });
reconciliationSwitchFixture.loads[1].resolve({ data: [RECIPE_A.id], error: null });
await Promise.resolve();
assert.equal(reconciliationSwitch.getState().mode, 'account-loading');
reconciliationSwitchFixture.loads[2].resolve({ data: [RECIPE_B.id], error: null });
assert.equal(await reconciliationUserBLoad, true);
assert.deepEqual(reconciliationSwitch.getState().favoriteIds, [RECIPE_B.id]);

const reconciliationLogoutFixture = serviceFixture();
const reconciliationLogout = adapterFor(reconciliationLogoutFixture);
await beginReconciliation(reconciliationLogoutFixture, reconciliationLogout);
await reconciliationLogout.handleAuthState({ status: 'guest', userId: null });
reconciliationLogoutFixture.loads[1].resolve({ data: [RECIPE_A.id], error: null });
await Promise.resolve();
assert.deepEqual(reconciliationLogout.getState(), {
  mode: 'guest',
  favoriteIds: ['guest-only'],
  pendingRecipeIds: [],
  message: '',
});

const reconciliationSameUserFixture = serviceFixture();
const reconciliationSameUser = adapterFor(reconciliationSameUserFixture);
await beginReconciliation(reconciliationSameUserFixture, reconciliationSameUser);
assert.equal(await reconciliationSameUser.handleAuthState({ status: 'authenticated', userId: USER_A }), true);
assert.equal(reconciliationSameUserFixture.calls.filter(([name]) => name === 'listOwn').length, 2);
reconciliationSameUserFixture.loads[1].resolve({ data: [], error: null });
await Promise.resolve();
assert.equal(reconciliationSameUser.getState().mode, 'account-ready');

assert.throws(
  () => createDashboardAccountFavorites({
    client: {},
    createService() { throw new Error('PRIVATE_FACTORY_FAILURE'); },
  }),
  (error) => error instanceof TypeError
    && error.message === 'Dashboard account favorites initialization failed.'
    && !JSON.stringify(error).includes('PRIVATE_FACTORY_FAILURE'),
);
assert.throws(
  () => createDashboardAccountFavorites({
    client: {},
    guestFavorites: new Proxy([], { get() { throw new Error('PRIVATE_GUEST_ITERATOR'); } }),
    createService: () => serviceFixture().service,
  }),
  (error) => error instanceof TypeError
    && error.message === 'Dashboard account favorites initialization failed.'
    && !JSON.stringify(error).includes('PRIVATE_GUEST_ITERATOR'),
);

const source = await readFile(new URL('../js/dashboard-account-favorites.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /createClient|supabase-config|service.?role|sb_secret_|access_token|refresh_token|password|console\.|localStorage|sessionStorage|document\.|window\./i);
assert.doesNotMatch(source, /\.upsert\s*\(|\.update\s*\(|innerHTML|insertAdjacentHTML/);

console.log('Offline dashboard account Favorites lifecycle tests passed with injected fake services only.');
