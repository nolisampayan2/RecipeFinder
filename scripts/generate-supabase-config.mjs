import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateSupabaseConfig } from '../js/supabase-client.js';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');

export const GENERATED_CONFIG_PATH = resolve(PROJECT_ROOT, 'js', 'supabase-config.js');
export const CONFIG_GENERATION_ERROR = 'Public Supabase configuration generation failed.';

function readEnvironmentValue(environment, name) {
  try {
    return environment?.[name];
  } catch {
    throw new TypeError(CONFIG_GENERATION_ERROR);
  }
}

/**
 * Reads only the two browser-safe configuration inputs. A legacy anon key is
 * accepted as an alternative input name, never in addition to a publishable key.
 */
export function resolvePublicSupabaseConfig(environment = {}) {
  const url = readEnvironmentValue(environment, 'SUPABASE_URL');
  const publishableKey = readEnvironmentValue(environment, 'SUPABASE_PUBLISHABLE_KEY');
  const legacyAnonKey = readEnvironmentValue(environment, 'SUPABASE_ANON_KEY');

  if (publishableKey !== undefined && legacyAnonKey !== undefined) {
    throw new TypeError(CONFIG_GENERATION_ERROR);
  }

  try {
    return validateSupabaseConfig({
      url,
      publishableKey: publishableKey ?? legacyAnonKey,
    });
  } catch {
    throw new TypeError(CONFIG_GENERATION_ERROR);
  }
}

export function renderPublicSupabaseConfig(config, { adminPreviewAvailable = false } = {}) {
  let validated;
  try {
    validated = validateSupabaseConfig(config);
  } catch {
    throw new TypeError(CONFIG_GENERATION_ERROR);
  }

  return [
    '// Generated public browser configuration. Do not edit or commit this file.',
    '// RLS remains the authorization boundary; privileged keys are forbidden.',
    'export const SUPABASE_CONFIG = Object.freeze({',
    `  url: ${JSON.stringify(validated.url)},`,
    `  publishableKey: ${JSON.stringify(validated.publishableKey)},`,
    '});',
    `export const ADMIN_CMS_PREVIEW_AVAILABLE = ${adminPreviewAvailable === true};`,
    '',
  ].join('\n');
}

export async function generatePublicSupabaseConfig({
  environment = process.env,
  outputPath = GENERATED_CONFIG_PATH,
  writeFileImpl = writeFile,
  adminPreviewAvailable = false,
} = {}) {
  if (typeof writeFileImpl !== 'function') throw new TypeError(CONFIG_GENERATION_ERROR);

  const config = resolvePublicSupabaseConfig(environment);
  const source = renderPublicSupabaseConfig(config, { adminPreviewAvailable });

  try {
    await writeFileImpl(outputPath, source, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch {
    throw new TypeError(CONFIG_GENERATION_ERROR);
  }

  return Object.freeze({ outputPath, bytes: Buffer.byteLength(source, 'utf8') });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    await generatePublicSupabaseConfig();
    process.stdout.write('Generated ignored public Supabase browser configuration.\n');
  } catch {
    process.stderr.write(`${CONFIG_GENERATION_ERROR}\n`);
    process.exitCode = 1;
  }
}
