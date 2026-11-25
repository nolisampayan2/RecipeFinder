import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_RECIPE_STATUS,
  ADMIN_RECIPE_VALIDATION_ERROR,
  AdminRecipeValidationError,
  normalizeAdminRecipeInput,
} from '../js/admin-recipe-validation.js';

const CREATOR_ID = '11111111-1111-4111-8111-111111111111';
const PUBLISHED_AT = '2026-11-04T10:20:30.000Z';

function input(overrides = {}) {
  return {
    name: 'Chicken Adobo',
    description: 'A savory Filipino recipe.',
    categoryId: 1,
    cuisineId: 2,
    imageUrl: 'https://images.example.test/adobo.jpg',
    fallbackImageUrl: './assets/adobo-fallback.jpg',
    tutorialUrl: 'https://video.example.test/watch/adobo',
    ingredients: [
      { name: 'Chicken', measurement: '1 kilogram' },
      { name: 'Soy sauce', measurement: '1/2 cup' },
    ],
    instructions: 'Brown the chicken.\nSimmer until tender.',
    ...overrides,
  };
}

function context(overrides = {}) {
  return {
    recipeId: 'cms:11111111-2222-4333-8444-555555555555',
    creatorUserId: CREATOR_ID,
    status: ADMIN_RECIPE_STATUS.DRAFT,
    publishedAt: null,
    ...overrides,
  };
}

function expectCode(action, code, field = undefined) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof AdminRecipeValidationError, true);
    assert.equal(error.code, code);
    if (field !== undefined) assert.equal(error.field, field);
    assert.doesNotMatch(error.message, /secret|token|provider|password/i);
    return true;
  });
}

const draftInput = input();
const draftContext = context();
const draft = normalizeAdminRecipeInput(draftInput, draftContext);
assert.deepEqual(draft, {
  id: draftContext.recipeId,
  name: 'Chicken Adobo',
  description: 'A savory Filipino recipe.',
  category_id: 1,
  cuisine_id: 2,
  image_url: 'https://images.example.test/adobo.jpg',
  fallback_image_url: './assets/adobo-fallback.jpg',
  tutorial_url: 'https://video.example.test/watch/adobo',
  ingredients: [
    { name: 'Chicken', measurement: '1 kilogram' },
    { name: 'Soy sauce', measurement: '1/2 cup' },
  ],
  instructions: 'Brown the chicken.\nSimmer until tender.',
  status: 'draft',
  source_type: 'cms',
  external_provider: null,
  external_id: null,
  created_by: CREATOR_ID,
  published_at: null,
});
assert.equal(Object.isFrozen(draft), true);
assert.equal(Object.isFrozen(draft.ingredients), true);
assert.equal(draft.ingredients.every(Object.isFrozen), true);

const published = normalizeAdminRecipeInput(
  input({ fallbackImageUrl: '', tutorialUrl: null }),
  context({ status: ADMIN_RECIPE_STATUS.PUBLISHED, publishedAt: PUBLISHED_AT }),
);
assert.equal(published.status, 'published');
assert.equal(published.published_at, PUBLISHED_AT);
assert.equal(published.fallback_image_url, null);
assert.equal(published.tutorial_url, null);

for (const value of [null, undefined, [], 'recipe']) {
  expectCode(
    () => normalizeAdminRecipeInput(value, context()),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT,
  );
  expectCode(
    () => normalizeAdminRecipeInput(input(), value),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT,
  );
}

for (const field of [
  'name', 'description', 'categoryId', 'cuisineId', 'imageUrl',
  'fallbackImageUrl', 'tutorialUrl', 'ingredients', 'instructions',
]) {
  const missing = input();
  delete missing[field];
  expectCode(
    () => normalizeAdminRecipeInput(missing, context()),
    ADMIN_RECIPE_VALIDATION_ERROR.MISSING_FIELD,
    field,
  );
}

for (const [field, code] of [
  ['name', ADMIN_RECIPE_VALIDATION_ERROR.INVALID_NAME],
  ['description', ADMIN_RECIPE_VALIDATION_ERROR.INVALID_DESCRIPTION],
  ['instructions', ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INSTRUCTIONS],
]) {
  for (const value of ['', '   ', null, 42, `safe\u0000unsafe`]) {
    expectCode(() => normalizeAdminRecipeInput(input({ [field]: value }), context()), code, field);
  }
}

const nameAtLimit = 'n'.repeat(160);
assert.equal(normalizeAdminRecipeInput(input({ name: nameAtLimit }), context()).name.length, 160);
assert.equal(Array.from(normalizeAdminRecipeInput(input({ name: '🍲'.repeat(160) }), context()).name).length, 160);
expectCode(
  () => normalizeAdminRecipeInput(input({ name: 'n'.repeat(161) }), context()),
  ADMIN_RECIPE_VALIDATION_ERROR.INVALID_NAME,
  'name',
);
expectCode(
  () => normalizeAdminRecipeInput(input({ name: '🍲'.repeat(161) }), context()),
  ADMIN_RECIPE_VALIDATION_ERROR.INVALID_NAME,
  'name',
);
assert.equal(
  normalizeAdminRecipeInput(input({ categoryId: Number.MAX_SAFE_INTEGER }), context()).category_id,
  Number.MAX_SAFE_INTEGER,
);

