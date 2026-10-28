const MEALDB_BASE_URL = 'https://www.themealdb.com/api/json/v1/1/';
const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30000;

export class MealDbClientError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'MealDbClientError';
    this.code = code;
    if (Number.isInteger(options.status)) this.status = options.status;
  }
}

function requireFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new MealDbClientError('INVALID_CONFIGURATION', 'A fetch implementation is required.');
  }
  return fetchImpl;
}

function requireTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new MealDbClientError(
      'INVALID_CONFIGURATION',
      `timeoutMs must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`,
    );
  }
  return timeoutMs;
}

function requireText(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new MealDbClientError('INVALID_ARGUMENT', `${name} must be a non-empty text value.`);
  }
  return normalized;
}

function requireMealId(value) {
  const normalized = requireText(String(value ?? ''), 'mealId');
  if (!/^\d+$/.test(normalized)) {
    throw new MealDbClientError('INVALID_ARGUMENT', 'mealId must contain digits only.');
  }
  return normalized;
}

function assertObjectPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MealDbClientError('INVALID_RESPONSE', 'TheMealDB returned an unexpected response.');
  }
}

function validateMealsPayload(payload) {
  assertObjectPayload(payload);
  if (payload.meals !== null && !Array.isArray(payload.meals)) {
    throw new MealDbClientError('INVALID_RESPONSE', 'TheMealDB returned an invalid meals collection.');
  }
  return payload.meals ?? [];
}

function validateCategoriesPayload(payload) {
  assertObjectPayload(payload);
  if (!Array.isArray(payload.categories)) {
    throw new MealDbClientError('INVALID_RESPONSE', 'TheMealDB returned an invalid categories collection.');
  }
  return payload.categories;
}

function makeUrl(path, parameters = {}) {
  const url = new URL(path, MEALDB_BASE_URL);
  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }
  return url;
}

async function requestJson(fetchImpl, timeoutMs, url, externalSignal) {
  if (externalSignal !== undefined && !(externalSignal instanceof AbortSignal)) {
    throw new MealDbClientError('INVALID_ARGUMENT', 'signal must be an AbortSignal.');
  }
  if (externalSignal?.aborted) {
    throw new MealDbClientError('ABORTED', 'The request was cancelled.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(externalSignal.reason);
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
    } catch (error) {
      if (timedOut) throw new MealDbClientError('TIMEOUT', 'TheMealDB request timed out.');
      if (externalSignal?.aborted || controller.signal.aborted) {
        throw new MealDbClientError('ABORTED', 'The request was cancelled.');
      }
      throw new MealDbClientError('NETWORK_ERROR', 'TheMealDB request failed.', { cause: error });
    }

    if (!response || typeof response.ok !== 'boolean' || typeof response.json !== 'function') {
      throw new MealDbClientError('INVALID_RESPONSE', 'The fetch implementation returned an invalid response.');
    }
    if (!response.ok) {
      throw new MealDbClientError('HTTP_ERROR', 'TheMealDB returned an unsuccessful response.', {
        status: Number.isInteger(response.status) ? response.status : undefined,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      if (timedOut) throw new MealDbClientError('TIMEOUT', 'TheMealDB request timed out.');
      if (externalSignal?.aborted || controller.signal.aborted) {
        throw new MealDbClientError('ABORTED', 'The request was cancelled.');
      }
      throw new MealDbClientError('INVALID_JSON', 'TheMealDB returned invalid JSON.', { cause: error });
    }
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

export function createMealDbClient({ fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const fetcher = requireFetch(fetchImpl);
  const boundedTimeout = requireTimeout(timeoutMs);

  const getMeals = async (path, parameters, options = {}) => validateMealsPayload(
    await requestJson(fetcher, boundedTimeout, makeUrl(path, parameters), options.signal),
  );

  return Object.freeze({
    search(query, options = {}) {
      return getMeals('search.php', { s: requireText(query, 'query') }, options);
    },
    lookup(mealId, options = {}) {
      return getMeals('lookup.php', { i: requireMealId(mealId) }, options);
    },
    async categories(options = {}) {
      return validateCategoriesPayload(
        await requestJson(fetcher, boundedTimeout, makeUrl('categories.php'), options.signal),
      );
    },
    filterByCategory(category, options = {}) {
      return getMeals('filter.php', { c: requireText(category, 'category') }, options);
    },
    filterByArea(area, options = {}) {
      return getMeals('filter.php', { a: requireText(area, 'area') }, options);
    },
    listAreas(options = {}) {
      return getMeals('list.php', { a: 'list' }, options);
    },
  });
}

export const MEALDB_CLIENT_LIMITS = Object.freeze({
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  minTimeoutMs: MIN_TIMEOUT_MS,
  maxTimeoutMs: MAX_TIMEOUT_MS,
});
