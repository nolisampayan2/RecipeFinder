import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ADMIN_CMS_STATUS, createAdminCmsCoordinator } from '../js/admin-cms.js';
import {
  createAdminDrawerController,
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
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
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
  id: 'cms:one', name: 'Safe <Recipe>', category: 'Dinner', cuisine: 'Filipino', status: 'draft', sourceType: 'cms',
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
  id: 'cms:two', name: 'Refreshed Draft', category: 'Lunch', cuisine: 'Filipino', status: 'draft', sourceType: 'cms',
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
    hidden: false, disabled: false, inert: false, textContent: '', value: '', dataset: {}, children: [], focusables: [],
    classList: { toggle(name, value) { this[name] = value; } },
    setAttribute(name, value) { this[name] = name === 'inert' ? true : value; },
    removeAttribute(name) { if (name === 'inert') this.inert = false; else delete this[name]; },
    getAttribute(name) { return this[name] ?? null; },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    emit(name, event = {}) { return listeners.get(name)?.(event); },
    querySelectorAll() { return this.focusables; },
    querySelector(selector) { return selector === '[aria-current="page"]' ? this.activeLink ?? null : null; },
    focus() { this.ownerDocument && (this.ownerDocument.activeElement = this); this.focused = true; },
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
assert.equal(elements.rows.children[0].children[0].headers, 'admin-recipe-column');
assert.equal(elements.rows.children[0].children[0]['data-label'], 'Recipe');
assert.equal(elements.rows.children[0].children[1].headers, 'admin-category-column');
assert.equal(elements.rows.children[0].children[1]['data-label'], 'Category');
assert.equal(elements.rows.children[0].children[2].headers, 'admin-cuisine-column');
assert.equal(elements.rows.children[0].children[2]['data-label'], 'Cuisine');
assert.equal(elements.rows.children[0].children[3].headers, 'admin-status-column');
assert.equal(elements.rows.children[0].children[3]['data-label'], 'Status');
assert.equal(elements.rows.children[0].children[4].headers, 'admin-action-column');
assert.equal(elements.rows.children[0].children[4]['data-label'], 'Action');
assert.equal(filterAdminRecipes(recipes, 'filipino').length, 1);
assert.equal(filterAdminRecipes(recipes, 'published').length, 0);
assert.equal(filterAdminRecipes(recipes, '', 'draft').length, 1);
assert.equal(elements.count.textContent, '1 recipe');
assert.equal(elements.create.disabled, true, 'Live activation remains read only without injected fake services');

const longName = `Long <Recipe> & safe ${'name '.repeat(45)}`.trim();
const mobileRecipes = Object.freeze([
  Object.freeze({ id: 'cms:mobile-draft', name: longName, category: 'Dinner', cuisine: 'Filipino', status: 'draft', sourceType: 'cms' }),
  Object.freeze({ id: 'cms:published', name: 'Published CMS Recipe', category: 'Lunch', cuisine: 'Filipino', status: 'published', sourceType: 'cms' }),
  Object.freeze({ id: 'external:provider:one', name: 'External Draft', category: 'Lunch', cuisine: 'Other', status: 'draft', sourceType: 'external' }),
]);
const editedRecipeIds = [];
const mobileEditor = { openEdit(id) { editedRecipeIds.push(id); return Promise.resolve(true); } };
assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.READY, recipes: mobileRecipes }, fakeDocument, '', 'all', mobileEditor), true);
assert.equal(elements.rows.children.length, 3);
assert.equal(elements.rows.children[0].children[0].textContent, longName, 'Long names remain complete text content');
assert.equal('innerHTML' in elements.rows.children[0].children[0], false, 'Recipe text is never interpreted as markup');
const editableAction = elements.rows.children[0].children[4].children[0];
assert.equal(editableAction.disabled, false);
editableAction.emit('click');
assert.deepEqual(editedRecipeIds, ['cms:mobile-draft'], 'Edit action must retain the exact recipe identity');
assert.equal(elements.rows.children[1].children[4].children[0].disabled, true, 'Published recipes remain read only');
assert.equal(elements.rows.children[2].children[4].children[0].disabled, true, 'Non-CMS recipes remain read only');
for (const [id, sourceType, status, editable] of [
  ['cms:valid', 'cms', 'draft', true],
  ['legacy-cms-id', 'cms', 'draft', true],
  ['cms:external', 'external', 'draft', false],
  ['cms:seed', 'seed', 'draft', false],
  ['cms:missing', undefined, 'draft', false],
  ['cms:malformed', 'other', 'draft', false],
  ['cms:published', 'cms', 'published', false],
]) {
  const candidate = Object.freeze({ id, sourceType, status, name: 'Candidate', category: 'Dinner', cuisine: 'Filipino' });
  assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.READY, recipes: [candidate] }, fakeDocument, '', 'all', mobileEditor), true);
  assert.equal(elements.rows.children[0].children[4].children[0].disabled, !editable, `${sourceType} ${status} ${id}`);
}
assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.READY, recipes: mobileRecipes }, fakeDocument, '', 'all', mobileEditor), true);
assert.equal(elements.count.textContent, '3 recipes');
assert.equal(renderAdminCmsState(elements, { status: ADMIN_CMS_STATUS.READY, recipes: mobileRecipes }, fakeDocument, 'external', 'draft', mobileEditor), true);
assert.equal(elements.rows.children.length, 1, 'Search and status filtering continue to share the same row renderer');
assert.equal(elements.count.textContent, '1 of 3 recipes');
for (const status of [ADMIN_CMS_STATUS.DENIED, ADMIN_CMS_STATUS.ERROR]) {
  assert.equal(renderAdminCmsState(elements, { status, recipes: mobileRecipes }, fakeDocument, '', 'all', mobileEditor), true);
  assert.equal(elements.rows.children.length, 0, `${status} state must clear catalog rows`);
}

function mediaQuery(initialMatches) {
  const listeners = new Set();
  return {
    matches: initialMatches,
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener); },
    emit(matches) {
      this.matches = matches;
      for (const listener of [...listeners]) listener({ matches });
    },
    listenerCount() { return listeners.size; },
  };
}

function animationFrames() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    request(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) { callbacks.delete(id); },
    flush() {
      for (const [id, callback] of [...callbacks]) {
        callbacks.delete(id);
        callback(0);
      }
    },
    size() { return callbacks.size; },
  };
}

