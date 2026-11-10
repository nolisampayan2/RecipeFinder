import { createSupabasePageClientOwner } from './supabase-browser.js';
import { SUPABASE_CLIENT_PROFILE } from './supabase-client.js';
import {
  PASSWORD_RECOVERY_MESSAGES,
  PASSWORD_RECOVERY_STATUS,
  classifyPasswordRecoveryCallback,
  createPasswordRecoveryController,
  createPasswordRecoveryRequestService,
  resolvePasswordResetUrl,
  scrubPasswordRecoveryUrl,
} from './password-recovery.js';

async function loadLocalPublicConfig() {
  return import('./supabase-config.js');
}

function setStatus(form, message, isError = false) {
  const status = form?.querySelector?.('[data-form-status]');
  if (!status) return;
  status.textContent = message;
  status.classList?.toggle?.('is-error', isError);
}

function setFieldError(form, name, message) {
  const input = form?.elements?.namedItem?.(name);
  const error = form?.querySelector?.(`[data-error-for="${name}"]`);
  if (error) error.textContent = message;
  input?.setAttribute?.('aria-invalid', String(Boolean(message)));
}

function setRequestPending(form, pending) {
  const submit = form?.querySelector?.('[type="submit"]');
  if (submit) submit.disabled = pending;
  form?.setAttribute?.('aria-busy', String(pending));
}

export function createPasswordRecoveryRequestActivation({
  documentLike = globalThis.document,
  locationLike = globalThis.location,
  sdk = globalThis.supabase,
  loadConfig = loadLocalPublicConfig,
  createClientOwner = createSupabasePageClientOwner,
  createService = createPasswordRecoveryRequestService,
} = {}) {
  const form = documentLike?.querySelector?.('[data-password-recovery-request]');
  let service = null;
  let submitHandler = null;
  let generation = 0;
  let retired = false;

  return Object.freeze({
    async activate() {
      if (retired || !form || typeof form.addEventListener !== 'function') return false;
      const activationGeneration = ++generation;
      setRequestPending(form, true);
      setStatus(form, 'Preparing secure recovery.');
      try {
        const redirectTo = resolvePasswordResetUrl(locationLike);
        const configModule = await loadConfig();
        if (retired || activationGeneration !== generation) return false;
        const owner = createClientOwner({
          config: configModule?.SUPABASE_CONFIG,
          sdk,
          profile: SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION,
        });
        const client = owner.initialize(SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION);
        service = createService(client, { redirectTo, applicationOrigin: new URL(redirectTo).origin });
        submitHandler = async (event) => {
          event?.preventDefault?.();
          if (retired || !service) return;
          const emailInput = form.elements?.namedItem?.('email');
          const email = typeof emailInput?.value === 'string' ? emailInput.value : '';
          setFieldError(form, 'email', '');
          setRequestPending(form, true);
          const requestGeneration = generation;
          let result;
          try { result = await service.request(email); } catch { result = null; }
          if (retired || requestGeneration !== generation || result?.status === PASSWORD_RECOVERY_STATUS.STALE) return;
          const invalid = result?.status === PASSWORD_RECOVERY_STATUS.INVALID;
          if (invalid) setFieldError(form, 'email', result.message || 'Enter a valid email address.');
          setStatus(
            form,
            result?.message || PASSWORD_RECOVERY_MESSAGES.UNAVAILABLE,
            invalid || result?.status === PASSWORD_RECOVERY_STATUS.UNAVAILABLE
          );
          setRequestPending(form, false);
          if (invalid) emailInput?.focus?.();
        };
        form.addEventListener('submit', submitHandler);
        setRequestPending(form, false);
        setStatus(form, 'Enter your email to request recovery instructions.');
        return true;
      } catch {
        if (!retired && activationGeneration === generation) {
          setRequestPending(form, true);
          setStatus(form, PASSWORD_RECOVERY_MESSAGES.UNAVAILABLE, true);
        }
        return false;
      }
    },
    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      try { service?.cleanup?.(); } catch { /* Local cleanup stays authoritative. */ }
      if (submitHandler) form?.removeEventListener?.('submit', submitHandler);
      submitHandler = null;
      service = null;
      return true;
    },
  });
}

