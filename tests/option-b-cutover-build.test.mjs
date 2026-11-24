import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { recipes as fullBuiltInRecipes } from '../js/data.js';
import { buildOptionBCandidate } from '../scripts/build-option-b-candidate.mjs';
import { PRODUCTION_OUTPUT_FILES, ADMIN_PREVIEW_OUTPUT_FILES, ADMIN_PREVIEW_FILES } from '../scripts/build-vercel-static.mjs';

const publicConfig = Object.freeze({
  url: 'https://recipefinder-test.supabase.co',
  publishableKey: 'sb_publishable_fake_offline_fixture',
});
const forbiddenPaths = [
  'app.js', 'js/data.js', 'js/fictional-external-recipe-source.js',
  'js/recipe-catalog.js', 'js/recipe-catalog-composition.js',
  'js/dashboard-recipe-catalog-loader.js', 'js/filters.js', 'js/render.js', 'js/modal.js',
];

assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 62);
assert.equal(PRODUCTION_OUTPUT_FILES.includes('js/option-b-app.js'), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes('js/option-b-app.js'), false);
for (const module of ['js/supabase-recipe-collections.js', 'js/recipe-collections-controller.js']) {
  assert.equal(PRODUCTION_OUTPUT_FILES.includes(module), false);
  assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes(module), false);
}
await assert.rejects(buildOptionBCandidate(), /Public Supabase configuration generation failed/);

for (const adminPreview of [false, true]) {
  const output = await buildOptionBCandidate({ publicConfig, adminPreview });
  try {
    assert.match(output.directory, /recipefinder-option-b-/);
    assert.equal(output.files.length, adminPreview ? 63 : 52);
    assert.equal(output.files.includes('js/option-b-app.js'), true);
    assert.equal(output.files.includes('assets/recipefinder-favicon.svg'), true);
    assert.equal(output.files.includes('js/recipe-preview-session.js'), true);
    assert.equal(output.files.includes('js/recipe-login-gate.js'), true);
    assert.equal(output.files.includes('js/supabase-recipe-previews.js'), true);
    assert.equal(output.files.includes('js/supabase-recipe-details.js'), true);
    assert.equal(output.files.includes('js/supabase-recipe-collections.js'), true);
    assert.equal(output.files.includes('js/recipe-collections-controller.js'), true);
    assert.equal(output.files.includes('js/dashboard-account-favorites.js'), true);
    assert.equal(output.files.includes('admin.html'), adminPreview);
    assert.equal(output.files.includes('js/dashboard-admin-link.js'), adminPreview);
    if (!adminPreview) {
      for (const adminFile of ADMIN_PREVIEW_FILES) assert.equal(output.files.includes(adminFile), false,
        `${adminFile} must not be shipped in the Production candidate`);
    }
    for (const path of forbiddenPaths) assert.equal(output.files.includes(path), false, `${path} must be excluded`);

    const html = await readFile(join(output.directory, 'index.html'), 'utf8');
    assert.match(html, /<script type="module" src="js\/option-b-app\.js"><\/script>/);
    assert.doesNotMatch(html, /<script type="module" src="app\.js"><\/script>/);
    assert.match(html, /Search recipe names, descriptions, categories, or cuisines/);
    const login = await readFile(join(output.directory, 'login.html'), 'utf8');
    assert.match(login, /Sign in to view full RecipeFinder recipe details/);
    const config = await readFile(join(output.directory, 'js/supabase-config.js'), 'utf8');
    assert.match(config, new RegExp(`ADMIN_CMS_PREVIEW_AVAILABLE = ${adminPreview};`));
    assert.match(config, /ADMIN_CMS_LOCAL_DEVELOPMENT_AVAILABLE = false;/);

    const javascriptFiles = output.files.filter((path) => path.endsWith('.js'));
    const sources = await Promise.all(javascriptFiles
      .map((path) => readFile(join(output.directory, path), 'utf8')));
    const javascript = sources.join('\n');
    for (let index = 0; index < javascriptFiles.length; index += 1) {
      const path = javascriptFiles[index];
      for (const match of sources[index].matchAll(/['"](\.[^'"]+\.js)['"]/g)) {
        const imported = posix.normalize(posix.join(posix.dirname(path), match[1]));
        if (!adminPreview && imported === 'js/dashboard-admin-link.js') continue;
        assert.equal(output.files.includes(imported), true, `${path} imports missing ${imported}`);
      }
    }
    for (const recipe of fullBuiltInRecipes) {
      assert.equal(javascript.includes(recipe.instructions), false,
        `Built-in instructions for ${recipe.id} must not ship`);
      assert.equal(javascript.includes(recipe.ingredients[0][0]), false,
        `Built-in ingredient payload for ${recipe.id} must not ship`);
    }
    for (const phrase of ['Prepare the couscous, fold in the vegetables',
      'Cook the noodles, toss with citrus dressing', 'Season the chicken, grill until cooked',
      'Arrange pears in the pastry shell', 'Cook the fish, arrange over rice',
      'Toast the bread and top with seasoned tomatoes']) {
      assert.equal(javascript.includes(phrase), false, 'Fictional full details must not ship');
    }
    assert.doesNotMatch(javascript, /\.ingredients\.flat\(\)/,
      'Guest search must not index ingredients');
    assert.match(javascript, /requestRecipeFinderPreviewDetail/);
    assert.match(javascript, /requestPublicMealDbDetail/);
    assert.match(javascript, /createRecipeLoginGate/);
    assert.match(javascript, /createRecipeCollectionsController/);
    assert.doesNotMatch(javascript, /localStorage\.setItem\([^\n]*collection/i);
  } finally {
    await rm(output.directory, { recursive: true, force: true });
  }
}
console.log('Separate Option B candidate builds passed actual offline artifact inspection.');
