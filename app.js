import { recipeCatalog } from './js/recipe-catalog.js';
import { applyStoredTheme, clearFilters, state, toggleFavorite, toggleTheme } from './js/state.js';
import { initializeImageFallbacks, render, renderCategories, renderCuisines, showToast } from './js/render.js';
import { closeRecipeModal, openRecipe } from './js/modal.js';
import { initializeCategoryCarousel, toggleCategoriesExpansion } from './js/category-carousel.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const MOBILE_SIDEBAR_QUERY = '(max-width: 980px)';
const mobileSidebarQuery = matchMedia(MOBILE_SIDEBAR_QUERY);

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

function applyFilter(value) {
  state.filter = state.filter === value ? '' : value;
  state.query = '';
  state.view = 'default';
  $('#search-input').value = '';
  render();
  $('#recommended').scrollIntoView({ behavior: 'smooth' });
  showToast(state.filter ? `Showing ${state.filter} recipes` : 'Showing all recipes');
}

function showRecipeCollection(view) {
  clearFilters();
  state.view = view;
  $('#search-input').value = '';
  render();
  $('#recommended').scrollIntoView({ behavior: 'smooth' });
  showToast(view === 'favorites' ? 'Showing all saved recipes' : 'Showing all recipes');
}

function restoreDiscoverView(destination = 'recommended', announce = true) {
  clearFilters();
  $('#search-input').value = '';
  render();
  const target = document.getElementById(destination);
  target?.scrollIntoView({ behavior: 'smooth' });
  target?.focus({ preventScroll: true });
  if (announce) showToast('Back to recipe discovery');
}

function showAllCuisines() {
  clearFilters();
  $('#search-input').value = '';
  render();
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
    state.filter = '';
    state.view = 'default';
    state.query = $('#search-input').value.trim();
    render();
    $('#recommended').scrollIntoView({ behavior: 'smooth' });
    showToast(state.query ? `Showing results for “${state.query}”` : 'Showing all recipes');
  });

  $('#search-input').addEventListener('input', (event) => {
    if (!event.target.value) {
      state.query = '';
      render();
    }
  });
}

function initializePageActions() {
  document.addEventListener('click', (event) => {
    const favoriteButton = event.target.closest('[data-favorite]');
    if (favoriteButton) {
      toggleFavorite(favoriteButton.dataset.favorite);
      render();
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
      if (target === 'categories') toggleCategoriesExpansion();
      else if (target === 'cuisines') showAllCuisines();
      else showRecipeCollection(target === 'favorites' ? 'favorites' : 'all');
      return;
    }

    if (event.target.closest('[data-back-to-discover]')) {
      restoreDiscoverView();
      return;
    }

    if (event.target.closest('[data-clear]')) {
      clearFilters();
      $('#search-input').value = '';
      render();
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
  $('#menu-btn').addEventListener('click', () => {
    setSidebarOpen(!$('#sidebar').classList.contains('open'));
  });

  $$('.nav-link').forEach((link) => {
    link.addEventListener('click', (event) => {
      $$('.nav-link').forEach((item) => item.classList.remove('active'));
      link.classList.add('active');
      closeMobileSidebar({ restoreFocus: true });
      if (link.dataset.section === 'home' || link.dataset.section === 'recommended') {
        clearFilters();
        $('#search-input').value = '';
        render();
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
  render();
  initializeTheme();
  initializeSearch();
  initializePageActions();
  initializeNavigation();
}

initializeApp();
