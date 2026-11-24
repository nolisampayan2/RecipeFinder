import { isValidAccountUserId, isValidFavoriteRecipeId } from './supabase-favorites.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEALDB = /^external:themealdb:(\d{1,20})$/;
const BAD_NAME = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const ERROR = Object.freeze({ code: 'UNAVAILABLE', message: 'Collections are unavailable. Try again.' });
const INVALID = Object.freeze({ code: 'INVALID_INPUT', message: 'Check the collection name or recipe.' });
const DUPLICATE = Object.freeze({ code: 'DUPLICATE', message: 'This recipe or collection already exists.' });
const DENIED = Object.freeze({ code: 'DENIED', message: 'Sign in to use collections.' });

export function normalizeCollectionName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= 80 && !BAD_NAME.test(name) ? name : null;
}

export function normalizeCollectionReference(value) {
  try {
    const id = value?.id;
    if (typeof id !== 'string') return null;
    const external = MEALDB.exec(id);
    if (external && value.source === 'external' && value.externalProvider === 'themealdb'
      && value.externalId === external[1]) {
      return Object.freeze({ recipe_id: null, mealdb_id: external[1] });
    }
    if (!isValidFavoriteRecipeId(id)) return null;
    if ((value.source === 'built-in' || value.source === 'database') && !id.startsWith('external:')) {
      return Object.freeze({ recipe_id: id, mealdb_id: null });
    }
    if (value.source === 'external' && value.externalProvider === 'fictional-offline'
      && value.externalId === id.match(/^external:fictional-offline:(\d+)$/)?.[1]) {
      return Object.freeze({ recipe_id: id, mealdb_id: null });
    }
  } catch { /* Malformed references cannot reach the provider. */ }
  return null;
}

function uuid(value) { return typeof value === 'string' && UUID.test(value); }
function result(data, error = null) { return Object.freeze({ data, error }); }
function failure(error = ERROR) { return result(null, error); }
function responseData(response) {
  if (!response || typeof response !== 'object' || response.error !== null) return null;
  return response.data;
}
function rows(value, limit) {
  if (!Array.isArray(value) || value.length > limit) throw new TypeError();
  for (let i = 0; i < value.length; i += 1) if (!Object.hasOwn(value, i)) throw new TypeError();
  return value;
}
function completeRows(response, limit) {
  const data = rows(responseData(response), limit);
  if (!Number.isSafeInteger(response.count) || response.count !== data.length) throw new TypeError();
  return data;
}
function record(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !fields.every((field) => Object.hasOwn(value, field))
    || Object.keys(value).some((field) => !fields.includes(field))) throw new TypeError();
  return value;
}
function collectionRow(value) {
  const row = record(value, ['id', 'name']);
  const name = normalizeCollectionName(row.name);
  if (!uuid(row.id) || name !== row.name) throw new TypeError();
  return Object.freeze({ id: row.id, name });
}
function itemRow(value) {
  const row = record(value, ['id', 'collection_id', 'recipe_id', 'mealdb_id']);
  if (!uuid(row.id) || !uuid(row.collection_id)) throw new TypeError();
  if (row.recipe_id !== null) {
    if (!isValidFavoriteRecipeId(row.recipe_id) || row.recipe_id.startsWith('external:themealdb:')
      || row.mealdb_id !== null) throw new TypeError();
  } else if (typeof row.mealdb_id !== 'string' || !/^\d{1,20}$/.test(row.mealdb_id)) throw new TypeError();
  return Object.freeze({ id: row.id, collectionId: row.collection_id,
    recipeId: row.recipe_id ?? `external:themealdb:${row.mealdb_id}` });
}
function providerError(error) {
  return error?.code === '23505' ? DUPLICATE : ERROR;
}

