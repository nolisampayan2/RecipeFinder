import assert from 'node:assert/strict';
import * as realFilesystem from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  ADMIN_PREVIEW_FILES,
  ADMIN_PREVIEW_OUTPUT_FILES,
  PRODUCTION_OUTPUT_FILES,
  STATIC_BUILD_CLEANUP_ERROR,
  STATIC_BUILD_ERROR,
  STATIC_RUNTIME_FILES,
  isAdminPreviewBuildEnabled,
} from '../scripts/build-vercel-static.mjs';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = resolve(TEST_DIRECTORY, '..');
const SYNTHETIC_ENVIRONMENT = Object.freeze({
  SUPABASE_URL: 'https://synthetic-project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'pk_public_synthetic_browser_value_1234567890',
});
const ADMIN_PREVIEW_ENVIRONMENT = Object.freeze({
  ...SYNTHETIC_ENVIRONMENT,
  VERCEL_ENV: 'preview',
  ENABLE_ADMIN_CMS_PREVIEW: 'true',
});
const ERROR_PATTERN = new RegExp(STATIC_BUILD_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const CLEANUP_ERROR_PATTERN = new RegExp(
  STATIC_BUILD_CLEANUP_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
);
let fixtureCounter = 0;

assert.equal(PRODUCTION_OUTPUT_FILES.length, 47);
assert.equal(ADMIN_PREVIEW_FILES.length, 6);
assert.equal(ADMIN_PREVIEW_OUTPUT_FILES.length, 53);
assert.deepEqual(
  ADMIN_PREVIEW_OUTPUT_FILES.filter((path) => !PRODUCTION_OUTPUT_FILES.includes(path)),
  [...ADMIN_PREVIEW_FILES].sort(),
);

async function exists(path) {
  try {
    await realFilesystem.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function createFixture() {
  const workspace = await realFilesystem.mkdtemp(resolve(tmpdir(), 'recipefinder-vercel-security-'));
  const root = resolve(workspace, 'repository');
  await realFilesystem.mkdir(root);
  for (const relativePath of [
    ...STATIC_RUNTIME_FILES,
    ...ADMIN_PREVIEW_FILES,
    'scripts/build-vercel-static.mjs',
    'scripts/generate-supabase-config.mjs',
  ]) {
    const source = resolve(SOURCE_ROOT, relativePath);
    const destination = resolve(root, relativePath);
    await realFilesystem.mkdir(dirname(destination), { recursive: true });
    await realFilesystem.copyFile(source, destination);
  }
  const moduleUrl = `${pathToFileURL(resolve(root, 'scripts/build-vercel-static.mjs')).href}?fixture=${fixtureCounter++}`;
  const buildModule = await import(moduleUrl);
  return Object.freeze({ workspace, root, buildModule });
}

async function removeFixture(fixture) {
  await realFilesystem.rm(fixture.workspace, { recursive: true, force: true });
}

function localReference(value) {
  const normalized = value.split('#', 1)[0].split('?', 1)[0];
  return normalized
    && !normalized.startsWith('http://')
    && !normalized.startsWith('https://')
    && !normalized.startsWith('data:')
    && !normalized.startsWith('mailto:')
    ? normalized
    : null;
}

async function verifySuccessfulOutput(
  fixture,
  {
    environment = SYNTHETIC_ENVIRONMENT,
    expectedFiles = PRODUCTION_OUTPUT_FILES,
    adminExpected = false,
  } = {},
) {
  const result = await fixture.buildModule.buildVercelStaticSite({
    environment,
  });
  assert.equal(result.outputDirectory, resolve(fixture.root, 'dist'));
  assert.deepEqual(result.files, expectedFiles);

  const pages = ['index.html', 'login.html', 'register.html', 'verify-email.html', 'auth-callback.html'];
  if (adminExpected) pages.push('admin.html');
  for (const page of pages) {
    const html = await realFilesystem.readFile(resolve(result.outputDirectory, page), 'utf8');
    const references = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)]
      .map((match) => localReference(match[1]))
      .filter(Boolean);
    for (const reference of references) {
      assert.equal(await exists(resolve(result.outputDirectory, dirname(page), reference)), true);
    }
  }

  for (const relativePath of result.files.filter((path) => extname(path) === '.js')) {
    const source = await realFilesystem.readFile(resolve(result.outputDirectory, relativePath), 'utf8');
    const imports = [...source.matchAll(/(?:from\s*|import\s*\()\s*["'](\.[^"']+)["']/g)]
      .map((match) => match[1]);
    for (const specifier of imports) {
      assert.equal(await exists(resolve(result.outputDirectory, dirname(relativePath), specifier)), true);
    }
  }

  const generated = await realFilesystem.readFile(resolve(result.outputDirectory, 'js/supabase-config.js'), 'utf8');
  assert.match(generated, /synthetic-project\.supabase\.co/);
  assert.doesNotMatch(generated, /service.?role|sb_secret_|password|token/i);
  assert.equal(await exists(resolve(fixture.root, '.dist-build-lock')), false);
  for (const adminFile of ADMIN_PREVIEW_FILES) {
    assert.equal(await exists(resolve(result.outputDirectory, adminFile)), adminExpected);
  }
  for (const excluded of [
    'tests', 'supabase', 'scripts', '.git', 'js/supabase-config.example.js',
  ]) assert.equal(await exists(resolve(result.outputDirectory, excluded)), false);
}

{
  const fixture = await createFixture();
  try {
    await verifySuccessfulOutput(fixture);
  } finally {
    await removeFixture(fixture);
  }
}

const environmentGateCases = [
  {
    name: 'Preview with exact enablement',
    environment: ADMIN_PREVIEW_ENVIRONMENT,
    enabled: true,
  },
  {
    name: 'Preview without flag',
    environment: { ...SYNTHETIC_ENVIRONMENT, VERCEL_ENV: 'preview' },
    enabled: false,
  },
  {
    name: 'Preview with false flag',
    environment: { ...SYNTHETIC_ENVIRONMENT, VERCEL_ENV: 'preview', ENABLE_ADMIN_CMS_PREVIEW: 'false' },
    enabled: false,
  },
  {
    name: 'Preview with uppercase flag',
    environment: { ...SYNTHETIC_ENVIRONMENT, VERCEL_ENV: 'preview', ENABLE_ADMIN_CMS_PREVIEW: 'TRUE' },
    enabled: false,
  },
  {
    name: 'Preview with malformed flag',
    environment: { ...SYNTHETIC_ENVIRONMENT, VERCEL_ENV: 'preview', ENABLE_ADMIN_CMS_PREVIEW: ' true ' },
    enabled: false,
  },
  {
    name: 'Production with enablement flag',
    environment: { ...SYNTHETIC_ENVIRONMENT, VERCEL_ENV: 'production', ENABLE_ADMIN_CMS_PREVIEW: 'true' },
    enabled: false,
  },
  {
    name: 'Production without flag',
    environment: { ...SYNTHETIC_ENVIRONMENT, VERCEL_ENV: 'production' },
    enabled: false,
  },
  {
    name: 'Development with enablement flag',
    environment: { ...SYNTHETIC_ENVIRONMENT, VERCEL_ENV: 'development', ENABLE_ADMIN_CMS_PREVIEW: 'true' },
    enabled: false,
  },
  {
    name: 'Missing Vercel environment with enablement flag',
    environment: { ...SYNTHETIC_ENVIRONMENT, ENABLE_ADMIN_CMS_PREVIEW: 'true' },
    enabled: false,
  },
];

for (const testCase of environmentGateCases) {
  assert.equal(
    isAdminPreviewBuildEnabled(testCase.environment),
    testCase.enabled,
    testCase.name,
  );
  const fixture = await createFixture();
  try {
    await verifySuccessfulOutput(fixture, {
      environment: testCase.environment,
      expectedFiles: testCase.enabled ? ADMIN_PREVIEW_OUTPUT_FILES : PRODUCTION_OUTPUT_FILES,
      adminExpected: testCase.enabled,
    });
  } finally {
    await removeFixture(fixture);
  }
}

for (const hostileEnvironment of [
  null,
  [],
  Object.defineProperty({}, 'VERCEL_ENV', {
    get() { throw new Error('synthetic hostile environment'); },
  }),
]) {
  assert.equal(isAdminPreviewBuildEnabled(hostileEnvironment), false);
}

{
  const fixture = await createFixture();
  await realFilesystem.rm(resolve(fixture.root, 'js/supabase-admin-access.js'));
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({ environment: ADMIN_PREVIEW_ENVIRONMENT }),
      ERROR_PATTERN,
    );
    assert.equal(await exists(resolve(fixture.root, 'dist')), false);
    assert.equal(await exists(resolve(fixture.root, `.dist-build-${process.pid}`)), false);
  } finally {
    await removeFixture(fixture);
  }
}

