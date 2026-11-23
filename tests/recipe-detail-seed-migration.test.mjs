import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { recipes as builtInRecipes } from '../js/data.js';
import { createFictionalExternalRecipeSource } from '../js/fictional-external-recipe-source.js';
import { FICTIONAL_RECIPE_PREVIEWS } from '../js/recipe-previews.js';
import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';

const sql = await readFile(
  new URL('../supabase/migrations/202611230002_recipe_detail_seed_data.sql', import.meta.url),
  'utf8',
);
const payloadMatch = sql.match(/expected\s+jsonb\s*:=\s*\$recipes\$([\s\S]*?)\$recipes\$::jsonb/i);
assert.ok(payloadMatch, 'The migration must contain one explicit JSONB recipe inventory.');
const actual = JSON.parse(payloadMatch[1]);

const format = (recipe, sourceType, externalId = null) => ({
  id: recipe.id,
  name: recipe.name,
  description: recipe.description,
  category_slug: recipe.category.toLowerCase(),
  category: recipe.category,
  cuisine_slug: recipe.cuisine.toLowerCase(),
  cuisine: recipe.cuisine,
  image_url: recipe.image,
  fallback_image_url: recipe.fallbackImage || null,
  tutorial_url: recipe.tutorial || null,
  ingredients: recipe.ingredients.map(([name, measurement]) => ({ name, measurement })),
  instructions: recipe.instructions,
  status: 'published',
  source_type: sourceType,
  external_provider: externalId === null ? null : 'fictional-offline',
  external_id: externalId,
  published_at: sourceType === 'seed' ? '2026-10-27T00:00:00Z' : '2026-11-23T00:00:00Z',
});
const fictionalSource = createFictionalExternalRecipeSource();
const expected = [
  ...builtInRecipes.map((recipe) => format(recipe, 'seed')),
  ...await Promise.all(FICTIONAL_RECIPE_PREVIEWS.map(async (preview) =>
    format(await fictionalSource.getDetails(preview.id), 'external', preview.externalId))),
];
assert.equal(actual.length, 16);
assert.deepEqual(actual, expected, 'IDs, order, content, taxonomy, and provenance must match source data.');
assert.equal(new Set(actual.map(({ id }) => id)).size, 16);
assert.deepEqual(actual.map(({ id }) => id), expected.map(({ id }) => id));
for (const row of actual) {
  assert.match(row.id, /^[a-z0-9][a-z0-9:_-]{0,199}$/);
  assert.equal(row.status, 'published');
  assert.ok(row.published_at);
  assert.ok(row.ingredients.length > 0);
  assert.ok(row.ingredients.every((item) =>
    Object.keys(item).sort().join(',') === 'measurement,name'
      && typeof item.name === 'string' && item.name.trim()
      && typeof item.measurement === 'string' && item.measurement.trim()));
  assert.ok(row.instructions.trim());
  if (row.source_type === 'seed') {
    assert.equal(row.external_provider, null);
    assert.equal(row.external_id, null);
  } else {
    assert.equal(row.source_type, 'external');
    assert.equal(row.external_provider, 'fictional-offline');
    assert.match(row.external_id, /^\d+$/);
    assert.equal(row.id, `external:fictional-offline:${row.external_id}`);
  }
}
assert.deepEqual(actual.filter(({ tutorial_url }) => tutorial_url).map(({ id }) => id), ['creamy-garlic-pasta']);

const controlSql = sql.replace(payloadMatch[0], 'expected jsonb := $recipes$DATA$recipes$::jsonb');
assert.match(controlSql, /^(?:--[^\n]*\n)*begin;[\s\S]*commit;\s*$/i);
assert.match(controlSql, /lock\s+table\s+public\.recipes\s+in\s+share\s+row\s+exclusive\s+mode/i);
assert.match(controlSql, /jsonb_array_length\(expected\)\s*<>\s*16/i);
for (const table of ['recipe_categories', 'cuisines']) {
  assert.match(controlSql, new RegExp(`from\\s+public\\.${table}[\\s\\S]*?where\\s+slug\\s*=\\s*target->>'(?:category|cuisine)_slug'[\\s\\S]*?for\\s+share`, 'i'));
}
assert.match(controlSql, /category_row\.is_active\s+is\s+distinct\s+from\s+true/i);
assert.match(controlSql, /cuisine_row\.is_active\s+is\s+distinct\s+from\s+true/i);
assert.match(controlSql, /category_row\.name\s+is\s+distinct\s+from\s+target->>'category'/i);
assert.match(controlSql, /cuisine_row\.name\s+is\s+distinct\s+from\s+target->>'cuisine'/i);
assert.match(controlSql, /where\s+external_provider\s*=\s*target->>'external_provider'\s+and\s+external_id\s*=\s*target->>'external_id'/i);
assert.match(controlSql, /conflicting_id\s+is\s+distinct\s+from\s+target->>'id'/i);
assert.match(controlSql, /insert\s+into\s+public\.recipes\s*\(/i);
assert.match(controlSql, /where\s+not\s+exists\s*\(\s*select\s+1\s+from\s+public\.recipes\s+where\s+id\s*=\s*target->>'id'/i);
assert.match(controlSql, /select\s+\*\s+into\s+existing_row\s+from\s+public\.recipes\s+where\s+id\s*=\s*target->>'id'\s+for\s+update/i);
for (const field of [
  'name', 'description', 'category_id', 'cuisine_id', 'image_url', 'fallback_image_url',
  'tutorial_url', 'ingredients', 'instructions', 'status', 'source_type',
  'external_provider', 'external_id', 'published_at',
]) {
  assert.match(controlSql, new RegExp(`existing_row\\.${field}\\s+is\\s+distinct\\s+from`, 'i'));
}
assert.match(controlSql, /existing_row\.created_by\s+is\s+not\s+null/i);
assert.match(controlSql, /raise\s+exception\s+'Existing recipe conflicts/i);
assert.doesNotMatch(controlSql, /\bon\s+conflict\s+do\s+update\b|\bdelete\s+from\b|\btruncate\b/i);
assert.doesNotMatch(controlSql, /\b(update\s+public\.|alter\s+table|create\s+table|drop\s+table|create\s+policy|alter\s+policy)\b/i);
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 59);
for (const inventory of [PRODUCTION_OUTPUT_FILES, ADMIN_PREVIEW_OUTPUT_FILES]) {
  assert.equal(inventory.some((path) => path.startsWith('supabase/migrations/') || path.startsWith('tests/')), false);
}

console.log('Static recipe-detail data migration contract checks passed; PostgreSQL was not executed.');
