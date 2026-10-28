import {
  normalizeFullMeal,
  normalizeMealCollection,
  normalizeMealSummary,
} from './mealdb-normalize.js';

const EXTERNAL_RECIPE_ID = /^external:themealdb:(\d+)$/;

export class MealDbRecipeSourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MealDbRecipeSourceError';
    this.code = code;
  }
}

export function parseMealDbRecipeId(value) {
  const match = typeof value === 'string' ? EXTERNAL_RECIPE_ID.exec(value) : null;
  if (!match) {
    throw new MealDbRecipeSourceError('INVALID_ID', 'A valid TheMealDB recipe ID is required.');
  }
  return Object.freeze({ id: value, externalId: match[1] });
}

function requireClient(client) {
  const methods = ['search', 'filterByCategory', 'filterByArea', 'lookup'];
  if (!client || typeof client !== 'object' || methods.some((method) => typeof client[method] !== 'function')) {
    throw new MealDbRecipeSourceError('INVALID_SOURCE', 'A compatible TheMealDB client is required.');
  }
  return client;
}

export function createMealDbRecipeSource({ client } = {}) {
  const mealDbClient = requireClient(client);

  return Object.freeze({
    async search(query, options = {}) {
      const meals = await mealDbClient.search(query, options);
      return normalizeMealCollection(meals, normalizeFullMeal);
    },

    async filterCategory(category, options = {}) {
      const meals = await mealDbClient.filterByCategory(category, options);
      return normalizeMealCollection(meals, normalizeMealSummary, { category });
    },

    async filterCuisine(cuisine, options = {}) {
      const meals = await mealDbClient.filterByArea(cuisine, options);
      return normalizeMealCollection(meals, normalizeMealSummary, { cuisine });
    },

    async getDetails(id, options = {}) {
      const identity = parseMealDbRecipeId(id);
      const meals = await mealDbClient.lookup(identity.externalId, options);
      const normalized = normalizeMealCollection(meals, normalizeFullMeal);
      if (normalized.length !== 1) {
        throw new MealDbRecipeSourceError(
          normalized.length ? 'AMBIGUOUS_RESULT' : 'NOT_FOUND',
          'The external recipe details are unavailable.',
        );
      }
      if (normalized[0].id !== identity.id) {
        throw new MealDbRecipeSourceError('IDENTITY_MISMATCH', 'The external recipe identity did not match.');
      }
      return normalized[0];
    },
  });
}
