import { safeExternalUrl, safeImageUrl } from './security.js';

const RECIPE_ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;
const USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MULTILINE_CONTROL_CHARACTERS = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const ABSOLUTE_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const DATABASE_ABSOLUTE_IMAGE = /^https?:\/\/[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?(?:\?[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?(?:#[A-Za-z0-9._~!$&'()*+,;=:@%/?-]*)?$/;
const DATABASE_LOCAL_IMAGE = /^(?:\.\/|\/(?:[a-zA-Z\d_-]+\/)*)?assets\/[a-zA-Z\d][a-zA-Z\d._~%-]*(?:\/[a-zA-Z\d][a-zA-Z\d._~%-]*)*$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ISSUED_VALIDATION_ERRORS = new WeakSet();

const EDITABLE_FIELDS = Object.freeze([
  'name',
  'description',
  'categoryId',
  'cuisineId',
  'imageUrl',
  'fallbackImageUrl',
  'tutorialUrl',
  'ingredients',
  'instructions',
]);
const EDITABLE_FIELD_SET = new Set(EDITABLE_FIELDS);
const CONTEXT_FIELDS = Object.freeze(['recipeId', 'creatorUserId', 'status', 'publishedAt']);
const CONTEXT_FIELD_SET = new Set(CONTEXT_FIELDS);
const PROTECTED_INPUT_FIELDS = new Set([
  'created_by',
  'createdBy',
  'source_type',
  'sourceType',
  'external_provider',
  'externalProvider',
  'external_id',
  'externalId',
]);
const IMMUTABLE_INPUT_FIELDS = new Set([
  'id',
  'recipeId',
  'status',
  'published_at',
  'publishedAt',
]);

export const ADMIN_RECIPE_STATUS = Object.freeze({
  DRAFT: 'draft',
  PUBLISHED: 'published',
});

export const ADMIN_RECIPE_VALIDATION_ERROR = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_FIELD: 'MISSING_FIELD',
  UNEXPECTED_FIELD: 'UNEXPECTED_FIELD',
  IMMUTABLE_FIELD: 'IMMUTABLE_FIELD',
  PROVENANCE_OVERRIDE: 'PROVENANCE_OVERRIDE',
  INVALID_RECIPE_ID: 'INVALID_RECIPE_ID',
  INVALID_CREATOR_ID: 'INVALID_CREATOR_ID',
  INVALID_NAME: 'INVALID_NAME',
  INVALID_DESCRIPTION: 'INVALID_DESCRIPTION',
  INVALID_CATEGORY_ID: 'INVALID_CATEGORY_ID',
  INVALID_CUISINE_ID: 'INVALID_CUISINE_ID',
  INVALID_IMAGE_URL: 'INVALID_IMAGE_URL',
  INVALID_FALLBACK_IMAGE_URL: 'INVALID_FALLBACK_IMAGE_URL',
  INVALID_TUTORIAL_URL: 'INVALID_TUTORIAL_URL',
  INVALID_INGREDIENTS: 'INVALID_INGREDIENTS',
  INVALID_INSTRUCTIONS: 'INVALID_INSTRUCTIONS',
  INVALID_STATUS: 'INVALID_STATUS',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
});

const ERROR_MESSAGES = Object.freeze({
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT]: 'Recipe input must be a plain object.',
  [ADMIN_RECIPE_VALIDATION_ERROR.MISSING_FIELD]: 'A required recipe field is missing.',
  [ADMIN_RECIPE_VALIDATION_ERROR.UNEXPECTED_FIELD]: 'Recipe input contains an unexpected field.',
  [ADMIN_RECIPE_VALIDATION_ERROR.IMMUTABLE_FIELD]: 'Immutable recipe fields must come from trusted context.',
  [ADMIN_RECIPE_VALIDATION_ERROR.PROVENANCE_OVERRIDE]: 'Recipe provenance must come from trusted context.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_RECIPE_ID]: 'Recipe ID is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_CREATOR_ID]: 'Recipe creator identity is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_NAME]: 'Recipe name is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_DESCRIPTION]: 'Recipe description is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_CATEGORY_ID]: 'Recipe category is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_CUISINE_ID]: 'Recipe cuisine is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_IMAGE_URL]: 'Recipe image URL is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_FALLBACK_IMAGE_URL]: 'Recipe fallback image URL is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TUTORIAL_URL]: 'Recipe tutorial URL is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INGREDIENTS]: 'Recipe ingredients are invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INSTRUCTIONS]: 'Recipe instructions are invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_STATUS]: 'Recipe publication status is invalid.',
  [ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TIMESTAMP]: 'Recipe publication timestamp is invalid.',
});

