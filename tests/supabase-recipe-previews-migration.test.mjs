import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';

const migration = await readFile(
  new URL('../supabase/migrations/202611230001_published_recipe_preview_rpc.sql', import.meta.url),
  'utf8',
);
const functionName = 'public.list_published_recipe_previews_v1';
const expectedFields = [
  'id',
  'name',
  'description',
  'category',
  'cuisine',
  'image_url',
  'fallback_image_url',
  'source_type',
  'external_provider',
  'external_id',
];

assert.equal((migration.match(/create\s+or\s+replace\s+function\s+public\.list_published_recipe_previews_v1/gi) ?? []).length, 1);
assert.match(
  migration,
  /create\s+or\s+replace\s+function\s+public\.list_published_recipe_previews_v1\(\s*p_search\s+text\s+default\s+null\s*,\s*p_filter\s+text\s+default\s+null\s*,\s*p_limit\s+integer\s+default\s+25\s*,\s*p_offset\s+integer\s+default\s+0\s*\)/i,
);

const returnBlock = migration.match(/returns\s+table\s*\(([^)]*)\)/i)?.[1];
assert.ok(returnBlock, 'RPC must declare a fixed table return schema');
const actualFields = returnBlock
  .split(',')
  .map((field) => field.trim().match(/^([a-z_]+)\s+text$/i)?.[1]);
assert.deepEqual(actualFields, expectedFields);
assert.doesNotMatch(returnBlock, /ingredients|instructions|tutorial_url|created_by|created_at|updated_at|published_at|category_id|cuisine_id/i);

assert.match(migration, /language\s+plpgsql\s+stable\s+security\s+invoker\s+set\s+search_path\s*=\s*''/i);
assert.match(migration, /from\s+public\.recipes\s+as\s+recipe/i);
assert.match(migration, /join\s+public\.recipe_categories\s+as\s+category_row/i);
assert.match(migration, /join\s+public\.cuisines\s+as\s+cuisine_row/i);
assert.match(migration, /recipe\.status\s*=\s*'published'/i);
assert.match(migration, /category_row\.is_active/i);
assert.match(migration, /cuisine_row\.is_active/i);
const trimSetMatch = migration.match(/js_trim_characters\s+constant\s+text\s*:=\s*U&'([^']+)'/i);
assert.ok(trimSetMatch, 'SQL must declare an explicit PostgreSQL Unicode trim character set');
const javascriptTrimCodePoints = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
const expectedTrimEscapes = javascriptTrimCodePoints
  .map((codePoint) => `\\${codePoint.toString(16).padStart(4, '0').toUpperCase()}`)
  .join('');
assert.equal(trimSetMatch[1], expectedTrimEscapes);
assert.equal(String.fromCodePoint(...javascriptTrimCodePoints).trim(), '');
assert.equal('\u00a0'.trim(), '');
assert.equal('\u2003\ufeff'.trim(), '');
assert.match(migration, /normalized_search\s*:=\s*nullif\(btrim\(coalesce\(p_search, ''\),\s*js_trim_characters\), ''\)/i);
assert.match(migration, /normalized_filter\s*:=\s*nullif\(btrim\(coalesce\(p_filter, ''\),\s*js_trim_characters\), ''\)/i);
for (const previewTextField of [
  'recipe.name',
  'recipe.description',
  'category_row.name',
  'cuisine_row.name',
]) {
  assert.match(migration, new RegExp(`btrim\\(${previewTextField.replace('.', '\\.')}\\s*,\\s*js_trim_characters\\)\\s*<>\\s*''`, 'i'));
  assert.match(migration, new RegExp(`${previewTextField.replace('.', '\\.')}\\s*!~\\s*'\\[\\[:cntrl:\\]\\]'`, 'i'));
}
assert.doesNotMatch(migration, /\bexecute\s+[^o]/i, 'RPC must not use dynamic SQL');

