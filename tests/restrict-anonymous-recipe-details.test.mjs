import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';

const migration = await readFile(
  new URL('../supabase/testing-migrations/202611230002_recipe_detail_seed_data.sql', import.meta.url),
  'utf8',
);
const runbook = await readFile(new URL('../supabase/README.md', import.meta.url), 'utf8');
const payloadMatch = migration.match(/\$recipes\$([\s\S]*?)\$recipes\$::jsonb/i);
assert.ok(payloadMatch, 'The unchanged recipe payload must be present.');
assert.equal(
  createHash('sha256').update(payloadMatch[1], 'utf8').digest('hex'),
  'dc0d342e3a0cf736465af1e8a0829967dab7a2950899b33e4e838ca2b8f06855',
  'The reviewed 16-recipe payload must remain byte-identical.',
);

const sql = migration.replace(payloadMatch[0], '$recipes$PAYLOAD$recipes$::jsonb')
  .replace(/^--[^\n]*(?:\n|$)/gm, '');
const safeColumns = [
  'id', 'name', 'description', 'category_id', 'cuisine_id', 'image_url',
  'fallback_image_url', 'status', 'source_type', 'external_provider', 'external_id',
];
const protectedColumns = [
  'tutorial_url', 'ingredients', 'instructions', 'created_by',
  'published_at', 'created_at', 'updated_at',
];
const allColumns = [
  'id', 'name', 'description', 'category_id', 'cuisine_id', 'image_url',
  'fallback_image_url', 'tutorial_url', 'ingredients', 'instructions',
  'status', 'source_type', 'external_provider', 'external_id', 'created_by',
  'published_at', 'created_at', 'updated_at',
];
const columns = (value) => value.split(',').map((item) => item.trim().toLowerCase());

assert.equal((sql.match(/^begin;$/gim) ?? []).length, 1);
assert.equal((sql.match(/^commit;$/gim) ?? []).length, 1);
assert.match(sql, /^\s*begin;[\s\S]*commit;\s*$/i);
const positions = [
  'do $preflight$',
  'revoke select on table public.recipes from public, anon;',
  'revoke select (',
  'grant select (',
  'do $verify_restriction$',
  'do $migration$',
  'insert into public.recipes',
  'commit;',
].map((needle) => sql.toLowerCase().indexOf(needle));
assert.ok(positions.every((position) => position >= 0));
assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]));
assert.match(sql, /lock\s+table\s+public\.recipes\s+in\s+share\s+row\s+exclusive\s+mode/i);

const dcl = [...sql.matchAll(/\b(?:revoke|grant)\s+select(?:\s*\([\s\S]*?\))?\s+on\s+table\s+public\.recipes\s+(?:from|to)\s+[^;]+;/gi)]
  .map(([statement]) => statement);
assert.equal(dcl.length, 3, 'Only the reviewed direct recipe SELECT ACL changes are allowed.');
assert.match(dcl[0], /^revoke\s+select\s+on\s+table\s+public\.recipes\s+from\s+public,\s*anon;$/i);
const revokedColumns = dcl[1].match(/revoke\s+select\s*\(([^)]*)\)/i)?.[1];
const grantedColumns = dcl[2].match(/grant\s+select\s*\(([^)]*)\)/i)?.[1];
assert.ok(revokedColumns && grantedColumns);
assert.deepEqual(columns(revokedColumns), allColumns);
assert.deepEqual(columns(grantedColumns), safeColumns);
assert.match(dcl[1], /on\s+table\s+public\.recipes\s+from\s+public,\s*anon;$/i);
assert.match(dcl[2], /on\s+table\s+public\.recipes\s+to\s+anon;$/i);
assert.doesNotMatch(sql, /\bgrant\s+select\s+on\s+table\s+public\.recipes\s+to\s+(?:anon|public)\b/i);
assert.equal((sql.match(/\b(?:revoke|grant)\b/gi) ?? []).length, 3);

