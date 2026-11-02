import { AUTH_SESSION_STATUS } from './auth-session.js';
import {
  ACCOUNT_FAVORITES_MODE,
  createAccountFavoritesCoordinator,
} from './account-favorites-coordinator.js';
import {
  createSupabaseFavoritesService,
  isValidAccountUserId,
  isValidFavoriteRecipeId,
} from './supabase-favorites.js';

const PUBLIC_MESSAGE = Object.freeze({
  GUEST: '',
  LOADING: 'Loading account favorites.',
  READY: '',
  ERROR: 'Account favorites are unavailable.',
});

function hasOwn(value, property) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function snapshotIds(value) {
  try {
    if (!value || typeof value[Symbol.iterator] !== 'function') {
      throw new TypeError('Guest favorites must be iterable.');
    }
    return Object.freeze(Array.from(new Set(value)));
  } catch {
    throw new TypeError('Guest favorites must be iterable.');
  }
}

function fixedResult(code, recipeId = null) {
  return Object.freeze({ ok: false, code, recipeId });
}

function requireDatabaseCatalog(result) {
  if (
    !result
    || typeof result !== 'object'
    || Array.isArray(result)
    || result.stale !== false
    || result.origin !== 'database'
    || result.databaseStatus !== 'success'
  ) return null;

  const list = result.catalog?.list;
  if (typeof list !== 'function') throw new TypeError('Database catalog is unavailable.');
  const recipes = list.call(result.catalog);
  if (!Array.isArray(recipes) || hasOwn(recipes, 'map')) {
    throw new TypeError('Database catalog is malformed.');
  }
  for (let index = 0; index < recipes.length; index += 1) {
    if (!hasOwn(recipes, index)) throw new TypeError('Database catalog is sparse.');
    const recipe = recipes[index];
    if (
      !recipe
      || typeof recipe !== 'object'
      || Array.isArray(recipe)
      || recipe.source !== 'database'
      || !isValidFavoriteRecipeId(recipe.id)
    ) throw new TypeError('Database catalog contains an ineligible recipe.');
  }
  return recipes;
}

