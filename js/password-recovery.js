import { isValidEmailAddress } from './registration.js';

const APPROVED_QUERY_PARAMETERS = new Set([
  'utm_campaign', 'utm_content', 'utm_id', 'utm_medium', 'utm_source', 'utm_term',
]);
const PROVIDER_ERROR_KEYS = new Set(['error', 'error_code', 'error_description']);
const RECOVERY_TIMEOUT_MS = 15000;

export const PASSWORD_RECOVERY_STATUS = Object.freeze({
  INVALID: 'invalid',
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  VERIFYING: 'verifying',
  READY: 'ready',
  UPDATED: 'updated',
  SIGN_OUT_FAILED: 'sign-out-failed',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale',
});

export const PASSWORD_RECOVERY_MESSAGES = Object.freeze({
  SUBMITTED: 'If this address is eligible, password recovery instructions will be sent. Open the link in this browser.',
  VERIFYING: 'Verifying your recovery link.',
  READY: 'Recovery link verified. Choose a new password.',
  INVALID: 'This recovery link is invalid, expired, already used, or belongs to another browser. Request a new link to continue.',
  UPDATED: 'Password updated. Account-wide sign-out was requested. Sign in again with your new password.',
  SIGN_OUT_FAILED: 'Your password was updated, but RecipeFinder could not confirm account-wide sign-out. Close this browser, then sign in again and review active sessions before continuing.',
  UNAVAILABLE: 'Password recovery is temporarily unavailable. Please try again later.',
});

const frozenResult = (status, message) => Object.freeze({ status, message });
const STALE_RESULT = frozenResult(PASSWORD_RECOVERY_STATUS.STALE, PASSWORD_RECOVERY_MESSAGES.UNAVAILABLE);
const INVALID_LINK_RESULT = frozenResult(PASSWORD_RECOVERY_STATUS.INVALID, PASSWORD_RECOVERY_MESSAGES.INVALID);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function explicitSuccess(value) {
  return Boolean(isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'error') && value.error === null);
}

function hrefOf(locationLike) {
  return typeof locationLike === 'string' ? locationLike : locationLike?.href;
}

function approvedPageUrl(locationLike, expectedName) {
  let pageUrl;
  try {
    pageUrl = new URL(hrefOf(locationLike));
  } catch {
    return null;
  }
  if (pageUrl.username || pageUrl.password || pageUrl.hash) return null;
  const localhost = pageUrl.hostname === 'localhost' || pageUrl.hostname === '127.0.0.1';
  if (pageUrl.protocol !== 'https:' && !(localhost && pageUrl.protocol === 'http:')) return null;
  const expectedPath = localhost ? `/RecipeFinder/${expectedName}` : `/${expectedName}`;
  if (pageUrl.pathname !== expectedPath) return null;
  for (const key of pageUrl.searchParams.keys()) {
    if (!APPROVED_QUERY_PARAMETERS.has(key)) return null;
  }
  return pageUrl;
}

export function resolvePasswordResetUrl(locationLike = globalThis.location) {
  const pageUrl = approvedPageUrl(locationLike, 'forgot-password.html');
  if (!pageUrl) throw new TypeError('The password recovery redirect URL is not approved.');
  const localhost = pageUrl.hostname === 'localhost' || pageUrl.hostname === '127.0.0.1';
  return new URL(localhost ? '/RecipeFinder/reset-password.html' : '/reset-password.html', pageUrl.origin).href;
}

function isApprovedPasswordResetUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return !url.username
    && !url.password
    && !url.search
    && !url.hash
    && (url.protocol === 'https:' || (localhost && url.protocol === 'http:'))
    && url.pathname === (localhost ? '/RecipeFinder/reset-password.html' : '/reset-password.html');
}

export function classifyPasswordRecoveryCallback(locationLike = globalThis.location) {
  let pageUrl;
  try {
    pageUrl = new URL(hrefOf(locationLike));
  } catch {
    return Object.freeze({ kind: 'invalid' });
  }
  if (pageUrl.username || pageUrl.password) return Object.freeze({ kind: 'invalid' });
  const localhost = pageUrl.hostname === 'localhost' || pageUrl.hostname === '127.0.0.1';
  const expectedPath = localhost ? '/RecipeFinder/reset-password.html' : '/reset-password.html';
  if (
    (pageUrl.protocol !== 'https:' && !(localhost && pageUrl.protocol === 'http:'))
    || pageUrl.pathname !== expectedPath
    || pageUrl.hash
  ) return Object.freeze({ kind: 'invalid' });

  const keys = [...pageUrl.searchParams.keys()];
  if (keys.some((key) => PROVIDER_ERROR_KEYS.has(key))) return Object.freeze({ kind: 'provider-error' });
  if (keys.length !== 1 || keys[0] !== 'code' || pageUrl.searchParams.getAll('code').length !== 1) {
    return Object.freeze({ kind: 'invalid' });
  }
  const code = pageUrl.searchParams.get('code');
  return Object.freeze({ kind: typeof code === 'string' && code.trim() ? 'pkce' : 'invalid' });
}

