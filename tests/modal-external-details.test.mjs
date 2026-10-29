import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFictionalExternalRecipeSource } from '../js/fictional-external-recipe-source.js';

class FakeClassList { add() {} remove() {} contains() { return false; } }
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classList = new FakeClassList();
    this.attributes = {};
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  focus() { fakeDocument.activeElement = this; this.focused = true; }
  querySelectorAll() { return this.focusables || []; }
  contains(element) { return this === element || (this.focusables || []).includes(element); }
}

const elements = {
  '#modal-content': new FakeElement(),
  '#recipe-modal': new FakeElement(),
  '.modal-close': new FakeElement('button'),
};
elements['#recipe-modal'].hidden = true;
elements['#recipe-modal'].focusables = [elements['.modal-close']];
const fakeDocument = {
  activeElement: null,
  body: { style: {} },
  createElement: (tag) => new FakeElement(tag),
  querySelector: (selector) => elements[selector],
};
globalThis.document = fakeDocument;

const modal = await import(`../js/modal.js?test=${Date.now()}`);
const trigger = new FakeElement('button');
modal.openRecipeLoading(trigger);
assert.equal(elements['#recipe-modal'].hidden, false);
assert.equal(fakeDocument.activeElement, elements['.modal-close']);
assert.match(JSON.stringify(elements['#modal-content']), /Loading recipe details/);
assert.match(JSON.stringify(elements['#modal-content']), /aria-live/);

const fictional = await createFictionalExternalRecipeSource().getDetails('external:fictional-offline:990001');
assert.equal(modal.openRecipeDetails(fictional), true);
assert.equal(fakeDocument.activeElement, elements['.modal-close'], 'Async success must not move focus again');
const rendered = JSON.stringify(elements['#modal-content']);
assert.match(rendered, /Offline recipe preview/);
assert.match(rendered, /Recipe details loaded/);
assert.match(rendered, /Aurora Garden Couscous/);
assert.match(rendered, /Couscous/);
assert.match(rendered, /1 cup/);
assert.match(rendered, /Prepare the couscous/);

assert.equal(modal.closeRecipeModal({ restoreFocus: false }), true);
trigger.focused = false;
elements['.modal-close'].focused = false;
fakeDocument.activeElement = null;
const liveRecipe = {
  id: 'external:themealdb:12345',
  source: 'external',
  externalProvider: 'themealdb',
  externalId: '12345',
  detailLevel: 'full',
  name: '<img src=x onerror=alert(1)> Live Meal',
  image: 'https://www.themealdb.com/images/media/meals/fixture.jpg',
  category: 'Seafood',
  cuisine: 'Canadian',
  description: '',
  ingredients: [['Salmon', '2 fillets'], ['Lemon', '1']],
  instructions: 'Cook safely.\nServe warm.',
  tutorial: 'https://www.youtube.com/watch?v=fictional',
};
assert.equal(modal.openRecipeDetails(liveRecipe, { trigger }), true);
assert.equal(fakeDocument.activeElement, elements['.modal-close'], 'Live modal must initially focus its close button');
const liveContent = elements['#modal-content'].children;
const liveCopy = liveContent[1];
assert.equal(liveCopy.children[1].textContent, 'TheMealDB recipe');
assert.equal(liveCopy.children[3].textContent, liveRecipe.name, 'Hostile provider text must remain inert text');
assert.match(JSON.stringify(liveContent), /Salmon/);
assert.match(JSON.stringify(liveContent), /2 fillets/);
assert.match(JSON.stringify(liveContent), /Seafood/);
assert.match(JSON.stringify(liveContent), /Canadian/);
assert.match(JSON.stringify(liveContent), /Cook safely/);
assert.match(JSON.stringify(liveContent), /https:\/\/www\.youtube\.com\/watch\?v=fictional/);
assert.equal(liveContent[0].src, liveRecipe.image);
const liveTutorial = liveCopy.children[5].children[1].children[2];
assert.equal(liveTutorial.href, liveRecipe.tutorial);
assert.equal(liveTutorial.target, '_blank');
assert.equal(liveTutorial.rel, 'noopener noreferrer');
assert.equal(modal.closeRecipeModal(), true);
assert.equal(trigger.focused, true, 'Closing live details must restore focus to the exact live-card trigger');
assert.equal(elements['#recipe-modal'].hidden, true);
assert.equal(fakeDocument.body.style.overflow, '');

