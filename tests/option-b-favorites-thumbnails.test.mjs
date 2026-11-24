import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import { BUILT_IN_RECIPE_PREVIEWS } from '../js/recipe-previews.js';
import { safeImageUrl } from '../js/security.js';

const source = await readFile(new URL('../js/option-b-app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
assert.match(css, /\.option-b-favorite-item\{display:grid;grid-template-columns:65px minmax\(0,1fr\) 44px;align-items:center;gap:8px;padding-inline-end:8px\}/);
assert.match(css, /\.option-b-favorite-item \.mini-remove\{width:44px;min-width:44px;padding:0\}/);
assert.match(css, /\.option-b-favorite-item small\{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
assert.match(css, /\.favorite-item strong\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
const start = source.indexOf('function renderFavorites()');
assert.notEqual(start, -1);
const opening = source.indexOf('{', start);
let depth = 0;
let end = -1;
for (let index = opening; index < source.length; index += 1) {
  if (source[index] === '{') depth += 1;
  if (source[index] === '}') depth -= 1;
  if (depth === 0) { end = index + 1; break; }
}
assert.notEqual(end, -1);

function element(tag, className = '', textContent = '') {
  return {
    tag, className, textContent, dataset: {}, children: [], attributes: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

const preview = BUILT_IN_RECIPE_PREVIEWS[0];
const nodes = {
  '#fav-count': element('span'), '#favorites-status': element('p'),
  '#favorite-list': element('div'),
};
const context = {
  $: (selector) => nodes[selector], node: element, safeImageUrl,
  IMAGE_FALLBACK: 'assets/recipefinder-favicon.svg',
  favoriteState: { mode: 'guest', favoriteIds: [preview.id], message: '' },
  guestFavoriteIds: new Set([preview.id]),
  owned: new Map([[preview.id, preview]]), source: 'offline', live: null,
};
context.favoriteIds = () => context.favoriteState.favoriteIds;
runInNewContext(`${source.slice(start, end)}\nglobalThis.showFavorites = renderFavorites;`, context);
const show = () => context.showFavorites();
const firstRow = () => nodes['#favorite-list'].children[0];

show();
assert.equal(nodes['#fav-count'].textContent, '1');
assert.equal(firstRow().children[0].tag, 'img', 'Guest owned favorite needs a thumbnail');
assert.equal(firstRow().className, 'favorite-item option-b-favorite-item');
assert.equal(firstRow().children[0].src, preview.image);
assert.equal(firstRow().children[0].alt, '');
assert.equal(firstRow().children[0].dataset.fallbackImage, preview.fallbackImage || context.IMAGE_FALLBACK);
assert.equal(firstRow().children[1].children[0].textContent, preview.name);
assert.equal(firstRow().children[1].children[1].textContent, preview.category);
assert.equal(firstRow().children[2].dataset.favorite, preview.id);
assert.equal(firstRow().children[2].tag, 'button');
assert.equal(firstRow().children[2].type, 'button');
assert.equal(firstRow().children[2].attributes['aria-label'], `Remove ${preview.name} from favorites`);

context.favoriteState = { mode: 'account-ready', favoriteIds: [preview.id], message: '' };
context.guestFavoriteIds = new Set();
show();
assert.equal(firstRow().children[0].tag, 'img', 'Authenticated owned favorite needs the same thumbnail');
assert.equal(firstRow().children[0].src, preview.image);
assert.equal(firstRow().children[2].dataset.favorite, preview.id);

context.owned = new Map([[preview.id, { ...preview, name: 'An unusually long recipe name that must stay inside the Saved Recipes panel' }]]);
show();
assert.equal(firstRow().children[1].children[0].textContent,
  'An unusually long recipe name that must stay inside the Saved Recipes panel');

context.favoriteState = { mode: 'guest', favoriteIds: ['external:themealdb:42'], message: '' };
context.owned = new Map();
context.source = 'online';
context.live = { getState: () => ({ recipes: [{
  id: 'external:themealdb:42', name: 'Public recipe', category: 'Seafood',
  image: 'https://example.test/meal.jpg', fallbackImage: '',
}] }) };
show();
assert.equal(firstRow().children[0].src, 'https://example.test/meal.jpg');
assert.equal(firstRow().children[0].dataset.fallbackImage, context.IMAGE_FALLBACK);

context.live = { getState: () => ({ recipes: [{
  id: 'external:themealdb:42', name: 'Public recipe', category: 'Seafood',
  image: 'javascript:alert(1)', fallbackImage: 'data:image/png;base64,AAAA',
}] }) };
show();
assert.equal(firstRow().children[0].src, context.IMAGE_FALLBACK, 'Unsafe image URLs must not be used');

context.source = 'offline';
show();
assert.equal(firstRow().children[0].className, 'favorite-placeholder-icon');
assert.equal(firstRow().children[0].attributes['aria-hidden'], 'true');
assert.equal(firstRow().children[1].children[0].textContent, 'Saved recipe unavailable');
assert.equal(firstRow().children[2].dataset.removeUnresolved, 'external:themealdb:42');

context.favoriteState = { mode: 'account-loading', favoriteIds: [], message: '' };
show();
assert.equal(nodes['#favorite-list'].children.length, 1);
assert.equal(nodes['#favorite-list'].children[0].className, 'empty-mini');
assert.equal(nodes['#fav-count'].textContent, '0', 'Account transitions must not retain prior thumbnails');

console.log('Candidate guest and account Saved Recipes thumbnails passed with safe preview fixtures.');
