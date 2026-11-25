import {
  RECIPE_DETAIL_ACCESS,
  classifyRecipeDetailAccess,
} from './recipe-login-gate.js';
import { isValidAccountUserId } from './supabase-favorites.js';

export const RECIPE_DETAIL_RESULT = Object.freeze({
  PUBLIC_EXTERNAL_DETAIL: 'PUBLIC_EXTERNAL_DETAIL',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  PENDING_AUTH: 'PENDING_AUTH',
  PROTECTED_DETAIL: 'PROTECTED_DETAIL',
  DENIED: 'DENIED',
  UNAVAILABLE: 'UNAVAILABLE',
  STALE: 'STALE',
});

const ERROR = Object.freeze({
  PENDING_AUTH: Object.freeze({
    code: 'AUTH_PENDING',
    message: 'Account status is still being checked.',
  }),
  DENIED: Object.freeze({
    code: 'ACCESS_DENIED',
    message: 'Recipe details are unavailable.',
  }),
  UNAVAILABLE: Object.freeze({
    code: 'DETAIL_UNAVAILABLE',
    message: 'Recipe details are unavailable.',
  }),
  STALE: Object.freeze({
    code: 'STALE_REQUEST',
    message: 'Recipe request was canceled.',
  }),
});

const KNOWN_AUTH_STATUSES = new Set([
  'loading',
  'guest',
  'pending-confirmation',
  'authenticated',
  'error',
]);
const COMMON_DETAIL_FIELDS = Object.freeze([
  'id',
  'source',
  'name',
  'category',
  'cuisine',
  'image',
  'fallbackImage',
  'description',
  'ingredients',
  'instructions',
  'tutorial',
]);
const REQUIRED_COMMON_DETAIL_FIELDS = Object.freeze(
  COMMON_DETAIL_FIELDS.filter((field) => field !== 'fallbackImage')
);
const PUBLIC_DETAIL_FIELDS = Object.freeze([
  ...COMMON_DETAIL_FIELDS,
  'externalProvider',
  'externalId',
  'detailLevel',
]);
const PROTECTED_DETAIL_FIELDS = Object.freeze([
  ...COMMON_DETAIL_FIELDS,
  'databaseSourceType',
  'externalProvider',
  'externalId',
]);

function result(status, data = null, error = null, stale = false) {
  return Object.freeze({ status, data, error, stale });
}

const LOGIN_REQUIRED_RESULT = result(RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);
const PENDING_AUTH_RESULT = result(RECIPE_DETAIL_RESULT.PENDING_AUTH, null, ERROR.PENDING_AUTH);
const DENIED_RESULT = result(RECIPE_DETAIL_RESULT.DENIED, null, ERROR.DENIED);
const UNAVAILABLE_RESULT = result(RECIPE_DETAIL_RESULT.UNAVAILABLE, null, ERROR.UNAVAILABLE);
const STALE_RESULT = result(RECIPE_DETAIL_RESULT.STALE, null, ERROR.STALE, true);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireDependencies(options) {
  try {
    if (!isRecord(options)) throw new TypeError();
    const loginGate = options.loginGate;
    const detailService = options.detailService;
    const clearProtectedDetail = options.clearProtectedDetail;
    if (
      !isRecord(loginGate)
      || typeof loginGate.open !== 'function'
      || typeof loginGate.close !== 'function'
      || typeof loginGate.cleanup !== 'function'
      || !isRecord(detailService)
      || typeof detailService.getPublishedById !== 'function'
      || typeof detailService.invalidate !== 'function'
      || typeof detailService.cleanup !== 'function'
      || typeof clearProtectedDetail !== 'function'
    ) throw new TypeError();
    return { loginGate, detailService, clearProtectedDetail };
  } catch {
    throw new TypeError('Recipe detail access controller dependencies are invalid.');
  }
}

function authSnapshot(authState) {
  try {
    if (!isRecord(authState)) return Object.freeze({ status: 'error', userId: null });
    const capturedStatus = authState.status;
    const capturedUserId = authState.userId;
    if (!KNOWN_AUTH_STATUSES.has(capturedStatus)) {
      return Object.freeze({ status: 'error', userId: null });
    }
    if (capturedStatus === 'authenticated') {
      if (!isValidAccountUserId(capturedUserId)) {
        return Object.freeze({ status: 'error', userId: null });
      }
      return Object.freeze({ status: capturedStatus, userId: capturedUserId.toLowerCase() });
    }
    return Object.freeze({ status: capturedStatus, userId: null });
  } catch {
    return Object.freeze({ status: 'error', userId: null });
  }
}

