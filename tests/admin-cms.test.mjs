import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ADMIN_CMS_STATUS, createAdminCmsCoordinator } from '../js/admin-cms.js';
import {
  createAdminPageActivation,
  filterAdminRecipes,
  renderAdminCmsState,
} from '../js/admin-browser.js';
import { AUTH_SESSION_STATUS } from '../js/auth-session.js';
import { ADMIN_ACCESS_STATUS } from '../js/supabase-admin-access.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function dependencies({ access, recipes } = {}) {
  const counts = { access: 0, recipes: 0, accessInvalidations: 0, recipeInvalidations: 0 };
  return {
    counts,
    adminAccess: {
      check() { counts.access += 1; return typeof access === 'function' ? access() : Promise.resolve(access); },
      invalidate() { counts.accessInvalidations += 1; return true; },
      cleanup() { return true; },
    },
    recipeSource: {
      listAll() { counts.recipes += 1; return typeof recipes === 'function' ? recipes() : Promise.resolve(recipes); },
      invalidate() { counts.recipeInvalidations += 1; return true; },
      cleanup() { return true; },
    },
  };
}

const guestDeps = dependencies();
const guest = createAdminCmsCoordinator(guestDeps);
await guest.acceptAuthState({ status: AUTH_SESSION_STATUS.GUEST, user: null });
assert.equal(guest.getState().status, ADMIN_CMS_STATUS.GUEST);
assert.equal(guestDeps.counts.access, 0);
assert.equal(guestDeps.counts.recipes, 0);

const deniedDeps = dependencies({
  access: { status: ADMIN_ACCESS_STATUS.DENIED },
  recipes: { data: [], error: null },
});
const denied = createAdminCmsCoordinator(deniedDeps);
await denied.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
assert.equal(denied.getState().status, ADMIN_CMS_STATUS.DENIED);
assert.equal(deniedDeps.counts.recipes, 0, 'Regular users must never request privileged recipe data');

const recipes = Object.freeze([Object.freeze({
  id: 'cms:one', name: 'Safe <Recipe>', category: 'Dinner', cuisine: 'Filipino', status: 'draft',
})]);
const adminDeps = dependencies({
  access: { status: ADMIN_ACCESS_STATUS.AUTHORIZED },
  recipes: { data: recipes, error: null },
});
const admin = createAdminCmsCoordinator(adminDeps);
await admin.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
assert.deepEqual(admin.getState(), { status: ADMIN_CMS_STATUS.READY, recipes });
assert.equal(adminDeps.counts.access, 1);
assert.equal(adminDeps.counts.recipes, 1);
await admin.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
assert.equal(adminDeps.counts.access, 1, 'Repeated same-user Auth events must not reload ready state');

for (const access of [
  { status: ADMIN_ACCESS_STATUS.UNAVAILABLE },
  { status: ADMIN_ACCESS_STATUS.STALE },
]) {
  const deps = dependencies({ access, recipes: { data: recipes, error: null } });
  const coordinator = createAdminCmsCoordinator(deps);
  await coordinator.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
  assert.equal(coordinator.getState().status, ADMIN_CMS_STATUS.ERROR);
  assert.equal(deps.counts.recipes, 0);
}

const malformedDeps = dependencies({
  access: { status: ADMIN_ACCESS_STATUS.AUTHORIZED },
  recipes: { data: null, error: { message: 'PRIVATE' } },
});
const malformed = createAdminCmsCoordinator(malformedDeps);
await malformed.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
assert.equal(malformed.getState().status, ADMIN_CMS_STATUS.ERROR);
assert.deepEqual(malformed.getState().recipes, []);

await admin.acceptAuthState({ status: AUTH_SESSION_STATUS.ERROR, user: null });
assert.equal(admin.getState().status, ADMIN_CMS_STATUS.ERROR);
assert.deepEqual(admin.getState().recipes, [], 'Expired sessions must immediately hide recipe data');

