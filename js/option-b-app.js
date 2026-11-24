import { BUILT_IN_RECIPE_PREVIEWS, FICTIONAL_RECIPE_PREVIEWS } from './recipe-previews.js';
import { createRecipePreviewSession } from './recipe-preview-session.js';
import { createPublishedRecipePreviewService } from './supabase-recipe-previews.js';
import { createAuthenticatedRecipeDetailService } from './supabase-recipe-details.js';
import { createRecipeLoginGate } from './recipe-login-gate.js';
import { RECIPE_DETAIL_RESULT } from './recipe-detail-access-controller.js';
import { createOptionBModal } from './option-b-modal.js';
import { createDashboardAuthIntegration } from './dashboard-auth.js';
import { createDashboardAccountFavorites } from './dashboard-account-favorites.js';
import { createLiveMealDbDashboard } from './live-mealdb-dashboard.js';
import { initializeCategoryCarousel, toggleCategoriesExpansion } from './category-carousel.js';
import { safeImageUrl } from './security.js';
import { createSupabaseRecipeCollectionsService } from './supabase-recipe-collections.js';
import { createRecipeCollectionsController } from './recipe-collections-controller.js';
import { createMealDbClient } from './mealdb-client.js';
import { createMealDbRecipeSource } from './mealdb-recipe-source.js';

// This entry is used only by the explicit candidate build. It is never the
// current Production or Admin Preview entry point.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const CATEGORIES = Object.freeze([
  ['Chicken', '🍗'], ['Beef', '🥩'], ['Seafood', '🐟'], ['Pasta', '🍝'],
  ['Vegetarian', '🥗'], ['Dessert', '🍰'], ['Breakfast', '🍳'], ['Soup', '🥣'],
]);
const IMAGE_FALLBACK = 'assets/recipefinder-favicon.svg';
const CUISINE_NAMES = Object.freeze(['Italian', 'American', 'British', 'Mexican', 'Japanese', 'Indian', 'Mediterranean', 'French', 'Filipino']);
const FAVORITES_KEY = 'recipefinder:favorites';
const THEME_KEY = 'recipefinder:theme';
const mobile = matchMedia('(max-width: 980px)');
const modal = createOptionBModal(document);
let previewSession = null;
let accountFavorites = null;
let unsubscribeFavorites = null;
let adminLink = null;
let authState = Object.freeze({ status: 'loading', userId: null });
let favoriteState = Object.freeze({ mode: 'account-loading', favoriteIds: Object.freeze([]), pendingRecipeIds: Object.freeze([]), message: '' });
let search = '';
let filter = '';
let view = 'default';
let source = 'offline';
let pageOffset = null;
let pageGeneration = 0;
let detailGeneration = 0;
let retired = false;
const owned = new Map();
let live = null;
let guestFavoriteIds = loadGuestFavorites();
let collectionsController = null;
let collectionsEpoch = 0;
let displayedRecipe = null;
let collectionMealDb = null;

function node(tag, className = '', text = '') {
  const item = document.createElement(tag);
  if (className) item.className = className;
  item.textContent = text;
  return item;
}

function loadGuestFavorites() {
  try {
    const ids = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
    if (!Array.isArray(ids)) return new Set();
    return new Set(ids.filter((id) => typeof id === 'string' && id.length <= 200));
  } catch { return new Set(); }
}

function saveGuestFavorites() {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...guestFavoriteIds])); } catch { /* Keep in-memory favorites. */ }
}

function setSidebar(open) {
  const expanded = mobile.matches && open === true;
  const sidebar = $('#sidebar');
  sidebar.classList.toggle('open', expanded);
  sidebar.inert = mobile.matches && !expanded;
  if (sidebar.inert) sidebar.setAttribute('aria-hidden', 'true');
  else sidebar.removeAttribute('aria-hidden');
  $('#menu-btn').setAttribute('aria-expanded', String(expanded));
  $('#menu-btn').setAttribute('aria-label', expanded ? 'Close menu' : 'Open menu');
}

function closeDetail(restoreFocus = true) {
  detailGeneration += 1;
  displayedRecipe = null;
  modal.close({ restoreFocus });
  previewSession?.dismissDetail();
}

