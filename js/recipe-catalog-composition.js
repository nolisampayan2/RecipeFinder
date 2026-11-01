import { createRecipeCatalog, recipeCatalog } from './recipe-catalog.js';
import { safeExternalUrl, safeImageUrl } from './security.js';

const DATABASE_SOURCE_TYPES = new Set(['seed', 'cms', 'external']);
const RECIPE_ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const ABSOLUTE_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const DATABASE_LOCAL_IMAGE = /^(?:\.\/|\/(?:[a-zA-Z\d_-]+\/)*)?assets\/[a-zA-Z\d][a-zA-Z\d._~%-]*(?:\/[a-zA-Z\d][a-zA-Z\d._~%-]*)*$/;
const REQUIRED_RECIPE_FIELDS = Object.freeze([
  'id',
  'source',
  'databaseSourceType',
  'name',
  'category',
  'cuisine',
  'image',
  'fallbackImage',
  'description',
  'ingredients',
  'instructions',
  'tutorial',
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(value, property) {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function mapDenseArray(value, mapper, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array.`);
  if (hasOwn(value, 'map')) throw new TypeError(`${fieldName} must not override array iteration.`);
  const length = value.length;
  const mapped = new Array(length);
  for (let index = 0; index < length; index += 1) {
    if (!hasOwn(value, index)) throw new TypeError(`${fieldName} must not be sparse.`);
    const item = value[index];
    mapped[index] = mapper(item, index);
  }
  return mapped;
}

function meaningfulText(value) {
  return typeof value === 'string'
    && value === value.trim()
    && Boolean(value)
    && !CONTROL_CHARACTERS.test(value);
}

function validatedImage(value, { optional = false } = {}) {
  if (optional && value === '') return '';
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new TypeError('Invalid database recipe image.');
  }
  const safe = safeImageUrl(value);
  if (!safe || safe !== value) throw new TypeError('Invalid database recipe image.');

  if (ABSOLUTE_SCHEME.test(value)) {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new TypeError('Invalid database recipe image.');
    }
  } else if (!DATABASE_LOCAL_IMAGE.test(value)) {
    throw new TypeError('Invalid database recipe image.');
  }
  return value;
}

function validatedTutorial(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new TypeError('Invalid database recipe tutorial.');
  }
  const safe = safeExternalUrl(value);
  if (!safe || safe !== value) throw new TypeError('Invalid database recipe tutorial.');
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new TypeError('Invalid database recipe tutorial.');
  }
  return value;
}

function validatedIngredients(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('Invalid database recipe ingredients.');
  }

  return mapDenseArray(value, (ingredient) => {
    if (
      !Array.isArray(ingredient)
      || ingredient.length !== 2
      || !hasOwn(ingredient, 0)
      || !hasOwn(ingredient, 1)
    ) {
      throw new TypeError('Invalid database recipe ingredient.');
    }
    const name = ingredient[0];
    const measurement = ingredient[1];
    if (!meaningfulText(name) || !meaningfulText(measurement)) {
      throw new TypeError('Invalid database recipe ingredient.');
    }
    return [name, measurement];
  }, 'database recipe ingredients');
}

function validatedDatabaseRecipe(recipe) {
  if (
    !isRecord(recipe)
    || REQUIRED_RECIPE_FIELDS.some((field) => !hasOwn(recipe, field))
  ) {
    throw new TypeError('Incomplete database recipe.');
  }

  const id = recipe.id;
  const source = recipe.source;
  const databaseSourceType = recipe.databaseSourceType;
  const name = recipe.name;
  const category = recipe.category;
  const cuisine = recipe.cuisine;
  const image = recipe.image;
  const fallbackImage = recipe.fallbackImage;
  const description = recipe.description;
  const ingredients = recipe.ingredients;
  const instructions = recipe.instructions;
  const tutorial = recipe.tutorial;

  if (!meaningfulText(id) || !RECIPE_ID.test(id)) throw new TypeError('Invalid database recipe ID.');
  if (source !== 'database' || !DATABASE_SOURCE_TYPES.has(databaseSourceType)) {
    throw new TypeError('Invalid database recipe provenance.');
  }
  if (
    !meaningfulText(name)
    || !meaningfulText(category)
    || !meaningfulText(cuisine)
    || !meaningfulText(description)
    || !meaningfulText(instructions)
  ) {
    throw new TypeError('Invalid database recipe text.');
  }

  const snapshot = {
    id,
    source,
    databaseSourceType,
    name,
    category,
    cuisine,
    image: validatedImage(image),
    fallbackImage: validatedImage(fallbackImage, { optional: true }),
    description,
    ingredients: validatedIngredients(ingredients),
    instructions,
    tutorial: validatedTutorial(tutorial),
  };

  if (databaseSourceType === 'external') {
    const externalProvider = recipe.externalProvider;
    const externalId = recipe.externalId;
    if (!meaningfulText(externalProvider) || !meaningfulText(externalId)) {
      throw new TypeError('Invalid external database recipe provenance.');
    }
    snapshot.externalProvider = externalProvider;
    snapshot.externalId = externalId;
  } else if (hasOwn(recipe, 'externalProvider') || hasOwn(recipe, 'externalId')) {
    throw new TypeError('Unexpected external database recipe provenance.');
  }

  return snapshot;
}

function selection(catalog, origin, databaseStatus) {
  return Object.freeze({ catalog, origin, databaseStatus });
}

const FALLBACK_SELECTIONS = Object.freeze({
  missing: selection(recipeCatalog, 'built-in', 'missing'),
  failed: selection(recipeCatalog, 'built-in', 'failed'),
  invalid: selection(recipeCatalog, 'built-in', 'invalid'),
});

/**
 * Selects an authoritative published database catalog only from an explicit
 * successful source result. A successful empty array remains authoritative;
 * every absent, failed, or malformed result preserves the built-in singleton.
 */
export function composePublishedRecipeCatalog(sourceResult) {
  if (sourceResult === undefined || sourceResult === null) {
    return FALLBACK_SELECTIONS.missing;
  }

  try {
    if (
      !isRecord(sourceResult)
      || !hasOwn(sourceResult, 'data')
      || !hasOwn(sourceResult, 'error')
    ) {
      return FALLBACK_SELECTIONS.invalid;
    }

    if (sourceResult.error !== null) {
      return isRecord(sourceResult.error)
        ? FALLBACK_SELECTIONS.failed
        : FALLBACK_SELECTIONS.invalid;
    }
    if (!Array.isArray(sourceResult.data)) return FALLBACK_SELECTIONS.invalid;

    const validatedRecipes = mapDenseArray(
      sourceResult.data,
      validatedDatabaseRecipe,
      'database recipes'
    );
    const catalog = createRecipeCatalog(validatedRecipes);
    return selection(catalog, 'database', 'success');
  } catch {
    return FALLBACK_SELECTIONS.invalid;
  }
}
