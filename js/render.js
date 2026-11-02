import { categories, cuisines } from './data.js';
import { recipeCatalog } from './recipe-catalog.js';
import { safeImageUrl, setSafeText } from './security.js';
import { state } from './state.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const favoriteActionIds = new WeakMap();
const EXTERNAL_ERROR_MESSAGES = Object.freeze({
  timeout: 'Offline recipe previews took too long. Try again.',
  network: 'Offline recipe previews are temporarily unavailable. Try again.',
  service: 'Offline recipe previews are temporarily unavailable. Try again.',
  invalid: 'Offline recipe preview data could not be used safely.',
  unavailable: 'Offline recipe previews could not be loaded. Try again.',
});
const LIVE_ERROR_MESSAGES = Object.freeze({
  timeout: 'TheMealDB took too long to respond. Try again.',
  network: 'TheMealDB is temporarily unavailable. Try again.',
  service: 'TheMealDB could not complete this search. Try again later.',
  invalid: 'TheMealDB returned recipe data that could not be used safely.',
  unavailable: 'TheMealDB results could not be loaded. Try again.',
});

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) setSafeText(element, text);
  return element;
}

export function getFavoriteActionId(element) {
  if (!element || typeof element !== 'object') return null;
  return favoriteActionIds.get(element) ?? element.dataset?.favorite ?? null;
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

function normalizeFavoritesPresentation(presentation) {
  const mode = ['guest', 'account-loading', 'account-ready', 'account-error'].includes(presentation?.mode)
    ? presentation.mode
    : 'guest';
  const favoriteIds = Array.isArray(presentation?.favoriteIds)
    ? presentation.favoriteIds
    : [...state.favorites];
  const pendingRecipeIds = Array.isArray(presentation?.pendingRecipeIds)
    ? presentation.pendingRecipeIds
    : [];
  return Object.freeze({
    mode,
    favoriteIds: Object.freeze([...favoriteIds]),
    favoriteSet: new Set(favoriteIds),
    pendingSet: new Set(pendingRecipeIds),
    message: typeof presentation?.message === 'string' ? presentation.message : '',
  });
}

function recipeCard(recipe, favorites) {
  const isExternal = recipe.source === 'external';
  const isLiveMealDb = isExternal && recipe.externalProvider === 'themealdb';
  const hasLiveDetails = isLiveMealDb
    && recipe.detailLevel === 'full'
    && /^external:themealdb:\d+$/.test(recipe.id);
  const hasOfflineDetails = isExternal
    && recipe.externalProvider === 'fictional-offline'
    && /^external:fictional-offline:\d+$/.test(recipe.id);
  const saved = favorites.favoriteSet.has(recipe.id);
  const accountMode = favorites.mode !== 'guest';
  const accountEligible = favorites.mode === 'account-ready' && recipe.source === 'database';
  const favoriteDisabled = accountMode && (!accountEligible || favorites.pendingSet.has(recipe.id));
  const card = createElement('article', `recipe-card${isExternal ? ' external-preview' : ''}`);
  card.dataset.id = recipe.id;

  const image = configureRecipeImage(document.createElement('img'), recipe, 'card-image');
  image.loading = 'lazy';
  card.append(image);

  if (!isLiveMealDb) {
    const heart = createElement('button', `heart${saved ? ' saved' : ''}`, saved ? '♥' : '♡');
    heart.type = 'button';
    if (!favoriteDisabled) heart.dataset.favorite = recipe.id;
    if (!favoriteDisabled) favoriteActionIds.set(heart, recipe.id);
    heart.disabled = favoriteDisabled;
    heart.setAttribute('aria-disabled', String(favoriteDisabled));
    heart.setAttribute('aria-label', `${saved ? 'Remove from' : 'Save to'} favorites`);
    card.append(heart);
  }

  const body = createElement('div', 'card-body');
  if (isExternal) body.append(createElement('span', 'recipe-source', isLiveMealDb ? 'TheMealDB recipe' : 'Offline recipe preview'));
  const tags = createElement('div', 'tags');
  tags.append(createElement('span', 'tag', recipe.category), createElement('span', 'tag alt', recipe.cuisine));
  const description = recipe.description || (isLiveMealDb
    ? hasLiveDetails ? 'View ingredients and cooking instructions.' : 'Live recipe details are not available.'
    : isExternal ? 'Recipe details are reserved for a later offline preview.' : '');
  body.append(tags, createElement('h3', '', recipe.name), createElement('p', '', description));

  const viewButton = createElement('button', 'view-btn', 'View recipe →');
  viewButton.type = 'button';
  if (hasOfflineDetails || hasLiveDetails) {
    viewButton.dataset.externalView = recipe.id;
    viewButton.setAttribute('aria-label', `${hasLiveDetails ? 'View TheMealDB recipe' : 'View offline details'} for ${recipe.name}`);
  } else if (isExternal) {
    setSafeText(viewButton, isLiveMealDb ? 'Details unavailable' : 'Preview only');
    viewButton.disabled = true;
    viewButton.setAttribute('aria-label', `${recipe.name} details are not available${isLiveMealDb ? ' for this live result' : ' in this preview'}`);
  } else {
    viewButton.dataset.view = recipe.id;
  }
  body.append(viewButton);
  card.append(body);
  return card;
}

function unavailableFavoriteCard(entry, favorites) {
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
  remove.disabled = favorites.mode !== 'guest';
  remove.setAttribute('aria-disabled', String(remove.disabled));
  if (!remove.disabled) favoriteActionIds.set(remove, model.opaqueId);
  remove.setAttribute('aria-label', model.removeLabel);
  body.append(remove);
  card.append(art, body);
  return card;
}

function unavailableFavoritePreview(entry, favorites) {
  const model = createUnavailableFavoriteViewModel(entry.id);
  const item = createElement('div', 'favorite-item unavailable-favorite-item');
  const icon = createElement('span', 'favorite-placeholder-icon', '♡');
  icon.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('div');
  copy.append(createElement('strong', '', model.title), createElement('small', '', model.status));
  const remove = createElement('button', 'mini-remove unavailable-favorite-remove', '×');
  remove.type = 'button';
  remove.disabled = favorites.mode !== 'guest';
  remove.setAttribute('aria-disabled', String(remove.disabled));
  if (!remove.disabled) favoriteActionIds.set(remove, model.opaqueId);
  remove.setAttribute('aria-label', model.removeLabel);
  item.append(icon, copy, remove);
  return item;
}

function renderFavorites(catalog, externalState, favoriteEntries, favorites) {
  $('#fav-count').textContent = favorites.favoriteIds.length;
  const status = $('#favorites-status');
  status.textContent = favorites.message;
  status.hidden = favorites.message.length === 0;
  $('#favorites').setAttribute('aria-busy', String(favorites.mode === 'account-loading'));
  const list = $('#favorite-list');
  list.replaceChildren();
  if (!favoriteEntries.length) {
    list.append(createElement('p', 'empty-mini', 'No saved recipes yet. Tap a heart to keep one here.'));
    return;
  }

  favoriteEntries.slice(0, 4).forEach((entry) => {
    if (!entry.resolved) {
      list.append(unavailableFavoritePreview(entry, favorites));
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
  const backToOffline = $('#back-to-offline');
  const attribution = $('#mealdb-attribution');
  const discoverMore = $('#discover-more-recipes');
  const recommended = $('#recommended');
  const currentStatus = externalState?.status || 'idle';
  const isLiveMealDb = externalState?.provider === 'themealdb';
  const showingAll = state.view === 'all';
  const discoverLabels = {
    idle: 'Discover More Offline Recipes',
    loading: 'Discovering Offline Recipes…',
    ready: 'Offline Recipes Added',
    empty: 'No More Offline Recipes',
    error: 'Discover More Offline Recipes',
  };
  recommended.setAttribute('aria-busy', String(currentStatus === 'loading'));
  status.hidden = currentStatus === 'idle';
  retry.hidden = currentStatus !== 'error';
  backToOffline.hidden = !isLiveMealDb;
  attribution.hidden = !isLiveMealDb;
  discoverMore.hidden = isLiveMealDb || !showingAll;
  discoverMore.textContent = discoverLabels[currentStatus] || discoverLabels.error;
  discoverMore.setAttribute('aria-disabled', String(currentStatus !== 'idle'));

  if (isLiveMealDb && currentStatus === 'loading') message.textContent = 'Searching TheMealDB...';
  else if (isLiveMealDb && currentStatus === 'ready') {
    const count = externalState.recipes.length;
    message.textContent = `${count} TheMealDB recipe${count === 1 ? '' : 's'} found. Results provided by TheMealDB.`;
  } else if (isLiveMealDb && currentStatus === 'empty') message.textContent = 'No TheMealDB recipes matched this search.';
  else if (isLiveMealDb && currentStatus === 'error') {
    message.textContent = LIVE_ERROR_MESSAGES[externalState.error?.code] || LIVE_ERROR_MESSAGES.unavailable;
  } else if (currentStatus === 'loading') message.textContent = 'Checking the offline recipe preview collection...';
  else if (currentStatus === 'ready') {
    const count = externalState.recipes.length;
    message.textContent = `${count} offline recipe preview${count === 1 ? '' : 's'} added.`;
  } else if (currentStatus === 'empty') message.textContent = 'No additional offline recipe previews matched.';
  else if (currentStatus === 'error') {
    message.textContent = EXTERNAL_ERROR_MESSAGES[externalState.error?.code] || EXTERNAL_ERROR_MESSAGES.unavailable;
  } else message.textContent = '';
}

export function render(catalog = recipeCatalog, externalState = null, presentation = null) {
  const favorites = normalizeFavoritesPresentation(presentation);
  const isLiveMealDb = externalState?.provider === 'themealdb';
  const favoriteEntries = catalog.resolveFavoriteIds(favorites.favoriteSet);
  const filteredRecipes = catalog.filter(state.query, state.filter);
  const visibleRecipes = isLiveMealDb && state.view !== 'favorites'
    ? externalState.recipes
    : state.view === 'favorites'
    ? favoriteEntries.filter(({ resolved }) => resolved).map(({ recipe }) => recipe)
    : filteredRecipes;
  const showingFullView = state.view === 'all' || state.view === 'favorites';
  const recommendedCards = state.view === 'favorites'
    ? favoriteEntries.map((entry) => entry.resolved
      ? recipeCard(entry.recipe, favorites)
      : unavailableFavoriteCard(entry, favorites))
    : (isLiveMealDb || showingFullView ? visibleRecipes : visibleRecipes.slice(0, 4))
      .map((recipe) => recipeCard(recipe, favorites));
  const visibleCount = state.view === 'favorites' ? favoriteEntries.length : visibleRecipes.length;

  $('#recommended-title').textContent = isLiveMealDb
    ? 'TheMealDB search results'
    : state.view === 'favorites'
    ? '💗 My saved recipes'
    : state.view === 'all'
      ? '🍴 All recipes'
      : '🍴 Recommended for you';
  $('#back-to-discover').hidden = !showingFullView;
  $('#recommended-view-all').hidden = isLiveMealDb || showingFullView;
  $('#recommended-grid').replaceChildren(...recommendedCards);
  $('#more-grid').replaceChildren(...(showingFullView
    ? []
    : visibleRecipes.slice(4).map((recipe) => recipeCard(recipe, favorites))));
  $('#more-recipes').hidden = isLiveMealDb || showingFullView;
  $('#empty-state').hidden = visibleCount > 0 || ['loading', 'error'].includes(externalState?.status);
  $('#empty-title').textContent = state.view === 'favorites' && favorites.mode === 'account-loading'
    ? 'Loading saved recipes'
    : state.view === 'favorites' && favorites.mode === 'account-error'
      ? 'Saved recipes unavailable'
      : isLiveMealDb
    ? 'No TheMealDB recipes found'
    : state.view === 'favorites' ? 'No saved recipes yet' : 'No recipes found';
  $('#empty-message').textContent = state.view === 'favorites' && favorites.mode === 'account-loading'
    ? 'Please wait while your account favorites are restored.'
    : state.view === 'favorites' && favorites.mode === 'account-error'
      ? 'Your account favorites could not be loaded safely. Please try again later.'
      : isLiveMealDb
    ? 'Try another recipe name or return to offline recipes.'
    : state.view === 'favorites'
    ? 'Save recipes with the heart button and they will appear here.'
    : 'Try another search or clear your filters.';
  $$('.category').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  $$('.quick-filters button').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  $$('.cuisine').forEach((button) => button.classList.toggle('active', button.dataset.filter === state.filter));
  renderFavorites(catalog, externalState, favoriteEntries, favorites);
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
