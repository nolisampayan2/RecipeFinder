import { parseMealDbRecipeId } from './mealdb-recipe-source.js';

const ERROR_MESSAGES = Object.freeze({
  timeout: 'External recipes took too long to respond. Try again.',
  network: 'External recipes are temporarily unreachable. Try again.',
  service: 'External recipes are temporarily unavailable. Try again.',
  invalid: 'External recipe data could not be used safely.',
  unavailable: 'External recipes could not be loaded. Try again.',
});

export class ExternalRecipeControllerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExternalRecipeControllerError';
    this.code = code;
  }
}

function requireSource(source) {
  const methods = ['search', 'filterCategory', 'filterCuisine', 'getDetails'];
  if (!source || typeof source !== 'object' || methods.some((method) => typeof source[method] !== 'function')) {
    throw new ExternalRecipeControllerError('INVALID_SOURCE', 'A compatible external recipe source is required.');
  }
  return source;
}

function immutableRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw new ExternalRecipeControllerError('INVALID_DATA', ERROR_MESSAGES.invalid);
  }
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((pair) => Object.freeze(Array.isArray(pair) ? [...pair] : []))
    : [];
  return Object.freeze({ ...recipe, ingredients: Object.freeze(ingredients) });
}

function immutableRecipes(recipes) {
  if (!Array.isArray(recipes)) throw new ExternalRecipeControllerError('INVALID_DATA', ERROR_MESSAGES.invalid);
  return Object.freeze(recipes.map(immutableRecipe));
}

function errorState(error) {
  const code = error?.code === 'TIMEOUT'
    ? 'timeout'
    : error?.code === 'NETWORK_ERROR'
      ? 'network'
      : error?.code === 'HTTP_ERROR'
        ? 'service'
        : error instanceof TypeError || ['INVALID_DATA', 'INVALID_RESPONSE', 'INVALID_JSON'].includes(error?.code)
          ? 'invalid'
          : 'unavailable';
  return Object.freeze({ code, message: ERROR_MESSAGES[code] });
}

function isCancellation(error, signal) {
  return signal.aborted || error?.code === 'ABORTED' || error?.name === 'AbortError';
}

function requireSignal(signal) {
  if (signal === undefined) return null;
  if (!signal || typeof signal !== 'object' || typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean') {
    throw new ExternalRecipeControllerError('INVALID_SIGNAL', 'signal must be an AbortSignal.');
  }
  return signal;
}

function requireIdentityParser(parser) {
  if (typeof parser !== 'function') {
    throw new ExternalRecipeControllerError('INVALID_IDENTITY_PARSER', 'An identity parser function is required.');
  }
  return (id) => {
    const identity = parser(id);
    if (!identity || typeof identity !== 'object' || identity.id !== id || typeof identity.id !== 'string') {
      throw new ExternalRecipeControllerError('INVALID_ID', 'A valid external recipe ID is required.');
    }
    return identity;
  };
}

