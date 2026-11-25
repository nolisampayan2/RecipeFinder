import { createSupabaseAdminAccessService, ADMIN_ACCESS_STATUS } from './supabase-admin-access.js';
import { isValidAccountUserId } from './supabase-favorites.js';

const CHECK_TIMEOUT_MS = 15000;
const MAX_OUTSTANDING = 3;

/** Preview-only navigation hint. Admin page authorization remains independent. */
export function createDashboardAdminLink({
  link,
  client,
  createAccessService = createSupabaseAdminAccessService,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  now = Date.now,
  windowLike = globalThis.window,
} = {}) {
  if (!link || typeof link.setAttribute !== 'function' || typeof link.removeAttribute !== 'function') {
    throw new TypeError('An Admin link element is required.');
  }
  const access = createAccessService(client);
  let userId = null;
  let generation = 0;
  let retired = false;
  let outstanding = 0;
  let currentCheck = null;
  const leases = new Set();

  const hide = () => {
    link.hidden = true;
    link.removeAttribute('href');
  };
  hide();

  const invalidate = () => {
    generation += 1;
    currentCheck = null;
    hide();
    try { access.invalidate(); } catch { /* A failed role service remains denied. */ }
  };

  const check = () => {
    if (retired || userId === null || outstanding >= MAX_OUTSTANDING) return Promise.resolve(false);
    const expectedGeneration = generation;
    const expectedUserId = userId;
    let started;
    let raw;
    try {
      started = now();
      if (!Number.isFinite(started)) return Promise.resolve(false);
      raw = Promise.resolve(access.check());
    } catch {
      return Promise.resolve(false);
    }
    outstanding += 1;
    let finished = false;
    let attempt;
    attempt = new Promise((resolve) => {
      let timer;
      const lease = (result) => {
        if (finished) return;
        finished = true;
        if (currentCheck === attempt) currentCheck = null;
        leases.delete(lease);
        try { clearTimeoutImpl(timer); } catch { /* Logical retirement is authoritative. */ }
        let allowed = false;
        try {
          const elapsed = now() - started;
          allowed = result?.status === ADMIN_ACCESS_STATUS.AUTHORIZED
            && !retired && expectedGeneration === generation && expectedUserId === userId
            && elapsed >= 0 && elapsed < CHECK_TIMEOUT_MS;
          if (allowed) {
            link.setAttribute('href', 'admin.html');
            link.hidden = false;
          }
        } catch {
          hide();
          allowed = false;
        }
        resolve(allowed);
      };
      leases.add(lease);
      try { timer = setTimeoutImpl(() => lease(null), CHECK_TIMEOUT_MS); }
      catch { lease(null); }
      void raw.then(
        (result) => { outstanding -= 1; lease(result); },
        () => { outstanding -= 1; lease(null); }
      );
    });
    if (!finished) currentCheck = attempt;
    return attempt;
  };

  const onFocus = () => { void controller.refresh(); };
  const controller = Object.freeze({
    handleAuthState(authState) {
      if (retired) return Promise.resolve(false);
      let nextUserId = null;
      try {
        if (authState?.status === 'authenticated') {
          const candidate = authState.userId;
          if (isValidAccountUserId(candidate)) nextUserId = candidate;
        }
      } catch { /* Invalid authentication cannot reveal navigation. */ }
      if (nextUserId === null) {
        userId = null;
        invalidate();
        return Promise.resolve(false);
      }
      if (nextUserId === userId) return Promise.resolve(!link.hidden);
      userId = nextUserId;
      invalidate();
      return check();
    },
    refresh() {
      if (retired || userId === null) return Promise.resolve(false);
      if (currentCheck) return currentCheck;
      invalidate();
      return check();
    },
    cleanup() {
      if (retired) return false;
      retired = true;
      userId = null;
      invalidate();
      for (const lease of [...leases]) lease(null);
      try { windowLike?.removeEventListener?.('focus', onFocus); } catch { /* Retirement remains terminal. */ }
      try { access.cleanup(); } catch { /* Retirement remains terminal. */ }
      return true;
    },
  });
  try { windowLike?.addEventListener?.('focus', onFocus); } catch { /* Refresh remains optional. */ }
  return controller;
}
