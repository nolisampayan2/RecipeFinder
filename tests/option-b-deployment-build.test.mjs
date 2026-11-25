import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildOptionBDeployment } from '../scripts/build-option-b-deployment.mjs';
import { recipes as legacyRecipes } from '../js/data.js';
import { FICTIONAL_RECIPE_PREVIEWS } from './fixtures/fictional-recipe-previews.mjs';

const environment = Object.freeze({
  SUPABASE_URL: 'https://synthetic-project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_offline_fixture',
  VERCEL_ENV: 'production',
});
const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(vercel.buildCommand, 'node scripts/build-option-b-deployment.mjs');
assert.equal(vercel.outputDirectory, 'dist');

for (const scenario of [
  { adminPreview: false, environment },
  { adminPreview: false, environment: { ...environment, ENABLE_ADMIN_CMS_PREVIEW: 'true' } },
  { adminPreview: true, environment: { ...environment, VERCEL_ENV: 'preview', ENABLE_ADMIN_CMS_PREVIEW: 'true' } },
]) {
  const { adminPreview } = scenario;
  const parent = await mkdtemp(join(tmpdir(), 'recipefinder-release-build-'));
  try {
    const output = await buildOptionBDeployment({
      environment: scenario.environment,
      outputDirectory: resolve(parent, 'dist'),
    });
    assert.equal(output.files.length, adminPreview ? 63 : 52);
    assert.equal(output.files.includes('admin.html'), adminPreview);
    assert.equal(output.files.includes('js/admin-browser.js'), adminPreview);
    assert.equal(output.files.includes('js/dashboard-admin-link.js'), adminPreview);
    for (const path of [
      'app.js', 'js/data.js', 'js/fictional-external-recipe-source.js',
      'js/supabase-recipe-source.js', 'js/recipe-catalog.js',
      'tests/fixtures/fictional-recipe-previews.mjs',
    ]) assert.equal(output.files.includes(path), false, `${path} must not ship`);
    for (const path of [
      'index.html', 'login.html', 'register.html', 'verify-email.html',
      'auth-callback.html', 'forgot-password.html', 'reset-password.html',
      'js/option-b-app.js',
    ]) assert.equal(output.files.includes(path), true, `${path} must ship`);

    const content = (await Promise.all(output.files
      .filter((path) => path.endsWith('.js') || path.endsWith('.html'))
      .map((path) => readFile(resolve(output.outputDirectory, path), 'utf8')))).join('\n');
    for (const recipe of legacyRecipes) {
      assert.equal(content.includes(recipe.instructions), false,
        `Legacy full instructions for ${recipe.id} must not ship`);
    }
    for (const fixture of FICTIONAL_RECIPE_PREVIEWS) {
      for (const value of [fixture.id, fixture.name, fixture.description]) {
        assert.equal(content.includes(value), false, `Fictional fixture ${fixture.id} must not ship`);
      }
    }
    assert.equal(content.includes('BEGIN PRIVATE KEY'), false);
    const index = await readFile(resolve(output.outputDirectory, 'index.html'), 'utf8');
    assert.match(index, /src="js\/option-b-app\.js"/);
    const config = await readFile(resolve(output.outputDirectory, 'js/supabase-config.js'), 'utf8');
    assert.match(config, new RegExp(`ADMIN_CMS_PREVIEW_AVAILABLE = ${adminPreview};`));
    assert.equal(config.includes('sb_secret_'), false);
    assert.equal(config.includes('service_role'), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

console.log('Normal Vercel Option B Production and Admin Preview artifacts passed offline checks.');
