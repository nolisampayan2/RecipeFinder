import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_RECIPE_MUTATION_SELECT,
  ADMIN_RECIPE_STATUS_MUTATION_SELECT,
  ADMIN_RECIPE_MUTATION_STATUS,
  createSupabaseAdminRecipeMutationService,
} from '../js/supabase-admin-recipe-mutations.js';

const RECIPE_ID = 'cms:11111111-2222-4333-8444-555555555555';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const UPDATED_AT = '2026-11-04T10:20:30.000Z';
const NEXT_UPDATED_AT = '2026-11-04T10:21:30.000Z';
const MICROSECOND_UPDATED_AT = '2026-11-04T10:20:30.987654+00:00';
const OFFSET_UPDATED_AT = '2026-11-04T18:20:30.123456+08:00';

function input(overrides = {}) {
  return {
    name: 'Draft Recipe',
    description: 'A safe draft.',
    categoryId: 1,
    cuisineId: 2,
    imageUrl: 'https://images.example.test/draft.jpg',
    fallbackImageUrl: null,
    tutorialUrl: null,
    ingredients: [{ name: 'Rice', measurement: '1 cup' }],
    instructions: 'Cook until ready.',
    ...overrides,
  };
}

function createContext(overrides = {}) {
  return { recipeId: RECIPE_ID, creatorUserId: USER_ID, ...overrides };
}

function editContext(overrides = {}) {
  return { recipeId: RECIPE_ID, creatorUserId: USER_ID, expectedUpdatedAt: UPDATED_AT, ...overrides };
}

function statusContext(overrides = {}) {
  return { recipeId: RECIPE_ID, expectedStatus: 'draft', expectedUpdatedAt: UPDATED_AT,
    desiredStatus: 'published', ...overrides };
}

function statusRow(overrides = {}) {
  return { id: RECIPE_ID, status: 'published', source_type: 'cms',
    published_at: NEXT_UPDATED_AT, updated_at: NEXT_UPDATED_AT, ...overrides };
}