{
  const fixture = await createFixture();
  const external = resolve(fixture.workspace, 'external', 'dist');
  await realFilesystem.mkdir(external, { recursive: true });
  await realFilesystem.writeFile(resolve(external, 'marker.txt'), 'preserve');
  try {
    for (const unsafeOptions of [
      { outputDirectory: external },
      { temporaryDirectory: resolve(fixture.workspace, '.dist-build-external') },
      { outputDirectory: resolve(fixture.root, '..', 'dist') },
    ]) {
      await assert.rejects(
        fixture.buildModule.buildVercelStaticSite({
          environment: SYNTHETIC_ENVIRONMENT,
          ...unsafeOptions,
        }),
        ERROR_PATTERN,
      );
    }
    assert.equal(await realFilesystem.readFile(resolve(external, 'marker.txt'), 'utf8'), 'preserve');
  } finally {
    await removeFixture(fixture);
  }
}

async function createDirectoryLink(target, link) {
  return realFilesystem.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

for (const targetName of ['dist', `.dist-build-${process.pid}`]) {
  const fixture = await createFixture();
  const external = resolve(fixture.workspace, `external-${targetName.replaceAll('.', '-')}`);
  await realFilesystem.mkdir(external);
  await realFilesystem.writeFile(resolve(external, 'marker.txt'), 'preserve');
  await createDirectoryLink(external, resolve(fixture.root, targetName));
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({ environment: SYNTHETIC_ENVIRONMENT }),
      CLEANUP_ERROR_PATTERN,
    );
    assert.equal(await realFilesystem.readFile(resolve(external, 'marker.txt'), 'utf8'), 'preserve');
  } finally {
    await removeFixture(fixture);
  }
}

