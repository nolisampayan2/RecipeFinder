import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';

const sql = await readFile(new URL('../supabase/drafts/202611230003_recipe_image_objects_draft.sql', import.meta.url), 'utf8');
const policyPlan = await readFile(new URL('../supabase/recipe-image-storage-policy-draft.md', import.meta.url), 'utf8');
const foundation = await readFile(new URL('../supabase/migrations/202610270001_recipefinder_foundation.sql', import.meta.url), 'utf8');
const migrations = await readdir(new URL('../supabase/migrations/', import.meta.url));

assert.equal(migrations.some((name) => name.includes('recipe_image_objects')), false,
  'Unfinished image SQL must remain outside executable migrations');
assert.match(sql, /ARCHIVED OFFLINE DESIGN FOR PHASE 6/);

assert.equal((sql.match(/^begin;$/gm) ?? []).length, 1);
assert.equal((sql.match(/^commit;$/gm) ?? []).length, 1);
const guard = /do \$blocked\$\s*begin\s*raise exception 'Recipe image infrastructure is an unverified offline draft';\s*end;\s*\$blocked\$;/;
const block = sql.search(guard);
const firstDdl = sql.indexOf('alter table public.recipes');
assert.ok(block >= 0 && firstDdl > block, 'An accidental migration attempt fails before any schema change');
assert.match(sql, /add constraint recipes_id_source_type_for_images unique \(id, source_type\)/);
assert.match(sql, /recipe_source_type text not null default 'cms' check \(recipe_source_type = 'cms'\)/);
assert.match(sql, /foreign key \(recipe_id, recipe_source_type\)[\s\S]*?references public\.recipes \(id, source_type\) on update restrict on delete restrict/);
assert.match(sql, /kind text not null check \(kind in \('draft', 'published'\)\)/);
assert.match(sql, /state text not null check \(state in \('pending', 'active', 'retired'\)\)/);
assert.match(sql, /content_sha256 text not null check \(content_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/);
assert.match(sql, /content_type text not null check \(content_type in \('image\/jpeg', 'image\/png', 'image\/webp'\)\)/);
assert.match(sql, /request_id uuid not null unique/);
assert.match(sql, /object_path text not null unique/);
assert.match(sql, /left\(object_path, char_length\('cms\/' \|\| recipe_id \|\| '\/'\)\) = 'cms\/' \|\| recipe_id \|\| '\/'/);
assert.match(sql, /recipe_image_objects_one_active_per_kind[\s\S]*?\(recipe_id, kind\)[\s\S]*?where state = 'active'/);
assert.match(sql, /recipe_image_objects_reconcile[\s\S]*?\(state, created_at\)/);
assert.match(sql, /from public\.recipes where id = new\.recipe_id for update/);
assert.match(sql, /recipe_source is distinct from 'cms'/);
assert.match(sql, /new\.kind = 'published' and recipe_status is distinct from 'published'/);
assert.match(sql, /Recipe image object identity is immutable/);
assert.match(sql, /old\.state = 'pending' and new\.state in \('active', 'retired'\)/);
assert.match(sql, /old\.state = 'active' and new\.state = 'retired'/);
assert.match(sql, /alter table public\.recipe_image_objects enable row level security/);
assert.match(sql, /revoke all on table public\.recipe_image_objects from public, anon, authenticated/);
assert.match(sql, /grant select, insert, update, delete on table public\.recipe_image_objects to service_role/);
assert.match(sql, /create policy recipe_image_objects_server_only[\s\S]*?to service_role/);
assert.doesNotMatch(sql, /\b(?:drop|truncate|delete\s+from|update\s+public\.recipes)\b/i);
assert.doesNotMatch(sql, /\bstorage\.(?:buckets|objects)\b/i, 'Unverified Storage catalog is not modified');
assert.doesNotMatch(sql, /grant\s+[^;]*\s+to\s+(?:anon|authenticated|public)\b/i);
assert.match(foundation, /image_url text not null/);
assert.match(foundation, /grant insert, update, delete on table public\.recipes to authenticated/,
  'Existing broad status-update privilege needs a separate coordinated review');

for (const phrase of [
  'recipe-draft-images', 'recipe-published-images', 'Private', 'Public',
  'image/jpeg', 'image/png', 'image/webp', '5 MiB',
  'No direct Storage writes', 'server-managed Admin',
  'placeholder', 'reference-aware reconciliation',
]) assert.ok(policyPlan.includes(phrase), `Policy draft documents ${phrase}`);
assert.match(policyPlan, /No Storage policy SQL, trusted upload function/);
assert.match(policyPlan, /image selection foundation is complete but inactive/);
assert.match(policyPlan, /Storage infrastructure remains incomplete/);
assert.match(policyPlan, /Trusted image decoding and\s+publication coordination are unresolved/);
assert.match(policyPlan, /Image uploader completion is explicitly deferred\s+to Phase 6/);
assert.match(policyPlan, /Existing manual image URL behavior is\s+unchanged/);
assert.match(policyPlan, /Neither\s+draft is approved for execution/);
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
for (const path of [
  'supabase/drafts/202611230003_recipe_image_objects_draft.sql',
  'supabase/recipe-image-storage-policy-draft.md',
  'tests/recipe-image-infrastructure-draft.test.mjs',
]) {
  assert.equal(PRODUCTION_OUTPUT_FILES.includes(path), false);
  assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes(path), false);
}

console.log('Static archived image-infrastructure draft checks passed; PostgreSQL, Storage, and Edge runtime behavior remain unverified.');
