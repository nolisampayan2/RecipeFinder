import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

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

assert.match(source, /handlePrimaryNavigation\(navigation\.dataset\.section, event\)/,
  'The actual delegated click handler must use the tested navigation function');

const calls = { loads: 0, renders: [], collectionRenders: 0, scrolls: 0, sidebar: [], focus: 0, prevented: 0, resets: 0 };
const elements = Object.fromEntries([
  '#search-source-offline', '#search-source-online', '#offline-search-description',
  '#online-search-disclosure', '#search-input', '#recommended', '#menu-btn',
  '#collections',
].map((selector) => [selector, {
  checked: false, hidden: false, value: 'old search',
  scrollIntoView() { calls.scrolls += 1; },
  focus() { calls.focus += 1; },
}]));
const context = {
  source: 'online', search: 'old search', filter: 'Pasta', view: 'all',
  live: { reset() { calls.resets += 1; } },
  mobile: { matches: true },
  $: (selector) => elements[selector],
  loadPreviews() { calls.loads += 1; return Promise.resolve(); },
  render() { calls.renders.push(context.view); },
  renderCollections() { calls.collectionRenders += 1; },
  setSidebar(value) { calls.sidebar.push(value); },
};
runInNewContext([
  actualFunction('resetOffline'),
  actualFunction('showSavedRecipes'),
  actualFunction('handlePrimaryNavigation'),
  'globalThis.navigate = handlePrimaryNavigation;',
].join('\n'), context);

function navigate(section) {
  context.navigate(section, { preventDefault() { calls.prevented += 1; } });
}

for (const section of ['home', 'recommended', 'categories', 'cuisines']) {
  navigate('favorites');
  assert.equal(context.view, 'favorites');
  assert.equal(calls.renders.at(-1), 'favorites');
  const beforeLoad = calls.loads;

  context.search = 'old search';
  context.filter = 'Pasta';
  navigate(section);
  assert.equal(context.view, 'default', `${section} must exit Favorites mode`);
  assert.equal(calls.renders.at(-1), 'default', `${section} must immediately show discovery`);
  assert.equal(context.source, 'offline');
  assert.equal(context.search, '');
  assert.equal(context.filter, '');
  assert.equal(elements['#search-input'].value, '');
  assert.equal(elements['#search-source-offline'].checked, true);
  assert.equal(elements['#search-source-online'].checked, false);
  assert.equal(calls.loads, beforeLoad + 1, `${section} must reload unfiltered previews`);

  navigate('favorites');
  assert.equal(context.view, 'favorites', `${section} must allow returning to Favorites`);
  assert.equal(calls.renders.at(-1), 'favorites');
}
assert.equal(calls.prevented, 8, 'Only Favorites navigation prevents the native link action');
assert.equal(calls.sidebar.every((value) => value === false), true);
assert.equal(calls.focus, 12, 'Mobile navigation restores menu-button focus');
assert.equal(calls.scrolls, 8, 'Favorites navigation scrolls to the saved collection');
navigate('collections');
assert.equal(context.view, 'collections');
assert.equal(calls.renders.at(-1), 'collections');
assert.equal(calls.collectionRenders, 1);
navigate('favorites');
assert.equal(context.view, 'favorites', 'The Collections view must return to Favorites');

console.log('Candidate discovery, Collections, and Favorites transitions passed.');