const drawerDocumentListeners = new Map();
const drawerDocument = {
  activeElement: null,
  body: element(),
  addEventListener(name, listener) { drawerDocumentListeners.set(name, listener); },
  removeEventListener(name, listener) { if (drawerDocumentListeners.get(name) === listener) drawerDocumentListeners.delete(name); },
  emit(name, event) { drawerDocumentListeners.get(name)?.(event); },
};
const drawerElements = {
  root: element(), sidebar: element(), workspace: element(), menuToggle: element(),
  menuClose: element(), menuBackdrop: element(),
};
const drawerNavigation = element();
const drawerLogout = element();
for (const item of [drawerElements.menuToggle, drawerElements.menuClose, drawerNavigation, drawerLogout]) {
  item.ownerDocument = drawerDocument;
}
drawerElements.sidebar.focusables = [drawerElements.menuClose, drawerNavigation, drawerLogout];
drawerElements.sidebar.activeLink = drawerNavigation;
drawerDocument.activeElement = drawerElements.menuToggle;
let activeElementWhenWorkspaceHidden = null;
const setWorkspaceAttribute = drawerElements.workspace.setAttribute;
drawerElements.workspace.setAttribute = function setAttributeWithFocusObservation(name, value) {
  if (name === 'aria-hidden' && value === 'true') {
    activeElementWhenWorkspaceHidden = drawerDocument.activeElement;
  }
  return setWorkspaceAttribute.call(this, name, value);
};
const mobileMedia = mediaQuery(true);
const drawerFrames = animationFrames();
const drawer = createAdminDrawerController({
  elements: drawerElements,
  documentLike: drawerDocument,
  windowLike: {
    matchMedia() { return mobileMedia; },
    requestAnimationFrame(callback) { return drawerFrames.request(callback); },
    cancelAnimationFrame(id) { drawerFrames.cancel(id); },
  },
});
assert.equal(drawer.isMobile(), true);
assert.equal(drawerElements.sidebar.inert, true, 'Closed mobile drawer must be inert');
assert.equal(drawerElements.sidebar['aria-hidden'], 'true');
assert.equal(drawerElements.menuToggle['aria-expanded'], 'false');
drawerElements.menuToggle.emit('click');
assert.equal(drawer.isOpen(), true);
assert.equal(drawer.open(), false, 'Repeated opening attempts are suppressed while focus is pending');
assert.equal(drawerFrames.size(), 1, 'Opening schedules one rendering-frame focus attempt');
assert.equal(drawerElements.root.dataset.drawerOpen, 'true');
assert.equal(drawerElements.sidebar.inert, false);
assert.equal(drawerElements.sidebar.role, 'dialog');
assert.equal(drawerElements.sidebar['aria-modal'], undefined, 'Modal state waits until focus enters the drawer');
assert.equal(drawerElements.workspace.inert, false, 'Workspace remains available until drawer focus succeeds');
drawerFrames.flush();
assert.equal(drawerFrames.size(), 1, 'The first rendering frame schedules the focus frame');
assert.equal(drawerDocument.activeElement, drawerElements.menuToggle, 'The first rendering frame does not move focus');
assert.equal(drawerElements.sidebar['aria-modal'], undefined);
assert.equal(drawerElements.workspace.inert, false, 'The first rendering frame does not hide the workspace');
drawerFrames.flush();
assert.equal(drawerElements.sidebar['aria-modal'], 'true');
assert.equal(drawerElements.workspace.inert, true, 'Open modal drawer must make the workspace inert');
assert.equal(drawerElements.menuBackdrop.hidden, false);
assert.equal(drawerDocument.activeElement, drawerElements.menuClose, 'Opening moves focus into the drawer');
assert.equal(activeElementWhenWorkspaceHidden, drawerElements.menuClose, 'Focus must enter the drawer before the workspace is aria-hidden');
let prevented = false;
drawerLogout.focus();
drawerDocument.emit('keydown', { key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.equal(drawerDocument.activeElement, drawerElements.menuClose, 'Forward Tab wraps to the first drawer control');
prevented = false;
drawerElements.menuClose.focus();
drawerDocument.emit('keydown', { key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.equal(drawerDocument.activeElement, drawerLogout, 'Reverse Tab wraps to the last drawer control');
drawerDocument.emit('keydown', { key: 'Escape', preventDefault() {} });
assert.equal(drawer.isOpen(), false);
assert.equal(drawerElements.workspace.inert, false);
assert.equal(drawerElements.sidebar.inert, true);
assert.equal(drawerDocument.activeElement, drawerElements.menuToggle, 'Escape restores focus to the toggle');
drawer.open();
drawerFrames.flush();
drawerFrames.flush();
drawerElements.menuBackdrop.emit('click');
assert.equal(drawer.isOpen(), false, 'Backdrop closes the drawer');
drawer.open();
drawerFrames.flush();
drawerFrames.flush();
drawerElements.menuClose.emit('click');
assert.equal(drawer.isOpen(), false, 'Close button closes the drawer');
drawer.open();
drawerFrames.flush();
drawerFrames.flush();
mobileMedia.emit(false);
assert.equal(drawer.isMobile(), false);
assert.equal(drawer.isOpen(), false);
assert.equal(drawerElements.sidebar.inert, false, 'Desktop sidebar remains keyboard accessible');
assert.equal(drawerElements.sidebar.role, 'complementary');
assert.equal(drawerElements.workspace.inert, false);
assert.equal(drawerDocument.activeElement, drawerNavigation, 'Desktop transition moves focus away from the hidden close button');
mobileMedia.emit(true);
assert.equal(drawerElements.sidebar.inert, true, 'Returning to mobile resets to a closed drawer');
drawer.open();
assert.equal(drawerFrames.size(), 1);
mobileMedia.emit(false);
assert.equal(drawerFrames.size(), 0, 'Breakpoint changes cancel the first pending drawer frame');
assert.equal(drawerElements.workspace.inert, false);
assert.equal(drawerElements.sidebar.inert, false);
mobileMedia.emit(true);
drawer.open();
assert.equal(drawerFrames.size(), 1);
drawerFrames.flush();
assert.equal(drawerFrames.size(), 1, 'The second drawer frame remains independently cancellable');
assert.equal(drawer.close(), true, 'Lifecycle closure cancels an opening drawer');
assert.equal(drawerFrames.size(), 0);
assert.equal(drawerElements.workspace.inert, false);
drawer.open();
assert.equal(drawerFrames.size(), 1);
assert.equal(drawer.cleanup(), true);
assert.equal(drawerFrames.size(), 0, 'Cleanup cancels a pending opening frame');
assert.equal(drawer.cleanup(), false);
assert.equal(drawerElements.workspace.inert, false, 'Cleanup must never leave the workspace inert');
assert.equal(drawerElements.sidebar.inert, true, 'Cleanup keeps the hidden mobile drawer unfocusable');
assert.equal(drawerDocument.body.classList['admin-drawer-open'], false, 'Cleanup reverses body scroll locking');
assert.equal(drawerDocumentListeners.has('keydown'), false);
assert.equal(mobileMedia.listenerCount(), 0);

const failedFocusDocument = {
  activeElement: null,
  body: element(),
  addEventListener() {},
  removeEventListener() {},
};
const failedFocusElements = {
  root: element(), sidebar: element(), workspace: element(), menuToggle: element(),
  menuClose: element(), menuBackdrop: element(),
};
for (const item of [failedFocusElements.menuToggle, failedFocusElements.menuClose]) {
  item.ownerDocument = failedFocusDocument;
}
failedFocusDocument.activeElement = failedFocusElements.menuToggle;
failedFocusElements.menuClose.focus = () => {};
const failedFocusMedia = mediaQuery(true);
const failedFocusFrames = animationFrames();
const failedFocusDrawer = createAdminDrawerController({
  elements: failedFocusElements,
  documentLike: failedFocusDocument,
  windowLike: {
    matchMedia() { return failedFocusMedia; },
    requestAnimationFrame(callback) { return failedFocusFrames.request(callback); },
    cancelAnimationFrame(id) { failedFocusFrames.cancel(id); },
  },
});
assert.equal(failedFocusDrawer.open(), true, 'Opening begins by exposing the drawer');
assert.equal(failedFocusElements.sidebar.inert, false);
assert.equal(failedFocusElements.workspace.inert, false);
failedFocusFrames.flush();
assert.equal(failedFocusDrawer.isOpen(), true, 'The first frame cannot trigger premature rollback');
assert.equal(failedFocusElements.workspace.inert, false);
failedFocusFrames.flush();
assert.equal(failedFocusDrawer.isOpen(), false, 'Failed focus rolls the drawer back closed');
assert.equal(failedFocusElements.root.dataset.drawerOpen, 'false');
assert.equal(failedFocusElements.menuToggle['aria-expanded'], 'false');
assert.equal(failedFocusElements.sidebar.inert, true);
assert.equal(failedFocusElements.sidebar['aria-hidden'], 'true');
assert.equal(failedFocusElements.sidebar['aria-modal'], undefined);
assert.equal(failedFocusElements.workspace.inert, false, 'Failed focus never hides the workspace');
assert.equal(failedFocusElements.workspace['aria-hidden'], undefined);
assert.equal(failedFocusElements.menuBackdrop.hidden, true);
assert.equal(failedFocusDocument.body.classList['admin-drawer-open'], false);
assert.equal(failedFocusDocument.activeElement, failedFocusElements.menuToggle, 'Failed focus restores the original toggle');
assert.equal(failedFocusDrawer.cleanup(), true);

const pageElements = {
  root: element(), status: element(), content: element(), rows: element(), empty: element(),
  search: element(), statusFilter: element(), count: element(), create: element(),
  signIn: element(), logout: element(), sidebar: element(), workspace: element(),
  menuToggle: element(), menuClose: element(), menuBackdrop: element(),
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
  ['[data-admin-sidebar]', pageElements.sidebar],
  ['[data-admin-workspace]', pageElements.workspace],
  ['[data-admin-menu-toggle]', pageElements.menuToggle],
  ['[data-admin-menu-close]', pageElements.menuClose],
  ['[data-admin-menu-backdrop]', pageElements.menuBackdrop],
]);
pageElements.root.querySelector = (selector) => pageSelectors.get(selector) ?? null;
const pageDocument = {
  querySelector(selector) { return selector === '[data-admin-app]' ? pageElements.root : null; },
  createElement() { return element(); },
};
let pageNow = 1_800_000_000_000;
let pageSessionExpiresAt = Math.floor(pageNow / 1000) + 60;
let pageSessionUserId = USER_A;
let pageSessionFailure = false;
let pageIntervalTick;
let pageSessionCalls = 0;
const pageSessionQueue = [];
const sharedClient = { auth: {
  async getSession() {
    pageSessionCalls += 1;
    if (pageSessionQueue.length) return pageSessionQueue.shift().promise;
    if (pageSessionFailure) return { data: null, error: { message: 'PRIVATE_REFRESH_ERROR' } };
    return { data: { session: {
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
      expires_at: pageSessionExpiresAt,
      user: { id: pageSessionUserId, email_confirmed_at: '2026-11-23T00:00:00.000Z' },
    } }, error: null };
  },
} };
const acceptedClients = [];
const editorAuthorizations = [];
let ownerCreations = 0;
let sessionListener;
let editorCallbacks;
let pageAccessStatus = ADMIN_ACCESS_STATUS.AUTHORIZED;
let pageAccessDeferred = null;
let pageRecipeRows = recipes;
let pageRecipeLoads = 0;
let pageCreateOpens = 0;
let pageTaxonomyActive = true;
let delayTaxonomy = false;
let resolveDelayedTaxonomy;
let optionalSavedObservers = 0;
let optionalAuthorizationObservers = 0;
let drawerCloseCount = 0;
let drawerCleanupCount = 0;
const page = createAdminPageActivation({
  documentLike: pageDocument,
  windowLike: {
    setInterval(callback) { pageIntervalTick = callback; return 1; },
    clearInterval() { pageIntervalTick = null; },
  },
  now: () => pageNow,
  sdk: {},
  loadConfig: async () => ({ SUPABASE_CONFIG: { fictional: true } }),
  createClientOwner(options) {
    ownerCreations += 1;
    assert.equal(options.profile, 'application-session');
    return { initialize(profile) { assert.equal(profile, 'application-session'); return sharedClient; } };
  },
  createDrawer({ elements: drawerPageElements }) {
    assert.equal(drawerPageElements.root, pageElements.root);
    assert.equal(drawerPageElements.sidebar, pageElements.sidebar);
    assert.equal(drawerPageElements.workspace, pageElements.workspace);
    return {
      close() { drawerCloseCount += 1; return true; },
      cleanup() { drawerCleanupCount += 1; return true; },
    };
  },
  createAccessService(client) {
    acceptedClients.push(client);
    return {
      check: async () => pageAccessDeferred ? pageAccessDeferred.promise : ({ status: pageAccessStatus }),
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
    return {
      async listCategories() {
        if (delayTaxonomy) return new Promise((resolve) => { resolveDelayedTaxonomy = resolve; });
        return { data: [{ id: 1, name: 'Dinner', isActive: pageTaxonomyActive }], error: null };
      },
      async listCuisines() { return { data: [{ id: 2, name: 'Filipino', isActive: true }], error: null }; },
      invalidate() {}, cleanup() {},
    };
  },
  createEditor({ mutationService, taxonomySource, onSaved, onAuthorizationLost, authorizeAction }) {
    assert.equal(typeof mutationService.createDraft, 'function');
    assert.equal(typeof taxonomySource.listCategories, 'function');
    editorCallbacks = { onSaved, onAuthorizationLost, authorizeAction };
    return {
      openCreate: async () => { if (!await authorizeAction(pageSessionUserId)) return false; pageCreateOpens += 1; return true; },
      openEdit: async () => authorizeAction(pageSessionUserId),
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
await new Promise((resolve) => setImmediate(resolve));
assert.equal(ownerCreations, 1);
assert.deepEqual(acceptedClients, [sharedClient, sharedClient, sharedClient, sharedClient, sharedClient]);
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.READY);
assert.deepEqual(editorAuthorizations.at(-1), [true, USER_A]);
assert.equal(pageElements.signIn.hidden, true);
assert.equal(pageElements.logout.hidden, false);
assert.equal(pageElements.rows.children.length, 1);
assert.equal(pageElements.create.disabled, false, 'Create unlocks after authorized active taxonomies load');
pageElements.create.emit('click');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageCreateOpens, 1);
assert.equal(typeof pageIntervalTick, 'function');
pageSessionExpiresAt = Math.floor(pageNow / 1000) + 120;
pageIntervalTick();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.READY, 'A successful token refresh retains editor access');
const olderMonitor = deferred();
pageSessionQueue.push(olderMonitor);
const callsBeforePendingMonitor = pageSessionCalls;
pageIntervalTick();
pageIntervalTick();
pageIntervalTick();
assert.equal(pageSessionCalls, callsBeforePendingMonitor + 1, 'Periodic checks remain single-flight');
assert.equal(await editorCallbacks.authorizeAction(USER_A), true, 'A newer action can confirm the session while a monitor is pending');
const newerMonitor = deferred();
pageSessionQueue.push(newerMonitor);
pageIntervalTick();
newerMonitor.resolve({ data: { session: {
  access_token: 'synthetic', refresh_token: 'synthetic', expires_at: pageSessionExpiresAt,
  user: { id: USER_A, email_confirmed_at: '2026-11-23T00:00:00.000Z' },
} }, error: null });
await new Promise((resolve) => setImmediate(resolve));
olderMonitor.reject(new Error('PRIVATE_OLDER_MONITOR_FAILURE'));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.READY, 'Older monitor failure cannot undo a newer successful monitor');
assert.deepEqual(editorAuthorizations.at(-1), [true, USER_A]);
const stuckMonitor = deferred();
pageSessionQueue.push(stuckMonitor);
pageIntervalTick();
for (let index = 0; index < 5; index += 1) pageIntervalTick();
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.READY);
pageIntervalTick();
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.ERROR, 'A monitor that never resolves fails closed after bounded ticks');
stuckMonitor.resolve({ data: null, error: { message: 'PRIVATE_LATE_FAILURE' } });
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.READY);
pageAccessDeferred = deferred();
const accountAAction = editorCallbacks.authorizeAction(USER_A);
await Promise.resolve();
pageSessionUserId = USER_B;
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_B } });
pageAccessDeferred.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
assert.equal(await accountAAction, false, 'Late Account A authorization cannot approve an Account B action');
pageAccessDeferred = null;
await new Promise((resolve) => setImmediate(resolve));
pageSessionUserId = USER_A;
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
pageSessionFailure = true;
pageIntervalTick();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.ERROR, 'Silent refresh failure locks the Admin page');
assert.equal(pageElements.create.disabled, true);
assert.deepEqual(editorAuthorizations.at(-1), [false, null]);
pageSessionFailure = false;
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.READY);
const switchedMonitor = deferred();
pageSessionQueue.push(switchedMonitor);
pageIntervalTick();
pageSessionUserId = USER_B;
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_B } });
await new Promise((resolve) => setImmediate(resolve));
const accountBMonitor = deferred();
pageSessionQueue.push(accountBMonitor);
pageIntervalTick();
pageSessionUserId = USER_A;
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
const callsBeforeCappedMonitor = pageSessionCalls;
pageIntervalTick();
assert.equal(pageSessionCalls, callsBeforeCappedMonitor, 'Account changes cannot accumulate more than two periodic checks');
switchedMonitor.resolve({ data: { session: {
  access_token: 'synthetic', refresh_token: 'synthetic', expires_at: pageSessionExpiresAt,
  user: { id: USER_A, email_confirmed_at: '2026-11-23T00:00:00.000Z' },
} }, error: null });
accountBMonitor.resolve({ data: null, error: { message: 'PRIVATE_STALE_ACCOUNT_B_FAILURE' } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.READY, 'Late monitor results cannot displace a newer account state');
pageNow = (pageSessionExpiresAt + 1) * 1000;
pageElements.create.emit('click');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageCreateOpens, 1, 'An expired session cannot open another draft');
assert.equal(pageElements.create.disabled, true);
pageNow = 1_800_000_000_000;
pageSessionExpiresAt = Math.floor(pageNow / 1000) + 60;
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
const pageLoadsBeforeSave = pageRecipeLoads;
pageRecipeRows = refreshedRecipes;
pageTaxonomyActive = false;
editorCallbacks.onSaved({ id: 'cms:created' });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageRecipeLoads, pageLoadsBeforeSave + 1, 'Confirmed create must trigger exactly one catalog refresh');
assert.match(pageElements.status.textContent, /Draft saved/, 'Confirmed save remains visible after editor closes');
assert.equal(pageElements.rows.children[0].children[0].textContent, 'Refreshed Draft');
assert.equal(pageElements.create.disabled, true, 'No active category keeps Create locked');
assert.match(pageElements.status.textContent, /Draft editor requires active categories and cuisines/);
pageTaxonomyActive = true;
editorCallbacks.onSaved({ id: 'cms:edited' });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageRecipeLoads, pageLoadsBeforeSave + 2, 'Confirmed edit must trigger exactly one catalog refresh');
assert.match(pageElements.status.textContent, /Draft saved/);
assert.equal(pageElements.create.disabled, false, 'Create restores after active taxonomy is available');
assert.equal(optionalSavedObservers, 2, 'Optional observers remain independent from both refreshes');
pageElements.search.value = 'missing';
pageElements.search.emit('input');
assert.equal(pageElements.rows.children.length, 0);
assert.equal(pageElements.empty.hidden, false);
pageAccessStatus = ADMIN_ACCESS_STATUS.DENIED;
editorCallbacks.onAuthorizationLost();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.DENIED);
assert.equal(pageElements.create.disabled, true, 'Authorization loss locks draft creation');
assert.equal(pageElements.rows.children.length, 0, 'Authorization loss must clear privileged catalog rows');
assert.equal(optionalAuthorizationObservers, 1);
pageAccessStatus = ADMIN_ACCESS_STATUS.AUTHORIZED;
delayTaxonomy = true;
const drawerClosesBeforeSwitch = drawerCloseCount;
  pageSessionUserId = USER_B;
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_B } });
await new Promise((resolve) => setImmediate(resolve));
assert.ok(drawerCloseCount > drawerClosesBeforeSwitch, 'Direct account switching closes the drawer');
assert.equal(pageElements.create.disabled, true, 'Pending taxonomy remains locked after account switch');
assert.match(pageElements.status.textContent, /Loading draft category and cuisine choices/);
assert.equal(typeof resolveDelayedTaxonomy, 'function');
const logoutMonitor = deferred();
pageSessionQueue.push(logoutMonitor);
pageIntervalTick();
pageElements.logout.emit('click');
await Promise.resolve();
logoutMonitor.resolve({ data: { session: {
  access_token: 'synthetic', refresh_token: 'synthetic', expires_at: pageSessionExpiresAt,
  user: { id: USER_B, email_confirmed_at: '2026-11-23T00:00:00.000Z' },
} }, error: null });
resolveDelayedTaxonomy({ data: [{ id: 1, name: 'Dinner', isActive: true }], error: null });
await new Promise((resolve) => setImmediate(resolve));
assert.ok(drawerCloseCount >= 3, 'Loading, authentication changes, and logout close the drawer safely');
assert.deepEqual(editorAuthorizations.at(-1), [false, null]);
assert.equal(pageElements.create.disabled, true, 'Logout locks draft creation');
assert.equal(pageElements.signIn.hidden, false);
assert.equal(pageElements.logout.hidden, true);
delayTaxonomy = false;
pageSessionUserId = USER_A;
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
const retirementMonitor = deferred();
pageSessionQueue.push(retirementMonitor);
pageIntervalTick();
assert.equal(page.cleanup(), true);
assert.equal(page.cleanup(), false);
assert.equal(pageIntervalTick, null, 'Retirement clears the session monitor timer');
retirementMonitor.resolve({ data: { session: {
  access_token: 'synthetic', refresh_token: 'synthetic', expires_at: pageSessionExpiresAt,
  user: { id: USER_A, email_confirmed_at: '2026-11-23T00:00:00.000Z' },
} }, error: null });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.RETIRED, 'Late monitor success cannot publish after cleanup');
assert.equal(drawerCleanupCount, 1);
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.RETIRED);

