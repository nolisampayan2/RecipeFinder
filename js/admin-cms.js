import { ADMIN_ACCESS_STATUS } from './supabase-admin-access.js';
import { AUTH_SESSION_STATUS } from './auth-session.js';
import { isValidAccountUserId } from './supabase-favorites.js';

export const ADMIN_CMS_STATUS = Object.freeze({
  LOADING: 'loading',
  GUEST: 'guest',
  CHECKING: 'checking',
  DENIED: 'denied',
  READY: 'ready',
  ERROR: 'error',
  RETIRED: 'retired',
});

const EMPTY_RECIPES = Object.freeze([]);

function snapshot(status, recipes = EMPTY_RECIPES) {
  return Object.freeze({ status, recipes });
}

export function createAdminCmsCoordinator({ adminAccess, recipeSource } = {}) {
  if (typeof adminAccess?.check !== 'function' || typeof recipeSource?.listAll !== 'function') {
    throw new TypeError('Admin CMS dependencies are required.');
  }

  let state = snapshot(ADMIN_CMS_STATUS.LOADING);
  let generation = 0;
  let retired = false;
  let currentUserId = null;
  let currentRequest = null;
  let refreshRequest = null;
  const listeners = new Set();

  const publish = (nextState, expectedGeneration = generation) => {
    if (retired || expectedGeneration !== generation) return false;
    state = nextState;
    for (const listener of [...listeners]) {
      try { listener(state); } catch { /* View observers stay isolated. */ }
    }
    return true;
  };

  const beginAuthorization = (userId) => {
    const requestGeneration = generation;
    const attempt = (async () => {
      const access = await adminAccess.check();
      if (retired || requestGeneration !== generation || currentUserId !== userId) return false;
      if (access?.status === ADMIN_ACCESS_STATUS.DENIED) {
        return publish(snapshot(ADMIN_CMS_STATUS.DENIED), requestGeneration);
      }
      if (access?.status !== ADMIN_ACCESS_STATUS.AUTHORIZED) {
        return publish(snapshot(ADMIN_CMS_STATUS.ERROR), requestGeneration);
      }

      const result = await recipeSource.listAll();
      if (retired || requestGeneration !== generation || currentUserId !== userId) return false;
      if (!result || result.error !== null || !Array.isArray(result.data)) {
        return publish(snapshot(ADMIN_CMS_STATUS.ERROR), requestGeneration);
      }
      return publish(snapshot(ADMIN_CMS_STATUS.READY, result.data), requestGeneration);
    })().catch(() => {
      if (!retired && requestGeneration === generation && currentUserId === userId) {
        publish(snapshot(ADMIN_CMS_STATUS.ERROR), requestGeneration);
      }
      return false;
    }).finally(() => {
      if (currentRequest === attempt) currentRequest = null;
    });
    currentRequest = attempt;
    return attempt;
  };

  const restartAuthorization = () => {
    if (refreshRequest) return refreshRequest;
    if (retired || !isValidAccountUserId(currentUserId) || state.status !== ADMIN_CMS_STATUS.READY) {
      return Promise.resolve(false);
    }
    try { adminAccess.invalidate?.(); } catch { /* Refresh authorization fails closed. */ }
    try { recipeSource.invalidate?.(); } catch { /* Older recipe reads stay rejected. */ }
    generation += 1;
    const userId = currentUserId;
    publish(snapshot(ADMIN_CMS_STATUS.CHECKING));
    const attempt = beginAuthorization(userId);
    const refresh = attempt.finally(() => {
      if (refreshRequest === refresh) refreshRequest = null;
    });
    refreshRequest = refresh;
    return refresh;
  };

  return Object.freeze({
    getState() { return state; },

    subscribe(listener) {
      if (retired || typeof listener !== 'function') return () => false;
      listeners.add(listener);
      try { listener(state); } catch { /* Initial view errors stay isolated. */ }
      let active = true;
      return () => {
        if (!active) return false;
        active = false;
        return listeners.delete(listener);
      };
    },

    acceptAuthState(authState) {
      if (retired) return Promise.resolve(false);
      let status;
      let userId = null;
      try {
        status = authState?.status;
        if (status === AUTH_SESSION_STATUS.AUTHENTICATED) userId = authState?.user?.id;
      } catch {
        status = AUTH_SESSION_STATUS.ERROR;
      }

      if (status === AUTH_SESSION_STATUS.AUTHENTICATED && isValidAccountUserId(userId)) {
        if (currentUserId === userId && [
          ADMIN_CMS_STATUS.CHECKING,
          ADMIN_CMS_STATUS.READY,
        ].includes(state.status)) return currentRequest ?? Promise.resolve(true);
        try { adminAccess.invalidate?.(); } catch { /* Stale provider work remains rejected locally. */ }
        try { recipeSource.invalidate?.(); } catch { /* Stale provider work remains rejected locally. */ }
        generation += 1;
        refreshRequest = null;
        currentUserId = userId;
        publish(snapshot(ADMIN_CMS_STATUS.CHECKING));
        return beginAuthorization(userId);
      }

      try { adminAccess.invalidate?.(); } catch { /* Auth transitions fail closed. */ }
      try { recipeSource.invalidate?.(); } catch { /* Auth transitions fail closed. */ }
      generation += 1;
      refreshRequest = null;
      currentUserId = null;
      currentRequest = null;
      if (status === AUTH_SESSION_STATUS.GUEST) publish(snapshot(ADMIN_CMS_STATUS.GUEST));
      else if (status === AUTH_SESSION_STATUS.LOADING) publish(snapshot(ADMIN_CMS_STATUS.LOADING));
      else if (status === AUTH_SESSION_STATUS.PENDING_CONFIRMATION) publish(snapshot(ADMIN_CMS_STATUS.DENIED));
      else publish(snapshot(ADMIN_CMS_STATUS.ERROR));
      return Promise.resolve(true);
    },

    refreshRecipes() {
      return restartAuthorization();
    },

    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      refreshRequest = null;
      currentUserId = null;
      currentRequest = null;
      listeners.clear();
      try { adminAccess.cleanup?.(); } catch { /* Provider cleanup stays isolated. */ }
      try { recipeSource.cleanup?.(); } catch { /* Provider cleanup stays isolated. */ }
      state = snapshot(ADMIN_CMS_STATUS.RETIRED);
      return true;
    },
  });
}
