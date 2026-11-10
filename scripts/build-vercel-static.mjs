import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePublicSupabaseConfig } from './generate-supabase-config.mjs';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
export const DEFAULT_OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, 'dist');
const DEFAULT_TEMPORARY_DIRECTORY = resolve(PROJECT_ROOT, `.dist-build-${process.pid}`);
const BUILD_LOCK_PATH = resolve(PROJECT_ROOT, '.dist-build-lock');

const ROOT_RUNTIME_FILES = Object.freeze([
  'app.js',
  'auth-callback.html',
  'auth.css',
  'forgot-password.html',
  'index.html',
  'login.html',
  'register.html',
  'reset-password.html',
  'styles.css',
  'verify-email.html',
]);

const ASSET_FILES = Object.freeze([
  'assets/beef-stew.png',
  'assets/hero-bowl.png',
  'assets/recipefinder-favicon.svg',
]);

const PUBLIC_JAVASCRIPT_FILES = Object.freeze([
  'js/account-favorites-coordinator.js',
  'js/auth-callback-browser.js',
  'js/auth-callback-exchange.js',
  'js/auth-callback.js',
  'js/auth-session.js',
  'js/auth-ui.js',
  'js/category-carousel.js',
  'js/confirmation-resend.js',
  'js/dashboard-account-favorites.js',
  'js/dashboard-auth.js',
  'js/dashboard-recipe-catalog-loader.js',
  'js/data.js',
  'js/external-recipe-controller.js',
  'js/external-source-registry.js',
  'js/fictional-external-recipe-source.js',
  'js/filters.js',
  'js/live-mealdb-dashboard.js',
  'js/live-mealdb-search.js',
  'js/login-browser.js',
  'js/login.js',
  'js/mealdb-client.js',
  'js/mealdb-normalize.js',
  'js/mealdb-recipe-source.js',
  'js/modal.js',
  'js/password-recovery-browser.js',
  'js/password-recovery.js',
  'js/recipe-catalog-composition.js',
  'js/recipe-catalog.js',
  'js/registration-browser.js',
  'js/registration.js',
  'js/render.js',
  'js/security.js',
  'js/state.js',
  'js/supabase-browser.js',
  'js/supabase-client.js',
  'js/supabase-favorites.js',
  'js/supabase-recipe-source.js',
]);

export const STATIC_RUNTIME_FILES = Object.freeze([
  ...ROOT_RUNTIME_FILES,
  ...ASSET_FILES,
  ...PUBLIC_JAVASCRIPT_FILES,
]);

export const ADMIN_PREVIEW_FILES = Object.freeze([
  'admin.html',
  'admin.css',
  'js/admin-browser.js',
  'js/admin-cms.js',
  'js/admin-recipe-editor.js',
  'js/admin-recipe-validation.js',
  'js/supabase-admin-access.js',
  'js/supabase-admin-recipes.js',
]);

export const GENERATED_CONFIG_FILE = 'js/supabase-config.js';
export const PRODUCTION_OUTPUT_FILES = Object.freeze([
  ...STATIC_RUNTIME_FILES,
  GENERATED_CONFIG_FILE,
].sort());
export const ADMIN_PREVIEW_OUTPUT_FILES = Object.freeze([
  ...STATIC_RUNTIME_FILES,
  ...ADMIN_PREVIEW_FILES,
  GENERATED_CONFIG_FILE,
].sort());

export const STATIC_BUILD_ERROR = 'RecipeFinder static build failed.';
export const STATIC_BUILD_CLEANUP_ERROR = 'RecipeFinder static build failed and cleanup requires review.';

class StaticBuildFailure extends Error {
  constructor(classification = STATIC_BUILD_ERROR) {
    super(classification);
    this.classification = classification;
  }
}

const DEFAULT_FILESYSTEM = Object.freeze({
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
});

function normalizedPath(value) {
  return resolve(value).split(sep).join('/');
}

function samePath(left, right) {
  const normalizedLeft = normalizedPath(left);
  const normalizedRight = normalizedPath(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
    : normalizedLeft === normalizedRight;
}

function normalRelativePath(value) {
  return value.split(sep).join('/');
}

function requireFilesystem(value) {
  const required = [
    'copyFile', 'lstat', 'mkdir', 'open', 'readdir', 'realpath', 'rename', 'rm', 'writeFile',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(STATIC_BUILD_ERROR);
  }
  for (const name of required) {
    if (typeof value[name] !== 'function') throw new TypeError(STATIC_BUILD_ERROR);
  }
  return value;
}

function requireBuildOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(STATIC_BUILD_ERROR);
  }
  const allowed = new Set(['environment', 'filesystem']);
  for (const name of Object.keys(options)) {
    if (!allowed.has(name)) throw new TypeError(STATIC_BUILD_ERROR);
  }
  return Object.freeze({
    environment: options.environment ?? process.env,
    filesystem: requireFilesystem(options.filesystem ?? DEFAULT_FILESYSTEM),
  });
}

