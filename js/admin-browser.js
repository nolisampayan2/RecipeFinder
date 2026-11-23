import { createAdminCmsCoordinator, ADMIN_CMS_STATUS } from './admin-cms.js';
import { createAdminRecipeEditor } from './admin-recipe-editor.js';
import { createAuthSessionService, isEmailConfirmed } from './auth-session.js';
import { createSupabaseAdminAccessService } from './supabase-admin-access.js';
import { createSupabaseAdminRecipeSource } from './supabase-admin-recipes.js';
import { ADMIN_RECIPE_MUTATION_STATUS, createSupabaseAdminRecipeMutationService } from './supabase-admin-recipe-mutations.js';
import { createSupabaseAdminTaxonomySource } from './supabase-admin-taxonomies.js';
import { isValidAccountUserId } from './supabase-favorites.js';
import { createSupabasePageClientOwner } from './supabase-browser.js';
import { SUPABASE_CLIENT_PROFILE } from './supabase-client.js';

const ADMIN_MESSAGES = Object.freeze({
  [ADMIN_CMS_STATUS.LOADING]: 'Checking your session.',
  [ADMIN_CMS_STATUS.GUEST]: 'Sign in with an authorized administrator account.',
  [ADMIN_CMS_STATUS.CHECKING]: 'Verifying administrator access.',
  [ADMIN_CMS_STATUS.DENIED]: 'Administrator access is required.',
  [ADMIN_CMS_STATUS.READY]: 'Recipe catalog ready.',
  [ADMIN_CMS_STATUS.ERROR]: 'Admin access is temporarily unavailable.',
  [ADMIN_CMS_STATUS.RETIRED]: 'Admin session closed.',
});

function requireElements(documentLike) {
  const root = documentLike?.querySelector?.('[data-admin-app]');
  const elements = {
    root,
    status: root?.querySelector?.('[data-admin-status]'),
    content: root?.querySelector?.('[data-admin-content]'),
    rows: root?.querySelector?.('[data-admin-rows]'),
    empty: root?.querySelector?.('[data-admin-empty]'),
    search: root?.querySelector?.('[data-admin-search]'),
    statusFilter: root?.querySelector?.('[data-admin-status-filter]'),
    count: root?.querySelector?.('[data-admin-count]'),
    create: root?.querySelector?.('[data-admin-create]'),
    signIn: root?.querySelector?.('[data-admin-sign-in]'),
    logout: root?.querySelector?.('[data-admin-logout]'),
    sidebar: root?.querySelector?.('[data-admin-sidebar]'),
    workspace: root?.querySelector?.('[data-admin-workspace]'),
    menuToggle: root?.querySelector?.('[data-admin-menu-toggle]'),
    menuClose: root?.querySelector?.('[data-admin-menu-close]'),
    menuBackdrop: root?.querySelector?.('[data-admin-menu-backdrop]'),
  };
  if (Object.values(elements).some((element) => !element)) {
    throw new TypeError('Admin interface is unavailable.');
  }
  return elements;
}

function setInert(element, inert) {
  element.inert = inert;
  if (inert) element.setAttribute('inert', '');
  else element.removeAttribute?.('inert');
}