function sameAuth(left, right) {
  return left.status === right.status && left.userId === right.userId;
}

function recipeSnapshot(recipe) {
  try {
    if (!isRecord(recipe)) return null;
    return Object.freeze({
      id: recipe.id,
      source: recipe.source,
      detailLevel: recipe.detailLevel,
      externalProvider: recipe.externalProvider,
      externalId: recipe.externalId,
      databaseSourceType: recipe.databaseSourceType,
      name: recipe.name,
    });
  } catch {
    return null;
  }
}

function ownDataValues(value, allowedFields, requiredFields, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be a record.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must use a plain object prototype.`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${label} must not contain symbol properties.`);
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const allowed = new Set(allowedFields);
  const names = Object.keys(descriptors);
  if (names.some((name) => !allowed.has(name))) {
    throw new TypeError(`${label} contains an unsupported field.`);
  }
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(descriptors, field)) {
      throw new TypeError(`${label} is incomplete.`);
    }
  }

  const values = Object.create(null);
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`${label} must not contain accessors.`);
    }
    values[name] = descriptor.value;
  }
  return values;
}

function immutableIngredients(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('Recipe ingredients must be an array.');
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError('Recipe ingredients must not contain symbol properties.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) {
    throw new TypeError('Recipe ingredients are malformed.');
  }
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 200) {
    throw new TypeError('Recipe ingredients exceed the supported bound.');
  }
  const allowedNames = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
  if (Object.keys(descriptors).some((name) => !allowedNames.has(name))) {
    throw new TypeError('Recipe ingredients contain unsupported properties.');
  }

  const ingredients = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const ingredientDescriptor = descriptors[index];
    if (!ingredientDescriptor || !Object.prototype.hasOwnProperty.call(ingredientDescriptor, 'value')) {
      throw new TypeError('Recipe ingredients must be dense data arrays.');
    }
    const pair = ingredientDescriptor.value;
    if (!Array.isArray(pair) || Object.getPrototypeOf(pair) !== Array.prototype) {
      throw new TypeError('Recipe ingredient entries must be arrays.');
    }
    if (Object.getOwnPropertySymbols(pair).length !== 0) {
      throw new TypeError('Recipe ingredient entries must not contain symbol properties.');
    }
    const pairDescriptors = Object.getOwnPropertyDescriptors(pair);
    if (
      pairDescriptors.length?.value !== 2
      || Object.keys(pairDescriptors).some((name) => !['0', '1', 'length'].includes(name))
      || !Object.prototype.hasOwnProperty.call(pairDescriptors[0] ?? {}, 'value')
      || !Object.prototype.hasOwnProperty.call(pairDescriptors[1] ?? {}, 'value')
      || typeof pairDescriptors[0].value !== 'string'
      || typeof pairDescriptors[1].value !== 'string'
    ) throw new TypeError('Recipe ingredient entries are malformed.');
    ingredients[index] = Object.freeze([pairDescriptors[0].value, pairDescriptors[1].value]);
  }
  return Object.freeze(ingredients);
}

function commonDetailSnapshot(values) {
  for (const field of [
    'id', 'source', 'name', 'category', 'cuisine', 'image', 'description', 'instructions', 'tutorial',
  ]) {
    if (typeof values[field] !== 'string') throw new TypeError(`Recipe ${field} must be text.`);
  }
  if (Object.prototype.hasOwnProperty.call(values, 'fallbackImage') && typeof values.fallbackImage !== 'string') {
    throw new TypeError('Recipe fallbackImage must be text.');
  }

  const snapshot = {
    id: values.id,
    source: values.source,
    name: values.name,
    category: values.category,
    cuisine: values.cuisine,
    image: values.image,
  };
  if (Object.prototype.hasOwnProperty.call(values, 'fallbackImage')) {
    snapshot.fallbackImage = values.fallbackImage;
  }
  snapshot.description = values.description;
  snapshot.ingredients = immutableIngredients(values.ingredients);
  snapshot.instructions = values.instructions;
  snapshot.tutorial = values.tutorial;
  return snapshot;
}