/** Explicit safe-column queries. The server's RLS and grants remain authoritative. */
export function createSupabaseRecipeCollectionsService(client) {
  if (typeof client?.from !== 'function') throw new TypeError('A collections client is required.');
  const table = (name) => client.from(name);
  async function one(build, shape) {
    try {
      const query = build();
      const response = await query.select(shape === collectionRow ? 'id,name' : 'id,collection_id,recipe_id,mealdb_id').single();
      if (response?.error) return failure(providerError(response.error));
      return result(shape(responseData(response)));
    } catch { return failure(); }
  }

  return Object.freeze({
    async listOwn(userId) {
      if (!isValidAccountUserId(userId)) return failure(DENIED);
      try {
        const parentResponse = await table('recipe_collections').select('id,name', { count: 'exact' })
          .eq('user_id', userId).order('created_at', { ascending: true });
        if (parentResponse?.error) return failure(providerError(parentResponse.error));
        const collections = completeRows(parentResponse, 200).map(collectionRow);
        if (new Set(collections.map((entry) => entry.id)).size !== collections.length) throw new TypeError();
        if (!collections.length) return result(Object.freeze([]));
        const itemResponse = await table('recipe_collection_items')
          .select('id,collection_id,recipe_id,mealdb_id', { count: 'exact' })
          .in('collection_id', collections.map((entry) => entry.id))
          .order('created_at', { ascending: true });
        if (itemResponse?.error) return failure(providerError(itemResponse.error));
        const items = completeRows(itemResponse, 5000).map(itemRow);
        if (new Set(items.map((item) => item.id)).size !== items.length) throw new TypeError();
        const groups = new Map(collections.map((entry) => [entry.id, []]));
        for (const item of items) {
          if (!groups.has(item.collectionId)) throw new TypeError();
          groups.get(item.collectionId).push(item);
        }
        return result(Object.freeze(collections.map((entry) => Object.freeze({
          ...entry, items: Object.freeze(groups.get(entry.id)),
        }))));
      } catch { return failure(); }
    },
    createOwn(userId, name) {
      const valid = normalizeCollectionName(name);
      if (!isValidAccountUserId(userId)) return Promise.resolve(failure(DENIED));
      if (!valid) return Promise.resolve(failure(INVALID));
      return one(() => table('recipe_collections').insert({ user_id: userId, name: valid }), collectionRow);
    },
    renameOwn(userId, collectionId, name) {
      const valid = normalizeCollectionName(name);
      if (!isValidAccountUserId(userId)) return Promise.resolve(failure(DENIED));
      if (!uuid(collectionId) || !valid) return Promise.resolve(failure(INVALID));
      return one(() => table('recipe_collections').update({ name: valid })
        .eq('id', collectionId).eq('user_id', userId), collectionRow);
    },
    async deleteOwn(userId, collectionId) {
      if (!isValidAccountUserId(userId)) return failure(DENIED);
      if (!uuid(collectionId)) return failure(INVALID);
      try {
        const response = await table('recipe_collections').delete()
          .eq('id', collectionId).eq('user_id', userId).select('id').single();
        if (response?.error) return failure(providerError(response.error));
        if (responseData(response)?.id !== collectionId) throw new TypeError();
        return result(Object.freeze({ id: collectionId }));
      } catch { return failure(); }
    },
    addOwn(userId, collectionId, recipe) {
      const reference = normalizeCollectionReference(recipe);
      if (!isValidAccountUserId(userId)) return Promise.resolve(failure(DENIED));
      if (!uuid(collectionId) || !reference) return Promise.resolve(failure(INVALID));
      return one(() => table('recipe_collection_items').insert({ collection_id: collectionId, ...reference }), itemRow);
    },
    async removeOwn(userId, collectionId, itemId) {
      if (!isValidAccountUserId(userId)) return failure(DENIED);
      if (!uuid(collectionId) || !uuid(itemId)) return failure(INVALID);
      try {
        const response = await table('recipe_collection_items').delete()
          .eq('collection_id', collectionId).eq('id', itemId).select('id').single();
        if (response?.error) return failure(providerError(response.error));
        if (responseData(response)?.id !== itemId) throw new TypeError();
        return result(Object.freeze({ id: itemId }));
      } catch { return failure(); }
    },
  });
}