modal.openRecipeDetails({ ...fictional, image: 'javascript:alert(1)', tutorial: 'data:text/html,unsafe' });
const unsafeMediaContent = elements['#modal-content'].children;
assert.equal(unsafeMediaContent[0].src, undefined);
assert.doesNotMatch(JSON.stringify(unsafeMediaContent), /javascript:|data:text\/html/);

modal.openRecipeDetails({ ...fictional, ingredients: [], instructions: '' });
assert.match(JSON.stringify(elements['#modal-content']), /Ingredients are not available/);
assert.match(JSON.stringify(elements['#modal-content']), /Cooking instructions are not available/);

modal.openRecipeError();
assert.equal(fakeDocument.activeElement, elements['.modal-close'], 'Async error must not move focus again');
assert.match(JSON.stringify(elements['#modal-content']), /Recipe details unavailable/);
assert.doesNotMatch(JSON.stringify(elements['#modal-content']), /provider|stack|token/i);

assert.equal(modal.openRecipe('lemon-chicken'), true);
assert.match(JSON.stringify(elements['#modal-content']), /Grilled Lemon Chicken/);

const last = new FakeElement('a');
elements['#recipe-modal'].focusables = [elements['.modal-close'], last];
fakeDocument.activeElement = last;
let prevented = false;
assert.equal(modal.handleRecipeModalTab({ key: 'Tab', shiftKey: false, preventDefault() { prevented = true; } }), true);
assert.equal(prevented, true);
assert.equal(fakeDocument.activeElement, elements['.modal-close']);
fakeDocument.activeElement = elements['.modal-close'];
assert.equal(modal.handleRecipeModalTab({ key: 'Tab', shiftKey: true, preventDefault() {} }), true);
assert.equal(fakeDocument.activeElement, last);

