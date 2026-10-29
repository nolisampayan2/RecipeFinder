import { isEmailConfirmed } from './auth-session.js';

const MAX_AUTHORIZATION_CODE_LENGTH = 4096;

const SAFE_EXCHANGE_SUCCESS = Object.freeze({
  data: Object.freeze({ confirmed: true }),
  error: null,
});

const SAFE_EXCHANGE_FAILURE = Object.freeze({
  data: null,
  error: true,
});

function isValidAuthorizationCode(code) {
  return typeof code === 'string'
    && Boolean(code)
    && code.length <= MAX_AUTHORIZATION_CODE_LENGTH
    && code === code.trim()
    && !/[\u0000-\u001f\u007f]/.test(code);
}

function hasExplicitSuccess(result) {
  return Boolean(
    result
    && typeof result === 'object'
    && !Array.isArray(result)
    && Object.prototype.hasOwnProperty.call(result, 'error')
    && result.error === null
  );
}

function isMeaningfulString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonArrayObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasValidSession(result) {
  const data = result?.data;
  if (!isNonArrayObject(data)) return false;

  const session = data.session;
  return Boolean(
    isNonArrayObject(session) &&
    isMeaningfulString(session.access_token) &&
    isMeaningfulString(session.refresh_token) &&
    isNonArrayObject(session.user) &&
    isMeaningfulString(session.user.id) &&
    isEmailConfirmed(session.user)
  );
}

export function createPkceCodeExchangeAdapter(client) {
  const exchangeCode = client?.auth?.exchangeCodeForSession;
  if (typeof exchangeCode !== 'function') {
    throw new TypeError('A Supabase Auth code exchange client is required.');
  }

  return async function exchangeAuthorizationCode(code) {
    if (!isValidAuthorizationCode(code)) return SAFE_EXCHANGE_FAILURE;

    try {
      const result = await exchangeCode.call(client.auth, code);
      if (!hasExplicitSuccess(result) || !hasValidSession(result)) {
        return SAFE_EXCHANGE_FAILURE;
      }

      return SAFE_EXCHANGE_SUCCESS;
    } catch {
      return SAFE_EXCHANGE_FAILURE;
    }
  };
}