function installCollectionsPage() {
  const link = node('a', 'nav-link', 'My Recipe Collections');
  link.href = '#collections';
  link.dataset.section = 'collections';
  $('#main-nav').append(link);
  const section = node('section', 'content-section option-b-collections');
  section.id = 'collections';
  section.hidden = true;
  section.append(node('h2', '', 'My Recipe Collections'));
  const status = node('p', 'option-b-collections-status');
  status.id = 'collections-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const content = node('div');
  content.id = 'collections-content';
  section.append(status, content);
  $('#recommended').before(section);
}

function renderCollections() {
  const content = $('#collections-content');
  const status = $('#collections-status');
  content.replaceChildren();
  if (authState.status === 'guest') {
    status.textContent = 'Sign in to create and view your recipe collections.';
    const links = node('div', 'option-b-collections-actions');
    const signIn = node('a', 'view-btn', 'Sign In');
    signIn.href = 'login.html';
    const register = node('a', 'view-btn', 'Create Account');
    register.href = 'register.html';
    links.append(signIn, register);
    content.append(links);
    return;
  }
  const state = collectionsController?.getState();
  if (authState.status !== 'authenticated' || !state || state.status === 'loading') {
    status.textContent = 'Checking your collections…';
    return;
  }
  if (state.status === 'error') {
    status.textContent = state.message;
    const retry = node('button', 'view-btn', 'Retry');
    retry.type = 'button';
    retry.dataset.collectionRetry = 'true';
    content.append(retry);
    return;
  }
  status.textContent = state.pending ? 'Saving collection…' : state.message || (state.collections.length
    ? `${state.collections.length} collections` : 'No collections yet. Create one below.');
  const create = node('form', 'option-b-collections-form');
  create.dataset.collectionCreate = 'true';
  const input = node('input');
  input.name = 'name';
  input.required = true;
  input.maxLength = 80;
  input.placeholder = 'Collection name';
  input.setAttribute('aria-label', 'New collection name');
  const submit = node('button', 'view-btn', 'Create Collection');
  submit.type = 'submit';
  submit.disabled = state.pending;
  create.append(input, submit);
  content.append(create);
  for (const collection of state.collections) {
    const card = node('article', 'option-b-collection-card');
    card.append(node('h3', '', collection.name));
    const actions = node('div', 'option-b-collections-actions');
    const rename = node('form', 'option-b-collections-form');
    rename.dataset.collectionRename = collection.id;
    const name = node('input');
    name.name = 'name';
    name.value = collection.name;
    name.required = true;
    name.maxLength = 80;
    name.setAttribute('aria-label', `Rename ${collection.name}`);
    const renameButton = node('button', 'view-btn', 'Rename');
    renameButton.type = 'submit';
    renameButton.disabled = state.pending;
    rename.append(name, renameButton);
    const remove = node('button', 'view-btn', 'Delete Collection');
    remove.type = 'button';
    remove.dataset.collectionDelete = collection.id;
    remove.disabled = state.pending;
    actions.append(rename, remove);
    card.append(actions);
    if (!collection.items.length) card.append(node('p', '', 'No recipes in this collection yet.'));
    for (const item of collection.items) {
      const row = node('div', 'option-b-collection-item');
      const preview = owned.get(item.recipeId);
      const isMealDb = item.recipeId.startsWith('external:themealdb:');
      row.append(node('span', '', preview?.name ?? (isMealDb
        ? `TheMealDB recipe #${item.recipeId.split(':').at(-1)}` : 'Recipe preview unavailable')));
      const viewButton = node('button', 'view-btn', 'View Recipe');
      viewButton.type = 'button';
      viewButton.dataset.collectionView = item.recipeId;
      viewButton.disabled = state.pending;
      const removeItem = node('button', 'view-btn', 'Remove');
      removeItem.type = 'button';
      removeItem.dataset.collectionRemove = item.id;
      removeItem.dataset.collectionId = collection.id;
      removeItem.setAttribute('aria-label', `Remove recipe from ${collection.name}`);
      removeItem.disabled = state.pending;
      row.append(viewButton, removeItem);
      card.append(row);
    }
    content.append(card);
  }
}

