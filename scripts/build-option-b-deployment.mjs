import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOptionBCandidate } from './build-option-b-candidate.mjs';
import { isAdminPreviewBuildEnabled } from './build-vercel-static.mjs';
import { resolvePublicSupabaseConfig } from './generate-supabase-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = resolve(ROOT, 'dist');

function contained(root, target) {
  const child = relative(root, target);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`));
}

async function outputFiles(directory, prefix = '') {
  const entries = await readdir(resolve(directory, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new TypeError('Unsafe build output.');
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await outputFiles(directory, path));
    else if (entry.isFile()) files.push(path);
    else throw new TypeError('Unsafe build output.');
  }
  return files.sort();
}

/** Converts the separately reviewed candidate into the normal Vercel dist artifact. */
export async function buildOptionBDeployment({ environment = process.env, outputDirectory = DEFAULT_OUTPUT } = {}) {
  const publicConfig = resolvePublicSupabaseConfig(environment);
  const adminPreview = isAdminPreviewBuildEnabled(environment);
  const output = resolve(outputDirectory);
  if (output.split(sep).at(-1) !== 'dist') throw new TypeError('Unsafe build output.');
  await realpath(dirname(output));
  const parent = dirname(output);

  let candidate;
  let staging;
  try {
    candidate = await buildOptionBCandidate({ publicConfig, adminPreview });
    staging = await mkdtemp(join(parent, '.recipefinder-option-b-build-'));
    for (const path of candidate.files) {
      const destination = resolve(staging, path);
      if (!contained(staging, destination)) throw new TypeError('Unsafe build output.');
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(candidate.directory, path), destination);
    }
    const inventory = await outputFiles(staging);
    if (JSON.stringify(inventory) !== JSON.stringify(candidate.files)) throw new TypeError('Build inventory changed.');

    try {
      const existing = await lstat(output);
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new TypeError('Unsafe build output.');
      await rm(output, { recursive: true, force: false });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await rename(staging, output);
    staging = null;
    return Object.freeze({ outputDirectory: output, files: Object.freeze(inventory) });
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    if (candidate) await rm(candidate.directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await buildOptionBDeployment();
    process.stdout.write(`Prepared ${result.files.length} Option B static files.\n`);
  } catch {
    process.stderr.write('Option B production build failed.\n');
    process.exitCode = 1;
  }
}
