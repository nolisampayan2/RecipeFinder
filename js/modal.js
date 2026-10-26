import { recipes } from './data.js';

const $ = (selector) => document.querySelector(selector);

export function openRecipe(id) {
  const recipe = recipes.find((item) => item.id === id);
  if (!recipe) return;
  const fallback = recipe.fallbackImage ? ` data-fallback-image="${recipe.fallbackImage}"` : '';
  $('#modal-content').innerHTML = `<img class="modal-hero" src="${recipe.image}"${fallback} alt="${recipe.name}"><div class="modal-copy"><div class="tags"><span class="tag">${recipe.category}</span><span class="tag alt">${recipe.cuisine}</span></div><h2 id="modal-title">${recipe.name}</h2><p>${recipe.description}</p><div class="detail-columns"><section><h3>Ingredients</h3><ul class="ingredients">${recipe.ingredients.map(([ingredient, measurement]) => `<li><span>${ingredient}</span><strong>${measurement}</strong></li>`).join('')}</ul></section><section><h3>Cooking instructions</h3><div class="instructions">${recipe.instructions}</div>${recipe.tutorial ? `<a class="tutorial-link" href="${recipe.tutorial}" target="_blank" rel="noreferrer">Watch tutorial ↗</a>` : ''}</section></div></div>`;
  $('#recipe-modal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('.modal-close').focus();
}

export function closeRecipeModal() {
  $('#recipe-modal').hidden = true;
  document.body.style.overflow = '';
}
