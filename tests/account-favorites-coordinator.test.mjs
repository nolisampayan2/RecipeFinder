import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ACCOUNT_FAVORITES_MODE,
  createAccountFavoritesCoordinator,
} from '../js/account-favorites-coordinator.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const DATABASE_RECIPE = Object.freeze({ id: 'database-recipe', source: 'database' });
const SECOND_DATABASE_RECIPE = Object.freeze({ id: 'second-database-recipe', source: 'database' });
const BUILT_IN_RECIPE = Object.freeze({ id: 'built-in-recipe' });
const LIVE_RECIPE = Object.freeze({ id: 'external:themealdb:42', source: 'external' });

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function serviceFixture() {
  const calls = [];
  const loads = new Map();
  const writes = [];
  return {
    calls,
    loads,
    writes,
    service: {
      listOwn(userId) {
        calls.push(['listOwn', userId]);
        if (!loads.has(userId)) loads.set(userId, deferred());
        return loads.get(userId).promise;
      },
      addOwn(userId, recipeId) {
        calls.push(['addOwn', userId, recipeId]);
        const pending = deferred();
        writes.push(pending);
        return pending.promise;
      },
      removeOwn(userId, recipeId) {
        calls.push(['removeOwn', userId, recipeId]);
        const pending = deferred();
        writes.push(pending);
        return pending.promise;
      },
    },
  };
}

const switchingFixture = serviceFixture();
const switching = createAccountFavoritesCoordinator({
  service: switchingFixture.service,
  guestFavorites: ['guest-recipe'],
});
assert.deepEqual(switching.getState(), {
  mode: ACCOUNT_FAVORITES_MODE.GUEST,
  favoriteIds: ['guest-recipe'],
});
switching.setEligibleRecipes([DATABASE_RECIPE, SECOND_DATABASE_RECIPE, BUILT_IN_RECIPE, LIVE_RECIPE]);

const userALoad = switching.loadAccount(USER_A);
const duplicateUserALoad = switching.loadAccount(USER_A);
assert.equal(userALoad, duplicateUserALoad);
assert.deepEqual(switching.getState(), {
  mode: ACCOUNT_FAVORITES_MODE.LOADING,
  favoriteIds: [],
});
assert.equal(switchingFixture.calls.filter(([name]) => name === 'listOwn').length, 1);

const userBLoad = switching.loadAccount(USER_B);
switchingFixture.loads.get(USER_A).resolve({ data: ['database-recipe'], error: null });
assert.equal(await userALoad, false);
assert.equal(switching.getState().mode, ACCOUNT_FAVORITES_MODE.LOADING);
switchingFixture.loads.get(USER_B).resolve({ data: ['second-database-recipe'], error: null });
assert.equal(await userBLoad, true);
assert.deepEqual(switching.getState(), {
  mode: ACCOUNT_FAVORITES_MODE.READY,
  favoriteIds: ['second-database-recipe'],
});

assert.deepEqual(
  await switching.toggleAccountFavorite(BUILT_IN_RECIPE),
  { ok: false, code: 'INELIGIBLE', recipeId: null }
);
assert.deepEqual(
  await switching.toggleAccountFavorite(LIVE_RECIPE),
  { ok: false, code: 'INELIGIBLE', recipeId: null }
);

const addAttempt = switching.toggleAccountFavorite(DATABASE_RECIPE);
const duplicateAddAttempt = switching.toggleAccountFavorite(DATABASE_RECIPE);
assert.equal(addAttempt, duplicateAddAttempt);
assert.equal(switchingFixture.calls.filter(([name]) => name === 'addOwn').length, 1);
assert.equal(switching.getState().favoriteIds.includes('database-recipe'), false);
switchingFixture.writes[0].resolve({ ok: true, recipeId: 'database-recipe', error: null });
assert.deepEqual(await addAttempt, { ok: true, code: 'SUCCESS', recipeId: 'database-recipe' });
assert.deepEqual(switching.getState().favoriteIds, ['second-database-recipe', 'database-recipe']);

const removeAttempt = switching.toggleAccountFavorite(SECOND_DATABASE_RECIPE);
assert.equal(switching.getState().favoriteIds.includes('second-database-recipe'), true);
switchingFixture.writes[1].resolve({ ok: true, recipeId: 'second-database-recipe', error: null });
assert.deepEqual(await removeAttempt, { ok: true, code: 'SUCCESS', recipeId: 'second-database-recipe' });
assert.deepEqual(switching.getState().favoriteIds, ['database-recipe']);

