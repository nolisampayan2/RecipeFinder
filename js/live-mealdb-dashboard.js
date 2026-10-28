import { createLiveMealDbSearch } from './live-mealdb-search.js';

const IDLE_STATE = Object.freeze({
  status: 'idle', recipes: Object.freeze([]), error: null, generation: 0, provider: 'themealdb', query: '',
});
const SAFE_ERROR = Object.freeze({
  code: 'unavailable', message: 'TheMealDB results could not be loaded. Try again.',
});

function normalizeQuery(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createLiveMealDbDashboard({
  fetchImpl,
  createCoordinator = createLiveMealDbSearch,
  onState = () => {},
} = {}) {
  if (typeof createCoordinator !== 'function' || typeof onState !== 'function') {
    throw new TypeError('Valid live dashboard dependencies are required.');
  }

  let coordinator = null;
  let active = false;
  let uiGeneration = 0;
  let state = IDLE_STATE;

  const publish = (nextState) => {
    state = nextState;
    onState(state);
    return state;
  };

  const ensureCoordinator = () => {
    if (!coordinator) coordinator = createCoordinator({ fetchImpl });
    return coordinator;
  };

  const run = (operation, query) => {
    const requestGeneration = ++uiGeneration;
    active = true;
    let request;
    try {
      const currentCoordinator = ensureCoordinator();
      request = operation === 'retry' ? currentCoordinator.retry() : currentCoordinator.search(query);
      publish(currentCoordinator.getState());
    } catch {
      return Promise.resolve(publish(Object.freeze({
        ...IDLE_STATE, status: 'error', error: SAFE_ERROR, generation: requestGeneration, query: query || '',
      })));
    }

    return Promise.resolve(request).then((result) => {
      if (!active || requestGeneration !== uiGeneration) return state;
      return publish(result);
    }, () => {
      if (!active || requestGeneration !== uiGeneration) return state;
      return publish(Object.freeze({
        ...IDLE_STATE, status: 'error', error: SAFE_ERROR, generation: requestGeneration, query: query || '',
      }));
    });
  };

  return Object.freeze({
    search(value) {
      const query = normalizeQuery(value);
      return query ? run('search', query) : Promise.resolve(state);
    },
    retry() {
      return active && state.status === 'error' ? run('retry', state.query) : Promise.resolve(state);
    },
    reset() {
      active = false;
      uiGeneration += 1;
      coordinator?.reset();
      return publish(Object.freeze({ ...IDLE_STATE, generation: uiGeneration }));
    },
    getState: () => state,
    isActive: () => active,
  });
}
