import { safeImageUrl } from './security.js';

export const PUBLISHED_RECIPE_PREVIEW_RPC = 'list_published_recipe_previews_v1';

const APPROVED_ROW_FIELDS = Object.freeze([
  'id',
  'name',
  'description',
  'category',
  'cuisine',
  'image_url',
  'fallback_image_url',
  'source_type',
  'external_provider',
  'external_id',
]);
const APPROVED_ROW_FIELD_SET = new Set(APPROVED_ROW_FIELDS);
const DATABASE_RECIPE_ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;
const FICTIONAL_RECIPE_ID = /^external:fictional-offline:(\d+)$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const ABSOLUTE_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const DATABASE_LOCAL_IMAGE = /^(?:\.\/|\/(?:[a-zA-Z\d_-]+\/)*)?assets\/[a-zA-Z\d][a-zA-Z\d._~%-]*(?:\/[a-zA-Z\d][a-zA-Z\d._~%-]*)*$/;

const ERROR = Object.freeze({
  INVALID_INPUT: Object.freeze({
    code: 'INVALID_INPUT',
    message: 'Recipe previews are unavailable.',
  }),
  UNAVAILABLE: Object.freeze({
    code: 'UNAVAILABLE',
    message: 'Recipe previews are unavailable.',
  }),
  STALE: Object.freeze({
    code: 'STALE',
    message: 'Recipe preview request was canceled.',
  }),
});

function failure(error, stale = false) {
  return Object.freeze({ data: null, error, stale });
}

const INVALID_INPUT_RESULT = failure(ERROR.INVALID_INPUT);
const UNAVAILABLE_RESULT = failure(ERROR.UNAVAILABLE);
const STALE_RESULT = failure(ERROR.STALE, true);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireClient(client) {
  let rpc;
  try {
    rpc = client?.rpc;
  } catch {
    throw new TypeError('A compatible Supabase recipe preview client is required.');
  }
  if (typeof rpc !== 'function') {
    throw new TypeError('A compatible Supabase recipe preview client is required.');
  }
  return rpc;
}

function normalizedSearchValue(value, maximumLength) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized.length > maximumLength || CONTROL_CHARACTERS.test(normalized)) return null;
  return normalized;
}

function normalizedRequest(options) {
  try {
    if (options === undefined) options = {};
    if (!isRecord(options)) return null;

    const capturedSearch = options.search;
    const capturedFilter = options.filter;
    const capturedPageSize = options.pageSize;
    const capturedOffset = options.offset;
    const rawSearch = capturedSearch === undefined ? '' : capturedSearch;
    const rawFilter = capturedFilter === undefined ? '' : capturedFilter;
    const pageSize = capturedPageSize === undefined ? 24 : capturedPageSize;
    const offset = capturedOffset === undefined ? 0 : capturedOffset;
    const search = normalizedSearchValue(rawSearch, 100);
    const filter = normalizedSearchValue(rawFilter, 80);

    if (
      search === null
      || filter === null
      || !Number.isSafeInteger(pageSize)
      || pageSize < 1
      || pageSize > 50
      || !Number.isSafeInteger(offset)
      || offset < 0
      || offset > 10000
    ) return null;

    return Object.freeze({ search, filter, pageSize, offset });
  } catch {
    return null;
  }
}

function ownDataSnapshot(value, approvedFields) {
  if (!isRecord(value)) throw new TypeError('Preview row is malformed.');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Preview row is malformed.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== approvedFields.length
    || keys.some((key) => typeof key !== 'string' || !APPROVED_ROW_FIELD_SET.has(key))
  ) {
    throw new TypeError('Preview row fields are malformed.');
  }

  const snapshot = Object.create(null);
  for (const field of approvedFields) {
    const descriptor = descriptors[field];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError('Preview row fields are malformed.');
    }
    snapshot[field] = descriptor.value;
  }
  return snapshot;
}

function denseArrayValues(value, maximumLength) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError('Preview response must be an ordinary array.');
  }
  const initialLengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!initialLengthDescriptor || !Object.prototype.hasOwnProperty.call(initialLengthDescriptor, 'value')) {
    throw new TypeError('Preview response is malformed.');
  }
  const initialLength = initialLengthDescriptor.value;
  if (!Number.isSafeInteger(initialLength) || initialLength < 0 || initialLength > maximumLength) {
    throw new TypeError('Preview provider returned too many rows.');
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) {
    throw new TypeError('Preview response is malformed.');
  }
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0 || length !== initialLength) {
    throw new TypeError('Preview response is malformed.');
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== length + 1 || keys.some((key) => {
    if (key === 'length') return false;
    return typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length;
  })) {
    throw new TypeError('Preview response must be dense without custom properties.');
  }

  const values = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError('Preview response must be dense.');
    }
    values[index] = descriptor.value;
  }
  return values;
}

function requiredText(value, field) {
  if (typeof value !== 'string') throw new TypeError(`${field} must be text.`);
  const normalized = value.trim();
  if (!normalized || CONTROL_CHARACTERS.test(normalized)) {
    throw new TypeError(`${field} must be safe text.`);
  }
  return normalized;
}

