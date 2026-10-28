import { recipes as demoRecipes } from './data.js';
import { filterRecipes } from './filters.js';

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function freezeValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeValue);
  return Object.freeze(value);
}

function requireRecipeId(recipe) {
  if (!recipe || typeof recipe.id !== 'string' || !recipe.id.trim()) {
    throw new TypeError('Every recipe must have a non-empty string ID.');
  }
  return recipe.id;
}

export function createRecipeCatalog(sourceRecipes) {
  if (!Array.isArray(sourceRecipes)) throw new TypeError('Recipe catalog source must be an array.');

  const recipes = sourceRecipes.map((recipe) => freezeValue(cloneValue(recipe)));
  const recipesById = new Map();

  recipes.forEach((recipe) => {
    const id = requireRecipeId(recipe);
    if (recipesById.has(id)) throw new TypeError(`Duplicate recipe ID: ${id}`);
    recipesById.set(id, recipe);
  });

  const orderedRecipes = Object.freeze(recipes);

  return Object.freeze({
    list() {
      return orderedRecipes;
    },

    getById(id) {
      return typeof id === 'string' ? recipesById.get(id) || null : null;
    },

    filter(query = '', filter = '') {
      return Object.freeze(filterRecipes(orderedRecipes, query, filter));
    },

    withRecipes(additionalRecipes) {
      if (!Array.isArray(additionalRecipes)) throw new TypeError('Additional recipes must be an array.');
      return createRecipeCatalog([...orderedRecipes, ...additionalRecipes]);
    },

    resolveFavoriteIds(ids) {
      if (!ids || typeof ids[Symbol.iterator] !== 'function') {
        throw new TypeError('Favorite IDs must be iterable.');
      }

      const requestedIds = [...ids];
      const requestedIdSet = new Set(requestedIds);
      const resolved = orderedRecipes
        .filter((recipe) => requestedIdSet.has(recipe.id))
        .map((recipe) => Object.freeze({ id: recipe.id, recipe, resolved: true }));
      const unresolved = requestedIds
        .filter((id) => typeof id !== 'string' || !recipesById.has(id))
        .map((id) => Object.freeze({ id, recipe: null, resolved: false }));

      return Object.freeze([...resolved, ...unresolved]);
    },
  });
}

export const recipeCatalog = createRecipeCatalog(demoRecipes);
