import { recipeCatalog } from './js/recipe-catalog.js';
import { applyStoredTheme, clearFilters, state, toggleFavorite, toggleTheme } from './js/state.js';
import {
  getFavoriteActionId,
  initializeImageFallbacks,
  render,
  renderCategories,
  renderCuisines,
  showToast,
} from './js/render.js';
import {
  closeRecipeModal,
  handleRecipeModalTab,
  isRecipeModalOpen,
  openRecipeDetails,
  openRecipeError,
  openRecipeLoading,
} from './js/modal.js';
import { initializeCategoryCarousel, toggleCategoriesExpansion } from './js/category-carousel.js';
import { createFictionalExternalRecipeController } from './js/fictional-external-recipe-source.js';
import { createExternalSourceRegistry } from './js/external-source-registry.js';
import { createLiveMealDbDashboard } from './js/live-mealdb-dashboard.js';
import { createDashboardAuthIntegration, shouldInitializeAdminDashboardLink } from './js/dashboard-auth.js';
import { createDashboardAccountFavorites } from './js/dashboard-account-favorites.js';
import { createDashboardRecipeCatalogLoader } from './js/dashboard-recipe-catalog-loader.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const MOBILE_SIDEBAR_QUERY = '(max-width: 980px)';
const mobileSidebarQuery = matchMedia(MOBILE_SIDEBAR_QUERY);
const externalRecipeController = createFictionalExternalRecipeController();
const externalSourceRegistry = createExternalSourceRegistry({
  controllers: { 'fictional-offline': externalRecipeController },
});
let primaryCatalog = recipeCatalog;
let dashboardCatalog = primaryCatalog;
let lastExternalOperation = null;
let externalDetailGeneration = 0;
let liveDashboard = null;
let recipeMode = 'offline';
let searchSource = 'offline';
let dashboardAuth = null;
let dashboardAdminLink = null;
let recipeCatalogLoader = null;
let dashboardAccountFavorites = null;
let unsubscribeAccountFavorites = null;
let latestAuthState = Object.freeze({ status: 'loading', userId: null });
let favoritesPresentation = Object.freeze({
  mode: 'account-loading',
  favoriteIds: Object.freeze([]),
  pendingRecipeIds: Object.freeze([]),
  message: 'Loading account favorites.',
});
let pageRetired = false;

function setSearchSource(source) {
  searchSource = source === 'online' ? 'online' : 'offline';
  const offlineInput = $('#search-source-offline');
  const onlineInput = $('#search-source-online');
  const offlineDescription = $('#offline-search-description');
  const onlineDisclosure = $('#online-search-disclosure');
  offlineInput.checked = searchSource === 'offline';
  onlineInput.checked = searchSource === 'online';
  offlineDescription.hidden = searchSource !== 'offline';
  onlineDisclosure.hidden = searchSource !== 'online';
  return searchSource;
}

function invalidateExternalDetails({ closeModal = false, restoreFocus = false } = {}) {
  externalDetailGeneration += 1;
  externalSourceRegistry.invalidateDetails();
  if (closeModal) closeRecipeModal({ restoreFocus });
}

function closeActiveRecipeModal() {
  invalidateExternalDetails();
  closeRecipeModal();
}

function openDemoRecipe(id, trigger) {
  invalidateExternalDetails();
  const recipe = dashboardCatalog.getById(id);
  return recipe ? openRecipeDetails(recipe, { trigger }) : false;
}

async function openExternalRecipe(id, trigger) {
  invalidateExternalDetails();
  const isMealDbIdentity = typeof id === 'string' && id.startsWith('external:themealdb:');
  if (recipeMode === 'live' || isMealDbIdentity) {
    if (recipeMode !== 'live' || !/^external:themealdb:\d+$/.test(id)) return false;
    let recipe = null;
    try {
      if (typeof liveDashboard === 'undefined') {
        // Supports isolated offline harnesses; the production module always owns liveDashboard.
        recipe = dashboardCatalog.getById(id);
      } else {
        const liveState = liveDashboard?.getState();
        if (liveState?.status !== 'ready' || !Array.isArray(liveState.recipes)) return false;
        for (let index = 0; index < liveState.recipes.length; index += 1) {
          const candidate = liveState.recipes[index];
          if (candidate?.id === id) {
            recipe = candidate;
            break;
          }
        }
      }
    } catch {
      return false;
    }
    if (
      recipe?.id !== id
      || recipe.source !== 'external'
      || recipe.externalProvider !== 'themealdb'
      || recipe.detailLevel !== 'full'
    ) return false;
    return openRecipeDetails(recipe, { trigger });
  }
  if (!/^external:fictional-offline:\d+$/.test(id)) return false;
  const generation = externalDetailGeneration;
  openRecipeLoading(trigger);
  try {
    const recipe = await externalSourceRegistry.getDetails(id);
    if (generation !== externalDetailGeneration || !isRecipeModalOpen()) return;
    if (recipe?.id === id && recipe.detailLevel === 'full') {
      openRecipeDetails(recipe);
      return;
    }
    openRecipeError();
  } catch (error) {
    if (generation !== externalDetailGeneration || !isRecipeModalOpen()) return;
    if (error?.code !== 'CANCELLED' && error?.code !== 'ABORTED') openRecipeError();
  }
}

