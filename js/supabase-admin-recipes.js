import { safeExternalUrl, safeImageUrl } from './security.js';

const RECIPE_ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;
const USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MULTILINE_CONTROL_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const CONCURRENCY_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const STATUSES = new Set(['draft', 'published']);
const SOURCE_TYPES = new Set(['seed', 'cms', 'external']);

export const ADMIN_RECIPE_SELECT = [
  'id',
  'name',
  'status',
  'source_type',
  'category:recipe_categories!inner(name)',
  'cuisine:cuisines!inner(name)',
].join(',');

export const ADMIN_RECIPE_DETAIL_SELECT = [
  'id',
  'name',
  'description',
  'category_id',
  'cuisine_id',
  'image_url',
  'fallback_image_url',
  'tutorial_url',
  'ingredients',
  'instructions',
  'status',
  'source_type',
  'external_provider',
  'external_id',
  'created_by',
  'published_at',
  'created_at',
  'updated_at',
  'category:recipe_categories!inner(name)',
  'cuisine:cuisines!inner(name)',
].join(',');

const SAFE_FAILURE = Object.freeze({
  data: null,
  error: Object.freeze({ code: 'unavailable', message: 'Admin recipes are unavailable.' }),
});
const DETAIL_NOT_FOUND = Object.freeze({
  data: null,
  error: Object.freeze({ code: 'not_found', message: 'Admin recipe was not found.' }),
});

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredText(value) {
  if (typeof value !== 'string') throw new TypeError('Text is required.');
  const normalized = value.trim();
  if (!normalized || CONTROL_CHARACTERS.test(normalized)) throw new TypeError('Text is invalid.');
  return normalized;
}

function requiredMultilineText(value) {
  if (typeof value !== 'string') throw new TypeError('Text is required.');
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized || MULTILINE_CONTROL_CHARACTERS.test(normalized)) {
    throw new TypeError('Text is invalid.');
  }
  return normalized;
}

function identity(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Identity is invalid.');
  return value;
}

function timestamp(value) {
  if (typeof value !== 'string') throw new TypeError('Timestamp is invalid.');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() === 0) {
    throw new TypeError('Timestamp is invalid.');
  }
  return parsed.toISOString();
}

function concurrencyTimestamp(value) {
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) {
    throw new TypeError('Concurrency timestamp is invalid.');
  }
  const match = CONCURRENCY_TIMESTAMP.exec(value);
  if (!match) throw new TypeError('Concurrency timestamp is invalid.');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year === 0
    || month < 1
    || month > 12
    || day < 1
    || day > monthLengths[month - 1]
    || hour > 23
    || minute > 59
    || second > 59
  ) throw new TypeError('Concurrency timestamp is invalid.');
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      throw new TypeError('Concurrency timestamp is invalid.');
    }
  }
  return value;
}

function nullableTimestamp(value) {
  return value === null ? null : timestamp(value);
}

function imageUrl(value, optional = false) {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || value !== value.trim()) throw new TypeError('Image URL is invalid.');
  const safe = safeImageUrl(value);
  if (!safe) throw new TypeError('Image URL is invalid.');
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) {
    const parsed = new URL(safe);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new TypeError('Image URL is invalid.');
    }
    return parsed.href;
  }
  return safe;
}

function tutorialUrl(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value !== value.trim()) throw new TypeError('Tutorial URL is invalid.');
  const safe = safeExternalUrl(value);
  if (!safe) throw new TypeError('Tutorial URL is invalid.');
  const parsed = new URL(safe);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new TypeError('Tutorial URL is invalid.');
  }
  return parsed.href;
}

function ingredients(value) {
  if (!Array.isArray(value) || value.length === 0 || Object.prototype.hasOwnProperty.call(value, 'map')) {
    throw new TypeError('Ingredients are invalid.');
  }
  const output = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError('Ingredients are sparse.');
    const ingredient = value[index];
    if (
      !isRecord(ingredient)
      || !Object.prototype.hasOwnProperty.call(ingredient, 'name')
      || !Object.prototype.hasOwnProperty.call(ingredient, 'measurement')
    ) throw new TypeError('Ingredient is invalid.');
    output[index] = Object.freeze({
      name: requiredText(ingredient.name),
      measurement: requiredText(ingredient.measurement),
    });
  }
  return Object.freeze(output);
}

function joinedName(value) {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'name')) {
    throw new TypeError('Taxonomy join is malformed.');
  }
  return requiredText(value.name);
}

function mapDense(value, mapper) {
  if (!Array.isArray(value) || Object.prototype.hasOwnProperty.call(value, 'map')) {
    throw new TypeError('Recipe response must be a normal array.');
  }
  const output = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError('Recipe response is sparse.');
    output[index] = mapper(value[index]);
  }
  return output;
}

export function normalizeAdminRecipeRow(row) {
  if (!isRecord(row)) throw new TypeError('Recipe row is malformed.');
  for (const field of ['id', 'name', 'status', 'source_type', 'category', 'cuisine']) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) throw new TypeError('Recipe row is incomplete.');
  }
  const id = requiredText(row.id);
  if (!RECIPE_ID.test(id)) throw new TypeError('Recipe ID is invalid.');
  if (!STATUSES.has(row.status)) throw new TypeError('Recipe status is invalid.');
  if (!SOURCE_TYPES.has(row.source_type)) throw new TypeError('Recipe source is invalid.');
  return Object.freeze({
    id,
    name: requiredText(row.name),
    category: joinedName(row.category),
    cuisine: joinedName(row.cuisine),
    status: row.status,
    sourceType: row.source_type,
  });
}

