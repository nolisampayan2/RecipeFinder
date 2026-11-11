import { isValidAccountUserId } from './supabase-favorites.js';

export const RECIPE_DETAIL_ACCESS = Object.freeze({
  PUBLIC_EXTERNAL_DETAIL: 'PUBLIC_EXTERNAL_DETAIL',
  REQUIRES_LOGIN: 'REQUIRES_LOGIN',
  AUTHENTICATED_RECIPEFINDER_DETAIL: 'AUTHENTICATED_RECIPEFINDER_DETAIL',
  DENIED: 'DENIED',
  PENDING_AUTH: 'PENDING_AUTH',
});

const LOCAL_RECIPE_ID = /^[a-z0-9][a-z0-9_-]{0,199}$/;
const THEMEALDB_ID = /^external:themealdb:(\d+)$/;
const FICTIONAL_ID = /^external:fictional-offline:(\d+)$/;

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeSnapshot(recipe) {
  try {
    if (!isRecord(recipe)) return null;
    return {
      id: recipe.id,
      source: recipe.source,
      detailLevel: recipe.detailLevel,
      externalProvider: recipe.externalProvider,
      externalId: recipe.externalId,
    };
  } catch {
    return null;
  }
}

function isPublicMealDbDetail(recipe) {
  const match = typeof recipe.id === 'string' ? THEMEALDB_ID.exec(recipe.id) : null;
  return Boolean(match
    && recipe.source === 'external'
    && recipe.externalProvider === 'themealdb'
    && recipe.externalId === match[1]
    && recipe.detailLevel === 'full');
}

function isRecipeFinderPreview(recipe) {
  if (recipe.source === 'built-in') {
    return typeof recipe.id === 'string'
      && LOCAL_RECIPE_ID.test(recipe.id)
      && recipe.detailLevel === 'preview'
      && recipe.externalProvider === undefined
      && recipe.externalId === undefined;
  }

  if (recipe.source === 'database') {
    return typeof recipe.id === 'string'
      && LOCAL_RECIPE_ID.test(recipe.id)
      && recipe.detailLevel === 'preview'
      && (recipe.externalProvider === undefined || recipe.externalProvider === null)
      && (recipe.externalId === undefined || recipe.externalId === null);
  }

  if (recipe.source === 'external') {
    const match = typeof recipe.id === 'string' ? FICTIONAL_ID.exec(recipe.id) : null;
    return Boolean(match
      && recipe.externalProvider === 'fictional-offline'
      && recipe.externalId === match[1]
      && recipe.detailLevel === 'summary');
  }

  return false;
}

function authDecision(authState) {
  try {
    if (!isRecord(authState)) return RECIPE_DETAIL_ACCESS.DENIED;
    const status = authState.status;
    if (typeof status !== 'string') return RECIPE_DETAIL_ACCESS.DENIED;
    if (status === 'loading' || status === 'pending-confirmation') {
      return RECIPE_DETAIL_ACCESS.PENDING_AUTH;
    }
    if (status === 'guest') return RECIPE_DETAIL_ACCESS.REQUIRES_LOGIN;
    if (status !== 'authenticated') return RECIPE_DETAIL_ACCESS.DENIED;
    const userId = authState.userId;
    return isValidAccountUserId(userId)
      ? RECIPE_DETAIL_ACCESS.AUTHENTICATED_RECIPEFINDER_DETAIL
      : RECIPE_DETAIL_ACCESS.DENIED;
  } catch {
    return RECIPE_DETAIL_ACCESS.DENIED;
  }
}

export function classifyRecipeDetailAccess(recipe, authState) {
  const snapshot = safeSnapshot(recipe);
  if (!snapshot) return RECIPE_DETAIL_ACCESS.DENIED;
  if (isPublicMealDbDetail(snapshot)) return RECIPE_DETAIL_ACCESS.PUBLIC_EXTERNAL_DETAIL;
  if (!isRecipeFinderPreview(snapshot)) return RECIPE_DETAIL_ACCESS.DENIED;
  return authDecision(authState);
}

function requireDependencies(options) {
  if (!isRecord(options)) throw new TypeError('Guest login gate dependencies are required.');
  const { documentLike, present, dismiss } = options;
  if (!documentLike || typeof documentLike.createElement !== 'function'
    || typeof present !== 'function' || typeof dismiss !== 'function') {
    throw new TypeError('Guest login gate dependencies are invalid.');
  }
  return { documentLike, present, dismiss };
}

function safeRecipeTitle(recipe) {
  try {
    const value = recipe.name;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'this recipe';
  } catch {
    return 'this recipe';
  }
}

export function createRecipeLoginGate(options) {
  const { documentLike, present, dismiss } = requireDependencies(options);
  let active = null;
  let retired = false;

  function removeContinueListener(current) {
    try {
      current.continueButton.removeEventListener('click', current.onContinue);
    } catch {
      // A presentation adapter cannot keep this component logically active.
    }
  }

  function close(closeOptions = {}) {
    let restoreFocus;
    try {
      if (!isRecord(closeOptions)) return false;
      const requestedRestoreFocus = closeOptions.restoreFocus;
      restoreFocus = requestedRestoreFocus === undefined ? true : requestedRestoreFocus;
    } catch {
      return false;
    }
    if (!active) return false;
    const current = active;
    active = null;
    removeContinueListener(current);
    try {
      dismiss({ restoreFocus: restoreFocus === true, trigger: current.trigger });
      return true;
    } catch {
      return false;
    }
  }

  function open(openOptions = {}) {
    if (retired || active) return false;
    let recipe;
    let trigger;
    try {
      if (!isRecord(openOptions)) return false;
      recipe = openOptions.recipe;
      trigger = openOptions.trigger;
    } catch {
      return false;
    }
    if (classifyRecipeDetailAccess(recipe, { status: 'guest' }) !== RECIPE_DETAIL_ACCESS.REQUIRES_LOGIN) {
      return false;
    }

    let continueButton = null;
    let onContinue = null;
    try {
      const content = documentLike.createElement('section');
      const heading = documentLike.createElement('h2');
      const explanation = documentLike.createElement('p');
      const actions = documentLike.createElement('div');
      const loginLink = documentLike.createElement('a');
      const registerLink = documentLike.createElement('a');
      continueButton = documentLike.createElement('button');

      heading.textContent = 'Log in to view this recipe';
      explanation.textContent = `Log in or create an account to view the full details for ${safeRecipeTitle(recipe)}.`;
      loginLink.textContent = 'Log In';
      loginLink.setAttribute('href', 'login.html');
      registerLink.textContent = 'Create Account';
      registerLink.setAttribute('href', 'register.html');
      continueButton.textContent = 'Continue Browsing';
      continueButton.setAttribute('type', 'button');

      actions.append(loginLink, registerLink, continueButton);
      content.append(heading, explanation, actions);

      onContinue = () => close({ restoreFocus: true });
      continueButton.addEventListener('click', onContinue);
      active = { continueButton, onContinue, trigger };

      present({
        content,
        heading,
        initialFocus: loginLink,
        trigger,
        closeLabel: 'Close login required dialog',
      });
      return !retired && active?.continueButton === continueButton;
    } catch {
      active = null;
      if (continueButton && onContinue) removeContinueListener({ continueButton, onContinue });
      return false;
    }
  }

  function cleanup() {
    if (retired) return;
    retired = true;
    close({ restoreFocus: false });
  }

  return Object.freeze({ open, close, cleanup });
}
