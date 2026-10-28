import { createPkceBrowserInitializer } from './supabase-browser.js';
import {
  CONFIRMATION_MESSAGES,
  CONFIRMATION_STATUS,
  createPkceConfirmationController,
} from './auth-callback.js';
import { createPkceCodeExchangeAdapter } from './auth-callback-exchange.js';

export const CALLBACK_CLIENT_STATE = Object.freeze({
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
});

/**
 * Creates an explicit, callback-scoped PKCE client initialization context.
 * Importing this module never reads configuration or constructs a client.
 */
export function createCallbackClientInitialization(dependencies) {
  const initializer = createPkceBrowserInitializer(dependencies);

  return Object.freeze({
    initialize() {
      return initializer.initialize();
    },
  });
}

function unavailableConfirmation() {
  return Object.freeze({
    status: CONFIRMATION_STATUS.UNAVAILABLE,
    message: CONFIRMATION_MESSAGES.UNAVAILABLE,
  });
}

export function createManualLoginConfirmationOrchestration({
  client,
  preparedCallback,
  createExchangeAdapter = createPkceCodeExchangeAdapter,
  createController = createPkceConfirmationController,
} = {}) {
  let activationPromise;

  return Object.freeze({
    activate() {
      if (!activationPromise) {
        activationPromise = (async () => {
          if (
            !client?.auth ||
            typeof client.auth.exchangeCodeForSession !== 'function' ||
            typeof client.auth.signOut !== 'function' ||
            typeof createExchangeAdapter !== 'function' ||
            typeof createController !== 'function'
          ) {
            return unavailableConfirmation();
          }

          try {
            const exchangeCode = createExchangeAdapter(client);
            const exchangeAndClearSession = async (code) => {
              const exchangeResult = await exchangeCode(code);
              if (exchangeResult?.error || !exchangeResult?.data?.confirmed) {
                return Object.freeze({ data: null, error: true });
              }

              try {
                const signOutResult = await client.auth.signOut({ scope: 'local' });
                if (!signOutResult || typeof signOutResult !== 'object' || signOutResult.error) {
                  return Object.freeze({ data: null, error: true });
                }
              } catch {
                return Object.freeze({ data: null, error: true });
              }

              return Object.freeze({
                data: Object.freeze({ confirmed: true, signedOut: true }),
                error: null,
              });
            };

            const controller = createController({ exchangeAuthorizationCode: exchangeAndClearSession });
            return await controller.process({ preparedCallback });
          } catch {
            return unavailableConfirmation();
          }
        })();
      }

      return activationPromise;
    },
  });
}

function setReadinessState(root, state) {
  if (root?.dataset) root.dataset.supabaseClientState = state;
}

export function createCallbackPageInitialization({ loadConfig, sdk, root } = {}) {
  let initializationPromise;

  return Object.freeze({
    initialize() {
      if (!initializationPromise) {
        initializationPromise = (async () => {
          try {
            if (typeof loadConfig !== 'function') throw new TypeError('Public configuration loader is unavailable.');

            const configModule = await loadConfig();
            const initialization = createCallbackClientInitialization({
              config: configModule?.SUPABASE_CONFIG,
              sdk,
            });
            initialization.initialize();
            setReadinessState(root, CALLBACK_CLIENT_STATE.READY);
            return CALLBACK_CLIENT_STATE.READY;
          } catch {
            setReadinessState(root, CALLBACK_CLIENT_STATE.UNAVAILABLE);
            return CALLBACK_CLIENT_STATE.UNAVAILABLE;
          }
        })();
      }

      return initializationPromise;
    },
  });
}

async function loadLocalPublicConfig() {
  return import('./supabase-config.js');
}

if (typeof document !== 'undefined') {
  const pageInitialization = createCallbackPageInitialization({
    loadConfig: loadLocalPublicConfig,
    sdk: globalThis.supabase,
    root: document.documentElement,
  });
  void pageInitialization.initialize();
}
