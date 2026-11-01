import { recipeCatalog } from './recipe-catalog.js';
import { composePublishedRecipeCatalog } from './recipe-catalog-composition.js';
import { createPublishedRecipeSource } from './supabase-recipe-source.js';

const PRIVATE_FAILURE = Object.freeze({
  data: null,
  error: Object.freeze({ code: 'unavailable', message: 'Published recipes are unavailable.' }),
});

const CANCELED_RESULT = Object.freeze({
  catalog: recipeCatalog,
  origin: 'built-in',
  databaseStatus: 'canceled',
  stale: true,
});

function hasOwn(value, property) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function currentResult(selection) {
  return Object.freeze({
    catalog: selection.catalog,
    origin: selection.origin,
    databaseStatus: selection.databaseStatus,
    stale: false,
  });
}

export function createDashboardRecipeCatalogLoader(options = {}) {
  let generation = 0;
  let pending = null;
  let retired = false;

  function resolveSource() {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    if (hasOwn(options, 'source')) return options.source;
    if (!hasOwn(options, 'client') || options.client == null) return null;
    return createPublishedRecipeSource(options.client);
  }

  function load() {
    if (retired) return Promise.resolve(CANCELED_RESULT);
    if (pending) return pending.promise;

    const loadGeneration = ++generation;
    const operation = (async () => {
      let sourceResult;
      try {
        const source = resolveSource();
        if (source === null || source === undefined) {
          sourceResult = undefined;
        } else {
          const listPublished = source.listPublished;
          if (typeof listPublished !== 'function') sourceResult = PRIVATE_FAILURE;
          else sourceResult = await listPublished.call(source);
        }
      } catch {
        sourceResult = PRIVATE_FAILURE;
      }

      if (retired || loadGeneration !== generation) return CANCELED_RESULT;
      return currentResult(composePublishedRecipeCatalog(sourceResult));
    })();

    const ownedPending = Object.freeze({ generation: loadGeneration, promise: operation });
    pending = ownedPending;
    operation.finally(() => {
      if (pending === ownedPending) pending = null;
    });
    return operation;
  }

  return Object.freeze({
    load,

    cancelPending() {
      if (retired || !pending) return false;
      generation += 1;
      pending = null;
      return true;
    },

    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      pending = null;
      return true;
    },
  });
}
