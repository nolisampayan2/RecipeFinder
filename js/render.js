import { categories, cuisines } from './data.js';
import { recipeCatalog } from './recipe-catalog.js';
import { safeImageUrl, setSafeText } from './security.js';
import { state } from './state.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) setSafeText(element, text);
  return element;
}

function configureRecipeImage(image, recipe, className, alt = recipe.name) {
  image.className = className;
  image.alt = alt;
  const source = safeImageUrl(recipe.image);
  const fallback = safeImageUrl(recipe.fallbackImage);
  if (source) image.src = source;
  if (fallback) image.dataset.fallbackImage = fallback;
  return image;
}

function recipeCard(recipe) {
  const saved = state.favorites.has(recipe.id);
  const card = createElement('article', 'recipe-card');
  card.dataset.id = recipe.id;

  const image = configureRecipeImage(document.createElement('img'), recipe, 'card-image');
  image.loading = 'lazy';
  card.append(image);

  const heart = createElement('button', `heart${saved ? ' saved' : ''}`, saved ? '♥' : '♡');
  heart.type = 'button';
  heart.dataset.favorite = recipe.id;
  heart.setAttribute('aria-label', `${saved ? 'Remove from' : 'Save to'} favorites`);
  card.append(heart);

  const body = createElement('div', 'card-body');
  const tags = createElement('div', 'tags');
  tags.append(createElement('span', 'tag', recipe.category), createElement('span', 'tag alt', recipe.cuisine));
  body.append(tags, createElement('h3', '', recipe.name), createElement('p', '', recipe.description));

  const viewButton = createElement('button', 'view-btn', 'View recipe →');
  viewButton.type = 'button';
  viewButton.dataset.view = recipe.id;
  body.append(viewButton);
  card.append(body);
  return card;
}

function renderFavorites() {
  const favorites = recipeCatalog.resolveFavoriteIds(state.favorites)
    .filter(({ resolved }) => resolved)
    .map(({ recipe }) => recipe);
  $('#fav-count').textContent = favorites.length;
  const list = $('#favorite-list');
  list.replaceChildren();
  if (!favorites.length) {
    list.append(createElement('p', 'empty-mini', 'No saved recipes yet. Tap a heart to keep one here.'));
    return;
  }

  favorites.slice(0, 4).forEach((recipe) => {
    const item = createElement('div', 'favorite-item');
    item.append(configureRecipeImage(document.createElement('img'), recipe, '', ''));
    const copy = document.createElement('div');
    copy.append(createElement('strong', '', recipe.name), createElement('small', '', recipe.category));
    item.append(copy);
    const remove = createElement('button', 'mini-remove', '×');
    remove.type = 'button';
    remove.dataset.favorite = recipe.id;
    remove.setAttribute('aria-label', `Remove ${recipe.name}`);
    item.append(remove);
    list.append(item);
  });
}

export function render() {
  const filteredRecipes = recipeCatalog.filter(state.query, state.filter);
  const visibleRecipes = state.view === 'favorites'
    ? recipeCatalog.resolveFavoriteIds(state.favorites)
      .filter(({ resolved }) => resolved)
      .map(({ recipe }) => recipe)
    : filteredRecipes;
  const showingFullView = state.view === 'all' || state.view === 'favorites';

  $('#recommended-title').textContent = state.view === 'favorites'
    ? '💗 My saved recipes'
    : state.view === 'all'
      ? '🍴 All recipes'
      : '🍴 Recommended for you';
  $('#back-to-discover').hidden = !showingFullView;
  $('#recommended-view-all').hidden = showingFullView;
  $('#recommended-grid').replaceChildren(...(showingFullView ? visibleRecipes : visibleRecipes.slice(0, 4)).map(recipeCard));
  $('#more-grid').replaceChildren(...(showingFullView ? [] : visibleRecipes.slice(4).map(recipeCard)));
  $('#more-recipes').hidden = showingFullView;
  $('#empty-state').hidden = visibleRecipes.length > 0;
  $('#empty-title').textContent = state.view === 'favorites' ? 'No saved recipes yet' : 'No recipes found';
  $('#empty-message').textContent = state.view === 'favorites'
    ? 'Save recipes with the heart button and they will appear here.'
    : 'Try another search or clear your filters.';
  $$('.category').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  $$('.quick-filters button').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  $$('.cuisine').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  renderFavorites();
}

export function renderCategories() {
  const recipes = recipeCatalog.list();
  const categoryButtons = categories.map(([name, emoji]) => {
    const recipe = recipes.find((item) => item.category === name);
    const displayRecipe = recipe || recipes[0];
    const button = createElement('button', 'category');
    button.type = 'button';
    button.dataset.filter = name;
    const image = configureRecipeImage(document.createElement('img'), displayRecipe, '', '');
    image.loading = 'lazy';
    button.append(image, createElement('span', '', `${emoji} ${name}`));
    return button;
  });
  $('#category-row').replaceChildren(...categoryButtons);
}

export function renderCuisines() {
  const cuisineButtons = cuisines.map(([name, flag]) => {
    const button = createElement('button', 'cuisine');
    button.type = 'button';
    button.dataset.filter = name;
    button.append(
      createElement('span', '', flag),
      createElement('strong', '', name),
      createElement('i', '', 'Explore →'),
    );
    return button;
  });
  $('#cuisine-list').replaceChildren(...cuisineButtons);
}

export function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

export function initializeImageFallbacks() {
  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const fallback = safeImageUrl(image.dataset.fallbackImage);
    if (!fallback || image.getAttribute('src') === fallback) return;
    image.src = fallback;
  }, true);
}
