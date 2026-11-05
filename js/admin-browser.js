import { createAdminCmsCoordinator, ADMIN_CMS_STATUS } from './admin-cms.js';
import { createAdminRecipeEditor } from './admin-recipe-editor.js';
import { createAuthSessionService } from './auth-session.js';
import { createSupabaseAdminAccessService } from './supabase-admin-access.js';
import { createSupabaseAdminRecipeSource } from './supabase-admin-recipes.js';
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
  authenticated = null
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
    elements.create.disabled = !ready || !editor;
    elements.create.setAttribute('aria-disabled', String(!ready || !editor));
    elements.create.setAttribute('title', editor ? 'Create a recipe draft' : 'Draft saving is not activated in this build');
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
        const editable = Boolean(editor && recipe.status === 'draft' && recipe.id.startsWith('cms:'));
        edit.disabled = !editable;
        edit.setAttribute('aria-label', editable ? `Edit ${recipe.name}` : `${recipe.name} is read only`);
        if (editable) edit.addEventListener('click', () => { void editor.openEdit(recipe.id); });
        actionCell.append(edit);
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
  const createMutationService = options.createMutationService;
  const createTaxonomySource = options.createTaxonomySource;
  const elements = requireElements(documentLike);
  const drawer = createDrawer({ elements, documentLike, windowLike });

  let owner;
  let sessionService;
  let coordinator;
  let editor;
  let unsubscribeSession;
  let unsubscribeCoordinator;
  let activationPromise;
  let generation = 0;
  let retired = false;
  let listenersInstalled = false;
  let currentUserId = null;

  const render = (state) => renderAdminCmsState(
    elements,
    state,
    documentLike,
    elements.search.value,
    elements.statusFilter.value,
    editor,
    currentUserId === null ? false : true
  );
  const onSearch = () => { if (coordinator) render(coordinator.getState()); };
  const onStatusFilter = () => { if (coordinator) render(coordinator.getState()); };
  const onCreate = () => { if (editor) void editor.openCreate(); };
  const onLogout = () => {
    drawer.close();
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
          const adminAccess = createAccessService(client);
          const recipeSource = createRecipeSource(client);
          coordinator = createCoordinator({ adminAccess, recipeSource });
          if (typeof createMutationService === 'function' && typeof createTaxonomySource === 'function') {
            const mutationService = createMutationService(client);
            const taxonomySource = createTaxonomySource(client);
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
                try { Promise.resolve(coordinator.refreshRecipes()).catch(() => {}); } catch { /* Refresh fails closed. */ }
                observeCallback(options.onSaved, recipe);
              },
              onAuthorizationLost: () => {
                try { Promise.resolve(coordinator.refreshRecipes()).catch(() => {}); } catch { /* Refresh fails closed. */ }
                observeCallback(options.onAuthorizationLost);
              },
            });
          }
          sessionService = createSessionService(client);
          unsubscribeCoordinator = coordinator.subscribe((state) => {
            if (state.status !== ADMIN_CMS_STATUS.READY) drawer.close();
            editor?.setAuthorization(state.status === ADMIN_CMS_STATUS.READY, currentUserId);
            render(state);
          });
          unsubscribeSession = sessionService.subscribe((state) => {
            drawer.close();
            currentUserId = state?.status === 'authenticated' && typeof state?.user?.id === 'string'
              ? state.user.id
              : null;
            void coordinator.acceptAuthState(state);
          });
          if (!listenersInstalled) {
            elements.search.addEventListener('input', onSearch);
            elements.statusFilter.addEventListener('change', onStatusFilter);
            elements.create.addEventListener('click', onCreate);
            elements.logout.addEventListener('click', onLogout);
            listenersInstalled = true;
          }
          await sessionService.bootstrap();
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
      generation += 1;
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
