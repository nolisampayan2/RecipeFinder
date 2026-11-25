import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CONFIG_GENERATION_ERROR,
  GENERATED_CONFIG_PATH,
  generatePublicSupabaseConfig,
  renderPublicSupabaseConfig,
  resolvePublicSupabaseConfig,
} from '../scripts/generate-supabase-config.mjs';

const url = 'https://recipefinder-test.supabase.co';
const publishableKey = 'sb_publishable_test_abcdefghijklmnopqrstuvwxyz';
const anonKey = 'legacy-anon-key-for-browser-testing-only';

assert.deepEqual(resolvePublicSupabaseConfig({
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: publishableKey,
}), { url, publishableKey });

assert.deepEqual(resolvePublicSupabaseConfig({
  SUPABASE_URL: url,
  SUPABASE_ANON_KEY: anonKey,
}), { url, publishableKey: anonKey });

assert.throws(
  () => resolvePublicSupabaseConfig({}),
  (error) => error.message === CONFIG_GENERATION_ERROR
);
assert.throws(
  () => resolvePublicSupabaseConfig(new Proxy({}, {
    get() {
      throw new Error('private environment getter details');
    },
  })),
  (error) => error.message === CONFIG_GENERATION_ERROR
    && !/private|getter/i.test(error.message)
);
assert.throws(
  () => resolvePublicSupabaseConfig({
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_ANON_KEY: anonKey,
  }),
  (error) => error.message === CONFIG_GENERATION_ERROR
);
assert.throws(
  () => resolvePublicSupabaseConfig({
    SUPABASE_URL: 'http://recipefinder-test.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
  }),
  (error) => error.message === CONFIG_GENERATION_ERROR
);
assert.throws(
  () => resolvePublicSupabaseConfig({
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private_value_forbidden',
  }),
  (error) => error.message === CONFIG_GENERATION_ERROR
);
assert.throws(
  () => resolvePublicSupabaseConfig({
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: 'service_role_private_value_forbidden',
  }),
  (error) => error.message === CONFIG_GENERATION_ERROR
);

const privilegedPayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
assert.throws(
  () => resolvePublicSupabaseConfig({
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: `header.${privilegedPayload}.signature-value`,
  }),
  (error) => error.message === CONFIG_GENERATION_ERROR
);

const rendered = renderPublicSupabaseConfig({ url, publishableKey });
assert.match(rendered, /ADMIN_CMS_PREVIEW_AVAILABLE = false/);
assert.match(rendered, /ADMIN_CMS_LOCAL_DEVELOPMENT_AVAILABLE = false/);
assert.match(renderPublicSupabaseConfig({ url, publishableKey }, { adminPreviewAvailable: true }), /ADMIN_CMS_PREVIEW_AVAILABLE = true/);
assert.match(renderPublicSupabaseConfig({ url, publishableKey }, { adminPreviewAvailable: true }), /ADMIN_CMS_LOCAL_DEVELOPMENT_AVAILABLE = false/);
assert.match(renderPublicSupabaseConfig({ url, publishableKey }, { adminLocalDevelopmentAvailable: true }), /ADMIN_CMS_LOCAL_DEVELOPMENT_AVAILABLE = false/);
assert.match(rendered, /Generated public browser configuration/);
assert.ok(rendered.includes(JSON.stringify(url)));
assert.ok(rendered.includes(JSON.stringify(publishableKey)));
assert.doesNotMatch(rendered, /service_role|sb_secret_/i);

let writeCall;
const generated = await generatePublicSupabaseConfig({
  environment: {
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    UNRELATED_PRIVATE_VALUE: 'must-never-be-rendered',
  },
  outputPath: 'virtual/js/supabase-config.js',
  async writeFileImpl(...args) {
    writeCall = args;
  },
});

assert.equal(generated.outputPath, 'virtual/js/supabase-config.js');
assert.ok(generated.bytes > 0);
assert.equal(writeCall[0], 'virtual/js/supabase-config.js');
assert.match(writeCall[1], /ADMIN_CMS_PREVIEW_AVAILABLE = false/);
assert.match(writeCall[1], /ADMIN_CMS_LOCAL_DEVELOPMENT_AVAILABLE = false/);
assert.doesNotMatch(writeCall[1], /must-never-be-rendered/);
assert.deepEqual(writeCall[2], {
  encoding: 'utf8',
  flag: 'wx',
  mode: 0o600,
});

await assert.rejects(
  generatePublicSupabaseConfig({
    environment: { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publishableKey },
    outputPath: 'virtual/js/supabase-config.js',
    async writeFileImpl() {
      const error = new Error('private path and platform details');
      error.code = 'EEXIST';
      throw error;
    },
  }),
  (error) => error.message === CONFIG_GENERATION_ERROR
);

const scriptSource = await readFile(new URL('../scripts/generate-supabase-config.mjs', import.meta.url), 'utf8');
assert.match(scriptSource, /flag: 'wx'/);
assert.doesNotMatch(scriptSource, /PGPASSWORD|service[_-]?role\s*[:=]/i);
assert.match(GENERATED_CONFIG_PATH.replaceAll('\\', '/'), /\/js\/supabase-config\.js$/);