const switchAccessA = deferred();
const switchAccessB = deferred();
let accessIndex = 0;
const switchDeps = dependencies({
  access: () => [switchAccessA.promise, switchAccessB.promise][accessIndex++],
  recipes: { data: recipes, error: null },
});
const switching = createAdminCmsCoordinator(switchDeps);
const userARequest = switching.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
assert.equal(switching.getState().status, ADMIN_CMS_STATUS.CHECKING);
const userBRequest = switching.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_B } });
switchAccessA.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
await userARequest;
assert.equal(switchDeps.counts.recipes, 0, 'User A authorization must not load after an account switch');
switchAccessB.resolve({ status: ADMIN_ACCESS_STATUS.DENIED });
await userBRequest;
assert.equal(switching.getState().status, ADMIN_CMS_STATUS.DENIED);

const lateAccess = deferred();
const lateDeps = dependencies({ access: () => lateAccess.promise, recipes: { data: recipes, error: null } });
const late = createAdminCmsCoordinator(lateDeps);
const lateRequest = late.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
await late.acceptAuthState({ status: AUTH_SESSION_STATUS.GUEST, user: null });
lateAccess.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
await lateRequest;
assert.equal(late.getState().status, ADMIN_CMS_STATUS.GUEST);
assert.equal(lateDeps.counts.recipes, 0);

const cleanupAccess = deferred();
const cleanupDeps = dependencies({ access: () => cleanupAccess.promise, recipes: { data: recipes, error: null } });
const cleanup = createAdminCmsCoordinator(cleanupDeps);
const cleanupRequest = cleanup.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
assert.equal(cleanup.cleanup(), true);
cleanupAccess.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
await cleanupRequest;
assert.equal(cleanup.getState().status, ADMIN_CMS_STATUS.RETIRED);

const refreshedRecipes = Object.freeze([Object.freeze({
  id: 'cms:two', name: 'Refreshed Draft', category: 'Lunch', cuisine: 'Filipino', status: 'draft',
})]);
let refreshRows = recipes;
const refreshDeps = dependencies({
  access: { status: ADMIN_ACCESS_STATUS.AUTHORIZED },
  recipes: () => Promise.resolve({ data: refreshRows, error: null }),
});
const refreshing = createAdminCmsCoordinator(refreshDeps);
await refreshing.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
refreshRows = refreshedRecipes;
assert.equal(await refreshing.refreshRecipes(), true);
assert.deepEqual(refreshing.getState(), { status: ADMIN_CMS_STATUS.READY, recipes: refreshedRecipes });
assert.equal(refreshDeps.counts.access, 2, 'Refresh must reverify administrator access');
assert.equal(refreshDeps.counts.recipes, 2, 'Refresh must replace the catalog through the recipe source');

const duplicateRefreshAccess = deferred();
let duplicateAccessCount = 0;
const duplicateRefreshDeps = dependencies({
  access: () => {
    duplicateAccessCount += 1;
    return duplicateAccessCount === 1
      ? Promise.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED })
      : duplicateRefreshAccess.promise;
  },
  recipes: { data: recipes, error: null },
});
const duplicateRefresh = createAdminCmsCoordinator(duplicateRefreshDeps);
await duplicateRefresh.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
const firstRefresh = duplicateRefresh.refreshRecipes();
const secondRefresh = duplicateRefresh.refreshRecipes();
assert.equal(firstRefresh, secondRefresh, 'Concurrent refreshes must share one authorization request');
duplicateRefreshAccess.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
await firstRefresh;
assert.equal(duplicateRefreshDeps.counts.access, 2);
assert.equal(duplicateRefreshDeps.counts.recipes, 2);

for (const [access, expectedStatus] of [
  [{ status: ADMIN_ACCESS_STATUS.DENIED }, ADMIN_CMS_STATUS.DENIED],
  [{ status: ADMIN_ACCESS_STATUS.UNAVAILABLE }, ADMIN_CMS_STATUS.ERROR],
]) {
  let checkCount = 0;
  const deps = dependencies({
    access: () => Promise.resolve(checkCount++ === 0
      ? { status: ADMIN_ACCESS_STATUS.AUTHORIZED }
      : access),
    recipes: { data: recipes, error: null },
  });
  const coordinator = createAdminCmsCoordinator(deps);
  await coordinator.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
  assert.equal(await coordinator.refreshRecipes(), true);
  assert.equal(coordinator.getState().status, expectedStatus);
  assert.deepEqual(coordinator.getState().recipes, [], 'Refresh failures must clear privileged rows');
  assert.equal(deps.counts.recipes, 1, 'Denied or unavailable refresh authorization must not query recipes');
}

