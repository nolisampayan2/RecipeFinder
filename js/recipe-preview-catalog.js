import { safeImageUrl } from './security.js';

const BUILT_IN_ID = /^[a-z0-9][a-z0-9_-]{0,199}$/;
const DATABASE_ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;
const FICTIONAL_ID = /^external:fictional-offline:(\d+)$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_DATABASE_OFFSET = 10000;
const COMMON_FIELDS = Object.freeze([
  'id', 'name', 'category', 'cuisine', 'image', 'fallbackImage', 'description', 'source', 'detailLevel',
]);
const FAILURE = Object.freeze({ code: 'UNAVAILABLE', message: 'Recipe previews are partially unavailable.' });
const INVALID_INPUT = Object.freeze({ code: 'INVALID_INPUT', message: 'Recipe previews are unavailable.' });
const STALE = Object.freeze({ code: 'STALE', message: 'Recipe preview request was canceled.' });
const EMPTY_DATABASE_PAGE = Object.freeze({
  hasMore: null,
  nextOffset: null,
  offset: null,
  pageSize: null,
  continuationAvailable: null,
  limitReached: null,
});

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && !CONTROL_CHARACTERS.test(normalized) ? normalized : null;
}

function imageValue(value, optional = false) {
  if (optional && value === '') return '';
  if (typeof value !== 'string' || value !== value.trim()) return null;
  const safe = safeImageUrl(value);
  if (!safe || safe !== value) return null;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    } catch {
      return null;
    }
  }
  return safe;
}

function snapshotRecord(record) {
  try {
    if (!isRecord(record)) return null;
    const prototype = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(record);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const values = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function normalizePreview(record, expectedKind) {
  const value = snapshotRecord(record);
  if (!value) return null;

  const kind = value.source === 'built-in'
    ? 'built-in'
    : value.source === 'database'
      ? 'database'
      : value.source === 'external'
        ? 'fictional'
        : null;
  if (kind !== expectedKind) return null;

  const expectedFields = new Set(COMMON_FIELDS);
  if (kind === 'database') expectedFields.add('databaseSourceType');
  if (kind === 'fictional') {
    expectedFields.add('externalProvider');
    expectedFields.add('externalId');
  }
  const keys = Object.keys(value);
  if (
    keys.some((key) => !expectedFields.has(key))
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
    || keys.length < COMMON_FIELDS.length - 1
  ) return null;

  const id = safeText(value.id);
  const name = safeText(value.name);
  const category = safeText(value.category);
  const cuisine = safeText(value.cuisine);
  const description = safeText(value.description);
  const image = imageValue(value.image);
  const fallbackImage = Object.prototype.hasOwnProperty.call(value, 'fallbackImage')
    ? imageValue(value.fallbackImage, true)
    : '';
  if (!id || !name || !category || !cuisine || !description || !image || fallbackImage === null) return null;

  const preview = {
    id, name, category, cuisine, image, fallbackImage, description,
    source: value.source,
    detailLevel: value.detailLevel,
  };

  if (kind === 'built-in') {
    if (!BUILT_IN_ID.test(id) || value.detailLevel !== 'preview') return null;
  } else if (kind === 'database') {
    if (
      !DATABASE_ID.test(id)
      || id.startsWith('external:')
      || !['seed', 'cms'].includes(value.databaseSourceType)
      || value.detailLevel !== 'preview'
    ) return null;
    preview.databaseSourceType = value.databaseSourceType;
  } else {
    const match = FICTIONAL_ID.exec(id);
    if (
      !match
      || value.externalProvider !== 'fictional-offline'
      || value.externalId !== match[1]
      || value.detailLevel !== 'summary'
    ) return null;
    preview.externalProvider = 'fictional-offline';
    preview.externalId = match[1];
  }

  return Object.freeze(preview);
}

function snapshotSourceArray(source) {
  try {
    if (!Array.isArray(source) || Object.getPrototypeOf(source) !== Array.prototype) return [];
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 1000) return [];
    const result = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[index];
      if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) result.push(descriptor.value);
    }
    return result;
  } catch {
    return [];
  }
}

function normalizedOptions(options) {
  try {
    if (options === undefined) options = {};
    if (!isRecord(options)) return null;
    const capturedSearch = options.search;
    const capturedFilter = options.filter;
    const capturedPageSize = options.pageSize;
    const capturedOffset = options.offset;
    const searchValue = capturedSearch === undefined ? '' : capturedSearch;
    const filterValue = capturedFilter === undefined ? '' : capturedFilter;
    const pageSize = capturedPageSize === undefined ? 24 : capturedPageSize;
    const offset = capturedOffset === undefined ? 0 : capturedOffset;
    const search = typeof searchValue === 'string' ? searchValue.trim() : null;
    const filter = typeof filterValue === 'string' ? filterValue.trim() : null;
    if (
      search === null || filter === null
      || search.length > 100 || filter.length > 80
      || CONTROL_CHARACTERS.test(search) || CONTROL_CHARACTERS.test(filter)
      || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000
    ) return null;
    return Object.freeze({ search, filter, pageSize, offset });
  } catch {
    return null;
  }
}

