import { safeExternalUrl, safeImageUrl } from './security.js';

const RECIPE_ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const DISALLOWED_INSTRUCTION_CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const ABSOLUTE_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const DATABASE_LOCAL_IMAGE = /^(?:\.\/|\/(?:[a-zA-Z\d_-]+\/)*)?assets\/[a-zA-Z\d][a-zA-Z\d._~%-]*(?:\/[a-zA-Z\d][a-zA-Z\d._~%-]*)*$/;
const SOURCE_TYPES = new Set(['seed', 'cms', 'external']);
const REQUIRED_ROW_FIELDS = Object.freeze([
  'id',
  'name',
  'description',
  'image_url',
  'fallback_image_url',
  'tutorial_url',
  'ingredients',
  'instructions',
  'status',
  'source_type',
  'external_provider',
  'external_id',
  'category',
  'cuisine',
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function mapDenseArray(value, mapper, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array.`);
  if (Object.prototype.hasOwnProperty.call(value, 'map')) {
    throw new TypeError(`${fieldName} must not override array iteration.`);
  }
  const length = value.length;
  const mapped = new Array(length);
  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new TypeError(`${fieldName} must not be sparse.`);
    }
    const item = value[index];
    mapped[index] = mapper(item, index);
  }
  return mapped;
}

function requiredText(value, fieldName) {
  if (typeof value !== 'string') throw new TypeError(`${fieldName} must be text.`);
  const normalized = value.trim();
  if (!normalized || CONTROL_CHARACTERS.test(normalized)) {
    throw new TypeError(`${fieldName} must be meaningful text.`);
  }
  return normalized;
}

function requiredInstructions(value) {
  if (typeof value !== 'string') throw new TypeError('instructions must be text.');
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized || DISALLOWED_INSTRUCTION_CONTROLS.test(normalized)) {
    throw new TypeError('instructions must be meaningful text.');
  }
  return normalized;
}

function joinedName(value, fieldName) {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'name')) {
    throw new TypeError(`${fieldName} join is malformed.`);
  }
  return requiredText(value.name, `${fieldName}.name`);
}

function normalizeIngredients(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('ingredients must be a non-empty array.');
  }

  return Object.freeze(mapDenseArray(value, (ingredient) => {
    if (
      !isRecord(ingredient)
      || !Object.prototype.hasOwnProperty.call(ingredient, 'name')
      || !Object.prototype.hasOwnProperty.call(ingredient, 'measurement')
    ) {
      throw new TypeError('ingredient entries must contain name and measurement.');
    }
    return Object.freeze([
      requiredText(ingredient.name, 'ingredient.name'),
      requiredText(ingredient.measurement, 'ingredient.measurement'),
    ]);
  }, 'ingredients'));
}

function requiredImageUrl(value, fieldName) {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new TypeError(`${fieldName} must be text.`);
  }
  const safe = safeImageUrl(value);
  if (!safe) throw new TypeError(`${fieldName} is unsafe.`);

  if (ABSOLUTE_SCHEME.test(value)) {
    let parsed;
    try {
      parsed = new URL(safe);
    } catch {
      throw new TypeError(`${fieldName} is unsafe.`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new TypeError(`${fieldName} is unsafe.`);
    }
  } else if (!DATABASE_LOCAL_IMAGE.test(value)) {
    throw new TypeError(`${fieldName} is unsafe.`);
  }
  return safe;
}

function optionalImageUrl(value) {
  if (value === null) return '';
  return requiredImageUrl(value, 'fallback_image_url');
}

function optionalTutorialUrl(value) {
  if (value === null) return '';
  if (typeof value !== 'string') throw new TypeError('tutorial_url must be text.');
  const safe = safeExternalUrl(value);
  if (!safe) throw new TypeError('tutorial_url is unsafe.');
  let parsed;
  try {
    parsed = new URL(safe);
  } catch {
    throw new TypeError('tutorial_url is unsafe.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new TypeError('tutorial_url must use HTTPS without embedded credentials.');
  }
  return parsed.href;
}

function normalizeProvenance(row) {
  const sourceType = requiredText(row.source_type, 'source_type');
  if (!SOURCE_TYPES.has(sourceType)) throw new TypeError('source_type is invalid.');

  if (sourceType === 'external') {
    return Object.freeze({
      databaseSourceType: sourceType,
      externalProvider: requiredText(row.external_provider, 'external_provider'),
      externalId: requiredText(row.external_id, 'external_id'),
    });
  }

  if (row.external_provider !== null || row.external_id !== null) {
    throw new TypeError('Non-external recipes cannot contain external provenance.');
  }
  return Object.freeze({ databaseSourceType: sourceType });
}

export function normalizePublishedRecipeRow(row) {
  if (!isRecord(row)) throw new TypeError('Published recipe row must be an object.');
  if (REQUIRED_ROW_FIELDS.some((field) => !Object.prototype.hasOwnProperty.call(row, field))) {
    throw new TypeError('Published recipe row is incomplete.');
  }
  if (row.status !== 'published') throw new TypeError('Recipe is not published.');

  const id = requiredText(row.id, 'id');
  if (!RECIPE_ID.test(id)) throw new TypeError('Recipe ID is invalid.');
  const provenance = normalizeProvenance(row);

  return Object.freeze({
    id,
    source: 'database',
    ...provenance,
    name: requiredText(row.name, 'name'),
    category: joinedName(row.category, 'category'),
    cuisine: joinedName(row.cuisine, 'cuisine'),
    image: requiredImageUrl(row.image_url, 'image_url'),
    fallbackImage: optionalImageUrl(row.fallback_image_url),
    description: requiredText(row.description, 'description'),
    ingredients: normalizeIngredients(row.ingredients),
    instructions: requiredInstructions(row.instructions),
    tutorial: optionalTutorialUrl(row.tutorial_url),
  });
}
