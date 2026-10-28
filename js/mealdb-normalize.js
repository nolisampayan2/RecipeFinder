import { safeExternalUrl, safeImageUrl } from './security.js';

const PROVIDER = 'themealdb';
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredText(value, fieldName) {
  const normalized = text(value);
  if (!normalized || CONTROL_CHARACTERS.test(normalized)) {
    throw new TypeError(`${fieldName} must be non-empty text without control characters.`);
  }
  return normalized;
}

function externalId(value, fieldName = 'idMeal') {
  const normalized = requiredText(String(value ?? ''), fieldName);
  if (!/^\d+$/.test(normalized)) throw new TypeError(`${fieldName} must contain digits only.`);
  return normalized;
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function contextText(value, fieldName) {
  const normalized = text(value);
  if (CONTROL_CHARACTERS.test(normalized)) throw new TypeError(`${fieldName} contains control characters.`);
  return normalized;
}

function recipeIdentity(id) {
  return `external:${PROVIDER}:${id}`;
}

function ingredientsFrom(meal) {
  const ingredients = [];
  for (let index = 1; index <= 20; index += 1) {
    const ingredient = text(meal[`strIngredient${index}`]);
    if (!ingredient) continue;
    ingredients.push([ingredient, text(meal[`strMeasure${index}`])]);
  }
  return ingredients;
}

function recipeBase(meal, detailLevel, context = {}) {
  assertRecord(meal, 'meal');
  const id = externalId(meal.idMeal);
  const name = requiredText(meal.strMeal, 'strMeal');
  const category = text(meal.strCategory) || contextText(context.category, 'category');
  const cuisine = text(meal.strArea) || contextText(context.cuisine, 'cuisine');

  return {
    id: recipeIdentity(id),
    source: 'external',
    externalProvider: PROVIDER,
    externalId: id,
    detailLevel,
    name,
    category,
    cuisine,
    image: safeImageUrl(meal.strMealThumb),
    description: '',
  };
}

export function normalizeFullMeal(meal) {
  const normalized = recipeBase(meal, 'full');
  return {
    ...normalized,
    ingredients: ingredientsFrom(meal),
    instructions: text(meal.strInstructions),
    tutorial: safeExternalUrl(meal.strYoutube),
  };
}

export function normalizeMealSummary(meal, context = {}) {
  return {
    ...recipeBase(meal, 'summary', context),
    ingredients: [],
    instructions: '',
    tutorial: '',
  };
}

export function normalizeMealCollection(meals, normalize = normalizeFullMeal, context = {}) {
  if (!Array.isArray(meals)) throw new TypeError('meals must be an array.');
  if (typeof normalize !== 'function') throw new TypeError('normalize must be a function.');

  const seen = new Set();
  return meals.map((meal) => {
    const normalized = normalize(meal, context);
    if (seen.has(normalized.id)) throw new TypeError(`Duplicate external recipe identity: ${normalized.id}`);
    seen.add(normalized.id);
    return normalized;
  });
}

export function normalizeCategories(categories) {
  if (!Array.isArray(categories)) throw new TypeError('categories must be an array.');
  const seen = new Set();
  return categories.map((category) => {
    assertRecord(category, 'category');
    const id = externalId(category.idCategory, 'idCategory');
    const identity = `external:${PROVIDER}:category:${id}`;
    if (seen.has(identity)) throw new TypeError(`Duplicate external category identity: ${identity}`);
    seen.add(identity);
    return {
      id: identity,
      source: 'external',
      externalProvider: PROVIDER,
      externalId: id,
      name: requiredText(category.strCategory, 'strCategory'),
      image: safeImageUrl(category.strCategoryThumb),
      description: text(category.strCategoryDescription),
    };
  });
}

export function normalizeAreas(areas) {
  if (!Array.isArray(areas)) throw new TypeError('areas must be an array.');
  const seen = new Set();
  return areas.map((area) => {
    assertRecord(area, 'area');
    const name = requiredText(area.strArea, 'strArea');
    const key = name.toLocaleLowerCase('en-US');
    if (seen.has(key)) throw new TypeError(`Duplicate external area: ${name}`);
    seen.add(key);
    return { name };
  });
}
