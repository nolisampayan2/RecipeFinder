import { safeExternalUrl, safeImageUrl } from './security.js';

/** Candidate-only dialog renderer. It never imports the legacy recipe catalog. */
export function createOptionBModal(documentLike) {
  const root = documentLike.querySelector('#recipe-modal');
  const panel = root?.querySelector('.modal-panel');
  const content = documentLike.querySelector('#modal-content');
  const closeButton = root?.querySelector('.modal-close');
  if (!root || !panel || !content || !closeButton) throw new TypeError('Recipe dialog is unavailable.');
  let trigger = null;

  const element = (tag, className = '', value = '') => {
    const node = documentLike.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  };

  function present({ content: supplied, heading, initialFocus, trigger: nextTrigger, closeLabel } = {}) {
    if (!supplied || !heading) return false;
    trigger = nextTrigger ?? trigger;
    heading.id = 'modal-title';
    if (supplied.tagName === 'SECTION') supplied.classList.add('modal-copy', 'option-b-login-gate');
    if (closeLabel) closeButton.setAttribute('aria-label', closeLabel);
    content.replaceChildren(supplied);
    root.hidden = false;
    documentLike.body.style.overflow = 'hidden';
    (initialFocus ?? closeButton).focus();
    return true;
  }

  function close({ restoreFocus = true } = {}) {
    if (root.hidden) return false;
    root.hidden = true;
    content.replaceChildren();
    documentLike.body.style.overflow = '';
    const previous = trigger;
    trigger = null;
    if (restoreFocus && previous?.isConnected && !previous.disabled) previous.focus({ preventScroll: true });
    return true;
  }

  function status(title, message, nextTrigger = null) {
    const copy = element('div', 'modal-copy');
    const heading = element('h2', '', title);
    copy.append(heading, element('p', '', message));
    return present({ content: copy, heading, trigger: nextTrigger });
  }

  function detail(recipe, nextTrigger = null) {
    if (!recipe || typeof recipe.name !== 'string') return false;
    const wrapper = element('div');
    const image = element('img', 'modal-hero');
    image.alt = recipe.name;
    const imageUrl = safeImageUrl(recipe.image);
    if (imageUrl) image.src = imageUrl;
    const fallback = safeImageUrl(recipe.fallbackImage);
    if (fallback) image.dataset.fallbackImage = fallback;
    const copy = element('div', 'modal-copy');
    const heading = element('h2', '', recipe.name);
    const tags = element('div', 'tags');
    tags.append(element('span', 'tag', recipe.category), element('span', 'tag alt', recipe.cuisine));
    copy.append(tags, heading, element('p', '', recipe.description));
    const columns = element('div', 'detail-columns');
    const ingredients = element('section');
    const ingredientList = element('ul', 'ingredients');
    for (const pair of recipe.ingredients ?? []) {
      const item = element('li');
      item.append(element('span', '', pair[0]), element('strong', '', pair[1]));
      ingredientList.append(item);
    }
    ingredients.append(element('h3', '', 'Ingredients'), ingredientList);
    const instructions = element('section');
    instructions.append(element('h3', '', 'Cooking instructions'), element('div', 'instructions', recipe.instructions));
    const tutorial = safeExternalUrl(recipe.tutorial);
    if (tutorial) {
      const link = element('a', 'tutorial-link', 'Watch tutorial ↗');
      link.href = tutorial;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      instructions.append(link);
    }
    columns.append(ingredients, instructions);
    copy.append(columns);
    wrapper.append(image, copy);
    return present({ content: wrapper, heading, trigger: nextTrigger });
  }

  function handleTab(event) {
    if (root.hidden || event.key !== 'Tab') return false;
    const focusable = [...panel.querySelectorAll('button:not([disabled]), a[href]')]
      .filter((item) => !item.hidden);
    if (!focusable.length) return false;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!panel.contains(documentLike.activeElement) || (event.shiftKey && documentLike.activeElement === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return true;
    }
    if (!event.shiftKey && documentLike.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  return Object.freeze({ present, close, status, detail, handleTab, isOpen: () => !root.hidden });
}