const failedAttempt = switching.toggleAccountFavorite(SECOND_DATABASE_RECIPE);
switchingFixture.writes[2].resolve({ ok: false, recipeId: null, error: { code: 'PROVIDER_ERROR' } });
assert.deepEqual(await failedAttempt, { ok: false, code: 'FAILED', recipeId: 'second-database-recipe' });
assert.deepEqual(switching.getState().favoriteIds, ['database-recipe']);

const pendingDuringLogout = switching.toggleAccountFavorite(SECOND_DATABASE_RECIPE);
assert.equal(switching.enterGuest(['guest-recipe']), true);
assert.deepEqual(switching.getState(), {
  mode: ACCOUNT_FAVORITES_MODE.GUEST,
  favoriteIds: ['guest-recipe'],
});
switchingFixture.writes[3].resolve({ ok: true, recipeId: 'second-database-recipe', error: null });
assert.deepEqual(await pendingDuringLogout, { ok: false, code: 'STALE', recipeId: 'second-database-recipe' });
assert.deepEqual(switching.getState().favoriteIds, ['guest-recipe']);

const errorFixture = serviceFixture();
const errorCoordinator = createAccountFavoritesCoordinator({
  service: errorFixture.service,
  guestFavorites: ['guest-must-not-leak'],
});
const errorLoad = errorCoordinator.loadAccount(USER_A);
errorFixture.loads.get(USER_A).resolve({ data: null, error: { code: 'PROVIDER_ERROR', message: 'PRIVATE' } });
assert.equal(await errorLoad, false);
assert.deepEqual(errorCoordinator.getState(), {
  mode: ACCOUNT_FAVORITES_MODE.ERROR,
  favoriteIds: [],
});
assert.doesNotMatch(JSON.stringify(errorCoordinator.getState()), /PRIVATE|guest-must-not-leak/);

for (const malformedData of [
  ['UPPERCASE'],
  ['duplicate-id', 'duplicate-id'],
  new Array(1),
]) {
  const malformedFixture = serviceFixture();
  const malformedCoordinator = createAccountFavoritesCoordinator({ service: malformedFixture.service });
  const load = malformedCoordinator.loadAccount(USER_A);
  malformedFixture.loads.get(USER_A).resolve({ data: malformedData, error: null });
  assert.equal(await load, false);
  assert.equal(malformedCoordinator.getState().mode, ACCOUNT_FAVORITES_MODE.ERROR);
}

const noImportFixture = serviceFixture();
const noImport = createAccountFavoritesCoordinator({
  service: noImportFixture.service,
  guestFavorites: ['database-recipe'],
});
noImport.setEligibleRecipes([DATABASE_RECIPE]);
const noImportLoad = noImport.loadAccount(USER_A);
noImportFixture.loads.get(USER_A).resolve({ data: [], error: null });
assert.equal(await noImportLoad, true);
assert.deepEqual(noImport.getState().favoriteIds, []);
assert.equal(noImportFixture.calls.some(([name]) => name === 'addOwn'), false);

const cleanupFixture = serviceFixture();
const cleanupCoordinator = createAccountFavoritesCoordinator({ service: cleanupFixture.service });
const cleanupLoad = cleanupCoordinator.loadAccount(USER_A);
assert.equal(cleanupCoordinator.cleanup(), true);
assert.equal(cleanupCoordinator.cleanup(), false);
cleanupFixture.loads.get(USER_A).resolve({ data: ['database-recipe'], error: null });
assert.equal(await cleanupLoad, false);
assert.deepEqual(await cleanupCoordinator.toggleAccountFavorite(DATABASE_RECIPE), {
  ok: false,
  code: 'RETIRED',
  recipeId: null,
});

assert.throws(
  () => createAccountFavoritesCoordinator({ service: null }),
  /compatible account favorites service/
);
assert.throws(
  () => switching.setEligibleRecipes(new Array(1)),
  /must not be sparse/
);
const overriddenCatalog = [DATABASE_RECIPE];
overriddenCatalog.map = () => [];
assert.throws(
  () => switching.setEligibleRecipes(overriddenCatalog),
  /dense recipe array/
);

function queuedServiceFixture() {
  const calls = [];
  const loads = [];
  const writes = [];
  return {
    calls,
    loads,
    writes,
    service: {
      listOwn(userId) {
        const pending = deferred();
        calls.push(['listOwn', userId]);
        loads.push({ userId, ...pending });
        return pending.promise;
      },
      addOwn(userId, recipeId) {
        const pending = deferred();
        calls.push(['addOwn', userId, recipeId]);
        writes.push({ kind: 'add', userId, recipeId, ...pending });
        return pending.promise;
      },
      removeOwn(userId, recipeId) {
        const pending = deferred();
        calls.push(['removeOwn', userId, recipeId]);
        writes.push({ kind: 'remove', userId, recipeId, ...pending });
        return pending.promise;
      },
    },
  };
}