let providerRecipeCount = 0;
const providerFailureDeps = dependencies({
  access: () => Promise.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED }),
  recipes: () => Promise.resolve(providerRecipeCount++ === 0
    ? { data: recipes, error: null }
    : { data: null, error: { message: 'PRIVATE provider failure' } }),
});
const providerFailure = createAdminCmsCoordinator(providerFailureDeps);
await providerFailure.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
assert.equal(await providerFailure.refreshRecipes(), true);
assert.equal(providerFailure.getState().status, ADMIN_CMS_STATUS.ERROR);
assert.deepEqual(providerFailure.getState().recipes, []);
assert.equal(providerFailureDeps.counts.access, 2, 'Provider refresh failure occurs after reauthorization');
assert.equal(providerFailureDeps.counts.recipes, 2, 'Provider refresh failure remains distinct from access denial');

const lateRefreshAccess = deferred();
let lateRefreshChecks = 0;
const lateRefreshDeps = dependencies({
  access: () => lateRefreshChecks++ === 0
    ? Promise.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED })
    : lateRefreshAccess.promise,
  recipes: { data: recipes, error: null },
});
const lateRefresh = createAdminCmsCoordinator(lateRefreshDeps);
await lateRefresh.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
const lateRefreshRequest = lateRefresh.refreshRecipes();
await lateRefresh.acceptAuthState({ status: AUTH_SESSION_STATUS.GUEST, user: null });
lateRefreshAccess.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
await lateRefreshRequest;
assert.equal(lateRefresh.getState().status, ADMIN_CMS_STATUS.GUEST);
assert.equal(lateRefreshDeps.counts.recipes, 1, 'A refresh completing after logout must not reload rows');

const switchRefreshAccess = deferred();
let switchRefreshChecks = 0;
const switchRefreshDeps = dependencies({
  access: () => switchRefreshChecks++ === 0
    ? Promise.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED })
    : switchRefreshAccess.promise,
  recipes: { data: recipes, error: null },
});
const switchRefresh = createAdminCmsCoordinator(switchRefreshDeps);
await switchRefresh.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
const accountARefresh = switchRefresh.refreshRecipes();
const accountBState = switchRefresh.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_B } });
switchRefreshAccess.resolve({ status: ADMIN_ACCESS_STATUS.DENIED });
await Promise.all([accountARefresh, accountBState]);
assert.equal(switchRefresh.getState().status, ADMIN_CMS_STATUS.DENIED);
assert.equal(switchRefreshDeps.counts.recipes, 1, 'Account A refresh must not load rows for Account B');