function renderDashboard() {
  const externalState = recipeMode === 'live' && liveDashboard
    ? liveDashboard.getState()
    : externalRecipeController.getState();
  render(dashboardCatalog, externalState, favoritesPresentation);
}

function catalogWithExternalRecipes(baseCatalog, externalState) {
  if (externalState?.status !== 'ready' || !externalState.recipes?.length) return baseCatalog;
  try {
    return baseCatalog.withRecipes(externalState.recipes);
  } catch {
    return baseCatalog;
  }
}

function applyPrimaryCatalogResult(result) {
  try {
    if (pageRetired || result?.stale || !result?.catalog) return false;
    dashboardAccountFavorites?.handleCatalogResult(result);
    primaryCatalog = result.catalog;
    const externalState = recipeMode === 'live' && liveDashboard
      ? liveDashboard.getState()
      : externalRecipeController.getState();
    dashboardCatalog = catalogWithExternalRecipes(primaryCatalog, externalState);
    render(dashboardCatalog, externalState, favoritesPresentation);
    return true;
  } catch {
    return false;
  }
}

function acceptDashboardClient(client, availability) {
  if (!pageRetired && shouldInitializeAdminDashboardLink(availability, globalThis.location?.hostname)) {
    void import('./js/dashboard-admin-link.js').then(({ createDashboardAdminLink }) => {
      if (pageRetired) return;
      const link = $('[data-admin-dashboard-link]');
      if (!link) return;
      dashboardAdminLink = createDashboardAdminLink({ link, client });
      void dashboardAdminLink.handleAuthState(latestAuthState);
    }).catch(() => { /* Preview navigation remains hidden when unavailable. */ });
  }
  if (pageRetired || recipeCatalogLoader) return false;
  try {
    dashboardAccountFavorites = createDashboardAccountFavorites({
      client,
      guestFavorites: state.favorites,
    });
    void dashboardAccountFavorites.handleAuthState(latestAuthState);
    unsubscribeAccountFavorites = dashboardAccountFavorites.subscribe((nextPresentation) => {
      if (pageRetired) return;
      favoritesPresentation = nextPresentation;
      renderDashboard();
    });
    recipeCatalogLoader = createDashboardRecipeCatalogLoader({ client });
    void recipeCatalogLoader.load().then(applyPrimaryCatalogResult, () => false);
    return true;
  } catch {
    try { unsubscribeAccountFavorites?.(); } catch { /* Partial setup stays contained. */ }
    unsubscribeAccountFavorites = null;
    try { dashboardAccountFavorites?.cleanup(); } catch { /* Partial setup stays contained. */ }
    dashboardAccountFavorites = null;
    recipeCatalogLoader = null;
    return false;
  }
}

function acceptDashboardAuthState(authState) {
  if (pageRetired) return false;
  latestAuthState = authState;
  if (dashboardAdminLink) void dashboardAdminLink.handleAuthState(authState);
  if (!dashboardAccountFavorites) {
    if (authState?.status === 'guest') {
      favoritesPresentation = Object.freeze({
        mode: 'guest',
        favoriteIds: Object.freeze([...state.favorites]),
        pendingRecipeIds: Object.freeze([]),
        message: '',
      });
    } else if (authState?.status !== 'loading') {
      favoritesPresentation = Object.freeze({
        mode: 'account-error',
        favoriteIds: Object.freeze([]),
        pendingRecipeIds: Object.freeze([]),
        message: 'Account favorites are unavailable.',
      });
    }
    renderDashboard();
    return true;
  }
  void dashboardAccountFavorites.handleAuthState(authState);
  return true;
}