const eligibilityInsertFixture = queuedServiceFixture();
const eligibilityInsert = createAccountFavoritesCoordinator({
  service: eligibilityInsertFixture.service,
});
eligibilityInsert.setEligibleRecipes([DATABASE_RECIPE]);
const eligibilityInsertLoad = eligibilityInsert.loadAccount(USER_A);
eligibilityInsertFixture.loads[0].resolve({ data: [], error: null });
assert.equal(await eligibilityInsertLoad, true);
const staleInsert = eligibilityInsert.toggleAccountFavorite(DATABASE_RECIPE);
eligibilityInsert.setEligibleRecipes([]);
eligibilityInsertFixture.writes[0].resolve({
  ok: true,
  recipeId: DATABASE_RECIPE.id,
  error: null,
});
assert.deepEqual(await staleInsert, {
  ok: false,
  code: 'STALE',
  recipeId: DATABASE_RECIPE.id,
});
assert.deepEqual(eligibilityInsert.getState(), {
  mode: ACCOUNT_FAVORITES_MODE.READY,
  favoriteIds: [],
});

const eligibilityDeleteFixture = queuedServiceFixture();
const eligibilityDelete = createAccountFavoritesCoordinator({
  service: eligibilityDeleteFixture.service,
});
eligibilityDelete.setEligibleRecipes([DATABASE_RECIPE]);
const eligibilityDeleteLoad = eligibilityDelete.loadAccount(USER_A);
eligibilityDeleteFixture.loads[0].resolve({ data: [DATABASE_RECIPE.id], error: null });
assert.equal(await eligibilityDeleteLoad, true);
const staleDelete = eligibilityDelete.toggleAccountFavorite(DATABASE_RECIPE);
eligibilityDelete.setEligibleRecipes([DATABASE_RECIPE]);
eligibilityDeleteFixture.writes[0].resolve({
  ok: true,
  recipeId: DATABASE_RECIPE.id,
  error: null,
});
assert.deepEqual(await staleDelete, {
  ok: false,
  code: 'STALE',
  recipeId: DATABASE_RECIPE.id,
});
assert.deepEqual(eligibilityDelete.getState(), {
  mode: ACCOUNT_FAVORITES_MODE.READY,
  favoriteIds: [DATABASE_RECIPE.id],
});

const writeSwitchFixture = queuedServiceFixture();
const writeSwitch = createAccountFavoritesCoordinator({ service: writeSwitchFixture.service });
writeSwitch.setEligibleRecipes([DATABASE_RECIPE]);
const writeSwitchALoad = writeSwitch.loadAccount(USER_A);
writeSwitchFixture.loads[0].resolve({ data: [], error: null });
assert.equal(await writeSwitchALoad, true);
const userAWrite = writeSwitch.toggleAccountFavorite(DATABASE_RECIPE);
const writeSwitchBLoad = writeSwitch.loadAccount(USER_B);
writeSwitchFixture.writes[0].resolve({ ok: true, recipeId: DATABASE_RECIPE.id, error: null });
assert.deepEqual(await userAWrite, {
  ok: false,
  code: 'STALE',
  recipeId: DATABASE_RECIPE.id,
});
assert.deepEqual(writeSwitch.getState(), {
  mode: ACCOUNT_FAVORITES_MODE.LOADING,
  favoriteIds: [],
});
writeSwitchFixture.loads[1].resolve({ data: [DATABASE_RECIPE.id], error: null });
assert.equal(await writeSwitchBLoad, true);
assert.deepEqual(writeSwitch.getState().favoriteIds, [DATABASE_RECIPE.id]);

const cleanupWriteFixture = queuedServiceFixture();
const cleanupWrite = createAccountFavoritesCoordinator({ service: cleanupWriteFixture.service });
cleanupWrite.setEligibleRecipes([DATABASE_RECIPE]);
const cleanupWriteLoad = cleanupWrite.loadAccount(USER_A);
cleanupWriteFixture.loads[0].resolve({ data: [], error: null });
await cleanupWriteLoad;
const writeAtCleanup = cleanupWrite.toggleAccountFavorite(DATABASE_RECIPE);
assert.equal(cleanupWrite.cleanup(), true);
cleanupWriteFixture.writes[0].resolve({ ok: true, recipeId: DATABASE_RECIPE.id, error: null });
assert.deepEqual(await writeAtCleanup, {
  ok: false,
  code: 'STALE',
  recipeId: DATABASE_RECIPE.id,
});