function matches(preview, search, filter) {
  const searchText = [preview.name, preview.description, preview.category, preview.cuisine]
    .join(' ').toLowerCase();
  const category = preview.category.toLowerCase();
  const cuisine = preview.cuisine.toLowerCase();
  return (!search || searchText.includes(search.toLowerCase()))
    && (!filter || category === filter.toLowerCase() || cuisine === filter.toLowerCase());
}

function staticPreviews(records, kind, ids, search, filter) {
  const output = [];
  for (const record of snapshotSourceArray(records)) {
    const preview = normalizePreview(record, kind);
    if (!preview || !matches(preview, search, filter) || ids.has(preview.id)) continue;
    ids.add(preview.id);
    output.push(preview);
  }
  return output;
}

function safeRpcPage(response, request) {
  try {
    if (!isRecord(response)) return null;
    const responseDescriptors = Object.getOwnPropertyDescriptors(response);
    const data = responseDescriptors.data?.value;
    const error = responseDescriptors.error?.value;
    const stale = responseDescriptors.stale?.value;
    if (stale === true) return { stale: true };
    if (error !== null || !isRecord(data)) return null;

    const dataDescriptors = Object.getOwnPropertyDescriptors(data);
    const recipes = dataDescriptors.recipes?.value;
    const hasMore = dataDescriptors.hasMore?.value;
    const nextOffset = dataDescriptors.nextOffset?.value;
    if (!Array.isArray(recipes) || Object.getPrototypeOf(recipes) !== Array.prototype) return null;
    const recipeDescriptors = Object.getOwnPropertyDescriptors(recipes);
    const length = recipeDescriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > request.pageSize) return null;
    if (hasMore === true) {
      if (length !== request.pageSize || nextOffset !== request.offset + length) return null;
    } else if (hasMore !== false || nextOffset !== null) return null;
    const values = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = recipeDescriptors[index];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
      values.push(descriptor.value);
    }
    return { recipes: values, hasMore, nextOffset };
  } catch {
    return null;
  }
}

function result(data, error = null, stale = false) {
  return Object.freeze({ data, error, stale });
}

function pageData(recipes, databasePage) {
  return Object.freeze({
    recipes: Object.freeze(recipes),
    // Pagination intentionally describes only the Supabase stream. Static
    // previews are returned in full on every call and are never assigned a
    // fabricated RPC offset or continuation page.
    databasePage: Object.freeze(databasePage),
  });
}

/**
 * Creates an inactive composition layer for safe public previews. `offset`
 * and `pageSize` apply to the injected Supabase preview source only; local
 * built-in and fictional previews are injected, filtered, and returned in source order
 * on each call. No full-detail catalog or fallback is imported.
 */
export function createRecipePreviewCatalog(options = {}) {
  let builtInSource;
  let fictionalSource;
  let previewSource;
  let listPublished;
  try {
    if (!isRecord(options)) throw new TypeError();
    builtInSource = options.builtInPreviews;
    fictionalSource = options.fictionalPreviews;
    if (!Array.isArray(builtInSource) || !Array.isArray(fictionalSource)) throw new TypeError();
    previewSource = options.previewSource;
    listPublished = previewSource?.listPublished;
    if (typeof listPublished !== 'function') throw new TypeError();
  } catch {
    throw new TypeError('Recipe preview catalog dependencies are invalid.');
  }

  async function list(options = {}) {
    const request = normalizedOptions(options);
    if (!request) return result(null, INVALID_INPUT);

    const ids = new Set();
    const local = [
      ...staticPreviews(builtInSource, 'built-in', ids, request.search, request.filter),
      ...staticPreviews(fictionalSource, 'fictional', ids, request.search, request.filter),
    ];

    const callOptions = Object.freeze({
      search: request.search,
      filter: request.filter,
      pageSize: request.pageSize,
      offset: request.offset,
    });
    let rpcResult;
    try {
      rpcResult = await listPublished.call(previewSource, callOptions);
    } catch {
      return result(pageData(local, { ...EMPTY_DATABASE_PAGE }), FAILURE);
    }

    const rpcPage = safeRpcPage(rpcResult, request);
    if (!rpcPage) return result(pageData(local, { ...EMPTY_DATABASE_PAGE }), FAILURE);
    if (rpcPage.stale) {
      return result(pageData(local, { ...EMPTY_DATABASE_PAGE }), STALE, true);
    }

    const database = [];
    for (const record of rpcPage.recipes) {
      const preview = normalizePreview(record, 'database');
      if (!preview || !matches(preview, request.search, request.filter) || ids.has(preview.id)) continue;
      ids.add(preview.id);
      database.push(preview);
    }

    return result(pageData([...local, ...database], {
      hasMore: rpcPage.hasMore,
      nextOffset: rpcPage.hasMore && rpcPage.nextOffset > MAX_DATABASE_OFFSET
        ? null
        : rpcPage.nextOffset,
      offset: request.offset,
      pageSize: request.pageSize,
      continuationAvailable: rpcPage.hasMore
        ? rpcPage.nextOffset <= MAX_DATABASE_OFFSET
        : false,
      limitReached: rpcPage.hasMore && rpcPage.nextOffset > MAX_DATABASE_OFFSET,
    }), rpcPage.hasMore && rpcPage.nextOffset > MAX_DATABASE_OFFSET ? FAILURE : null);
  }

  return Object.freeze({ list });
}