trigger.focused = false;
modal.openRecipeLoading(trigger);
assert.equal(modal.closeRecipeModal(), true);
assert.equal(trigger.focused, true);
assert.equal(fakeDocument.body.style.overflow, '');
trigger.isConnected = false;
modal.openRecipeLoading(trigger);
assert.doesNotThrow(() => modal.closeRecipeModal());

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.match(appSource, /externalSourceRegistry\.getDetails\(id\)/);
assert.match(appSource, /externalSourceRegistry\.invalidateDetails\(\)/);
assert.match(appSource, /externalDetailGeneration/);
assert.match(appSource, /handleRecipeModalTab\(event\)/);
assert.match(appSource, /openDemoRecipe\(viewButton\.dataset\.view, viewButton\)/);
assert.match(appSource, /openDemoRecipe\(randomRecipe\.id/);
assert.doesNotMatch(appSource, /fetch\(|supabase|signIn|signUp|exchangeCodeForSession/i);

function extractFunction(name) {
  const match = appSource.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `Expected ${name} in app.js`);
  return match[0];
}

const lifecycleFactory = Function(
  'externalSourceRegistry', 'openRecipeLoading', 'openRecipeDetails', 'openRecipeError',
  'isRecipeModalOpen', 'closeRecipeModal', 'openRecipe', 'dashboardCatalog', 'initialRecipeMode',
  `let externalDetailGeneration = 0;
   let recipeMode = initialRecipeMode;
   ${extractFunction('invalidateExternalDetails')}
   ${extractFunction('closeActiveRecipeModal')}
   ${extractFunction('openDemoRecipe')}
   ${extractFunction('openExternalRecipe')}
   return { invalidateExternalDetails, closeActiveRecipeModal, openDemoRecipe, openExternalRecipe };`,
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createLifecycleHarness() {
  const requests = [];
  const events = [];
  let modalOpen = false;
  const registry = {
    invalidateDetails() { events.push('invalidate'); },
    getDetails(id) {
      const request = deferred();
      requests.push({ id, ...request });
      return request.promise;
    },
  };
  const actions = lifecycleFactory(
    registry,
    () => { modalOpen = true; events.push('loading'); },
    (recipe) => { events.push(`external:${recipe.id}`); },
    () => { events.push('error'); },
    () => modalOpen,
    () => { modalOpen = false; events.push('close'); },
    (id) => { modalOpen = true; events.push(`demo:${id}`); return true; },
    { getById: () => null },
    'offline',
  );
  return { actions, events, requests };
}

const demoRace = createLifecycleHarness();
const pendingBeforeDemo = demoRace.actions.openExternalRecipe('external:fictional-offline:990001', trigger);
demoRace.actions.openDemoRecipe('lemon-chicken', trigger);
demoRace.requests[0].resolve(fictional);
await pendingBeforeDemo;
assert.equal(demoRace.events.at(-1), 'demo:lemon-chicken', 'Late fictional details must not overwrite a newer demo');

const secondSelection = createLifecycleHarness();
const firstPending = secondSelection.actions.openExternalRecipe('external:fictional-offline:990001', trigger);
const secondPending = secondSelection.actions.openExternalRecipe('external:fictional-offline:990002', trigger);
secondSelection.requests[0].resolve(fictional);
await firstPending;
const secondRecipe = { ...fictional, id: 'external:fictional-offline:990002', name: 'Second fictional recipe' };
secondSelection.requests[1].resolve(secondRecipe);
await secondPending;
assert.equal(secondSelection.events.at(-1), 'external:external:fictional-offline:990002');
assert.equal(secondSelection.events.includes('external:external:fictional-offline:990001'), false);

const closeRace = createLifecycleHarness();
const pendingBeforeClose = closeRace.actions.openExternalRecipe('external:fictional-offline:990001', trigger);
closeRace.actions.closeActiveRecipeModal();
closeRace.requests[0].resolve(fictional);
await pendingBeforeClose;
assert.equal(closeRace.events.at(-1), 'close', 'Close must prevent late detail rendering');

const navigationRace = createLifecycleHarness();
const pendingBeforeNavigation = navigationRace.actions.openExternalRecipe('external:fictional-offline:990001', trigger);
navigationRace.actions.invalidateExternalDetails({ closeModal: true, restoreFocus: false });
navigationRace.requests[0].resolve(fictional);
await pendingBeforeNavigation;
assert.equal(navigationRace.events.at(-1), 'close', 'Navigation invalidation must prevent late detail rendering');

let liveRegistryHydrations = 0;
let liveModalOpen = false;
let currentLiveRecipe = liveRecipe;
const liveEvents = [];
const liveActions = lifecycleFactory(
  {
    invalidateDetails() { liveEvents.push('invalidate'); },
    getDetails() { liveRegistryHydrations += 1; throw new Error('Live details must not hydrate'); },
  },
  () => { liveEvents.push('loading'); },
  (recipe, options) => { liveModalOpen = true; liveEvents.push(`live:${recipe.id}`); return options?.trigger === trigger; },
  () => { liveEvents.push('error'); },
  () => liveModalOpen,
  () => { liveModalOpen = false; liveEvents.push('close'); },
  () => false,
  { getById: (id) => id === currentLiveRecipe.id ? currentLiveRecipe : null },
  'live',
);
assert.equal(await liveActions.openExternalRecipe(liveRecipe.id, trigger), true);
assert.equal(liveEvents.at(-1), `live:${liveRecipe.id}`);
assert.equal(liveRegistryHydrations, 0, 'Opening live details must not use registry hydration');
assert.equal(liveEvents.includes('loading'), false, 'In-memory live details must not show a network loading state');
currentLiveRecipe = { ...liveRecipe, detailLevel: 'summary' };
assert.equal(await liveActions.openExternalRecipe(liveRecipe.id, trigger), false, 'Summary live records must fail closed');
currentLiveRecipe = liveRecipe;
assert.equal(await liveActions.openExternalRecipe('external:themealdb:99999', trigger), false, 'Unknown live IDs must fail closed');
assert.equal(await liveActions.openExternalRecipe('external:themealdb:not-digits', trigger), false, 'Malformed live IDs must fail closed');
assert.equal(liveRegistryHydrations, 0);
liveActions.invalidateExternalDetails({ closeModal: true, restoreFocus: false });
assert.equal(liveEvents.at(-1), 'close', 'Navigation reset must close live details');

const offlineLiveActions = lifecycleFactory(
  { invalidateDetails() {}, getDetails() { throw new Error('Stale live IDs must not hydrate'); } },
  () => { throw new Error('Stale live IDs must not load'); },
  () => false,
  () => false,
  () => false,
  () => {},
  () => false,
  { getById: () => liveRecipe },
  'offline',
);
assert.equal(await offlineLiveActions.openExternalRecipe(liveRecipe.id, trigger), false, 'Live mode is required');

assert.match(appSource, /if \(event\.target\.closest\('\[data-close\]'\)\) closeActiveRecipeModal\(\)/);
assert.match(appSource, /if \(isRecipeModalOpen\(\)\)[\s\S]*?closeActiveRecipeModal\(\)/);

console.log('modal external detail tests passed');