export function createPasswordResetActivation({
  documentLike = globalThis.document,
  windowLike = globalThis,
  locationLike = globalThis.location,
  historyLike = globalThis.history,
  sdk = globalThis.supabase,
  loadConfig = loadLocalPublicConfig,
  createClientOwner = createSupabasePageClientOwner,
  createController = createPasswordRecoveryController,
} = {}) {
  const form = documentLike?.querySelector?.('[data-password-reset]');
  const fields = form?.querySelector?.('[data-recovery-fields]');
  let controller = null;
  let unsubscribe = null;
  let submitHandler = null;
  let generation = 0;
  let retired = false;

  const lockForm = (locked) => {
    if (fields) fields.disabled = locked;
    form?.setAttribute?.('aria-busy', String(locked));
  };
  const clearPasswords = () => {
    for (const name of ['password', 'confirmPassword']) {
      const input = form?.elements?.namedItem?.(name);
      if (input && typeof input.value === 'string') input.value = '';
    }
  };
  const renderState = (state) => {
    if (retired || !state) return;
    const ready = state.status === PASSWORD_RECOVERY_STATUS.READY;
    lockForm(!ready);
    const error = [
      PASSWORD_RECOVERY_STATUS.INVALID,
      PASSWORD_RECOVERY_STATUS.UNAVAILABLE,
      PASSWORD_RECOVERY_STATUS.SIGN_OUT_FAILED,
    ].includes(state.status);
    setStatus(form, state.message || PASSWORD_RECOVERY_MESSAGES.INVALID, error);
    if ([PASSWORD_RECOVERY_STATUS.UPDATED, PASSWORD_RECOVERY_STATUS.SIGN_OUT_FAILED].includes(state.status)) {
      clearPasswords();
    }
  };

  return Object.freeze({
    async activate() {
      if (retired || !form || !fields) return false;
      lockForm(true);
      if (classifyPasswordRecoveryCallback(locationLike).kind !== 'pkce') {
        scrubPasswordRecoveryUrl(locationLike, historyLike);
        setStatus(form, PASSWORD_RECOVERY_MESSAGES.INVALID, true);
        return false;
      }
      const activationGeneration = ++generation;
      try {
        const configModule = await loadConfig();
        if (retired || activationGeneration !== generation) return false;
        const owner = createClientOwner({
          config: configModule?.SUPABASE_CONFIG,
          sdk,
          profile: SUPABASE_CLIENT_PROFILE.PASSWORD_RECOVERY,
        });
        const client = owner.initialize(SUPABASE_CLIENT_PROFILE.PASSWORD_RECOVERY);
        controller = createController(client, { location: locationLike, history: historyLike });
        unsubscribe = controller.subscribe(renderState);
        submitHandler = async (event) => {
          event?.preventDefault?.();
          if (retired || !controller) return;
          setFieldError(form, 'password', '');
          setFieldError(form, 'confirmPassword', '');
          const password = form.elements?.namedItem?.('password')?.value ?? '';
          const confirmPassword = form.elements?.namedItem?.('confirmPassword')?.value ?? '';
          lockForm(true);
          const updateGeneration = generation;
          let result;
          try { result = await controller.update({ password, confirmPassword }); } catch { result = null; }
          if (retired || updateGeneration !== generation) return;
          if (result?.errors) {
            setFieldError(form, 'password', result.errors.password || '');
            setFieldError(form, 'confirmPassword', result.errors.confirmPassword || '');
            lockForm(false);
            const firstInvalid = form.querySelector?.('[aria-invalid="true"]');
            firstInvalid?.focus?.();
            setStatus(form, result.message || 'Check the password fields and try again.', true);
            return;
          }
          renderState(result || Object.freeze({
            status: PASSWORD_RECOVERY_STATUS.UNAVAILABLE,
            message: PASSWORD_RECOVERY_MESSAGES.UNAVAILABLE,
          }));
        };
        form.addEventListener('submit', submitHandler);
        const activated = await controller.activate();
        if (retired || activationGeneration !== generation) return false;
        return activated?.status === PASSWORD_RECOVERY_STATUS.READY
          || controller.getState().status === PASSWORD_RECOVERY_STATUS.VERIFYING;
      } catch {
        scrubPasswordRecoveryUrl(locationLike, historyLike);
        if (!retired && activationGeneration === generation) {
          lockForm(true);
          setStatus(form, PASSWORD_RECOVERY_MESSAGES.INVALID, true);
        }
        return false;
      }
    },
    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      clearPasswords();
      lockForm(true);
      try { unsubscribe?.(); } catch { /* View cleanup stays isolated. */ }
      try { controller?.cleanup?.(); } catch { /* Controller cleanup stays isolated. */ }
      if (submitHandler) form?.removeEventListener?.('submit', submitHandler);
      unsubscribe = null;
      submitHandler = null;
      controller = null;
      return true;
    },
  });
}

if (typeof document !== 'undefined') {
  const page = document.body?.dataset?.passwordRecoveryPage;
  const activation = page === 'request'
    ? createPasswordRecoveryRequestActivation()
    : page === 'reset'
      ? createPasswordResetActivation()
      : null;
  if (activation) {
    void activation.activate();
    globalThis.addEventListener?.('pagehide', () => activation.cleanup(), { once: true });
  }
}