export function scrubPasswordRecoveryUrl(locationLike, historyLike) {
  if (!locationLike || !historyLike || typeof historyLike.replaceState !== 'function') return false;
  try {
    historyLike.replaceState(null, '', locationLike.pathname || '/');
    return true;
  } catch {
    return false;
  }
}

export function validateNewPassword(input = {}) {
  let password = '';
  let confirmPassword = '';
  try {
    password = typeof input?.password === 'string' ? input.password : '';
    confirmPassword = typeof input?.confirmPassword === 'string' ? input.confirmPassword : '';
  } catch {
    // Hostile inputs are reduced to ordinary validation failures.
  }
  const strong = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
  const errors = Object.freeze({
    password: password ? (strong ? '' : 'Use 8+ characters with uppercase, lowercase, and a number.') : 'Create a password.',
    confirmPassword: !confirmPassword ? 'Confirm your password.' : confirmPassword !== password ? 'Passwords do not match.' : '',
  });
  return Object.freeze({ valid: !errors.password && !errors.confirmPassword, errors, password });
}

export function createPasswordRecoveryRequestService(client, { redirectTo, applicationOrigin } = {}) {
  const resetPasswordForEmail = client?.auth?.resetPasswordForEmail;
  let redirectOrigin = null;
  try { redirectOrigin = new URL(redirectTo).origin; } catch { /* Rejected below. */ }
  if (
    typeof resetPasswordForEmail !== 'function'
    || !isApprovedPasswordResetUrl(redirectTo)
    || typeof applicationOrigin !== 'string'
    || redirectOrigin !== applicationOrigin
  ) {
    throw new TypeError('A compatible password recovery client is required.');
  }
  let generation = 0;
  let pending = null;
  let retired = false;

  return Object.freeze({
    request(emailInput) {
      if (retired) return Promise.resolve(STALE_RESULT);
      const email = typeof emailInput === 'string' ? emailInput.trim() : '';
      if (!isValidEmailAddress(email)) {
        return Promise.resolve(frozenResult(PASSWORD_RECOVERY_STATUS.INVALID, 'Enter a valid email address.'));
      }
      if (pending) return pending;
      const requestGeneration = generation;
      const operation = (async () => {
        try {
          await resetPasswordForEmail.call(client.auth, email, { redirectTo });
        } catch {
          // Valid addresses always receive the same public response to prevent enumeration.
        }
        if (retired || requestGeneration !== generation) return STALE_RESULT;
        return frozenResult(PASSWORD_RECOVERY_STATUS.SUBMITTED, PASSWORD_RECOVERY_MESSAGES.SUBMITTED);
      })();
      pending = operation;
      void operation.finally(() => { if (pending === operation) pending = null; });
      return operation;
    },
    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      pending = null;
      return true;
    },
  });
}

