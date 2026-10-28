import { LEGACY_FICTIONAL_RECIPE_ID_MAP } from './fictional-external-recipe-source.js';

const FAVORITES_KEY = 'recipefinder:favorites';
const THEME_KEY = 'recipefinder:theme';

export function migrateLegacyFictionalFavoriteIds(ids) {
  if (!Array.isArray(ids)) throw new TypeError('Favorite IDs must be an array.');
  const migrated = [];
  const seen = new Set();
  ids.forEach((id) => {
    const nextId = typeof id === 'string' ? LEGACY_FICTIONAL_RECIPE_ID_MAP[id] || id : id;
    if (seen.has(nextId)) return;
    seen.add(nextId);
    migrated.push(nextId);
  });
  return migrated;
}

function loadFavorites() {
  let stored;
  try {
    stored = localStorage.getItem(FAVORITES_KEY);
  } catch {
    return new Set();
  }
  if (stored === null) return new Set();
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    const migrated = migrateLegacyFictionalFavoriteIds(parsed);
    if (JSON.stringify(migrated) !== stored) {
      try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(migrated)); } catch { /* Keep the safe in-memory result. */ }
    }
    return new Set(migrated);
  } catch {
    return new Set();
  }
}

export const state = {
  query: '',
  filter: '',
  view: 'default',
  favorites: loadFavorites(),
};

export function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
}

export function clearFilters() {
  state.filter = '';
  state.query = '';
  state.view = 'default';
}

export function applyStoredTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'dark' || (!savedTheme && matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark');
  }
  return document.body.classList.contains('dark');
}

export function toggleTheme() {
  document.body.classList.toggle('dark');
  const dark = document.body.classList.contains('dark');
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  return dark;
}
