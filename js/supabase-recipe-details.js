import { normalizePublishedRecipeRow } from './supabase-recipe-source.js';
import { isValidAccountUserId, isValidFavoriteRecipeId } from './supabase-favorites.js';

export const AUTHENTICATED_RECIPE_DETAIL_SELECT = Object.freeze([
  'id',
  'name',
  'description',
  'image_url',
  'fallback_image_url',
  'tutorial_url',
  'ingredients',
  'instructions',
  'status',
  'source_type',
  'external_provider',
  'external_id',
  'category:recipe_categories!inner(name)',
  'cuisine:cuisines!inner(name)',
].join(','));

const ERROR = Object.freeze({
  UNAUTHORIZED: Object.freeze({
    code: 'UNAUTHORIZED',
    message: 'Sign in with a confirmed account to view recipe details.',
  }),
  INVALID_INPUT: Object.freeze({
    code: 'INVALID_INPUT',
    message: 'Recipe details are unavailable.',
  }),
  NOT_FOUND: Object.freeze({
    code: 'NOT_FOUND',
    message: 'Recipe details are unavailable.',
  }),
  UNAVAILABLE: Object.freeze({
    code: 'UNAVAILABLE',
    message: 'Recipe details are unavailable.',
  }),
  STALE: Object.freeze({
    code: 'STALE',
    message: 'Recipe request was canceled.',
  }),
});

function failure(error, stale = false) {
  return Object.freeze({ data: null, error, stale });
}

const UNAUTHORIZED_RESULT = failure(ERROR.UNAUTHORIZED);
const INVALID_INPUT_RESULT = failure(ERROR.INVALID_INPUT);
const NOT_FOUND_RESULT = failure(ERROR.NOT_FOUND);
const UNAVAILABLE_RESULT = failure(ERROR.UNAVAILABLE);
const STALE_RESULT = failure(ERROR.STALE, true);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireClient(client) {
  let from;
  try {
    from = client?.from;
  } catch {
    throw new TypeError('A compatible Supabase recipe detail client is required.');
  }
  if (typeof from !== 'function') {
    throw new TypeError('A compatible Supabase recipe detail client is required.');
  }
  return from;
}

function authenticatedUserId(authContext) {
  try {
    if (!isRecord(authContext) || authContext.status !== 'authenticated') return null;
    const candidateUserId = authContext.userId;
    return isValidAccountUserId(candidateUserId) ? candidateUserId.toLowerCase() : null;
  } catch {
    return null;
  }
}

function isRecipeFinderId(recipeId) {
  return isValidFavoriteRecipeId(recipeId) && !recipeId.startsWith('external:');
}

function explicitRows(response) {
  if (
    !isRecord(response)
    || !Object.prototype.hasOwnProperty.call(response, 'error')
    || response.error !== null
    || !Object.prototype.hasOwnProperty.call(response, 'data')
    || !Array.isArray(response.data)
    || Object.prototype.hasOwnProperty.call(response.data, 'map')
  ) return null;
  return response.data;
}

/**
 * Creates an inactive, injected-client detail boundary for authenticated users.
 * Authentication transitions must call invalidate(); cleanup() permanently
 * retires the instance. Protected recipe values are never cached by the service.
 */
export function createAuthenticatedRecipeDetailService(client) {
  const from = requireClient(client);
  let generation = 0;
  let pending = null;
  let retired = false;

  function getPublishedById(recipeId, authContext) {
    if (retired) return Promise.resolve(STALE_RESULT);

    const userId = authenticatedUserId(authContext);
    if (!userId) return Promise.resolve(UNAUTHORIZED_RESULT);
    if (!isRecipeFinderId(recipeId)) return Promise.resolve(INVALID_INPUT_RESULT);

    const requestKey = `${userId}\u0000${recipeId}`;
    if (pending?.key === requestKey) return pending.promise;

    const requestGeneration = ++generation;
    const operation = (async () => {
      try {
        const table = from.call(client, 'recipes');
        if (!isRecord(table) || typeof table.select !== 'function') return UNAVAILABLE_RESULT;
        const selected = table.select(AUTHENTICATED_RECIPE_DETAIL_SELECT);
        if (!selected || typeof selected.eq !== 'function') return UNAVAILABLE_RESULT;
        const identified = selected.eq('id', recipeId);
        if (!identified || typeof identified.eq !== 'function') return UNAVAILABLE_RESULT;
        const published = identified.eq('status', 'published');
        if (!published || typeof published.limit !== 'function') return UNAVAILABLE_RESULT;
        const response = await published.limit(2);

        if (retired || requestGeneration !== generation) return STALE_RESULT;
        const rows = explicitRows(response);
        if (!rows) return UNAVAILABLE_RESULT;
        if (rows.length === 0) return NOT_FOUND_RESULT;
        if (rows.length !== 1 || !Object.prototype.hasOwnProperty.call(rows, 0)) {
          return UNAVAILABLE_RESULT;
        }

        const recipe = normalizePublishedRecipeRow(rows[0]);
        if (recipe.id !== recipeId) return UNAVAILABLE_RESULT;
        return Object.freeze({ data: recipe, error: null, stale: false });
      } catch {
        return retired || requestGeneration !== generation ? STALE_RESULT : UNAVAILABLE_RESULT;
      }
    })();

    const ownedPending = Object.freeze({ key: requestKey, generation: requestGeneration, promise: operation });
    pending = ownedPending;
    void operation.finally(() => {
      if (pending === ownedPending) pending = null;
    });
    return operation;
  }

  return Object.freeze({
    getPublishedById,

    invalidate() {
      if (retired) return false;
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