for (const [field, code] of [
  ['categoryId', ADMIN_RECIPE_VALIDATION_ERROR.INVALID_CATEGORY_ID],
  ['cuisineId', ADMIN_RECIPE_VALIDATION_ERROR.INVALID_CUISINE_ID],
]) {
  for (const value of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, null]) {
    expectCode(() => normalizeAdminRecipeInput(input({ [field]: value }), context()), code, field);
  }
}

for (const ingredients of [
  [],
  null,
  'Chicken',
  [null],
  [{}],
  [{ name: '', measurement: '1 cup' }],
  [{ name: 'Rice', measurement: '' }],
  [{ name: 'Rice', measurement: '1 cup', unit: 'cup' }],
  [{ name: 'Rice\nFlour', measurement: '1 cup' }],
]) {
  expectCode(
    () => normalizeAdminRecipeInput(input({ ingredients }), context()),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INGREDIENTS,
    'ingredients',
  );
}

const sparseIngredients = new Array(2);
sparseIngredients[1] = { name: 'Salt', measurement: '1 teaspoon' };
expectCode(
  () => normalizeAdminRecipeInput(input({ ingredients: sparseIngredients }), context()),
  ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INGREDIENTS,
  'ingredients',
);

const hostileIngredient = {};
Object.defineProperty(hostileIngredient, 'name', {
  enumerable: true,
  get() { throw new Error('PRIVATE_HOSTILE_VALUE'); },
});
hostileIngredient.measurement = '1 cup';
expectCode(
  () => normalizeAdminRecipeInput(input({ ingredients: [hostileIngredient] }), context()),
  ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT,
);

const hostileInput = new Proxy({}, {
  ownKeys() { throw new Error('PRIVATE_KEYS'); },
});
expectCode(
  () => normalizeAdminRecipeInput(hostileInput, context()),
  ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT,
);

for (const hostileError of [
  Object.assign(Object.create(AdminRecipeValidationError.prototype), {
    message: 'PRIVATE_SPOOFED_MESSAGE',
    code: 'PRIVATE_SPOOFED_CODE',
    field: 'PRIVATE_SPOOFED_FIELD',
  }),
  new AdminRecipeValidationError(
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_NAME,
    'PRIVATE_EXTERNAL_FIELD',
  ),
]) {
  const hostileDescriptorInput = new Proxy(input(), {
    getOwnPropertyDescriptor() { throw hostileError; },
  });
  assert.throws(
    () => normalizeAdminRecipeInput(hostileDescriptorInput, context()),
    (error) => {
      assert.equal(error instanceof AdminRecipeValidationError, true);
      assert.equal(error.code, ADMIN_RECIPE_VALIDATION_ERROR.INVALID_INPUT);
      assert.equal(error.field, null);
      assert.doesNotMatch(
        `${error.message} ${error.code} ${error.field}`,
        /PRIVATE|SPOOFED|EXTERNAL/i,
      );
      return true;
    },
  );
}

for (const imageUrl of [
  'javascript:alert(1)',
  'data:image/png;base64,abc',
  '//example.test/image.jpg',
  'https://user:password@example.test/image.jpg',
  '../assets/image.jpg',
  ' https://example.test/image.jpg',
  'https://example.test/image.jpg\\evil',
  'https://[::1]/image.jpg',
  'https://bad_host.example/image.jpg',
  'https://-bad.example/image.jpg',
  'https://example.test/image.jpg?size=[large]',
  'https://example.test/image.jpg#[preview]',
]) {
  expectCode(
    () => normalizeAdminRecipeInput(input({ imageUrl }), context()),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_IMAGE_URL,
    'imageUrl',
  );
}
assert.equal(normalizeAdminRecipeInput(input({ imageUrl: 'assets/image.jpg' }), context()).image_url, 'assets/image.jpg');
assert.equal(normalizeAdminRecipeInput(input({ imageUrl: '/assets/image.jpg' }), context()).image_url, '/assets/image.jpg');
assert.equal(normalizeAdminRecipeInput(input({ imageUrl: 'http://images.example.test/image.jpg' }), context()).image_url, 'http://images.example.test/image.jpg');

for (const fallbackImageUrl of [
  'javascript:alert(1)',
  'https://user:password@example.test/fallback.jpg',
  '../assets/fallback.jpg',
  'https://[::1]/fallback.jpg',
  'https://bad_host.example/fallback.jpg',
  'https://-bad.example/fallback.jpg',
  'https://example.test/fallback.jpg?size=[large]',
  'https://example.test/fallback.jpg#[preview]',
]) {
  expectCode(
    () => normalizeAdminRecipeInput(input({ fallbackImageUrl }), context()),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_FALLBACK_IMAGE_URL,
    'fallbackImageUrl',
  );
}