const outOfOrderFixture = queuedServiceFixture();
const outOfOrder = createAccountFavoritesCoordinator({ service: outOfOrderFixture.service });
outOfOrder.setEligibleRecipes([DATABASE_RECIPE, SECOND_DATABASE_RECIPE]);
const outOfOrderLoad = outOfOrder.loadAccount(USER_A);
outOfOrderFixture.loads[0].resolve({ data: [], error: null });
await outOfOrderLoad;
const firstWrite = outOfOrder.toggleAccountFavorite(DATABASE_RECIPE);
const secondWrite = outOfOrder.toggleAccountFavorite(SECOND_DATABASE_RECIPE);
outOfOrderFixture.writes[1].resolve({
  ok: true,
  recipeId: SECOND_DATABASE_RECIPE.id,
  error: null,
});
assert.deepEqual(await secondWrite, {
  ok: true,
  code: 'SUCCESS',
  recipeId: SECOND_DATABASE_RECIPE.id,
});
assert.deepEqual(outOfOrder.getState().favoriteIds, [SECOND_DATABASE_RECIPE.id]);
outOfOrderFixture.writes[0].resolve({ ok: true, recipeId: DATABASE_RECIPE.id, error: null });
assert.deepEqual(await firstWrite, {
  ok: true,
  code: 'SUCCESS',
  recipeId: DATABASE_RECIPE.id,
});
assert.deepEqual(outOfOrder.getState().favoriteIds, [SECOND_DATABASE_RECIPE.id, DATABASE_RECIPE.id]);

const repeatedAccountFixture = queuedServiceFixture();
const repeatedAccount = createAccountFavoritesCoordinator({ service: repeatedAccountFixture.service });
const repeatedFirstLoad = repeatedAccount.loadAccount(USER_A);
repeatedAccountFixture.loads[0].resolve({ data: [], error: null });
assert.equal(await repeatedFirstLoad, true);
const repeatedSecondLoad = repeatedAccount.loadAccount(USER_A);
assert.equal(repeatedAccount.getState().mode, ACCOUNT_FAVORITES_MODE.LOADING);
repeatedAccountFixture.loads[1].resolve({ data: [DATABASE_RECIPE.id], error: null });
assert.equal(await repeatedSecondLoad, true);
assert.equal(repeatedAccountFixture.calls.filter(([name]) => name === 'listOwn').length, 2);
assert.deepEqual(repeatedAccount.getState().favoriteIds, [DATABASE_RECIPE.id]);

const retainedGuestFixture = queuedServiceFixture();
const retainedGuest = createAccountFavoritesCoordinator({
  service: retainedGuestFixture.service,
  guestFavorites: ['guest-recipe'],
});
const retainedGuestLoad = retainedGuest.loadAccount(USER_A);
retainedGuestFixture.loads[0].resolve({ data: [], error: null });
await retainedGuestLoad;
assert.equal(retainedGuest.enterGuest(), true);
assert.deepEqual(retainedGuest.getState(), {
  mode: ACCOUNT_FAVORITES_MODE.GUEST,
  favoriteIds: ['guest-recipe'],
});

const replacementFixture = queuedServiceFixture();
const replacement = createAccountFavoritesCoordinator({ service: replacementFixture.service });
replacement.setEligibleRecipes([DATABASE_RECIPE]);
const replacementLoad = replacement.loadAccount(USER_A);
replacementFixture.loads[0].resolve({ data: [], error: null });
await replacementLoad;
const oldWrite = replacement.toggleAccountFavorite(DATABASE_RECIPE);
replacement.setEligibleRecipes([]);
replacement.setEligibleRecipes([DATABASE_RECIPE]);
const newWrite = replacement.toggleAccountFavorite(DATABASE_RECIPE);
assert.notEqual(oldWrite, newWrite);
replacementFixture.writes[0].resolve({ ok: true, recipeId: DATABASE_RECIPE.id, error: null });
assert.deepEqual(await oldWrite, {
  ok: false,
  code: 'STALE',
  recipeId: DATABASE_RECIPE.id,
});
assert.equal(replacement.toggleAccountFavorite(DATABASE_RECIPE), newWrite);
replacementFixture.writes[1].resolve({ ok: true, recipeId: DATABASE_RECIPE.id, error: null });
assert.deepEqual(await newWrite, {
  ok: true,
  code: 'SUCCESS',
  recipeId: DATABASE_RECIPE.id,
});
assert.deepEqual(replacement.getState().favoriteIds, [DATABASE_RECIPE.id]);

const source = await readFile(new URL('../js/account-favorites-coordinator.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /createClient|supabase-config|service.?role|sb_secret_|access_token|refresh_token|console\.|localStorage|sessionStorage/i);
assert.doesNotMatch(source, /document\.|window\.|\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.rpc\s*\(/);

console.log('Offline account Favorites coordinator tests passed with deferred fake services only.');