{
  const fixture = await createFixture();
  const externalAssets = resolve(fixture.workspace, 'external-assets');
  await realFilesystem.rename(resolve(fixture.root, 'assets'), externalAssets);
  await createDirectoryLink(externalAssets, resolve(fixture.root, 'assets'));
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({ environment: SYNTHETIC_ENVIRONMENT }),
      ERROR_PATTERN,
    );
    assert.equal(await exists(resolve(fixture.root, 'dist')), false);
  } finally {
    await removeFixture(fixture);
  }
}

{
  const fixture = await createFixture();
  const source = resolve(fixture.root, 'assets/recipefinder-favicon.svg');
  const symlinkFilesystem = {
    ...realFilesystem,
    async lstat(path) {
      if (resolve(path) === source) {
        return {
          isDirectory: () => false,
          isFile: () => false,
          isSymbolicLink: () => true,
        };
      }
      return realFilesystem.lstat(path);
    },
  };
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({
        environment: SYNTHETIC_ENVIRONMENT,
        filesystem: symlinkFilesystem,
      }),
      ERROR_PATTERN,
    );
    assert.equal(await exists(resolve(fixture.root, 'dist')), false);
  } finally {
    await removeFixture(fixture);
  }
}

{
  const fixture = await createFixture();
  await realFilesystem.rm(resolve(fixture.root, 'index.html'));
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({ environment: SYNTHETIC_ENVIRONMENT }),
      (error) => error instanceof TypeError && error.message === STATIC_BUILD_ERROR,
    );
    assert.equal(await exists(resolve(fixture.root, 'dist')), false);
    assert.equal(await exists(resolve(fixture.root, `.dist-build-${process.pid}`)), false);
  } finally {
    await removeFixture(fixture);
  }
}

