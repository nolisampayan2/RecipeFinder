import { isValidEmailAddress, validateRegistrationInput } from './registration.js';

function setFieldError(form, name, message) {
  const input = form.elements.namedItem(name);
  const error = form.querySelector(`[data-error-for="${name}"]`);
  if (!(input instanceof HTMLInputElement) || !error) return;

  error.textContent = message;
  input.setAttribute('aria-invalid', String(Boolean(message)));
}

function valueOf(form, name) {
  const input = form.elements.namedItem(name);
  return input instanceof HTMLInputElement ? input.value : '';
}

function validateEmail(form) {
  const email = valueOf(form, 'email').trim();
  const message = !email ? 'Enter your email address.' : !isValidEmailAddress(email) ? 'Enter a valid email address.' : '';
  setFieldError(form, 'email', message);
  return !message;
}

function validateLogin(form) {
  const emailValid = validateEmail(form);
  const password = valueOf(form, 'password');
  const passwordMessage = password ? '' : 'Enter your password.';
  setFieldError(form, 'password', passwordMessage);
  return emailValid && !passwordMessage;
}

function validateRegistration(form) {
  const result = validateRegistrationInput({
    displayName: valueOf(form, 'displayName'),
    email: valueOf(form, 'email'),
    password: valueOf(form, 'password'),
    confirmPassword: valueOf(form, 'confirmPassword'),
  });

  Object.entries(result.errors).forEach(([name, message]) => setFieldError(form, name, message));
  return result.valid;
}

function firstInvalidField(form) {
  return form.querySelector('[aria-invalid="true"]');
}

function updateStatus(form, message, isError = false) {
  const status = form.querySelector('[data-form-status]');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function initializePasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!(input instanceof HTMLInputElement)) return;

      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${input.id === 'confirm-password' ? 'confirmed ' : ''}password`);
      input.focus();
    });
  });
}

function initializeForm() {
  const form = document.querySelector('[data-auth-form]');
  if (!(form instanceof HTMLFormElement)) return;

  form.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    setFieldError(form, event.target.name, '');
    updateStatus(form, '');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const valid = form.dataset.authForm === 'register' ? validateRegistration(form) : validateLogin(form);

    if (!valid) {
      updateStatus(form, 'Please review the highlighted fields.', true);
      firstInvalidField(form)?.focus();
      return;
    }

    updateStatus(
      form,
      form.dataset.authForm === 'register'
        ? 'Your details look ready. No account was created and no email was sent.'
        : 'Your details look ready. Sign-in will be connected in Batch 3B.'
    );
  });
}

function initializeForgotPasswordPreview() {
  const link = document.querySelector('[data-forgot-password]');
  const form = document.querySelector('[data-auth-form]');
  if (!link || !(form instanceof HTMLFormElement)) return;

  link.addEventListener('click', (event) => {
    event.preventDefault();
    updateStatus(form, 'Password recovery is a future screen. No recovery request was sent.');
  });
}

initializePasswordToggles();
initializeForm();
initializeForgotPasswordPreview();
