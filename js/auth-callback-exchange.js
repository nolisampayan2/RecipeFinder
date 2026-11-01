import { isEmailConfirmed } from './auth-session.js';
import {
  CALLBACK_DIAGNOSTIC_STAGE,
  reportCallbackDiagnostic,
} from './auth-callback.js';

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

function sessionFailureStage(result) {
  let user;
  try {
    const data = result.data;
    if (!isNonArrayObject(data)) return CALLBACK_DIAGNOSTIC_STAGE.SESSION_VALIDATION;

    const session = data.session;
    if (
      !isNonArrayObject(session)
      || !isMeaningfulString(session.access_token)
      || !isMeaningfulString(session.refresh_token)
      || !isNonArrayObject(session.user)
      || !isMeaningfulString(session.user.id)
    ) {
      return CALLBACK_DIAGNOSTIC_STAGE.SESSION_VALIDATION;
    }
    user = session.user;
  } catch {
    return CALLBACK_DIAGNOSTIC_STAGE.SESSION_VALIDATION;
  }

  try {
    return isEmailConfirmed(user) ? null : CALLBACK_DIAGNOSTIC_STAGE.EMAIL_CONFIRMATION;
  } catch {
    return CALLBACK_DIAGNOSTIC_STAGE.EMAIL_CONFIRMATION;
  }
}

export function createPkceCodeExchangeAdapter(client, { onDiagnostic } = {}) {
  const exchangeCode = client?.auth?.exchangeCodeForSession;
  if (typeof exchangeCode !== 'function') {
    throw new TypeError('A Supabase Auth code exchange client is required.');
  }

  return async function exchangeAuthorizationCode(code) {
    if (!isValidAuthorizationCode(code)) {
      reportCallbackDiagnostic(onDiagnostic, CALLBACK_DIAGNOSTIC_STAGE.CALLBACK_PAYLOAD);
      return SAFE_EXCHANGE_FAILURE;
    }

    try {
      const result = await exchangeCode.call(client.auth, code);
      if (!hasExplicitSuccess(result)) {
        reportCallbackDiagnostic(onDiagnostic, CALLBACK_DIAGNOSTIC_STAGE.PKCE_EXCHANGE);
        return SAFE_EXCHANGE_FAILURE;
      }

      const failureStage = sessionFailureStage(result);
      if (failureStage) {
        reportCallbackDiagnostic(onDiagnostic, failureStage);
        return SAFE_EXCHANGE_FAILURE;
      }

      return SAFE_EXCHANGE_SUCCESS;
    } catch {
      reportCallbackDiagnostic(onDiagnostic, CALLBACK_DIAGNOSTIC_STAGE.PKCE_EXCHANGE);
      return SAFE_EXCHANGE_FAILURE;
    }
  };
}
