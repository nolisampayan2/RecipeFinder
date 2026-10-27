const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CALLBACK_URL = 'http://localhost/RecipeFinder/auth-callback.html';

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

export function createRegistrationService(client, { callbackUrl = CALLBACK_URL } = {}) {
  if (!client?.auth || typeof client.auth.signUp !== 'function') {
    throw new TypeError('A Supabase-compatible Auth client is required.');
  }
  if (callbackUrl !== CALLBACK_URL) {
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
        const { data, error } = await client.auth.signUp({
          email: validation.values.email,
          password: validation.values.password,
          options: {
            emailRedirectTo: callbackUrl,
            data: { display_name: validation.values.displayName },
          },
        });

        if (error) {
          return Object.freeze({ status: REGISTRATION_STATUS.UNAVAILABLE, message: REGISTRATION_MESSAGES.UNAVAILABLE });
        }
        if (data?.session) {
          return Object.freeze({
            status: REGISTRATION_STATUS.CONFIGURATION_MISMATCH,
            message: REGISTRATION_MESSAGES.CONFIGURATION_MISMATCH,
          });
        }

        return Object.freeze({ status: REGISTRATION_STATUS.SUBMITTED, message: REGISTRATION_MESSAGES.SUBMITTED });
      } catch {
        return Object.freeze({ status: REGISTRATION_STATUS.UNAVAILABLE, message: REGISTRATION_MESSAGES.UNAVAILABLE });
      } finally {
        requestPending = false;
      }
    },
  });
}