assert.match(sql, /to_regclass\('public\.recipes'\)/i);
assert.match(sql, /to_regprocedure\('public\.list_published_recipe_previews_v1\(text,text,integer,integer\)'\)/i);
assert.match(sql, /procedure\.prosecdef/i);
assert.match(sql, /has_function_privilege\(\s*'anon',\s*'public\.list_published_recipe_previews_v1\(text,text,integer,integer\)',\s*'EXECUTE'/i);
assert.match(sql, /actual_columns\s+is\s+distinct\s+from\s+array\[/i);
assert.match(sql, /relation\.relrowsecurity/i);
assert.match(sql, /pg_catalog\.pg_policies/i);
assert.match(sql, /has_table_privilege\('authenticated',\s*'public\.recipes',\s*field_name\)/i);
assert.match(sql, /has_column_privilege\('authenticated',\s*'public\.recipes',\s*field_name,\s*'SELECT'\)/i);
assert.match(sql, /has_column_privilege\('anon',\s*'public\.recipes',\s*field_name,\s*'SELECT'\)/i);
assert.match(sql, /has_column_privilege\('anon',\s*taxonomy_table,\s*field_name,\s*'SELECT'\)/i);

const verify = sql.match(/do\s+\$verify_restriction\$([\s\S]*?)\$verify_restriction\$;/i)?.[1];
assert.ok(verify, 'Effective privileges must be checked before the insert block.');
const loops = [...verify.matchAll(/foreach\s+field_name\s+in\s+array\s+array\[([^\]]*)\]\s+loop/gi)]
  .map(([, value]) => [...value.matchAll(/'([^']+)'/g)].map(([, name]) => name));
assert.deepEqual(loops.slice(0, 3), [safeColumns, protectedColumns, allColumns]);
assert.match(verify, /has_column_privilege\('anon',\s*'public\.recipes',\s*field_name,\s*'SELECT'\)\s+is\s+not\s+false/i);
assert.match(verify, /raise\s+exception\s+'Anonymous protected recipe column access remains effective'/i);
assert.match(verify, /has_column_privilege\('authenticated',\s*'public\.recipes',\s*field_name,\s*'SELECT'\)\s+is\s+distinct\s+from\s+true/i);
assert.match(verify, /has_table_privilege\('authenticated',\s*'public\.recipes',\s*field_name\)/i);
assert.match(verify, /has_column_privilege\('anon',\s*taxonomy_table,\s*field_name,\s*'SELECT'\)/i);
assert.match(verify, /has_table_privilege\('authenticated',\s*taxonomy_table,\s*field_name\)/i);
assert.match(verify, /has_table_privilege\('authenticated',\s*'public\.favorites',\s*field_name\)/i);
assert.match(sql, /favorites_select_own/);
assert.match(sql, /recipes_admin_insert/);
assert.doesNotMatch(sql, /\bsecurity\s+definer\b|\b(?:delete\s+from|truncate|update\s+public\.recipes|alter\s+table|create\s+policy|drop\s+policy)\b/i);
assert.doesNotMatch(sql, /\b(?:insert\s+into|update|delete\s+from)\s+public\.favorites\b/i);
assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+(?:table|function|schema|policy|role|view|materialized|trigger|index)\b/i);
assert.deepEqual([...sql.matchAll(/\binsert\s+into\s+([a-z0-9_.]+)/gi)].map(([, table]) => table), ['public.recipes']);

assert.match(runbook, /version\s+`202611230002`\s+must\s+be\s+\*\*unapplied\*\*/i);
assert.match(runbook, /forward-only recovery/i);
assert.match(runbook, /PostgreSQL runtime validation/i);
assert.match(runbook, /Do not repair a failed cutover by restoring anonymous full-detail SELECT/i);
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
for (const inventory of [PRODUCTION_OUTPUT_FILES, ADMIN_PREVIEW_OUTPUT_FILES]) {
  assert.equal(inventory.some((path) => path.startsWith('supabase/') || path.startsWith('tests/')), false);
}

console.log('Static conditional-cutover checks passed; effective PostgreSQL privileges and transaction behavior were not executed or proven.');
