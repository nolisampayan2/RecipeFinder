import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  PRODUCTION_OUTPUT_FILES,
  ADMIN_PREVIEW_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';

const migrationPath = '../supabase/migrations/202611240002_disable_browser_recipe_delete.sql';
const migration = await readFile(new URL(migrationPath, import.meta.url), 'utf8');
const foundation = await readFile(new URL(
  '../supabase/migrations/202610270001_recipefinder_foundation.sql', import.meta.url,
), 'utf8');
const collections = await readFile(new URL(
  '../supabase/migrations/202611240001_recipe_collections.sql', import.meta.url,
), 'utf8');
const sql = migration.replace(/^--[^\n]*(?:\n|$)/gm, '');
const preflight = sql.match(/do \$preflight\$([\s\S]*?)\$preflight\$;/i)?.[1];
const verification = sql.match(/do \$verify\$([\s\S]*?)\$verify\$;/i)?.[1];

assert.ok(preflight, 'The baseline must be checked before privilege changes.');
assert.ok(verification, 'Effective privileges must be checked before commit.');
assert.equal((sql.match(/^begin;$/gm) ?? []).length, 1);
assert.equal((sql.match(/^commit;$/gm) ?? []).length, 1);
assert.match(sql, /^begin;[\s\S]*commit;\s*$/);
const revoke = 'revoke delete on table public.recipes from public, anon, authenticated;';
const dropPolicy = 'drop policy recipes_admin_delete on public.recipes;';
const positions = [
  'do $preflight$', revoke, dropPolicy, 'do $verify$', 'commit;',
].map((entry) => sql.toLowerCase().indexOf(entry));
assert.ok(positions.every((position) => position >= 0));
assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]));
assert.equal((sql.match(/\brevoke\s+delete\s+on\s+table\s+public\.recipes\b/gi) ?? []).length, 1);
assert.equal((sql.match(/\bdrop\s+policy\s+recipes_admin_delete\b/gi) ?? []).length, 1);
assert.deepEqual(
  [...sql.matchAll(/^\s*(?:revoke|grant|drop policy|create policy)\b[^;]*;/gmi)]
    .map(([statement]) => statement.trim().toLowerCase()),
  [revoke, dropPolicy],
  'Only the reviewed recipe DELETE ACL and policy changes are permitted.',
);

assert.match(foundation, /grant insert, update, delete on table public\.recipes to authenticated;/i);
assert.match(foundation, /create policy recipes_admin_delete\s+on public\.recipes for delete\s+to authenticated/i);
assert.match(preflight, /policyname = 'recipes_admin_delete'\s+and policy\.cmd = 'DELETE'/i);
assert.match(preflight, /policy\.cmd in \('DELETE', 'ALL'\)\s+and policy\.policyname <> 'recipes_admin_delete'/i);
assert.match(preflight, /has_table_privilege\('authenticated', 'public\.recipes', 'DELETE'\)\s+is distinct from true/i);
assert.match(preflight, /has_table_privilege\('anon', 'public\.recipes', 'DELETE'\)\s+is not false/i);
assert.match(preflight, /has_table_privilege\('authenticated', 'public\.recipes', 'TRUNCATE'\)\s+is not false/i);
assert.match(preflight, /has_table_privilege\('anon', 'public\.recipes', 'TRUNCATE'\)\s+is not false/i);
assert.match(preflight, /to_regclass\('public\.recipe_collection_items'\)/i);

for (const role of ['anon', 'authenticated']) {
  for (const operation of ['DELETE', 'TRUNCATE']) {
    assert.match(verification, new RegExp(
      `has_table_privilege\\('${role}', 'public\\.recipes', '${operation}'\\)\\s+is not false`, 'i',
    ), `${role} must lack effective recipe ${operation}.`);
  }
}
assert.match(verification, /policy\.cmd in \('DELETE', 'ALL'\)/i);
assert.match(verification, /raise exception 'Browser recipe deletion remains possible'/i);

for (const block of [preflight, verification]) {
  assert.match(block, /relation\.relrowsecurity/i);
  for (const policy of [
    'recipes_read_published', 'recipes_admin_read_all',
    'recipes_admin_insert', 'recipes_admin_update',
  ]) {
    assert.ok(block.includes(`'${policy}'`), `Supported Admin policy ${policy} must survive.`);
  }
  assert.match(block, /policy\.policyname in \([\s\S]*?\)\s*\) <> 4/i);
  assert.match(block, /foreach privilege_name in array array\['SELECT', 'INSERT', 'UPDATE'\] loop/i);
  assert.match(block, /has_table_privilege\('authenticated', 'public\.recipes', privilege_name\)/i);
  assert.match(block, /has_function_privilege\(\s*'anon', 'public\.list_published_recipe_previews_v1\(text,text,integer,integer\)', 'EXECUTE'/i);
  assert.match(block, /has_function_privilege\(\s*'authenticated', 'public\.current_user_is_admin\(\)', 'EXECUTE'/i);
  assert.match(block, /foreach taxonomy_table in array array\['public\.recipe_categories', 'public\.cuisines'\] loop/i);
  assert.match(block, /has_column_privilege\('anon', taxonomy_table, privilege_name, 'SELECT'\)/i);
  for (const column of ['ingredients', 'instructions', 'tutorial_url']) {
    assert.ok(block.includes(`'${column}'`));
  }
  assert.match(block, /has_column_privilege\(\s*'anon', 'public\.recipes', privilege_name, 'SELECT'\s*\) is not false/i);
  assert.match(block, /has_column_privilege\(\s*'authenticated', 'public\.recipes', privilege_name, 'SELECT'\s*\) is distinct from true/i);
  for (const table of ['favorites', 'recipe_collections', 'recipe_collection_items']) {
    assert.ok(block.includes(`'public.${table}'`));
  }
  assert.match(block, /foreach privilege_name in array array\['SELECT', 'INSERT', 'DELETE'\] loop/i);
  assert.match(block, /has_table_privilege\('authenticated', account_table, privilege_name\)/i);
  assert.match(block, /has_column_privilege\(\s*'authenticated', 'public\.recipe_collections', 'name', 'UPDATE'/i);
}

assert.doesNotMatch(sql, /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+(?:table\s+)?|drop\s+table|alter\s+table|create\s+function|create\s+role)\b/i);
assert.doesNotMatch(sql, /\b(?:revoke|grant)\s+[^;]+\s+on\s+table\s+public\.(?:favorites|recipe_collections|recipe_collection_items)\b/i);
assert.match(collections, /grant select, insert, delete on table public\.recipe_collections to authenticated;/i);
assert.match(collections, /grant select, insert, delete on table public\.recipe_collection_items to authenticated;/i);
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
for (const inventory of [PRODUCTION_OUTPUT_FILES, ADMIN_PREVIEW_OUTPUT_FILES]) {
  assert.equal(inventory.includes('supabase/migrations/202611240002_disable_browser_recipe_delete.sql'), false);
  assert.equal(inventory.includes('tests/recipe-delete-hardening-migration.test.mjs'), false);
}

console.log('Static recipe DELETE hardening contract passed; PostgreSQL and API behavior were not executed.');
