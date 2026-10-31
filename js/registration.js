const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_CALLBACK_URL = 'http://localhost/RecipeFinder/auth-callback.html';

export const REGISTRATION_STATUS = Object.freeze({
  INVALID: 'invalid',
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  UNAVAILABLE: 'unavailable',
  CONFIGURATION_MISMATCH: 'configuration-mismatch',
});

export const REGISTRATION_MESSAGES = Object.freeze({
  SUBMITTED: 'If this address can be registered, check your inbox for a confirmation link.',
  UNAVAILABLE: 'Account registration is temporarily unavailable. Please try again later.',
  CONFIGURATION_MISMATCH: 'Account registration is unavailable while confirmation settings are reviewed.',
});

const UNAVAILABLE_RESULT = Object.freeze({
  status: REGISTRATION_STATUS.UNAVAILABLE,
  message: REGISTRATION_MESSAGES.UNAVAILABLE,
});

function isNonArrayObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasExplicitSuccess(response) {
  return Boolean(
    isNonArrayObject(response)
    && Object.prototype.hasOwnProperty.call(response, 'error')
    && response.error === null
  );
}

function hasValidSignupEnvelope(response) {
  return Boolean(
    hasExplicitSuccess(response)
    && Object.prototype.hasOwnProperty.call(response, 'data')
    && isNonArrayObject(response.data)
    && Object.prototype.hasOwnProperty.call(response.data, 'session')
  );
}

function hasPossibleSession(response) {
  try {
    return Boolean(response && typeof response === 'object' && response.data?.session != null);
  } catch {
    return false;
  }
}

export function isValidEmailAddress(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(value.trim());
}

export function validateRegistrationInput(input = {}) {
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';
  const passwordValid = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
  const errors = {
    displayName: !displayName ? 'Enter a display name.' : displayName.length > 80 ? 'Use 80 characters or fewer.' : '',
    email: !email ? 'Enter your email address.' : !isValidEmailAddress(email) ? 'Enter a valid email address.' : '',
    password: password ? (passwordValid ? '' : 'Use 8+ characters with uppercase, lowercase, and a number.') : 'Create a password.',
    confirmPassword: !confirmPassword ? 'Confirm your password.' : confirmPassword !== password ? 'Passwords do not match.' : '',
  };

  return Object.freeze({
    valid: Object.values(errors).every((message) => !message),
    errors: Object.freeze(errors),
    values: Object.freeze({ displayName, email, password }),
  });
}

function parseOrigin(value) {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function resolveRegistrationCallbackUrl(locationLike = globalThis.location) {
  let pageUrl;
  try {
    const href = typeof locationLike === 'string' ? locationLike : locationLike?.href;
    pageUrl = new URL(href);
  } catch {
    throw new TypeError('The registration callback URL is not approved.');
  }

  if (pageUrl.username || pageUrl.password || pageUrl.search || pageUrl.hash) {
    throw new TypeError('The registration callback URL is not approved.');
  }
  if (pageUrl.origin === 'http://localhost' && pageUrl.pathname === '/RecipeFinder/register.html') {
    return LOCAL_CALLBACK_URL;
  }
  if (pageUrl.protocol === 'https:') {
    return new URL('/auth-callback.html', pageUrl.origin).href;
  }
  throw new TypeError('The registration callback URL is not approved.');
}

function isApprovedCallbackUrl(callbackUrl, applicationOrigin) {
  if (callbackUrl === LOCAL_CALLBACK_URL) return true;
  const approvedOrigin = parseOrigin(applicationOrigin);
  if (!approvedOrigin?.startsWith('https://')) return false;
  try {
    const callback = new URL(callbackUrl);
    return callback.origin === approvedOrigin
      && callback.pathname === '/auth-callback.html'
      && !callback.username
      && !callback.password
      && !callback.search
      && !callback.hash;
  } catch {
    return false;
  }
}

export function createRegistrationService(
  client,
  { callbackUrl = LOCAL_CALLBACK_URL, applicationOrigin } = {}
) {
  if (
    !client?.auth
    || typeof client.auth.signUp !== 'function'
    || typeof client.auth.signOut !== 'function'
  ) {
    throw new TypeError('A Supabase-compatible Auth client is required.');
  }
  if (!isApprovedCallbackUrl(callbackUrl, applicationOrigin)) {
    throw new TypeError('The registration callback URL is not approved.');
  }

  let requestPending = false;

  return Object.freeze({
    async submit(input) {
      const validation = validateRegistrationInput(input);
      if (!validation.valid) {
        return Object.freeze({ status: REGISTRATION_STATUS.INVALID, errors: validation.errors });
      }
      if (requestPending) {
        return Object.freeze({ status: REGISTRATION_STATUS.PENDING });
      }

      requestPending = true;
      try {
        const response = await client.auth.signUp({
          email: validation.values.email,
          password: validation.values.password,
          options: {
            emailRedirectTo: callbackUrl,
            data: { display_name: validation.values.displayName },
          },
        });

        if (hasPossibleSession(response)) {
          const signOutResult = await client.auth.signOut({ scope: 'local' });
          if (!hasExplicitSuccess(signOutResult)) return UNAVAILABLE_RESULT;
          if (!hasValidSignupEnvelope(response) || !isNonArrayObject(response.data.session)) {
            return UNAVAILABLE_RESULT;
          }
          return Object.freeze({
            status: REGISTRATION_STATUS.CONFIGURATION_MISMATCH,
            message: REGISTRATION_MESSAGES.CONFIGURATION_MISMATCH,
          });
        }

        if (!hasValidSignupEnvelope(response) || response.data.session !== null) {
          return UNAVAILABLE_RESULT;
        }

        return Object.freeze({ status: REGISTRATION_STATUS.SUBMITTED, message: REGISTRATION_MESSAGES.SUBMITTED });
      } catch {
        return UNAVAILABLE_RESULT;
      } finally {
        requestPending = false;
      }
    },
  });
}
