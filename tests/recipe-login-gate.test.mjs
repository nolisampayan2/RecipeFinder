import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
} from '../scripts/build-vercel-static.mjs';
import {
  RECIPE_DETAIL_ACCESS,
  classifyRecipeDetailAccess,
  createRecipeLoginGate,
} from '../js/recipe-login-gate.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const modulePath = 'js/recipe-login-gate.js';
const USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const guest = Object.freeze({ status: 'guest' });
const authenticated = Object.freeze({ status: 'authenticated', userId: USER_ID });

const builtIn = Object.freeze({
  id: 'creamy-garlic-pasta', source: 'built-in', detailLevel: 'preview', name: 'Creamy Garlic Pasta',
});
const database = Object.freeze({
  id: 'cms:11111111-2222-4333-8444-555555555555', source: 'database', detailLevel: 'preview', name: 'CMS Adobo',
});
const seedDatabase = Object.freeze({
  id: 'seed-adobo', source: 'database', detailLevel: 'preview', name: 'Seed Adobo',
});
const fictional = Object.freeze({
  id: 'external:fictional-offline:990001', externalId: '990001', source: 'external',
  externalProvider: 'fictional-offline', detailLevel: 'summary', name: 'Aurora Garden Couscous',
});
const mealDb = Object.freeze({
  id: 'external:themealdb:52772', externalId: '52772', source: 'external',
  externalProvider: 'themealdb', detailLevel: 'full', name: 'Teriyaki Chicken Casserole',
});

for (const recipe of [builtIn, database, seedDatabase, fictional]) {
  assert.equal(classifyRecipeDetailAccess(recipe, guest), RECIPE_DETAIL_ACCESS.REQUIRES_LOGIN);
  assert.equal(
    classifyRecipeDetailAccess(recipe, authenticated),
    RECIPE_DETAIL_ACCESS.AUTHENTICATED_RECIPEFINDER_DETAIL
  );
}
assert.equal(classifyRecipeDetailAccess(mealDb, guest), RECIPE_DETAIL_ACCESS.PUBLIC_EXTERNAL_DETAIL);
assert.equal(classifyRecipeDetailAccess(mealDb, { status: 'error' }), RECIPE_DETAIL_ACCESS.PUBLIC_EXTERNAL_DETAIL);

for (const malformed of [
  { ...mealDb, id: 'external:themealdb:not-digits' },
  { ...mealDb, externalId: '99999' },
  { ...mealDb, externalProvider: 'unknown' },
  { ...mealDb, detailLevel: 'summary' },
  { ...fictional, externalProvider: 'themealdb' },
  { ...fictional, detailLevel: 'full' },
  { ...database, id: 'external:themealdb:52772' },
  { ...database, externalProvider: 'themealdb' },
  { ...builtIn, detailLevel: 'full' },
  null,
]) {
  assert.equal(classifyRecipeDetailAccess(malformed, authenticated), RECIPE_DETAIL_ACCESS.DENIED);
}

for (const state of [{ status: 'loading' }, { status: 'pending-confirmation' }]) {
  assert.equal(classifyRecipeDetailAccess(database, state), RECIPE_DETAIL_ACCESS.PENDING_AUTH);
}
const internalColonDatabase = Object.freeze({ ...database, id: 'cms:regional:adobo' });
assert.equal(
  classifyRecipeDetailAccess(internalColonDatabase, guest),
  RECIPE_DETAIL_ACCESS.REQUIRES_LOGIN
);
assert.equal(
  classifyRecipeDetailAccess({ ...database, id: `a${'b'.repeat(199)}` }, guest),
  RECIPE_DETAIL_ACCESS.REQUIRES_LOGIN
);
for (const invalidDatabaseId of [
  `a${'b'.repeat(200)}`,
  'CMS:11111111-2222-4333-8444-555555555555',
  ' cms:11111111-2222-4333-8444-555555555555',
  'cms:11111111-2222-4333-8444-555555555555 ',
  'cms:\u0000private',
  'external:themealdb:52772',
  'external:fictional-offline:990001',
  'external:unknown:1',
]) {
  assert.equal(
    classifyRecipeDetailAccess({ ...database, id: invalidDatabaseId }, authenticated),
    RECIPE_DETAIL_ACCESS.DENIED
  );
}
for (const state of [
  { status: 'error' }, {}, null, { status: 'authenticated', userId: 'invalid' },
]) {
  assert.equal(classifyRecipeDetailAccess(database, state), RECIPE_DETAIL_ACCESS.DENIED);
}
let userIdReads = 0;
let statusReads = 0;
assert.equal(classifyRecipeDetailAccess(database, {
  get status() { statusReads += 1; return 'authenticated'; },
  get userId() { userIdReads += 1; return USER_ID; },
}), RECIPE_DETAIL_ACCESS.AUTHENTICATED_RECIPEFINDER_DETAIL);
assert.equal(statusReads, 1);
assert.equal(userIdReads, 1);
let changingUserIdReads = 0;
assert.equal(classifyRecipeDetailAccess(database, {
  status: 'authenticated',
  get userId() {
    changingUserIdReads += 1;
    return changingUserIdReads === 1 ? USER_ID : 'invalid';
  },
}), RECIPE_DETAIL_ACCESS.AUTHENTICATED_RECIPEFINDER_DETAIL);
assert.equal(changingUserIdReads, 1);
assert.equal(classifyRecipeDetailAccess(database, {
  status: 'authenticated',
  get userId() { throw new Error('private getter message'); },
}), RECIPE_DETAIL_ACCESS.DENIED);
assert.doesNotThrow(() => {
  assert.equal(classifyRecipeDetailAccess(database, {
    get status() { throw new Error('private status getter message'); },
  }), RECIPE_DETAIL_ACCESS.DENIED);
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.textContent = '';
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
  }

  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  click() { this.listeners.get('click')?.({ type: 'click', target: this }); }
}

