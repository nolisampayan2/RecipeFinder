import { categories, cuisines, recipes } from './data.js';
import { filterRecipes } from './filters.js';
import { state } from './state.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function recipeCard(recipe) {
  const saved = state.favorites.has(recipe.id);
  const fallback = recipe.fallbackImage ? ` data-fallback-image="${recipe.fallbackImage}"` : '';
  return `<article class="recipe-card" data-id="${recipe.id}"><img class="card-image" src="${recipe.image}"${fallback} alt="${recipe.name}" loading="lazy"><button class="heart ${saved ? 'saved' : ''}" data-favorite="${recipe.id}" aria-label="${saved ? 'Remove from' : 'Save to'} favorites">${saved ? '♥' : '♡'}</button><div class="card-body"><div class="tags"><span class="tag">${recipe.category}</span><span class="tag alt">${recipe.cuisine}</span></div><h3>${recipe.name}</h3><p>${recipe.description}</p><button class="view-btn" data-view="${recipe.id}">View recipe →</button></div></article>`;
}

function renderFavorites() {
  const favorites = recipes.filter((recipe) => state.favorites.has(recipe.id));
  $('#fav-count').textContent = favorites.length;
  $('#favorite-list').innerHTML = favorites.length
    ? favorites.slice(0, 4).map((recipe) => `<div class="favorite-item"><img src="${recipe.image}" alt=""><div><strong>${recipe.name}</strong><small>${recipe.category}</small></div><button class="mini-remove" data-favorite="${recipe.id}" aria-label="Remove ${recipe.name}">×</button></div>`).join('')
    : '<p class="empty-mini">No saved recipes yet. Tap a heart to keep one here.</p>';
}

export function render() {
  const filteredRecipes = filterRecipes(recipes, state.query, state.filter);
  const visibleRecipes = state.view === 'favorites'
    ? recipes.filter((recipe) => state.favorites.has(recipe.id))
    : filteredRecipes;
  const showingFullView = state.view === 'all' || state.view === 'favorites';

  $('#recommended-title').textContent = state.view === 'favorites'
    ? '💗 My saved recipes'
    : state.view === 'all'
      ? '🍴 All recipes'
      : '🍴 Recommended for you';
  $('#back-to-discover').hidden = !showingFullView;
  $('#recommended-view-all').hidden = showingFullView;
  $('#recommended-grid').innerHTML = (showingFullView ? visibleRecipes : visibleRecipes.slice(0, 4)).map(recipeCard).join('');
  $('#more-grid').innerHTML = showingFullView ? '' : visibleRecipes.slice(4).map(recipeCard).join('');
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
  $('#category-row').innerHTML = categories.map(([name, emoji]) => {
    const recipe = recipes.find((item) => item.category === name);
    const fallback = recipe?.fallbackImage ? ` data-fallback-image="${recipe.fallbackImage}"` : '';
    return `<button class="category" data-filter="${name}"><img src="${recipe?.image || recipes[0].image}"${fallback} alt="" loading="lazy"><span>${emoji} ${name}</span></button>`;
  }).join('');
}

export function renderCuisines() {
  $('#cuisine-list').innerHTML = cuisines.map(([name, flag]) => `<button class="cuisine" data-filter="${name}"><span>${flag}</span><strong>${name}</strong><i>Explore →</i></button>`).join('');
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
    if (!(image instanceof HTMLImageElement) || !image.dataset.fallbackImage) return;
    if (image.getAttribute('src') === image.dataset.fallbackImage) return;
    image.src = image.dataset.fallbackImage;
  }, true);
}
