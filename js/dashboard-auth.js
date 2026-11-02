import {
  AUTH_SESSION_STATUS,
  createAuthSessionService,
} from './auth-session.js';
import { isValidAccountUserId } from './supabase-favorites.js';
import { createSupabasePageClientOwner } from './supabase-browser.js';
import { SUPABASE_CLIENT_PROFILE } from './supabase-client.js';

export const DASHBOARD_AUTH_MESSAGE = Object.freeze({
  LOADING: 'Checking account…',
  GUEST: 'Guest',
  AUTHENTICATED: 'Signed-in user',
  PENDING_CONFIRMATION: 'Confirm your email',
  UNAVAILABLE: 'Account unavailable',
});

function safeIdentity(user) {
  try {
    const email = user?.email;
    if (
      typeof email === 'string'
      && email === email.trim()
      && email.length > 0
      && email.length <= 254
      && !/[\u0000-\u001f\u007f]/.test(email)
    ) return email;
  } catch {
    // Hostile or malformed identity data stays private.
  }
  return DASHBOARD_AUTH_MESSAGE.AUTHENTICATED;
}

function requireDashboardAuthElements(documentLike) {
  try {
    const root = documentLike?.querySelector?.('[data-dashboard-auth]');
    const elements = {
      root,
      label: root?.querySelector?.('[data-auth-label]'),
      identity: root?.querySelector?.('[data-auth-identity]'),
      signIn: root?.querySelector?.('[data-auth-sign-in]'),
      logout: root?.querySelector?.('[data-auth-logout]'),
    };
    if (Object.values(elements).some((element) => !element)) throw new Error('missing dashboard Auth UI');
    return elements;
  } catch {
    throw new TypeError('Dashboard account controls are unavailable.');
  }
}

function renderDashboardAuth(elements, state) {
  try {
    let status = AUTH_SESSION_STATUS.ERROR;
    if (Object.values(AUTH_SESSION_STATUS).includes(state?.status)) status = state.status;

    let label = 'Account';
    let identity = DASHBOARD_AUTH_MESSAGE.UNAVAILABLE;
    let showSignIn = false;
    let showLogout = false;
    if (status === AUTH_SESSION_STATUS.LOADING) {
      identity = DASHBOARD_AUTH_MESSAGE.LOADING;
    } else if (status === AUTH_SESSION_STATUS.GUEST) {
      label = 'Guest';
      identity = DASHBOARD_AUTH_MESSAGE.GUEST;
      showSignIn = true;
    } else if (status === AUTH_SESSION_STATUS.AUTHENTICATED) {
      label = 'Signed in';
      identity = safeIdentity(state.user);
      showLogout = true;
    } else if (status === AUTH_SESSION_STATUS.PENDING_CONFIRMATION) {
      label = 'Account pending';
      identity = DASHBOARD_AUTH_MESSAGE.PENDING_CONFIRMATION;
      showLogout = true;
    } else {
      showSignIn = true;
    }

    elements.root.dataset.authState = status;
    elements.root.setAttribute('aria-busy', String(status === AUTH_SESSION_STATUS.LOADING));
    elements.label.textContent = label;
    elements.identity.textContent = identity;
    elements.signIn.hidden = !showSignIn;
    elements.logout.hidden = !showLogout;
    elements.logout.disabled = status === AUTH_SESSION_STATUS.LOADING;
    return true;
  } catch {
    return false;
  }
}

async function loadLocalPublicConfig() {
  return import('./supabase-config.js');
}

