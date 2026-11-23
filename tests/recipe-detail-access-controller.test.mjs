import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';
import {
  RECIPE_DETAIL_RESULT,
  createRecipeDetailAccessController,
} from '../js/recipe-detail-access-controller.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const modulePath = 'js/recipe-detail-access-controller.js';
const USER_A = '123e4567-e89b-42d3-a456-426614174000';
const USER_B = '223e4567-e89b-42d3-a456-426614174000';
const AUTH_A = Object.freeze({ status: 'authenticated', userId: USER_A });
const AUTH_B = Object.freeze({ status: 'authenticated', userId: USER_B });
const GUEST = Object.freeze({ status: 'guest', userId: null });

const builtIn = Object.freeze({
  id: 'creamy-garlic-pasta', source: 'built-in', detailLevel: 'preview', name: 'Creamy Garlic Pasta',
});
const seed = Object.freeze({
  id: 'seed-adobo', source: 'database', databaseSourceType: 'seed', detailLevel: 'preview', name: 'Seed Adobo',
});
const cms = Object.freeze({
  id: 'cms:11111111-2222-4333-8444-555555555555', source: 'database', databaseSourceType: 'cms',
  detailLevel: 'preview', name: 'CMS Adobo',
});
const fictional = Object.freeze({
  id: 'external:fictional-offline:990001', source: 'external', externalProvider: 'fictional-offline',
  externalId: '990001', detailLevel: 'summary', name: 'Aurora Garden Couscous',
});
const mealDb = Object.freeze({
  id: 'external:themealdb:52772', source: 'external', externalProvider: 'themealdb',
  externalId: '52772', detailLevel: 'full', name: 'Teriyaki Chicken Casserole', category: 'Chicken',
  cuisine: 'Japanese', image: 'https://www.themealdb.com/images/media/meals/wvpsxx1468256321.jpg',
  description: 'A public external recipe.', ingredients: Object.freeze([Object.freeze(['Chicken', '2 cups'])]),
  instructions: 'Cook thoroughly.', tutorial: 'https://www.youtube.com/watch?v=example',
});

function fullDetail(id, overrides = {}) {
  const fictionalId = /^external:fictional-offline:(\d+)$/.exec(id);
  const databaseSourceType = fictionalId ? 'external' : id.startsWith('cms:') ? 'cms' : 'seed';
  const detail = {
    id,
    source: 'database',
    databaseSourceType,
    name: 'Protected detail',
    category: 'Dinner',
    cuisine: 'Filipino',
    image: 'assets/recipe-placeholder.svg',
    fallbackImage: '',
    description: 'Protected database detail.',
    ingredients: Object.freeze([Object.freeze(['Ingredient', '1 cup'])]),
    instructions: 'Cook thoroughly.',
    tutorial: '',
    ...(fictionalId ? { externalProvider: 'fictional-offline', externalId: fictionalId[1] } : {}),
    ...overrides,
  };
  return Object.freeze(detail);
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return Object.freeze({ promise, resolve: resolvePromise, reject: rejectPromise });
}

function fixture({ getPublishedById } = {}) {
  const calls = { open: [], close: [], gateCleanup: 0, details: [], invalidations: 0, detailCleanup: 0, clears: 0 };
  const loginGate = {
    open(value) { calls.open.push(value); return true; },
    close(value) { calls.close.push(value); return true; },
    cleanup() { calls.gateCleanup += 1; return true; },
  };
  const detailService = {
    getPublishedById(id, auth) {
      calls.details.push({ id, auth });
      return getPublishedById
        ? getPublishedById(id, auth)
        : Promise.resolve({ data: fullDetail(id), error: null, stale: false });
    },
    invalidate() { calls.invalidations += 1; return true; },
    cleanup() { calls.detailCleanup += 1; return true; },
  };
  const controller = createRecipeDetailAccessController({
    loginGate,
    detailService,
    clearProtectedDetail() { calls.clears += 1; },
  });
  return { controller, calls, loginGate, detailService };
}