{
  const fixture = await createFixture();
  let statCalls = 0;
  let closeCalls = 0;
  const lockRmCalls = [];
  const initialStatFailureFilesystem = {
    ...realFilesystem,
    async open(...args) {
      const handle = await realFilesystem.open(...args);
      return {
        async stat() {
          statCalls += 1;
          throw new Error('synthetic initial stat failure');
        },
        async close() {
          closeCalls += 1;
          return handle.close();
        },
      };
    },
    async rm(path, options) {
      if (resolve(path) === resolve(fixture.root, '.dist-build-lock')) lockRmCalls.push(path);
      return realFilesystem.rm(path, options);
    },
  };
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({
        environment: SYNTHETIC_ENVIRONMENT,
        filesystem: initialStatFailureFilesystem,
      }),
      CLEANUP_ERROR_PATTERN,
    );
    assert.equal(statCalls, 1);
    assert.equal(closeCalls, 1);
    assert.equal(lockRmCalls.length, 0);
    const lockInfo = await realFilesystem.lstat(resolve(fixture.root, '.dist-build-lock'));
    assert.equal(lockInfo.isFile(), true);
    assert.equal(lockInfo.isSymbolicLink(), false);
  } finally {
    await removeFixture(fixture);
  }
}

{
  const fixture = await createFixture();
  let closeCalls = 0;
  const closeFailureFilesystem = {
    ...realFilesystem,
    async open(...args) {
      const handle = await realFilesystem.open(...args);
      return {
        async stat() {
          throw new Error('synthetic initial stat failure');
        },
        async close() {
          closeCalls += 1;
          await handle.close();
          throw new Error('synthetic close failure');
        },
      };
    },
  };
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({
        environment: SYNTHETIC_ENVIRONMENT,
        filesystem: closeFailureFilesystem,
      }),
      CLEANUP_ERROR_PATTERN,
    );
    assert.equal(closeCalls, 1);
    const lockInfo = await realFilesystem.lstat(resolve(fixture.root, '.dist-build-lock'));
    assert.equal(lockInfo.isFile(), true);
    assert.equal(lockInfo.isSymbolicLink(), false);
  } finally {
    await removeFixture(fixture);
  }
}

{
  const fixture = await createFixture();
  const lockPath = resolve(fixture.root, '.dist-build-lock');
  const displacedLockPath = resolve(fixture.root, '.dist-build-lock-displaced');
  let statCalls = 0;
  const lockRmCalls = [];
  const replacedLockFilesystem = {
    ...realFilesystem,
    async open(...args) {
      const handle = await realFilesystem.open(...args);
      return {
        async stat() {
          statCalls += 1;
          throw new Error('synthetic initial stat failure');
        },
        async close() {
          await handle.close();
          await realFilesystem.rename(lockPath, displacedLockPath);
          await realFilesystem.writeFile(lockPath, 'replacement lock');
        },
      };
    },
    async rm(path, options) {
      if (resolve(path) === lockPath) lockRmCalls.push(path);
      return realFilesystem.rm(path, options);
    },
  };
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({
        environment: SYNTHETIC_ENVIRONMENT,
        filesystem: replacedLockFilesystem,
      }),
      CLEANUP_ERROR_PATTERN,
    );
    assert.equal(statCalls, 1);
    assert.equal(lockRmCalls.length, 0);
    assert.equal(await realFilesystem.readFile(lockPath, 'utf8'), 'replacement lock');
    assert.equal(await exists(displacedLockPath), true);
  } finally {
    await removeFixture(fixture);
  }
}