export function createAdminDrawerController({
  elements,
  documentLike = globalThis.document,
  windowLike = globalThis,
} = {}) {
  const required = ['root', 'sidebar', 'workspace', 'menuToggle', 'menuClose', 'menuBackdrop'];
  if (!elements || required.some((key) => !elements[key])) {
    throw new TypeError('Admin drawer elements are required.');
  }

  const media = typeof windowLike?.matchMedia === 'function'
    ? windowLike.matchMedia('(max-width: 700px)')
    : { matches: false, addEventListener() {}, removeEventListener() {} };
  let mobile = Boolean(media.matches);
  let opened = false;
  let retired = false;
  let restoreTarget = null;
  let openingFrame = null;
  const listeners = [];

  const listen = (target, type, listener) => {
    target?.addEventListener?.(type, listener);
    listeners.push(() => target?.removeEventListener?.(type, listener));
  };

  const setBodyLocked = (locked) => {
    try { documentLike?.body?.classList?.toggle('admin-drawer-open', locked); } catch { /* Scroll locking fails closed on cleanup. */ }
  };

  const setWorkspaceInactive = (inactive) => {
    setInert(elements.workspace, inactive);
    if (inactive) elements.workspace.setAttribute('aria-hidden', 'true');
    else elements.workspace.removeAttribute?.('aria-hidden');
  };

  const cancelOpeningFrame = () => {
    if (openingFrame === null) return false;
    const frame = openingFrame;
    openingFrame = null;
    try { windowLike?.cancelAnimationFrame?.(frame); } catch { /* State rollback remains authoritative. */ }
    return true;
  };

  const scheduleOpeningFrame = (callback) => {
    if (typeof windowLike?.requestAnimationFrame !== 'function') {
      callback();
      return;
    }
    openingFrame = windowLike.requestAnimationFrame(() => {
      openingFrame = null;
      if (retired || !mobile || !opened) return;
      openingFrame = windowLike.requestAnimationFrame(() => {
        openingFrame = null;
        callback();
      });
    });
  };

  const focusableItems = () => {
    try {
      return [...elements.sidebar.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter((item) => !item.hidden && !item.disabled && !item.inert && item.getAttribute?.('aria-hidden') !== 'true');
    } catch {
      return [elements.menuClose].filter((item) => !item.hidden && !item.disabled);
    }
  };

  const applyClosedMobileState = () => {
    cancelOpeningFrame();
    opened = false;
    elements.root.dataset.drawerOpen = 'false';
    elements.menuToggle.setAttribute('aria-expanded', 'false');
    elements.sidebar.setAttribute('role', 'dialog');
    elements.sidebar.removeAttribute?.('aria-modal');
    elements.sidebar.setAttribute('aria-hidden', 'true');
    setInert(elements.sidebar, true);
    setWorkspaceInactive(false);
    elements.menuBackdrop.hidden = true;
    setBodyLocked(false);
  };

  const applyDesktopState = () => {
    cancelOpeningFrame();
    opened = false;
    elements.root.dataset.drawerOpen = 'false';
    elements.menuToggle.setAttribute('aria-expanded', 'false');
    elements.sidebar.setAttribute('role', 'complementary');
    elements.sidebar.removeAttribute?.('aria-modal');
    elements.sidebar.removeAttribute?.('aria-hidden');
    setInert(elements.sidebar, false);
    setWorkspaceInactive(false);
    elements.menuBackdrop.hidden = true;
    setBodyLocked(false);
  };

  const close = ({ restoreFocus = true } = {}) => {
    if (retired) return false;
    const wasOpen = opened;
    if (mobile) applyClosedMobileState();
    else applyDesktopState();
    const target = restoreTarget;
    restoreTarget = null;
    if (wasOpen && restoreFocus) {
      try { (target?.focus ? target : elements.menuToggle).focus(); } catch { /* Focus restoration stays best effort. */ }
    }
    return wasOpen;
  };

  const open = () => {
    if (retired || !mobile || opened) return false;
    restoreTarget = documentLike?.activeElement ?? elements.menuToggle;
    opened = true;
    elements.root.dataset.drawerOpen = 'true';
    elements.menuToggle.setAttribute('aria-expanded', 'true');
    elements.sidebar.setAttribute('role', 'dialog');
    elements.sidebar.removeAttribute?.('aria-hidden');
    setInert(elements.sidebar, false);
    scheduleOpeningFrame(() => {
      if (retired || !mobile || !opened) return;
      try { elements.menuClose.focus(); } catch { /* Focus verification below keeps the workspace available on failure. */ }
      if (documentLike?.activeElement !== elements.menuClose) {
        const target = restoreTarget;
        applyClosedMobileState();
        restoreTarget = null;
        try { target?.focus?.(); } catch { /* Failed opening leaves focus restoration best effort. */ }
        return;
      }
      elements.sidebar.setAttribute('aria-modal', 'true');
      setWorkspaceInactive(true);
      elements.menuBackdrop.hidden = false;
      setBodyLocked(true);
    });
    return true;
  };

  const onKeydown = (event) => {
    if (!opened) return;
    if (event?.key === 'Escape') {
      event.preventDefault?.();
      close();
      return;
    }
    if (event?.key !== 'Tab') return;
    const items = focusableItems();
    if (!items.length) {
      event.preventDefault?.();
      elements.menuClose.focus?.();
      return;
    }
    const active = documentLike?.activeElement;
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && (active === first || !items.includes(active))) {
      event.preventDefault?.();
      last.focus?.();
    } else if (!event.shiftKey && (active === last || !items.includes(active))) {
      event.preventDefault?.();
      first.focus?.();
    }
  };

  const onMediaChange = (event) => {
    if (retired) return;
    const wasOpen = opened;
    mobile = Boolean(event?.matches);
    restoreTarget = null;
    if (mobile) applyClosedMobileState();
    else {
      applyDesktopState();
      if (wasOpen) {
        try { elements.sidebar.querySelector?.('[aria-current="page"]')?.focus?.(); } catch { /* Desktop focus remains inside visible navigation. */ }
      }
    }
  };

  listen(elements.menuToggle, 'click', open);
  listen(elements.menuClose, 'click', () => close());
  listen(elements.menuBackdrop, 'click', () => close());
  listen(documentLike, 'keydown', onKeydown);
  listen(media, 'change', onMediaChange);
  if (mobile) applyClosedMobileState();
  else applyDesktopState();

  return Object.freeze({
    open,
    close,
    isOpen() { return opened; },
    isMobile() { return mobile; },
    cleanup() {
      if (retired) return false;
      close({ restoreFocus: false });
      retired = true;
      for (const remove of listeners.splice(0)) {
        try { remove(); } catch { /* Listener cleanup remains isolated. */ }
      }
      return true;
    },
  });
}

