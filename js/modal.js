import { recipeCatalog } from './recipe-catalog.js';
import { safeExternalUrl, safeImageUrl, setSafeText } from './security.js';

const $ = (selector) => document.querySelector(selector);

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) setSafeText(element, text);
  return element;
}

export function openRecipe(id) {
  const recipe = recipeCatalog.getById(id);
  if (!recipe) return;
  const image = createElement('img', 'modal-hero');
  image.alt = recipe.name;
  const imageUrl = safeImageUrl(recipe.image);
  const fallbackUrl = safeImageUrl(recipe.fallbackImage);
  if (imageUrl) image.src = imageUrl;
  if (fallbackUrl) image.dataset.fallbackImage = fallbackUrl;

  const copy = createElement('div', 'modal-copy');
  const tags = createElement('div', 'tags');
  tags.append(createElement('span', 'tag', recipe.category), createElement('span', 'tag alt', recipe.cuisine));
  const title = createElement('h2', '', recipe.name);
  title.id = 'modal-title';
  copy.append(tags, title, createElement('p', '', recipe.description));

  const details = createElement('div', 'detail-columns');
  const ingredientSection = document.createElement('section');
  const ingredientList = createElement('ul', 'ingredients');
  recipe.ingredients.forEach(([ingredient, measurement]) => {
    const item = document.createElement('li');
    item.append(createElement('span', '', ingredient), createElement('strong', '', measurement));
    ingredientList.append(item);
  });
  ingredientSection.append(createElement('h3', '', 'Ingredients'), ingredientList);

  const instructionSection = document.createElement('section');
  instructionSection.append(
    createElement('h3', '', 'Cooking instructions'),
    createElement('div', 'instructions', recipe.instructions),
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
  $('#modal-content').replaceChildren(image, copy);
  $('#recipe-modal').hidden = false;
  document.body.style.overflow = 'hidden';
  $('.modal-close').focus();
}

export function closeRecipeModal() {
  $('#recipe-modal').hidden = true;
  document.body.style.overflow = '';
}
