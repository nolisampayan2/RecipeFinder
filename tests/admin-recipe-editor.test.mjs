import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAdminRecipeEditor } from '../js/admin-recipe-editor.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const RECIPE_ID = 'cms:11111111-2222-4333-8444-555555555555';
const UPDATED_AT = '2026-11-04T10:20:30.987654+00:00';
const NEXT_UPDATED_AT = '2026-11-04T10:21:30.123456+00:00';

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function element() {
  const listeners = new Map();
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    children: [],
    attributes: {},
    className: '',
    focused: false,
    classList: { toggle(name, active) { this[name] = active; } },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    listenerCount() {
      return [...listeners.values()].reduce((count, values) => count + values.size, 0);
    },
    emit(name, event = {}) {
      let result;
      for (const listener of listeners.get(name) ?? []) result = listener(event);
      return result;
    },
    append(...children) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
    },
    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    },
    focus() { this.focused = true; },
  };
}

function editorElements() {
  const fields = Object.fromEntries([
    'name', 'description', 'categoryId', 'cuisineId', 'imageUrl',
    'fallbackImageUrl', 'tutorialUrl', 'instructions',
  ].map((name) => [name, element()]));
  return {
    panel: element(),
    form: element(),
    title: element(),
    status: element(),
    close: element(),
    cancel: element(),
    save: element(),
    addIngredient: element(),
    ingredients: element(),
    ...fields,
    errors: Object.fromEntries([
      ...Object.keys(fields), 'ingredients', 'form',
    ].map((name) => [name, element()])),
  };
}