const cleanupRefreshAccess = deferred();
let cleanupRefreshChecks = 0;
const cleanupRefreshDeps = dependencies({
  access: () => cleanupRefreshChecks++ === 0
    ? Promise.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED })
    : cleanupRefreshAccess.promise,
  recipes: { data: recipes, error: null },
});
const cleanupRefresh = createAdminCmsCoordinator(cleanupRefreshDeps);
await cleanupRefresh.acceptAuthState({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
const cleanupRefreshRequest = cleanupRefresh.refreshRecipes();
assert.equal(cleanupRefresh.cleanup(), true);
cleanupRefreshAccess.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
await cleanupRefreshRequest;
assert.equal(cleanupRefresh.getState().status, ADMIN_CMS_STATUS.RETIRED);

function element() {
  const listeners = new Map();
  return {
    hidden: false, disabled: false, textContent: '', value: '', dataset: {}, children: [],
    classList: { toggle(name, value) { this[name] = value; } },
    setAttribute(name, value) { this[name] = value; },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    emit(name) { listeners.get(name)?.(); },
  };
}
const elements = {
  root: element(), status: element(), content: element(), rows: element(), empty: element(),
  search: element(), statusFilter: element(), count: element(), create: element(),
  signIn: element(), logout: element(),
};
elements.statusFilter.value = 'all';
const fakeDocument = { createElement() { return element(); } };
assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.CHECKING, recipes: [] }, fakeDocument), true);
assert.equal(elements.content.hidden, true);
assert.equal(elements.rows.children.length, 0);
assert.equal(elements.signIn.hidden, true, 'Loading state hides Sign In');
assert.equal(elements.logout.hidden, true, 'Loading state hides Sign Out');
assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.GUEST, recipes: [] }, fakeDocument, '', 'all', null, false), true);
assert.equal(elements.signIn.hidden, false, 'Signed-out state shows Sign In');
assert.equal(elements.logout.hidden, true, 'Signed-out state hides Sign Out');
assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.DENIED, recipes: [] }, fakeDocument, '', 'all', null, true), true);
assert.equal(elements.signIn.hidden, true, 'Authenticated denied state hides Sign In');
assert.equal(elements.logout.hidden, false, 'Authenticated denied state shows Sign Out');
assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.READY, recipes }, fakeDocument), true);
assert.equal(elements.content.hidden, false);
assert.equal(elements.rows.children.length, 1);
assert.equal(elements.rows.children[0].children[0].textContent, 'Safe <Recipe>');
assert.equal('innerHTML' in elements.rows.children[0].children[0], false);
assert.equal(filterAdminRecipes(recipes, 'filipino').length, 1);
assert.equal(filterAdminRecipes(recipes, 'published').length, 0);
assert.equal(filterAdminRecipes(recipes, '', 'draft').length, 1);
assert.equal(elements.count.textContent, '1 recipe');
assert.equal(elements.create.disabled, true, 'Live activation remains read only without injected fake services');