const created = [];
const presentations = [];
const dismissals = [];
const documentLike = {
  createElement(tagName) {
    const element = new FakeElement(tagName);
    created.push(element);
    return element;
  },
};
const gate = createRecipeLoginGate({
  documentLike,
  present: (value) => presentations.push(value),
  dismiss: (value) => dismissals.push(value),
});
const trigger = Object.freeze({ id: 'fixture-trigger' });
const hostileTitle = '<img src=x onerror=alert(1)> & Safe';
assert.equal(gate.open({ recipe: { ...database, name: hostileTitle }, trigger }), true);
assert.equal(presentations.length, 1);
assert.equal(presentations[0].heading.textContent, 'Log in to view this recipe');
assert.equal(presentations[0].closeLabel, 'Close login required dialog');
assert.equal(presentations[0].trigger, trigger);

const [heading, explanation, actions] = presentations[0].content.children;
const [loginLink, registerLink, continueButton] = actions.children;
assert.equal(heading, presentations[0].heading);
assert.equal(explanation.textContent.includes(hostileTitle), true);
assert.equal(explanation.children.length, 0, 'Recipe titles must be assigned as text, not parsed markup');
assert.equal(loginLink.textContent, 'Log In');
assert.equal(loginLink.getAttribute('href'), 'login.html');
assert.equal(registerLink.textContent, 'Create Account');
assert.equal(registerLink.getAttribute('href'), 'register.html');
assert.equal(continueButton.textContent, 'Continue Browsing');
assert.equal(continueButton.getAttribute('type'), 'button');
for (const destination of [loginLink.getAttribute('href'), registerLink.getAttribute('href')]) {
  assert.equal(destination.includes(database.id), false);
  assert.equal(destination.includes('?'), false);
  assert.equal(destination.includes('#'), false);
  assert.equal(destination.includes('return'), false);
}

assert.equal(gate.open({ recipe: database, trigger }), false, 'Only one gate may be active');
continueButton.click();
assert.deepEqual(dismissals, [{ restoreFocus: true, trigger }]);
assert.equal(continueButton.listeners.has('click'), false);

assert.equal(gate.open({ recipe: database, trigger }), true);
assert.equal(gate.close({ restoreFocus: false }), true);
assert.deepEqual(dismissals.at(-1), { restoreFocus: false, trigger });
assert.equal(gate.close(), false);
assert.equal(gate.open({ recipe: mealDb, trigger }), false, 'Public details must not open the login gate');
assert.equal(gate.open({ recipe: { ...database, id: 'bad id' }, trigger }), false);

assert.equal(gate.open({ recipe: database, trigger }), true);
gate.cleanup();
assert.deepEqual(dismissals.at(-1), { restoreFocus: false, trigger });
assert.equal(gate.open({ recipe: database, trigger }), false);
gate.cleanup();

const failingGate = createRecipeLoginGate({
  documentLike,
  present: () => { throw new Error('private presenter message'); },
  dismiss: () => assert.fail('Failed presentation must not dismiss an unopened gate'),
});
assert.equal(failingGate.open({ recipe: database }), false);
assert.equal(failingGate.close(), false);

