const SENSITIVE_QUERY_KEYS = new Set(['code', 'token_hash']);
const PROVIDER_ERROR_KEYS = new Set(['error', 'error_code', 'error_description']);
const TOKEN_FRAGMENT_KEYS = new Set(['access_token', 'refresh_token']);
const SUPPORTED_FRAGMENT_KEYS = new Set([...PROVIDER_ERROR_KEYS, ...TOKEN_FRAGMENT_KEYS]);

export const CONFIRMATION_STATUS = Object.freeze({
  CONFIRMED: 'confirmed',
  UNAVAILABLE: 'unavailable',
});

export const CONFIRMATION_MESSAGES = Object.freeze({
  CONFIRMED: 'Email confirmation completed. Return to sign in to continue.',
  UNAVAILABLE: 'This confirmation link could not be processed. Return to sign in or registration to continue.',
});

function hasKey(params, keys) {
  return [...keys].some((key) => params.has(key));
}

function hasDuplicate(params, keys) {
  return [...keys].some((key) => params.getAll(key).length > 1);
}

function hasNonEmptyValue(params, key) {
  return params.getAll(key).length === 1 && Boolean(params.get(key)?.trim());
}

export function classifyAuthCallback(input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(input, 'http://localhost/RecipeFinder/auth-callback.html');
  } catch {
    return Object.freeze({ kind: 'invalid' });
  }

  const query = url.searchParams;
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const hasCode = query.has('code');
  const hasTokenHash = query.has('token_hash');
  const hasProviderError = hasKey(query, PROVIDER_ERROR_KEYS) || hasKey(fragment, PROVIDER_ERROR_KEYS);
  const hasTokenFragment = hasKey(fragment, TOKEN_FRAGMENT_KEYS);
  const hasUnsupportedFragment = [...fragment.keys()].some((key) => !SUPPORTED_FRAGMENT_KEYS.has(key));
  const detectedKinds = [hasCode, hasTokenHash, hasProviderError, hasTokenFragment].filter(Boolean).length;

  if (
    hasUnsupportedFragment ||
    detectedKinds > 1 ||
    hasDuplicate(query, SENSITIVE_QUERY_KEYS) ||
    hasDuplicate(query, PROVIDER_ERROR_KEYS) ||
    hasDuplicate(fragment, PROVIDER_ERROR_KEYS) ||
    hasDuplicate(fragment, TOKEN_FRAGMENT_KEYS)
  ) {
    return Object.freeze({ kind: 'invalid' });
  }

  if (hasProviderError) return Object.freeze({ kind: 'provider-error' });
  if (hasCode) return Object.freeze({ kind: hasNonEmptyValue(query, 'code') ? 'pkce' : 'invalid' });
  if (hasTokenFragment) {
    const complete = hasNonEmptyValue(fragment, 'access_token') && hasNonEmptyValue(fragment, 'refresh_token');
    return Object.freeze({ kind: complete ? 'token-fragment' : 'invalid' });
  }
  if (hasTokenHash) {
    const validType = query.getAll('type').length === 1 && query.get('type') === 'email';
    return Object.freeze({ kind: hasNonEmptyValue(query, 'token_hash') && validType ? 'token-hash' : 'invalid' });
  }

  return Object.freeze({ kind: 'none' });
}

export function cleanCallbackUrl(locationLike, historyLike) {
  if (!locationLike || !historyLike || typeof historyLike.replaceState !== 'function') return false;

  const cleanPath = locationLike.pathname || '/';
  if (!locationLike.search && !locationLike.hash) return false;
  try {
    historyLike.replaceState(null, '', cleanPath);
    return true;
  } catch {
    return false;
  }
}

export function prepareAuthCallbackRequest(locationLike, historyLike) {
  const classification = classifyAuthCallback(locationLike?.href);
  let authorizationCode = '';

  if (classification.kind === 'pkce') {
    try {
      authorizationCode = new URL(locationLike.href).searchParams.get('code')?.trim() || '';
    } catch {
      authorizationCode = '';
    }
  }

  const scrubbed = cleanCallbackUrl(locationLike, historyLike);
  return Object.freeze({
    kind: classification.kind,
    authorizationCode: scrubbed ? authorizationCode : '',
    scrubbed,
  });
}

