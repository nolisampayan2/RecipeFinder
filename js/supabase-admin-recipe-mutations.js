import {
  ADMIN_RECIPE_STATUS,
  AdminRecipeValidationError,
  normalizeAdminRecipeInput,
} from './admin-recipe-validation.js';

const RECIPE_ID = /^[a-z0-9][a-z0-9:_-]{0,199}$/;
const USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONCURRENCY_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const CREATE_CONTEXT_FIELDS = Object.freeze(['recipeId', 'creatorUserId']);
const EDIT_CONTEXT_FIELDS = Object.freeze(['recipeId', 'creatorUserId', 'expectedUpdatedAt']);

export const ADMIN_RECIPE_MUTATION_SELECT = [
  'id',
  'status',
  'source_type',
  'created_by',
  'updated_at',
].join(',');

export const ADMIN_RECIPE_MUTATION_STATUS = Object.freeze({
  SUCCESS: 'success',
  INVALID: 'invalid',
  CONFLICT: 'conflict',
  DENIED: 'denied',
  UNCERTAIN: 'uncertain',
  STALE: 'stale',
});

const FIXED_RESULTS = Object.freeze({
  INVALID: Object.freeze({
    status: ADMIN_RECIPE_MUTATION_STATUS.INVALID,
    data: null,
    error: Object.freeze({ code: 'invalid', message: 'Recipe input is invalid.', field: null }),
  }),
  CONFLICT: Object.freeze({
    status: ADMIN_RECIPE_MUTATION_STATUS.CONFLICT,
    data: null,
    error: Object.freeze({ code: 'conflict', message: 'The recipe changed before it could be saved.', field: null }),
  }),
  DENIED: Object.freeze({
    status: ADMIN_RECIPE_MUTATION_STATUS.DENIED,
    data: null,
    error: Object.freeze({ code: 'denied', message: 'Recipe changes are not authorized.', field: null }),
  }),
  UNCERTAIN: Object.freeze({
    status: ADMIN_RECIPE_MUTATION_STATUS.UNCERTAIN,
    data: null,
    error: Object.freeze({ code: 'uncertain', message: 'The recipe outcome is uncertain. Reload before trying again.', field: null }),
  }),
  STALE: Object.freeze({
    status: ADMIN_RECIPE_MUTATION_STATUS.STALE,
    data: null,
    error: Object.freeze({ code: 'stale', message: 'The recipe result is no longer current.', field: null }),
  }),
});

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function requireClient(client) {
  let from;
  try {
    from = client?.from;
  } catch {
    throw new TypeError('A compatible Supabase Admin recipe mutation client is required.');
  }
  if (typeof from !== 'function') {
    throw new TypeError('A compatible Supabase Admin recipe mutation client is required.');
  }
  return from;
}

function invalidResult(error = null) {
  if (!(error instanceof AdminRecipeValidationError)) return FIXED_RESULTS.INVALID;
  return Object.freeze({
    status: ADMIN_RECIPE_MUTATION_STATUS.INVALID,
    data: null,
    error: Object.freeze({
      code: 'invalid',
      message: 'Recipe input is invalid.',
      field: typeof error.field === 'string' ? error.field : null,
    }),
  });
}

function snapshotContext(value, fields) {
  if (!isRecord(value)) throw new TypeError('Invalid mutation context.');
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError('Invalid mutation context.');
  }
  if (
    keys.length !== fields.length
    || !keys.every((key) => typeof key === 'string' && fields.includes(key))
  ) throw new TypeError('Invalid mutation context.');
  const snapshot = {};
  for (const field of fields) {
    if (!hasOwn(value, field)) throw new TypeError('Invalid mutation context.');
    try {
      snapshot[field] = value[field];
    } catch {
      throw new TypeError('Invalid mutation context.');
    }
  }
  return Object.freeze(snapshot);
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid concurrency timestamp.');
  }
  const match = CONCURRENCY_TIMESTAMP.exec(value);
  if (!match) throw new TypeError('Invalid concurrency timestamp.');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year === 0
    || month < 1
    || month > 12
    || day < 1
    || day > monthLengths[month - 1]
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new TypeError('Invalid concurrency timestamp.');
  }
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      throw new TypeError('Invalid concurrency timestamp.');
    }
  }
  return value;
}

