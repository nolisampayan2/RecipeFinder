const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export const ADMIN_CATEGORY_SELECT = 'id,slug,name,emoji,sort_order,is_active,updated_at';
export const ADMIN_CUISINE_SELECT = 'id,slug,name,flag_emoji,sort_order,is_active,updated_at';

const SAFE_FAILURE = Object.freeze({
  data: null,
  error: Object.freeze({ code: 'unavailable', message: 'Admin taxonomy values are unavailable.' }),
});

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function requiredText(value, field, maximumLength = null) {
  if (typeof value !== 'string') throw new TypeError(`${field} is invalid.`);
  const normalized = value.trim();
  if (
    !normalized
    || CONTROL_CHARACTERS.test(normalized)
    || (maximumLength !== null && Array.from(normalized).length > maximumLength)
  ) throw new TypeError(`${field} is invalid.`);
  return normalized;
}

function optionalText(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) {
    throw new TypeError(`${field} is invalid.`);
  }
  return value;
}

function identity(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Taxonomy ID is invalid.');
  return value;
}

function integer(value) {
  if (!Number.isSafeInteger(value)) throw new TypeError('Taxonomy order is invalid.');
  return value;
}

function timestamp(value) {
  if (typeof value !== 'string') throw new TypeError('Taxonomy timestamp is invalid.');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() === 0) {
    throw new TypeError('Taxonomy timestamp is invalid.');
  }
  return parsed.toISOString();
}

function normalizeRow(row, kind) {
  if (!isRecord(row)) throw new TypeError('Taxonomy row is malformed.');
  const optionalField = kind === 'category' ? 'emoji' : 'flag_emoji';
  for (const field of ['id', 'slug', 'name', optionalField, 'sort_order', 'is_active', 'updated_at']) {
    if (!hasOwn(row, field)) throw new TypeError('Taxonomy row is incomplete.');
  }
  let slug;
  let active;
  try {
    slug = row.slug;
    active = row.is_active;
  } catch {
    throw new TypeError('Taxonomy row is malformed.');
  }
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new TypeError('Taxonomy slug is invalid.');
  if (typeof active !== 'boolean') throw new TypeError('Taxonomy status is invalid.');
  return Object.freeze({
    id: identity(row.id),
    slug,
    name: requiredText(row.name, 'name', 80),
    symbol: optionalText(row[optionalField], optionalField),
    sortOrder: integer(row.sort_order),
    isActive: active,
    updatedAt: timestamp(row.updated_at),
  });
}

function normalizeRows(value, kind) {
  if (!Array.isArray(value) || hasOwn(value, 'map')) throw new TypeError('Taxonomy response is malformed.');
  const output = new Array(value.length);
  const ids = new Set();
  const slugs = new Set();
  for (let index = 0; index < value.length; index += 1) {
    if (!hasOwn(value, index)) throw new TypeError('Taxonomy response is sparse.');
    const row = normalizeRow(value[index], kind);
    if (ids.has(row.id) || slugs.has(row.slug)) throw new TypeError('Taxonomy response contains duplicates.');
    ids.add(row.id);
    slugs.add(row.slug);
    output[index] = row;
  }
  return Object.freeze(output);
}

function requireClient(client) {
  let from;
  try {
    from = client?.from;
  } catch {
    throw new TypeError('A compatible Supabase Admin taxonomy client is required.');
  }
  if (typeof from !== 'function') throw new TypeError('A compatible Supabase Admin taxonomy client is required.');
  return from;
}

export function createSupabaseAdminTaxonomySource(client) {
  const from = requireClient(client);
  let generation = 0;
  let retired = false;

  const list = async (tableName, fields, kind) => {
    const requestGeneration = generation;
    if (retired) return SAFE_FAILURE;
    try {
      const table = from.call(client, tableName);
      if (!isRecord(table) || typeof table.select !== 'function') return SAFE_FAILURE;
      const selected = table.select(fields);
      if (!isRecord(selected) || typeof selected.order !== 'function') return SAFE_FAILURE;
      const ordered = selected.order('sort_order', { ascending: true });
      if (!isRecord(ordered) || typeof ordered.order !== 'function') return SAFE_FAILURE;
      const response = await ordered.order('name', { ascending: true });
      if (retired || requestGeneration !== generation) return SAFE_FAILURE;
      if (
        !isRecord(response)
        || !hasOwn(response, 'data')
        || !hasOwn(response, 'error')
        || response.error !== null
      ) return SAFE_FAILURE;
      return Object.freeze({ data: normalizeRows(response.data, kind), error: null });
    } catch {
      return SAFE_FAILURE;
    }
  };

  return Object.freeze({
    listCategories() {
      return list('recipe_categories', ADMIN_CATEGORY_SELECT, 'category');
    },

    listCuisines() {
      return list('cuisines', ADMIN_CUISINE_SELECT, 'cuisine');
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
