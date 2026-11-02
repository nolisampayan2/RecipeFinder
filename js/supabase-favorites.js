const USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECIPE_ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;

export const FAVORITES_SERVICE_ERROR = Object.freeze({
  PROVIDER: Object.freeze({ code: 'PROVIDER_ERROR', message: 'Account favorites are unavailable.' }),
  NETWORK: Object.freeze({ code: 'NETWORK_ERROR', message: 'Account favorites are unavailable.' }),
  INVALID_RESPONSE: Object.freeze({ code: 'INVALID_RESPONSE', message: 'Account favorites are unavailable.' }),
});

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(value, property) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

export function isValidAccountUserId(value) {
  return typeof value === 'string' && USER_UUID.test(value);
}

export function isValidFavoriteRecipeId(value) {
  return typeof value === 'string' && RECIPE_ID.test(value);
}

function requireUserId(value) {
  if (!isValidAccountUserId(value)) throw new TypeError('A valid authenticated user ID is required.');
  return value;
}

function requireRecipeId(value) {
  if (!isValidFavoriteRecipeId(value)) throw new TypeError('A valid favorite recipe ID is required.');
  return value;
}

function listFailure(error) {
  return Object.freeze({ data: null, error });
}

function writeFailure(error) {
  return Object.freeze({ ok: false, recipeId: null, error });
}

function isExplicitResponse(response) {
  return isRecord(response)
    && hasOwn(response, 'data')
    && hasOwn(response, 'error');
}

function normalizedFavoriteRows(value) {
  if (!Array.isArray(value) || hasOwn(value, 'map')) {
    throw new TypeError('Favorite rows are malformed.');
  }
  const ids = new Array(value.length);
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    if (!hasOwn(value, index)) throw new TypeError('Favorite rows are sparse.');
    const row = value[index];
    if (!isRecord(row) || !hasOwn(row, 'recipe_id')) {
      throw new TypeError('Favorite row is malformed.');
    }
    const recipeId = requireRecipeId(row.recipe_id);
    if (seen.has(recipeId)) throw new TypeError('Duplicate favorite recipe ID.');
    seen.add(recipeId);
    ids[index] = recipeId;
  }
  return Object.freeze(ids);
}

function normalizedWriteResponse(response, expectedRecipeId) {
  if (!isExplicitResponse(response) || response.error !== null || !isRecord(response.data)) {
    throw new TypeError('Favorite write response is malformed.');
  }
  if (!hasOwn(response.data, 'recipe_id') || response.data.recipe_id !== expectedRecipeId) {
    throw new TypeError('Favorite write identity is malformed.');
  }
  return Object.freeze({ ok: true, recipeId: expectedRecipeId, error: null });
}

function requireClient(client) {
  let from;
  try {
    from = client?.from;
  } catch {
    throw new TypeError('A compatible Supabase favorites client is required.');
  }
  if (typeof from !== 'function') {
    throw new TypeError('A compatible Supabase favorites client is required.');
  }
  return from;
}

export function createSupabaseFavoritesService(client) {
  const from = requireClient(client);

  const table = () => {
    const query = from.call(client, 'favorites');
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      throw new TypeError('Favorites query interface is unavailable.');
    }
    return query;
  };

  return Object.freeze({
    async listOwn(userId) {
      requireUserId(userId);
      try {
        const source = table();
        if (typeof source.select !== 'function') return listFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const selected = source.select('recipe_id');
        if (!selected || typeof selected.eq !== 'function') return listFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const scoped = selected.eq('user_id', userId);
        if (!scoped || typeof scoped.order !== 'function') return listFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const response = await scoped.order('created_at', { ascending: true });
        if (!isExplicitResponse(response)) return listFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        if (response.error !== null) return listFailure(FAVORITES_SERVICE_ERROR.PROVIDER);
        try {
          return Object.freeze({ data: normalizedFavoriteRows(response.data), error: null });
        } catch {
          return listFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        }
      } catch {
        return listFailure(FAVORITES_SERVICE_ERROR.NETWORK);
      }
    },

    async addOwn(userId, recipeId) {
      requireUserId(userId);
      requireRecipeId(recipeId);
      try {
        const source = table();
        if (typeof source.insert !== 'function') return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const inserted = source.insert({ user_id: userId, recipe_id: recipeId });
        if (!inserted || typeof inserted.select !== 'function') return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const selected = inserted.select('recipe_id');
        if (!selected || typeof selected.single !== 'function') return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const response = await selected.single();
        if (!isExplicitResponse(response)) return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        if (response.error !== null) return writeFailure(FAVORITES_SERVICE_ERROR.PROVIDER);
        try {
          return normalizedWriteResponse(response, recipeId);
        } catch {
          return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        }
      } catch {
        return writeFailure(FAVORITES_SERVICE_ERROR.NETWORK);
      }
    },

    async removeOwn(userId, recipeId) {
      requireUserId(userId);
      requireRecipeId(recipeId);
      try {
        const source = table();
        if (typeof source.delete !== 'function') return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const deleted = source.delete();
        if (!deleted || typeof deleted.eq !== 'function') return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const userScoped = deleted.eq('user_id', userId);
        if (!userScoped || typeof userScoped.eq !== 'function') return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const recipeScoped = userScoped.eq('recipe_id', recipeId);
        if (!recipeScoped || typeof recipeScoped.select !== 'function') return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const selected = recipeScoped.select('recipe_id');
        if (!selected || typeof selected.single !== 'function') return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        const response = await selected.single();
        if (!isExplicitResponse(response)) return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        if (response.error !== null) return writeFailure(FAVORITES_SERVICE_ERROR.PROVIDER);
        try {
          return normalizedWriteResponse(response, recipeId);
        } catch {
          return writeFailure(FAVORITES_SERVICE_ERROR.INVALID_RESPONSE);
        }
      } catch {
        return writeFailure(FAVORITES_SERVICE_ERROR.NETWORK);
      }
    },
  });
}
