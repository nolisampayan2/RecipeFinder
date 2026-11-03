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
  search: element(), signIn: element(), logout: element(),
};
const fakeDocument = { createElement() { return element(); } };
assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.CHECKING, recipes: [] }, fakeDocument), true);
assert.equal(elements.content.hidden, true);
assert.equal(elements.rows.children.length, 0);
assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.READY, recipes }, fakeDocument), true);
assert.equal(elements.content.hidden, false);
assert.equal(elements.rows.children.length, 1);
assert.equal(elements.rows.children[0].children[0].textContent, 'Safe <Recipe>');
assert.equal('innerHTML' in elements.rows.children[0].children[0], false);
assert.equal(filterAdminRecipes(recipes, 'filipino').length, 1);
assert.equal(filterAdminRecipes(recipes, 'published').length, 0);

const pageElements = {
  root: element(), status: element(), content: element(), rows: element(), empty: element(),
  search: element(), signIn: element(), logout: element(),
};
const pageSelectors = new Map([
  ['[data-admin-status]', pageElements.status],
  ['[data-admin-content]', pageElements.content],
  ['[data-admin-rows]', pageElements.rows],
  ['[data-admin-empty]', pageElements.empty],
  ['[data-admin-search]', pageElements.search],
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
let ownerCreations = 0;
let sessionListener;
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
      check: async () => ({ status: ADMIN_ACCESS_STATUS.AUTHORIZED }),
      invalidate: () => true,
      cleanup: () => true,
    };
  },
  createRecipeSource(client) {
    acceptedClients.push(client);
    return {
      listAll: async () => ({ data: recipes, error: null }),
      invalidate: () => true,
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
});
assert.equal(await page.activate(), true);
await Promise.resolve();
await Promise.resolve();
assert.equal(ownerCreations, 1);
assert.deepEqual(acceptedClients, [sharedClient, sharedClient, sharedClient]);
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.READY);
assert.equal(pageElements.rows.children.length, 1);
pageElements.search.value = 'missing';
pageElements.search.emit('input');
assert.equal(pageElements.rows.children.length, 0);
assert.equal(pageElements.empty.hidden, false);
assert.equal(page.cleanup(), true);
assert.equal(page.cleanup(), false);
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.RETIRED);

const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(html, /data-admin-app/);
assert.match(html, /data-admin-content hidden/);
assert.match(html, /data-admin-search disabled/);
assert.doesNotMatch(html, /\b(?:Create|Edit|Delete|Publish|Unpublish)\b/);
const browserSource = await readFile(new URL('../js/admin-browser.js', import.meta.url), 'utf8');
assert.doesNotMatch(browserSource, /innerHTML|insertAdjacentHTML|document\.write|service_role|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/i);

console.log('Offline Admin CMS authorization and read-only UI tests passed with fakes only.');