for (const tutorialUrl of [
  'http://video.example.test/watch',
  'javascript:alert(1)',
  '/local/video',
  'https://user:password@video.example.test/watch',
  ' https://video.example.test/watch',
]) {
  expectCode(
    () => normalizeAdminRecipeInput(input({ tutorialUrl }), context()),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TUTORIAL_URL,
    'tutorialUrl',
  );
}

for (const status of ['archived', 'Draft', '', null]) {
  expectCode(
    () => normalizeAdminRecipeInput(input(), context({ status })),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_STATUS,
    'status',
  );
}

for (const badContext of [
  context({ status: 'draft', publishedAt: PUBLISHED_AT }),
  context({ status: 'published', publishedAt: null }),
  context({ status: 'published', publishedAt: '2026-11-04' }),
  context({ status: 'published', publishedAt: '2026-02-31T10:20:30.000Z' }),
  context({ status: 'published', publishedAt: '0000-01-01T00:00:00.000Z' }),
]) {
  expectCode(
    () => normalizeAdminRecipeInput(input(), badContext),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_TIMESTAMP,
    'publishedAt',
  );
}

for (const recipeId of ['', 'Bad ID', 'CMS:UPPER', `a${'b'.repeat(200)}`, null]) {
  expectCode(
    () => normalizeAdminRecipeInput(input(), context({ recipeId })),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_RECIPE_ID,
    'recipeId',
  );
}

for (const creatorUserId of ['', 'not-a-uuid', null, '11111111-1111-1111-1111-111111111111']) {
  expectCode(
    () => normalizeAdminRecipeInput(input(), context({ creatorUserId })),
    ADMIN_RECIPE_VALIDATION_ERROR.INVALID_CREATOR_ID,
    'creatorUserId',
  );
}

for (const field of ['created_by', 'createdBy', 'source_type', 'sourceType', 'external_provider', 'externalProvider', 'external_id', 'externalId']) {
  expectCode(
    () => normalizeAdminRecipeInput({ ...input(), [field]: 'attacker-controlled' }, context()),
    ADMIN_RECIPE_VALIDATION_ERROR.PROVENANCE_OVERRIDE,
    field,
  );
}

for (const field of ['id', 'recipeId', 'status', 'published_at', 'publishedAt']) {
  expectCode(
    () => normalizeAdminRecipeInput({ ...input(), [field]: 'attacker-controlled' }, context()),
    ADMIN_RECIPE_VALIDATION_ERROR.IMMUTABLE_FIELD,
    field,
  );
}

expectCode(
  () => normalizeAdminRecipeInput({ ...input(), unsupported: true }, context()),
  ADMIN_RECIPE_VALIDATION_ERROR.UNEXPECTED_FIELD,
);
expectCode(
  () => normalizeAdminRecipeInput(input(), { ...context(), sourceType: 'external' }),
  ADMIN_RECIPE_VALIDATION_ERROR.UNEXPECTED_FIELD,
);

const symbolInput = input();
symbolInput[Symbol('hidden')] = true;
expectCode(
  () => normalizeAdminRecipeInput(symbolInput, context()),
  ADMIN_RECIPE_VALIDATION_ERROR.UNEXPECTED_FIELD,
);

const immutableInput = input();
const immutableContext = context();
const immutableInputSnapshot = structuredClone(immutableInput);
const immutableContextSnapshot = structuredClone(immutableContext);
const normalizedImmutable = normalizeAdminRecipeInput(immutableInput, immutableContext);
assert.deepEqual(immutableInput, immutableInputSnapshot);
assert.deepEqual(immutableContext, immutableContextSnapshot);
assert.notEqual(normalizedImmutable.ingredients, immutableInput.ingredients);
assert.notEqual(normalizedImmutable.ingredients[0], immutableInput.ingredients[0]);

let providerCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  providerCalls += 1;
  throw new Error('Network access is forbidden in validation tests.');
};
try {
  normalizeAdminRecipeInput(input(), context());
} finally {
  globalThis.fetch = originalFetch;
}
assert.equal(providerCalls, 0);

const source = await readFile(new URL('../js/admin-recipe-validation.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /createClient|service_role|\bclient\s*\.\s*from\s*\(|\bclient\s*\.\s*rpc\s*\(|fetch\s*\(|XMLHttpRequest|document\.|window\.|localStorage|sessionStorage/i);

for (const liveFile of [
  '../app.js',
  '../js/admin-browser.js',
  '../js/admin-cms.js',
  '../js/supabase-admin-recipes.js',
]) {
  const liveSource = await readFile(new URL(liveFile, import.meta.url), 'utf8');
  assert.doesNotMatch(liveSource, /admin-recipe-validation\.js/);
}

console.log('Offline Admin recipe validation foundation tests passed without network or provider access.');