{
  const fixture = await createFixture();
  const rmCalls = [];
  const cleanupInspections = [];
  let copyAttempted = false;
  const failingFilesystem = {
    ...realFilesystem,
    async copyFile() {
      copyAttempted = true;
      throw new Error('raw copy failure');
    },
    async lstat(path) {
      if (copyAttempted) cleanupInspections.push(path);
      return realFilesystem.lstat(path);
    },
    async rm(path, options) {
      rmCalls.push(path);
      if (copyAttempted && path.includes('.dist-build-')) throw new Error('raw cleanup failure');
      return realFilesystem.rm(path, options);
    },
  };
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({
        environment: SYNTHETIC_ENVIRONMENT,
        filesystem: failingFilesystem,
      }),
      CLEANUP_ERROR_PATTERN,
    );
    assert.equal(cleanupInspections.some((path) => path.endsWith('dist')), true);
    assert.equal(rmCalls.some((path) => path.includes('.dist-build-')), true);
    assert.equal(await exists(resolve(fixture.root, 'dist')), false);
    assert.equal(await exists(resolve(fixture.root, `.dist-build-${process.pid}`)), true);
    assert.equal(dirname(resolve(fixture.root, `.dist-build-${process.pid}`)), fixture.root);
  } finally {
    await removeFixture(fixture);
  }
}

for (const environment of [
  {},
  {
    SUPABASE_URL: SYNTHETIC_ENVIRONMENT.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic_value_1234567890',
  },
  {
    ...SYNTHETIC_ENVIRONMENT,
    SUPABASE_ANON_KEY: 'legacy_public_synthetic_value_1234567890',
  },
]) {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({ environment }),
      ERROR_PATTERN,
    );
    assert.equal(await exists(resolve(fixture.root, 'dist')), false);
  } finally {
    await removeFixture(fixture);
  }
}

{
  const fixture = await createFixture();
  let releaseFirstCopy;
  const firstCopy = new Promise((resolvePromise) => { releaseFirstCopy = resolvePromise; });
  let blocked = false;
  const slowFilesystem = {
    ...realFilesystem,
    async copyFile(...args) {
      if (!blocked) {
        blocked = true;
        await firstCopy;
      }
      return realFilesystem.copyFile(...args);
    },
  };
  try {
    const firstBuild = fixture.buildModule.buildVercelStaticSite({
      environment: SYNTHETIC_ENVIRONMENT,
      filesystem: slowFilesystem,
    });
    while (!blocked) await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    await assert.rejects(
      fixture.buildModule.buildVercelStaticSite({ environment: SYNTHETIC_ENVIRONMENT }),
      ERROR_PATTERN,
    );
    releaseFirstCopy();
    assert.equal((await firstBuild).files.length, 47);
  } finally {
    releaseFirstCopy?.();
    await removeFixture(fixture);
  }
}

const vercelConfig = JSON.parse(await realFilesystem.readFile(resolve(SOURCE_ROOT, 'vercel.json'), 'utf8'));
assert.equal(vercelConfig.framework, null);
assert.equal(vercelConfig.buildCommand, 'node scripts/build-vercel-static.mjs');
assert.equal(vercelConfig.outputDirectory, 'dist');
assert.equal(vercelConfig.cleanUrls, false);
assert.equal(vercelConfig.trailingSlash, false);
assert.equal('rewrites' in vercelConfig, false);

console.log('Offline Vercel filesystem security tests passed in disposable fixture repositories.');