for (const authState of [GUEST, AUTH_A, { status: 'loading' }, { status: 'pending-confirmation' }, { status: 'error' }]) {
  const test = fixture();
  test.controller.handleAuthState(authState);
  const result = await test.controller.requestDetail({ recipe: mealDb, trigger: null });
  assert.equal(result.status, RECIPE_DETAIL_RESULT.PUBLIC_EXTERNAL_DETAIL);
  assert.notEqual(result.data, mealDb);
  assert.deepEqual(result.data, mealDb);
  assert.equal(Object.isFrozen(result.data), true);
  assert.equal(Object.isFrozen(result.data.ingredients), true);
  assert.equal(Object.isFrozen(result.data.ingredients[0]), true);
  assert.equal(Object.prototype.hasOwnProperty.call(result.data, 'fallbackImage'), false);
  assert.equal(result.error, null);
  assert.equal(result.stale, false);
  assert.equal(test.calls.details.length, 0);
  assert.ok(test.calls.clears >= 1);
}

for (const forged of [
  { ...mealDb, externalId: '1' },
  { ...mealDb, externalProvider: 'unknown' },
  { ...mealDb, source: 'database' },
  { ...mealDb, detailLevel: 'summary' },
]) {
  const test = fixture();
  test.controller.handleAuthState(AUTH_A);
  assert.equal((await test.controller.requestDetail({ recipe: forged })).status, RECIPE_DETAIL_RESULT.DENIED);
  assert.equal(test.calls.details.length, 0);
}

{
  const test = fixture();
  test.controller.handleAuthState(GUEST);
  const trigger = Object.freeze({ id: 'recipe-trigger' });
  const guestResult = await test.controller.requestDetail({ recipe: cms, trigger });
  assert.equal(guestResult.status, RECIPE_DETAIL_RESULT.LOGIN_REQUIRED);
  assert.equal(test.calls.open.length, 1);
  assert.equal(test.calls.open[0].recipe.id, cms.id);
  assert.equal(test.calls.open[0].recipe.source, cms.source);
  assert.equal(test.calls.open[0].recipe.name, cms.name);
  assert.equal(test.calls.open[0].trigger, trigger);
  assert.ok(test.calls.clears >= 2, 'Guest prompting must clear previously rendered protected content');
  assert.equal(test.calls.details.length, 0);
}

for (const state of [{ status: 'loading' }, { status: 'pending-confirmation' }]) {
  const test = fixture();
  test.controller.handleAuthState(state);
  const pending = await test.controller.requestDetail({ recipe: cms });
  assert.equal(pending.status, RECIPE_DETAIL_RESULT.PENDING_AUTH);
  assert.equal(pending.data, null);
  assert.equal(test.calls.details.length, 0);
}

for (const state of [{ status: 'error' }, null, {}, { status: 'authenticated', userId: 'bad' }]) {
  const test = fixture();
  test.controller.handleAuthState(state);
  const denied = await test.controller.requestDetail({ recipe: cms });
  assert.equal(denied.status, RECIPE_DETAIL_RESULT.DENIED);
  assert.equal(denied.data, null);
  assert.equal(test.calls.details.length, 0);
}

