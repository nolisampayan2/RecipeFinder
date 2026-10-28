import { createExternalRecipeController } from './external-recipe-controller.js';

const DISCOVER_ALL_QUERY = 'recipefinder:discover-all-offline-previews';

const FICTIONAL_RECIPES = Object.freeze([
  {
    id: 'external:themealdb:990001', externalId: '990001', name: 'Aurora Garden Couscous',
    category: 'Vegetarian', cuisine: 'Mediterranean',
    description: 'A fictional offline couscous preview with roasted vegetables and herbs.',
    ingredients: [['Couscous', '1 cup'], ['Roasted vegetables', '2 cups'], ['Fresh herbs', '1 handful']],
    instructions: 'Prepare the couscous, fold in the vegetables, and finish with herbs.',
  },
  {
    id: 'external:themealdb:990002', externalId: '990002', name: 'Midnight Citrus Noodles',
    category: 'Pasta', cuisine: 'Japanese',
    description: 'A fictional offline noodle preview brightened with citrus and sesame.',
    ingredients: [['Noodles', '250 g'], ['Citrus juice', '3 tbsp'], ['Sesame', '1 tbsp']],
    instructions: 'Cook the noodles, toss with citrus dressing, and sprinkle with sesame.',
  },
  {
    id: 'external:themealdb:990003', externalId: '990003', name: 'Ember Lime Chicken',
    category: 'Chicken', cuisine: 'Mexican',
    description: 'A fictional offline chicken preview with charred lime and mild spices.',
    ingredients: [['Chicken', '500 g'], ['Lime', '2'], ['Mild spices', '2 tsp']],
    instructions: 'Season the chicken, grill until cooked, and finish with lime.',
  },
  {
    id: 'external:themealdb:990004', externalId: '990004', name: 'Cocoa Pear Tart',
    category: 'Dessert', cuisine: 'French',
    description: 'A fictional offline tart preview pairing cocoa pastry with ripe pear.',
    ingredients: [['Pear', '2'], ['Cocoa pastry', '1 shell'], ['Vanilla', '1 tsp']],
    instructions: 'Arrange pears in the pastry shell and bake until tender.',
  },
  {
    id: 'external:themealdb:990005', externalId: '990005', name: 'Coastal Sesame Rice Bowl',
    category: 'Seafood', cuisine: 'American',
    description: 'A fictional offline seafood bowl preview with rice and sesame greens.',
    ingredients: [['White fish', '300 g'], ['Rice', '2 cups'], ['Sesame greens', '1 cup']],
    instructions: 'Cook the fish, arrange over rice, and add sesame greens.',
  },
  {
    id: 'external:themealdb:990006', externalId: '990006', name: 'Sunrise Tomato Toast',
    category: 'Breakfast', cuisine: 'Italian',
    description: 'A fictional offline breakfast preview with tomatoes and crisp toast.',
    ingredients: [['Bread', '4 slices'], ['Tomatoes', '3'], ['Basil', '1 handful']],
    instructions: 'Toast the bread and top with seasoned tomatoes and basil.',
  },
].map((recipe) => Object.freeze({
  ...recipe,
  source: 'external',
  externalProvider: 'fictional-offline',
  detailLevel: 'full',
  image: 'assets/recipefinder-favicon.svg',
  fallbackImage: 'assets/recipefinder-favicon.svg',
  tutorial: '',
  ingredients: Object.freeze(recipe.ingredients.map((pair) => Object.freeze([...pair]))),
})));

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
}

function checkSignal(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Offline request cancelled.'), { code: 'ABORTED' });
}

function immutableRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw new TypeError('Each fictional recipe must be an object.');
  }
  const id = requireText(recipe.id, 'recipe ID');
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((pair) => Object.freeze(Array.isArray(pair) ? [...pair] : []))
    : [];
  return Object.freeze({ ...recipe, id, ingredients: Object.freeze(ingredients) });
}

function summary(recipe) {
  return Object.freeze({
    ...recipe,
    detailLevel: 'summary',
    ingredients: Object.freeze([]),
    instructions: '',
    tutorial: '',
  });
}

function searchText(recipe) {
  return [recipe.name, recipe.category, recipe.cuisine, recipe.description, ...recipe.ingredients.flat()]
    .join(' ')
    .toLowerCase();
}

export function createFictionalExternalRecipeSource({ recipes = FICTIONAL_RECIPES } = {}) {
  if (!Array.isArray(recipes)) throw new TypeError('Fictional recipes must be an array.');
  const records = Object.freeze(recipes.map(immutableRecipe));
  const ids = new Set();
  records.forEach(({ id }) => {
    if (ids.has(id)) throw new TypeError(`Duplicate fictional recipe ID: ${id}`);
    ids.add(id);
  });

  return Object.freeze({
    async search(query, { signal } = {}) {
      checkSignal(signal);
      const normalizedQuery = requireText(query, 'query').toLowerCase();
      if (normalizedQuery === DISCOVER_ALL_QUERY) return records;
      return records.filter((recipe) => searchText(recipe).includes(normalizedQuery));
    },

    async filterCategory(category, { signal } = {}) {
      checkSignal(signal);
      const normalizedCategory = requireText(category, 'category');
      return records.filter((recipe) => recipe.category === normalizedCategory).map(summary);
    },

    async filterCuisine(cuisine, { signal } = {}) {
      checkSignal(signal);
      const normalizedCuisine = requireText(cuisine, 'cuisine');
      return records.filter((recipe) => recipe.cuisine === normalizedCuisine).map(summary);
    },

    async getDetails(id, { signal } = {}) {
      checkSignal(signal);
      const normalizedId = requireText(id, 'id');
      if (!/^external:themealdb:\d+$/.test(normalizedId)) throw new TypeError('A valid external recipe ID is required.');
      const recipe = records.find((item) => item.id === normalizedId);
      if (!recipe) throw Object.assign(new Error('Fictional recipe not found.'), { code: 'NOT_FOUND' });
      return recipe;
    },
  });
}

export function createFictionalExternalRecipeController(options) {
  const controller = createExternalRecipeController({ source: createFictionalExternalRecipeSource(options) });
  return Object.freeze({
    ...controller,
    discoverAll: (requestOptions) => controller.search(DISCOVER_ALL_QUERY, requestOptions),
  });
}