function publicDetailSnapshot(value) {
  try {
    const values = ownDataValues(
      value,
      PUBLIC_DETAIL_FIELDS,
      [...REQUIRED_COMMON_DETAIL_FIELDS, 'externalProvider', 'externalId', 'detailLevel'],
      'Public recipe detail'
    );
    const snapshot = {
      ...commonDetailSnapshot(values),
      externalProvider: values.externalProvider,
      externalId: values.externalId,
      detailLevel: values.detailLevel,
    };
    if (
      typeof snapshot.externalProvider !== 'string'
      || typeof snapshot.externalId !== 'string'
      || typeof snapshot.detailLevel !== 'string'
      || classifyRecipeDetailAccess(snapshot, { status: 'guest' }) !== RECIPE_DETAIL_ACCESS.PUBLIC_EXTERNAL_DETAIL
    ) return null;
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function protectedDetailSnapshot(value, requestedRecipe) {
  try {
    const values = ownDataValues(
      value,
      PROTECTED_DETAIL_FIELDS,
      [...REQUIRED_COMMON_DETAIL_FIELDS, 'databaseSourceType'],
      'Protected recipe detail'
    );
    const snapshot = {
      ...commonDetailSnapshot(values),
      databaseSourceType: values.databaseSourceType,
    };
    if (typeof snapshot.databaseSourceType !== 'string' || snapshot.source !== 'database') return null;
    if (Object.prototype.hasOwnProperty.call(values, 'externalProvider')) {
      if (typeof values.externalProvider !== 'string') return null;
      snapshot.externalProvider = values.externalProvider;
    }
    if (Object.prototype.hasOwnProperty.call(values, 'externalId')) {
      if (typeof values.externalId !== 'string') return null;
      snapshot.externalId = values.externalId;
    }
    if (snapshot.id !== requestedRecipe.id) return null;

    if (requestedRecipe.source === 'external') {
      if (
        requestedRecipe.externalProvider !== 'fictional-offline'
        || snapshot.databaseSourceType !== 'external'
        || snapshot.externalProvider !== 'fictional-offline'
        || snapshot.externalId !== requestedRecipe.externalId
      ) return null;
    } else {
      if (!['seed', 'cms'].includes(snapshot.databaseSourceType)) return null;
      if (
        Object.prototype.hasOwnProperty.call(snapshot, 'externalProvider')
        || Object.prototype.hasOwnProperty.call(snapshot, 'externalId')
      ) return null;
      if (requestedRecipe.source === 'built-in' && snapshot.databaseSourceType !== 'seed') return null;
      if (
        requestedRecipe.source === 'database'
        && ['seed', 'cms'].includes(requestedRecipe.databaseSourceType)
        && snapshot.databaseSourceType !== requestedRecipe.databaseSourceType
      ) return null;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function explicitServiceResult(value) {
  try {
    if (!isRecord(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const field of ['data', 'error', 'stale']) {
      const descriptor = descriptors[field];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
    }
    return Object.freeze({
      data: descriptors.data.value,
      error: descriptors.error.value,
      stale: descriptors.stale.value,
    });
  } catch {
    return null;
  }
}

function returnedIdentity(recipe) {
  try {
    if (!isRecord(recipe)) return null;
    const id = recipe.id;
    const source = recipe.source;
    return typeof id === 'string' && source === 'database' ? Object.freeze({ id, source }) : null;
  } catch {
    return null;
  }
}

/**
 * Inactive orchestration boundary for recipe-detail access. This controller is
 * presentation-only security: Supabase authentication, RLS, and grants remain
 * authoritative for protected database values.
 */
export function createRecipeDetailAccessController(options) {
  const { loginGate, detailService, clearProtectedDetail } = requireDependencies(options);
  let currentAuth = Object.freeze({ status: 'loading', userId: null });
  let generation = 0;
  let pending = null;
  let retired = false;

  function safeClear() {
    try { clearProtectedDetail(); } catch { /* UI cleanup failures remain private. */ }
  }

  function safeGateClose() {
    try { loginGate.close({ restoreFocus: false }); } catch { /* Gate cleanup remains private. */ }
  }

  function safeDetailInvalidate() {
    try { detailService.invalidate(); } catch { /* Provider invalidation remains private. */ }
  }

  function retirePending({ closeGate = true } = {}) {
    generation += 1;
    pending = null;
    safeDetailInvalidate();
    if (closeGate) safeGateClose();
    safeClear();
  }

  function handleAuthState(authState) {
    if (retired) return false;
    const nextAuth = authSnapshot(authState);
    if (sameAuth(currentAuth, nextAuth)) return true;
    currentAuth = nextAuth;
    retirePending();
    return !retired;
  }

  function requestDetail(requestOptions) {
    if (retired) return Promise.resolve(STALE_RESULT);

    let originalRecipe;
    let trigger;
    try {
      if (!isRecord(requestOptions)) return Promise.resolve(DENIED_RESULT);
      originalRecipe = requestOptions.recipe;
      trigger = requestOptions.trigger;
    } catch {
      return Promise.resolve(DENIED_RESULT);
    }

    const recipe = recipeSnapshot(originalRecipe);
    if (!recipe) return Promise.resolve(DENIED_RESULT);
    const decision = classifyRecipeDetailAccess(recipe, currentAuth);

    if (decision === RECIPE_DETAIL_ACCESS.PUBLIC_EXTERNAL_DETAIL) {
      const immutableDetail = publicDetailSnapshot(originalRecipe);
      safeClear();
      if (retired) return Promise.resolve(STALE_RESULT);
      return Promise.resolve(immutableDetail
        ? result(RECIPE_DETAIL_RESULT.PUBLIC_EXTERNAL_DETAIL, immutableDetail)
        : UNAVAILABLE_RESULT);
    }
    if (decision === RECIPE_DETAIL_ACCESS.REQUIRES_LOGIN) {
      safeClear();
      if (retired) return Promise.resolve(STALE_RESULT);
      try {
        const opened = loginGate.open({ recipe, trigger });
        if (retired) return Promise.resolve(STALE_RESULT);
        return Promise.resolve(opened === true ? LOGIN_REQUIRED_RESULT : UNAVAILABLE_RESULT);
      } catch {
        return Promise.resolve(retired ? STALE_RESULT : UNAVAILABLE_RESULT);
      }
    }
    if (decision === RECIPE_DETAIL_ACCESS.PENDING_AUTH) {
      safeClear();
      if (retired) return Promise.resolve(STALE_RESULT);
      return Promise.resolve(PENDING_AUTH_RESULT);
    }
    if (decision !== RECIPE_DETAIL_ACCESS.AUTHENTICATED_RECIPEFINDER_DETAIL) {
      safeClear();
      return Promise.resolve(retired ? STALE_RESULT : DENIED_RESULT);
    }

    const requestAuth = currentAuth;
    const requestKey = `${requestAuth.userId}\u0000${recipe.id}`;
    if (pending?.key === requestKey) return pending.promise;

    const replacingPending = pending !== null;
    const requestGeneration = ++generation;
    let settle;
    const operation = new Promise((resolve) => { settle = resolve; });
    const ownedPending = Object.freeze({ key: requestKey, generation: requestGeneration, promise: operation });
    pending = ownedPending;

    const isCurrent = () => Boolean(
      !retired
      && pending === ownedPending
      && requestGeneration === generation
      && sameAuth(currentAuth, requestAuth)
      && currentAuth.status === 'authenticated'
    );

    const run = async () => {
      if (replacingPending) safeDetailInvalidate();
      safeClear();
      if (!isCurrent()) return STALE_RESULT;

      try {
        const rawResult = await detailService.getPublishedById(recipe.id, requestAuth);
        if (!isCurrent()) return STALE_RESULT;
        const serviceResult = explicitServiceResult(rawResult);
        if (!serviceResult) return UNAVAILABLE_RESULT;
        if (serviceResult.stale === true) return STALE_RESULT;
        if (serviceResult.stale !== false || serviceResult.error !== null) return UNAVAILABLE_RESULT;
        const identity = returnedIdentity(serviceResult.data);
        if (!identity || identity.id !== recipe.id) return UNAVAILABLE_RESULT;
        const immutableDetail = protectedDetailSnapshot(serviceResult.data, recipe);
        if (!isCurrent()) return STALE_RESULT;
        if (!immutableDetail) return UNAVAILABLE_RESULT;
        return result(RECIPE_DETAIL_RESULT.PROTECTED_DETAIL, immutableDetail);
      } catch {
        return isCurrent() ? UNAVAILABLE_RESULT : STALE_RESULT;
      }
    };

    void run().then((value) => {
      if (pending === ownedPending) pending = null;
      settle(value);
    }, () => {
      const value = isCurrent() ? UNAVAILABLE_RESULT : STALE_RESULT;
      if (pending === ownedPending) pending = null;
      settle(value);
    });
    return operation;
  }

  function invalidate() {
    if (retired) return false;
    retirePending();
    return !retired;
  }

  function cleanup() {
    if (retired) return false;
    retired = true;
    generation += 1;
    pending = null;
    safeDetailInvalidate();
    safeGateClose();
    try { detailService.cleanup(); } catch { /* Terminal provider cleanup stays private. */ }
    try { loginGate.cleanup(); } catch { /* Terminal gate cleanup stays private. */ }
    safeClear();
    return true;
  }

  return Object.freeze({ handleAuthState, requestDetail, invalidate, cleanup });
}