function normalizedContext(input, rawContext, editing) {
  const context = snapshotContext(rawContext, editing ? EDIT_CONTEXT_FIELDS : CREATE_CONTEXT_FIELDS);
  const normalized = normalizeAdminRecipeInput(input, {
    recipeId: context.recipeId,
    creatorUserId: context.creatorUserId,
    status: ADMIN_RECIPE_STATUS.DRAFT,
    publishedAt: null,
  });
  return Object.freeze({
    normalized,
    creatorUserId: normalized.created_by,
    expectedUpdatedAt: editing ? normalizeTimestamp(context.expectedUpdatedAt) : null,
  });
}

function createPayload(normalized) {
  return Object.freeze({
    id: normalized.id,
    name: normalized.name,
    description: normalized.description,
    category_id: normalized.category_id,
    cuisine_id: normalized.cuisine_id,
    image_url: normalized.image_url,
    fallback_image_url: normalized.fallback_image_url,
    tutorial_url: normalized.tutorial_url,
    ingredients: normalized.ingredients,
    instructions: normalized.instructions,
    status: ADMIN_RECIPE_STATUS.DRAFT,
    source_type: 'cms',
    external_provider: null,
    external_id: null,
    created_by: normalized.created_by,
    published_at: null,
  });
}

function updatePayload(normalized) {
  return Object.freeze({
    name: normalized.name,
    description: normalized.description,
    category_id: normalized.category_id,
    cuisine_id: normalized.cuisine_id,
    image_url: normalized.image_url,
    fallback_image_url: normalized.fallback_image_url,
    tutorial_url: normalized.tutorial_url,
    ingredients: normalized.ingredients,
    instructions: normalized.instructions,
  });
}

function isExplicitResponse(response) {
  return isRecord(response) && hasOwn(response, 'data') && hasOwn(response, 'error');
}

function isAuthorizationError(error) {
  try {
    return isRecord(error) && error.code === '42501';
  } catch {
    return false;
  }
}

function normalizeReturnedTimestamp(value) {
  return normalizeTimestamp(value);
}

function normalizeMutationRow(row, expectedId, expectedCreator = null) {
  if (!isRecord(row)) throw new TypeError('Invalid mutation row.');
  for (const field of ['id', 'status', 'source_type', 'created_by', 'updated_at']) {
    if (!hasOwn(row, field)) throw new TypeError('Incomplete mutation row.');
  }
  let id;
  let status;
  let sourceType;
  let creator;
  let updatedAt;
  try {
    ({ id, status, source_type: sourceType, created_by: creator, updated_at: updatedAt } = row);
  } catch {
    throw new TypeError('Invalid mutation row.');
  }
  if (id !== expectedId || !RECIPE_ID.test(id)) throw new TypeError('Unexpected recipe ID.');
  if (status !== ADMIN_RECIPE_STATUS.DRAFT || sourceType !== 'cms') {
    throw new TypeError('Unexpected recipe state.');
  }
  if (typeof creator !== 'string' || !USER_UUID.test(creator)) {
    throw new TypeError('Unexpected recipe creator.');
  }
  const normalizedCreator = creator.toLowerCase();
  if (expectedCreator !== null && normalizedCreator !== expectedCreator) {
    throw new TypeError('Unexpected recipe creator.');
  }
  return Object.freeze({
    id,
    status,
    sourceType,
    createdBy: normalizedCreator,
    updatedAt: normalizeReturnedTimestamp(updatedAt),
  });
}

function successResult(data) {
  return Object.freeze({ status: ADMIN_RECIPE_MUTATION_STATUS.SUCCESS, data, error: null });
}

