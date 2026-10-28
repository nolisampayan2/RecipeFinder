import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createFictionalExternalRecipeController,
  createFictionalExternalRecipeSource,
  LEGACY_FICTIONAL_RECIPE_ID_MAP,
  parseFictionalRecipeId,
} from '../js/fictional-external-recipe-source.js';
import { createExternalSourceRegistry, parseExternalSourceId } from '../js/external-source-registry.js';
import { parseMealDbRecipeId } from '../js/mealdb-recipe-source.js';
import { recipeCatalog } from '../js/recipe-catalog.js';

const suffixes = ['990001', '990002', '990003', '990004', '990005', '990006'];
const oldIds = suffixes.map((id) => `external:themealdb:${id}`);
const newIds = suffixes.map((id) => `external:fictional-offline:${id}`);
assert.deepEqual(Object.keys(LEGACY_FICTIONAL_RECIPE_ID_MAP), oldIds);
assert.deepEqual(Object.values(LEGACY_FICTIONAL_RECIPE_ID_MAP), newIds);

const source = createFictionalExternalRecipeSource();
const records = await source.search('recipefinder:discover-all-offline-previews');
assert.deepEqual(records.map(({ id }) => id), newIds);
assert.deepEqual(records.map(({ externalId }) => externalId), suffixes);
assert.equal(new Set(records.map(({ id }) => id)).size, 6);
assert.equal(recipeCatalog.resolveFavoriteIds([newIds[0]])[0].resolved, false);
assert.equal(recipeCatalog.withRecipes(records).resolveFavoriteIds([newIds[0]])[0].recipe.name, records[0].name);
assert.throws(() => parseFictionalRecipeId(oldIds[0]));
assert.throws(() => parseMealDbRecipeId(newIds[0]));

const controller = createFictionalExternalRecipeController();
const registry = createExternalSourceRegistry({ controllers: { 'fictional-offline': controller } });
assert.equal((await registry.getDetails(newIds[0])).id, newIds[0]);
assert.equal(registry.getCachedDetails(newIds[0]).detailLevel, 'full');
assert.throws(() => registry.getDetails('external:themealdb:52772'), (error) => error.code === 'UNREGISTERED_PROVIDER');
assert.throws(() => registry.getDetails('external:unknown:1'), (error) => error.code === 'INVALID_ID');
assert.throws(() => parseExternalSourceId('not-an-external-id'));

const originalStorage = globalThis.localStorage;
const stored = ['lemon-chicken', oldIds[0], 'external:themealdb:12345', newIds[0], ...oldIds.slice(1)];
const writes = [];
globalThis.localStorage = {
  getItem: (key) => key === 'recipefinder:favorites' ? JSON.stringify(stored) : null,
  setItem: (key, value) => writes.push([key, value]),
};
const stateModule = await import(`../js/state.js?migration=${Date.now()}`);
const expectedFavorites = ['lemon-chicken', newIds[0], 'external:themealdb:12345', ...newIds.slice(1)];
assert.deepEqual([...stateModule.state.favorites], expectedFavorites);
assert.deepEqual(JSON.parse(writes[0][1]), expectedFavorites);
assert.deepEqual(stateModule.migrateLegacyFictionalFavoriteIds(expectedFavorites), expectedFavorites);

let malformedWrites = 0;
globalThis.localStorage = {
  getItem: () => '{malformed',
  setItem: () => { malformedWrites += 1; },
};
const malformedState = await import(`../js/state.js?malformed=${Date.now()}`);
assert.deepEqual([...malformedState.state.favorites], []);
assert.equal(malformedWrites, 0);

globalThis.localStorage = {
  getItem: () => JSON.stringify([oldIds[0], 'lemon-chicken']),
  setItem: () => { throw new Error('write unavailable'); },
};
const writeFailureState = await import(`../js/state.js?writeFailure=${Date.now()}`);
assert.deepEqual([...writeFailureState.state.favorites], [newIds[0], 'lemon-chicken']);

globalThis.localStorage = {
  getItem: () => { throw new Error('unavailable'); },
  setItem: () => { throw new Error('unavailable'); },
};
const unavailableState = await import(`../js/state.js?unavailable=${Date.now()}`);
assert.deepEqual([...unavailableState.state.favorites], []);
globalThis.localStorage = originalStorage;

const registrySource = await readFile(new URL('../js/external-source-registry.js', import.meta.url), 'utf8');
assert.doesNotMatch(registrySource, /fetch\(|createMealDbClient|localStorage|sessionStorage|document\.|window\./);

console.log('Offline source identity, registry, and favorite migration tests passed.');
