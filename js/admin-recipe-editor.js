import {
  ADMIN_RECIPE_STATUS,
  AdminRecipeValidationError,
  normalizeAdminRecipeInput,
} from './admin-recipe-validation.js';

const MUTATION_SUCCESS = 'success';
const REQUIRED_FIELDS = Object.freeze([
  'name', 'description', 'categoryId', 'cuisineId', 'imageUrl',
  'fallbackImageUrl', 'tutorialUrl', 'instructions',
]);

const FIXED_MESSAGES = Object.freeze({
  conflict: 'This draft changed elsewhere. Close the editor and reload it before saving again.',
  denied: 'Your administrator access is no longer valid.',
  stale: 'This editor session is no longer current.',
  uncertain: 'The save outcome is uncertain. Reload the recipe before trying again.',
  unavailable: 'The recipe editor is temporarily unavailable.',
});

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireDependencies(recipeSource, mutationService, taxonomySource) {
  if (
    typeof recipeSource?.getById !== 'function'
    || typeof mutationService?.createDraft !== 'function'
    || typeof mutationService?.editDraft !== 'function'
    || typeof taxonomySource?.listCategories !== 'function'
    || typeof taxonomySource?.listCuisines !== 'function'
  ) throw new TypeError('Admin recipe editor dependencies are required.');
}

function requireElements(elements) {
  const required = [
    'panel', 'form', 'title', 'status', 'close', 'cancel', 'save', 'addIngredient',
    'ingredients', ...REQUIRED_FIELDS,
  ];
  if (!isRecord(elements) || required.some((key) => !elements[key])) {
    throw new TypeError('Admin recipe editor elements are required.');
  }
  if (!isRecord(elements.errors) || !elements.errors.ingredients) {
    throw new TypeError('Admin recipe editor error elements are required.');
  }
}

function fixedRecipeId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (typeof uuid !== 'string') throw new TypeError('A secure recipe identifier generator is required.');
  return `cms:${uuid.toLowerCase()}`;
}

function textValue(value) {
  return typeof value === 'string' ? value : '';
}

