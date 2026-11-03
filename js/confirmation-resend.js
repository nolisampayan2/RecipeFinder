import { isValidEmailAddress } from './registration.js';

export const CONFIRMATION_RESEND_COOLDOWN_MS = 60_000;

export const CONFIRMATION_RESEND_STATUS = Object.freeze({
  INVALID: 'invalid',
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  COOLDOWN: 'cooldown',
  RATE_LIMITED: 'rate-limited',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale',
});

export const CONFIRMATION_RESEND_MESSAGES = Object.freeze({
  SUBMITTED: 'If this address has an unconfirmed account, a new confirmation email may arrive shortly.',
  COOLDOWN: 'Please wait before requesting another confirmation email.',
  UNAVAILABLE: 'Confirmation email recovery is temporarily unavailable. Please try again later.',
});

function isNonArrayObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function approvedCallbackUrl(callbackUrl, applicationOrigin) {
  if (callbackUrl === 'http://localhost/RecipeFinder/auth-callback.html') return true;
  try {
    const callback = new URL(callbackUrl);
    const origin = new URL(applicationOrigin);
    return origin.protocol === 'https:'
      && origin.origin === applicationOrigin
      && origin.pathname === '/'
      && !origin.username
      && !origin.password
      && !origin.search
      && !origin.hash
      && callback.origin === origin.origin
      && callback.pathname === '/auth-callback.html'
      && !callback.username
      && !callback.password
      && !callback.search
      && !callback.hash;
  } catch {
    return false;
  }
}

function frozenResult(status, message, retryAfterMs = 0) {
  return Object.freeze({ status, message, retryAfterMs });
}

const INVALID_RESULT = Object.freeze({
  status: CONFIRMATION_RESEND_STATUS.INVALID,
  message: 'Enter a valid email address.',
  retryAfterMs: 0,
});

const PENDING_RESULT = Object.freeze({
  status: CONFIRMATION_RESEND_STATUS.PENDING,
  message: 'A confirmation email request is already in progress.',
  retryAfterMs: 0,
});

const STALE_RESULT = Object.freeze({
  status: CONFIRMATION_RESEND_STATUS.STALE,
  message: CONFIRMATION_RESEND_MESSAGES.UNAVAILABLE,
  retryAfterMs: 0,
});