function synchronizeLiveRecipes(liveState) {
  if (recipeMode !== 'live') return;
  dashboardCatalog = catalogWithExternalRecipes(primaryCatalog, liveState);
  render(dashboardCatalog, liveState, favoritesPresentation);
}

function getLiveDashboard() {
  if (!liveDashboard) {
    liveDashboard = createLiveMealDbDashboard({
      fetchImpl: window.fetch.bind(window),
      onState: synchronizeLiveRecipes,
    });
  }
  return liveDashboard;
}

function exitLiveMode() {
  if (recipeMode !== 'live') return false;
  recipeMode = 'offline';
  liveDashboard?.reset();
  dashboardCatalog = primaryCatalog;
  return true;
}

function synchronizeExternalRecipes() {
  if (recipeMode !== 'offline') return;
  const externalState = externalRecipeController.getState();
  dashboardCatalog = catalogWithExternalRecipes(primaryCatalog, externalState);
  renderDashboard();
}

function resetExternalDiscovery({ clearRetry = true, resetSource = true } = {}) {
  exitLiveMode();
  invalidateExternalDetails({ closeModal: true, restoreFocus: false });
  externalRecipeController.invalidateCollection();
  dashboardCatalog = primaryCatalog;
  if (clearRetry) lastExternalOperation = null;
  if (resetSource) setSearchSource('offline');
}

function discoverExternalRecipes(operation, value, { remember = true } = {}) {
  if (remember) lastExternalOperation = Object.freeze({ operation, value });
  const request = externalRecipeController[operation](value);
  synchronizeExternalRecipes();
  request.then(synchronizeExternalRecipes);
}

function discoverMoreRecipes() {
  if (recipeMode === 'live') {
    restoreDiscoveryCollection();
    return false;
  }
  const externalStatus = externalRecipeController.getState().status;
  if (state.view !== 'all' || externalStatus !== 'idle') return false;
  discoverExternalRecipes('discoverAll');
  return true;
}

function setActiveNavigation(section) {
  const links = $$('.nav-link');
  const activeLink = links.find((link) => link.dataset.section === section);
  links.forEach((link) => {
    const active = link === activeLink;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  return Boolean(activeLink);
}

function setSidebarOpen(open) {
  const sidebar = $('#sidebar');
  const menuButton = $('#menu-btn');
  const mobile = mobileSidebarQuery.matches;
  const expanded = mobile && Boolean(open);
  sidebar.classList.toggle('open', expanded);
  sidebar.inert = mobile && !expanded;
  if (sidebar.inert) sidebar.setAttribute('aria-hidden', 'true');
  else sidebar.removeAttribute('aria-hidden');
  menuButton.setAttribute('aria-expanded', String(expanded));
  menuButton.setAttribute('aria-label', expanded ? 'Close menu' : 'Open menu');
  return expanded;
}

function closeMobileSidebar({ restoreFocus = false, focusTarget = null } = {}) {
  const wasOpen = $('#sidebar').classList.contains('open');
  setSidebarOpen(false);
  if (!mobileSidebarQuery.matches || !wasOpen) return;
  if (focusTarget) focusTarget.focus({ preventScroll: true });
  else if (restoreFocus) $('#menu-btn').focus();
}

function restoreDiscoveryCollection() {
  resetExternalDiscovery();
  clearFilters();
  $('#search-input').value = '';
  renderDashboard();
}

function applyFilter(value) {
  const operation = $$('#cuisine-list [data-filter]')
    .some((button) => button.dataset.filter === value)
    ? 'filterCuisine'
    : 'filterCategory';
  resetExternalDiscovery();
  state.filter = state.filter === value ? '' : value;
  state.query = '';
  state.view = 'default';
  $('#search-input').value = '';
  renderDashboard();
  if (state.filter) discoverExternalRecipes(operation, state.filter);
  $('#recommended').scrollIntoView({ behavior: 'smooth' });
  showToast(state.filter ? `Showing ${state.filter} recipes` : 'Showing all recipes');
}

function showRecipeCollection(view) {
  resetExternalDiscovery();
  clearFilters();
  state.view = view;
  setActiveNavigation(view === 'favorites' ? 'favorites' : 'recommended');
  $('#search-input').value = '';
  renderDashboard();
  $('#recommended').scrollIntoView({ behavior: 'smooth' });
  showToast(view === 'favorites' ? 'Showing all saved recipes' : 'Showing all recipes');
}

function restoreDiscoverView(destination = 'recommended', announce = true) {
  restoreDiscoveryCollection();
  setActiveNavigation('recommended');
  const target = document.getElementById(destination);
  target?.scrollIntoView({ behavior: 'smooth' });
  target?.focus({ preventScroll: true });
  if (announce) showToast('Back to recipe discovery');
}

function showAllCuisines() {
  restoreDiscoveryCollection();
  setActiveNavigation('cuisines');
  $('#cuisines').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#cuisine-list').focus({ preventScroll: true });
  showToast('All cuisines are shown');
}

function initializeTheme() {
  updateThemeToggle(applyStoredTheme());
  $('#theme-toggle').addEventListener('click', () => {
    updateThemeToggle(toggleTheme());
  });
}

function updateThemeToggle(dark) {
  const themeToggle = $('#theme-toggle');
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
  themeToggle.title = `Switch to ${dark ? 'light' : 'dark'} mode`;
}

function initializeSearch() {
  setSearchSource('offline');

  $('#search-source-selector').addEventListener('change', (event) => {
    if (event.target.name !== 'recipe-source') return;
    const nextSource = event.target.value === 'online' ? 'online' : 'offline';
    if (nextSource === 'offline' && recipeMode === 'live') {
      restoreDiscoveryCollection();
      return;
    }
    setSearchSource(nextSource);
  });

  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = $('#search-input').value.trim();

    if (searchSource === 'online') {
      if (!query) {
        $('#search-input').focus();
        showToast('Enter a recipe name');
        return;
      }

      resetExternalDiscovery({ resetSource: false });
      setSearchSource('online');
      clearFilters();
      state.view = 'default';
      recipeMode = 'live';
      setActiveNavigation('recommended');
      getLiveDashboard().search(query);
      $('#recommended').scrollIntoView({ behavior: 'smooth' });
      return;
    }

    resetExternalDiscovery();
    state.filter = '';
    state.view = 'default';
    state.query = query;
    renderDashboard();
    if (state.query) discoverExternalRecipes('search', state.query);
    $('#recommended').scrollIntoView({ behavior: 'smooth' });
    showToast(state.query ? `Showing results for “${state.query}”` : 'Showing all recipes');
  });

  $('#search-input').addEventListener('input', (event) => {
    if (!event.target.value && searchSource === 'offline') {
      resetExternalDiscovery();
      state.query = '';
      renderDashboard();
    }
  });
}

