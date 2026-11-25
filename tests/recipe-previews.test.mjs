import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recipes as existingBuiltInRecipes } from '../js/data.js';
import { createFictionalExternalRecipeSource } from '../js/fictional-external-recipe-source.js';
import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';
import { BUILT_IN_RECIPE_PREVIEWS } from '../js/recipe-previews.js';
import { FICTIONAL_RECIPE_PREVIEWS } from './fixtures/fictional-recipe-previews.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const modulePath = 'js/recipe-previews.js';
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const BUILT_IN_ID = /^[a-z0-9][a-z0-9_-]{0,199}$/;
const FICTIONAL_ID = /^external:fictional-offline:(\d+)$/;
const BUILT_IN_FIELDS = Object.freeze([
  'category', 'cuisine', 'description', 'detailLevel', 'id', 'image', 'name', 'source',
]);
const BUILT_IN_FIELDS_WITH_FALLBACK = Object.freeze([...BUILT_IN_FIELDS, 'fallbackImage'].sort());
const FICTIONAL_FIELDS = Object.freeze([
  'category', 'cuisine', 'description', 'detailLevel', 'externalId', 'externalProvider',
  'fallbackImage', 'id', 'image', 'name', 'source',
].sort());
const PROTECTED_FIELDS = Object.freeze([
  'ingredients', 'instructions', 'measurement', 'measurements', 'tutorial', 'tutorialUrl',
  'createdAt', 'createdBy', 'publishedAt', 'updatedAt',
]);

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function assertPublicText(value, field) {
  assert.equal(typeof value, 'string', `${field} must be text`);
  assert.equal(value, value.trim(), `${field} must already be trimmed`);
  assert.ok(value.length > 0, `${field} must not be blank`);
  assert.equal(CONTROL_CHARACTERS.test(value), false, `${field} must not contain control characters`);
}

function assertPublicImage(value, field) {
  assertPublicText(value, field);
  if (value.startsWith('assets/')) {
    assert.match(value, /^assets\/[a-zA-Z\d][a-zA-Z\d._/-]*$/);
    return;
  }
  const parsed = new URL(value);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.username, '');
  assert.equal(parsed.password, '');
}

function publicMetadata(recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    category: recipe.category,
    cuisine: recipe.cuisine,
    image: recipe.image,
    ...(recipe.fallbackImage ? { fallbackImage: recipe.fallbackImage } : {}),
    description: recipe.description,
  };
}

function assertNoProtectedFields(preview) {
  for (const field of PROTECTED_FIELDS) {
    assert.equal(Object.hasOwn(preview, field), false, `${preview.id} must not expose ${field}`);
  }
}

assert.equal(Object.isFrozen(BUILT_IN_RECIPE_PREVIEWS), true);
assert.equal(Object.isFrozen(FICTIONAL_RECIPE_PREVIEWS), true);
assert.equal(BUILT_IN_RECIPE_PREVIEWS.length, 10);
assert.equal(FICTIONAL_RECIPE_PREVIEWS.length, 6);

const allIds = new Set();
for (const preview of BUILT_IN_RECIPE_PREVIEWS) {
  assert.equal(Object.isFrozen(preview), true);
  const expectedFields = Object.hasOwn(preview, 'fallbackImage')
    ? BUILT_IN_FIELDS_WITH_FALLBACK
    : [...BUILT_IN_FIELDS].sort();
  assert.deepEqual(sortedKeys(preview), expectedFields);
  assert.match(preview.id, BUILT_IN_ID);
  assert.equal(preview.source, 'built-in');
  assert.equal(preview.detailLevel, 'preview');
  for (const field of ['name', 'category', 'cuisine', 'description']) {
    assertPublicText(preview[field], `${preview.id}.${field}`);
  }
  assertPublicImage(preview.image, `${preview.id}.image`);
  if (preview.fallbackImage) assertPublicImage(preview.fallbackImage, `${preview.id}.fallbackImage`);
  assertNoProtectedFields(preview);
  assert.equal(allIds.has(preview.id), false, `Duplicate preview ID: ${preview.id}`);
  allIds.add(preview.id);
}