function isContainedBy(root, target) {
  const child = relative(root, target);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

async function canonicalProjectRoot(filesystem) {
  const canonical = await filesystem.realpath(PROJECT_ROOT);
  const info = await filesystem.lstat(PROJECT_ROOT);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError(STATIC_BUILD_ERROR);
  return canonical;
}

async function inspectBuildTarget(target, expectedName, canonicalRoot, filesystem) {
  if (!samePath(dirname(target), PROJECT_ROOT)) {
    throw new TypeError(STATIC_BUILD_ERROR);
  }
  const canonicalParent = await filesystem.realpath(dirname(target));
  if (!samePath(canonicalParent, canonicalRoot)) throw new TypeError(STATIC_BUILD_ERROR);
  const name = normalRelativePath(relative(PROJECT_ROOT, target));
  if (name !== expectedName || name.includes('/')) throw new TypeError(STATIC_BUILD_ERROR);

  try {
    const info = await filesystem.lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new TypeError(STATIC_BUILD_ERROR);
    const canonicalTarget = await filesystem.realpath(target);
    if (!samePath(dirname(canonicalTarget), canonicalRoot) || !isContainedBy(canonicalRoot, canonicalTarget)) {
      throw new TypeError(STATIC_BUILD_ERROR);
    }
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new TypeError(STATIC_BUILD_ERROR);
  }
}

async function removeBuildTarget(target, expectedName, canonicalRoot, filesystem) {
  const exists = await inspectBuildTarget(target, expectedName, canonicalRoot, filesystem);
  if (exists) await filesystem.rm(target, { recursive: true, force: false });
}

async function cleanupBuildTargets(canonicalRoot, filesystem) {
  let succeeded = true;
  for (const [target, name] of [
    [DEFAULT_TEMPORARY_DIRECTORY, normalRelativePath(relative(PROJECT_ROOT, DEFAULT_TEMPORARY_DIRECTORY))],
    [DEFAULT_OUTPUT_DIRECTORY, 'dist'],
  ]) {
    try {
      await removeBuildTarget(target, name, canonicalRoot, filesystem);
    } catch {
      succeeded = false;
    }
  }
  return succeeded;
}

async function validateSourcePath(relativePath, canonicalRoot, filesystem) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\')) {
    throw new TypeError(STATIC_BUILD_ERROR);
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(STATIC_BUILD_ERROR);
  }

  let lexicalPath = PROJECT_ROOT;
  let canonicalPath = canonicalRoot;
  for (let index = 0; index < parts.length; index += 1) {
    lexicalPath = resolve(lexicalPath, parts[index]);
    canonicalPath = resolve(canonicalPath, parts[index]);
    const info = await filesystem.lstat(lexicalPath);
    if (info.isSymbolicLink()) throw new TypeError(STATIC_BUILD_ERROR);
    if (index < parts.length - 1 ? !info.isDirectory() : !info.isFile()) {
      throw new TypeError(STATIC_BUILD_ERROR);
    }
    const resolvedPath = await filesystem.realpath(lexicalPath);
    if (!samePath(resolvedPath, canonicalPath) || !isContainedBy(canonicalRoot, resolvedPath)) {
      throw new TypeError(STATIC_BUILD_ERROR);
    }
  }
  return lexicalPath;
}

async function copyAllowlistedFile(relativePath, destinationRoot, canonicalRoot, filesystem) {
  const source = await validateSourcePath(relativePath, canonicalRoot, filesystem);
  const destination = resolve(destinationRoot, relativePath);
  if (!isContainedBy(destinationRoot, destination)) throw new TypeError(STATIC_BUILD_ERROR);
  await filesystem.mkdir(dirname(destination), { recursive: true });
  await filesystem.copyFile(source, destination);
}