export function createAdminRecipeEditor({
  elements,
  documentLike = globalThis.document,
  windowLike = globalThis,
  recipeSource,
  mutationService,
  taxonomySource,
  createRecipeId = fixedRecipeId,
  confirmDiscard = (message) => globalThis.confirm?.(message) === true,
  onSaved = () => {},
  onAuthorizationLost = () => {},
} = {}) {
  requireElements(elements);
  requireDependencies(recipeSource, mutationService, taxonomySource);
  if (typeof documentLike?.createElement !== 'function' || typeof createRecipeId !== 'function') {
    throw new TypeError('Admin recipe editor environment is required.');
  }

  let authorizedUserId = null;
  let mode = null;
  let recipeId = null;
  let expectedUpdatedAt = null;
  let dirty = false;
  let pending = false;
  let retired = false;
  let generation = 0;
  let ingredientRows = [];
  const listeners = new Set();

  const listen = (target, type, listener) => {
    target.addEventListener(type, listener);
    let active = true;
    const remove = () => {
      if (!active) return false;
      active = false;
      try { target.removeEventListener(type, listener); } catch { /* Listener cleanup stays isolated. */ }
      listeners.delete(remove);
      return true;
    };
    listeners.add(remove);
    return remove;
  };

  const notify = (callback, value) => {
    try {
      Promise.resolve(typeof callback === 'function' ? callback(value) : undefined).catch(() => {});
    } catch {
      // Integration observers cannot change a confirmed editor outcome.
    }
  };

  const announce = (message = '', type = '') => {
    elements.status.textContent = message;
    elements.status.classList.toggle('is-error', type === 'error');
    elements.status.classList.toggle('is-success', type === 'success');
  };

  const setBusy = (value) => {
    pending = value;
    elements.panel.setAttribute('aria-busy', String(value));
    elements.save.disabled = value;
    elements.cancel.disabled = value;
    elements.close.disabled = value;
    elements.addIngredient.disabled = value;
    for (const row of ingredientRows) row.remove.disabled = value;
  };

  const clearErrors = () => {
    for (const element of Object.values(elements.errors)) element.textContent = '';
    for (const field of REQUIRED_FIELDS) elements[field].setAttribute('aria-invalid', 'false');
  };

  const showError = (field, message) => {
    const target = field === 'ingredients' ? elements.ingredients : elements[field];
    const error = elements.errors[field] ?? elements.errors.form;
    if (error) error.textContent = message;
    target?.setAttribute?.('aria-invalid', 'true');
    target?.focus?.();
  };

  const markDirty = () => { if (mode && !pending) dirty = true; };

  const createIngredientRow = (ingredient = { name: '', measurement: '' }) => {
    const wrapper = documentLike.createElement('div');
    wrapper.className = 'ingredient-row';
    const nameLabel = documentLike.createElement('label');
    nameLabel.className = 'admin-field';
    const nameCaption = documentLike.createElement('span');
    nameCaption.textContent = 'Ingredient';
    const name = documentLike.createElement('input');
    name.type = 'text';
    name.value = textValue(ingredient.name);
    name.autocomplete = 'off';
    name.setAttribute('aria-label', 'Ingredient name');
    nameLabel.append(nameCaption, name);
    const measurementLabel = documentLike.createElement('label');
    measurementLabel.className = 'admin-field';
    const measurementCaption = documentLike.createElement('span');
    measurementCaption.textContent = 'Measurement';
    const measurement = documentLike.createElement('input');
    measurement.type = 'text';
    measurement.value = textValue(ingredient.measurement);
    measurement.autocomplete = 'off';
    measurement.setAttribute('aria-label', 'Ingredient measurement');
    measurementLabel.append(measurementCaption, measurement);
    const remove = documentLike.createElement('button');
    remove.type = 'button';
    remove.className = 'admin-row-action';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ingredient');
    const removeListeners = [
      listen(name, 'input', markDirty),
      listen(measurement, 'input', markDirty),
    ];
    removeListeners.push(listen(remove, 'click', () => {
      if (pending || ingredientRows.length <= 1) return;
      ingredientRows = ingredientRows.filter((candidate) => candidate !== row);
      row.dispose();
      wrapper.remove();
      markDirty();
      ingredientRows.at(-1)?.name.focus?.();
    }));
    const row = {
      wrapper,
      name,
      measurement,
      remove,
      dispose() {
        for (const removeListener of removeListeners.splice(0)) removeListener();
      },
    };
    wrapper.append(nameLabel, measurementLabel, remove);
    elements.ingredients.append(wrapper);
    ingredientRows.push(row);
    return row;
  };

  const clearIngredientRows = () => {
    for (const row of ingredientRows) row.dispose();
    ingredientRows = [];
    elements.ingredients.replaceChildren();
  };

  const replaceIngredients = (ingredients = [{ name: '', measurement: '' }]) => {
    clearIngredientRows();
    for (const ingredient of ingredients.length ? ingredients : [{ name: '', measurement: '' }]) {
      createIngredientRow(ingredient);
    }
  };

  const populateTaxonomy = (select, values, label) => {
    const placeholder = documentLike.createElement('option');
    placeholder.value = '';
    placeholder.textContent = `Select ${label}`;
    select.replaceChildren(placeholder);
    for (const item of values) {
      const option = documentLike.createElement('option');
      option.value = String(item.id);
      option.textContent = item.isActive ? item.name : `${item.name} (inactive)`;
      select.append(option);
    }
  };

  const loadTaxonomies = async (requestGeneration) => {
    const [categories, cuisines] = await Promise.all([
      taxonomySource.listCategories(),
      taxonomySource.listCuisines(),
    ]);
    if (retired || requestGeneration !== generation || !authorizedUserId) return false;
    if (categories?.error !== null || cuisines?.error !== null || !Array.isArray(categories?.data) || !Array.isArray(cuisines?.data)) {
      return false;
    }
    populateTaxonomy(elements.categoryId, categories.data, 'category');
    populateTaxonomy(elements.cuisineId, cuisines.data, 'cuisine');
    return true;
  };

  const assignRecipe = (recipe = null) => {
    elements.name.value = textValue(recipe?.name);
    elements.description.value = textValue(recipe?.description);
    elements.categoryId.value = recipe?.categoryId ? String(recipe.categoryId) : '';
    elements.cuisineId.value = recipe?.cuisineId ? String(recipe.cuisineId) : '';
    elements.imageUrl.value = textValue(recipe?.imageUrl);
    elements.fallbackImageUrl.value = textValue(recipe?.fallbackImageUrl);
    elements.tutorialUrl.value = textValue(recipe?.tutorialUrl);
    elements.instructions.value = textValue(recipe?.instructions);
    replaceIngredients(recipe?.ingredients);
  };

  const clearFormData = () => {
    for (const field of [
      elements.name,
      elements.description,
      elements.categoryId,
      elements.cuisineId,
      elements.imageUrl,
      elements.fallbackImageUrl,
      elements.tutorialUrl,
      elements.instructions,
    ]) field.value = '';
    elements.categoryId.replaceChildren();
    elements.cuisineId.replaceChildren();
    clearIngredientRows();
    clearErrors();
    announce();
  };

  const hide = () => {
    mode = null;
    recipeId = null;
    expectedUpdatedAt = null;
    dirty = false;
    clearFormData();
    elements.panel.hidden = true;
  };

  const mayDiscard = () => !dirty || confirmDiscard('Discard your unsaved recipe changes?');

  const collectInput = () => ({
    name: elements.name.value,
    description: elements.description.value,
    categoryId: Number(elements.categoryId.value),
    cuisineId: Number(elements.cuisineId.value),
    imageUrl: elements.imageUrl.value,
    fallbackImageUrl: elements.fallbackImageUrl.value || null,
    tutorialUrl: elements.tutorialUrl.value || null,
    ingredients: ingredientRows.map((row) => ({ name: row.name.value, measurement: row.measurement.value })),
    instructions: elements.instructions.value,
  });

  const begin = async (nextMode, id = null) => {
    if (retired || !authorizedUserId || pending || !mayDiscard()) return false;
    const requestGeneration = ++generation;
    setBusy(true);
    clearErrors();
    announce('Loading draft editor.');
    elements.panel.hidden = false;
    let recipe = null;
    try {
      const taxonomyReady = await loadTaxonomies(requestGeneration);
      if (!taxonomyReady) throw new TypeError('Taxonomies unavailable.');
      if (nextMode === 'edit') {
        const result = await recipeSource.getById(id);
        if (retired || requestGeneration !== generation || !authorizedUserId) return false;
        if (result?.error !== null || !isRecord(result?.data)) throw new TypeError('Recipe unavailable.');
        recipe = result.data;
        if (recipe.status !== ADMIN_RECIPE_STATUS.DRAFT || recipe.sourceType !== 'cms') {
          throw new TypeError('Only CMS drafts can be edited.');
        }
        recipeId = recipe.id;
        expectedUpdatedAt = recipe.updatedAt;
      } else {
        recipeId = createRecipeId();
        expectedUpdatedAt = null;
      }
      mode = nextMode;
      assignRecipe(recipe);
      elements.title.textContent = nextMode === 'create' ? 'Create recipe draft' : 'Edit recipe draft';
      dirty = false;
      announce(nextMode === 'create' ? 'New draft ready.' : 'Draft loaded.');
      elements.name.focus?.();
      return true;
    } catch {
      hide();
      announce(FIXED_MESSAGES.unavailable, 'error');
      return false;
    } finally {
      if (!retired && requestGeneration === generation) setBusy(false);
    }
  };

  const submit = async (event) => {
    event?.preventDefault?.();
    if (retired || !authorizedUserId || !mode || pending) return false;
    clearErrors();
    const input = collectInput();
    try {
      normalizeAdminRecipeInput(input, {
        recipeId,
        creatorUserId: authorizedUserId,
        status: ADMIN_RECIPE_STATUS.DRAFT,
        publishedAt: null,
      });
    } catch (error) {
      const field = error instanceof AdminRecipeValidationError ? error.field : null;
      showError(field, 'Check this field and try again.');
      announce('Please correct the highlighted recipe fields.', 'error');
      return false;
    }
    const requestGeneration = generation;
    const requestUserId = authorizedUserId;
    setBusy(true);
    announce('Saving draft.');
    let result;
    try {
      result = mode === 'create'
        ? await mutationService.createDraft(input, { recipeId, creatorUserId: requestUserId })
        : await mutationService.editDraft(input, {
          recipeId,
          creatorUserId: requestUserId,
          expectedUpdatedAt,
        });
    } catch {
      result = { status: 'uncertain' };
    }
    if (retired || requestGeneration !== generation || authorizedUserId !== requestUserId) return false;
    setBusy(false);
    if (result?.status !== MUTATION_SUCCESS || !isRecord(result.data)) {
      announce(FIXED_MESSAGES[result?.status] ?? FIXED_MESSAGES.unavailable, 'error');
      if (result?.status === 'denied') {
        authorizedUserId = null;
        generation += 1;
        try { mutationService.invalidate?.(); } catch { /* Lost authorization fails closed. */ }
        try { taxonomySource.invalidate?.(); } catch { /* Lost authorization hides stale taxonomies. */ }
        hide();
        notify(onAuthorizationLost);
      }
      return false;
    }
    mode = 'edit';
    expectedUpdatedAt = result.data.updatedAt;
    dirty = false;
    announce('Draft saved in the injected offline test environment.', 'success');
    notify(onSaved, result.data);
    return true;
  };

  const cancel = () => {
    if (retired || pending || !mode || !mayDiscard()) return false;
    hide();
    return true;
  };

  for (const field of REQUIRED_FIELDS) {
    listen(elements[field], field === 'categoryId' || field === 'cuisineId' ? 'change' : 'input', markDirty);
  }
  listen(elements.form, 'submit', submit);
  listen(elements.addIngredient, 'click', () => {
    if (!mode || pending) return;
    const row = createIngredientRow();
    markDirty();
    row.name.focus?.();
  });
  listen(elements.cancel, 'click', cancel);
  listen(elements.close, 'click', cancel);
  const onBeforeUnload = (event) => {
    if (!dirty) return;
    event.preventDefault?.();
    event.returnValue = '';
  };
  windowLike?.addEventListener?.('beforeunload', onBeforeUnload);

  elements.panel.hidden = true;

  return Object.freeze({
    openCreate() { return begin('create'); },
    openEdit(id) { return begin('edit', id); },
    submitDraft() { return submit({ preventDefault() {} }); },
    cancel,
    isDirty() { return dirty; },
    isPending() { return pending; },
    setAuthorization(authorized, userId = null) {
      if (retired) return false;
      const nextUserId = authorized && typeof userId === 'string' ? userId : null;
      if (nextUserId === authorizedUserId) {
        if (nextUserId === null && (mode || pending)) {
          generation += 1;
          setBusy(false);
          hide();
        }
        return true;
      }
      generation += 1;
      authorizedUserId = nextUserId;
      try { mutationService.invalidate?.(); } catch { /* Stale writes fail closed locally. */ }
      try { taxonomySource.invalidate?.(); } catch { /* Stale taxonomy results stay hidden. */ }
      setBusy(false);
      hide();
      return true;
    },
    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      authorizedUserId = null;
      setBusy(false);
      hide();
      for (const remove of [...listeners]) {
        try { remove(); } catch { /* DOM cleanup stays isolated. */ }
      }
      try { windowLike?.removeEventListener?.('beforeunload', onBeforeUnload); } catch { /* Cleanup stays isolated. */ }
      try { mutationService.cleanup?.(); } catch { /* Provider cleanup stays isolated. */ }
      try { taxonomySource.cleanup?.(); } catch { /* Provider cleanup stays isolated. */ }
      return true;
    },
  });
}
