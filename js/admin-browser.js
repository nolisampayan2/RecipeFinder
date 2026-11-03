import { createAdminCmsCoordinator, ADMIN_CMS_STATUS } from './admin-cms.js';
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
    signIn: root?.querySelector?.('[data-admin-sign-in]'),
    logout: root?.querySelector?.('[data-admin-logout]'),
  };
  if (Object.values(elements).some((element) => !element)) {
    throw new TypeError('Admin interface is unavailable.');
  }
  return elements;
}

export function filterAdminRecipes(recipes, query) {
  if (!Array.isArray(recipes)) return Object.freeze([]);
  const normalizedQuery = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
  if (!normalizedQuery) return recipes;
  return Object.freeze(recipes.filter((recipe) => {
    try {
      return [recipe.name, recipe.category, recipe.cuisine, recipe.status]
        .some((value) => typeof value === 'string' && value.toLocaleLowerCase().includes(normalizedQuery));
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

export function renderAdminCmsState(elements, state, documentLike, query = '') {
  try {
    const status = Object.values(ADMIN_CMS_STATUS).includes(state?.status)
      ? state.status
      : ADMIN_CMS_STATUS.ERROR;
    const ready = status === ADMIN_CMS_STATUS.READY;
    const recipes = ready ? filterAdminRecipes(state.recipes, query) : Object.freeze([]);

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
    elements.signIn.hidden = ![
      ADMIN_CMS_STATUS.GUEST,
      ADMIN_CMS_STATUS.DENIED,
      ADMIN_CMS_STATUS.ERROR,
    ].includes(status);
    elements.logout.hidden = ![
      ADMIN_CMS_STATUS.CHECKING,
      ADMIN_CMS_STATUS.DENIED,
      ADMIN_CMS_STATUS.READY,
    ].includes(status);
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
        elements.rows.append(row);
      }
    }
    elements.empty.hidden = !ready || recipes.length > 0;
    elements.empty.textContent = query.trim()
      ? 'No recipes match this search.'
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
  const elements = requireElements(documentLike);

  let owner;
  let sessionService;
  let coordinator;
  let unsubscribeSession;
  let unsubscribeCoordinator;
  let activationPromise;
  let generation = 0;
  let retired = false;
  let listenersInstalled = false;

  const render = (state) => renderAdminCmsState(
    elements,
    state,
    documentLike,
    elements.search.value
  );
  const onSearch = () => { if (coordinator) render(coordinator.getState()); };
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
          sessionService = createSessionService(client);
          unsubscribeCoordinator = coordinator.subscribe(render);
          unsubscribeSession = sessionService.subscribe((state) => {
            void coordinator.acceptAuthState(state);
          });
          if (!listenersInstalled) {
            elements.search.addEventListener('input', onSearch);
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
      if (listenersInstalled) {
        try { elements.search.removeEventListener('input', onSearch); } catch { /* DOM cleanup stays isolated. */ }
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
