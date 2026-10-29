import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const setSourceSource = appSource.match(/function setSearchSource\(source\)[\s\S]*?\n\}/)?.[0] || '';
const discoverMoreSource = appSource.match(/function discoverMoreRecipes\(\)[\s\S]*?\n\}/)?.[0] || '';
const initializeSearchSource = appSource.match(/function initializeSearch\(\)[\s\S]*?\n\}/)?.[0] || '';
const pageClickBody = appSource.match(/document\.addEventListener\('click', \(event\) => \{([\s\S]*?)\n  \}\);/)?.[1] || '';

assert.ok(setSourceSource, 'Shared source helper must be present');
assert.ok(discoverMoreSource, 'Discover More action must be present');
assert.ok(initializeSearchSource, 'Unified search initializer must be present');
assert.ok(pageClickBody, 'Delegated page click handler must be present');
assert.equal((initializeSearchSource.match(/#search-form'\)\.addEventListener\('submit'/g) || []).length, 1);
assert.equal((initializeSearchSource.match(/#search-source-selector'\)\.addEventListener\('change'/g) || []).length, 1);
assert.doesNotMatch(appSource, /mealdb-search-button/);
assert.equal((html.match(/<button type="submit">Search<\/button>/g) || []).length, 1);
assert.equal((html.match(/name="recipe-source"/g) || []).length, 2);
assert.match(html, /value="offline" checked/);
assert.match(html, /value="online"/);
assert.match(html, /Searching TheMealDB sends your search term to an external recipe service\./);
assert.doesNotMatch(css, /\.search button\{display:none\}/);
assert.match(css, /@media\(max-width:430px\)[\s\S]*?\.search button\{display:block/);

class FakeElement {
  constructor(properties = {}) {
    Object.assign(this, properties);
    this.listeners = new Map();
    this.hidden ??= false;
    this.checked ??= false;
    this.value ??= '';
    this.focused = false;
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type, target = this) {
    const event = { target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    this.listeners.get(type)?.(event);
    return event;
  }
  focus() { this.focused = true; }
  scrollIntoView() {}
}

const elements = new Map([
  ['#search-source-offline', new FakeElement({ name: 'recipe-source', value: 'offline' })],
  ['#search-source-online', new FakeElement({ name: 'recipe-source', value: 'online' })],
  ['#offline-search-description', new FakeElement()],
  ['#online-search-disclosure', new FakeElement({ hidden: true })],
  ['#search-source-selector', new FakeElement()],
  ['#search-form', new FakeElement()],
  ['#search-input', new FakeElement()],
  ['#recommended', new FakeElement()],
]);
const calls = {
  reset: [], restore: 0, clear: 0, render: 0, fictional: [], liveInit: 0, liveSearch: [], navigation: [], toast: [],
};
const state = { filter: 'Chicken', view: 'all', query: '' };

const harness = Function(
  '$', 'calls', 'state',
  `let searchSource = 'offline';
   let recipeMode = 'offline';
   ${setSourceSource}
   function resetExternalDiscovery(options = {}) {
     const { resetSource = true } = options;
     calls.reset.push(options);
     recipeMode = 'offline';
     if (resetSource) setSearchSource('offline');
   }
   function restoreDiscoveryCollection() {
     calls.restore += 1;
     resetExternalDiscovery();
     state.filter = '';
     state.query = '';
     $('#search-input').value = '';
     calls.render += 1;
   }
   const clearFilters = () => { calls.clear += 1; state.filter = ''; state.query = ''; };
   const renderDashboard = () => { calls.render += 1; };
   const discoverExternalRecipes = (operation, value) => calls.fictional.push([operation, value]);
   const externalRecipeController = { getState: () => ({ status: 'idle' }) };
   const setActiveNavigation = (section) => calls.navigation.push(section);
   const showToast = (message) => calls.toast.push(message);
   let fakeLiveDashboard = null;
   const getLiveDashboard = () => {
     if (!fakeLiveDashboard) {
       calls.liveInit += 1;
       fakeLiveDashboard = { search: (query) => calls.liveSearch.push(query) };
     }
     return fakeLiveDashboard;
   };
   ${discoverMoreSource}
   ${initializeSearchSource}
   const handlePageClick = (event) => {${pageClickBody}
   };
   initializeSearch();
   return {
     getSource: () => searchSource,
     getMode: () => recipeMode,
     setMode: (mode) => { recipeMode = mode; },
     activateDiscoverMore: () => handlePageClick({
       target: { closest: (selector) => selector === '[data-discover-more]' ? {} : null },
     }),
   };`,
)(
  (selector) => {
    const element = elements.get(selector);
    if (!element) throw new Error(`Unexpected selector: ${selector}`);
    return element;
  },
  calls,
  state,
);

const offline = elements.get('#search-source-offline');
const online = elements.get('#search-source-online');
const selector = elements.get('#search-source-selector');
const form = elements.get('#search-form');
const input = elements.get('#search-input');

assert.equal(harness.getSource(), 'offline');
assert.equal(offline.checked, true);
assert.equal(online.checked, false);
assert.equal(elements.get('#offline-search-description').hidden, false);
assert.equal(elements.get('#online-search-disclosure').hidden, true);

input.value = 'pasta';
form.dispatch('submit');
assert.deepEqual(calls.liveSearch, [], 'Offline submit must not invoke live search');
assert.deepEqual(calls.fictional, [['search', 'pasta']]);

selector.dispatch('change', online);
assert.equal(harness.getSource(), 'online');
assert.equal(calls.liveInit, 0, 'Selecting Online must not initialize the live adapter');
assert.equal(calls.liveSearch.length, 0, 'Selecting Online must remain inert');
assert.equal(elements.get('#online-search-disclosure').hidden, false);

state.view = 'all';
const fictionalCallsBeforeDiscoverMore = calls.fictional.length;
const liveCallsBeforeDiscoverMore = calls.liveSearch.length;
harness.activateDiscoverMore();
assert.equal(harness.getSource(), 'offline', 'Discover More must restore the Offline source');
assert.equal(offline.checked, true);
assert.equal(online.checked, false);
assert.deepEqual(calls.fictional.slice(fictionalCallsBeforeDiscoverMore), [['discoverAll', undefined]]);
assert.equal(calls.liveSearch.length, liveCallsBeforeDiscoverMore, 'Discover More must not start live search');

selector.dispatch('change', online);
input.value = 'typed only';
input.dispatch('input');
assert.equal(calls.liveSearch.length, 0, 'Typing must not start live search');

input.value = '   ';
const resetsBeforeBlank = calls.reset.length;
form.dispatch('submit');
assert.equal(input.focused, true);
assert.equal(calls.liveSearch.length, 0);
assert.equal(calls.liveInit, 0);
assert.equal(calls.reset.length, resetsBeforeBlank);
assert.equal(calls.toast.at(-1), 'Enter a recipe name');

input.value = 'chicken';
form.dispatch('submit');
assert.deepEqual(calls.liveSearch, ['chicken']);
assert.equal(calls.liveInit, 1);
assert.equal(harness.getMode(), 'live');
assert.equal(harness.getSource(), 'online');
assert.deepEqual(calls.reset.at(-1), { resetSource: false });

input.value = 'beef';
form.dispatch('submit');
assert.deepEqual(calls.liveSearch, ['chicken', 'beef'], 'Each deliberate submit must start exactly one operation');
assert.equal(calls.liveInit, 1, 'Repeated submissions must reuse the live dashboard');

selector.dispatch('change', offline);
assert.equal(calls.restore, 1, 'Selecting Offline while live must restore offline discovery');
assert.equal(harness.getSource(), 'offline');
assert.equal(harness.getMode(), 'offline');

selector.dispatch('change', online);
input.value = 'soup';
const enterEvent = form.dispatch('submit');
assert.equal(enterEvent.defaultPrevented, true);
assert.equal(calls.liveSearch.at(-1), 'soup', 'Form/Enter submission must honor the selected source');

assert.doesNotMatch(appSource, /localStorage[^\n]*searchSource|sessionStorage[^\n]*searchSource|location[^\n]*searchSource/);
console.log('Unified search routing tests passed with fake elements and no network access.');