export function createPasswordRecoveryController(client, {
  location = globalThis.location,
  history = globalThis.history,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (handle) => globalThis.clearTimeout(handle),
} = {}) {
  const auth = client?.auth;
  if (
    typeof auth?.initialize !== 'function'
    || typeof auth.onAuthStateChange !== 'function'
    || typeof auth.updateUser !== 'function'
    || typeof auth.signOut !== 'function'
  ) throw new TypeError('A compatible password recovery client is required.');

  let state = frozenResult(PASSWORD_RECOVERY_STATUS.VERIFYING, PASSWORD_RECOVERY_MESSAGES.VERIFYING);
  let recoveryUserId = null;
  let subscription = null;
  let activationPromise = null;
  let updatePromise = null;
  let timer = null;
  let generation = 0;
  let verificationGeneration = null;
  let globalSignOutInProgress = false;
  let callbackUrlScrubbed = false;
  let retired = false;
  const listeners = new Set();

  const scrubCallbackUrl = () => {
    if (callbackUrlScrubbed) return true;
    callbackUrlScrubbed = scrubPasswordRecoveryUrl(location, history);
    return callbackUrlScrubbed;
  };

  const publish = (next) => {
    state = next;
    listeners.forEach((listener) => { try { listener(state); } catch { /* UI observers stay isolated. */ } });
    return state;
  };
  const invalidate = ({ scrub = false } = {}) => {
    generation += 1;
    verificationGeneration = null;
    globalSignOutInProgress = false;
    recoveryUserId = null;
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (scrub) scrubCallbackUrl();
    return publish(INVALID_LINK_RESULT);
  };
  const userId = (session) => {
    try { return typeof session?.user?.id === 'string' && session.user.id ? session.user.id : null; } catch { return null; }
  };
  const handleAuthEvent = (event, session) => {
    if (retired) return;
    const nextUserId = userId(session);
    if (event === 'PASSWORD_RECOVERY') {
      if (
        state.status !== PASSWORD_RECOVERY_STATUS.VERIFYING
        || verificationGeneration === null
        || verificationGeneration !== generation
      ) return;
      if (!nextUserId || (recoveryUserId && recoveryUserId !== nextUserId)) return void invalidate();
      recoveryUserId = nextUserId;
      if (timer !== null) { clearTimer(timer); timer = null; }
      publish(frozenResult(PASSWORD_RECOVERY_STATUS.READY, PASSWORD_RECOVERY_MESSAGES.READY));
      return;
    }
    if (event === 'SIGNED_OUT' && globalSignOutInProgress) return;
    if (event === 'SIGNED_OUT') return void invalidate();
    if (event === 'SIGNED_IN' && state.status !== PASSWORD_RECOVERY_STATUS.READY) return void invalidate();
    if (recoveryUserId && nextUserId && recoveryUserId !== nextUserId) invalidate();
  };

  return Object.freeze({
    getState() { return state; },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A recovery listener is required.');
      if (retired) return () => {};
      listeners.add(listener);
      try { listener(state); } catch { /* Observer failures stay isolated. */ }
      return () => listeners.delete(listener);
    },
    activate() {
      if (retired) return Promise.resolve(STALE_RESULT);
      if (activationPromise) return activationPromise;
      const activationGeneration = ++generation;
      verificationGeneration = activationGeneration;
      activationPromise = (async () => {
        if (classifyPasswordRecoveryCallback(location).kind !== 'pkce') {
          return invalidate({ scrub: true });
        }
        try {
          const response = auth.onAuthStateChange(handleAuthEvent);
          const candidate = response?.data?.subscription;
          if (!candidate || typeof candidate.unsubscribe !== 'function') return invalidate({ scrub: true });
          subscription = candidate;
          timer = setTimer(() => {
            timer = null;
            if (!retired && activationGeneration === generation && state.status === PASSWORD_RECOVERY_STATUS.VERIFYING) {
              invalidate({ scrub: true });
            }
          }, RECOVERY_TIMEOUT_MS);
          const initialized = await auth.initialize();
          const scrubbed = scrubCallbackUrl();
          if (retired) return STALE_RESULT;
          if (activationGeneration !== generation) {
            return state.status === PASSWORD_RECOVERY_STATUS.INVALID ? state : STALE_RESULT;
          }
          if (!scrubbed || !explicitSuccess(initialized)) return invalidate();
          return state;
        } catch {
          scrubCallbackUrl();
          if (retired) return STALE_RESULT;
          if (activationGeneration !== generation) {
            return state.status === PASSWORD_RECOVERY_STATUS.INVALID ? state : STALE_RESULT;
          }
          return invalidate();
        }
      })();
      return activationPromise;
    },
    update(input) {
      if (retired) return Promise.resolve(STALE_RESULT);
      const validation = validateNewPassword(input);
      if (!validation.valid) return Promise.resolve(Object.freeze({
        status: PASSWORD_RECOVERY_STATUS.INVALID,
        message: 'Check the password fields and try again.',
        errors: validation.errors,
      }));
      if (updatePromise) return updatePromise;
      if (state.status !== PASSWORD_RECOVERY_STATUS.READY || !recoveryUserId) {
        return Promise.resolve(INVALID_LINK_RESULT);
      }
      const updateGeneration = generation;
      const expectedUserId = recoveryUserId;
      const updateIsCurrent = () => !retired
        && updateGeneration === generation
        && recoveryUserId === expectedUserId;
      publish(frozenResult(PASSWORD_RECOVERY_STATUS.PENDING, 'Updating your password.'));
      const operation = (async () => {
        try {
          const updated = await auth.updateUser({ password: validation.password });
          const updatedUserId = updated?.data?.user?.id;
          if (!updateIsCurrent()) return STALE_RESULT;
          if (!explicitSuccess(updated) || updatedUserId !== expectedUserId) return invalidate();
          let signedOut;
          globalSignOutInProgress = true;
          try {
            signedOut = await auth.signOut({ scope: 'global' });
          } catch {
            signedOut = null;
          } finally {
            globalSignOutInProgress = false;
          }
          if (!updateIsCurrent()) return STALE_RESULT;
          recoveryUserId = null;
          generation += 1;
          if (!explicitSuccess(signedOut)) {
            return publish(frozenResult(PASSWORD_RECOVERY_STATUS.SIGN_OUT_FAILED, PASSWORD_RECOVERY_MESSAGES.SIGN_OUT_FAILED));
          }
          return publish(frozenResult(PASSWORD_RECOVERY_STATUS.UPDATED, PASSWORD_RECOVERY_MESSAGES.UPDATED));
        } catch {
          if (!updateIsCurrent()) return STALE_RESULT;
          recoveryUserId = null;
          generation += 1;
          return publish(frozenResult(PASSWORD_RECOVERY_STATUS.UNAVAILABLE, PASSWORD_RECOVERY_MESSAGES.UNAVAILABLE));
        }
      })();
      updatePromise = operation;
      void operation.finally(() => { if (updatePromise === operation) updatePromise = null; });
      return operation;
    },
    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      verificationGeneration = null;
      globalSignOutInProgress = false;
      recoveryUserId = null;
      if (timer !== null) { clearTimer(timer); timer = null; }
      scrubCallbackUrl();
      state = INVALID_LINK_RESULT;
      try { subscription?.unsubscribe(); } catch { /* Local retirement is already complete. */ }
      subscription = null;
      activationPromise = null;
      updatePromise = null;
      listeners.clear();
      return true;
    },
  });
}