function currentRecipes() {
  if (source === 'online') return live?.getState().status === 'ready' ? live.getState().recipes : [];
  const term = search.toLowerCase();
  const selected = filter.toLowerCase();
  return [...owned.values()].filter((recipe) =>
    (!term || [recipe.name, recipe.description, recipe.category, recipe.cuisine].join(' ').toLowerCase().includes(term))
    && (!selected || recipe.category.toLowerCase() === selected || recipe.cuisine.toLowerCase() === selected));
}

function favoriteIds() {
  return favoriteState.mode === 'guest' ? [...guestFavoriteIds] : favoriteState.favoriteIds;
}

function card(recipe) {
  const item = node('article', 'recipe-card');
  item.dataset.id = recipe.id;
  const image = node('img', 'card-image');
  image.alt = recipe.name;
  const fallback = safeImageUrl(recipe.fallbackImage) || IMAGE_FALLBACK;
  image.src = safeImageUrl(recipe.image) || fallback;
  image.dataset.fallbackImage = fallback;
  const heart = node('button', `heart${favoriteIds().includes(recipe.id) ? ' saved' : ''}`, favoriteIds().includes(recipe.id) ? '♥' : '♡');
  heart.type = 'button';
  heart.dataset.favorite = recipe.id;
  heart.setAttribute('aria-label', `${favoriteIds().includes(recipe.id) ? 'Remove' : 'Save'} ${recipe.name} ${favoriteIds().includes(recipe.id) ? 'from' : 'to'} favorites`);
  heart.disabled = !['guest', 'account-ready'].includes(favoriteState.mode)
    || (source === 'online' && favoriteState.mode !== 'guest');
  const copy = node('div', 'card-body');
  if (recipe.externalProvider === 'themealdb') copy.append(node('span', 'recipe-source', 'TheMealDB recipe'));
  else if (recipe.externalProvider === 'fictional-offline') copy.append(node('span', 'recipe-source', 'Fictional offline preview'));
  const tags = node('div', 'tags');
  tags.append(node('span', 'tag', recipe.category), node('span', 'tag alt', recipe.cuisine));
  const action = node('button', 'view-btn', 'View Recipe');
  action.type = 'button';
  action.dataset[source === 'online' ? 'mealdbView' : 'ownedView'] = recipe.id;
  action.setAttribute('aria-label', `View recipe for ${recipe.name}`);
  copy.append(tags, node('h3', '', recipe.name), node('p', '', recipe.description), action);
  item.append(image, heart, copy);
  return item;
}

function renderFavorites() {
  const ids = favoriteIds();
  $('#fav-count').textContent = String(ids.length);
  const status = $('#favorites-status');
  status.textContent = favoriteState.message;
  status.hidden = !favoriteState.message;
  const list = $('#favorite-list');
  list.replaceChildren();
  for (const id of ids.slice(0, 4)) {
    const recipe = owned.get(id) ?? (source === 'online' ? live?.getState().recipes.find((item) => item.id === id) : null);
    const item = node('div', 'favorite-item option-b-favorite-item');
    if (recipe) {
      const image = node('img');
      image.alt = '';
      image.loading = 'lazy';
      image.dataset.fallbackImage = safeImageUrl(recipe.fallbackImage) || IMAGE_FALLBACK;
      image.src = safeImageUrl(recipe.image) || image.dataset.fallbackImage;
      item.append(image);
    } else {
      const icon = node('span', 'favorite-placeholder-icon', '♡');
      icon.setAttribute('aria-hidden', 'true');
      item.append(icon);
    }
    const copy = node('div');
    copy.append(node('strong', '', recipe?.name ?? 'Saved recipe unavailable'));
    if (recipe) copy.append(node('small', '', recipe.category));
    item.append(copy);
    if (favoriteState.mode === 'guest' || (favoriteState.mode === 'account-ready' && owned.has(id))) {
      const remove = node('button', 'mini-remove', '×');
      remove.type = 'button';
      if (favoriteState.mode === 'guest' && !recipe) remove.dataset.removeUnresolved = id;
      else remove.dataset.favorite = id;
      remove.setAttribute('aria-label', `Remove ${recipe?.name ?? 'unavailable saved recipe'} from favorites`);
      item.append(remove);
    }
    list.append(item);
  }
  if (!ids.length) list.append(node('p', 'empty-mini', 'No saved recipes yet.'));
}

