import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../js/option-b-app.js', import.meta.url), 'utf8');
const generalRender = source.split('function render() {')[1]?.split('\nfunction renderTaxonomy() {')[0];
assert.ok(generalRender);
assert.doesNotMatch(generalRender, /renderCollections\(\)/,
  'Background recipe and Favorites updates must preserve unsaved collection form input');
const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
assert.match(css, /\.option-b-collections\[hidden\]\s*\{\s*display:\s*none/);
assert.match(css, /\.option-b-collections button:focus-visible/);
const nodes = new Map();
function element(tag = 'div') {
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {},
    textContent: '', hidden: false, disabled: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this.attributes[key] = value; },
    before(next) {
      const register = (item) => {
        if (item.id) nodes.set(`#${item.id}`, item);
        item.children.forEach(register);
      };
      register(next);
    },
    scrollIntoView() {}, focus() {},
  };
}
nodes.set('#main-nav', element('nav'));
nodes.set('#recommended', element('section'));
const documentLike = { querySelector: (selector) => nodes.get(selector) ?? null,
  createElement: element };
const context = createContext({
  document: documentLike, localStorage: { getItem: () => null },
  matchMedia: () => ({ matches: false }),
  createOptionBModal: () => ({}),
});
const executable = source.replace(/^import .*;\r?\n/gm, '')
  .replace(/\binitialize\(\);\s*$/, '')
  + '\nglobalThis.testUI = { installCollectionsPage, renderCollections, '
  + 'setAuth(state) { authState = state; }, '
  + 'setController(controller) { collectionsController = controller; } };';
runInContext(executable, context);
context.testUI.installCollectionsPage();
assert.equal(nodes.get('#main-nav').children.at(-1).dataset.section, 'collections');
assert.equal(nodes.get('#collections').hidden, true);

context.testUI.setAuth({ status: 'guest', userId: null });
context.testUI.renderCollections();
assert.match(nodes.get('#collections-status').textContent, /Sign in/);
const guestActions = nodes.get('#collections-content').children[0];
assert.deepEqual(guestActions.children.map((child) => child.href), ['login.html', 'register.html']);

const ACCOUNT = '123e4567-e89b-42d3-a456-426614174000';
context.testUI.setAuth({ status: 'authenticated', userId: ACCOUNT });
context.testUI.setController({ getState: () => ({ status: 'loading', collections: [], pending: false }) });
context.testUI.renderCollections();
assert.match(nodes.get('#collections-status').textContent, /Checking/);
assert.equal(nodes.get('#collections-content').children.length, 0);

context.testUI.setController({ getState: () => ({ status: 'ready', pending: false, message: '',
  collections: [{ id: ACCOUNT, name: '<My dinners>', items: [
    { id: ACCOUNT, recipeId: 'external:themealdb:52772' },
  ] }],
}) });
context.testUI.renderCollections();
const [createForm, card] = nodes.get('#collections-content').children;
assert.equal(createForm.dataset.collectionCreate, 'true');
assert.equal(card.children[0].textContent, '<My dinners>');
assert.equal(card.children[1].children[0].dataset.collectionRename, ACCOUNT);
assert.equal(card.children[1].children[1].dataset.collectionDelete, ACCOUNT);
assert.equal(card.children[2].children[1].dataset.collectionView, 'external:themealdb:52772');
assert.equal(card.children[2].children[2].dataset.collectionRemove, ACCOUNT);
assert.equal(JSON.stringify(nodes.get('#collections-content')).includes('instructions'), false);

context.testUI.setController({ getState: () => ({ status: 'ready', pending: true, message: '',
  collections: [{ id: ACCOUNT, name: 'Saving', items: [] }],
}) });
context.testUI.renderCollections();
assert.match(nodes.get('#collections-status').textContent, /Saving collection/);
assert.equal(nodes.get('#collections-content').children[0].children[1].disabled, true);

context.testUI.setAuth({ status: 'guest', userId: null });
context.testUI.renderCollections();
assert.equal(JSON.stringify(nodes.get('#collections-content')).includes('<My dinners>'), false,
  'Logout must remove the prior account collection DOM');
console.log('Candidate Collections guest, loading, ready, and logout presentation passed.');