function returnedRow(overrides = {}) {
  return {
    id: RECIPE_ID,
    status: 'draft',
    source_type: 'cms',
    created_by: USER_ID,
    updated_at: NEXT_UPDATED_AT,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function createHarness({ createResponse, editResponse } = {}) {
  const calls = [];
  let fromCalls = 0;
  const client = {
    from(tableName) {
      fromCalls += 1;
      calls.push(['from', tableName]);
      return {
        insert(payload) {
          calls.push(['insert', payload]);
          return {
            select(fields) {
              calls.push(['select', fields]);
              return {
                async single() {
                  calls.push(['single']);
                  return typeof createResponse === 'function' ? createResponse() : createResponse;
                },
              };
            },
          };
        },
        update(payload) {
          calls.push(['update', payload]);
          const builder = {
            eq(field, value) {
              calls.push(['eq', field, value]);
              return builder;
            },
            async select(fields) {
              calls.push(['select', fields]);
              return typeof editResponse === 'function' ? editResponse() : editResponse;
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, calls, fromCalls: () => fromCalls };
}

const createHarnessValid = createHarness({
  createResponse: { data: returnedRow(), error: null },
});
const createService = createSupabaseAdminRecipeMutationService(createHarnessValid.client);
const created = await createService.createDraft(input(), createContext());
assert.deepEqual(created, {
  status: ADMIN_RECIPE_MUTATION_STATUS.SUCCESS,
  data: {
    id: RECIPE_ID,
    status: 'draft',
    sourceType: 'cms',
    createdBy: USER_ID,
    updatedAt: NEXT_UPDATED_AT,
  },
  error: null,
});
assert.equal(Object.isFrozen(created), true);
assert.deepEqual(createHarnessValid.calls, [
  ['from', 'recipes'],
  ['insert', {
    id: RECIPE_ID,
    name: 'Draft Recipe',
    description: 'A safe draft.',
    category_id: 1,
    cuisine_id: 2,
    image_url: 'https://images.example.test/draft.jpg',
    fallback_image_url: null,
    tutorial_url: null,
    ingredients: [{ name: 'Rice', measurement: '1 cup' }],
    instructions: 'Cook until ready.',
    status: 'draft',
    source_type: 'cms',
    external_provider: null,
    external_id: null,
    created_by: USER_ID,
    published_at: null,
  }],
  ['select', ADMIN_RECIPE_MUTATION_SELECT],
  ['single'],
]);

const editHarnessValid = createHarness({
  editResponse: { data: [returnedRow()], error: null },
});
const edited = await createSupabaseAdminRecipeMutationService(editHarnessValid.client)
  .editDraft(input({ name: 'Updated Draft' }), editContext());
assert.equal(edited.status, ADMIN_RECIPE_MUTATION_STATUS.SUCCESS);
assert.deepEqual(editHarnessValid.calls, [
  ['from', 'recipes'],
  ['update', {
    name: 'Updated Draft',
    description: 'A safe draft.',
    category_id: 1,
    cuisine_id: 2,
    image_url: 'https://images.example.test/draft.jpg',
    fallback_image_url: null,
    tutorial_url: null,
    ingredients: [{ name: 'Rice', measurement: '1 cup' }],
    instructions: 'Cook until ready.',
  }],
  ['eq', 'id', RECIPE_ID],
  ['eq', 'updated_at', UPDATED_AT],
  ['eq', 'status', 'draft'],
  ['eq', 'source_type', 'cms'],
  ['select', ADMIN_RECIPE_MUTATION_SELECT],
]);
assert.equal(Object.prototype.hasOwnProperty.call(editHarnessValid.calls[1][1], 'id'), false);
assert.equal(Object.prototype.hasOwnProperty.call(editHarnessValid.calls[1][1], 'created_by'), false);
assert.equal(Object.prototype.hasOwnProperty.call(editHarnessValid.calls[1][1], 'status'), false);

const preciseCreateHarness = createHarness({
  createResponse: { data: returnedRow({ updated_at: MICROSECOND_UPDATED_AT }), error: null },
});
const preciseCreate = await createSupabaseAdminRecipeMutationService(preciseCreateHarness.client)
  .createDraft(input(), createContext());
assert.equal(preciseCreate.data.updatedAt, MICROSECOND_UPDATED_AT);

const preciseEditHarness = createHarness({
  editResponse: { data: [returnedRow({ updated_at: MICROSECOND_UPDATED_AT })], error: null },
});
const preciseEdit = await createSupabaseAdminRecipeMutationService(preciseEditHarness.client)
  .editDraft(input(), editContext({ expectedUpdatedAt: OFFSET_UPDATED_AT }));
assert.equal(preciseEdit.data.updatedAt, MICROSECOND_UPDATED_AT);
assert.deepEqual(
  preciseEditHarness.calls.filter((call) => call[0] === 'eq' && call[1] === 'updated_at'),
  [['eq', 'updated_at', OFFSET_UPDATED_AT]],
  'The exact provider concurrency token must reach the UPDATE predicate unchanged',
);

const invalidHarness = createHarness();
const invalidService = createSupabaseAdminRecipeMutationService(invalidHarness.client);
assert.equal(
  (await invalidService.createDraft({ ...input(), id: 'attacker' }, createContext())).status,
  ADMIN_RECIPE_MUTATION_STATUS.INVALID,
);
assert.equal(
  (await invalidService.editDraft(input(), editContext({ expectedUpdatedAt: 'invalid' }))).status,
  ADMIN_RECIPE_MUTATION_STATUS.INVALID,
);
for (const malformedTimestamp of [
  '2026-02-30T10:20:30.000Z',
  '2026-11-04T10:20:30.1234567Z',
  '2026-11-04T10:20:30.000+14:01',
  ' 2026-11-04T10:20:30.000Z',
]) {
  assert.equal(
    (await invalidService.editDraft(input(), editContext({ expectedUpdatedAt: malformedTimestamp }))).status,
    ADMIN_RECIPE_MUTATION_STATUS.INVALID,
  );
}
assert.equal(
  (await invalidService.createDraft(input(), { ...createContext(), status: 'published' })).status,
  ADMIN_RECIPE_MUTATION_STATUS.INVALID,
);
assert.equal(invalidHarness.fromCalls(), 0, 'Invalid input must not reach the provider');

const conflictHarness = createHarness({ editResponse: { data: [], error: null } });
assert.equal(
  (await createSupabaseAdminRecipeMutationService(conflictHarness.client).editDraft(input(), editContext())).status,
  ADMIN_RECIPE_MUTATION_STATUS.CONFLICT,
);

for (const operation of ['create', 'edit']) {
  const deniedHarness = createHarness({
    createResponse: { data: null, error: { code: '42501', message: 'PRIVATE_DENIAL' } },
    editResponse: { data: null, error: { code: '42501', message: 'PRIVATE_DENIAL' } },
  });
  const service = createSupabaseAdminRecipeMutationService(deniedHarness.client);
  const result = operation === 'create'
    ? await service.createDraft(input(), createContext())
    : await service.editDraft(input(), editContext());
  assert.equal(result.status, ADMIN_RECIPE_MUTATION_STATUS.DENIED);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DENIAL|42501/);
}

for (const response of [
  null,
  {},
  { data: returnedRow(), error: { code: '23505', message: 'PRIVATE_DUPLICATE' } },
  { data: returnedRow({ id: 'cms:wrong' }), error: null },
  { data: returnedRow({ status: 'published' }), error: null },
  { data: returnedRow({ updated_at: 'bad' }), error: null },
  { data: returnedRow({ updated_at: '2026-11-31T10:20:30.000Z' }), error: null },
]) {
  const malformed = createHarness({ createResponse: response });
  const result = await createSupabaseAdminRecipeMutationService(malformed.client)
    .createDraft(input(), createContext());
  assert.equal(result.status, ADMIN_RECIPE_MUTATION_STATUS.UNCERTAIN);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|23505/);
}

for (const response of [
  null,
  {},
  { data: null, error: null },
  { data: [returnedRow(), returnedRow()], error: null },
  { data: [returnedRow({ source_type: 'seed' })], error: null },
]) {
  const malformed = createHarness({ editResponse: response });
  const result = await createSupabaseAdminRecipeMutationService(malformed.client)
    .editDraft(input(), editContext());
  assert.equal(result.status, ADMIN_RECIPE_MUTATION_STATUS.UNCERTAIN);
}

const exceptionHarness = createHarness({
  createResponse() { throw new Error('PRIVATE_NETWORK_ERROR'); },
  editResponse() { return Promise.reject(new Error('PRIVATE_NETWORK_ERROR')); },
});
const exceptionService = createSupabaseAdminRecipeMutationService(exceptionHarness.client);
assert.equal((await exceptionService.createDraft(input(), createContext())).status, ADMIN_RECIPE_MUTATION_STATUS.UNCERTAIN);
assert.equal((await exceptionService.editDraft(input(), editContext())).status, ADMIN_RECIPE_MUTATION_STATUS.UNCERTAIN);

const duplicateRequest = deferred();
const duplicateHarness = createHarness({ createResponse: () => duplicateRequest.promise });
const duplicateService = createSupabaseAdminRecipeMutationService(duplicateHarness.client);
const firstCreate = duplicateService.createDraft(input(), createContext());
const secondCreate = duplicateService.createDraft(input({ name: 'Ignored Concurrent Change' }), createContext());
assert.equal(firstCreate, secondCreate, 'Concurrent operations for one recipe must share one request');
await Promise.resolve();
assert.equal(duplicateHarness.fromCalls(), 1);
duplicateRequest.resolve({ data: returnedRow(), error: null });
assert.equal((await firstCreate).status, ADMIN_RECIPE_MUTATION_STATUS.SUCCESS);

const staleRequest = deferred();
const staleHarness = createHarness({ editResponse: () => staleRequest.promise });
const staleService = createSupabaseAdminRecipeMutationService(staleHarness.client);
const staleEdit = staleService.editDraft(input(), editContext());
await Promise.resolve();
assert.equal(staleService.invalidate(), true);
staleRequest.resolve({ data: [returnedRow()], error: null });
assert.equal((await staleEdit).status, ADMIN_RECIPE_MUTATION_STATUS.STALE);

const cleanupRequest = deferred();
const cleanupHarness = createHarness({ createResponse: () => cleanupRequest.promise });
const cleanupService = createSupabaseAdminRecipeMutationService(cleanupHarness.client);
const cleanupCreate = cleanupService.createDraft(input(), createContext());
await Promise.resolve();
assert.equal(cleanupService.cleanup(), true);
cleanupRequest.resolve({ data: returnedRow(), error: null });
assert.equal((await cleanupCreate).status, ADMIN_RECIPE_MUTATION_STATUS.STALE);
assert.equal(cleanupService.cleanup(), false);
assert.equal(
  (await cleanupService.createDraft(input(), createContext())).status,
  ADMIN_RECIPE_MUTATION_STATUS.STALE,
);

assert.throws(
  () => createSupabaseAdminRecipeMutationService(null),
  /compatible Supabase Admin recipe mutation client/i,
);

const publishHarness = createHarness({ editResponse: { data: [statusRow()], error: null } });
const published = await createSupabaseAdminRecipeMutationService(publishHarness.client)
  .transitionStatus(statusContext());
assert.equal(published.status, ADMIN_RECIPE_MUTATION_STATUS.SUCCESS);
assert.deepEqual(published.data, { id: RECIPE_ID, status: 'published', sourceType: 'cms',
  publishedAt: NEXT_UPDATED_AT, updatedAt: NEXT_UPDATED_AT });
assert.equal(Object.isFrozen(published.data), true);
assert.deepEqual(publishHarness.calls.map((call) => call[0]),
  ['from', 'update', 'eq', 'eq', 'eq', 'eq', 'select']);
assert.equal(publishHarness.calls[1][1].status, 'published');
assert.match(publishHarness.calls[1][1].published_at,
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
assert.deepEqual(publishHarness.calls.slice(2, 6), [
  ['eq', 'id', RECIPE_ID], ['eq', 'updated_at', UPDATED_AT],
  ['eq', 'status', 'draft'], ['eq', 'source_type', 'cms'],
]);
assert.deepEqual(publishHarness.calls[6], ['select', ADMIN_RECIPE_STATUS_MUTATION_SELECT]);
assert.doesNotMatch(ADMIN_RECIPE_STATUS_MUTATION_SELECT, /ingredients|instructions|tutorial_url|created_by/);

const unpublishHarness = createHarness({ editResponse: { data: [statusRow({ status: 'draft', published_at: null })], error: null } });
const unpublished = await createSupabaseAdminRecipeMutationService(unpublishHarness.client)
  .transitionStatus(statusContext({ expectedStatus: 'published', desiredStatus: 'draft' }));
assert.equal(unpublished.status, ADMIN_RECIPE_MUTATION_STATUS.SUCCESS);
assert.deepEqual(unpublishHarness.calls[1], ['update', { status: 'draft', published_at: null }]);
assert.deepEqual(unpublishHarness.calls[4], ['eq', 'status', 'published']);

const invalidStatusHarness = createHarness();
const invalidStatusService = createSupabaseAdminRecipeMutationService(invalidStatusHarness.client);
for (const invalid of [
  statusContext({ recipeId: 'Bad ID' }), statusContext({ recipeId: 'external:fictional-offline:1' }),
  statusContext({ expectedStatus: 'published', desiredStatus: 'published' }),
  statusContext({ expectedStatus: 'draft', desiredStatus: 'draft' }),
  statusContext({ expectedStatus: 'archived' }), statusContext({ desiredStatus: 'archived' }),
  statusContext({ expectedUpdatedAt: 'bad' }), { ...statusContext(), extra: 'unexpected' },
  null,
]) assert.equal((await invalidStatusService.transitionStatus(invalid)).status, ADMIN_RECIPE_MUTATION_STATUS.INVALID);
assert.equal(invalidStatusHarness.fromCalls(), 0);

const statusConflictHarness = createHarness({ editResponse: { data: [], error: null } });
assert.equal((await createSupabaseAdminRecipeMutationService(statusConflictHarness.client)
  .transitionStatus(statusContext())).status, ADMIN_RECIPE_MUTATION_STATUS.CONFLICT);
for (const response of [
  { data: null, error: { code: '23514', message: 'PRIVATE_TAXONOMY_FAILURE' } },
  { data: [statusRow({ source_type: 'seed' })], error: null },
  { data: [statusRow({ id: 'cms:wrong' })], error: null },
  { data: [statusRow({ published_at: null })], error: null },
  { data: [statusRow(), statusRow()], error: null },
]) {
  const result = await createSupabaseAdminRecipeMutationService(createHarness({ editResponse: response }).client)
    .transitionStatus(statusContext());
  assert.equal(result.status, ADMIN_RECIPE_MUTATION_STATUS.UNCERTAIN);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TAXONOMY_FAILURE|23514/);
}
const statusDenied = await createSupabaseAdminRecipeMutationService(createHarness({
  editResponse: { data: null, error: { code: '42501', message: 'PRIVATE_DENIAL' } },
}).client).transitionStatus(statusContext());
assert.equal(statusDenied.status, ADMIN_RECIPE_MUTATION_STATUS.DENIED);
assert.doesNotMatch(JSON.stringify(statusDenied), /PRIVATE_DENIAL/);

const pendingStatusResponse = deferred();
const pendingStatusHarness = createHarness({ editResponse: () => pendingStatusResponse.promise });
const pendingStatusService = createSupabaseAdminRecipeMutationService(pendingStatusHarness.client);
const pendingPublish = pendingStatusService.transitionStatus(statusContext());
assert.equal((await pendingStatusService.transitionStatus(statusContext())).status,
  ADMIN_RECIPE_MUTATION_STATUS.CONFLICT);
await Promise.resolve();
assert.equal(pendingStatusHarness.fromCalls(), 1);
pendingStatusService.invalidate();
pendingStatusResponse.resolve({ data: [statusRow()], error: null });
assert.equal((await pendingPublish).status, ADMIN_RECIPE_MUTATION_STATUS.STALE);

for (const [operation, invoke] of [
  ['status', (service) => service.transitionStatus(statusContext())],
  ['create', (service) => service.createDraft(input(), createContext())],
  ['edit', (service) => service.editDraft(input(), editContext())],
]) {
  const harness = createHarness({
    createResponse: { data: returnedRow(), error: null },
    editResponse: { data: [operation === 'status' ? statusRow() : returnedRow()], error: null },
  });
  const service = createSupabaseAdminRecipeMutationService(harness.client);
  const pendingBeforeInvalidation = invoke(service);
  assert.equal(service.invalidate(), true);
  assert.equal((await pendingBeforeInvalidation).status, ADMIN_RECIPE_MUTATION_STATUS.STALE,
    `${operation} invalidation before dispatch must fail stale`);
  assert.equal(harness.fromCalls(), 0, `${operation} must never reach the provider after invalidation`);
  assert.equal((await invoke(service)).status, ADMIN_RECIPE_MUTATION_STATUS.SUCCESS,
    `${operation} must work again in the current generation`);
  assert.equal(harness.fromCalls(), 1);
}

const preCleanupHarness = createHarness({ editResponse: { data: [statusRow()], error: null } });
const preCleanupService = createSupabaseAdminRecipeMutationService(preCleanupHarness.client);
const preCleanupPublish = preCleanupService.transitionStatus(statusContext());
assert.equal(preCleanupService.cleanup(), true);
assert.equal((await preCleanupPublish).status, ADMIN_RECIPE_MUTATION_STATUS.STALE);
assert.equal(preCleanupHarness.fromCalls(), 0, 'Cleanup before dispatch must prevent provider access');
assert.equal((await preCleanupService.transitionStatus(statusContext())).status, ADMIN_RECIPE_MUTATION_STATUS.STALE);
assert.equal(preCleanupHarness.fromCalls(), 0);

const source = await readFile(new URL('../js/supabase-admin-recipe-mutations.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /createClient|service_role|\btable\s*\.\s*upsert\s*\(|\btable\s*\.\s*delete\s*\(/i);
assert.match(source, /\.insert\s*\(/);
assert.match(source, /\.update\s*\(/);

console.log('Offline Admin draft mutation service tests passed with fake clients only.');
