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

// This entry is used only by the explicit candidate build. It is never the
// current Production or Admin Preview entry point.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const CATEGORY_NAMES = Object.freeze(['Chicken', 'Beef', 'Seafood', 'Pasta', 'Vegetarian', 'Dessert', 'Breakfast', 'Soup']);
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
  modal.close({ restoreFocus });
  previewSession?.dismissDetail();
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
  const imageUrl = safeImageUrl(recipe.image);
  if (imageUrl) image.src = imageUrl;
  const fallback = safeImageUrl(recipe.fallbackImage);
  if (fallback) image.dataset.fallbackImage = fallback;
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
    const item = node('div', 'favorite-item');
    item.append(node('strong', '', recipe?.name ?? 'Saved recipe unavailable'));
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
  $('#category-row').replaceChildren(...CATEGORY_NAMES.map((name) => {
    const button = node('button', 'category', name);
    button.type = 'button';
    button.dataset.filter = name;
    return button;
  }));
  $('#cuisine-list').replaceChildren(...CUISINE_NAMES.map((name) => {
    const button = node('button', 'cuisine', name);
    button.type = 'button';
    button.dataset.filter = name;
    return button;
  }));
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
  const recipe = owned.get(id);
  if (!recipe || !previewSession) return;
  const generation = ++detailGeneration;
  const request = previewSession.requestRecipeFinderPreviewDetail(recipe, trigger);
  if (authState.status === 'authenticated') modal.status('Loading recipe details', 'Checking your access to this recipe.', trigger);
  const result = await request;
  if (retired || generation !== detailGeneration) return;
  if (result.status === RECIPE_DETAIL_RESULT.PROTECTED_DETAIL) modal.detail(result.data, trigger);
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
  if (result.status === RECIPE_DETAIL_RESULT.PUBLIC_EXTERNAL_DETAIL) modal.detail(result.data, trigger);
  else modal.status('Recipe details unavailable', 'TheMealDB details could not be opened safely.', trigger);
}

function handleAuthState(next) {
  if (retired) return;
  const changed = authState.status !== next?.status || authState.userId !== next?.userId;
  authState = next;
  if (changed) closeDetail(false);
  previewSession?.handleAuthState(next);
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
  renderTaxonomy();
  render();
  setSidebar(false);
  initializeCategoryCarousel();
  try {
    const theme = localStorage.getItem(THEME_KEY);
    document.body.classList.toggle('dark', theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches));
  } catch { /* Use the light theme when storage is unavailable. */ }
  const auth = createDashboardAuthIntegration({ onClientReady, onAuthStateChange: handleAuthState });
  void auth.activate();

  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = $('#search-input').value.trim();
    if (source === 'online') {
      if (!query) return;
      search = query;
      filter = '';
      view = 'default';
      if (!live) live = createLiveMealDbDashboard({ fetchImpl: window.fetch.bind(window), onState: render });
      void live.search(query);
    } else {
      search = query;
      filter = '';
      view = 'default';
      void loadPreviews();
    }
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
    adminLink?.cleanup();
    auth.cleanup();
  });
}

initialize();
