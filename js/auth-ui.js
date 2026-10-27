const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const message = !email ? 'Enter your email address.' : !EMAIL_PATTERN.test(email) ? 'Enter a valid email address.' : '';
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
  const displayName = valueOf(form, 'displayName').trim();
  const password = valueOf(form, 'password');
  const confirmation = valueOf(form, 'confirmPassword');
  const passwordValid = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
  const emailValid = validateEmail(form);

  setFieldError(form, 'displayName', displayName ? '' : 'Enter a display name.');
  setFieldError(form, 'password', password ? (passwordValid ? '' : 'Use 8+ characters with uppercase, lowercase, and a number.') : 'Create a password.');
  setFieldError(form, 'confirmPassword', !confirmation ? 'Confirm your password.' : confirmation !== password ? 'Passwords do not match.' : '');

  return Boolean(displayName) && emailValid && passwordValid && confirmation === password;
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