const malformedDismissals = [];
const malformedGate = createRecipeLoginGate({
  documentLike,
  present: () => {},
  dismiss: (value) => malformedDismissals.push(value),
});
assert.equal(malformedGate.open(null), false);
assert.equal(malformedGate.open(7), false);
assert.equal(malformedGate.open(new Proxy({}, { get() { throw new Error('private argument message'); } })), false);
assert.equal(malformedGate.open({ recipe: database, trigger }), true);
assert.equal(malformedGate.close(null), false, 'Malformed close input must not mutate active state');
assert.equal(malformedGate.close('invalid'), false);
assert.equal(
  malformedGate.close(new Proxy({}, { get() { throw new Error('private argument message'); } })),
  false
);
assert.equal(malformedDismissals.length, 0);
assert.equal(malformedGate.close(), true, 'The valid close must still dismiss the active gate');
assert.deepEqual(malformedDismissals, [{ restoreFocus: true, trigger }]);

let directDismissAttempts = 0;
const directFailureGate = createRecipeLoginGate({
  documentLike,
  present: () => {},
  dismiss: () => { directDismissAttempts += 1; throw new Error('private dismissal message'); },
});
assert.equal(directFailureGate.open({ recipe: database }), true);
assert.doesNotThrow(() => {
  assert.equal(directFailureGate.close(), false, 'Failed visual dismissal must not report success');
});
assert.equal(directDismissAttempts, 1);
assert.equal(directFailureGate.close(), false, 'A failed callback must not leave logical state active');
assert.equal(directDismissAttempts, 1, 'Dismissal must not be retried automatically');

let continuePresentation;
let continueDismissAttempts = 0;
const continueFailureGate = createRecipeLoginGate({
  documentLike,
  present: (value) => { continuePresentation = value; },
  dismiss: () => { continueDismissAttempts += 1; throw new Error('private dismissal message'); },
});
assert.equal(continueFailureGate.open({ recipe: database }), true);
const continueFailureButton = continuePresentation.content.children[2].children[2];
assert.doesNotThrow(() => continueFailureButton.click());
assert.equal(continueDismissAttempts, 1);
assert.equal(continueFailureButton.listeners.has('click'), false);
assert.equal(continueFailureGate.close(), false);

let cleanupPresentation;
let cleanupDismissAttempts = 0;
const cleanupFailureGate = createRecipeLoginGate({
  documentLike,
  present: (value) => { cleanupPresentation = value; },
  dismiss: () => { cleanupDismissAttempts += 1; throw new Error('private dismissal message'); },
});
assert.equal(cleanupFailureGate.open({ recipe: database }), true);
const cleanupFailureButton = cleanupPresentation.content.children[2].children[2];
assert.doesNotThrow(() => cleanupFailureGate.cleanup());
assert.doesNotThrow(() => cleanupFailureGate.cleanup());
assert.equal(cleanupDismissAttempts, 1);
assert.equal(cleanupFailureButton.listeners.has('click'), false);
assert.equal(cleanupFailureGate.open({ recipe: database }), false, 'Cleanup must prevent stale publication');

let domFailureCalls = 0;
const domFailureGate = createRecipeLoginGate({
  documentLike: {
    createElement() {
      domFailureCalls += 1;
      throw new Error('private DOM adapter message');
    },
  },
  present: () => assert.fail('DOM construction failure must not publish content'),
  dismiss: () => assert.fail('DOM construction failure must not dismiss content'),
});
assert.doesNotThrow(() => assert.equal(domFailureGate.open({ recipe: database }), false));
assert.equal(domFailureCalls, 1);