function readTimestamp(now) {
  try {
    const timestamp = now();
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

function remainingCooldown(now, cooldownUntil) {
  const timestamp = readTimestamp(now);
  return timestamp === null ? null : Math.max(0, Math.ceil(cooldownUntil - timestamp));
}

function isRateLimitError(error) {
  try {
    const code = typeof error?.code === 'string' ? error.code : '';
    const status = Number.isInteger(error?.status) ? error.status : null;
    return status === 429
      || code === 'over_email_send_rate_limit'
      || code === 'over_request_rate_limit';
  } catch {
    return false;
  }
}

const OPERATIONAL_ERROR_CODES = new Set([
  'network_error',
  'request_timeout',
  'service_unavailable',
  'unexpected_failure',
]);

function isOperationalFailure(error) {
  try {
    const code = typeof error?.code === 'string' ? error.code : '';
    const status = Number.isInteger(error?.status) ? error.status : null;
    return status === 0
      || status === 401
      || status === 403
      || (status !== null && status >= 500)
      || OPERATIONAL_ERROR_CODES.has(code);
  } catch {
    return true;
  }
}

/**
 * Creates one explicit, email-only confirmation resend boundary.
 * The caller owns and injects the existing page client.
 */
export function createConfirmationResendService(
  client,
  {
    callbackUrl = 'http://localhost/RecipeFinder/auth-callback.html',
    applicationOrigin = 'http://localhost',
    now = () => Date.now(),
    cooldownMs = CONFIRMATION_RESEND_COOLDOWN_MS,
  } = {}
) {
  let auth;
  let resend;
  try {
    auth = client?.auth;
    resend = auth?.resend;
  } catch {
    throw new TypeError('A Supabase-compatible confirmation resend client is required.');
  }
  if (!auth || typeof resend !== 'function') {
    throw new TypeError('A Supabase-compatible confirmation resend client is required.');
  }
  if (!approvedCallbackUrl(callbackUrl, applicationOrigin)) {
    throw new TypeError('The confirmation resend callback URL is not approved.');
  }
  if (typeof now !== 'function' || !Number.isInteger(cooldownMs) || cooldownMs < 1) {
    throw new TypeError('Confirmation resend timing is invalid.');
  }

  let requestPending = false;
  let cooldownUntil = 0;
  let generation = 0;
  let retired = false;

  return Object.freeze({
    async request(emailInput) {
      let email;
      try {
        email = typeof emailInput === 'string' ? emailInput.trim() : '';
      } catch {
        return INVALID_RESULT;
      }
      if (!isValidEmailAddress(email)) return INVALID_RESULT;
      if (retired) return STALE_RESULT;
      if (requestPending) return PENDING_RESULT;

      const timestamp = readTimestamp(now);
      if (timestamp === null) {
        return frozenResult(
          CONFIRMATION_RESEND_STATUS.UNAVAILABLE,
          CONFIRMATION_RESEND_MESSAGES.UNAVAILABLE
        );
      }
      const cooldownRemaining = Math.max(0, Math.ceil(cooldownUntil - timestamp));
      if (cooldownRemaining > 0) {
        return frozenResult(
          CONFIRMATION_RESEND_STATUS.COOLDOWN,
          CONFIRMATION_RESEND_MESSAGES.COOLDOWN,
          cooldownRemaining
        );
      }

      requestPending = true;
      const requestGeneration = generation;
      cooldownUntil = timestamp + cooldownMs;

      try {
        const response = await resend.call(auth, {
          type: 'signup',
          email,
          options: { emailRedirectTo: callbackUrl },
        });
        if (retired || requestGeneration !== generation) return STALE_RESULT;

        const retryAfterMs = remainingCooldown(now, cooldownUntil) ?? 0;
        if (
          !isNonArrayObject(response)
          || !Object.prototype.hasOwnProperty.call(response, 'error')
        ) {
          return frozenResult(
            CONFIRMATION_RESEND_STATUS.UNAVAILABLE,
            CONFIRMATION_RESEND_MESSAGES.UNAVAILABLE,
            retryAfterMs
          );
        }

        let error;
        try {
          error = response.error;
        } catch {
          return frozenResult(
            CONFIRMATION_RESEND_STATUS.UNAVAILABLE,
            CONFIRMATION_RESEND_MESSAGES.UNAVAILABLE,
            retryAfterMs
          );
        }

        if (error === null) {
          return frozenResult(
            CONFIRMATION_RESEND_STATUS.SUBMITTED,
            CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
            retryAfterMs
          );
        }
        if (!isNonArrayObject(error)) {
          return frozenResult(
            CONFIRMATION_RESEND_STATUS.UNAVAILABLE,
            CONFIRMATION_RESEND_MESSAGES.UNAVAILABLE,
            retryAfterMs
          );
        }
        if (isRateLimitError(error)) {
          return frozenResult(
            CONFIRMATION_RESEND_STATUS.RATE_LIMITED,
            CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
            retryAfterMs
          );
        }
        if (!isOperationalFailure(error)) {
          // Account-state and other ambiguous provider rejections deliberately
          // share the neutral outward result. The message says only that a
          // replacement email may arrive; it never claims delivery.
          return frozenResult(
            CONFIRMATION_RESEND_STATUS.SUBMITTED,
            CONFIRMATION_RESEND_MESSAGES.SUBMITTED,
            retryAfterMs
          );
        }
        return frozenResult(
          CONFIRMATION_RESEND_STATUS.UNAVAILABLE,
          CONFIRMATION_RESEND_MESSAGES.UNAVAILABLE,
          retryAfterMs
        );
      } catch {
        if (retired || requestGeneration !== generation) return STALE_RESULT;
        return frozenResult(
          CONFIRMATION_RESEND_STATUS.UNAVAILABLE,
          CONFIRMATION_RESEND_MESSAGES.UNAVAILABLE,
          remainingCooldown(now, cooldownUntil) ?? 0
        );
      } finally {
        if (requestGeneration === generation) requestPending = false;
      }
    },

    getCooldownRemainingMs() {
      if (retired) return 0;
      try {
        return remainingCooldown(now, cooldownUntil) ?? 0;
      } catch {
        return 0;
      }
    },

    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      requestPending = false;
      cooldownUntil = 0;
      return true;
    },
  });
}