async function listOutputFiles(directory, filesystem, prefix = '') {
  const currentDirectory = prefix ? resolve(directory, prefix) : directory;
  if (!isContainedBy(directory, currentDirectory)) throw new TypeError(STATIC_BUILD_ERROR);
  const entries = await filesystem.readdir(currentDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new TypeError(STATIC_BUILD_ERROR);
    if (entry.isDirectory()) files.push(...await listOutputFiles(directory, filesystem, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new TypeError(STATIC_BUILD_ERROR);
  }
  return files;
}

function sameInventory(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

export function isAdminPreviewBuildEnabled(environment) {
  try {
    return Boolean(
      environment
      && typeof environment === 'object'
      && !Array.isArray(environment)
      && environment.VERCEL_ENV === 'preview'
      && environment.ENABLE_ADMIN_CMS_PREVIEW === 'true'
    );
  } catch {
    return false;
  }
}

async function acquireBuildLock(canonicalRoot, filesystem) {
  if (!samePath(dirname(BUILD_LOCK_PATH), PROJECT_ROOT)) throw new TypeError(STATIC_BUILD_ERROR);
  const canonicalParent = await filesystem.realpath(dirname(BUILD_LOCK_PATH));
  if (!samePath(canonicalParent, canonicalRoot)) throw new TypeError(STATIC_BUILD_ERROR);
  const handle = await filesystem.open(BUILD_LOCK_PATH, 'wx', 0o600);
  try {
    const identity = await handle.stat();
    return Object.freeze({ handle, identity });
  } catch {
    try {
      await handle.close();
    } catch {
      // The lock is intentionally preserved for manual verification even when
      // closing the acquired handle also fails.
    }
    throw new StaticBuildFailure(STATIC_BUILD_CLEANUP_ERROR);
  }
}

async function releaseBuildLock(lock, filesystem) {
  if (!lock) return true;
  let succeeded = true;
  try {
    await lock.handle.close();
  } catch {
    succeeded = false;
  }
  try {
    const pathInfo = await filesystem.lstat(BUILD_LOCK_PATH);
    if (
      pathInfo.isSymbolicLink()
      || !pathInfo.isFile()
      || pathInfo.dev !== lock.identity.dev
      || pathInfo.ino !== lock.identity.ino
    ) return false;
    await filesystem.rm(BUILD_LOCK_PATH, { force: false });
  } catch {
    succeeded = false;
  }
  return succeeded;
}

async function buildVercelStaticSiteInternal(options) {
  const { environment, filesystem } = requireBuildOptions(options);
  const canonicalRoot = await canonicalProjectRoot(filesystem);
  const adminPreviewEnabled = isAdminPreviewBuildEnabled(environment);
  const runtimeFiles = adminPreviewEnabled
    ? Object.freeze([...STATIC_RUNTIME_FILES, ...ADMIN_PREVIEW_FILES])
    : STATIC_RUNTIME_FILES;
  const expectedOutputFiles = adminPreviewEnabled
    ? ADMIN_PREVIEW_OUTPUT_FILES
    : PRODUCTION_OUTPUT_FILES;
  let lock = null;

  try {
    lock = await acquireBuildLock(canonicalRoot, filesystem);
    if (!await cleanupBuildTargets(canonicalRoot, filesystem)) {
      throw new TypeError(STATIC_BUILD_ERROR);
    }

    await filesystem.mkdir(DEFAULT_TEMPORARY_DIRECTORY, { recursive: false });
    await inspectBuildTarget(
      DEFAULT_TEMPORARY_DIRECTORY,
      normalRelativePath(relative(PROJECT_ROOT, DEFAULT_TEMPORARY_DIRECTORY)),
      canonicalRoot,
      filesystem,
    );

    for (const relativePath of runtimeFiles) {
      await copyAllowlistedFile(relativePath, DEFAULT_TEMPORARY_DIRECTORY, canonicalRoot, filesystem);
    }

    await filesystem.mkdir(resolve(DEFAULT_TEMPORARY_DIRECTORY, 'js'), { recursive: true });
    await generatePublicSupabaseConfig({
      environment,
      outputPath: resolve(DEFAULT_TEMPORARY_DIRECTORY, GENERATED_CONFIG_FILE),
      writeFileImpl: filesystem.writeFile,
    });

    const inventory = (await listOutputFiles(DEFAULT_TEMPORARY_DIRECTORY, filesystem)).sort();
    if (!sameInventory(inventory, expectedOutputFiles)) throw new TypeError(STATIC_BUILD_ERROR);

    await filesystem.rename(DEFAULT_TEMPORARY_DIRECTORY, DEFAULT_OUTPUT_DIRECTORY);
    await inspectBuildTarget(DEFAULT_OUTPUT_DIRECTORY, 'dist', canonicalRoot, filesystem);

    if (!await releaseBuildLock(lock, filesystem)) {
      lock = null;
      await cleanupBuildTargets(canonicalRoot, filesystem);
      throw new StaticBuildFailure(STATIC_BUILD_CLEANUP_ERROR);
    }
    lock = null;
    return Object.freeze({
      outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
      files: Object.freeze([...inventory]),
    });
  } catch (error) {
    let classification = error instanceof StaticBuildFailure
      ? error.classification
      : STATIC_BUILD_ERROR;
    if (lock) {
      const cleanupSucceeded = await cleanupBuildTargets(canonicalRoot, filesystem);
      const releaseSucceeded = await releaseBuildLock(lock, filesystem);
      if (!cleanupSucceeded || !releaseSucceeded) {
        classification = STATIC_BUILD_CLEANUP_ERROR;
      }
    }
    throw new StaticBuildFailure(classification);
  }
}

export async function buildVercelStaticSite(options = {}) {
  try {
    return await buildVercelStaticSiteInternal(options);
  } catch (error) {
    const classification = error instanceof StaticBuildFailure
      ? error.classification
      : STATIC_BUILD_ERROR;
    throw new TypeError(classification);
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildVercelStaticSite();
    process.stdout.write(`Prepared ${result.files.length} allowlisted static files.\n`);
  } catch (error) {
    const classification = error instanceof TypeError
      && error.message === STATIC_BUILD_CLEANUP_ERROR
      ? STATIC_BUILD_CLEANUP_ERROR
      : STATIC_BUILD_ERROR;
    process.stderr.write(`${classification}\n`);
    process.exitCode = 1;
  }
}
