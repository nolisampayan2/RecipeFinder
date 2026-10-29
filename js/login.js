import { isEmailConfirmed } from './auth-session.js';
import { isValidEmailAddress } from './registration.js';

export const LOGIN_STATUS = Object.freeze({
  INVALID: 'invalid',
  PENDING: 'pending',
  AUTHENTICATED: 'authenticated',
  PENDING_CONFIRMATION: 'pending-confirmation',
  UNAVAILABLE: 'unavailable',
});

export const LOGIN_MESSAGES = Object.freeze({
  AUTHENTICATED: 'Sign-in completed.',
  PENDING_CONFIRMATION: 'Confirm your email before signing in.',
  UNAVAILABLE: 'Sign-in could not be completed. Check your details and try again.',
});

const UNAVAILABLE_RESULT = Object.freeze({
  status: LOGIN_STATUS.UNAVAILABLE,
  message: LOGIN_MESSAGES.UNAVAILABLE,
});

function validateLoginInput(input = {}) {
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const errors = Object.freeze({
    email: !email ? 'Enter your email address.' : !isValidEmailAddress(email) ? 'Enter a valid email address.' : '',
    password: password ? '' : 'Enter your password.',
  });

  return {
    email,
    password,
    errors,
    valid: Object.values(errors).every((message) => !message),
  };
}

function isMatchingAuthResult(data) {
  const userId = data?.user?.id;
  const sessionUserId = data?.session?.user?.id;
  return (
    typeof userId === 'string'
    && userId.length > 0
    && typeof sessionUserId === 'string'
    && sessionUserId === userId
  );
}

function isExplicitAuthSuccess(response) {
  return (
    response !== null
    && typeof response === 'object'
    && Object.prototype.hasOwnProperty.call(response, 'error')
    && response.error === null
  );
}

function requireAuthClient(client) {
  const auth = client?.auth;
  if (
    !auth
    || typeof auth.signInWithPassword !== 'function'
    || typeof auth.signOut !== 'function'
  ) {
    throw new TypeError('A compatible Supabase Auth login client is required.');
  }
  return auth;
}

/**
 * Creates an explicit email/password login boundary around an injected Auth
 * client. Results never expose credentials, sessions, tokens, or raw errors.
 */
export function createLoginService(client) {
  const auth = requireAuthClient(client);
  let requestPending = false;

  return Object.freeze({
    async submit(input) {
      const validation = validateLoginInput(input);
      if (!validation.valid) {
        return Object.freeze({ status: LOGIN_STATUS.INVALID, errors: validation.errors });
      }
      if (requestPending) return Object.freeze({ status: LOGIN_STATUS.PENDING });

      requestPending = true;
      try {
        const result = await auth.signInWithPassword({
          email: validation.email,
          password: validation.password,
        });
        if (!isExplicitAuthSuccess(result) || !isMatchingAuthResult(result.data)) {
          return UNAVAILABLE_RESULT;
        }

        const confirmed = isEmailConfirmed(result.data.user) && isEmailConfirmed(result.data.session.user);
        if (!confirmed) {
          const signOutResult = await auth.signOut({ scope: 'local' });
          if (!isExplicitAuthSuccess(signOutResult)) {
            return UNAVAILABLE_RESULT;
          }
          return Object.freeze({
            status: LOGIN_STATUS.PENDING_CONFIRMATION,
            message: LOGIN_MESSAGES.PENDING_CONFIRMATION,
          });
        }

        return Object.freeze({
          status: LOGIN_STATUS.AUTHENTICATED,
          message: LOGIN_MESSAGES.AUTHENTICATED,
        });
      } catch {
        return UNAVAILABLE_RESULT;
      } finally {
        requestPending = false;
      }
    },
  });
}
