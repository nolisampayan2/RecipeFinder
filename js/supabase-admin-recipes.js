const RECIPE_ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const STATUSES = new Set(['draft', 'published']);

export const ADMIN_RECIPE_SELECT = [
  'id',
  'name',
  'status',
  'category:recipe_categories!inner(name)',
  'cuisine:cuisines!inner(name)',
].join(',');

const SAFE_FAILURE = Object.freeze({
  data: null,
  error: Object.freeze({ code: 'unavailable', message: 'Admin recipes are unavailable.' }),
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
  for (const field of ['id', 'name', 'status', 'category', 'cuisine']) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) throw new TypeError('Recipe row is incomplete.');
  }
  const id = requiredText(row.id);
  if (!RECIPE_ID.test(id)) throw new TypeError('Recipe ID is invalid.');
  if (!STATUSES.has(row.status)) throw new TypeError('Recipe status is invalid.');
  return Object.freeze({
    id,
    name: requiredText(row.name),
    category: joinedName(row.category),
    cuisine: joinedName(row.cuisine),
    status: row.status,
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
