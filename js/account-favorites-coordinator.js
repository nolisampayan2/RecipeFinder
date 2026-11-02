import { isValidAccountUserId, isValidFavoriteRecipeId } from './supabase-favorites.js';

export const ACCOUNT_FAVORITES_MODE = Object.freeze({
  GUEST: 'guest',
  LOADING: 'account-loading',
  READY: 'account-ready',
  ERROR: 'account-error',
});

const RESULT = Object.freeze({
  SUCCESS: 'SUCCESS',
  INACTIVE: 'INACTIVE',
  INELIGIBLE: 'INELIGIBLE',
  FAILED: 'FAILED',
  STALE: 'STALE',
  RETIRED: 'RETIRED',
});

function hasOwn(value, property) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function snapshotIterable(value) {
  if (!value || typeof value[Symbol.iterator] !== 'function') {
    throw new TypeError('Favorites must be iterable.');
  }
  return Object.freeze(Array.from(new Set(value)));
}

function requireService(service) {
  try {
    if (
      !service
      || typeof service !== 'object'
      || typeof service.listOwn !== 'function'
      || typeof service.addOwn !== 'function'
      || typeof service.removeOwn !== 'function'
    ) throw new TypeError('A compatible account favorites service is required.');
  } catch {
    throw new TypeError('A compatible account favorites service is required.');
  }
  return service;
}

function requireUserId(value) {
  if (!isValidAccountUserId(value)) throw new TypeError('A valid authenticated user ID is required.');
  return value;
}

function requireDenseRecipes(value) {
  if (!Array.isArray(value) || hasOwn(value, 'map')) {
    throw new TypeError('The active catalog must be a dense recipe array.');
  }
  const eligible = new Set();
  for (let index = 0; index < value.length; index += 1) {
    if (!hasOwn(value, index)) throw new TypeError('The active catalog must not be sparse.');
    const recipe = value[index];
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) continue;
    let source;
    try { source = recipe.source; } catch { throw new TypeError('The active catalog is malformed.'); }
    if (source !== 'database') continue;
    let id;
    try { id = recipe.id; } catch { throw new TypeError('The active catalog is malformed.'); }
    if (!isValidFavoriteRecipeId(id)) throw new TypeError('A database recipe ID is malformed.');
    if (eligible.has(id)) throw new TypeError('The active catalog contains duplicate database recipe IDs.');
    eligible.add(id);
  }
  return eligible;
}

function requireAccountIds(value) {
  if (!Array.isArray(value) || hasOwn(value, 'map')) {
    throw new TypeError('Account favorites are malformed.');
  }
  const ids = new Set();
  for (let index = 0; index < value.length; index += 1) {
    if (!hasOwn(value, index)) throw new TypeError('Account favorites must not be sparse.');
    const id = value[index];
    if (!isValidFavoriteRecipeId(id) || ids.has(id)) {
      throw new TypeError('Account favorites are malformed.');
    }
    ids.add(id);
  }
  return ids;
}

function fixedOperationResult(ok, code, recipeId = null) {
  return Object.freeze({ ok, code, recipeId });
}