for (const preview of FICTIONAL_RECIPE_PREVIEWS) {
  assert.equal(Object.isFrozen(preview), true);
  assert.deepEqual(sortedKeys(preview), FICTIONAL_FIELDS);
  const identity = FICTIONAL_ID.exec(preview.id);
  assert.ok(identity, `${preview.id} must use the fictional-offline namespace`);
  assert.equal(preview.externalId, identity[1]);
  assert.equal(preview.source, 'external');
  assert.equal(preview.externalProvider, 'fictional-offline');
  assert.notEqual(preview.externalProvider, 'themealdb');
  assert.equal(preview.detailLevel, 'summary');
  for (const field of ['name', 'category', 'cuisine', 'description']) {
    assertPublicText(preview[field], `${preview.id}.${field}`);
  }
  assertPublicImage(preview.image, `${preview.id}.image`);
  assertPublicImage(preview.fallbackImage, `${preview.id}.fallbackImage`);
  assertNoProtectedFields(preview);
  assert.equal(allIds.has(preview.id), false, `Duplicate preview ID: ${preview.id}`);
  allIds.add(preview.id);
}

assert.deepEqual(
  BUILT_IN_RECIPE_PREVIEWS.map(publicMetadata),
  existingBuiltInRecipes.map(publicMetadata),
  'Built-in preview ordering, identities, and public metadata must remain stable'
);

const existingFictionalRecipes = await createFictionalExternalRecipeSource()
  .search('recipefinder:discover-all-offline-previews');
assert.deepEqual(
  FICTIONAL_RECIPE_PREVIEWS.map(({ source, externalProvider, externalId, detailLevel, ...preview }) => ({
    ...preview,
    source,
    externalProvider,
    externalId,
    detailLevel,
  })),
  existingFictionalRecipes.map((recipe) => ({
    id: recipe.id,
    name: recipe.name,
    category: recipe.category,
    cuisine: recipe.cuisine,
    description: recipe.description,
    image: recipe.image,
    fallbackImage: recipe.fallbackImage,
    source: recipe.source,
    externalProvider: recipe.externalProvider,
    externalId: recipe.externalId,
    detailLevel: 'summary',
  })),
  'Fictional preview ordering, identities, and public metadata must remain stable'
);

const firstBuiltInName = BUILT_IN_RECIPE_PREVIEWS[0].name;
const firstFictionalName = FICTIONAL_RECIPE_PREVIEWS[0].name;
assert.throws(() => { BUILT_IN_RECIPE_PREVIEWS.push({}); }, TypeError);
assert.throws(() => { BUILT_IN_RECIPE_PREVIEWS[0].name = 'Changed'; }, TypeError);
assert.throws(() => { FICTIONAL_RECIPE_PREVIEWS[0].name = 'Changed'; }, TypeError);
assert.equal(BUILT_IN_RECIPE_PREVIEWS[0].name, firstBuiltInName);
assert.equal(FICTIONAL_RECIPE_PREVIEWS[0].name, firstFictionalName);

const moduleSource = await readFile(resolve(root, modulePath), 'utf8');
assert.doesNotMatch(moduleSource, /^\s*import\s/m, 'Preview data must have no runtime imports');
for (const forbiddenRuntime of [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsupabase\b/i,
  /\bdocument\b/,
  /\bwindow\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
]) {
  assert.doesNotMatch(moduleSource, forbiddenRuntime);
}

const activeSources = [resolve(root, 'index.html'), ...new Set(
  [...PRODUCTION_OUTPUT_FILES, ...ADMIN_PREVIEW_OUTPUT_FILES]
    .filter((path) => path.endsWith('.js') && path !== 'js/supabase-config.js')
    .map((path) => resolve(root, path))
)];
for (const sourcePath of activeSources) {
  const source = await readFile(sourcePath, 'utf8');
  assert.equal(
    source.includes('recipe-previews.js'),
    false,
    `${sourcePath} must not activate the preview foundation yet`
  );
}

assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
assert.equal(PRODUCTION_OUTPUT_FILES.includes(modulePath), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes(modulePath), false);

console.log('Inactive RecipeFinder preview-data foundation tests passed.');
