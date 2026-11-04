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
  };
  if (Object.values(elements).some((element) => !element)) {
    throw new TypeError('Admin interface is unavailable.');
  }
  return elements;
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

function appendCell(documentLike, row, value) {
  const cell = documentLike.createElement('td');
  cell.textContent = value;
  row.append(cell);
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
        appendCell(documentLike, row, recipe.name);
        appendCell(documentLike, row, recipe.category);
        appendCell(documentLike, row, recipe.cuisine);
        const statusCell = documentLike.createElement('td');
        const badge = documentLike.createElement('span');
        badge.className = `status-badge is-${recipe.status}`;
        badge.textContent = recipe.status === 'published' ? 'Published' : 'Draft';
        statusCell.append(badge);
        row.append(statusCell);
        const actionCell = documentLike.createElement('td');
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
  const sdk = options.sdk ?? globalThis.supabase;
  const loadConfig = options.loadConfig ?? loadLocalPublicConfig;
  const createClientOwner = options.createClientOwner ?? createSupabasePageClientOwner;
  const createSessionService = options.createSessionService ?? createAuthSessionService;
  const createAccessService = options.createAccessService ?? createSupabaseAdminAccessService;
  const createRecipeSource = options.createRecipeSource ?? createSupabaseAdminRecipeSource;
  const createCoordinator = options.createCoordinator ?? createAdminCmsCoordinator;
  const createEditor = options.createEditor ?? createAdminRecipeEditor;
  const createMutationService = options.createMutationService;
  const createTaxonomySource = options.createTaxonomySource;
  const elements = requireElements(documentLike);

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
  const onLogout = () => { if (sessionService) void sessionService.logout(); };

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
              windowLike: options.windowLike ?? globalThis,
              recipeSource,
              mutationService,
              taxonomySource,
              createRecipeId: options.createRecipeId,
              confirmDiscard: options.confirmDiscard,
              onSaved: options.onSaved,
            });
          }
          sessionService = createSessionService(client);
          unsubscribeCoordinator = coordinator.subscribe((state) => {
            editor?.setAuthorization(state.status === ADMIN_CMS_STATUS.READY, currentUserId);
            render(state);
          });
          unsubscribeSession = sessionService.subscribe((state) => {
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
