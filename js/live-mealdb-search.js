import { createExternalRecipeController } from './external-recipe-controller.js';
import { createMealDbClient } from './mealdb-client.js';
import { createMealDbRecipeSource } from './mealdb-recipe-source.js';

const PROVIDER = 'themealdb';
const SAFE_INITIALIZATION_ERROR = Object.freeze({
  code: 'unavailable',
  message: 'External recipes are temporarily unavailable. Try again.',
});

function normalizeQuery(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function snapshot(status = 'idle', recipes = [], error = null, generation = 0, query = '') {
  return Object.freeze({ status, recipes, error, generation, provider: PROVIDER, query });
}

export function createLiveMealDbSearch({
  fetchImpl,
  timeoutMs,
  createClient = createMealDbClient,
  createSource = createMealDbRecipeSource,
  createController = createExternalRecipeController,
} = {}) {
  let controller = null;
  let retryQuery = '';
  let generation = 0;
  let state = snapshot();

  const ensureController = () => {
    if (controller) return controller;
    const client = createClient({ fetchImpl, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
    const source = createSource({ client });
    controller = createController({ source });
    return controller;
  };

  const search = (value) => {
    const query = normalizeQuery(value);
    if (!query) return Promise.resolve(state);
    retryQuery = '';
    const requestGeneration = ++generation;
    state = snapshot('loading', state.recipes, null, requestGeneration, query);

    return Promise.resolve()
      .then(() => ensureController().search(query))
      .then(() => {
        if (requestGeneration !== generation) return state;
        const controllerState = controller.getState();
        state = snapshot(
          controllerState.status,
          controllerState.recipes,
          controllerState.error,
          requestGeneration,
          query,
        );
        retryQuery = state.status === 'error' ? query : '';
        return state;
      })
      .catch(() => {
        if (requestGeneration !== generation) return state;
        state = snapshot('error', state.recipes, SAFE_INITIALIZATION_ERROR, requestGeneration, query);
        retryQuery = query;
        return state;
      });
  };

  return Object.freeze({
    getState: () => state,
    search,
    retry: () => retryQuery && state.status !== 'loading' ? search(retryQuery) : Promise.resolve(state),
    reset() {
      controller?.invalidateCollection();
      retryQuery = '';
      generation += 1;
      state = snapshot('idle', Object.freeze([]), null, generation);
      return state;
    },
  });
}
