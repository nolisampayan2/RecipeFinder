import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PRODUCTION_OUTPUT_FILES, ADMIN_PREVIEW_OUTPUT_FILES } from '../scripts/build-vercel-static.mjs';

const sql = await readFile(new URL('../supabase/migrations/202611240001_recipe_collections.sql', import.meta.url), 'utf8');
assert.equal((sql.match(/^begin;$/gmi) ?? []).length, 1);
assert.equal((sql.match(/^commit;$/gmi) ?? []).length, 1);
for (const name of ['recipe_collections', 'recipe_collection_items']) {
  assert.match(sql, new RegExp(`create table public\\.${name} \\(`));
  assert.match(sql, new RegExp(`alter table public\\.${name} enable row level security;`));
  assert.match(sql, new RegExp(`revoke all on table public\\.${name} from public, anon, authenticated;`));
  assert.doesNotMatch(sql, new RegExp(`grant [^;]+ on table public\\.${name} to anon;`));
}
assert.match(sql, /user_id uuid not null references auth\.users \(id\) on delete cascade/);
assert.match(sql, /collection_id uuid not null references public\.recipe_collections \(id\) on delete cascade/);
assert.match(sql, /recipe_id text references public\.recipes \(id\) on delete cascade/);
assert.match(sql, /constraint recipe_collection_items_one_source check/);
assert.match(sql, /constraint recipe_collection_items_owned_unique unique \(collection_id, recipe_id\)/);
assert.match(sql, /constraint recipe_collection_items_mealdb_unique unique \(collection_id, mealdb_id\)/);
assert.match(sql, /grant update \(name\) on table public\.recipe_collections to authenticated;/);
assert.doesNotMatch(sql, /grant update on table public\.recipe_collections/);
for (const policy of ['recipe_collections_select_own', 'recipe_collections_insert_own',
  'recipe_collections_update_own', 'recipe_collections_delete_own',
  'recipe_collection_items_select_own', 'recipe_collection_items_insert_own',
  'recipe_collection_items_delete_own']) assert.match(sql, new RegExp(`create policy ${policy}`));
assert.match(sql, /collection\.user_id = \(select auth\.uid\(\)\)/);
assert.match(sql, /recipe\.status = 'published'/);
assert.match(sql, /recipe\.external_provider = 'fictional-offline'/);
assert.doesNotMatch(sql, /\b(?:truncate|drop table|alter table public\.recipes|alter table public\.favorites|update public\.recipes|delete from public\.recipes)\b/i);
for (const inventory of [PRODUCTION_OUTPUT_FILES, ADMIN_PREVIEW_OUTPUT_FILES]) {
  assert.equal(inventory.some((entry) => entry.includes('collection')), false);
}
console.log('Static Collections schema, grants, RLS, uniqueness, and isolation checks passed; SQL was not executed.');
