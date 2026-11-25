import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPublicSupabaseConfig } from './generate-supabase-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_PAGES = Object.freeze([
  'index.html', 'login.html', 'register.html', 'verify-email.html', 'auth-callback.html',
  'forgot-password.html', 'reset-password.html', 'styles.css', 'auth.css',
]);
const ASSETS = Object.freeze([
  'assets/beef-stew.png', 'assets/hero-bowl.png', 'assets/recipefinder-favicon.svg',
]);
const FORBIDDEN = new Set([
  'app.js', 'js/data.js', 'js/fictional-external-recipe-source.js',
  'js/recipe-catalog.js', 'js/recipe-catalog-composition.js',
  'js/dashboard-recipe-catalog-loader.js', 'js/filters.js', 'js/render.js', 'js/modal.js',
  'js/supabase-recipe-source.js',
]);
const ROOT_ENTRY = 'js/option-b-app.js';
const AUTH_ENTRIES = Object.freeze([
  'js/login-browser.js', 'js/registration-browser.js',
  'js/auth-callback-browser.js', 'js/password-recovery-browser.js',
]);
const ADMIN_FILES = Object.freeze(['admin.html', 'admin.css']);
const MODULE_RE = /(?:\b(?:import|export)\s+(?:[\s\S]*?\bfrom\s*)?['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\))/g;

function relativeImport(owner, specifier) {
  const candidate = resolve(ROOT, dirname(owner), specifier);
  const prefix = `${ROOT}${sep}`;
  if (!candidate.startsWith(prefix) || !candidate.endsWith('.js')) {
    throw new TypeError('Candidate contains an unsupported module import.');
  }
  return candidate.slice(prefix.length).split(sep).join('/');
}

async function collectModules(entries, includeAdmin) {
  const pending = [...entries];
  const files = new Set();
  while (pending.length) {
    const path = pending.pop();
    if (files.has(path)) continue;
    if (FORBIDDEN.has(path)) throw new TypeError('Candidate imports a legacy full-detail module.');
    const source = await readFile(resolve(ROOT, path), 'utf8');
    files.add(path);
    for (const match of source.matchAll(MODULE_RE)) {
      const imported = relativeImport(path, match[1] ?? match[2]);
      if (imported === 'js/supabase-config.js') continue;
      if (imported === 'js/dashboard-admin-link.js' && !includeAdmin) continue;
      pending.push(imported);
    }
  }
  return [...files].sort();
}

/**
 * Builds only into a new OS temporary directory. This cannot replace `dist`
 * or the normal Production/Admin Preview build. The caller supplies browser-
 * safe public config explicitly; there is no environment or secret fallback.
 */
export async function buildOptionBCandidate({ publicConfig, adminPreview = false, adminProduction = false } = {}) {
  const includeAdmin = adminPreview === true || adminProduction === true;
  const configSource = renderPublicSupabaseConfig(publicConfig, {
    adminPreviewAvailable: adminPreview === true,
    adminProductionAvailable: adminProduction === true,
  });
  const entries = [ROOT_ENTRY, ...AUTH_ENTRIES, ...(includeAdmin ? ['js/admin-browser.js', 'js/dashboard-admin-link.js'] : [])];
  const modules = await collectModules(entries, includeAdmin);
  const files = [...ROOT_PAGES, ...ASSETS, ...modules, ...(includeAdmin ? ADMIN_FILES : [])].sort();
  if (files.some((path, index) => index > 0 && files[index - 1] === path)) throw new TypeError('Candidate inventory is duplicated.');
  const directory = await mkdtemp(join(tmpdir(), 'recipefinder-option-b-'));
  try {
    for (const path of files) {
      const destination = resolve(directory, path);
      await mkdir(dirname(destination), { recursive: true });
      if (path === 'index.html') {
        const html = await readFile(resolve(ROOT, path), 'utf8');
        const oldEntry = '<script type="module" src="app.js"></script>';
        if (html.split(oldEntry).length !== 2) throw new TypeError('Dashboard entry point is unexpected.');
        const oldSearchCopy = 'Search recipes, ingredients, or cuisines…';
        if (html.split(oldSearchCopy).length !== 2) throw new TypeError('Dashboard search copy is unexpected.');
        const candidateHtml = html
          .replace(oldEntry, '<script type="module" src="js/option-b-app.js"></script>')
          .replace(oldSearchCopy, 'Search recipe names, descriptions, categories, or cuisines…');
        await writeFile(destination, candidateHtml, 'utf8');
      } else if (path === 'login.html') {
        const html = await readFile(resolve(ROOT, path), 'utf8');
        const oldCopy = 'Your recipes are still publicly browsable—an account will only add cloud features later.';
        if (html.split(oldCopy).length !== 2) throw new TypeError('Login copy is unexpected.');
        await writeFile(destination, html.replace(oldCopy,
          'Browse recipe previews. Sign in to view full RecipeFinder recipe details.'), 'utf8');
      } else await copyFile(resolve(ROOT, path), destination);
    }
    await writeFile(resolve(directory, 'js/supabase-config.js'), configSource, { encoding: 'utf8', flag: 'wx' });
    return Object.freeze({ directory, files: Object.freeze([...files, 'js/supabase-config.js'].sort()) });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