export function createSupabaseAdminRecipeMutationService(client) {
  const from = requireClient(client);
  let generation = 0;
  let retired = false;
  const pending = new Map();

  const runOwned = (recipeId, operation) => {
    if (retired) return Promise.resolve(FIXED_RESULTS.STALE);
    if (pending.has(recipeId)) return pending.get(recipeId);
    const operationGeneration = generation;
    const attempt = Promise.resolve()
      .then(operation)
      .catch(() => FIXED_RESULTS.UNCERTAIN)
      .then((result) => (
        retired || generation !== operationGeneration ? FIXED_RESULTS.STALE : result
      ))
      .finally(() => {
        if (pending.get(recipeId) === attempt) pending.delete(recipeId);
      });
    pending.set(recipeId, attempt);
    return attempt;
  };

  return Object.freeze({
    createDraft(input, context) {
      let prepared;
      try {
        prepared = normalizedContext(input, context, false);
      } catch (error) {
        return Promise.resolve(invalidResult(error));
      }
      const { normalized, creatorUserId } = prepared;
      return runOwned(normalized.id, async () => {
        let response;
        try {
          const table = from.call(client, 'recipes');
          if (!isRecord(table) || typeof table.insert !== 'function') return FIXED_RESULTS.UNCERTAIN;
          const inserted = table.insert(createPayload(normalized));
          if (!isRecord(inserted) || typeof inserted.select !== 'function') return FIXED_RESULTS.UNCERTAIN;
          const selected = inserted.select(ADMIN_RECIPE_MUTATION_SELECT);
          if (!isRecord(selected) || typeof selected.single !== 'function') return FIXED_RESULTS.UNCERTAIN;
          response = await selected.single();
        } catch {
          return FIXED_RESULTS.UNCERTAIN;
        }
        if (!isExplicitResponse(response)) return FIXED_RESULTS.UNCERTAIN;
        if (response.error !== null) {
          return isAuthorizationError(response.error) ? FIXED_RESULTS.DENIED : FIXED_RESULTS.UNCERTAIN;
        }
        try {
          return successResult(normalizeMutationRow(response.data, normalized.id, creatorUserId));
        } catch {
          return FIXED_RESULTS.UNCERTAIN;
        }
      });
    },

    editDraft(input, context) {
      let prepared;
      try {
        prepared = normalizedContext(input, context, true);
      } catch (error) {
        return Promise.resolve(invalidResult(error));
      }
      const { normalized, expectedUpdatedAt } = prepared;
      return runOwned(normalized.id, async () => {
        let response;
        try {
          const table = from.call(client, 'recipes');
          if (!isRecord(table) || typeof table.update !== 'function') return FIXED_RESULTS.UNCERTAIN;
          const updated = table.update(updatePayload(normalized));
          if (!isRecord(updated) || typeof updated.eq !== 'function') return FIXED_RESULTS.UNCERTAIN;
          const byId = updated.eq('id', normalized.id);
          if (!isRecord(byId) || typeof byId.eq !== 'function') return FIXED_RESULTS.UNCERTAIN;
          const byTimestamp = byId.eq('updated_at', expectedUpdatedAt);
          if (!isRecord(byTimestamp) || typeof byTimestamp.eq !== 'function') return FIXED_RESULTS.UNCERTAIN;
          const byStatus = byTimestamp.eq('status', ADMIN_RECIPE_STATUS.DRAFT);
          if (!isRecord(byStatus) || typeof byStatus.eq !== 'function') return FIXED_RESULTS.UNCERTAIN;
          const bySource = byStatus.eq('source_type', 'cms');
          if (!isRecord(bySource) || typeof bySource.select !== 'function') return FIXED_RESULTS.UNCERTAIN;
          response = await bySource.select(ADMIN_RECIPE_MUTATION_SELECT);
        } catch {
          return FIXED_RESULTS.UNCERTAIN;
        }
        if (!isExplicitResponse(response)) return FIXED_RESULTS.UNCERTAIN;
        if (response.error !== null) {
          return isAuthorizationError(response.error) ? FIXED_RESULTS.DENIED : FIXED_RESULTS.UNCERTAIN;
        }
        if (!Array.isArray(response.data)) return FIXED_RESULTS.UNCERTAIN;
        if (response.data.length === 0) return FIXED_RESULTS.CONFLICT;
        if (response.data.length !== 1 || !hasOwn(response.data, 0)) return FIXED_RESULTS.UNCERTAIN;
        try {
          return successResult(normalizeMutationRow(response.data[0], normalized.id));
        } catch {
          return FIXED_RESULTS.UNCERTAIN;
        }
      });
    },

    invalidate() {
      if (retired) return false;
      generation += 1;
      pending.clear();
      return true;
    },

    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      pending.clear();
      return true;
    },
  });
}
