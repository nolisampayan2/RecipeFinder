const FAVORITES_KEY = 'recipefinder:favorites';
const THEME_KEY = 'recipefinder:theme';

export const state = {
  query: '',
  filter: '',
  view: 'default',
  favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')),
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
