import { categories, cuisines } from './data.js';
import { recipeCatalog } from './recipe-catalog.js';
import { safeImageUrl, setSafeText } from './security.js';
import { state, toggleFavorite } from './state.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const EXTERNAL_ERROR_MESSAGES = Object.freeze({
  timeout: 'Offline recipe previews took too long. Try again.',
  network: 'Offline recipe previews are temporarily unavailable. Try again.',
  service: 'Offline recipe previews are temporarily unavailable. Try again.',
  invalid: 'Offline recipe preview data could not be used safely.',
  unavailable: 'Offline recipe previews could not be loaded. Try again.',
});

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) setSafeText(element, text);
  return element;
}

export function createUnavailableFavoriteViewModel(opaqueId) {
  return Object.freeze({
    opaqueId,
    title: 'Saved offline recipe',
    status: 'Preview currently unavailable',
    explanation: 'Find this recipe again using search or filters.',
    removeLabel: 'Remove saved offline recipe from favorites',
  });
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
  const isExternal = recipe.source === 'external';
  const saved = state.favorites.has(recipe.id);
  const card = createElement('article', `recipe-card${isExternal ? ' external-preview' : ''}`);
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
  if (isExternal) body.append(createElement('span', 'recipe-source', 'Offline recipe preview'));
  const tags = createElement('div', 'tags');
  tags.append(createElement('span', 'tag', recipe.category), createElement('span', 'tag alt', recipe.cuisine));
  const description = recipe.description || (isExternal ? 'Recipe details are reserved for a later offline preview.' : '');
  body.append(tags, createElement('h3', '', recipe.name), createElement('p', '', description));

  const viewButton = createElement('button', 'view-btn', 'View recipe →');
  viewButton.type = 'button';
  if (isExternal) {
    setSafeText(viewButton, 'Preview only');
    viewButton.disabled = true;
    viewButton.setAttribute('aria-label', `${recipe.name} details are not available in this preview`);
  } else {
    viewButton.dataset.view = recipe.id;
  }
  body.append(viewButton);
  card.append(body);
  return card;
}

function removeUnavailableFavorite(model, catalog, externalState) {
  toggleFavorite(model.opaqueId);
  render(catalog, externalState);
  showToast('Favorites updated');
}

function unavailableFavoriteCard(entry, catalog, externalState) {
  const model = createUnavailableFavoriteViewModel(entry.id);
  const card = createElement('article', 'recipe-card unavailable-favorite-card');
  const art = createElement('div', 'card-image unavailable-favorite-art', '♡');
  art.setAttribute('aria-hidden', 'true');
  const body = createElement('div', 'card-body');
  body.append(
    createElement('span', 'recipe-source', model.status),
    createElement('h3', '', model.title),
    createElement('p', '', model.explanation),
  );
  const remove = createElement('button', 'view-btn unavailable-favorite-remove', 'Remove favorite');
  remove.type = 'button';
  remove.setAttribute('aria-label', model.removeLabel);
  remove.addEventListener('click', () => removeUnavailableFavorite(model, catalog, externalState));
  body.append(remove);
  card.append(art, body);
  return card;
}

function unavailableFavoritePreview(entry, catalog, externalState) {
  const model = createUnavailableFavoriteViewModel(entry.id);
  const item = createElement('div', 'favorite-item unavailable-favorite-item');
  const icon = createElement('span', 'favorite-placeholder-icon', '♡');
  icon.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('div');
  copy.append(createElement('strong', '', model.title), createElement('small', '', model.status));
  const remove = createElement('button', 'mini-remove', '×');
  remove.type = 'button';
  remove.setAttribute('aria-label', model.removeLabel);
  remove.addEventListener('click', () => removeUnavailableFavorite(model, catalog, externalState));
  item.append(icon, copy, remove);
  return item;
}

function renderFavorites(catalog, externalState, favoriteEntries) {
  $('#fav-count').textContent = state.favorites.size;
  const list = $('#favorite-list');
  list.replaceChildren();
  if (!favoriteEntries.length) {
    list.append(createElement('p', 'empty-mini', 'No saved recipes yet. Tap a heart to keep one here.'));
    return;
  }

  favoriteEntries.slice(0, 4).forEach((entry) => {
    if (!entry.resolved) {
      list.append(unavailableFavoritePreview(entry, catalog, externalState));
      return;
    }
    const { recipe } = entry;
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

function renderExternalStatus(externalState) {
  const status = $('#external-status');
  const message = $('#external-status-message');
  const retry = $('#external-retry');
  const recommended = $('#recommended');
  const currentStatus = externalState?.status || 'idle';
  recommended.setAttribute('aria-busy', String(currentStatus === 'loading'));
  status.hidden = currentStatus === 'idle';
  retry.hidden = currentStatus !== 'error';

  if (currentStatus === 'loading') message.textContent = 'Checking the offline recipe preview collection...';
  else if (currentStatus === 'ready') {
    const count = externalState.recipes.length;
    message.textContent = `${count} offline recipe preview${count === 1 ? '' : 's'} added.`;
  } else if (currentStatus === 'empty') message.textContent = 'No additional offline recipe previews matched.';
  else if (currentStatus === 'error') {
    message.textContent = EXTERNAL_ERROR_MESSAGES[externalState.error?.code] || EXTERNAL_ERROR_MESSAGES.unavailable;
  } else message.textContent = '';
}

export function render(catalog = recipeCatalog, externalState = null) {
  const favoriteEntries = catalog.resolveFavoriteIds(state.favorites);
  const filteredRecipes = catalog.filter(state.query, state.filter);
  const visibleRecipes = state.view === 'favorites'
    ? favoriteEntries.filter(({ resolved }) => resolved).map(({ recipe }) => recipe)
    : filteredRecipes;
  const showingFullView = state.view === 'all' || state.view === 'favorites';
  const recommendedCards = state.view === 'favorites'
    ? favoriteEntries.map((entry) => entry.resolved
      ? recipeCard(entry.recipe)
      : unavailableFavoriteCard(entry, catalog, externalState))
    : (showingFullView ? visibleRecipes : visibleRecipes.slice(0, 4)).map(recipeCard);
  const visibleCount = state.view === 'favorites' ? favoriteEntries.length : visibleRecipes.length;

  $('#recommended-title').textContent = state.view === 'favorites'
    ? '💗 My saved recipes'
    : state.view === 'all'
      ? '🍴 All recipes'
      : '🍴 Recommended for you';
  $('#back-to-discover').hidden = !showingFullView;
  $('#recommended-view-all').hidden = showingFullView;
  $('#recommended-grid').replaceChildren(...recommendedCards);
  $('#more-grid').replaceChildren(...(showingFullView ? [] : visibleRecipes.slice(4).map(recipeCard)));
  $('#more-recipes').hidden = showingFullView;
  $('#empty-state').hidden = visibleCount > 0;
  $('#empty-title').textContent = state.view === 'favorites' ? 'No saved recipes yet' : 'No recipes found';
  $('#empty-message').textContent = state.view === 'favorites'
    ? 'Save recipes with the heart button and they will appear here.'
    : 'Try another search or clear your filters.';
  $$('.category').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  $$('.quick-filters button').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  $$('.cuisine').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  renderFavorites(catalog, externalState, favoriteEntries);
  renderExternalStatus(externalState);
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
