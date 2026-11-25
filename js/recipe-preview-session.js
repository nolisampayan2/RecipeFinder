import { createRecipePreviewCatalog } from './recipe-preview-catalog.js';
import { adaptDashboardPreviewCatalogResult } from './dashboard-preview-catalog-adapter.js';
import { createRecipeDetailAccessController, RECIPE_DETAIL_RESULT } from './recipe-detail-access-controller.js';

const UNAVAILABLE = Object.freeze({ code: 'UNAVAILABLE', message: 'Recipe previews are unavailable.' });
const STALE = Object.freeze({ code: 'STALE', message: 'Recipe preview request was canceled.' });
const DETAIL_UNAVAILABLE = Object.freeze({ code: 'DETAIL_UNAVAILABLE', message: 'Recipe details are unavailable.' });
const NO_DETAIL = Object.freeze({ status: RECIPE_DETAIL_RESULT.UNAVAILABLE, data: null, error: DETAIL_UNAVAILABLE, stale: false });

/**
 * Inactive Option B boundary. Callers inject the RPC-only preview source, the
 * authenticated detail service, and a login dialog. This module imports no
 * public full-detail source and never falls back to one.
 *
 * The active dashboard must not use this until database grants, RLS, the RPC,
 * the detail seed, and a detail-free public build are verified together.
 */
export function createRecipePreviewSession({
  builtInPreviews, fictionalPreviews, previewSource, detailService, loginGate, clearProtectedDetail,
}) {
  const previewCatalog = createRecipePreviewCatalog({
    builtInPreviews,
    fictionalPreviews,
    previewSource,
  });
  const detailAccess = createRecipeDetailAccessController({
    loginGate, detailService, clearProtectedDetail,
  });
  let catalog = null;
  let databasePage = null;
  let generation = 0;
  let retired = false;

  function clearPreviewPage() {
    catalog = null;
    databasePage = null;
  }

  async function load(options = {}) {
    if (retired) return Object.freeze({ catalog: null, databasePage: null, error: STALE, stale: true, partial: false });
    const requestGeneration = ++generation;
    clearPreviewPage();
    let adapted;
    try {
      adapted = adaptDashboardPreviewCatalogResult(await previewCatalog.list(options));
    } catch {
      adapted = null;
    }
    if (retired || requestGeneration !== generation) {
      return Object.freeze({ catalog: null, databasePage: null, error: STALE, stale: true, partial: false });
    }
    if (!adapted || adapted.stale || !adapted.catalog) {
      return Object.freeze({ catalog: null, databasePage: null, error: UNAVAILABLE, stale: false, partial: false });
    }
    catalog = adapted.catalog;
    databasePage = adapted.databasePage;
    return adapted;
  }

  function handleAuthState(authState) {
    if (retired) return false;
    return detailAccess.handleAuthState(authState);
  }

  function filter(search = '', categoryOrCuisine = '') {
    return catalog?.filter(search, categoryOrCuisine) ?? Object.freeze([]);
  }

  function resolveFavoriteIds(ids) {
    if (!catalog) return Object.freeze([]);
    return catalog.resolveFavoriteIds(ids);
  }

  function random(index) {
    const recipes = catalog?.list() ?? [];
    return Number.isSafeInteger(index) && index >= 0 && index < recipes.length ? recipes[index] : null;
  }

  function requestRecipeFinderDetail(id, trigger = null) {
    if (retired) return Promise.resolve(NO_DETAIL);
    const recipe = catalog?.getById(id);
    return recipe ? detailAccess.requestDetail({ recipe, trigger }) : Promise.resolve(NO_DETAIL);
  }

  function requestRecipeFinderPreviewDetail(recipe, trigger = null) {
    if (retired) return Promise.resolve(NO_DETAIL);
    try {
      if (!recipe || !['built-in', 'database', 'external'].includes(recipe.source)) {
        return Promise.resolve(NO_DETAIL);
      }
      return detailAccess.requestDetail({ recipe, trigger });
    } catch {
      return Promise.resolve(NO_DETAIL);
    }
  }

  function requestPublicMealDbDetail(recipe, trigger = null) {
    if (retired) return Promise.resolve(NO_DETAIL);
    // The controller accepts only validated public TheMealDB full-detail values.
    return detailAccess.requestDetail({ recipe, trigger });
  }

  function invalidate() {
    if (retired) return false;
    generation += 1;
    clearPreviewPage();
    detailAccess.invalidate();
    try { previewSource?.invalidate?.(); } catch { /* Preview transport cleanup is best effort. */ }
    return true;
  }

  function dismissDetail() {
    if (retired) return false;
    return detailAccess.invalidate();
  }

  function cleanup() {
    if (retired) return false;
    retired = true;
    generation += 1;
    clearPreviewPage();
    detailAccess.cleanup();
    try { previewSource?.cleanup?.(); } catch { /* Terminal transport cleanup stays private. */ }
    return true;
  }

  return Object.freeze({
    load, handleAuthState, filter, resolveFavoriteIds, random,
    requestRecipeFinderDetail, requestRecipeFinderPreviewDetail, requestPublicMealDbDetail,
    dismissDetail, invalidate, cleanup,
    getCatalog: () => catalog,
    getDatabasePage: () => databasePage,
  });
}