export function createExternalRecipeController({ source, parseIdentity = parseMealDbRecipeId } = {}) {
  const recipeSource = requireSource(source);
  const identityParser = requireIdentityParser(parseIdentity);
  let generation = 0;
  let collectionController = null;
  let state = Object.freeze({ status: 'idle', recipes: Object.freeze([]), error: null, generation });
  const detailCache = new Map();
  const pendingDetails = new Map();

  const updateState = (status, recipes, error = null, stateGeneration = generation) => {
    state = Object.freeze({ status, recipes, error, generation: stateGeneration });
    return state;
  };

  const runCollection = (method, value, options = {}) => {
    const externalSignal = requireSignal(options.signal);
    collectionController?.abort();
    const previousRecipes = state.recipes;
    const controller = new AbortController();
    collectionController = controller;
    const requestGeneration = ++generation;
    const forwardAbort = () => controller.abort(externalSignal.reason);
    externalSignal?.addEventListener('abort', forwardAbort, { once: true });
    if (externalSignal?.aborted) controller.abort(externalSignal.reason);
    updateState('loading', previousRecipes, null, requestGeneration);

    return Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new ExternalRecipeControllerError('CANCELLED', 'The request was cancelled.');
        return recipeSource[method](value, { signal: controller.signal });
      })
      .then((recipes) => {
        if (requestGeneration !== generation || controller.signal.aborted) return state;
        const safeRecipes = immutableRecipes(recipes);
        return updateState(safeRecipes.length ? 'ready' : 'empty', safeRecipes, null, requestGeneration);
      })
      .catch((error) => {
        if (requestGeneration !== generation) return state;
        if (isCancellation(error, controller.signal)) {
          return updateState('idle', previousRecipes, null, requestGeneration);
        }
        return updateState('error', previousRecipes, errorState(error), requestGeneration);
      })
      .finally(() => {
        externalSignal?.removeEventListener('abort', forwardAbort);
        if (requestGeneration === generation) collectionController = null;
      });
  };

  const invalidateCollection = () => {
    collectionController?.abort();
    collectionController = null;
    generation += 1;
    return updateState('idle', state.recipes, null, generation);
  };

  const getDetails = (id) => {
    let identity;
    try {
      identity = identityParser(id);
    } catch {
      return Promise.reject(new ExternalRecipeControllerError('INVALID_ID', 'A valid external recipe ID is required.'));
    }
    if (detailCache.has(identity.id)) return Promise.resolve(detailCache.get(identity.id));
    if (pendingDetails.has(identity.id)) return pendingDetails.get(identity.id).promise;

    const controller = new AbortController();
    const token = Symbol(identity.id);
    const entry = { controller, token, promise: null };
    const promise = Promise.resolve()
      .then(() => recipeSource.getDetails(identity.id, { signal: controller.signal }))
      .then((recipe) => {
        const current = pendingDetails.get(identity.id);
        if (!current || current.token !== token || controller.signal.aborted) {
          throw new ExternalRecipeControllerError('CANCELLED', 'The detail request was cancelled.');
        }
        if (recipe?.id !== identity.id || recipe?.detailLevel !== 'full') {
          throw new ExternalRecipeControllerError('INVALID_DATA', ERROR_MESSAGES.invalid);
        }
        const safeRecipe = immutableRecipe(recipe);
        detailCache.set(identity.id, safeRecipe);
        return safeRecipe;
      })
      .catch((error) => {
        if (error instanceof ExternalRecipeControllerError) throw error;
        if (isCancellation(error, controller.signal)) {
          throw new ExternalRecipeControllerError('CANCELLED', 'The detail request was cancelled.');
        }
        throw new ExternalRecipeControllerError('DETAIL_UNAVAILABLE', 'External recipe details are unavailable.');
      })
      .finally(() => {
        if (pendingDetails.get(identity.id)?.token === token) pendingDetails.delete(identity.id);
      });
    entry.promise = promise;
    pendingDetails.set(identity.id, entry);
    return promise;
  };

  const invalidateDetails = (id) => {
    if (id === undefined) {
      pendingDetails.forEach(({ controller }) => controller.abort());
      pendingDetails.clear();
      return;
    }
    const identity = identityParser(id);
    pendingDetails.get(identity.id)?.controller.abort();
    pendingDetails.delete(identity.id);
  };

  return Object.freeze({
    getState: () => state,
    search: (query, options) => runCollection('search', query, options),
    filterCategory: (category, options) => runCollection('filterCategory', category, options),
    filterCuisine: (cuisine, options) => runCollection('filterCuisine', cuisine, options),
    invalidateCollection,
    getDetails,
    getCachedDetails(id) {
      try {
        return detailCache.get(identityParser(id).id) ?? null;
      } catch {
        return null;
      }
    },
    invalidateDetails,
    clearDetailCache: () => detailCache.clear(),
  });
}