function editorElements(root) {
  const field = (name) => root.querySelector?.(`[data-editor-field="${name}"]`);
  const errors = {};
  for (const name of [
    'name', 'description', 'categoryId', 'cuisineId', 'imageUrl',
    'fallbackImageUrl', 'tutorialUrl', 'ingredients', 'instructions', 'form',
  ]) errors[name] = root.querySelector?.(`[data-error-for="${name}"]`);
  return {
    panel: root.querySelector?.('[data-admin-editor]'),
    form: root.querySelector?.('[data-admin-editor-form]'),
    title: root.querySelector?.('[data-admin-editor-title]'),
    status: root.querySelector?.('[data-admin-editor-status]'),
    close: root.querySelector?.('[data-admin-editor-close]'),
    cancel: root.querySelector?.('[data-admin-editor-cancel]'),
    save: root.querySelector?.('[data-admin-editor-save]'),
    addIngredient: root.querySelector?.('[data-editor-add-ingredient]'),
    ingredients: root.querySelector?.('[data-editor-ingredients]'),
    name: field('name'),
    description: field('description'),
    categoryId: field('categoryId'),
    cuisineId: field('cuisineId'),
    imageUrl: field('imageUrl'),
    fallbackImageUrl: field('fallbackImageUrl'),
    tutorialUrl: field('tutorialUrl'),
    instructions: field('instructions'),
    errors,
  };
}

export function filterAdminRecipes(recipes, query, status = 'all') {
  if (!Array.isArray(recipes)) return Object.freeze([]);
  const normalizedQuery = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
  const normalizedStatus = ['draft', 'published'].includes(status) ? status : 'all';
  if (!normalizedQuery && normalizedStatus === 'all') return recipes;
  return Object.freeze(recipes.filter((recipe) => {
    try {
      const statusMatches = normalizedStatus === 'all' || recipe.status === normalizedStatus;
      const queryMatches = !normalizedQuery || [recipe.name, recipe.category, recipe.cuisine]
        .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(normalizedQuery));
      return statusMatches && queryMatches;
    } catch {
      return false;
    }
  }));
}

function appendCell(documentLike, row, value, headerId, label) {
  const cell = documentLike.createElement('td');
  cell.textContent = value;
  cell.setAttribute('headers', headerId);
  cell.setAttribute('data-label', label);
  row.append(cell);
  return cell;
}

function observeCallback(callback, value) {
  try {
    Promise.resolve(typeof callback === 'function' ? callback(value) : undefined).catch(() => {});
  } catch {
    // Optional observers cannot interrupt the page lifecycle.
  }
}

export function renderAdminCmsState(
  elements,
  state,
  documentLike,
  query = '',
  statusFilter = 'all',
  editor = null,
  authenticated = null,
  taxonomiesReady = Boolean(editor),
  onStatusTransition = null,
  pendingStatusIds = null
) {
  try {
    const status = Object.values(ADMIN_CMS_STATUS).includes(state?.status)
      ? state.status
      : ADMIN_CMS_STATUS.ERROR;
    const ready = status === ADMIN_CMS_STATUS.READY;
    const allRecipes = ready && Array.isArray(state.recipes) ? state.recipes : Object.freeze([]);
    const recipes = ready ? filterAdminRecipes(allRecipes, query, statusFilter) : Object.freeze([]);

    elements.root.dataset.adminState = status;
    elements.root.setAttribute('aria-busy', String([
      ADMIN_CMS_STATUS.LOADING,
      ADMIN_CMS_STATUS.CHECKING,
    ].includes(status)));
    elements.status.textContent = ADMIN_MESSAGES[status];
    elements.status.classList.toggle('is-error', [
      ADMIN_CMS_STATUS.DENIED,
      ADMIN_CMS_STATUS.ERROR,
    ].includes(status));
    elements.content.hidden = !ready;
    elements.search.disabled = !ready;
    elements.statusFilter.disabled = !ready;
    elements.create.disabled = !ready || !editor || !taxonomiesReady;
    elements.create.setAttribute('aria-disabled', String(elements.create.disabled));
    elements.create.setAttribute('title', editor && taxonomiesReady
      ? 'Create a recipe draft' : 'Active categories and cuisines are required');
    elements.count.textContent = ready
      ? `${recipes.length}${recipes.length === allRecipes.length ? '' : ` of ${allRecipes.length}`} ${allRecipes.length === 1 ? 'recipe' : 'recipes'}`
      : '0 recipes';
    const showSignIn = authenticated === false && ![
      ADMIN_CMS_STATUS.LOADING,
      ADMIN_CMS_STATUS.CHECKING,
    ].includes(status);
    const showLogout = authenticated === true && ![
      ADMIN_CMS_STATUS.LOADING,
    ].includes(status);
    elements.signIn.hidden = !showSignIn;
    elements.logout.hidden = !showLogout;
    elements.logout.disabled = status === ADMIN_CMS_STATUS.CHECKING;

    elements.rows.replaceChildren();
    if (ready) {
      for (const recipe of recipes) {
        const row = documentLike.createElement('tr');
        const nameCell = appendCell(documentLike, row, recipe.name, 'admin-recipe-column', 'Recipe');
        nameCell.className = 'admin-recipe-name';
        appendCell(documentLike, row, recipe.category, 'admin-category-column', 'Category');
        appendCell(documentLike, row, recipe.cuisine, 'admin-cuisine-column', 'Cuisine');
        const statusCell = documentLike.createElement('td');
        statusCell.setAttribute('headers', 'admin-status-column');
        statusCell.setAttribute('data-label', 'Status');
        const badge = documentLike.createElement('span');
        badge.className = `status-badge is-${recipe.status}`;
        badge.textContent = recipe.status === 'published' ? 'Published' : 'Draft';
        statusCell.append(badge);
        row.append(statusCell);
        const actionCell = documentLike.createElement('td');
        actionCell.setAttribute('headers', 'admin-action-column');
        actionCell.setAttribute('data-label', 'Action');
        const edit = documentLike.createElement('button');
        edit.type = 'button';
        edit.className = 'admin-row-action';
        edit.textContent = 'Edit draft';
        const pending = pendingStatusIds?.has?.(recipe.id) === true;
        const editable = Boolean(editor && taxonomiesReady && !pending && recipe.status === 'draft'
          && recipe.sourceType === 'cms');
        edit.disabled = !editable;
        edit.setAttribute('aria-label', editable ? `Edit ${recipe.name}` : `${recipe.name} is read only`);
        if (editable) edit.addEventListener('click', () => { void editor.openEdit(recipe.id); });
        actionCell.append(edit);
        if (recipe.sourceType === 'cms' && ['draft', 'published'].includes(recipe.status)) {
          const transition = documentLike.createElement('button');
          transition.type = 'button';
          transition.className = 'admin-row-action';
          transition.textContent = recipe.status === 'draft' ? 'Publish' : 'Unpublish';
          transition.disabled = pending || typeof onStatusTransition !== 'function'
            || typeof recipe.updatedAt !== 'string';
          transition.setAttribute('aria-disabled', String(transition.disabled));
          transition.setAttribute('aria-label', `${transition.textContent} ${recipe.name}`);
          if (!transition.disabled) transition.addEventListener('click', () => { void onStatusTransition(recipe); });
          actionCell.append(transition);
        }
        row.append(actionCell);
        elements.rows.append(row);
      }
    }
    elements.empty.hidden = !ready || recipes.length > 0;
    elements.empty.textContent = query.trim() || statusFilter !== 'all'
      ? 'No recipes match these filters.'
      : 'No recipes are available.';
    return true;
  } catch {
    return false;
  }
}

