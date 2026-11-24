import { isValidAccountUserId } from './supabase-favorites.js';

const EMPTY = Object.freeze([]);
const STALE = Object.freeze({ ok: false, code: 'STALE' });
const DENIED = Object.freeze({ ok: false, code: 'DENIED' });
const BUSY = Object.freeze({ ok: false, code: 'BUSY' });

/** Owns account-scoped collection state; never shares results across users. */
export function createRecipeCollectionsController({ service, onState = () => {} } = {}) {
  if (!service || typeof service.listOwn !== 'function' || typeof onState !== 'function') {
    throw new TypeError('Collections dependencies are unavailable.');
  }
  let userId = null;
  let generation = 0;
  let pending = false;
  let retired = false;
  let state = Object.freeze({ status: 'loading', collections: EMPTY, message: '', pending: false });
  const publish = (status, collections = EMPTY, message = '') => {
    state = Object.freeze({ status, collections, message, pending });
    try { onState(state); } catch { /* Presentation errors do not authorize data. */ }
    return state;
  };
  const current = (id, epoch) => !retired && userId === id && generation === epoch;

  async function refresh(id = userId, epoch = generation) {
    if (!id || !current(id, epoch)) return STALE;
    let result;
    try { result = await service.listOwn(id); } catch { result = null; }
    if (!current(id, epoch)) return STALE;
    if (!result || result.error || !Array.isArray(result.data)) {
      publish('error', EMPTY, 'Collections are unavailable. Try again.');
      return Object.freeze({ ok: false, code: 'UNAVAILABLE' });
    }
    publish('ready', result.data);
    return Object.freeze({ ok: true, code: 'READY' });
  }

  function handleAuthState(auth) {
    if (retired) return Promise.resolve(false);
    const nextId = auth?.status === 'authenticated' && isValidAccountUserId(auth.userId)
      ? auth.userId.toLowerCase() : null;
    if (!nextId) {
      userId = null;
      generation += 1;
      pending = false;
      publish(auth?.status === 'guest' ? 'guest' : 'loading');
      return Promise.resolve(false);
    }
    if (nextId === userId && ['ready', 'loading'].includes(state.status)) return Promise.resolve(true);
    userId = nextId;
    const epoch = ++generation;
    pending = false;
    publish('loading');
    return refresh(nextId, epoch);
  }

  async function mutate(method, args) {
    const id = userId;
    const epoch = generation;
    if (!id || state.status !== 'ready') return DENIED;
    if (pending) return BUSY;
    pending = true;
    publish('ready', state.collections);
    // Logout or account switch in the same turn prevents provider dispatch.
    await Promise.resolve();
    if (!current(id, epoch)) return STALE;
    let response;
    try { response = await service[method](id, ...args); } catch { response = null; }
    if (!current(id, epoch)) return STALE;
    if (!response || response.error || !response.data) {
      pending = false;
      const message = response?.error?.code === 'DUPLICATE'
        ? 'This recipe or collection already exists.' : 'Collections could not be updated. Try again.';
      publish('ready', state.collections, message);
      const code = ['DUPLICATE', 'INVALID_INPUT', 'DENIED'].includes(response?.error?.code)
        ? response.error.code : 'UNAVAILABLE';
      return Object.freeze({ ok: false, code });
    }
    const refreshed = await refresh(id, epoch);
    if (!current(id, epoch)) return STALE;
    pending = false;
    if (!refreshed.ok) return Object.freeze({ ok: false, code: 'REFRESH_UNAVAILABLE' });
    publish('ready', state.collections, 'Collection saved.');
    return Object.freeze({ ok: true, code: 'SAVED' });
  }

  return Object.freeze({
    getState: () => state,
    handleAuthState,
    refresh: () => userId ? refresh() : Promise.resolve(DENIED),
    create: (name) => mutate('createOwn', [name]),
    rename: (collectionId, name) => mutate('renameOwn', [collectionId, name]),
    delete: (collectionId) => mutate('deleteOwn', [collectionId]),
    add: (collectionId, recipe) => mutate('addOwn', [collectionId, recipe]),
    remove: (collectionId, itemId) => mutate('removeOwn', [collectionId, itemId]),
    cleanup() {
      if (retired) return false;
      retired = true;
      userId = null;
      generation += 1;
      pending = false;
      publish('loading');
      return true;
    },
  });
}