export function createDashboardAccountFavorites(options = {}) {
  let client;
  let guestFavorites;
  let createService;
  let createCoordinator;
  try {
    client = options?.client;
    guestFavorites = options?.guestFavorites ?? [];
    createService = options?.createService ?? createSupabaseFavoritesService;
    createCoordinator = options?.createCoordinator ?? createAccountFavoritesCoordinator;
  } catch {
    throw new TypeError('Dashboard account favorites initialization failed.');
  }
  if (typeof createService !== 'function' || typeof createCoordinator !== 'function') {
    throw new TypeError('Dashboard account favorites initialization failed.');
  }

  let service;
  let guestIds;
  let coordinator;
  try {
    service = createService(client);
    guestIds = snapshotIds(guestFavorites);
    coordinator = createCoordinator({ service, guestFavorites: guestIds });
  } catch {
    throw new TypeError('Dashboard account favorites initialization failed.');
  }
  const listeners = new Set();
  const pendingOperations = new Map();
  let mode = ACCOUNT_FAVORITES_MODE.GUEST;
  let favoriteIds = guestIds;
  let authStatus = AUTH_SESSION_STATUS.LOADING;
  let activeUserId = null;
  let authGeneration = 0;
  let reconciliation = null;
  let retired = false;

  const snapshot = () => Object.freeze({
    mode,
    favoriteIds: Object.freeze([...favoriteIds]),
    pendingRecipeIds: Object.freeze([...pendingOperations.keys()]),
    message: mode === ACCOUNT_FAVORITES_MODE.GUEST
      ? PUBLIC_MESSAGE.GUEST
      : mode === ACCOUNT_FAVORITES_MODE.LOADING
        ? PUBLIC_MESSAGE.LOADING
        : mode === ACCOUNT_FAVORITES_MODE.ERROR
          ? PUBLIC_MESSAGE.ERROR
          : PUBLIC_MESSAGE.READY,
  });

  const publish = () => {
    if (retired) return snapshot();
    const next = snapshot();
    for (const listener of listeners) {
      try { listener(next); } catch { /* Presentation consumers stay isolated. */ }
    }
    return next;
  };

  const applyCoordinatorState = (state) => {
    if (retired) return;
    if (authStatus === AUTH_SESSION_STATUS.GUEST) {
      mode = ACCOUNT_FAVORITES_MODE.GUEST;
      favoriteIds = guestIds;
      publish();
      return;
    }
    if (authStatus !== AUTH_SESSION_STATUS.AUTHENTICATED || !activeUserId) return;
    if (!Object.values(ACCOUNT_FAVORITES_MODE).includes(state?.mode)) return;
    mode = state.mode;
    favoriteIds = state.mode === ACCOUNT_FAVORITES_MODE.GUEST
      ? Object.freeze([])
      : snapshotIds(state.favoriteIds ?? []);
    publish();
  };

  let unsubscribeCoordinator;
  try {
    unsubscribeCoordinator = coordinator.subscribe(applyCoordinatorState);
  } catch {
    try { coordinator.cleanup?.(); } catch { /* Failed ownership stays contained. */ }
    throw new TypeError('Dashboard account favorites initialization failed.');
  }

  const enterNonAccountState = (status) => {
    authGeneration += 1;
    activeUserId = null;
    authStatus = status;
    reconciliation = null;
    pendingOperations.clear();
    coordinator.enterGuest(guestIds);
    if (status === AUTH_SESSION_STATUS.GUEST) {
      mode = ACCOUNT_FAVORITES_MODE.GUEST;
      favoriteIds = guestIds;
    } else if (status === AUTH_SESSION_STATUS.LOADING) {
      mode = ACCOUNT_FAVORITES_MODE.LOADING;
      favoriteIds = Object.freeze([]);
    } else {
      mode = ACCOUNT_FAVORITES_MODE.ERROR;
      favoriteIds = Object.freeze([]);
    }
    publish();
    return true;
  };

  const loadActiveAccount = (expectedUserId, expectedGeneration) => {
    if (
      retired
      || authStatus !== AUTH_SESSION_STATUS.AUTHENTICATED
      || activeUserId !== expectedUserId
      || authGeneration !== expectedGeneration
    ) return Promise.resolve(false);
    try {
      return Promise.resolve(coordinator.loadAccount(expectedUserId)).catch(() => false);
    } catch {
      mode = ACCOUNT_FAVORITES_MODE.ERROR;
      favoriteIds = Object.freeze([]);
      publish();
      return Promise.resolve(false);
    }
  };

  const scheduleReconciliation = (expectedUserId, expectedGeneration) => {
    if (
      retired
      || authStatus !== AUTH_SESSION_STATUS.AUTHENTICATED
      || activeUserId !== expectedUserId
      || authGeneration !== expectedGeneration
    ) return Promise.resolve(false);
    if (reconciliation) return reconciliation.promise;

    const attempt = loadActiveAccount(expectedUserId, expectedGeneration);
    const owned = Object.freeze({ userId: expectedUserId, generation: expectedGeneration, promise: attempt });
    reconciliation = owned;
    void attempt.then(() => {
      if (reconciliation === owned) reconciliation = null;
    });
    return attempt;
  };

  return Object.freeze({
    getState: snapshot,

    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A favorites presentation listener is required.');
      if (retired) return () => false;
      listeners.add(listener);
      try { listener(snapshot()); } catch { /* Presentation consumers stay isolated. */ }
      let active = true;
      return () => {
        if (!active) return false;
        active = false;
        return listeners.delete(listener);
      };
    },

    setGuestFavorites(ids) {
      if (retired) return false;
      guestIds = snapshotIds(ids);
      coordinator.setGuestFavorites(guestIds);
      if (authStatus === AUTH_SESSION_STATUS.GUEST) {
        mode = ACCOUNT_FAVORITES_MODE.GUEST;
        favoriteIds = guestIds;
        publish();
      }
      return true;
    },

    handleAuthState(authState) {
      if (retired) return Promise.resolve(false);
      let status;
      let userId = null;
      try {
        status = authState?.status;
        if (!Object.values(AUTH_SESSION_STATUS).includes(status)) status = AUTH_SESSION_STATUS.ERROR;
        if (status === AUTH_SESSION_STATUS.AUTHENTICATED) userId = authState?.userId;
      } catch {
        status = AUTH_SESSION_STATUS.ERROR;
      }

      if (status !== AUTH_SESSION_STATUS.AUTHENTICATED || !isValidAccountUserId(userId)) {
        return Promise.resolve(enterNonAccountState(
          status === AUTH_SESSION_STATUS.AUTHENTICATED ? AUTH_SESSION_STATUS.ERROR : status,
        ));
      }

      if (authStatus === AUTH_SESSION_STATUS.AUTHENTICATED && activeUserId === userId) {
        if (mode !== ACCOUNT_FAVORITES_MODE.ERROR) return Promise.resolve(true);
      } else {
        authGeneration += 1;
        activeUserId = userId;
        authStatus = AUTH_SESSION_STATUS.AUTHENTICATED;
        reconciliation = null;
        pendingOperations.clear();
      }
      mode = ACCOUNT_FAVORITES_MODE.LOADING;
      favoriteIds = Object.freeze([]);
      publish();
      return loadActiveAccount(userId, authGeneration);
    },

    handleCatalogResult(result) {
      if (retired) return false;
      try {
        if (result?.stale === true) return false;
        const recipes = requireDatabaseCatalog(result);
        coordinator.setEligibleRecipes(recipes ?? []);
        return recipes !== null;
      } catch {
        try { coordinator.setEligibleRecipes([]); } catch { /* Eligibility fails closed. */ }
        return false;
      }
    },

    toggleFavorite(recipe) {
      if (retired) return Promise.resolve(fixedResult('RETIRED'));
      let recipeId = null;
      let source = null;
      try {
        recipeId = recipe?.id;
        source = recipe?.source;
      } catch {
        return Promise.resolve(fixedResult('INELIGIBLE'));
      }
      if (!isValidFavoriteRecipeId(recipeId) || source !== 'database') {
        return Promise.resolve(fixedResult('INELIGIBLE'));
      }
      const recipeSnapshot = Object.freeze({ id: recipeId, source });
      if (
        mode !== ACCOUNT_FAVORITES_MODE.READY
        || authStatus !== AUTH_SESSION_STATUS.AUTHENTICATED
        || !activeUserId
      ) return Promise.resolve(fixedResult('INACTIVE', isValidFavoriteRecipeId(recipeId) ? recipeId : null));
      if (pendingOperations.has(recipeId)) return pendingOperations.get(recipeId);

      const operationUserId = activeUserId;
      const operationGeneration = authGeneration;
      const attempt = Promise.resolve()
        .then(() => coordinator.toggleAccountFavorite(recipeSnapshot))
        .catch(() => fixedResult('FAILED', isValidFavoriteRecipeId(recipeId) ? recipeId : null))
        .then((result) => {
          if (
            result?.code === 'STALE'
            && !retired
            && activeUserId === operationUserId
            && authGeneration === operationGeneration
          ) void scheduleReconciliation(operationUserId, operationGeneration);
          return result;
        });
      pendingOperations.set(recipeId, attempt);
      publish();
      void attempt.then(() => {
        if (pendingOperations.get(recipeId) === attempt) {
          pendingOperations.delete(recipeId);
          publish();
        }
      });
      return attempt;
    },

    cleanup() {
      if (retired) return false;
      retired = true;
      authGeneration += 1;
      activeUserId = null;
      reconciliation = null;
      pendingOperations.clear();
      try { unsubscribeCoordinator?.(); } catch { /* Owned cleanup stays isolated. */ }
      try { coordinator.cleanup(); } catch { /* Owned cleanup stays isolated. */ }
      listeners.clear();
      return true;
    },
  });
}
