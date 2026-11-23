import { classifyRecipeDetailAccess, RECIPE_DETAIL_ACCESS } from './recipe-login-gate.js';
import { safeImageUrl } from './security.js';

const TEXT_CONTROLS = /[\u0000-\u001f\u007f]/;
const COMMON_FIELDS = Object.freeze([
  'id', 'name', 'category', 'cuisine', 'image', 'fallbackImage',
  'description', 'source', 'detailLevel',
]);
const PAGE_FIELDS = Object.freeze([
  'hasMore', 'nextOffset', 'offset', 'pageSize', 'continuationAvailable', 'limitReached',
]);
const UNAVAILABLE = Object.freeze({ code: 'UNAVAILABLE', message: 'Recipe previews are unavailable.' });
const PARTIAL = Object.freeze({ code: 'PARTIAL', message: 'Some recipe previews are unavailable.' });
const STALE = Object.freeze({ code: 'STALE', message: 'Recipe preview request was canceled.' });

function ownData(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const output = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value')) return null;
      output[key] = descriptors[key].value;
    }
    return output;
  } catch {
    return null;
  }
}

function arrayValues(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 1100) return null;
    const values = [];
    for (let index = 0; index < length; index += 1) {
      const item = descriptors[index];
      if (!item || !Object.hasOwn(item, 'value')) return null;
      values.push(item.value);
    }
    return values;
  } catch {
    return null;
  }
}

function text(value) {
  return typeof value === 'string' && value === value.trim()
    && value.length > 0 && !TEXT_CONTROLS.test(value) ? value : null;
}

function image(value, optional = false) {
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
  return value;
}

function previewSnapshot(raw) {
  const value = ownData(raw);
  if (!value) return null;
  const source = value.source;
  const allowed = new Set(COMMON_FIELDS);
  if (source === 'database') allowed.add('databaseSourceType');
  else if (source === 'external') {
    allowed.add('externalProvider');
    allowed.add('externalId');
  }
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const required = COMMON_FIELDS.filter((field) => field !== 'fallbackImage');
  if (required.some((field) => !Object.hasOwn(value, field))) return null;
  const fallbackImage = Object.hasOwn(value, 'fallbackImage') ? image(value.fallbackImage, true) : '';
  if (fallbackImage === null) return null;
  for (const field of ['id', 'name', 'category', 'cuisine', 'description']) {
    if (!text(value[field])) return null;
  }
  if (!image(value.image)) return null;
  if (source === 'database' && !['seed', 'cms'].includes(value.databaseSourceType)) return null;
  const candidate = {
    id: value.id,
    name: value.name,
    category: value.category,
    cuisine: value.cuisine,
    image: value.image,
    fallbackImage,
    description: value.description,
    source,
    detailLevel: value.detailLevel,
  };
  if (source === 'database') candidate.databaseSourceType = value.databaseSourceType;
  if (source === 'external') {
    candidate.externalProvider = value.externalProvider;
    candidate.externalId = value.externalId;
  }
  if (classifyRecipeDetailAccess(candidate, { status: 'guest' }) !== RECIPE_DETAIL_ACCESS.REQUIRES_LOGIN) {
    return null;
  }
  return Object.freeze(candidate);
}

function pageSnapshot(raw) {
  const page = ownData(raw);
  if (!page || Object.keys(page).length !== PAGE_FIELDS.length
    || PAGE_FIELDS.some((field) => !Object.hasOwn(page, field))) return null;
  const { hasMore, nextOffset, offset, pageSize, continuationAvailable, limitReached } = page;
  const unknown = PAGE_FIELDS.every((field) => page[field] === null);
  if (unknown) return Object.freeze({ ...page });
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) return null;
  const complete = hasMore === false && nextOffset === null
    && continuationAvailable === false && limitReached === false;
  const continuing = hasMore === true && continuationAvailable === true
    && limitReached === false && nextOffset === offset + pageSize && nextOffset <= 10000;
  const ceiling = hasMore === true && nextOffset === null
    && continuationAvailable === false && limitReached === true && offset + pageSize > 10000;
  if (!complete && !continuing && !ceiling) return null;
  return Object.freeze({ hasMore, nextOffset, offset, pageSize, continuationAvailable, limitReached });
}

