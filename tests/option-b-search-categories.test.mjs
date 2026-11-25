import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import { BUILT_IN_RECIPE_PREVIEWS } from '../js/recipe-previews.js';
import { safeImageUrl } from '../js/security.js';

const source = await readFile(new URL('../js/option-b-app.js', import.meta.url), 'utf8');

function actualFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in the candidate entry`);
  const opening = source.indexOf('{', start);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete body`);
}

assert.match(source, /\$\('#search-form'\)\.addEventListener\('submit', handleSearchSubmit\)/);
const calls = { scrolls: [], renders: 0, previews: 0, online: [], prevented: 0 };
const input = { value: '  Pasta  ' };
let reducedMotion = false;
const searchContext = {
  source: 'offline', search: '', filter: 'Chicken', view: 'collections', live: null,
  $: (selector) => selector === '#search-input' ? input : {
    scrollIntoView(options) { calls.scrolls.push(options); },
  },
  matchMedia: () => ({ matches: reducedMotion }),
  render() { calls.renders += 1; },
  loadPreviews() { calls.previews += 1; return Promise.resolve(); },
  createLiveMealDbDashboard() {
    return { search(query) { calls.online.push(query); return Promise.resolve(); } };
  },
  window: { fetch() {} },
};
runInNewContext([
  actualFunction('scrollToSearchResults'),
  actualFunction('handleSearchSubmit'),
  'globalThis.submitSearch = handleSearchSubmit;',
].join('\n'), searchContext);
const submit = () => searchContext.submitSearch({ preventDefault() { calls.prevented += 1; } });

assert.equal(calls.scrolls.length, 0, 'Initial loading must not scroll');
searchContext.render();
searchContext.loadPreviews();
assert.equal(calls.scrolls.length, 0, 'Background rendering and loading must not scroll');
submit();
assert.equal(searchContext.search, 'Pasta');
assert.equal(searchContext.filter, '');
assert.equal(searchContext.view, 'default');
assert.equal(calls.previews, 2);
assert.equal(calls.scrolls.length, 1);
assert.equal(calls.scrolls[0].behavior, 'smooth');
assert.equal(calls.scrolls[0].block, 'start');

reducedMotion = true;
input.value = '  Soup  ';
submit();
assert.equal(searchContext.search, 'Soup');
assert.equal(calls.scrolls[1].behavior, 'auto');

searchContext.source = 'online';
input.value = '  ';
submit();
assert.equal(calls.scrolls.length, 2, 'Empty online queries must not scroll');
assert.equal(calls.online.length, 0);
input.value = '  noodles  ';
submit();
assert.deepEqual(calls.online, ['noodles']);
assert.equal(calls.scrolls.length, 3);
assert.equal(calls.scrolls[2].behavior, 'auto');
assert.equal(calls.prevented, 4);

class FakeImage {
  constructor() { this.dataset = {}; this.src = ''; }
  getAttribute(name) { return name === 'src' ? this.src : null; }
}
const categoryRow = { children: [], replaceChildren(...children) { this.children = children; } };
const cuisineList = { children: [], replaceChildren(...children) { this.children = children; } };
const categoryContext = {
  CATEGORIES: [
    ['Chicken', '🍗'], ['Beef', '🥩'], ['Seafood', '🐟'], ['Pasta', '🍝'],
    ['Vegetarian', '🥗'], ['Dessert', '🍰'], ['Breakfast', '🍳'], ['Soup', '🥣'],
  ],
  CUISINE_NAMES: [], IMAGE_FALLBACK: 'assets/recipefinder-favicon.svg',
  BUILT_IN_RECIPE_PREVIEWS, safeImageUrl, HTMLImageElement: FakeImage,
  $: (selector) => selector === '#category-row' ? categoryRow : cuisineList,
  node(tag, className = '', textContent = '') {
    if (tag === 'img') return new FakeImage();
    return {
      className, textContent, dataset: {}, children: [],
      append(...children) { this.children.push(...children); },
    };
  },
};
runInNewContext([
  actualFunction('renderTaxonomy'),
  actualFunction('handleImageError'),
  'globalThis.renderCategories = renderTaxonomy;',
  'globalThis.onImageError = handleImageError;',
].join('\n'), categoryContext);
categoryContext.renderCategories();
assert.equal(categoryRow.children.length, 8);
for (const button of categoryRow.children) {
  const recipe = BUILT_IN_RECIPE_PREVIEWS.find((item) => item.category === button.dataset.filter);
  assert.ok(recipe, 'Every original category has a safe built-in preview');
  assert.equal(button.className, 'category');
  assert.equal(button.children[0].src, recipe.image);
  assert.equal(button.children[0].alt, '');
  assert.equal(button.children[0].loading, 'lazy');
  assert.equal(button.children[0].dataset.fallbackImage, recipe.fallbackImage || 'assets/recipefinder-favicon.svg');
  assert.match(button.children[1].textContent, new RegExp(button.dataset.filter));
}
const brokenImage = categoryRow.children[0].children[0];
categoryContext.onImageError({ target: brokenImage });
assert.equal(brokenImage.src, 'assets/recipefinder-favicon.svg');
categoryContext.onImageError({ target: brokenImage });
assert.equal(brokenImage.src, 'assets/recipefinder-favicon.svg', 'Fallback must not loop');
brokenImage.dataset.fallbackImage = 'javascript:alert(1)';
brokenImage.src = 'https://example.test/broken.jpg';
categoryContext.onImageError({ target: brokenImage });
assert.equal(brokenImage.src, 'https://example.test/broken.jpg', 'Unsafe fallback must be ignored');

categoryContext.BUILT_IN_RECIPE_PREVIEWS = [];
categoryContext.renderCategories();
assert.equal(categoryRow.children[0].children[0].src, 'assets/recipefinder-favicon.svg');
assert.match(source, /document\.addEventListener\('error', handleImageError, true\)/);

console.log('Candidate explicit search scrolling and safe category imagery passed.');