async function loadLocalPublicConfig() {
  return import('./supabase-config.js');
}

export function createAdminPageActivation(options = {}) {
  const documentLike = options.documentLike ?? globalThis.document;
  const windowLike = options.windowLike ?? globalThis;
  const sdk = options.sdk ?? globalThis.supabase;
  const loadConfig = options.loadConfig ?? loadLocalPublicConfig;
  const createClientOwner = options.createClientOwner ?? createSupabasePageClientOwner;
  const createSessionService = options.createSessionService ?? createAuthSessionService;
  const createAccessService = options.createAccessService ?? createSupabaseAdminAccessService;
  const createRecipeSource = options.createRecipeSource ?? createSupabaseAdminRecipeSource;
  const createCoordinator = options.createCoordinator ?? createAdminCmsCoordinator;
  const createEditor = options.createEditor ?? createAdminRecipeEditor;
  const createDrawer = options.createDrawer ?? createAdminDrawerController;
  const createMutationService = options.createMutationService ?? createSupabaseAdminRecipeMutationService;
  const createTaxonomySource = options.createTaxonomySource ?? createSupabaseAdminTaxonomySource;
  const elements = requireElements(documentLike);
  const drawer = createDrawer({ elements, documentLike, windowLike });

  let owner;
  let sessionService;
  let authClient;
  let adminAccess;
  let coordinator;
  let editor;
  let mutationService;
  let unsubscribeSession;
  let unsubscribeCoordinator;
  let activationPromise;
  let generation = 0;
  let retired = false;
  let listenersInstalled = false;
  let currentUserId = null;
  let taxonomySource;
  let taxonomiesReady = false;
  let taxonomiesChecked = false;
  let taxonomyGeneration = 0;
  let savedNotice = false;
  let statusNotice = '';
  let statusActionGeneration = 0;
  const pendingStatusIds = new Set();
  let sessionGeneration = 0;
  let expiryMonitor = null;
  let monitorRequest = null;
  let monitorOutstanding = 0;
  let monitorEpoch = 0;
  let monitorSkippedTicks = 0;
  let actionChecks = 0;
  let transportOutstanding = 0;
  let accessOutstanding = 0;
  const checkLeases = [];
  const now = options.now ?? Date.now;
  // Each transport has a 15-second logical deadline. Three raw calls is the recovery
  // budget: two abandoned monitors can coexist with one fresh reauthentication check.
  const CHECK_TIMEOUT_MS = 15000;

  const checkPendingDeadlines = () => {
    let currentTime;
    try { currentTime = now(); } catch { currentTime = NaN; }
    for (const lease of [...checkLeases]) {
      if (!Number.isFinite(currentTime) || currentTime >= lease.deadline) lease.retire(null);
    }
  };

  const boundedSessionResponse = () => {
    if (transportOutstanding >= 3) return Promise.resolve(null);
    let raw;
    try { raw = Promise.resolve(authClient.auth.getSession()); } catch { return Promise.resolve(null); }
    transportOutstanding += 1;
    void raw.then(() => { transportOutstanding -= 1; }, () => { transportOutstanding -= 1; });
    return new Promise((resolve) => {
      let timer;
      let deadline;
      try { deadline = now() + CHECK_TIMEOUT_MS; } catch { deadline = NaN; }
      const lease = {
        deadline,
        retire(value) {
          const index = checkLeases.indexOf(lease);
          if (index < 0) return;
          checkLeases.splice(index, 1);
          try { (windowLike?.clearTimeout ?? globalThis.clearTimeout)(timer); } catch { /* Logical retirement is authoritative. */ }
          resolve(value);
        },
      };
      checkLeases.push(lease);
      try {
        timer = (windowLike?.setTimeout ?? globalThis.setTimeout)(() => lease.retire(null), CHECK_TIMEOUT_MS);
      } catch { lease.retire(null); }
      void raw.then((value) => {
        let currentTime;
        try { currentTime = now(); } catch { currentTime = NaN; }
        lease.retire(Number.isFinite(currentTime) && currentTime < deadline ? value : null);
      }, () => lease.retire(null));
    });
  };

  const boundedAccessResponse = () => {
    if (accessOutstanding >= 3) return Promise.resolve(null);
    accessOutstanding += 1;
    let raw;
    try { raw = Promise.resolve(adminAccess.check()); } catch {
      accessOutstanding -= 1;
      return Promise.resolve(null);
    }
    void raw.then(() => { accessOutstanding -= 1; }, () => { accessOutstanding -= 1; });
    return new Promise((resolve) => {
      let timer;
      let deadline;
      try { deadline = now() + CHECK_TIMEOUT_MS; } catch { deadline = NaN; }
      const lease = {
        deadline,
        retire(value) {
          const index = checkLeases.indexOf(lease);
          if (index < 0) return;
          checkLeases.splice(index, 1);
          try { (windowLike?.clearTimeout ?? globalThis.clearTimeout)(timer); } catch { /* Logical retirement is authoritative. */ }
          resolve(value);
        },
      };
      checkLeases.push(lease);
      try {
        timer = (windowLike?.setTimeout ?? globalThis.setTimeout)(() => lease.retire(null), CHECK_TIMEOUT_MS);
      } catch { lease.retire(null); }
      void raw.then((value) => {
        let currentTime;
        try { currentTime = now(); } catch { currentTime = NaN; }
        lease.retire(Number.isFinite(currentTime) && currentTime < deadline ? value : null);
      }, () => lease.retire(null));
    });
  };

  const lockAdmin = () => {
    statusActionGeneration += 1;
    pendingStatusIds.clear();
    statusNotice = '';
    try { mutationService?.invalidate?.(); } catch { /* Stale mutation responses remain ignored by the page. */ }
    sessionGeneration += 1;
    monitorEpoch += 1;
    currentUserId = null;
    savedNotice = false;
    taxonomiesReady = false;
    taxonomyGeneration += 1;
    editor?.setAuthorization(false);
    try { void coordinator?.acceptAuthState({ status: 'error', user: null }); } catch { /* Fail closed. */ }
  };

  const verifySession = async (userId, requestGeneration = sessionGeneration, lockOnFailure = true) => {
    if (retired || !isValidAccountUserId(userId)) return false;
    try {
      if (typeof authClient?.auth?.getSession !== 'function') throw new TypeError('Auth unavailable.');
      const response = await boundedSessionResponse();
      if (retired || requestGeneration !== sessionGeneration || currentUserId !== userId) return false;
      const session = response?.error === null ? response?.data?.session : null;
      if (session && typeof session.access_token === 'string' && session.access_token.trim()
        && typeof session.refresh_token === 'string' && session.refresh_token.trim()
        && Number.isSafeInteger(session.expires_at)
        && session.expires_at > Math.floor(now() / 1000)
        && isEmailConfirmed(session.user)
        && session.user.id === userId) return true;
    } catch { /* Session refresh or inspection failed. */ }
    if (lockOnFailure && !retired && requestGeneration === sessionGeneration && currentUserId === userId) lockAdmin();
    return false;
  };

  const authorizeAction = async (userId) => {
    const requestGeneration = sessionGeneration;
    if (retired || currentUserId !== userId || coordinator?.getState().status !== ADMIN_CMS_STATUS.READY) return false;
    monitorEpoch += 1;
    actionChecks += 1;
    try {
      if (!await verifySession(userId, requestGeneration)) return false;
      adminAccess.invalidate();
      const access = await boundedAccessResponse();
      if (retired || requestGeneration !== sessionGeneration || currentUserId !== userId
        || coordinator?.getState().status !== ADMIN_CMS_STATUS.READY) return false;
      if (access?.status !== 'authorized') {
        lockAdmin();
        return false;
      }
      return verifySession(userId, requestGeneration);
    } catch {
      if (!retired && requestGeneration === sessionGeneration && currentUserId === userId) lockAdmin();
      return false;
    } finally {
      actionChecks -= 1;
      monitorEpoch += 1;
      monitorRequest = null;
      monitorSkippedTicks = 0;
    }
  };

  const checkSessionPeriodically = () => {
    checkPendingDeadlines();
    if (retired || actionChecks > 0 || coordinator?.getState().status !== ADMIN_CMS_STATUS.READY
      || !currentUserId) return;
    if (monitorRequest || monitorOutstanding >= 2) {
      // Six observed five-second ticks are a second fail-closed bound. Wall-clock
      // deadlines above also reject late results when browser timers are throttled.
      monitorSkippedTicks += 1;
      if (monitorSkippedTicks >= 6) lockAdmin();
      return;
    }
    const userId = currentUserId;
    const requestGeneration = sessionGeneration;
    const requestEpoch = monitorEpoch;
    monitorSkippedTicks = 0;
    const request = verifySession(userId, requestGeneration, false);
    monitorRequest = request;
    monitorOutstanding += 1;
    void request.then((valid) => {
      if (!retired && requestGeneration === sessionGeneration && requestEpoch === monitorEpoch
        && currentUserId === userId && valid !== true) lockAdmin();
    }).catch(() => {
      if (!retired && requestGeneration === sessionGeneration && requestEpoch === monitorEpoch
        && currentUserId === userId) lockAdmin();
    }).finally(() => {
      monitorOutstanding -= 1;
      if (monitorRequest === request) monitorRequest = null;
    });
  };
  const onPageResume = () => {
    checkPendingDeadlines();
    if (checkLeases.length === 0 && !monitorRequest) checkSessionPeriodically();
  };

  const render = (state) => {
    const rendered = renderAdminCmsState(
      elements,
      state,
      documentLike,
      elements.search.value,
      elements.statusFilter.value,
      editor,
      currentUserId === null ? false : true,
      taxonomiesReady,
      handleStatusTransition,
      pendingStatusIds
    );
    if (rendered && state.status === ADMIN_CMS_STATUS.READY && editor && !taxonomiesReady) {
      const explanation = taxonomiesChecked
        ? 'Draft editor requires active categories and cuisines.'
        : 'Loading draft category and cuisine choices.';
      elements.status.textContent = `${savedNotice ? 'Draft saved. ' : 'Recipe catalog ready. '}${explanation}`;
      elements.status.classList.toggle('is-error', taxonomiesChecked);
    } else if (rendered && savedNotice && state.status === ADMIN_CMS_STATUS.READY) {
      elements.status.textContent = 'Draft saved. Recipe catalog ready.';
    } else if (rendered && savedNotice && state.status === ADMIN_CMS_STATUS.ERROR) {
      elements.status.textContent = 'Draft saved, but the catalog could not be refreshed.';
    } else if (rendered && statusNotice && state.status === ADMIN_CMS_STATUS.READY) {
      elements.status.textContent = statusNotice;
    } else if (rendered && statusNotice && state.status === ADMIN_CMS_STATUS.ERROR) {
      elements.status.textContent = `${statusNotice} Catalog refresh is unavailable.`;
    }
    return rendered;
  };
  const onSearch = () => { if (coordinator) render(coordinator.getState()); };
  const onStatusFilter = () => { if (coordinator) render(coordinator.getState()); };
  const onCreate = () => {
    if (editor && taxonomiesReady && coordinator?.getState().status === ADMIN_CMS_STATUS.READY) {
      void editor.openCreate();
    }
  };
  const handleStatusTransition = async (recipe) => {
    const accountId = currentUserId;
    const actionGeneration = statusActionGeneration;
    const currentRow = () => coordinator?.getState().recipes?.find?.((item) => item.id === recipe.id);
    const stillCurrent = () => !retired && actionGeneration === statusActionGeneration
      && currentUserId === accountId && coordinator?.getState().status === ADMIN_CMS_STATUS.READY;
    if (!stillCurrent() || !isValidAccountUserId(accountId) || !mutationService
      || typeof mutationService.transitionStatus !== 'function' || pendingStatusIds.has(recipe.id)
      || editor?.isDirty?.() === true || editor?.isPending?.() === true
      || recipe.sourceType !== 'cms' || !['draft', 'published'].includes(recipe.status)
      || typeof recipe.updatedAt !== 'string') return false;
    const row = currentRow();
    if (row?.status !== recipe.status || row?.sourceType !== 'cms'
      || row?.updatedAt !== recipe.updatedAt) return false;
    pendingStatusIds.add(recipe.id);
    savedNotice = false;
    render(coordinator.getState());
    try {
      const publishing = recipe.status === 'draft';
      const confirm = options.confirmStatusChange ?? windowLike?.confirm?.bind(windowLike);
      if (typeof confirm !== 'function') return false;
      const question = publishing
        ? `Publish ${recipe.name}? This makes the full recipe publicly accessible under current database permissions.`
        : `Unpublish ${recipe.name}? This removes the recipe from the public catalog and may hide saved favorites.`;
      if (await confirm(question) !== true || !stillCurrent()) return false;
      if (!await authorizeAction(accountId) || !stillCurrent()) return false;
      const refreshedRow = currentRow();
      if (refreshedRow?.status !== recipe.status || refreshedRow?.sourceType !== 'cms'
        || refreshedRow?.updatedAt !== recipe.updatedAt) return false;
      const result = await mutationService.transitionStatus({
        recipeId: recipe.id,
        expectedStatus: recipe.status,
        expectedUpdatedAt: recipe.updatedAt,
        desiredStatus: publishing ? 'published' : 'draft',
      });
      if (!stillCurrent()) return false;
      if (result?.status === ADMIN_RECIPE_MUTATION_STATUS.DENIED) {
        lockAdmin();
        return false;
      }
      if (result?.status === ADMIN_RECIPE_MUTATION_STATUS.SUCCESS) {
        statusNotice = publishing ? 'Recipe published.' : 'Recipe unpublished.';
        const refreshed = await coordinator.refreshRecipes();
        if (stillCurrent() && !refreshed) statusNotice += ' Catalog refresh is unavailable.';
        return refreshed === true && stillCurrent();
      }
      statusNotice = result?.status === ADMIN_RECIPE_MUTATION_STATUS.CONFLICT
        ? 'Recipe changed. Refreshing the catalog.'
        : 'Recipe status could not be confirmed. Reload before trying again.';
      if (result?.status === ADMIN_RECIPE_MUTATION_STATUS.CONFLICT) {
        await coordinator.refreshRecipes();
      }
      return false;
    } catch {
      if (stillCurrent()) statusNotice = 'Recipe status could not be confirmed. Reload before trying again.';
      return false;
    } finally {
      if (actionGeneration === statusActionGeneration) pendingStatusIds.delete(recipe.id);
      if (stillCurrent()) render(coordinator.getState());
    }
  };
  const checkTaxonomies = (userId) => {
    const requestGeneration = ++taxonomyGeneration;
    void (async () => {
      let ready = false;
      try {
        const [categories, cuisines] = await Promise.all([
          taxonomySource.listCategories(), taxonomySource.listCuisines(),
        ]);
        ready = categories?.error === null && cuisines?.error === null
          && Array.isArray(categories.data) && Array.isArray(cuisines.data)
          && categories.data.some((item) => item?.isActive === true)
          && cuisines.data.some((item) => item?.isActive === true);
      } catch { /* Taxonomy failures keep draft actions disabled. */ }
      if (retired || requestGeneration !== taxonomyGeneration || currentUserId !== userId
        || coordinator?.getState().status !== ADMIN_CMS_STATUS.READY) return;
      taxonomiesReady = ready;
      taxonomiesChecked = true;
      render(coordinator.getState());
    })();
  };
  const onLogout = () => {
    drawer.close();
    lockAdmin();
    if (sessionService) void sessionService.logout();
  };

  return Object.freeze({
    activate() {
      if (retired) return Promise.resolve(false);
      if (activationPromise) return activationPromise;
      const activationGeneration = ++generation;
      render({ status: ADMIN_CMS_STATUS.LOADING, recipes: [] });
      const attempt = (async () => {
        try {
          const configModule = await loadConfig();
          if (retired || activationGeneration !== generation) return false;
          owner = createClientOwner({
            config: configModule?.SUPABASE_CONFIG,
            sdk,
            profile: SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION,
          });
          const client = owner.initialize(SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
          authClient = client;
          adminAccess = createAccessService(client);
          const recipeSource = createRecipeSource(client);
          const boundedAdminAccess = Object.freeze({
            check: boundedAccessResponse,
            invalidate: () => adminAccess.invalidate(),
            cleanup: () => adminAccess.cleanup(),
          });
          coordinator = createCoordinator({ adminAccess: boundedAdminAccess, recipeSource });
          if (typeof createMutationService === 'function' && typeof createTaxonomySource === 'function') {
            mutationService = createMutationService(client);
            taxonomySource = createTaxonomySource(client);
            editor = createEditor({
              elements: editorElements(elements.root),
              documentLike,
              windowLike,
              recipeSource,
              mutationService,
              taxonomySource,
              createRecipeId: options.createRecipeId,
              confirmDiscard: options.confirmDiscard,
              onSaved: (recipe) => {
                savedNotice = true;
                try { Promise.resolve(coordinator.refreshRecipes()).catch(() => {}); } catch { /* Refresh fails closed. */ }
                observeCallback(options.onSaved, recipe);
              },
              onAuthorizationLost: () => {
                savedNotice = false;
                try { Promise.resolve(coordinator.refreshRecipes()).catch(() => {}); } catch { /* Refresh fails closed. */ }
                observeCallback(options.onAuthorizationLost);
              },
              authorizeAction,
            });
          }
          sessionService = createSessionService(client);
          unsubscribeCoordinator = coordinator.subscribe((state) => {
            if (state.status !== ADMIN_CMS_STATUS.READY) drawer.close();
            taxonomyGeneration += 1;
            taxonomiesReady = false;
            taxonomiesChecked = false;
            editor?.setAuthorization(state.status === ADMIN_CMS_STATUS.READY, currentUserId);
            render(state);
            if (state.status === ADMIN_CMS_STATUS.READY && editor && taxonomySource) {
              checkTaxonomies(currentUserId);
            }
          });
          unsubscribeSession = sessionService.subscribe((state) => {
            sessionGeneration += 1;
            statusActionGeneration += 1;
            pendingStatusIds.clear();
            statusNotice = '';
            try { mutationService?.invalidate?.(); } catch { /* Stale responses remain ignored. */ }
            monitorEpoch += 1;
            monitorRequest = null;
            monitorSkippedTicks = 0;
            drawer.close();
            savedNotice = false;
            const previousUserId = currentUserId;
            const sameReadyAccount = state?.status === 'authenticated'
              && previousUserId === state?.user?.id
              && coordinator.getState().status === ADMIN_CMS_STATUS.READY;
            currentUserId = state?.status === 'authenticated' && typeof state?.user?.id === 'string'
              ? state.user.id
              : null;
            if (currentUserId && !sameReadyAccount) {
              const requestGeneration = sessionGeneration;
              void coordinator.acceptAuthState({ status: 'loading', user: null });
              void verifySession(currentUserId, requestGeneration).then((valid) => {
                if (valid && !retired && requestGeneration === sessionGeneration) {
                  return coordinator.acceptAuthState(state);
                }
                return false;
              }).catch(() => { if (!retired && requestGeneration === sessionGeneration) lockAdmin(); });
            } else if (sameReadyAccount) {
              void verifySession(currentUserId, sessionGeneration);
            } else {
              void coordinator.acceptAuthState(state);
            }
          });
          if (!listenersInstalled) {
            elements.search.addEventListener('input', onSearch);
            elements.statusFilter.addEventListener('change', onStatusFilter);
            elements.create.addEventListener('click', onCreate);
            elements.logout.addEventListener('click', onLogout);
            listenersInstalled = true;
          }
          await sessionService.bootstrap();
          documentLike?.addEventListener?.('visibilitychange', onPageResume);
          windowLike?.addEventListener?.('focus', onPageResume);
          if (!retired && typeof windowLike?.setInterval === 'function') {
            expiryMonitor = windowLike.setInterval(checkSessionPeriodically, 5000);
          }
          return !retired && activationGeneration === generation;
        } catch {
          if (!retired && activationGeneration === generation) {
            render({ status: ADMIN_CMS_STATUS.ERROR, recipes: [] });
          }
          return false;
        }
      })();
      activationPromise = attempt;
      return attempt;
    },

    cleanup() {
      if (retired) return false;
      retired = true;
      statusActionGeneration += 1;
      pendingStatusIds.clear();
      statusNotice = '';
      try { mutationService?.cleanup?.(); } catch { /* Page retirement remains terminal. */ }
      for (const lease of [...checkLeases]) lease.retire(null);
      try { documentLike?.removeEventListener?.('visibilitychange', onPageResume); } catch { /* Page retirement remains terminal. */ }
      try { windowLike?.removeEventListener?.('focus', onPageResume); } catch { /* Page retirement remains terminal. */ }
      if (expiryMonitor !== null) {
        try { windowLike?.clearInterval?.(expiryMonitor); } catch { /* Cleanup remains terminal. */ }
        expiryMonitor = null;
      }
      sessionGeneration += 1;
      monitorEpoch += 1;
      monitorRequest = null;
      generation += 1;
      taxonomyGeneration += 1;
      taxonomiesReady = false;
      taxonomiesChecked = false;
      savedNotice = false;
      try { unsubscribeSession?.(); } catch { /* Subscription cleanup stays isolated. */ }
      try { unsubscribeCoordinator?.(); } catch { /* View cleanup stays isolated. */ }
      try { sessionService?.cleanup?.(); } catch { /* Auth cleanup stays isolated. */ }
      try { coordinator?.cleanup?.(); } catch { /* Admin cleanup stays isolated. */ }
      try { editor?.cleanup?.(); } catch { /* Editor cleanup stays isolated. */ }
      try { drawer.cleanup(); } catch { /* Drawer cleanup restores workspace interaction. */ }
      currentUserId = null;
      if (listenersInstalled) {
        try { elements.search.removeEventListener('input', onSearch); } catch { /* DOM cleanup stays isolated. */ }
        try { elements.statusFilter.removeEventListener('change', onStatusFilter); } catch { /* DOM cleanup stays isolated. */ }
        try { elements.create.removeEventListener('click', onCreate); } catch { /* DOM cleanup stays isolated. */ }
        try { elements.logout.removeEventListener('click', onLogout); } catch { /* DOM cleanup stays isolated. */ }
        listenersInstalled = false;
      }
      render({ status: ADMIN_CMS_STATUS.RETIRED, recipes: [] });
      return true;
    },
  });
}

if (typeof document !== 'undefined') {
  const adminPage = createAdminPageActivation();
  void adminPage.activate();
  globalThis.addEventListener?.('pagehide', () => adminPage.cleanup(), { once: true });
}