/** Owns one dashboard Auth lifecycle; recipe discovery remains independent. */
export function createDashboardAuthIntegration(options = {}) {
  let documentLike;
  let loadConfig;
  let sdk;
  let createClientOwner;
  let createSessionService;
  let onClientReady;
  let onAuthStateChange;
  try {
    documentLike = options?.documentLike ?? globalThis.document;
    loadConfig = options?.loadConfig ?? loadLocalPublicConfig;
    sdk = options?.sdk ?? globalThis.supabase;
    createClientOwner = options?.createClientOwner ?? createSupabasePageClientOwner;
    createSessionService = options?.createSessionService ?? createAuthSessionService;
    onClientReady = options?.onClientReady;
    onAuthStateChange = options?.onAuthStateChange;
  } catch {
    throw new TypeError('Dashboard authentication initialization failed.');
  }

  const elements = requireDashboardAuthElements(documentLike);
  let owner = null;
  let service = null;
  let unsubscribe = null;
  let activationPromise = null;
  let logoutPromise = null;
  let generation = 0;
  let retired = false;
  let logoutInstalled = false;
  let renderingAvailable = true;
  let clientReadyNotified = false;

  const notifyAuthState = (state) => {
    if (retired || typeof onAuthStateChange !== 'function') return;
    let status = AUTH_SESSION_STATUS.ERROR;
    let userId = null;
    try {
      if (Object.values(AUTH_SESSION_STATUS).includes(state?.status)) status = state.status;
      if (status === AUTH_SESSION_STATUS.AUTHENTICATED) {
        const candidateUserId = state?.user?.id;
        if (isValidAccountUserId(candidateUserId)) userId = candidateUserId;
        else status = AUTH_SESSION_STATUS.ERROR;
      }
    } catch {
      status = AUTH_SESSION_STATUS.ERROR;
      userId = null;
    }
    try {
      onAuthStateChange(Object.freeze({ status, userId }));
    } catch {
      // Additive state observers cannot interrupt Auth.
    }
  };

  const publish = (state, expectedGeneration = generation) => {
    if (retired || expectedGeneration !== generation) return false;
    const rendered = renderDashboardAuth(elements, state);
    if (!rendered) renderingAvailable = false;
    else notifyAuthState(state);
    return rendered;
  };

  const releaseSession = () => {
    try { unsubscribe?.(); } catch { /* Consumer cleanup stays isolated. */ }
    unsubscribe = null;
    try { service?.cleanup?.(); } catch { /* Provider cleanup stays private. */ }
    service = null;
  };

  const logout = () => {
    if (retired || !service) return Promise.resolve(false);
    if (!logoutPromise) {
      const logoutGeneration = generation;
      const attempt = Promise.resolve().then(async () => {
        try {
          const nextState = await service.logout();
          return Boolean(
            !retired
            && logoutGeneration === generation
            && nextState?.status === AUTH_SESSION_STATUS.GUEST
          );
        } catch {
          if (!retired && logoutGeneration === generation) {
            publish({ status: AUTH_SESSION_STATUS.ERROR, user: null }, logoutGeneration);
          }
          return false;
        }
      });
      logoutPromise = attempt;
      void attempt.then(() => {
        if (logoutPromise === attempt) logoutPromise = null;
      });
    }
    return logoutPromise;
  };

  const onLogout = () => { void logout(); };

  return Object.freeze({
    activate() {
      if (retired) return Promise.resolve(false);
      if (!activationPromise) {
        const activationGeneration = ++generation;
        renderingAvailable = true;
        if (!publish({ status: AUTH_SESSION_STATUS.LOADING, user: null }, activationGeneration)) {
          return Promise.resolve(false);
        }
        const attempt = (async () => {
          try {
            if (typeof loadConfig !== 'function' || typeof createClientOwner !== 'function' || typeof createSessionService !== 'function') {
              return false;
            }
            const configModule = await loadConfig();
            if (retired || activationGeneration !== generation) return false;
            if (!owner) {
              owner = createClientOwner({
                config: configModule?.SUPABASE_CONFIG,
                sdk,
                profile: SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION,
              });
            }
            const client = owner.initialize(SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
            if (retired || activationGeneration !== generation) return false;
            if (!clientReadyNotified && typeof onClientReady === 'function') {
              clientReadyNotified = true;
              try { onClientReady(client); } catch { /* Additive consumers cannot break Auth. */ }
            }
            service = createSessionService(client);
            unsubscribe = service.subscribe((state) => publish(state, activationGeneration));
            if (!logoutInstalled) {
              elements.logout.addEventListener('click', onLogout);
              logoutInstalled = true;
            }
            await service.bootstrap();
            if (!renderingAvailable) {
              releaseSession();
              return false;
            }
            return !retired && activationGeneration === generation;
          } catch {
            if (!retired && activationGeneration === generation) {
              publish({ status: AUTH_SESSION_STATUS.ERROR, user: null }, activationGeneration);
            }
            releaseSession();
            return false;
          }
        })();
        activationPromise = attempt;
        void attempt.then((activated) => {
          if (!activated && !retired && activationPromise === attempt) activationPromise = null;
        });
      }
      return activationPromise;
    },

    logout,

    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      releaseSession();
      if (logoutInstalled) {
        try { elements.logout.removeEventListener('click', onLogout); } catch { /* DOM cleanup stays private. */ }
        logoutInstalled = false;
      }
      try { elements.root.setAttribute('aria-busy', 'false'); } catch { /* Retired UI stays isolated. */ }
      return true;
    },
  });
}