export function createPkceConfirmationController({ exchangeAuthorizationCode } = {}) {
  let processingPromise;

  return Object.freeze({
    process({ preparedCallback, location, history } = {}) {
      if (processingPromise) return processingPromise;

      const callbackRequest = preparedCallback || prepareAuthCallbackRequest(location, history);
      if (!callbackRequest.scrubbed || callbackRequest.kind !== 'pkce' || !callbackRequest.authorizationCode) {
        processingPromise = Promise.resolve(Object.freeze({
          status: CONFIRMATION_STATUS.UNAVAILABLE,
          message: CONFIRMATION_MESSAGES.UNAVAILABLE,
        }));
        return processingPromise;
      }

      if (typeof exchangeAuthorizationCode !== 'function') {
        processingPromise = Promise.resolve(Object.freeze({
          status: CONFIRMATION_STATUS.UNAVAILABLE,
          message: CONFIRMATION_MESSAGES.UNAVAILABLE,
        }));
        return processingPromise;
      }

      processingPromise = Promise.resolve()
        .then(() => exchangeAuthorizationCode(callbackRequest.authorizationCode))
        .then((result) => Object.freeze(
          !result
          || typeof result !== 'object'
          || Array.isArray(result)
          || !Object.prototype.hasOwnProperty.call(result, 'error')
          || result.error !== null
          || result.data?.confirmed !== true
          ? { status: CONFIRMATION_STATUS.UNAVAILABLE, message: CONFIRMATION_MESSAGES.UNAVAILABLE }
          : { status: CONFIRMATION_STATUS.CONFIRMED, message: CONFIRMATION_MESSAGES.CONFIRMED }
        ))
        .catch(() => Object.freeze({
          status: CONFIRMATION_STATUS.UNAVAILABLE,
          message: CONFIRMATION_MESSAGES.UNAVAILABLE,
        }));

      return processingPromise;
    },
  });
}

export function callbackView(kind) {
  if (kind === 'provider-error' || kind === 'invalid' || kind === 'none') {
    return Object.freeze({
      icon: '!',
      kicker: 'Link not accepted',
      title: 'Invalid or expired link',
      message: 'This confirmation link cannot be used. Return to sign in or registration to continue.',
    });
  }

  return Object.freeze({
    icon: '○',
    kicker: 'Offline foundation',
    title: 'Confirmation unavailable',
    message: 'A supported confirmation link was detected, but it was not processed because authentication is not active yet.',
  });
}

export function confirmationResultView(result) {
  if (result?.status === CONFIRMATION_STATUS.CONFIRMED) {
    return Object.freeze({
      icon: '✓',
      kicker: 'Email confirmed',
      title: 'Confirmation complete',
      message: CONFIRMATION_MESSAGES.CONFIRMED,
    });
  }

  return Object.freeze({
    icon: '!',
    kicker: 'Confirmation unavailable',
    title: 'Confirmation unavailable',
    message: CONFIRMATION_MESSAGES.UNAVAILABLE,
  });
}

export function renderCallbackView(root, view) {
  const icon = root.querySelector('[data-callback-icon]');
  const kicker = root.querySelector('[data-callback-kicker]');
  const title = root.querySelector('[data-callback-title]');
  const message = root.querySelector('[data-callback-message]');
  if (!icon || !kicker || !title || !message) return false;

  icon.textContent = view.icon;
  kicker.textContent = view.kicker;
  title.textContent = view.title;
  message.textContent = view.message;
  return true;
}

let initialized = false;
let livePreparedCallbackRequest = null;

export function takePreparedAuthCallbackRequest() {
  const preparedCallback = livePreparedCallbackRequest;
  livePreparedCallbackRequest = null;
  return preparedCallback;
}

export function initializeAuthCallback({ location = globalThis.location, history = globalThis.history, document = globalThis.document } = {}) {
  if (initialized || !location || !history || !document) return false;
  initialized = true;

  livePreparedCallbackRequest = prepareAuthCallbackRequest(location, history);
  renderCallbackView(document, callbackView(livePreparedCallbackRequest.kind));
  return true;
}

if (typeof document !== 'undefined') initializeAuthCallback();