// Exercise the default page-to-editor wiring with fake services and DOM only.
function integrationElement() {
  const node = element();
  node.append = (...children) => { for (const child of children) { child.parent = node; node.children.push(child); } };
  node.replaceChildren = (...children) => { node.children = []; node.append(...children); };
  node.remove = () => { if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node); };
  return node;
}
const integrationRoot = integrationElement();
const integrationMap = new Map();
for (const [selector, original] of pageSelectors) integrationMap.set(selector, integrationElement());
const editorSelectors = [
  '[data-admin-editor]', '[data-admin-editor-form]', '[data-admin-editor-title]',
  '[data-admin-editor-status]', '[data-admin-editor-close]', '[data-admin-editor-cancel]',
  '[data-admin-editor-save]', '[data-editor-add-ingredient]', '[data-editor-ingredients]',
];
for (const selector of editorSelectors) integrationMap.set(selector, integrationElement());
for (const field of ['name', 'description', 'categoryId', 'cuisineId', 'imageUrl',
  'fallbackImageUrl', 'tutorialUrl', 'ingredients', 'instructions', 'form']) {
  integrationMap.set(`[data-error-for="${field}"]`, integrationElement());
  if (field !== 'form' && field !== 'ingredients') integrationMap.set(`[data-editor-field="${field}"]`, integrationElement());
}
integrationMap.get('[data-admin-status-filter]').value = 'all';
integrationRoot.querySelector = (selector) => integrationMap.get(selector) ?? null;
const integrationDocument = {
  querySelector(selector) { return selector === '[data-admin-app]' ? integrationRoot : null; },
  createElement: integrationElement,
};
let integrationSessionListener;
let integrationAdminStatus = ADMIN_ACCESS_STATUS.AUTHORIZED;
let integrationAccessDeferred = null;
let integrationHoldRoleChecks = false;
let integrationAccessCheckCalls = 0;
const integrationHeldRoleChecks = [];
let integrationCreateCalls = 0;
let integrationEditCalls = 0;
let integrationLoads = 0;
let integrationExpiresAt = Math.floor(Date.now() / 1000) + 60;
let integrationTick;
let integrationNow = Date.now();
let integrationTimerId = 0;
const integrationTimers = new Map();
const integrationSessionQueue = [];
let integrationSessionCalls = 0;
const advanceIntegrationClock = async (milliseconds) => {
  integrationNow += milliseconds;
  for (const [id, timer] of [...integrationTimers]) {
    if (timer.due > integrationNow) continue;
    integrationTimers.delete(id);
    timer.callback();
  }
  await new Promise((resolve) => setImmediate(resolve));
};
const integrationRows = [Object.freeze({
  id: 'cms:11111111-2222-4333-8444-555555555555', name: 'Existing Draft',
  category: 'Dinner', cuisine: 'Filipino', status: 'draft', sourceType: 'cms',
})];
const integrationClient = { auth: { async getSession() {
  integrationSessionCalls += 1;
  if (integrationSessionQueue.length) return integrationSessionQueue.shift().promise;
  return { data: { session: {
    access_token: 'synthetic', refresh_token: 'synthetic',
    expires_at: integrationExpiresAt,
    user: { id: USER_A, email_confirmed_at: '2026-11-23T00:00:00.000Z' },
  } }, error: null };
} } };
const integrationPage = createAdminPageActivation({
  documentLike: integrationDocument,
  windowLike: {
    setInterval(callback) { integrationTick = callback; return 1; },
    clearInterval() { integrationTick = null; },
    setTimeout(callback, delay) {
      const id = ++integrationTimerId;
      integrationTimers.set(id, { callback, due: integrationNow + delay });
      return id;
    },
    clearTimeout(id) { integrationTimers.delete(id); },
  },
  now: () => integrationNow,
  loadConfig: async () => ({ SUPABASE_CONFIG: { fictional: true } }),
  createClientOwner: () => ({ initialize: () => integrationClient }),
  createDrawer: () => ({ close() {}, cleanup() {} }),
  createSessionService: () => ({
    subscribe(listener) { integrationSessionListener = listener; listener({ status: 'loading', user: null }); return () => {}; },
    async bootstrap() { integrationSessionListener({ status: 'authenticated', user: { id: USER_A } }); },
    cleanup() {},
  }),
  createAccessService: () => ({
    async check() {
      integrationAccessCheckCalls += 1;
      if (integrationHoldRoleChecks) {
        const pending = deferred();
        integrationHeldRoleChecks.push(pending);
        return pending.promise;
      }
      return integrationAccessDeferred?.promise ?? { status: integrationAdminStatus };
    },
    invalidate() {}, cleanup() {},
  }),
  createRecipeSource: () => ({
    async listAll() { integrationLoads += 1; return { data: integrationRows, error: null }; },
    async getById() { return { data: {
      id: integrationRows[0].id, name: 'Existing Draft', description: 'Private draft.',
      categoryId: 1, cuisineId: 2, imageUrl: 'https://images.example.test/draft.jpg',
      fallbackImageUrl: null, tutorialUrl: null,
      ingredients: [{ name: 'Rice', measurement: '1 cup' }], instructions: 'Cook.',
      status: 'draft', sourceType: 'cms', updatedAt: '2026-11-23T00:00:00.000Z',
    }, error: null }; },
    invalidate() {}, cleanup() {},
  }),
  createMutationService: () => ({
    async createDraft() { integrationCreateCalls += 1; return { status: 'success', data: { id: integrationRows[0].id, updatedAt: '2026-11-23T00:00:00.000Z' } }; },
    async editDraft() { integrationEditCalls += 1; return { status: 'success', data: { id: integrationRows[0].id, updatedAt: '2026-11-23T00:00:00.000Z' } }; },
    invalidate() {}, cleanup() {},
  }),
  createTaxonomySource: () => ({
    async listCategories() { return { data: [{ id: 1, name: 'Dinner', isActive: true }], error: null }; },
    async listCuisines() { return { data: [{ id: 2, name: 'Filipino', isActive: true }], error: null }; },
    invalidate() {}, cleanup() {},
  }),
  createRecipeId: () => integrationRows[0].id,
});
assert.equal(await integrationPage.activate(), true);
await new Promise((resolve) => setImmediate(resolve));
integrationMap.get('[data-admin-create]').emit('click');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationMap.get('[data-admin-editor]').hidden, false, 'Default editor opens through the real page');
for (const [field, value] of Object.entries({
  name: 'New Draft', description: 'A draft.', categoryId: '1', cuisineId: '2',
  imageUrl: 'https://images.example.test/draft.jpg', instructions: 'Cook.',
})) integrationMap.get(`[data-editor-field="${field}"]`).value = value;
const ingredientRow = integrationMap.get('[data-editor-ingredients]').children[0];
ingredientRow.children[0].children[1].value = 'Rice';
ingredientRow.children[1].children[1].value = '1 cup';
assert.equal(await integrationMap.get('[data-admin-editor-form]').emit('submit', { preventDefault() {} }), true);
assert.equal(integrationCreateCalls, 1);
await new Promise((resolve) => setImmediate(resolve));
assert.ok(integrationLoads >= 2, 'Save refreshes the page catalog');
integrationMap.get('[data-admin-rows]').children[0].children[4].children[0].emit('click');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationMap.get('[data-editor-field="name"]').value, 'Existing Draft');
integrationMap.get('[data-editor-field="name"]').value = 'Unsaved same-account edit';
integrationMap.get('[data-editor-field="name"]').emit('input');
integrationExpiresAt = Math.floor(Date.now() / 1000) + 120;
integrationTick();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationMap.get('[data-editor-field="name"]').value, 'Unsaved same-account edit', 'Successful refresh retains unsaved draft content');
assert.equal(await integrationMap.get('[data-admin-editor-form]').emit('submit', { preventDefault() {} }), true);
assert.equal(integrationEditCalls, 1, 'Authorized Edit reaches the real editor mutation path');
await new Promise((resolve) => setImmediate(resolve));
integrationMap.get('[data-admin-rows]').children[0].children[4].children[0].emit('click');
await new Promise((resolve) => setImmediate(resolve));
integrationExpiresAt = Math.floor(Date.now() / 1000) - 1;
assert.equal(await integrationMap.get('[data-admin-editor-form]').emit('submit', { preventDefault() {} }), false);
assert.equal(integrationEditCalls, 1, 'Expired session cannot mutate an existing draft');
assert.equal(integrationMap.get('[data-admin-editor]').hidden, true, 'Expiry hides the protected draft');
assert.equal(integrationMap.get('[data-editor-field="name"]').value, '');
integrationExpiresAt = Math.floor(Date.now() / 1000) + 60;
integrationSessionListener({ status: 'authenticated', user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
integrationMap.get('[data-admin-rows]').children[0].children[4].children[0].emit('click');
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationMap.get('[data-editor-field="name"]').value, 'Existing Draft');
integrationAdminStatus = ADMIN_ACCESS_STATUS.DENIED;
assert.equal(await integrationMap.get('[data-admin-editor-form]').emit('submit', { preventDefault() {} }), false);
assert.equal(integrationEditCalls, 1, 'Admin denial prevents a draft edit');
assert.equal(integrationMap.get('[data-admin-editor]').hidden, true, 'Denial hides protected draft content');
assert.equal(integrationMap.get('[data-editor-field="name"]').value, '');
integrationAdminStatus = ADMIN_ACCESS_STATUS.AUTHORIZED;
integrationSessionListener({ status: 'authenticated', user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
const unresolvedMonitorA = deferred();
integrationSessionQueue.push(unresolvedMonitorA);
integrationTick();
await Promise.resolve();
integrationMap.get('[data-admin-create]').emit('click');
await new Promise((resolve) => setImmediate(resolve));
const unresolvedMonitorB = deferred();
integrationSessionQueue.push(unresolvedMonitorB);
integrationTick();
await Promise.resolve();
for (let tick = 0; tick < 6; tick += 1) integrationTick();
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.ERROR,
  'Two unresolved monitor transports eventually lock the page');
await advanceIntegrationClock(15_001);
integrationExpiresAt = Math.floor(integrationNow / 1000) + 60;
const freshSession = deferred();
const freshRole = deferred();
integrationSessionQueue.push(freshSession);
integrationAccessDeferred = freshRole;
const callsBeforeRecovery = integrationSessionCalls;
integrationSessionListener({ status: 'authenticated', user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationSessionCalls, callsBeforeRecovery + 1,
  'Reauthentication starts a new session request while old transports are unresolved');
assert.notEqual(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.READY,
  'Cached authentication cannot publish a ready page while fresh verification is pending');
freshSession.resolve({ data: { session: {
  access_token: 'synthetic', refresh_token: 'synthetic', expires_at: integrationExpiresAt,
  user: { id: USER_A, email_confirmed_at: '2026-11-23T00:00:00.000Z' },
} }, error: null });
await new Promise((resolve) => setImmediate(resolve));
assert.notEqual(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.READY,
  'A valid session alone does not bypass fresh administrator role verification');
freshRole.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
integrationAccessDeferred = null;
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.READY,
  'Fresh verified reauthentication succeeds with two older transports unresolved');
const callsBeforeFreshMonitor = integrationSessionCalls;
integrationTick();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationSessionCalls, callsBeforeFreshMonitor + 1,
  'Fresh monitoring starts before either old underlying request settles');
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.READY);
unresolvedMonitorA.reject(new Error('PRIVATE_OLD_MONITOR_FAILURE'));
unresolvedMonitorB.resolve({ data: null, error: { message: 'PRIVATE_OLD_MONITOR_FAILURE' } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.READY,
  'Retired monitor results cannot displace recovered authorization');

for (const action of ['create', 'edit', 'save']) {
  if (integrationRoot.dataset.adminState !== ADMIN_CMS_STATUS.READY) {
    integrationSessionListener({ status: 'authenticated', user: { id: USER_A } });
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (action === 'save') {
    integrationMap.get('[data-admin-rows]').children[0].children[4].children[0].emit('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(integrationMap.get('[data-admin-editor]').hidden, false);
  }
  const pendingAction = deferred();
  integrationSessionQueue.push(pendingAction);
  const mutationsBefore = integrationCreateCalls + integrationEditCalls;
  if (action === 'create') integrationMap.get('[data-admin-create]').emit('click');
  if (action === 'edit') integrationMap.get('[data-admin-rows]').children[0].children[4].children[0].emit('click');
  if (action === 'save') void integrationMap.get('[data-admin-editor-form]').emit('submit', { preventDefault() {} });
  await Promise.resolve();
  await advanceIntegrationClock(15_001);
  assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.ERROR,
    `Hung ${action} authorization fails closed within the deadline`);
  assert.equal(integrationCreateCalls + integrationEditCalls, mutationsBefore,
    `Hung ${action} cannot reach a mutation`);
  assert.equal(integrationMap.get('[data-admin-editor]').hidden, true,
    `Hung ${action} clears protected editor content`);
  pendingAction.resolve({ data: { session: {
    access_token: 'synthetic', refresh_token: 'synthetic',
    expires_at: Math.floor(integrationNow / 1000) + 60,
    user: { id: USER_A, email_confirmed_at: '2026-11-23T00:00:00.000Z' },
  } }, error: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.ERROR,
    `Late ${action} authorization cannot restore access`);
  integrationExpiresAt = Math.floor(integrationNow / 1000) + 60;
}
integrationSessionListener({ status: 'authenticated', user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
const unresolvedAccess = deferred();
integrationAccessDeferred = unresolvedAccess;
const accessMutationsBefore = integrationCreateCalls + integrationEditCalls;
integrationMap.get('[data-admin-create]').emit('click');
await new Promise((resolve) => setImmediate(resolve));
await advanceIntegrationClock(15_001);
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.ERROR,
  'An unresolved action role check also has a bounded lifetime');
unresolvedAccess.resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
integrationAccessDeferred = null;
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationCreateCalls + integrationEditCalls, accessMutationsBefore,
  'Late role success cannot authorize a mutation');

for (const transition of [
  { status: 'guest', user: null },
  { status: 'authenticated', user: { id: USER_B } },
]) {
  integrationExpiresAt = Math.floor(integrationNow / 1000) + 60;
  integrationSessionListener({ status: 'authenticated', user: { id: USER_A } });
  await new Promise((resolve) => setImmediate(resolve));
  const pending = deferred();
  integrationSessionQueue.push(pending);
  const before = integrationCreateCalls + integrationEditCalls;
  integrationMap.get('[data-admin-create]').emit('click');
  await Promise.resolve();
  integrationSessionListener(transition);
  pending.resolve({ data: { session: {
    access_token: 'synthetic', refresh_token: 'synthetic',
    expires_at: Math.floor(integrationNow / 1000) + 60,
    user: { id: USER_A, email_confirmed_at: '2026-11-23T00:00:00.000Z' },
  } }, error: null });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(integrationCreateCalls + integrationEditCalls, before,
    'Logout or account switching invalidates the pending action');
  assert.notEqual(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.READY);
}
integrationSessionListener({ status: 'authenticated', user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
integrationExpiresAt = Math.floor(integrationNow / 1000) + 60;
integrationHoldRoleChecks = true;
const roleChecksBeforeTransitions = integrationAccessCheckCalls;
for (let index = 0; index < 20; index += 1) {
  integrationSessionListener({ status: 'loading', user: null });
  integrationSessionListener({ status: 'authenticated', user: { id: USER_A } });
  await new Promise((resolve) => setImmediate(resolve));
}
assert.equal(integrationAccessCheckCalls - roleChecksBeforeTransitions, 3,
  'Twenty transitions cannot start more than three unresolved role transports');
assert.equal(integrationHeldRoleChecks.length, 3);
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.ERROR,
  'Exhausted role verification capacity fails closed');
integrationHeldRoleChecks[0].resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.ERROR,
  'Old role success cannot restore authorization');
integrationHoldRoleChecks = false;
integrationSessionListener({ status: 'authenticated', user: { id: USER_A } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.READY,
  'Fresh role verification recovers when underlying request capacity returns');
integrationHeldRoleChecks[1].reject(new Error('PRIVATE_OLDER_ROLE_FAILURE'));
integrationHeldRoleChecks[2].resolve({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.READY,
  'Late role results cannot displace recovered authorization');
const retirementAction = deferred();
integrationSessionQueue.push(retirementAction);
const retirementMutationsBefore = integrationCreateCalls + integrationEditCalls;
integrationMap.get('[data-admin-create]').emit('click');
await Promise.resolve();
assert.equal(integrationPage.cleanup(), true);
assert.equal(integrationTimers.size, 0, 'Cleanup retires all pending authorization deadlines');
retirementAction.reject(new Error('PRIVATE_LATE_ACTION_FAILURE'));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(integrationRoot.dataset.adminState, ADMIN_CMS_STATUS.RETIRED);
assert.equal(integrationCreateCalls + integrationEditCalls, retirementMutationsBefore,
  'Cleanup prevents late action authorization and mutations');

const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(html, /data-admin-app/);
assert.match(html, /<aside class="admin-sidebar"[^>]+data-admin-sidebar[^>]+inert>/);
assert.match(html, /<nav class="admin-navigation" aria-label="Admin navigation">/);
assert.match(html, /href="admin\.html" aria-current="page"/);
assert.match(html, /href="index\.html"/);
assert.match(html, /data-admin-menu-toggle[^>]+aria-expanded="false"[^>]+aria-controls="admin-sidebar"/);
assert.match(html, /data-admin-menu-close[^>]+aria-label="Close Admin menu"/);
assert.match(html, /data-admin-menu-backdrop/);
assert.match(html, /data-admin-workspace/);
assert.equal((html.match(/class="skip-link"/g) ?? []).length, 1, 'Skip link must not be duplicated');
assert.match(html, /<div class="admin-workspace" data-admin-workspace>\s*<a class="skip-link" href="#admin-content">Skip to admin content<\/a>/, 'Skip link must be the first child inside the inert workspace boundary');
assert.match(html, /<main class="admin-main" id="admin-content">/, 'Skip link destination must remain unchanged');
assert.equal((html.match(/data-admin-sign-in/g) ?? []).length, 1, 'Sign In control must not be duplicated');
assert.equal((html.match(/data-admin-logout/g) ?? []).length, 1, 'Sign Out control must not be duplicated');
assert.doesNotMatch(html, /Restore fake admin|Switch fake account|data-offline/i);
assert.match(html, /data-admin-content hidden/);
assert.match(html, /data-admin-search disabled/);
assert.match(html, /<table>/, 'Desktop catalog remains a semantic table');
assert.match(html, /<caption class="sr-only">RecipeFinder recipe administration catalog<\/caption>/);
assert.match(html, /<tbody data-admin-rows><\/tbody>/);
assert.match(html, /data-admin-editor-form/);
assert.doesNotMatch(html, /offline injected test environment/i);
assert.match(html, /data-error-for="form"/);
for (const id of [
  'admin-recipe-column', 'admin-category-column', 'admin-cuisine-column',
  'admin-status-column', 'admin-action-column',
]) assert.match(html, new RegExp(`<th id="${id}" scope="col">`), `${id} must remain a semantic column header`);
assert.match(html, /data-admin-create disabled/);
assert.doesNotMatch(html, /\b(?:Delete|Publish|Unpublish)\b/);
const css = await readFile(new URL('../admin.css', import.meta.url), 'utf8');
assert.match(css, /background-position:right 16px center/);
assert.match(css, /\.admin-shell\{[^}]*grid-template-columns:260px minmax\(0,1fr\)/);
assert.match(css, /\.admin-sidebar\{[^}]*position:sticky;[^}]*height:100dvh/);
assert.match(css, /\.admin-nav-link\[aria-current=page\]/);
assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.admin-sidebar\{position:fixed;[^}]*width:min\(270px,calc\(100vw - 48px\)\)/);
assert.match(css, /body\.admin-drawer-open\{overflow:hidden\}/);
assert.match(css, /@media\(prefers-reduced-motion:no-preference\)[\s\S]*?\.admin-sidebar\{transition:/);
assert.match(css, /table\{width:100%;border-collapse:collapse;min-width:760px\}/, 'Desktop minimum width remains unchanged');
assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.admin-table-wrap\{overflow-x:visible/);
assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.admin-table-wrap table\{display:block;min-width:0\}/);
assert.match(css, /\.admin-table-wrap tbody tr\{[^}]*text-align:left\}/);
assert.match(css, /\.admin-table-wrap tbody td\{[^}]*justify-items:start;[^}]*width:100%;[^}]*text-align:left;/);
assert.match(css, /\.admin-table-wrap tbody td::before\{display:block;content:attr\(data-label\);[^}]*text-align:left;/);
assert.match(css, /\.admin-table-wrap tbody td\.admin-recipe-name\{[^}]*width:100%;[^}]*text-align:left\}/);
assert.match(css, /\.admin-table-wrap tbody td \.status-badge\{justify-self:start\}/);
assert.match(css, /\.admin-table-wrap \.admin-row-action\{width:100%;min-height:44px\}/);
const browserSource = await readFile(new URL('../js/admin-browser.js', import.meta.url), 'utf8');
assert.doesNotMatch(browserSource, /innerHTML|insertAdjacentHTML|document\.write|service_role|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/i);
assert.match(browserSource, /createSupabaseAdminRecipeMutationService/);
assert.match(browserSource, /createSupabaseAdminTaxonomySource/);

console.log('Offline Admin CMS authorization and draft-editor activation tests passed with fakes only.');