function render() {
  $('#collections').hidden = view !== 'collections';
  $('#recommended').hidden = view === 'collections';
  const recipes = currentRecipes();
  const ids = new Set(favoriteIds());
  const visible = view === 'favorites'
    ? recipes.filter((recipe) => ids.has(recipe.id))
    : recipes;
  $('#recommended-title').textContent = source === 'online' ? 'TheMealDB search results'
    : view === 'favorites' ? 'My saved recipes' : view === 'all' ? 'All recipes' : 'Recommended for you';
  const shown = view === 'default' && source === 'offline' ? visible.slice(0, 4) : visible;
  const cards = shown.map(card);
  if (view === 'favorites') {
    const known = new Set(shown.map((recipe) => recipe.id));
    for (const id of ids) {
      if (known.has(id)) continue;
      const unavailable = node('article', 'recipe-card unavailable-favorite-card');
      const copy = node('div', 'card-body');
      copy.append(node('h3', '', 'Saved recipe unavailable'),
        node('p', '', 'This saved recipe is not on the loaded preview page.'));
      if (favoriteState.mode === 'guest') {
        const remove = node('button', 'view-btn', 'Remove favorite');
        remove.type = 'button';
        remove.dataset.removeUnresolved = id;
        remove.setAttribute('aria-label', 'Remove unavailable saved recipe');
        copy.append(remove);
      }
      unavailable.append(copy);
      cards.push(unavailable);
    }
  }
  $('#recommended-grid').replaceChildren(...cards);
  $('#more-grid').replaceChildren(...(view === 'default' && source === 'offline' ? visible.slice(4).map(card) : []));
  $('#more-recipes').hidden = view !== 'default' || source === 'online';
  $('#recommended-view-all').hidden = view !== 'default' || source === 'online';
  $('#back-to-discover').hidden = view === 'default';
  $('#empty-state').hidden = cards.length > 0 || (source === 'online' && live?.getState().status === 'loading');
  $('#empty-title').textContent = view === 'favorites' ? 'No saved recipes here' : 'No recipes found';
  $('#empty-message').textContent = source === 'online' ? 'Try another recipe name.' : 'Try another search or filter.';
  const more = $('#discover-more-recipes');
  more.hidden = source === 'online' || pageOffset === null || view !== 'all';
  more.textContent = 'Load more recipe previews';
  more.setAttribute('aria-disabled', String(pageOffset === null));
  const externalStatus = $('#external-status');
  if (source === 'online') {
    const current = live?.getState();
    externalStatus.hidden = current?.status === 'idle' || !current;
    $('#external-status-message').textContent = current?.status === 'loading' ? 'Searching TheMealDB…'
      : current?.status === 'empty' ? 'No TheMealDB recipes matched this search.'
        : current?.status === 'error' ? 'TheMealDB results are unavailable. Try again.'
          : current?.status === 'ready' ? 'Recipe data and images provided by TheMealDB.' : '';
    $('#external-retry').hidden = current?.status !== 'error';
    $('#back-to-offline').hidden = false;
    $('#mealdb-attribution').hidden = current?.status !== 'ready';
  } else {
    $('#external-retry').hidden = true;
    $('#back-to-offline').hidden = true;
    $('#mealdb-attribution').hidden = true;
  }
  renderFavorites();
}

function renderTaxonomy() {
  $('#category-row').replaceChildren(...CATEGORIES.map(([name, emoji]) => {
    const button = node('button', 'category');
    button.type = 'button';
    button.dataset.filter = name;
    const recipe = BUILT_IN_RECIPE_PREVIEWS.find((preview) => preview.category === name);
    const image = node('img');
    image.alt = '';
    image.loading = 'lazy';
    image.dataset.fallbackImage = safeImageUrl(recipe?.fallbackImage) || IMAGE_FALLBACK;
    image.src = safeImageUrl(recipe?.image) || image.dataset.fallbackImage;
    button.append(image, node('span', '', `${emoji} ${name}`));
    return button;
  }));
  $('#cuisine-list').replaceChildren(...CUISINE_NAMES.map((name) => {
    const button = node('button', 'cuisine', name);
    button.type = 'button';
    button.dataset.filter = name;
    return button;
  }));
}

function handleImageError(event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const fallback = safeImageUrl(image.dataset.fallbackImage);
  if (fallback && image.getAttribute('src') !== fallback) image.src = fallback;
}

