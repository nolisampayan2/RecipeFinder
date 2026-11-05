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
  Object.freeze({ id: 'cms:mobile-draft', name: longName, category: 'Dinner', cuisine: 'Filipino', status: 'draft' }),
  Object.freeze({ id: 'cms:published', name: 'Published CMS Recipe', category: 'Lunch', cuisine: 'Filipino', status: 'published' }),
  Object.freeze({ id: 'external:provider:one', name: 'External Draft', category: 'Lunch', cuisine: 'Other', status: 'draft' }),
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
let drawerCloseCount = 0;
let drawerCleanupCount = 0;
const page = createAdminPageActivation({
  documentLike: pageDocument,
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
const drawerClosesBeforeSwitch = drawerCloseCount;
sessionListener({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user: { id: USER_B } });
await new Promise((resolve) => setImmediate(resolve));
assert.ok(drawerCloseCount > drawerClosesBeforeSwitch, 'Direct account switching closes the drawer');
pageElements.logout.emit('click');
await Promise.resolve();
assert.ok(drawerCloseCount >= 3, 'Loading, authentication changes, and logout close the drawer safely');
assert.deepEqual(editorAuthorizations.at(-1), [false, null]);
assert.equal(pageElements.signIn.hidden, false);
assert.equal(pageElements.logout.hidden, true);
assert.equal(page.cleanup(), true);
assert.equal(page.cleanup(), false);
assert.equal(drawerCleanupCount, 1);
assert.equal(pageElements.root.dataset.adminState, ADMIN_CMS_STATUS.RETIRED);

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
assert.doesNotMatch(browserSource, /supabase-admin-recipe-mutations|supabase-admin-taxonomies/);

console.log('Offline Admin CMS authorization and read-only UI tests passed with fakes only.');