assert.match(migration, /p_limit\s*<\s*1\s+or\s+p_limit\s*>\s*51/i);
assert.match(migration, /p_offset\s*<\s*0\s+or\s+p_offset\s*>\s*10000/i);
assert.match(migration, /char_length\(coalesce\(normalized_search, ''\)\)\s*>\s*100/i);
assert.match(migration, /char_length\(coalesce\(normalized_filter, ''\)\)\s*>\s*80/i);
assert.match(migration, /strpos\s*\(/i);
assert.match(migration, /concat_ws\s*\(\s*' '\s*,\s*recipe\.name\s*,\s*recipe\.description\s*,\s*category_row\.name\s*,\s*cuisine_row\.name/i);
assert.match(migration, /lower\(category_row\.name\)\s*=\s*pg_catalog\.lower\(normalized_filter\)/i);
assert.match(migration, /lower\(cuisine_row\.name\)\s*=\s*pg_catalog\.lower\(normalized_filter\)/i);
assert.match(migration, /order\s+by\s+pg_catalog\.lower\(recipe\.name\)\s+collate\s+"C"\s*,\s*recipe\.id\s+collate\s+"C"/i);
assert.match(migration, /limit\s+p_limit\s+offset\s+p_offset/i);

assert.match(migration, /recipe\.source_type\s+in\s*\('seed',\s*'cms'\)/i);
assert.match(migration, /recipe\.id\s*~\s*'\^\[a-z0-9\]\[a-z0-9:_-\]\{0,199\}\$'/i);
assert.match(migration, /recipe\.id\s+not\s+like\s+'external:%'/i);
assert.match(migration, /recipe\.external_provider\s+is\s+null/i);
assert.match(migration, /recipe\.external_id\s+is\s+null/i);
assert.match(migration, /recipe\.source_type\s*=\s*'external'/i);
assert.match(migration, /recipe\.external_provider\s*=\s*'fictional-offline'/i);
assert.match(migration, /recipe\.external_id\s+~\s+'\^\[0-9\]\+\$'/i);
assert.match(migration, /recipe\.id\s*=\s*'external:fictional-offline:'\s*\|\|\s*recipe\.external_id/i);

const exactSignature = `${functionName}(text, text, integer, integer)`;
const normalizedSql = migration.toLowerCase().replace(/\s+/g, ' ');
assert.ok(normalizedSql.includes(`revoke all on function ${exactSignature} from public, anon, authenticated, service_role`));
assert.ok(normalizedSql.includes(`grant execute on function ${exactSignature} to anon, authenticated`));
assert.match(migration, /comment\s+on\s+function\s+public\.list_published_recipe_previews_v1\(text,\s*text,\s*integer,\s*integer\)/i);
assert.doesNotMatch(migration, /\b(revoke|grant)\b[^;]*(?:table|schema|sequence)|\b(create|alter|drop)\s+policy\b|\balter\s+table\b/i);
assert.doesNotMatch(migration, /\b(insert\s+into|update\s+public\.|delete\s+from|truncate\s+|drop\s+function)\b/i);
assert.doesNotMatch(migration, /\bexecute\s+format\s*\(/i);

assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
assert.equal(PRODUCTION_OUTPUT_FILES.includes('js/supabase-recipe-previews.js'), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes('js/supabase-recipe-previews.js'), false);
assert.equal(PRODUCTION_OUTPUT_FILES.some((path) => path.startsWith('supabase/')), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.some((path) => path.startsWith('supabase/')), false);

const client = await readFile(new URL('../js/supabase-recipe-previews.js', import.meta.url), 'utf8');
assert.match(client, /list_published_recipe_previews_v1/);
assert.match(client, /p_limit:\s*request\.pageSize\s*\+\s*1/);
assert.match(client, /p_offset:\s*request\.offset/);

console.log('Static additive preview-RPC migration contract checks passed; SQL was not executed.');
