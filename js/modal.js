import { recipeCatalog } from './recipe-catalog.js';
import { safeExternalUrl, safeImageUrl, setSafeText } from './security.js';

const $ = (selector) => document.querySelector(selector);
let modalTrigger = null;

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) setSafeText(element, text);
  return element;
}

function statusAnnouncement(message) {
  const status = createElement('span', 'sr-only', message);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  return status;
}

function showModal(content, trigger) {
  const modal = $('#recipe-modal');
  const wasOpen = !modal.hidden;
  if (trigger) modalTrigger = trigger;
  $('#modal-content').replaceChildren(...content);
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  if (!wasOpen) $('.modal-close').focus();
}

function statusContent(title, message) {
  const copy = createElement('div', 'modal-copy');
  const heading = createElement('h2', '', title);
  heading.id = 'modal-title';
  copy.append(heading, createElement('p', '', message), statusAnnouncement(title));
  return [copy];
}

export function openRecipeLoading(trigger) {
  showModal(statusContent('Loading recipe details', 'Preparing this offline recipe preview...'), trigger);
}

export function openRecipeError() {
  showModal(statusContent('Recipe details unavailable', 'This offline recipe preview could not be opened. Please try again.'));
}

export function openRecipeDetails(recipe, { trigger } = {}) {
  if (!recipe || typeof recipe !== 'object' || !recipe.id || !recipe.name) return false;
  const image = createElement('img', 'modal-hero');
  image.alt = recipe.name;
  const imageUrl = safeImageUrl(recipe.image);
  const fallbackUrl = safeImageUrl(recipe.fallbackImage);
  if (imageUrl) image.src = imageUrl;
  if (fallbackUrl) image.dataset.fallbackImage = fallbackUrl;

  const copy = createElement('div', 'modal-copy');
  if (recipe.source === 'external') {
    copy.append(statusAnnouncement('Recipe details loaded'));
    copy.append(createElement('span', 'recipe-source', 'Offline recipe preview'));
  }
  const tags = createElement('div', 'tags');
  tags.append(createElement('span', 'tag', recipe.category), createElement('span', 'tag alt', recipe.cuisine));
  const title = createElement('h2', '', recipe.name);
  title.id = 'modal-title';
  copy.append(tags, title, createElement('p', '', recipe.description || 'No description is available for this recipe.'));

  const details = createElement('div', 'detail-columns');
  const ingredientSection = document.createElement('section');
  const ingredientList = createElement('ul', 'ingredients');
  const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  ingredients.forEach(([ingredient, measurement]) => {
    const item = document.createElement('li');
    item.append(createElement('span', '', ingredient), createElement('strong', '', measurement));
    ingredientList.append(item);
  });
  if (!ingredients.length) ingredientList.append(createElement('li', '', 'Ingredients are not available for this recipe.'));
  ingredientSection.append(createElement('h3', '', 'Ingredients'), ingredientList);

  const instructionSection = document.createElement('section');
  instructionSection.append(
    createElement('h3', '', 'Cooking instructions'),
    createElement('div', 'instructions', recipe.instructions || 'Cooking instructions are not available for this recipe.'),
  );
  const tutorialUrl = safeExternalUrl(recipe.tutorial);
  if (tutorialUrl) {
    const tutorial = createElement('a', 'tutorial-link', 'Watch tutorial ↗');
    tutorial.href = tutorialUrl;
    tutorial.target = '_blank';
    tutorial.rel = 'noopener noreferrer';
    instructionSection.append(tutorial);
  }

  details.append(ingredientSection, instructionSection);
  copy.append(details);
  showModal([image, copy], trigger);
  return true;
}

export function openRecipe(id, options = {}) {
  const recipe = recipeCatalog.getById(id);
  return recipe ? openRecipeDetails(recipe, options) : false;
}

export function isRecipeModalOpen() {
  return !$('#recipe-modal').hidden;
}

export function handleRecipeModalTab(event) {
  if (event.key !== 'Tab' || !isRecipeModalOpen()) return false;
  const focusable = [...$('#recipe-modal').querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden);
  if (!focusable.length) return false;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!$('#recipe-modal').contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

export function closeRecipeModal({ restoreFocus = true } = {}) {
  const modal = $('#recipe-modal');
  const wasOpen = !modal.hidden;
  modal.hidden = true;
  document.body.style.overflow = '';
  const trigger = modalTrigger;
  modalTrigger = null;
  if (wasOpen && restoreFocus && trigger?.isConnected && !trigger.disabled && typeof trigger.focus === 'function') {
    trigger.focus({ preventScroll: true });
  }
  return wasOpen;
}