const moduleSource = await readFile(resolve(root, modulePath), 'utf8');
for (const forbidden of [
  /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bcreateClient\s*\(/,
  /\blocalStorage\b/, /\bsessionStorage\b/, /\blocation\s*\./,
]) {
  assert.doesNotMatch(moduleSource, forbidden);
}

function repositoryPath(path) {
  return relative(root, path).replaceAll('\\', '/');
}

function localModuleSpecifiers(source) {
  // This bounded scanner is intentionally not a general JavaScript parser.
  // Active code must use ordinary static imports or literal import() calls;
  // detectable runtime loaders and nonliteral dynamic imports fail closed.
  assert.doesNotMatch(
    source,
    /\b(?:import|export|from)\s*\/(?:\*|\/)/u,
    'Comments interleaved with module syntax are unsupported'
  );
  assert.doesNotMatch(
    source,
    /(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))\s*from\b/u,
    'Comments immediately before from are unsupported'
  );
  const specifiers = [];
  const patterns = [
    /(?:^|[;\r\n])\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|[;\r\n])\s*export\s+[^'";]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      assert.equal(
        specifier.startsWith('.') || specifier.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(specifier),
        true,
        `Unsupported bare module specifier: ${specifier}`
      );
      if (specifier.startsWith('.') || specifier.startsWith('/')) specifiers.push(specifier);
    }
  }
  const literalDynamicImports = [...source.matchAll(/\bimport\s*\(\s*['"][^'"]+['"]\s*\)/g)].length;
  const allDynamicImports = [...source.matchAll(/\bimport\s*\(/g)].length;
  assert.equal(allDynamicImports, literalDynamicImports, 'Active modules must use literal dynamic imports');
  assert.doesNotMatch(source, /\b(?:importScripts|Worker|SharedWorker)\s*\(/u);
  assert.doesNotMatch(source, /createElement\s*\(\s*['"]script['"]\s*\)/u);
  return Object.freeze(specifiers);
}

function deployedScriptSources(html, htmlPath) {
  const sources = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    const attributes = match[1];
    const body = match[2].trim();
    const sourceAttributes = [...attributes.matchAll(/(?:^|\s)src\s*=/giu)];
    const hasSourceAttribute = sourceAttributes.length > 0;
    assert.ok(sourceAttributes.length <= 1, `${htmlPath} must not contain duplicate script src attributes`);
    const quotedSource = /(?:^|\s)src\s*=\s*(['"])(.*?)\1/iu.exec(attributes);
    assert.equal(
      hasSourceAttribute && !quotedSource,
      false,
      `${htmlPath} must use a quoted script src attribute`
    );
    const isModule = /(?:^|\s)type\s*=\s*(?:['"]module['"]|module(?:\s|$))/iu.test(attributes);
    assert.equal(
      isModule && !quotedSource && body.length > 0,
      false,
      `${htmlPath} must not use inline module code`
    );
    if (quotedSource) sources.push(quotedSource[2]);
  }
  return Object.freeze(sources);
}

function resolveLocalModule(importer, specifier) {
  const withoutSuffix = specifier.split(/[?#]/u, 1)[0];
  const resolved = specifier.startsWith('/')
    ? resolve(root, `.${withoutSuffix}`)
    : resolve(dirname(importer), withoutSuffix);
  const relativePath = relative(root, resolved);
  assert.equal(
    isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..\\`) || relativePath.startsWith('../'),
    false,
    `Active module import escapes the repository: ${specifier}`
  );
  return resolved;
}

async function deployedScriptEntries(deploymentFiles) {
  const htmlFiles = [...deploymentFiles].filter((path) => path.endsWith('.html')).sort();
  const entries = new Set();
  for (const htmlPath of htmlFiles) {
    const html = await readFile(resolve(root, htmlPath), 'utf8');
    for (const source of deployedScriptSources(html, htmlPath)) {
      if (/^[a-z][a-z\d+.-]*:/iu.test(source) || source.startsWith('//')) continue;
      const entry = resolveLocalModule(resolve(root, htmlPath), source);
      const entryPath = repositoryPath(entry);
      assert.equal(deploymentFiles.has(entryPath), true, `${entryPath} must be in a deployment inventory`);
      entries.add(entry);
    }
  }
  return Object.freeze([...entries]);
}

async function reachableActiveModules(deploymentFileList) {
  const deploymentFiles = new Set(deploymentFileList);
  const queue = [...await deployedScriptEntries(deploymentFiles)];
  const visited = new Set();
  while (queue.length) {
    const module = queue.shift();
    if (visited.has(module)) continue;
    visited.add(module);
    const modulePathFromRoot = repositoryPath(module);
    if (modulePathFromRoot === 'js/supabase-config.js') continue;
    const source = await readFile(module, 'utf8');
    for (const specifier of localModuleSpecifiers(source)) {
      const dependency = resolveLocalModule(module, specifier);
      const dependencyPath = repositoryPath(dependency);
      assert.equal(deploymentFiles.has(dependencyPath), true, `${dependencyPath} must be in a deployment inventory`);
      if (!visited.has(dependency)) queue.push(dependency);
    }
  }
  return visited;
}

const productionActiveModules = await reachableActiveModules(PRODUCTION_OUTPUT_FILES);
const previewActiveModules = await reachableActiveModules(ADMIN_PREVIEW_OUTPUT_FILES);

assert.deepEqual(localModuleSpecifiers("import './ordinary.js';"), ['./ordinary.js']);
assert.deepEqual(localModuleSpecifiers("import {\n  value\n} from './multiline.js';"), ['./multiline.js']);
assert.deepEqual(localModuleSpecifiers("export { value } from './reexport.js';"), ['./reexport.js']);
assert.deepEqual(localModuleSpecifiers("import('./dynamic.js?version=1')"), ['./dynamic.js?version=1']);
assert.throws(
  () => localModuleSpecifiers("import/*comment*/ './recipe-login-gate.js';"),
  /Comments interleaved with module syntax/
);
assert.throws(
  () => localModuleSpecifiers("import { value } from/*comment*/ './recipe-login-gate.js';"),
  /Comments interleaved with module syntax/
);
assert.throws(
  () => localModuleSpecifiers("import { value }/*comment*/from './recipe-login-gate.js';"),
  /Comments immediately before from/
);
assert.throws(
  () => localModuleSpecifiers("export { value }/*comment*/from './recipe-login-gate.js';"),
  /Comments immediately before from/
);
assert.throws(
  () => localModuleSpecifiers("import { value }/* comment; still comment */from './recipe-login-gate.js';"),
  /Comments immediately before from/
);
assert.throws(
  () => localModuleSpecifiers("export { value }// comment\nfrom './recipe-login-gate.js';"),
  /Comments immediately before from/
);
assert.throws(() => localModuleSpecifiers('import(modulePath)'), /literal dynamic imports/);
assert.throws(
  () => resolveLocalModule(resolve(root, 'app.js'), '../../outside.js'),
  /escapes the repository/
);
await assert.rejects(
  readFile(resolveLocalModule(resolve(root, 'app.js'), './js/definitely-missing-module.js'), 'utf8'),
  /ENOENT/
);
assert.deepEqual(
  deployedScriptSources('<script type="module" src="js/example.js"></script>', 'synthetic.html'),
  ['js/example.js']
);
assert.throws(
  () => deployedScriptSources('<script src=js/example.js></script>', 'synthetic.html'),
  /quoted script src/
);
assert.throws(
  () => deployedScriptSources('<script type=module src=js/example.js></script>', 'synthetic.html'),
  /quoted script src/
);
assert.throws(
  () => deployedScriptSources('<script type=module>import "./example.js";</script>', 'synthetic.html'),
  /inline module code/
);
for (const inactivePath of [
  'js/recipe-login-gate.js',
  'js/recipe-detail-access-controller.js',
  'js/recipe-previews.js',
  'js/supabase-recipe-details.js',
  'js/supabase-recipe-previews.js',
]) {
  assert.equal(productionActiveModules.has(resolve(root, inactivePath)), false, `${inactivePath} must remain inactive in Production`);
  assert.equal(previewActiveModules.has(resolve(root, inactivePath)), false, `${inactivePath} must remain inactive in Admin Preview`);
}

const appSource = await readFile(resolve(root, 'app.js'), 'utf8');
assert.equal(localModuleSpecifiers(appSource).includes('./js/auth-session.js'), false);
assert.equal(productionActiveModules.has(resolve(root, 'js/auth-session.js')), true, 'Production transitive imports must be traversed');
assert.equal(previewActiveModules.has(resolve(root, 'js/auth-session.js')), true, 'Preview transitive imports must be traversed');
assert.equal(PRODUCTION_OUTPUT_FILES.includes('js/admin-browser.js'), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes('js/admin-browser.js'), true);
assert.equal(productionActiveModules.has(resolve(root, 'js/admin-browser.js')), false);
assert.equal(previewActiveModules.has(resolve(root, 'js/admin-browser.js')), true);

const controllerSource = await readFile(resolve(root, 'js/recipe-detail-access-controller.js'), 'utf8');
assert.equal(
  localModuleSpecifiers(controllerSource).includes('./recipe-login-gate.js'),
  true,
  'Inactive foundations may depend on the inactive login-gate classifier'
);
assert.equal(PRODUCTION_OUTPUT_FILES.length, 51);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 59);
assert.equal(PRODUCTION_OUTPUT_FILES.includes(modulePath), false);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.includes(modulePath), false);

console.log('Inactive RecipeFinder guest login gate tests passed.');