function scrollToSearchResults() {
  $('#recommended').scrollIntoView({
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
}

function handleSearchSubmit(event) {
  event.preventDefault();
  const query = $('#search-input').value.trim();
  if (source === 'online') {
    if (!query) return;
    search = query;
    filter = '';
    view = 'default';
    render();
    if (!live) live = createLiveMealDbDashboard({ fetchImpl: window.fetch.bind(window), onState: render });
    void live.search(query);
  } else {
    search = query;
    filter = '';
    view = 'default';
    render();
    void loadPreviews();
  }
  scrollToSearchResults();
}

function publishEligibleFavorites() {
  if (!accountFavorites) return;
  const recipes = Object.freeze([...owned.values()].map((recipe) => Object.freeze({ id: recipe.id, source: 'database' })));
  accountFavorites.handleCatalogResult({
    stale: false, origin: 'database', databaseStatus: 'success',
    catalog: { list: () => recipes },
  });
}

async function loadPreviews(offset = 0) {
  if (!previewSession || retired) return;
  const generation = ++pageGeneration;
  const status = $('#external-status');
  status.hidden = false;
  $('#external-status-message').textContent = 'Loading recipe previews…';
  const result = await previewSession.load({ search, filter, pageSize: 50, offset });
  if (retired || generation !== pageGeneration) return;
  if (offset === 0) owned.clear();
  if (result.catalog) {
    for (const recipe of result.catalog.list()) owned.set(recipe.id, recipe);
    pageOffset = result.databasePage?.continuationAvailable ? result.databasePage.nextOffset : null;
    if (result.error === null) publishEligibleFavorites();
    $('#external-status-message').textContent = result.partial
      ? 'Some recipe previews are unavailable.' : '';
    status.hidden = !result.partial;
  } else {
    pageOffset = null;
    $('#external-status-message').textContent = 'Recipe previews are unavailable. Try again later.';
  }
  render();
}

function resetOffline() {
  source = 'offline';
  $('#search-source-offline').checked = true;
  $('#search-source-online').checked = false;
  $('#offline-search-description').hidden = false;
  $('#online-search-disclosure').hidden = true;
  live?.reset();
  search = '';
  filter = '';
  $('#search-input').value = '';
  view = 'default';
  render();
  void loadPreviews();
}

function showSavedRecipes() {
  source = 'offline';
  $('#search-source-offline').checked = true;
  $('#search-source-online').checked = false;
  $('#offline-search-description').hidden = false;
  $('#online-search-disclosure').hidden = true;
  live?.reset();
  search = '';
  filter = '';
  $('#search-input').value = '';
  view = 'favorites';
  render();
}

function handlePrimaryNavigation(section, event) {
  if (section === 'favorites') {
    event.preventDefault();
    showSavedRecipes();
    $('#recommended').scrollIntoView();
  } else if (section === 'collections') {
    event.preventDefault();
    view = 'collections';
    render();
    renderCollections();
    $('#collections').scrollIntoView();
  } else if (['home', 'recommended', 'categories', 'cuisines'].includes(section)) {
    resetOffline();
  }
  setSidebar(false);
  if (mobile.matches) $('#menu-btn').focus();
}

function chooseOfflineFilter(nextFilter) {
  source = 'offline';
  $('#search-source-offline').checked = true;
  $('#search-source-online').checked = false;
  $('#offline-search-description').hidden = false;
  $('#online-search-disclosure').hidden = true;
  live?.reset();
  filter = nextFilter;
  search = '';
  view = 'default';
  $('#search-input').value = '';
  void loadPreviews();
}

async function openOwned(id, trigger) {
  const fictional = /^external:fictional-offline:(\d+)$/.exec(id);
  const recipe = owned.get(id) ?? (fictional
    ? { id, source: 'external', detailLevel: 'summary', externalProvider: 'fictional-offline', externalId: fictional[1] }
    : /^[a-z0-9][a-z0-9:_-]{0,199}$/.test(id) && !id.startsWith('external:')
      ? { id, source: 'database', detailLevel: 'preview' } : null);
  if (!recipe || !previewSession) return;
  const generation = ++detailGeneration;
  const request = previewSession.requestRecipeFinderPreviewDetail(recipe, trigger);
  if (authState.status === 'authenticated') modal.status('Loading recipe details', 'Checking your access to this recipe.', trigger);
  const result = await request;
  if (retired || generation !== detailGeneration) return;
  if (result.status === RECIPE_DETAIL_RESULT.PROTECTED_DETAIL) {
    displayedRecipe = result.data;
    modal.detail(result.data, trigger);
  }
  else if (result.status === RECIPE_DETAIL_RESULT.PENDING_AUTH) modal.status('Checking account', 'Please wait while account access is checked.', trigger);
  else if (result.status === RECIPE_DETAIL_RESULT.UNAVAILABLE || result.status === RECIPE_DETAIL_RESULT.DENIED) {
    modal.status('Recipe details unavailable', 'This recipe could not be opened safely.', trigger);
  }
}

async function openMealDb(id, trigger) {
  const recipe = live?.getState().status === 'ready' ? live.getState().recipes.find((item) => item.id === id) : null;
  if (!recipe || !previewSession) return;
  const generation = ++detailGeneration;
  const result = await previewSession.requestPublicMealDbDetail(recipe, trigger);
  if (retired || generation !== detailGeneration) return;
  if (result.status === RECIPE_DETAIL_RESULT.PUBLIC_EXTERNAL_DETAIL) {
    displayedRecipe = result.data;
    modal.detail(result.data, trigger);
  }
  else modal.status('Recipe details unavailable', 'TheMealDB details could not be opened safely.', trigger);
}

async function openCollectionMealDb(id, trigger) {
  if (authState.status !== 'authenticated') return;
  const epoch = collectionsEpoch;
  const userId = authState.userId;
  const generation = ++detailGeneration;
  modal.status('Loading TheMealDB recipe', 'Checking the public recipe source.', trigger);
  try {
    if (!collectionMealDb) collectionMealDb = createMealDbRecipeSource({
      client: createMealDbClient({ fetchImpl: window.fetch.bind(window) }),
    });
    const recipe = await collectionMealDb.getDetails(id);
    if (retired || epoch !== collectionsEpoch || authState.userId !== userId || generation !== detailGeneration) return;
    const result = await previewSession.requestPublicMealDbDetail(recipe, trigger);
    if (retired || epoch !== collectionsEpoch || authState.userId !== userId || generation !== detailGeneration) return;
    if (result.status !== RECIPE_DETAIL_RESULT.PUBLIC_EXTERNAL_DETAIL) throw new TypeError();
    displayedRecipe = result.data;
    modal.detail(result.data, trigger);
  } catch {
    if (!retired && epoch === collectionsEpoch && authState.userId === userId && generation === detailGeneration) {
      modal.status('Recipe unavailable', 'TheMealDB recipe could not be loaded.', trigger);
    }
  }
}

function handleAuthState(next) {
  if (retired) return;
  const changed = authState.status !== next?.status || authState.userId !== next?.userId;
  authState = next;
  if (changed) { collectionsEpoch += 1; closeDetail(false); }
  previewSession?.handleAuthState(next);
  void collectionsController?.handleAuthState(next);
  void accountFavorites?.handleAuthState(next);
  if (adminLink) void adminLink.handleAuthState(next);
  if (!accountFavorites) {
    favoriteState = Object.freeze({
      mode: next?.status === 'guest' ? 'guest' : 'account-loading',
      favoriteIds: Object.freeze(next?.status === 'guest' ? [...guestFavoriteIds] : []),
      pendingRecipeIds: Object.freeze([]), message: '',
    });
    render();
  }
  renderCollections();
}

function onClientReady(client, availability) {
  if (retired || previewSession) return;
  const gate = createRecipeLoginGate({ documentLike: document, present: modal.present, dismiss: modal.close });
  previewSession = createRecipePreviewSession({
    builtInPreviews: BUILT_IN_RECIPE_PREVIEWS, fictionalPreviews: FICTIONAL_RECIPE_PREVIEWS,
    previewSource: createPublishedRecipePreviewService(client),
    detailService: createAuthenticatedRecipeDetailService(client),
    loginGate: gate, clearProtectedDetail: () => modal.close({ restoreFocus: false }),
  });
  previewSession.handleAuthState(authState);
  accountFavorites = createDashboardAccountFavorites({ client, guestFavorites: guestFavoriteIds });
  collectionsController = createRecipeCollectionsController({
    service: createSupabaseRecipeCollectionsService(client), onState: renderCollections,
  });
  void collectionsController.handleAuthState(authState);
  void accountFavorites.handleAuthState(authState);
  unsubscribeFavorites = accountFavorites.subscribe((next) => { favoriteState = next; render(); });
  if (availability.adminPreviewAvailable === true) {
    void import('./dashboard-admin-link.js').then(({ createDashboardAdminLink }) => {
      if (retired) return;
      adminLink = createDashboardAdminLink({ link: $('[data-admin-dashboard-link]'), client });
      void adminLink.handleAuthState(authState);
    }).catch(() => {});
  }
  void loadPreviews();
}

function initialize() {
  installCollectionsPage();
  renderTaxonomy();
  render();
  document.addEventListener('error', handleImageError, true);
  setSidebar(false);
  initializeCategoryCarousel();
  try {
    const theme = localStorage.getItem(THEME_KEY);
    document.body.classList.toggle('dark', theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches));
  } catch { /* Use the light theme when storage is unavailable. */ }
  const auth = createDashboardAuthIntegration({ onClientReady, onAuthStateChange: handleAuthState });
  void auth.activate();

  $('#search-form').addEventListener('submit', handleSearchSubmit);
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form?.dataset?.collectionCreate !== 'true' && !form?.dataset?.collectionRename) return;
    event.preventDefault();
    const name = form.elements.namedItem('name')?.value;
    if (form.dataset.collectionCreate === 'true') void collectionsController?.create(name);
    else void collectionsController?.rename(form.dataset.collectionRename, name);
  });
  $('#search-source-selector').addEventListener('change', (event) => {
    if (event.target.name !== 'recipe-source') return;
    source = event.target.value === 'online' ? 'online' : 'offline';
    $('#offline-search-description').hidden = source !== 'offline';
    $('#online-search-disclosure').hidden = source !== 'online';
    if (source === 'offline') resetOffline();
    else { pageGeneration += 1; live?.reset(); render(); }
  });
  $('#theme-toggle').addEventListener('click', () => {
    const dark = document.body.classList.toggle('dark');
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch { /* Theme stays in memory. */ }
  });
  $('#menu-btn').addEventListener('click', () => {
    const opening = !$('#sidebar').classList.contains('open');
    setSidebar(opening);
    if (opening) $('#sidebar .nav-link')?.focus();
    else $('#menu-btn').focus();
  });
  mobile.addEventListener('change', (event) => {
    const focused = event.matches && $('#sidebar').contains(document.activeElement);
    setSidebar(false);
    if (focused) $('#menu-btn').focus();
  });
  document.addEventListener('keydown', (event) => {
    if (modal.handleTab(event)) return;
    if (event.key === 'Escape') {
      if (modal.isOpen()) closeDetail();
      else if ($('#sidebar').classList.contains('open')) { setSidebar(false); $('#menu-btn').focus(); }
    }
  });
  document.addEventListener('click', (event) => {
    const target = event.target;
    const addButton = target.closest('[data-collection-add]');
    if (addButton) {
      if (authState.status === 'guest') modal.collectionsLoginPrompt();
      else if (authState.status === 'authenticated' && collectionsController?.getState().status === 'ready') {
        modal.collectionPicker(displayedRecipe?.name ?? 'this recipe', collectionsController.getState().collections);
      } else modal.status('Collections unavailable', 'Wait for account verification or try again.');
      return;
    }
    const addTarget = target.closest('[data-collection-target]');
    if (addTarget && displayedRecipe) {
      const epoch = collectionsEpoch;
      const generation = detailGeneration;
      void collectionsController?.add(addTarget.dataset.collectionTarget, displayedRecipe).then((result) => {
        if (retired || epoch !== collectionsEpoch || generation !== detailGeneration) return;
        modal.status(result.ok ? 'Added to Collection' : 'Could not add recipe',
          result.ok ? 'This recipe is now in your collection.' : 'The recipe was not saved. Try again.');
      });
      return;
    }
    const collectionView = target.closest('[data-collection-view]');
    if (collectionView) {
      const id = collectionView.dataset.collectionView;
      if (id.startsWith('external:themealdb:')) void openCollectionMealDb(id, collectionView);
      else void openOwned(id, collectionView);
      return;
    }
    const collectionRemove = target.closest('[data-collection-remove]');
    if (collectionRemove) {
      void collectionsController?.remove(collectionRemove.dataset.collectionId, collectionRemove.dataset.collectionRemove);
      return;
    }
    const collectionDelete = target.closest('[data-collection-delete]');
    if (collectionDelete) {
      if (window.confirm('Delete this collection and remove its saved recipe references?')) {
        void collectionsController?.delete(collectionDelete.dataset.collectionDelete);
      }
      return;
    }
    if (target.closest('[data-collection-retry]')) { void collectionsController?.refresh(); return; }
    const removeUnresolved = target.closest('[data-remove-unresolved]');
    if (removeUnresolved && favoriteState.mode === 'guest') {
      guestFavoriteIds.delete(removeUnresolved.dataset.removeUnresolved);
      saveGuestFavorites();
      accountFavorites?.setGuestFavorites(guestFavoriteIds);
      render();
      return;
    }
    const favorite = target.closest('[data-favorite]');
    if (favorite) {
      const id = favorite.dataset.favorite;
      if (favoriteState.mode === 'guest') {
        if (guestFavoriteIds.has(id)) guestFavoriteIds.delete(id); else guestFavoriteIds.add(id);
        saveGuestFavorites();
        accountFavorites?.setGuestFavorites(guestFavoriteIds);
        render();
      } else if (favoriteState.mode === 'account-ready') {
        const recipe = owned.get(id);
        if (recipe) void accountFavorites.toggleFavorite({ id, source: 'database' });
      }
      return;
    }
    const ownedButton = target.closest('[data-owned-view]');
    if (ownedButton) { void openOwned(ownedButton.dataset.ownedView, ownedButton); return; }
    const mealDbButton = target.closest('[data-mealdb-view]');
    if (mealDbButton) { void openMealDb(mealDbButton.dataset.mealdbView, mealDbButton); return; }
    const filterButton = target.closest('[data-filter]');
    if (filterButton) {
      chooseOfflineFilter(filterButton.dataset.filter);
      setSidebar(false);
      return;
    }
    const viewAll = target.closest('[data-view-all]');
    if (viewAll) {
      const kind = viewAll.dataset.viewAll;
      if (kind === 'categories') toggleCategoriesExpansion();
      else if (kind === 'cuisines') $('#cuisines').scrollIntoView();
      else {
        if (kind === 'favorites') showSavedRecipes();
        else { view = 'all'; render(); }
        $('#recommended').scrollIntoView();
      }
      return;
    }
    const navigation = target.closest('.nav-link');
    if (navigation) {
      handlePrimaryNavigation(navigation.dataset.section, event);
      return;
    }
    if (target.closest('[data-discover-more]')) { if (pageOffset !== null) void loadPreviews(pageOffset); return; }
    if (target.closest('[data-back-to-discover]')) { view = 'default'; render(); return; }
    if (target.closest('[data-clear]')) { resetOffline(); return; }
    if (target.closest('[data-external-retry]')) { if (source === 'online') void live?.retry(); else void loadPreviews(); return; }
    if (target.closest('[data-back-to-offline]')) { resetOffline(); return; }
    if (target.closest('.surprise-btn')) {
      const recipes = [...owned.values()];
      if (recipes.length) void openOwned(recipes[Math.floor(Math.random() * recipes.length)].id, target.closest('.surprise-btn'));
      return;
    }
    if (target.closest('[data-scroll]')) { document.getElementById(target.closest('[data-scroll]').dataset.scroll)?.scrollIntoView(); return; }
    if (target.closest('[data-close]')) { closeDetail(); return; }
    if (mobile.matches && $('#sidebar').classList.contains('open') && !$('#sidebar').contains(target) && !$('#menu-btn').contains(target)) setSidebar(false);
  });
  window.addEventListener('pagehide', () => {
    retired = true;
    pageGeneration += 1;
    closeDetail(false);
    previewSession?.cleanup();
    unsubscribeFavorites?.();
    accountFavorites?.cleanup();
    collectionsController?.cleanup();
    adminLink?.cleanup();
    auth.cleanup();
  });
}

initialize();