export class AdminRecipeValidationError extends TypeError {
  constructor(code, field = null) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES[ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT]);
    this.name = 'AdminRecipeValidationError';
    this.code = Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)
      ? code
      : ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT;
    this.field = typeof field === 'string' ? field : null;
    Object.freeze(this);
  }
}

function fail(code, field = null) {
  const error = new AdminRecipeValidationError(code, field);
  ISSUED_VALIDATION_ERRORS.add(error);
  throw error;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ownKeys(value) {
  try {
    return Reflect.ownKeys(value);
  } catch {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT);
  }
}

function validateShape(value, expectedFields, expectedFieldSet, source) {
  if (!isRecord(value)) fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT);
  const keys = ownKeys(value);
  for (const key of keys) {
    if (typeof key !== 'string') fail(ADMIN_RECIPE_VALIDATION_ERROR.UNEXPECTED_FIELD);
    if (source === 'input' && PROTECTED_INPUT_FIELDS.has(key)) {
      fail(ADMIN_RECIPE_VALIDATION_ERROR.PROVENANCE_OVERRIDE, key);
    }
    if (source === 'input' && IMMUTABLE_INPUT_FIELDS.has(key)) {
      fail(ADMIN_RECIPE_VALIDATION_ERROR.IMMUTABLE_FIELD, key);
    }
    if (!expectedFieldSet.has(key)) fail(ADMIN_RECIPE_VALIDATION_ERROR.UNEXPECTED_FIELD);
  }
  for (const field of expectedFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      fail(ADMIN_RECIPE_VALIDATION_ERROR.MISSING_FIELD, field);
    }
  }
}

function read(value, field) {
  try {
    return value[field];
  } catch {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT);
  }
}

function normalizedSingleLineText(value, code, field, maximumLength = null) {
  if (typeof value !== 'string') fail(code, field);
  const normalized = value.trim();
  if (
    !normalized
    || CONTROL_CHARACTERS.test(normalized)
    || (maximumLength !== null && Array.from(normalized).length > maximumLength)
  ) fail(code, field);
  return normalized;
}

function normalizedMultilineText(value, code, field) {
  if (typeof value !== 'string') fail(code, field);
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized || MULTILINE_CONTROL_CHARACTERS.test(normalized)) fail(code, field);
  return normalized;
}

function positiveIdentity(value, code, field) {
  // Application taxonomy identities stay within JavaScript's exact positive
  // integer range even though PostgreSQL bigint has a wider numeric range.
  if (!Number.isSafeInteger(value) || value <= 0) fail(code, field);
  return value;
}

function normalizedImageUrl(value, code, field, optional = false) {
  if (optional && (value === null || value === '')) return null;
  if (typeof value !== 'string' || value !== value.trim()) fail(code, field);
  const safe = safeImageUrl(value);
  if (!safe) fail(code, field);

  if (ABSOLUTE_SCHEME.test(value)) {
    let parsed;
    try {
      parsed = new URL(safe);
    } catch {
      fail(code, field);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      fail(code, field);
    }
    if (!DATABASE_ABSOLUTE_IMAGE.test(parsed.href)) fail(code, field);
    return parsed.href;
  }

  if (!DATABASE_LOCAL_IMAGE.test(value)) fail(code, field);
  return value;
}

function normalizedTutorialUrl(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value !== value.trim()) {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TUTORIAL_URL, 'tutorialUrl');
  }
  const safe = safeExternalUrl(value);
  if (!safe) fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TUTORIAL_URL, 'tutorialUrl');
  let parsed;
  try {
    parsed = new URL(safe);
  } catch {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TUTORIAL_URL, 'tutorialUrl');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TUTORIAL_URL, 'tutorialUrl');
  }
  return parsed.href;
}

function normalizedIngredients(value) {
  if (!Array.isArray(value) || value.length === 0 || Object.prototype.hasOwnProperty.call(value, 'map')) {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INGREDIENTS, 'ingredients');
  }

  const ingredients = new Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INGREDIENTS, 'ingredients');
    }
    const ingredient = read(value, index);
    if (!isRecord(ingredient)) fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INGREDIENTS, 'ingredients');
    const keys = ownKeys(ingredient);
    if (
      keys.length !== 2
      || !keys.every((key) => typeof key === 'string' && (key === 'name' || key === 'measurement'))
      || !Object.prototype.hasOwnProperty.call(ingredient, 'name')
      || !Object.prototype.hasOwnProperty.call(ingredient, 'measurement')
    ) fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INGREDIENTS, 'ingredients');

    const name = normalizedSingleLineText(
      read(ingredient, 'name'),
      ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INGREDIENTS,
      'ingredients',
    );
    const measurement = normalizedSingleLineText(
      read(ingredient, 'measurement'),
      ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INGREDIENTS,
      'ingredients',
    );
    ingredients[index] = Object.freeze({ name, measurement });
  }
  return Object.freeze(ingredients);
}