const pageElements = {
  root: element(), status: element(), content: element(), rows: element(), empty: element(),
  search: element(), statusFilter: element(), count: element(), create: element(),
  signIn: element(), logout: element(),
};
pageElements.statusFilter.value = 'all';
const pageSelectors = new Map([
  ['[data-admin-status]', pageElements.status],
  ['[data-admin-content]', pageElements.content],
  ['[data-admin-rows]', pageElements.rows],
  ['[data-admin-empty]', pageElements.empty],
  ['[data-admin-search]', pageElements.search],
  ['[data-admin-status-filter]', pageElements.statusFilter],
  ['[data-admin-count]', pageElements.count],
  ['[data-admin-create]', pageElements.create],
  ['[data-admin-sign-in]', pageElements.signIn],
  ['[data-admin-logout]', pageElements.logout],
]);
pageElements.root.querySelector = (selector) => pageSelectors.get(selector) ?? null;
const pageDocument = {
  querySelector(selector) { return selector === '[data-admin-app]' ? pageElements.root : null; },
  createElement() { return element(); },
};
const sharedClient = { auth: {} };
const acceptedClients = [];
const editorAuthorizations = [];
let ownerCreations = 0;
let sessionListener;
let editorCallbacks;
let pageAccessStatus = ADMIN_ACCESS_STATUS.AUTHORIZED;
let pageRecipeRows = recipes;
let pageRecipeLoads = 0;
let optionalSavedObservers = 0;
let optionalAuthorizationObservers = 0;
const page = createAdminPageActivation({
  documentLike: pageDocument,
  sdk: {},
  loadConfig: async () => ({ SUPABASE_CONFIG: { fictional: true } }),
  createClientOwner(options) {
    ownerCreations += 1;
    assert.equal(options.profile, 'application-session');
    return { initialize(profile) { assert.equal(profile, 'application-session'); return sharedClient; } };
  },
  createAccessService(client) {
    acceptedClients.push(client);
    return {
      check: async () => ({ status: pageAccessStatus }),
      invalidate: () => true,
      cleanup: () => true,
    };
  },
  createRecipeSource(client) {
    acceptedClients.push(client);
    return {
      listAll: async () => { pageRecipeLoads += 1; return { data: pageRecipeRows, error: null }; },
      invalidate: () => true,
      cleanup: () => true,
    };
  },
  createMutationService(client) {
    acceptedClients.push(client);
    return { createDraft() {}, editDraft() {}, invalidate() {}, cleanup() {} };
  },
  createTaxonomySource(client) {
    acceptedClients.push(client);
    return { listCategories() {}, listCuisines() {}, invalidate() {}, cleanup() {} };
  },
  createEditor({ mutationService, taxonomySource, onSaved, onAuthorizationLost }) {
    assert.equal(typeof mutationService.createDraft, 'function');
    assert.equal(typeof taxonomySource.listCategories, 'function');
    editorCallbacks = { onSaved, onAuthorizationLost };
    return {
      openCreate: async () => true,
      openEdit: async () => true,
      setAuthorization(authorized, userId) { editorAuthorizations.push([authorized, userId]); return true; },
      cleanup: () => true,
    };
  },
  createSessionService(client) {
    acceptedClients.push(client);
    return {
      subscribe(listener) { sessionListener = listener; listener({ status: AUTH_SESSION_STATUS.LOADING, user: null }); return () => true; },
      async bootstrap() {
        sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
        return { status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } };
      },
      async logout() { sessionListener({ status: AUTH_SESSION_STATUS.GUEST, user: null }); },
      cleanup() { return true; },
    };
  },
  async onSaved() { optionalSavedObservers += 1; throw new Error('Optional observer failure'); },
  onAuthorizationLost() { optionalAuthorizationObservers += 1; throw new Error('Optional observer failure'); },
});
assert.equal(await page.activate(), true);
await Promise.resolve();
await Promise.resolve();
assert.equal(ownerCreations, 1);
assert.deepEqual(acceptedClients, [sharedClient, sharedClient, sharedClient, sharedClient, sharedClient]);
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.READY);
assert.deepEqual(editorAuthorizations.at(-1), [true, USER_A]);
assert.equal(pageElements.signIn.hidden, true);
assert.equal(pageElements.logout.hidden, false);
assert.equal(pageElements.rows.children.length, 1);
pageRecipeRows = refreshedRecipes;
editorCallbacks.onSaved({ id: 'cms:created' });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageRecipeLoads, 2, 'Confirmed create must trigger exactly one catalog refresh');
assert.equal(pageElements.rows.children[0].children[0].textContent, 'Refreshed Draft');
editorCallbacks.onSaved({ id: 'cms:edited' });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageRecipeLoads, 3, 'Confirmed edit must trigger exactly one catalog refresh');
assert.equal(optionalSavedObservers, 2, 'Optional observers remain independent from both refreshes');
pageElements.search.value = 'missing';
pageElements.search.emit('input');
assert.equal(pageElements.rows.children.length, 0);
assert.equal(pageElements.empty.hidden, false);
pageAccessStatus = ADMIN_ACCESS_STATUS.DENIED;
editorCallbacks.onAuthorizationLost();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.DENIED);
assert.equal(pageElements.rows.children.length, 0, 'Authorization loss must clear privileged catalog rows');
assert.equal(optionalAuthorizationObservers, 1);
pageAccessStatus = ADMIN_ACCESS_STATUS.AUTHORIZED;
pageElements.logout.emit('click');
await Promise.resolve();
assert.deepEqual(editorAuthorizations.at(-1), [false, null]);
assert.equal(pageElements.signIn.hidden, false);
assert.equal(pageElements.logout.hidden, true);
assert.equal(page.cleanup(), true);
assert.equal(page.cleanup(), false);
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.RETIRED);

const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(html, /data-admin-app/);
assert.match(html, /data-admin-content hidden/);
assert.match(html, /data-admin-search disabled/);
assert.match(html, /data-admin-editor-form/);
assert.match(html, /data-error-for="form"/);
assert.match(html, /data-admin-create disabled/);
assert.doesNotMatch(html, /\b(?:Delete|Publish|Unpublish)\b/);
const css = await readFile(new URL('../admin.css', import.meta.url), 'utf8');
assert.match(css, /background-position:right 16px center/);
assert.match(css, /\.admin-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
const browserSource = await readFile(new URL('../js/admin-browser.js', import.meta.url), 'utf8');
assert.doesNotMatch(browserSource, /innerHTML|insertAdjacentHTML|document\.write|service_role|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/i);
assert.doesNotMatch(browserSource, /supabase-admin-recipe-mutations|supabase-admin-taxonomies/);

console.log('Offline Admin CMS authorization and read-only UI tests passed with fakes only.');