export function createAccountFavoritesCoordinator({ service, guestFavorites = [] } = {}) {
  const favoritesService = requireService(service);
  let guestIds = snapshotIterable(guestFavorites);
  let accountIds = new Set();
  let eligibleIds = new Set();
  let mode = ACCOUNT_FAVORITES_MODE.GUEST;
  let activeUserId = null;
  let generation = 0;
  let eligibilityGeneration = 0;
  let retired = false;
  let pendingLoad = null;
  const pendingOperations = new Map();
  const listeners = new Set();

  const stateSnapshot = () => Object.freeze({
    mode,
    favoriteIds: mode === ACCOUNT_FAVORITES_MODE.GUEST
      ? guestIds
      : Object.freeze([...accountIds]),
  });

  const publish = () => {
    const snapshot = stateSnapshot();
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* Consumer failures stay isolated. */ }
    }
    return snapshot;
  };

  const invalidateAccountWork = () => {
    generation += 1;
    pendingLoad = null;
    pendingOperations.clear();
  };

  const enterGuest = (favorites = guestIds) => {
    if (retired) return false;
    guestIds = snapshotIterable(favorites);
    invalidateAccountWork();
    activeUserId = null;
    accountIds = new Set();
    mode = ACCOUNT_FAVORITES_MODE.GUEST;
    publish();
    return true;
  };

  const loadAccount = (userId) => {
    if (retired) return Promise.resolve(false);
    const requestedUserId = requireUserId(userId);
    if (
      pendingLoad
      && activeUserId === requestedUserId
      && mode === ACCOUNT_FAVORITES_MODE.LOADING
    ) return pendingLoad;

    invalidateAccountWork();
    const loadGeneration = generation;
    activeUserId = requestedUserId;
    accountIds = new Set();
    mode = ACCOUNT_FAVORITES_MODE.LOADING;
    publish();

    const attempt = (async () => {
      let response;
      try {
        response = await favoritesService.listOwn(requestedUserId);
      } catch {
        response = null;
      }
      if (retired || generation !== loadGeneration || activeUserId !== requestedUserId) return false;
      try {
        if (!response || response.error !== null || !Array.isArray(response.data)) {
          throw new TypeError('Invalid account Favorites response.');
        }
        accountIds = requireAccountIds(response.data);
      } catch {
        accountIds = new Set();
        mode = ACCOUNT_FAVORITES_MODE.ERROR;
        publish();
        return false;
      }
      mode = ACCOUNT_FAVORITES_MODE.READY;
      publish();
      return true;
    })();
    pendingLoad = attempt;
    void attempt.then(() => {
      if (pendingLoad === attempt) pendingLoad = null;
    });
    return attempt;
  };

  const toggleAccountFavorite = (recipe) => {
    if (retired) return Promise.resolve(fixedOperationResult(false, RESULT.RETIRED));
    if (mode !== ACCOUNT_FAVORITES_MODE.READY || !activeUserId) {
      return Promise.resolve(fixedOperationResult(false, RESULT.INACTIVE));
    }
    let recipeId;
    let source;
    try {
      recipeId = recipe?.id;
      source = recipe?.source;
    } catch {
      return Promise.resolve(fixedOperationResult(false, RESULT.INELIGIBLE));
    }
    if (source !== 'database' || !isValidFavoriteRecipeId(recipeId) || !eligibleIds.has(recipeId)) {
      return Promise.resolve(fixedOperationResult(false, RESULT.INELIGIBLE));
    }
    if (pendingOperations.has(recipeId)) return pendingOperations.get(recipeId);

    const operationGeneration = generation;
    const operationEligibilityGeneration = eligibilityGeneration;
    const operationUserId = activeUserId;
    const removing = accountIds.has(recipeId);
    const attempt = (async () => {
      let response;
      try {
        response = removing
          ? await favoritesService.removeOwn(operationUserId, recipeId)
          : await favoritesService.addOwn(operationUserId, recipeId);
      } catch {
        response = null;
      }
      if (
        retired
        || generation !== operationGeneration
        || eligibilityGeneration !== operationEligibilityGeneration
        || activeUserId !== operationUserId
        || mode !== ACCOUNT_FAVORITES_MODE.READY
        || !eligibleIds.has(recipeId)
      ) return fixedOperationResult(false, RESULT.STALE, recipeId);
      let succeeded = false;
      try {
        succeeded = Boolean(
          response
          && response.ok === true
          && response.recipeId === recipeId
          && response.error === null
        );
      } catch {
        succeeded = false;
      }
      if (!succeeded) {
        return fixedOperationResult(false, RESULT.FAILED, recipeId);
      }
      if (removing) accountIds.delete(recipeId);
      else accountIds.add(recipeId);
      publish();
      return fixedOperationResult(true, RESULT.SUCCESS, recipeId);
    })();
    pendingOperations.set(recipeId, attempt);
    void attempt.then(() => {
      if (pendingOperations.get(recipeId) === attempt) pendingOperations.delete(recipeId);
    });
    return attempt;
  };

  return Object.freeze({
    getState: stateSnapshot,

    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A favorites listener is required.');
      if (retired) return () => false;
      listeners.add(listener);
      try { listener(stateSnapshot()); } catch { /* Consumer failures stay isolated. */ }
      let active = true;
      return () => {
        if (!active) return false;
        active = false;
        return listeners.delete(listener);
      };
    },

    setGuestFavorites(favorites) {
      if (retired) return false;
      guestIds = snapshotIterable(favorites);
      if (mode === ACCOUNT_FAVORITES_MODE.GUEST) publish();
      return true;
    },

    setEligibleRecipes(recipes) {
      if (retired) return false;
      const nextEligibleIds = requireDenseRecipes(recipes);
      eligibilityGeneration += 1;
      eligibleIds = nextEligibleIds;
      // A provider write may already have reached the server. Retire only its
      // local result; the next account load reconciles confirmed server state.
      pendingOperations.clear();
      return true;
    },

    enterGuest,
    loadAccount,
    toggleAccountFavorite,

    cleanup() {
      if (retired) return false;
      retired = true;
      invalidateAccountWork();
      activeUserId = null;
      accountIds = new Set();
      eligibleIds = new Set();
      guestIds = Object.freeze([]);
      listeners.clear();
      return true;
    },
  });
}