function normalizedRecipeId(value) {
  if (typeof value !== 'string' || !RECIPE_ID.test(value)) {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_RECIPE_ID, 'recipeId');
  }
  return value;
}

function normalizedCreatorUserId(value) {
  // This intentionally follows RecipeFinder's authenticated UUID contract,
  // not every textual UUID form accepted by PostgreSQL's uuid type.
  if (typeof value !== 'string' || !USER_UUID.test(value)) {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_CREATOR_ID, 'creatorUserId');
  }
  return value.toLowerCase();
}

function normalizedPublication(status, publishedAt) {
  if (![ADMIN_RECIPE_STATUS.DRAFT, ADMIN_RECIPE_STATUS.PUBLISHED].includes(status)) {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_STATUS, 'status');
  }
  if (status === ADMIN_RECIPE_STATUS.DRAFT) {
    if (publishedAt !== null) fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TIMESTAMP, 'publishedAt');
    return Object.freeze({ status, publishedAt: null });
  }
  // Future writes supply canonical UTC values from Date#toISOString rather
  // than PostgreSQL's broader timestamptz input grammar.
  if (
    typeof publishedAt !== 'string'
    || !CANONICAL_TIMESTAMP.test(publishedAt)
    || publishedAt.startsWith('0000-')
  ) {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TIMESTAMP, 'publishedAt');
  }
  const parsed = new Date(publishedAt);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== publishedAt) {
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TIMESTAMP, 'publishedAt');
  }
  return Object.freeze({ status, publishedAt });
}

/**
 * Converts editable form values plus trusted identity/publication context into
 * the exact database-shaped payload used by future Admin CMS recipe writes.
 */
export function normalizeAdminRecipeInput(input, context) {
  try {
    validateShape(input, EDITABLE_FIELDS, EDITABLE_FIELD_SET, 'input');
    validateShape(context, CONTEXT_FIELDS, CONTEXT_FIELD_SET, 'context');

    const publication = normalizedPublication(read(context, 'status'), read(context, 'publishedAt'));
    const normalized = {
      id: normalizedRecipeId(read(context, 'recipeId')),
      name: normalizedSingleLineText(
        read(input, 'name'),
        ADMIN_RECIPE_VALIDATION_ERROR.INVALID_NAME,
        'name',
        160,
      ),
      description: normalizedMultilineText(
        read(input, 'description'),
        ADMIN_RECIPE_VALIDATION_ERROR.INVALID_DESCRIPTION,
        'description',
      ),
      category_id: positiveIdentity(
        read(input, 'categoryId'),
        ADMIN_RECIPE_VALIDATION_ERROR.INVALID_CATEGORY_ID,
        'categoryId',
      ),
      cuisine_id: positiveIdentity(
        read(input, 'cuisineId'),
        ADMIN_RECIPE_VALIDATION_ERROR.INVALID_CUISINE_ID,
        'cuisineId',
      ),
      image_url: normalizedImageUrl(
        read(input, 'imageUrl'),
        ADMIN_RECIPE_VALIDATION_ERROR.INVALID_IMAGE_URL,
        'imageUrl',
      ),
      fallback_image_url: normalizedImageUrl(
        read(input, 'fallbackImageUrl'),
        ADMIN_RECIPE_VALIDATION_ERROR.INVALID_FALLBACK_IMAGE_URL,
        'fallbackImageUrl',
        true,
      ),
      tutorial_url: normalizedTutorialUrl(read(input, 'tutorialUrl')),
      ingredients: normalizedIngredients(read(input, 'ingredients')),
      instructions: normalizedMultilineText(
        read(input, 'instructions'),
        ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INSTRUCTIONS,
        'instructions',
      ),
      status: publication.status,
      source_type: 'cms',
      external_provider: null,
      external_id: null,
      created_by: normalizedCreatorUserId(read(context, 'creatorUserId')),
      published_at: publication.publishedAt,
    };
    return Object.freeze(normalized);
  } catch (error) {
    if (ISSUED_VALIDATION_ERRORS.has(error)) throw error;
    fail(ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT);
  }
}