export function normalizeAdminRecipeDetailRow(row) {
  if (!isRecord(row)) throw new TypeError('Recipe detail row is malformed.');
  const fields = [
    'id', 'name', 'description', 'category_id', 'cuisine_id', 'image_url',
    'fallback_image_url', 'tutorial_url', 'ingredients', 'instructions', 'status',
    'source_type', 'external_provider', 'external_id', 'created_by', 'published_at',
    'created_at', 'updated_at', 'category', 'cuisine',
  ];
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) throw new TypeError('Recipe detail row is incomplete.');
  }
  const id = requiredText(row.id);
  if (!RECIPE_ID.test(id)) throw new TypeError('Recipe ID is invalid.');
  if (!STATUSES.has(row.status)) throw new TypeError('Recipe status is invalid.');
  if (!SOURCE_TYPES.has(row.source_type)) throw new TypeError('Recipe source is invalid.');
  if (
    (row.source_type === 'external' && (
      typeof row.external_provider !== 'string'
      || !row.external_provider.trim()
      || typeof row.external_id !== 'string'
      || !row.external_id.trim()
    ))
    || (row.source_type !== 'external' && (row.external_provider !== null || row.external_id !== null))
  ) throw new TypeError('Recipe provenance is invalid.');
  if (row.created_by !== null && (typeof row.created_by !== 'string' || !USER_UUID.test(row.created_by))) {
    throw new TypeError('Recipe creator is invalid.');
  }
  const publishedAt = nullableTimestamp(row.published_at);
  if (
    (row.status === 'draft' && publishedAt !== null)
    || (row.status === 'published' && publishedAt === null)
  ) throw new TypeError('Recipe publication state is invalid.');

  return Object.freeze({
    id,
    name: requiredText(row.name),
    description: requiredMultilineText(row.description),
    categoryId: identity(row.category_id),
    cuisineId: identity(row.cuisine_id),
    category: joinedName(row.category),
    cuisine: joinedName(row.cuisine),
    imageUrl: imageUrl(row.image_url),
    fallbackImageUrl: imageUrl(row.fallback_image_url, true),
    tutorialUrl: tutorialUrl(row.tutorial_url),
    ingredients: ingredients(row.ingredients),
    instructions: requiredMultilineText(row.instructions),
    status: row.status,
    sourceType: row.source_type,
    externalProvider: row.external_provider === null ? null : row.external_provider.trim(),
    externalId: row.external_id === null ? null : row.external_id.trim(),
    createdBy: row.created_by === null ? null : row.created_by.toLowerCase(),
    publishedAt,
    createdAt: timestamp(row.created_at),
    updatedAt: concurrencyTimestamp(row.updated_at),
  });
}

export function createSupabaseAdminRecipeSource(client) {
  let from;
  try {
    from = client?.from;
  } catch {
    throw new TypeError('A compatible Supabase admin recipe client is required.');
  }
  if (typeof from !== 'function') throw new TypeError('A compatible Supabase admin recipe client is required.');

  let retired = false;
  let generation = 0;

  return Object.freeze({
    async listAll() {
      const requestGeneration = generation;
      if (retired) return SAFE_FAILURE;
      try {
        const table = from.call(client, 'recipes');
        if (!isRecord(table) || typeof table.select !== 'function') return SAFE_FAILURE;
        const selected = table.select(ADMIN_RECIPE_SELECT);
        if (!selected || typeof selected.order !== 'function') return SAFE_FAILURE;
        const response = await selected.order('updated_at', { ascending: false });
        if (retired || requestGeneration !== generation) return SAFE_FAILURE;
        if (
          !isRecord(response)
          || response.error !== null
          || !Object.prototype.hasOwnProperty.call(response, 'data')
          || !Array.isArray(response.data)
        ) return SAFE_FAILURE;

        const seen = new Set();
        const recipes = mapDense(response.data, (row) => {
          const recipe = normalizeAdminRecipeRow(row);
          if (seen.has(recipe.id)) throw new TypeError('Duplicate recipe ID.');
          seen.add(recipe.id);
          return recipe;
        });
        return Object.freeze({ data: Object.freeze(recipes), error: null });
      } catch {
        return SAFE_FAILURE;
      }
    },

    async getById(recipeId) {
      const requestGeneration = generation;
      if (retired) return SAFE_FAILURE;
      if (typeof recipeId !== 'string' || !RECIPE_ID.test(recipeId)) return SAFE_FAILURE;
      try {
        const table = from.call(client, 'recipes');
        if (!isRecord(table) || typeof table.select !== 'function') return SAFE_FAILURE;
        const selected = table.select(ADMIN_RECIPE_DETAIL_SELECT);
        if (!selected || typeof selected.eq !== 'function') return SAFE_FAILURE;
        const scoped = selected.eq('id', recipeId);
        if (!scoped || typeof scoped.limit !== 'function') return SAFE_FAILURE;
        const response = await scoped.limit(2);
        if (retired || requestGeneration !== generation) return SAFE_FAILURE;
        if (
          !isRecord(response)
          || response.error !== null
          || !Object.prototype.hasOwnProperty.call(response, 'data')
          || !Array.isArray(response.data)
        ) return SAFE_FAILURE;
        if (response.data.length === 0) return DETAIL_NOT_FOUND;
        if (response.data.length !== 1 || !Object.prototype.hasOwnProperty.call(response.data, 0)) {
          return SAFE_FAILURE;
        }
        const recipe = normalizeAdminRecipeDetailRow(response.data[0]);
        if (recipe.id !== recipeId) return SAFE_FAILURE;
        return Object.freeze({ data: recipe, error: null });
      } catch {
        return SAFE_FAILURE;
      }
    },

    invalidate() {
      if (retired) return false;
      generation += 1;
      return true;
    },

    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      return true;
    },
  });
}