function requiredImage(value, field) {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new TypeError(`${field} must be text.`);
  }
  const safe = safeImageUrl(value);
  if (!safe) throw new TypeError(`${field} is unsafe.`);
  if (ABSOLUTE_SCHEME.test(value)) {
    const parsed = new URL(safe);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new TypeError(`${field} is unsafe.`);
    }
  } else if (!DATABASE_LOCAL_IMAGE.test(value)) {
    throw new TypeError(`${field} is unsafe.`);
  }
  return safe;
}

function optionalImage(value) {
  return value === null ? '' : requiredImage(value, 'fallback_image_url');
}

function normalizedRow(row) {
  const snapshot = ownDataSnapshot(row, APPROVED_ROW_FIELDS);
  const id = requiredText(snapshot.id, 'id');
  if (!DATABASE_RECIPE_ID.test(id)) throw new TypeError('Recipe ID is invalid.');

  const common = {
    id,
    name: requiredText(snapshot.name, 'name'),
    category: requiredText(snapshot.category, 'category'),
    cuisine: requiredText(snapshot.cuisine, 'cuisine'),
    image: requiredImage(snapshot.image_url, 'image_url'),
    fallbackImage: optionalImage(snapshot.fallback_image_url),
    description: requiredText(snapshot.description, 'description'),
  };

  if (snapshot.source_type === 'seed' || snapshot.source_type === 'cms') {
    if (
      id.startsWith('external:')
      || snapshot.external_provider !== null
      || snapshot.external_id !== null
    ) throw new TypeError('Recipe provenance is inconsistent.');
    return Object.freeze({
      ...common,
      source: 'database',
      databaseSourceType: snapshot.source_type,
      detailLevel: 'preview',
    });
  }

  if (snapshot.source_type === 'external') {
    const match = FICTIONAL_RECIPE_ID.exec(id);
    if (
      !match
      || snapshot.external_provider !== 'fictional-offline'
      || snapshot.external_id !== match[1]
    ) throw new TypeError('External recipe provenance is inconsistent.');
    return Object.freeze({
      ...common,
      source: 'external',
      externalProvider: 'fictional-offline',
      externalId: match[1],
      detailLevel: 'summary',
    });
  }

  throw new TypeError('Recipe source is unsupported.');
}

function explicitResponse(response) {
  if (!isRecord(response)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(response);
  const errorDescriptor = descriptors.error;
  const dataDescriptor = descriptors.data;
  if (
    !errorDescriptor
    || !dataDescriptor
    || !Object.prototype.hasOwnProperty.call(errorDescriptor, 'value')
    || !Object.prototype.hasOwnProperty.call(dataDescriptor, 'value')
    || errorDescriptor.value !== null
  ) return null;
  return dataDescriptor.value;
}

function normalizedPage(response, request) {
  const rawData = explicitResponse(response);
  if (rawData === null) throw new TypeError('Preview provider response is malformed.');
  const rows = denseArrayValues(rawData, request.pageSize + 1);

  const seen = new Set();
  const normalized = new Array(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    const recipe = normalizedRow(rows[index]);
    if (seen.has(recipe.id)) throw new TypeError('Duplicate recipe ID.');
    seen.add(recipe.id);
    normalized[index] = recipe;
  }

  const hasMore = normalized.length > request.pageSize;
  const recipes = Object.freeze(normalized.slice(0, request.pageSize));
  return Object.freeze({
    recipes,
    hasMore,
    nextOffset: hasMore ? request.offset + recipes.length : null,
  });
}

/**
 * Creates an inactive RPC-only source for public RecipeFinder preview records.
 * The future database function owns literal SQL wildcard escaping. This client
 * never falls back to direct recipe-table access and never caches completed pages.
 */
export function createPublishedRecipePreviewService(client) {
  const rpc = requireClient(client);
  let generation = 0;
  let pending = null;
  let retired = false;

  function listPublished(options) {
    if (retired) return Promise.resolve(STALE_RESULT);
    const request = normalizedRequest(options);
    if (!request) return Promise.resolve(INVALID_INPUT_RESULT);

    const requestKey = JSON.stringify(request);
    if (pending?.key === requestKey) return pending.promise;

    const requestGeneration = ++generation;
    const args = Object.freeze({
      p_search: request.search || null,
      p_filter: request.filter || null,
      p_limit: request.pageSize + 1,
      p_offset: request.offset,
    });
    const operation = Promise.resolve().then(async () => {
      if (retired || requestGeneration !== generation) return STALE_RESULT;
      try {
        const response = await rpc.call(client, PUBLISHED_RECIPE_PREVIEW_RPC, args);
        if (retired || requestGeneration !== generation) return STALE_RESULT;
        const page = normalizedPage(response, request);
        return Object.freeze({ data: page, error: null, stale: false });
      } catch {
        return retired || requestGeneration !== generation ? STALE_RESULT : UNAVAILABLE_RESULT;
      }
    });

    const ownedPending = Object.freeze({ key: requestKey, generation: requestGeneration, promise: operation });
    pending = ownedPending;
    void operation.finally(() => {
      if (pending === ownedPending) pending = null;
    });
    return operation;
  }

  return Object.freeze({
    listPublished,

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