function initializePageActions() {
  document.addEventListener('click', (event) => {
    const favoriteButton = event.target.closest('[data-favorite], .unavailable-favorite-remove');
    if (favoriteButton) {
      const recipeId = getFavoriteActionId(favoriteButton);
      if (typeof recipeId !== 'string') return;
      if (favoritesPresentation.mode === 'guest') {
        toggleFavorite(recipeId);
        dashboardAccountFavorites?.setGuestFavorites(state.favorites);
        renderDashboard();
        showToast('Favorites updated');
      } else if (favoritesPresentation.mode === 'account-ready') {
        const recipe = dashboardCatalog.getById(recipeId);
        if (!recipe || recipe.source !== 'database') return;
        void dashboardAccountFavorites?.toggleFavorite(recipe).then((result) => {
          if (pageRetired) return;
          if (result?.ok === true) showToast('Favorites updated');
          else if (result?.code === 'FAILED') showToast('Account favorites could not be updated');
        });
      }
      return;
    }

    const externalViewButton = event.target.closest('[data-external-view]');
    if (externalViewButton) {
      openExternalRecipe(externalViewButton.dataset.externalView, externalViewButton);
      return;
    }

    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      openDemoRecipe(viewButton.dataset.view, viewButton);
      return;
    }

    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) {
      applyFilter(filterButton.dataset.filter);
      closeMobileSidebar({ focusTarget: $('#recommended') });
      return;
    }

    const viewAllButton = event.target.closest('[data-view-all]');
    if (viewAllButton) {
      const target = viewAllButton.dataset.viewAll;
      if (target === 'categories') {
        restoreDiscoveryCollection();
        setActiveNavigation('categories');
        toggleCategoriesExpansion();
      }
      else if (target === 'cuisines') showAllCuisines();
      else showRecipeCollection(target === 'favorites' ? 'favorites' : 'all');
      return;
    }

    if (event.target.closest('[data-back-to-discover]')) {
      restoreDiscoverView();
      return;
    }

    if (event.target.closest('[data-clear]')) {
      resetExternalDiscovery();
      clearFilters();
      $('#search-input').value = '';
      renderDashboard();
      return;
    }

    if (event.target.closest('[data-external-retry]')) {
      if (recipeMode === 'live') {
        liveDashboard?.retry();
      } else if (lastExternalOperation) {
        discoverExternalRecipes(lastExternalOperation.operation, lastExternalOperation.value, { remember: false });
      }
      return;
    }

    if (event.target.closest('[data-back-to-offline]')) {
      restoreDiscoverView();
      return;
    }

    if (event.target.closest('[data-discover-more]')) {
      setSearchSource('offline');
      discoverMoreRecipes();
      return;
    }

    const scrollButton = event.target.closest('[data-scroll]');
    if (scrollButton) {
      if (scrollButton.closest('.sidebar-promo')) {
        restoreDiscoverView('recommended', false);
        closeMobileSidebar({ focusTarget: $('#recommended') });
      } else {
        document.getElementById(scrollButton.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    if (event.target.closest('.surprise-btn')) {
      const recipes = primaryCatalog.list();
      if (!recipes.length) {
        showToast('No recipes are currently available');
        return;
      }
      const randomRecipe = recipes[Math.floor(Math.random() * recipes.length)];
      openDemoRecipe(randomRecipe.id, event.target.closest('.surprise-btn'));
    }

    if (event.target.closest('[data-close]')) closeActiveRecipeModal();
  });
}

function initializeNavigation() {
  setActiveNavigation('home');
  setSidebarOpen(false);
  $('#menu-btn').addEventListener('click', () => {
    const opening = !$('#sidebar').classList.contains('open');
    setSidebarOpen(opening);
    if (opening) $('#sidebar').querySelector('.nav-link')?.focus();
    else $('#menu-btn').focus();
  });

  $('#sidebar').addEventListener('focusout', (event) => {
    if (mobileSidebarQuery.matches && $('#sidebar').classList.contains('open')
      && !$('#sidebar').contains(event.relatedTarget)
      && !$('#menu-btn').contains(event.relatedTarget)) setSidebarOpen(false);
  });

  document.addEventListener('click', (event) => {
    if (!mobileSidebarQuery.matches || !$('#sidebar').classList.contains('open')) return;
    if ($('#sidebar').contains(event.target) || $('#menu-btn').contains(event.target)) return;
    setSidebarOpen(false);
  });

  $$('.nav-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      setActiveNavigation(link.dataset.section);
      closeMobileSidebar({ restoreFocus: true });
      if (link.dataset.section === 'home') {
        event.preventDefault();
        restoreDiscoveryCollection();
        $('.page')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (window.location.hash !== '#home') {
          window.history.replaceState(null, '', '#home');
        }
      } else if (link.dataset.section === 'recommended') {
        restoreDiscoveryCollection();
      } else if (link.dataset.section === 'categories' || link.dataset.section === 'cuisines') {
        restoreDiscoveryCollection();
      } else if (link.dataset.section === 'favorites') {
        event.preventDefault();
        showRecipeCollection('favorites');
      }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (handleRecipeModalTab(event)) return;
    if (event.key === 'Escape') {
      if (isRecipeModalOpen()) {
        event.preventDefault();
        closeActiveRecipeModal();
        return;
      }
      closeMobileSidebar({ restoreFocus: true });
    }
  });

  mobileSidebarQuery.addEventListener('change', (event) => {
    const focusWasInSidebar = event.matches && $('#sidebar').contains(document.activeElement);
    setSidebarOpen(false);
    if (focusWasInSidebar) $('#menu-btn').focus();
  });
}

function initializeApp() {
  initializeImageFallbacks();
  renderCategories();
  initializeCategoryCarousel();
  renderCuisines();
  renderDashboard();
  initializeTheme();
  initializeSearch();
  initializePageActions();
  initializeNavigation();
}

initializeApp();

try {
  dashboardAuth = createDashboardAuthIntegration({
    onClientReady: acceptDashboardClient,
    onAuthStateChange: acceptDashboardAuthState,
  });
  void dashboardAuth.activate();
} catch {
  // Account and database availability must not interrupt guest discovery.
}

window.addEventListener('pagehide', () => {
  if (pageRetired) return;
  pageRetired = true;
  try { unsubscribeAccountFavorites?.(); } catch { /* Page retirement stays isolated. */ }
  unsubscribeAccountFavorites = null;
  dashboardAccountFavorites?.cleanup();
  recipeCatalogLoader?.cleanup();
  dashboardAdminLink?.cleanup();
  dashboardAuth?.cleanup();
}, { once: true });