for (const recipe of [builtIn, seed, cms, fictional]) {
  const test = fixture();
  assert.equal(test.controller.handleAuthState(AUTH_A), true);
  const protectedResult = await test.controller.requestDetail({ recipe });
  assert.equal(protectedResult.status, RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
  assert.equal(protectedResult.data.id, recipe.id);
  assert.deepEqual(test.calls.details, [{ id: recipe.id, auth: AUTH_A }]);
}

{
  const pending = deferred();
  const test = fixture({ getPublishedById: () => pending.promise });
  test.controller.handleAuthState(AUTH_A);
  const first = test.controller.requestDetail({ recipe: cms });
  const duplicate = test.controller.requestDetail({ recipe: cms });
  assert.equal(first, duplicate);
  assert.equal(test.calls.details.length, 1, 'Pending ownership must suppress duplicate provider access');
  pending.resolve({ data: fullDetail(cms.id), error: null, stale: false });
  assert.equal((await first).status, RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
  const nextRequest = test.controller.requestDetail({ recipe: cms });
  assert.notEqual(nextRequest, first, 'Completed protected results must not remain in the pending slot');
  assert.equal((await nextRequest).status, RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
  assert.equal(test.calls.details.length, 2);
}

{
  const firstPending = deferred();
  const secondPending = deferred();
  let call = 0;
  const test = fixture({ getPublishedById: () => (call++ === 0 ? firstPending.promise : secondPending.promise) });
  test.controller.handleAuthState(AUTH_A);
  const first = test.controller.requestDetail({ recipe: seed });
  await Promise.resolve();
  const second = test.controller.requestDetail({ recipe: cms });
  await Promise.resolve();
  firstPending.resolve({ data: fullDetail(seed.id), error: null, stale: false });
  secondPending.resolve({ data: fullDetail(cms.id), error: null, stale: false });
  assert.equal((await first).status, RECIPE_DETAIL_RESULT.STALE);
  assert.equal((await second).status, RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
  assert.ok(test.calls.invalidations >= 1);
}

{
  const pending = deferred();
  const test = fixture({ getPublishedById: () => pending.promise });
  test.controller.handleAuthState(AUTH_A);
  const request = test.controller.requestDetail({ recipe: cms });
  await Promise.resolve();
  test.controller.handleAuthState(AUTH_B);
  pending.resolve({ data: fullDetail(cms.id), error: null, stale: false });
  assert.equal((await request).status, RECIPE_DETAIL_RESULT.STALE);
}

{
  const pending = deferred();
  const test = fixture({ getPublishedById: () => pending.promise });
  test.controller.handleAuthState(AUTH_A);
  const oldRequest = test.controller.requestDetail({ recipe: cms });
  await Promise.resolve();
  test.controller.handleAuthState(GUEST);
  test.controller.handleAuthState(AUTH_A);
  pending.resolve({ data: fullDetail(cms.id), error: null, stale: false });
  assert.equal((await oldRequest).status, RECIPE_DETAIL_RESULT.STALE, 'A to guest to A must not revive old work');
}

{
  const pending = deferred();
  const test = fixture({ getPublishedById: () => pending.promise });
  test.controller.handleAuthState(AUTH_A);
  const oldRequest = test.controller.requestDetail({ recipe: cms });
  await Promise.resolve();
  test.controller.handleAuthState(AUTH_B);
  test.controller.handleAuthState(AUTH_A);
  pending.resolve({ data: fullDetail(cms.id), error: null, stale: false });
  assert.equal((await oldRequest).status, RECIPE_DETAIL_RESULT.STALE, 'A to B to A must not revive old work');
}

{
  const lateSuccess = deferred();
  const test = fixture({ getPublishedById: () => lateSuccess.promise });
  test.controller.handleAuthState(AUTH_A);
  const request = test.controller.requestDetail({ recipe: cms });
  await Promise.resolve();
  test.controller.invalidate();
  lateSuccess.resolve({ data: fullDetail(cms.id), error: null, stale: false });
  assert.equal((await request).status, RECIPE_DETAIL_RESULT.STALE);

  const lateFailure = deferred();
  const failureTest = fixture({ getPublishedById: () => lateFailure.promise });
  failureTest.controller.handleAuthState(AUTH_A);
  const failureRequest = failureTest.controller.requestDetail({ recipe: cms });
  await Promise.resolve();
  failureTest.controller.invalidate();
  lateFailure.reject(new Error('PRIVATE_PROVIDER_MESSAGE'));
  const lateFailureResult = await failureRequest;
  assert.equal(lateFailureResult.status, RECIPE_DETAIL_RESULT.STALE);
  assert.doesNotMatch(JSON.stringify(lateFailureResult), /PRIVATE_PROVIDER_MESSAGE/);
}

{
  let controller;
  let reentrant;
  const test = fixture({
    getPublishedById() {
      reentrant = controller.requestDetail({ recipe: cms });
      return Promise.resolve({ data: fullDetail(cms.id), error: null, stale: false });
    },
  });
  controller = test.controller;
  controller.handleAuthState(AUTH_A);
  const request = controller.requestDetail({ recipe: cms });
  assert.equal((await request).status, RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
  assert.equal(reentrant, request, 'Reentrant identical calls must share the registered operation');
  assert.equal(test.calls.details.length, 1);
}

{
  let idReads = 0;
  const hostileRecipe = {
    get id() { idReads += 1; return idReads === 1 ? cms.id : mealDb.id; },
    get source() { return 'database'; },
    get detailLevel() { return 'preview'; },
    get externalProvider() { return undefined; },
    get externalId() { return undefined; },
    get name() { return 'Hostile CMS'; },
  };
  let userReads = 0;
  const hostileAuth = {
    get status() { return 'authenticated'; },
    get userId() { userReads += 1; return userReads === 1 ? USER_A : USER_B; },
  };
  const test = fixture();
  assert.equal(test.controller.handleAuthState(hostileAuth), true);
  const value = await test.controller.requestDetail({ recipe: hostileRecipe });
  assert.equal(value.status, RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
  assert.equal(test.calls.details[0].id, cms.id);
  assert.equal(idReads, 1);
  assert.equal(userReads, 1);
}

{
  const throwing = new Proxy({}, { get() { throw new Error('PRIVATE_GETTER_MESSAGE'); } });
  const test = fixture();
  assert.doesNotThrow(() => test.controller.handleAuthState(throwing));
  assert.equal((await test.controller.requestDetail({ recipe: cms })).status, RECIPE_DETAIL_RESULT.DENIED);
  assert.equal((await test.controller.requestDetail(throwing)).status, RECIPE_DETAIL_RESULT.DENIED);
}

for (const malformedResult of [
  null,
  {},
  { data: fullDetail(cms.id), error: null },
  { data: fullDetail(cms.id), error: null, stale: 'false' },
  { data: fullDetail('cms:wrong'), error: null, stale: false },
  { data: { id: cms.id, source: 'external' }, error: null, stale: false },
  { data: null, error: { message: 'PRIVATE_PROVIDER_MESSAGE' }, stale: false },
]) {
  const test = fixture({ getPublishedById: () => Promise.resolve(malformedResult) });
  test.controller.handleAuthState(AUTH_A);
  const value = await test.controller.requestDetail({ recipe: cms });
  assert.equal(value.status, RECIPE_DETAIL_RESULT.UNAVAILABLE);
  assert.equal(value.data, null);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_PROVIDER_MESSAGE/);
}

{
  const hostileThenable = Object.defineProperty({}, 'then', {
    get() { throw new Error('PRIVATE_THENABLE_MESSAGE'); },
  });
  const test = fixture({ getPublishedById: () => hostileThenable });
  test.controller.handleAuthState(AUTH_A);
  const value = await test.controller.requestDetail({ recipe: cms });
  assert.equal(value.status, RECIPE_DETAIL_RESULT.UNAVAILABLE);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_THENABLE_MESSAGE/);
}

{
  let controller;
  const calls = { clears: 0 };
  const loginGate = { open: () => true, close: () => true, cleanup: () => true };
  const detailService = {
    getPublishedById: () => assert.fail('Cleanup during clear must suppress provider access'),
    invalidate: () => true,
    cleanup: () => true,
  };
  controller = createRecipeDetailAccessController({
    loginGate,
    detailService,
    clearProtectedDetail() {
      calls.clears += 1;
      if (calls.clears === 2) controller.cleanup();
      throw new Error('PRIVATE_CLEAR_MESSAGE');
    },
  });
  controller.handleAuthState(AUTH_A);
  const value = await controller.requestDetail({ recipe: cms });
  assert.equal(value.status, RECIPE_DETAIL_RESULT.STALE);
  assert.equal(controller.cleanup(), false);
  assert.equal((await controller.requestDetail({ recipe: mealDb })).status, RECIPE_DETAIL_RESULT.STALE);
}

{
  const test = fixture();
  test.controller.handleAuthState(AUTH_A);
  assert.equal(test.controller.cleanup(), true);
  assert.equal(test.controller.cleanup(), false);
  assert.equal(test.controller.handleAuthState(AUTH_B), false);
  assert.equal(test.controller.invalidate(), false);
  assert.equal((await test.controller.requestDetail({ recipe: cms })).status, RECIPE_DETAIL_RESULT.STALE);
  assert.equal(test.calls.detailCleanup, 1);
  assert.equal(test.calls.gateCleanup, 1);
}

{
  const mutablePublic = {
    ...mealDb,
    ingredients: [['Chicken', '2 cups']],
  };
  const test = fixture();
  const value = await test.controller.requestDetail({ recipe: mutablePublic });
  assert.equal(value.status, RECIPE_DETAIL_RESULT.PUBLIC_EXTERNAL_DETAIL);
  assert.notEqual(value.data, mutablePublic);
  mutablePublic.id = 'external:themealdb:1';
  mutablePublic.name = 'Changed';
  mutablePublic.ingredients[0][0] = 'Changed';
  assert.equal(value.data.id, mealDb.id);
  assert.equal(value.data.name, mealDb.name);
  assert.equal(value.data.ingredients[0][0], 'Chicken');
  assert.equal(Object.isFrozen(value.data), true);
  assert.equal(Object.isFrozen(value.data.ingredients), true);
  assert.equal(Object.isFrozen(value.data.ingredients[0]), true);
  assert.equal(Object.prototype.hasOwnProperty.call(value.data, 'fallbackImage'), false);
}

{
  const mutableProtected = {
    ...fullDetail(cms.id),
    ingredients: [['Ingredient', '1 cup']],
  };
  const test = fixture({ getPublishedById: () => Promise.resolve({ data: mutableProtected, error: null, stale: false }) });
  test.controller.handleAuthState(AUTH_A);
  const value = await test.controller.requestDetail({ recipe: cms });
  assert.equal(value.status, RECIPE_DETAIL_RESULT.PROTECTED_DETAIL);
  assert.notEqual(value.data, mutableProtected);
  mutableProtected.id = 'cms:changed';
  mutableProtected.name = 'Changed';
  mutableProtected.ingredients[0][0] = 'Changed';
  assert.equal(value.data.id, cms.id);
  assert.equal(value.data.name, 'Protected detail');
  assert.equal(value.data.ingredients[0][0], 'Ingredient');
  assert.equal(Object.isFrozen(value.data), true);
  assert.equal(Object.isFrozen(value.data.ingredients), true);
  assert.equal(Object.isFrozen(value.data.ingredients[0]), true);
  assert.equal(value.data.fallbackImage, '');
}

for (const hostileData of [
  Object.defineProperty({ ...fullDetail(cms.id) }, 'id', { enumerable: true, get: () => cms.id }),
  Object.assign(Object.create({ inherited: true }), fullDetail(cms.id)),
  { ...fullDetail(cms.id), unexpected: 'private' },
  { ...fullDetail(cms.id), ingredients: new Array(1) },
  { ...fullDetail(cms.id), ingredients: Array.from({ length: 201 }, () => ['x', 'y']) },
]) {
  const test = fixture({ getPublishedById: () => Promise.resolve({ data: hostileData, error: null, stale: false }) });
  test.controller.handleAuthState(AUTH_A);
  assert.equal((await test.controller.requestDetail({ recipe: cms })).status, RECIPE_DETAIL_RESULT.UNAVAILABLE);
}

{
  const throwingProxy = new Proxy(fullDetail(cms.id), {
    ownKeys() { throw new Error('PRIVATE_DESCRIPTOR_MESSAGE'); },
  });
  const test = fixture({ getPublishedById: () => Promise.resolve({ data: throwingProxy, error: null, stale: false }) });
  test.controller.handleAuthState(AUTH_A);
  const value = await test.controller.requestDetail({ recipe: cms });
  assert.equal(value.status, RECIPE_DETAIL_RESULT.UNAVAILABLE);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_DESCRIPTOR_MESSAGE/);
}

{
  const cyclic = { ...fullDetail(cms.id) };
  cyclic.ingredients = [cyclic];
  const test = fixture({ getPublishedById: () => Promise.resolve({ data: cyclic, error: null, stale: false }) });
  test.controller.handleAuthState(AUTH_A);
  assert.equal((await test.controller.requestDetail({ recipe: cms })).status, RECIPE_DETAIL_RESULT.UNAVAILABLE);
}

{
  let reads = 0;
  const changing = { ...fullDetail(cms.id) };
  Object.defineProperty(changing, 'id', {
    enumerable: true,
    get() { reads += 1; return reads === 1 ? cms.id : 'cms:changed'; },
  });
  const test = fixture({ getPublishedById: () => Promise.resolve({ data: changing, error: null, stale: false }) });
  test.controller.handleAuthState(AUTH_A);
  assert.equal((await test.controller.requestDetail({ recipe: cms })).status, RECIPE_DETAIL_RESULT.UNAVAILABLE);
}

{
  let controller;
  const reentrant = new Proxy(fullDetail(cms.id), {
    ownKeys(target) {
      controller.handleAuthState(AUTH_B);
      return Reflect.ownKeys(target);
    },
  });
  const test = fixture({ getPublishedById: () => Promise.resolve({ data: reentrant, error: null, stale: false }) });
  controller = test.controller;
  controller.handleAuthState(AUTH_A);
  assert.equal((await controller.requestDetail({ recipe: cms })).status, RECIPE_DETAIL_RESULT.STALE);
}

for (const nextState of [{ status: 'loading' }, { status: 'pending-confirmation' }, { status: 'error' }]) {
  const pending = deferred();
  const test = fixture({ getPublishedById: () => pending.promise });
  test.controller.handleAuthState(AUTH_A);
  const request = test.controller.requestDetail({ recipe: cms });
  await Promise.resolve();
  test.controller.handleAuthState(nextState);
  pending.resolve({ data: fullDetail(cms.id), error: null, stale: false });
  assert.equal((await request).status, RECIPE_DETAIL_RESULT.STALE);
}

{
  const test = fixture({ getPublishedById: () => { throw new Error('PRIVATE_SYNC_PROVIDER_MESSAGE'); } });
  test.controller.handleAuthState(AUTH_A);
  const value = await test.controller.requestDetail({ recipe: cms });
  assert.equal(value.status, RECIPE_DETAIL_RESULT.UNAVAILABLE);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_SYNC_PROVIDER_MESSAGE/);
}

for (const mismatch of [
  fullDetail(cms.id, { databaseSourceType: 'seed' }),
  fullDetail(cms.id, { databaseSourceType: 'external', externalProvider: 'fictional-offline', externalId: '1' }),
  fullDetail(fictional.id, { externalId: '000001' }),
  fullDetail(fictional.id, { externalProvider: 'themealdb' }),
]) {
  const recipe = mismatch.id === fictional.id ? fictional : cms;
  const test = fixture({ getPublishedById: () => Promise.resolve({ data: mismatch, error: null, stale: false }) });
  test.controller.handleAuthState(AUTH_A);
  assert.equal((await test.controller.requestDetail({ recipe })).status, RECIPE_DETAIL_RESULT.UNAVAILABLE);
}

const moduleSource = await readFile(resolve(root, modulePath), 'utf8');
for (const forbidden of [
  /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bcreateClient\s*\(/,
  /\blocalStorage\b/, /\bsessionStorage\b/, /\blocation\s*\./, /\bdocument\b/, /\bwindow\b/,
]) {
  assert.doesNotMatch(moduleSource, forbidden);
}

const deployedJavascript = new Set(
  [...PRODUCTION_OUTPUT_FILES, ...ADMIN_PREVIEW_OUTPUT_FILES].filter((path) => path.endsWith('.js'))
);
for (const sourcePath of deployedJavascript) {
  if (sourcePath === 'js/supabase-config.js') continue;
  const source = await readFile(resolve(root, sourcePath), 'utf8');
  assert.equal(source.includes('recipe-detail-access-controller.js'), false, `${sourcePath} must not activate the controller`);
}
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
assert.equal(PRODUCTION_OUTPUT_FILES.includes(modulePath), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes(modulePath), false);

console.log('Inactive recipe detail access controller tests passed.');