function detail(overrides = {}) {
  return {
    id: RECIPE_ID,
    name: 'Existing Draft',
    description: 'A complete draft.',
    categoryId: 1,
    cuisineId: 2,
    imageUrl: 'https://images.example.test/draft.jpg',
    fallbackImageUrl: null,
    tutorialUrl: null,
    ingredients: [{ name: 'Rice', measurement: '1 cup' }],
    instructions: 'Cook safely.',
    status: 'draft',
    sourceType: 'cms',
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function fillValid(elements, name = 'Offline Draft') {
  elements.name.value = name;
  elements.description.value = 'A safe offline draft.';
  elements.categoryId.value = '1';
  elements.cuisineId.value = '2';
  elements.imageUrl.value = 'https://images.example.test/draft.jpg';
  elements.fallbackImageUrl.value = '';
  elements.tutorialUrl.value = '';
  elements.instructions.value = 'Cook until ready.';
  const ingredient = elements.ingredients.children[0];
  ingredient.children[0].children[1].value = 'Rice';
  ingredient.children[1].children[1].value = '1 cup';
}

function assertEditorDataCleared(elements, message) {
  for (const field of [
    'name', 'description', 'categoryId', 'cuisineId', 'imageUrl',
    'fallbackImageUrl', 'tutorialUrl', 'instructions',
  ]) assert.equal(elements[field].value, '', `${message}: ${field}`);
  assert.equal(elements.categoryId.children.length, 0, `${message}: category options`);
  assert.equal(elements.cuisineId.children.length, 0, `${message}: cuisine options`);
  assert.equal(elements.ingredients.children.length, 0, `${message}: ingredient rows`);
  assert.equal(elements.status.textContent, '', `${message}: status`);
  for (const [field, error] of Object.entries(elements.errors)) {
    assert.equal(error.textContent, '', `${message}: ${field} error`);
  }
}

const calls = [];
const elements = editorElements();
const fakeWindow = element();
let allowDiscard = true;
let createStatus = 'success';
const savedRecipes = [];
let authorizationLosses = 0;
let loadedRecipe = detail();
const editor = createAdminRecipeEditor({
  elements,
  documentLike: { createElement: element },
  windowLike: fakeWindow,
  recipeSource: {
    async getById(id) { calls.push(['getById', id]); return { data: loadedRecipe, error: null }; },
  },
  mutationService: {
    async createDraft(input, context) {
      calls.push(['createDraft', input, context]);
      if (createStatus === 'throw') throw new Error('PRIVATE provider failure');
      if (createStatus === 'denied') return { status: 'denied', data: null, error: null };
      if (createStatus !== 'success') return { status: createStatus, data: null, error: null };
      return { status: 'success', data: { id: context.recipeId, updatedAt: UPDATED_AT }, error: null };
    },
    async editDraft(input, context) {
      calls.push(['editDraft', input, context]);
      return { status: 'success', data: { id: context.recipeId, updatedAt: NEXT_UPDATED_AT }, error: null };
    },
    invalidate() { calls.push(['mutationInvalidate']); return true; },
    cleanup() { calls.push(['mutationCleanup']); return true; },
  },
  taxonomySource: {
    async listCategories() {
      calls.push(['categories']);
      return { data: [{ id: 1, name: 'Dinner', isActive: true }, { id: 3, name: 'Archived', isActive: false }], error: null };
    },
    async listCuisines() {
      calls.push(['cuisines']);
      return { data: [{ id: 2, name: 'Filipino', isActive: true }], error: null };
    },
    invalidate() { calls.push(['taxonomyInvalidate']); return true; },
    cleanup() { calls.push(['taxonomyCleanup']); return true; },
  },
  createRecipeId: () => RECIPE_ID,
  confirmDiscard: () => allowDiscard,
  async onSaved(recipe) {
    savedRecipes.push(recipe);
    throw new Error('Optional saved observer failure');
  },
  async onAuthorizationLost() {
    authorizationLosses += 1;
    throw new Error('Optional authorization observer failure');
  },
});

assert.equal(editor.setAuthorization(true, USER_A), true);
assert.equal(await editor.openCreate(), true);
assert.equal(elements.panel.hidden, false);
assert.equal(elements.title.textContent, 'Create recipe draft');
assert.equal(elements.name.focused, true);
assert.equal(elements.ingredients.children.length, 1);
assert.equal(elements.categoryId.children[2].textContent, 'Archived (inactive)');

assert.equal(await editor.submitDraft(), false, 'Empty form must fail local validation');
assert.equal(elements.name.attributes['aria-invalid'], 'true');
assert.match(elements.status.textContent, /correct/i);
assert.equal(calls.some((call) => call[0] === 'createDraft'), false);

elements.addIngredient.emit('click');
assert.equal(elements.ingredients.children.length, 2);
const secondIngredient = elements.ingredients.children[1];
secondIngredient.children[2].emit('click');
assert.equal(elements.ingredients.children.length, 1);

fillValid(elements);
elements.name.emit('input');
assert.equal(editor.isDirty(), true);
assert.equal(await editor.submitDraft(), true);
assert.equal(editor.isDirty(), false);
const createCall = calls.find((call) => call[0] === 'createDraft');
assert.deepEqual(createCall[2], { recipeId: RECIPE_ID, creatorUserId: USER_A });
assert.match(elements.status.textContent, /offline test environment/i);
assert.equal(savedRecipes.length, 1, 'Confirmed create must notify saved observers once');

assert.equal(await editor.openEdit(RECIPE_ID), true);
assert.equal(elements.title.textContent, 'Edit recipe draft');
assert.equal(elements.name.value, 'Existing Draft');
elements.name.value = 'Updated Draft';
elements.name.emit('input');
assert.equal(await editor.submitDraft(), true);
const editCall = calls.find((call) => call[0] === 'editDraft');
assert.deepEqual(editCall[2], {
  recipeId: RECIPE_ID,
  creatorUserId: USER_A,
  expectedUpdatedAt: UPDATED_AT,
});
assert.equal(savedRecipes.length, 2, 'Confirmed edit must notify saved observers once');

elements.name.emit('input');
allowDiscard = false;
assert.equal(editor.cancel(), false, 'Unsaved changes must remain when discard is declined');
assert.equal(elements.panel.hidden, false);
assert.equal(elements.name.value, 'Updated Draft', 'Declining discard must preserve unsaved field values');
allowDiscard = true;
assert.equal(editor.cancel(), true);
assert.equal(elements.panel.hidden, true);
assertEditorDataCleared(elements, 'Ordinary cancel');

loadedRecipe = detail({ name: 'Account A Private Draft' });
assert.equal(await editor.openEdit(RECIPE_ID), true);
const accountAIngredient = elements.ingredients.children[0];
const accountANameInput = accountAIngredient.children[0].children[1];
const accountAMeasurementInput = accountAIngredient.children[1].children[1];
const accountARemoveButton = accountAIngredient.children[2];
assert.equal(accountANameInput.listenerCount(), 1);
assert.equal(accountAMeasurementInput.listenerCount(), 1);
assert.equal(accountARemoveButton.listenerCount(), 1);
assert.equal(editor.setAuthorization(false), true);
assertEditorDataCleared(elements, 'Logout');
assert.equal(accountANameInput.listenerCount(), 0, 'Logout must detach old ingredient listeners');
assert.equal(accountAMeasurementInput.listenerCount(), 0, 'Logout must release measurement listeners');
assert.equal(accountARemoveButton.listenerCount(), 0, 'Logout must release remove-button listeners');

assert.equal(editor.setAuthorization(true, USER_A), true);
assert.equal(await editor.openCreate(), true);
assert.equal(elements.ingredients.children.length, 1, 'Create must reconstruct one initial ingredient row');
assert.equal(elements.ingredients.children[0].children[0].children[1].value, '');

loadedRecipe = detail({ name: 'Account A Switching Draft' });
assert.equal(await editor.openEdit(RECIPE_ID), true);
assert.equal(elements.name.value, 'Account A Switching Draft');
assert.equal(editor.setAuthorization(true, '22222222-2222-4222-8222-222222222222'), true);
assertEditorDataCleared(elements, 'Account switch');
loadedRecipe = detail({ name: 'Account B Private Draft', description: 'Only Account B data.' });
assert.equal(await editor.openEdit(RECIPE_ID), true);
assert.equal(elements.name.value, 'Account B Private Draft');
assert.equal(elements.description.value, 'Only Account B data.');
assert.doesNotMatch(elements.name.value, /Account A/);

assert.equal(await editor.openCreate(), true);
fillValid(elements, 'Denied Draft');
createStatus = 'denied';
assert.equal(await editor.submitDraft(), false);
assertEditorDataCleared(elements, 'Authorization denial');
assert.equal(await editor.openCreate(), false, 'Authorization denial must fail closed for later editor actions');
assert.equal(authorizationLosses, 1, 'Explicit denial must notify authorization-loss observers');
assert.equal(editor.setAuthorization(false), true);
assert.equal(elements.panel.hidden, true, 'Coordinator denial must hide an already invalidated editor');

for (const nonDenial of ['conflict', 'stale', 'uncertain', 'throw']) {
  assert.equal(editor.setAuthorization(true, USER_A), true);
  allowDiscard = true;
  assert.equal(await editor.openCreate(), true);
  fillValid(elements, `${nonDenial} Draft`);
  createStatus = nonDenial;
  assert.equal(await editor.submitDraft(), false);
  assert.equal(authorizationLosses, 1, `${nonDenial} must not report authorization loss`);
  assert.equal(savedRecipes.length, 2, `${nonDenial} must not report a confirmed save`);
}

let pending = deferred();
let pendingMutationCalls = 0;
let pendingSaveNotifications = 0;
const pendingElements = editorElements();
const pendingEditor = createAdminRecipeEditor({
  elements: pendingElements,
  documentLike: { createElement: element },
  windowLike: element(),
  recipeSource: { async getById() { return { data: detail(), error: null }; } },
  mutationService: {
    createDraft() { pendingMutationCalls += 1; return pending.promise; },
    async editDraft() { return { status: 'stale' }; },
    invalidate() { return true; },
    cleanup() { return true; },
  },
  taxonomySource: {
    async listCategories() { return { data: [{ id: 1, name: 'Dinner', isActive: true }], error: null }; },
    async listCuisines() { return { data: [{ id: 2, name: 'Filipino', isActive: true }], error: null }; },
    invalidate() { return true; },
    cleanup() { return true; },
  },
  createRecipeId: () => RECIPE_ID,
  onSaved() { pendingSaveNotifications += 1; },
});
pendingEditor.setAuthorization(true, USER_A);
await pendingEditor.openCreate();
fillValid(pendingElements);
const firstSubmit = pendingEditor.submitDraft();
assert.equal(pendingEditor.isPending(), true);
assert.equal(await pendingEditor.submitDraft(), false, 'Duplicate pending submission must be suppressed');
pendingEditor.setAuthorization(false);
assert.equal(pendingElements.panel.hidden, true);
assertEditorDataCleared(pendingElements, 'Pending logout');
pending.resolve({ status: 'success', data: { id: RECIPE_ID, updatedAt: UPDATED_AT }, error: null });
assert.equal(await firstSubmit, false, 'Late write result must not update a retired authorization context');
assertEditorDataCleared(pendingElements, 'Late result after logout');
assert.equal(pendingSaveNotifications, 0, 'Logout during save must suppress refresh notifications');

pending = deferred();
pendingEditor.setAuthorization(true, USER_A);
await pendingEditor.openCreate();
fillValid(pendingElements, 'Account A Draft');
const accountASubmit = pendingEditor.submitDraft();
pendingEditor.setAuthorization(true, '22222222-2222-4222-8222-222222222222');
assertEditorDataCleared(pendingElements, 'Pending account switch');
pending.resolve({ status: 'success', data: { id: RECIPE_ID, updatedAt: UPDATED_AT }, error: null });
assert.equal(await accountASubmit, false, 'Account A late save must not notify Account B');
assertEditorDataCleared(pendingElements, 'Late Account A result');
assert.equal(pendingSaveNotifications, 0);

pending = deferred();
await pendingEditor.openCreate();
fillValid(pendingElements, 'Duplicate Draft');
const mutationCallsBeforeDuplicate = pendingMutationCalls;
const duplicateSubmitA = pendingEditor.submitDraft();
assert.equal(await pendingEditor.submitDraft(), false, 'Duplicate editor submission must be rejected locally');
assert.equal(pendingMutationCalls, mutationCallsBeforeDuplicate + 1);
pending.resolve({ status: 'success', data: { id: RECIPE_ID, updatedAt: UPDATED_AT }, error: null });
assert.equal(await duplicateSubmitA, true);
assert.equal(pendingSaveNotifications, 1, 'One confirmed mutation must produce one refresh notification');

loadedRecipe = detail({ name: 'Cleanup Private Draft' });
editor.setAuthorization(true, USER_A);
assert.equal(await editor.openEdit(RECIPE_ID), true);
assert.equal(elements.name.value, 'Cleanup Private Draft');
const cleanupIngredientName = elements.ingredients.children[0].children[0].children[1];
assert.equal(cleanupIngredientName.listenerCount(), 1);
assert.equal(editor.cleanup(), true);
assertEditorDataCleared(elements, 'Editor cleanup');
assert.equal(cleanupIngredientName.listenerCount(), 0, 'Cleanup must release ingredient listeners');
assert.equal(editor.cleanup(), false);
assert.equal(calls.some((call) => call[0] === 'mutationCleanup'), true);
assert.equal(calls.some((call) => call[0] === 'taxonomyCleanup'), true);

const source = await readFile(new URL('../js/admin-recipe-editor.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write|createClient|service_role/i);
assert.doesNotMatch(source, /supabase-admin-recipe-mutations|supabase-admin-taxonomies/);

console.log('Offline Admin recipe editor tests passed with injected fakes only.');
