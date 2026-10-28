import { recipeCatalog } from './js/recipe-catalog.js';
import { applyStoredTheme, clearFilters, state, toggleFavorite, toggleTheme } from './js/state.js';
import { initializeImageFallbacks, render, renderCategories, renderCuisines, showToast } from './js/render.js';
import { closeRecipeModal, openRecipe } from './js/modal.js';
import { initializeCategoryCarousel, toggleCategoriesExpansion } from './js/category-carousel.js';
import { createFictionalExternalRecipeController } from './js/fictional-external-recipe-source.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const MOBILE_SIDEBAR_QUERY = '(max-width: 980px)';
const mobileSidebarQuery = matchMedia(MOBILE_SIDEBAR_QUERY);
const externalRecipeController = createFictionalExternalRecipeController();
let dashboardCatalog = recipeCatalog;
let lastExternalOperation = null;

function renderDashboard() {
  render(dashboardCatalog, externalRecipeController.getState());
}

function synchronizeExternalRecipes() {
  const externalState = externalRecipeController.getState();
  dashboardCatalog = externalState.status === 'ready' && externalState.recipes.length
    ? recipeCatalog.withRecipes(externalState.recipes)
    : recipeCatalog;
  renderDashboard();
}

function resetExternalDiscovery({ clearRetry = true } = {}) {
  externalRecipeController.invalidateCollection();
  dashboardCatalog = recipeCatalog;
  if (clearRetry) lastExternalOperation = null;
}

function discoverExternalRecipes(operation, value, { remember = true } = {}) {
  if (remember) lastExternalOperation = Object.freeze({ operation, value });
  const request = externalRecipeController[operation](value);
  synchronizeExternalRecipes();
  request.then(synchronizeExternalRecipes);
}

function discoverMoreRecipes() {
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
  sidebar.classList.toggle('open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
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
  $('#search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    resetExternalDiscovery();
    state.filter = '';
    state.view = 'default';
    state.query = $('#search-input').value.trim();
    renderDashboard();
    if (state.query) discoverExternalRecipes('search', state.query);
    $('#recommended').scrollIntoView({ behavior: 'smooth' });
    showToast(state.query ? `Showing results for “${state.query}”` : 'Showing all recipes');
  });

  $('#search-input').addEventListener('input', (event) => {
    if (!event.target.value) {
      resetExternalDiscovery();
      state.query = '';
      renderDashboard();
    }
  });
}

function initializePageActions() {
  document.addEventListener('click', (event) => {
    const favoriteButton = event.target.closest('[data-favorite]');
    if (favoriteButton) {
      toggleFavorite(favoriteButton.dataset.favorite);
      renderDashboard();
      showToast('Favorites updated');
      return;
    }

    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      openRecipe(viewButton.dataset.view);
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
      if (lastExternalOperation) {
        discoverExternalRecipes(lastExternalOperation.operation, lastExternalOperation.value, { remember: false });
      }
      return;
    }

    if (event.target.closest('[data-discover-more]')) {
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
      const recipes = recipeCatalog.list();
      const randomRecipe = recipes[Math.floor(Math.random() * recipes.length)];
      openRecipe(randomRecipe.id);
    }

    if (event.target.closest('[data-close]')) closeRecipeModal();
  });
}

function initializeNavigation() {
  setActiveNavigation('home');
  $('#menu-btn').addEventListener('click', () => {
    setSidebarOpen(!$('#sidebar').classList.contains('open'));
  });

  $$('.nav-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      setActiveNavigation(link.dataset.section);
      closeMobileSidebar({ restoreFocus: true });
      if (link.dataset.section === 'home' || link.dataset.section === 'recommended') {
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
    if (event.key === 'Escape') {
      closeRecipeModal();
      closeMobileSidebar({ restoreFocus: true });
    }
  });

  mobileSidebarQuery.addEventListener('change', (event) => {
    if (!event.matches) setSidebarOpen(false);
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