function catalogFor(previews) {
  const ordered = Object.freeze(previews);
  const byId = new Map(ordered.map((recipe) => [recipe.id, recipe]));
  return Object.freeze({
    list() { return ordered; },
    getById(id) { return typeof id === 'string' ? byId.get(id) ?? null : null; },
    // This filters only the currently loaded preview page, not unseen RPC pages.
    filter(query = '', filter = '') {
      if (typeof query !== 'string' || typeof filter !== 'string') return Object.freeze([]);
      const search = query.trim();
      const categoryOrCuisine = filter.trim();
      if (search.length > 100 || categoryOrCuisine.length > 80
        || TEXT_CONTROLS.test(search) || TEXT_CONTROLS.test(categoryOrCuisine)) return Object.freeze([]);
      const lowerSearch = search.toLowerCase();
      const lowerFilter = categoryOrCuisine.toLowerCase();
      return Object.freeze(ordered.filter((recipe) => {
        const found = [recipe.name, recipe.description, recipe.category, recipe.cuisine]
          .join(' ').toLowerCase().includes(lowerSearch);
        const selected = !lowerFilter || recipe.category.toLowerCase() === lowerFilter
          || recipe.cuisine.toLowerCase() === lowerFilter;
        return found && selected;
      }));
    },
    resolveFavoriteIds(ids) {
      let requested;
      try {
        if (ids == null || typeof ids[Symbol.iterator] !== 'function') throw new TypeError();
        requested = [];
        for (const id of ids) {
          if (typeof id !== 'string' || requested.length >= 1000) throw new TypeError();
          requested.push(id);
        }
      } catch {
        throw new TypeError('Favorite IDs are invalid.');
      }
      const wanted = new Set(requested);
      const resolved = ordered.filter((recipe) => wanted.has(recipe.id))
        .map((recipe) => Object.freeze({ id: recipe.id, recipe, resolved: true }));
      const unresolved = requested.filter((id) => !byId.has(id))
        .map((id) => Object.freeze({ id, recipe: null, resolved: false }));
      return Object.freeze([...resolved, ...unresolved]);
    },
  });
}

/**
 * Adapts one result from createRecipePreviewCatalog().list(). There is no
 * full-detail fallback, global pagination claim, or withRecipes() method.
 * Active rendering and account-favorite eligibility need later integration.
 */
export function adaptDashboardPreviewCatalogResult(rawResult) {
  const response = ownData(rawResult);
  if (!response || !Object.hasOwn(response, 'data') || !Object.hasOwn(response, 'error')
    || !Object.hasOwn(response, 'stale') || typeof response.stale !== 'boolean') {
    return Object.freeze({ catalog: null, databasePage: null, error: UNAVAILABLE, stale: false, partial: false });
  }
  if (response.stale) {
    return Object.freeze({ catalog: null, databasePage: null, error: STALE, stale: true, partial: false });
  }
  const data = ownData(response.data);
  const recipes = data ? arrayValues(data.recipes) : null;
  const databasePage = data ? pageSnapshot(data.databasePage) : null;
  if (!recipes || !databasePage) {
    return Object.freeze({ catalog: null, databasePage: null, error: UNAVAILABLE, stale: false, partial: false });
  }
  if (databasePage.hasMore === null && response.error === null) {
    return Object.freeze({ catalog: null, databasePage: null, error: UNAVAILABLE, stale: false, partial: false });
  }

  const safe = [];
  const seen = new Set();
  let malformed = false;
  for (const record of recipes) {
    const preview = previewSnapshot(record);
    if (!preview || seen.has(preview.id)) {
      malformed = true;
      continue;
    }
    seen.add(preview.id);
    safe.push(preview);
  }
  const partial = malformed || response.error !== null || databasePage.limitReached === true;
  if (response.error !== null && databasePage.hasMore !== null && !databasePage.limitReached) {
    return Object.freeze({ catalog: null, databasePage: null, error: UNAVAILABLE, stale: false, partial: false });
  }
  return Object.freeze({
    catalog: catalogFor(safe),
    databasePage,
    error: partial ? PARTIAL : null,
    stale: false,
    partial,
  });
}
