import { createSupabasePageClientOwner } from './supabase-browser.js';
import { SUPABASE_CLIENT_PROFILE } from './supabase-client.js';
import {
  CONFIRMATION_MESSAGES,
  CONFIRMATION_STATUS,
  confirmationResultView,
  createPkceConfirmationController,
  renderCallbackView,
  takePreparedAuthCallbackRequest,
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
export function createCallbackClientInitialization({
  config,
  sdk,
  owner = createSupabasePageClientOwner({
    config,
    sdk,
    profile: SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION,
  }),
} = {}) {

  return Object.freeze({
    profile: SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION,

    initialize() {
      return owner.initialize(SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION);
    },
  });
}

function unavailableConfirmation() {
  return Object.freeze({
    status: CONFIRMATION_STATUS.UNAVAILABLE,
    message: CONFIRMATION_MESSAGES.UNAVAILABLE,
  });
}

function normalizeConfirmation(result) {
  return Object.freeze(result?.status === CONFIRMATION_STATUS.CONFIRMED
    ? { status: CONFIRMATION_STATUS.CONFIRMED, message: CONFIRMATION_MESSAGES.CONFIRMED }
    : { status: CONFIRMATION_STATUS.UNAVAILABLE, message: CONFIRMATION_MESSAGES.UNAVAILABLE });
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
              if (!hasExplicitSuccess(exchangeResult) || exchangeResult.data?.confirmed !== true) {
                return Object.freeze({ data: null, error: true });
              }

              try {
                const signOutResult = await client.auth.signOut({ scope: 'local' });
                if (!hasExplicitSuccess(signOutResult)) {
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

/**
 * Prepares one explicit callback exchange lifecycle without connecting it to
 * page initialization. Construction and import perform no Auth operation.
 */
export function createCallbackConfirmationComposition({
  preparedCallback,
  takePreparedCallback = takePreparedAuthCallbackRequest,
  clientInitialization,
  clientDependencies,
  root,
  createClientInitialization = createCallbackClientInitialization,
  createOrchestration = createManualLoginConfirmationOrchestration,
  renderView = renderCallbackView,
  createView = confirmationResultView,
} = {}) {
  let preparedClientInitialization = clientInitialization ?? null;
  let callbackConsumed = false;
  let activationPromise = null;
  let generation = 0;
  let cleanedUp = false;

  return Object.freeze({
    activate() {
      if (!activationPromise) {
        const activationGeneration = ++generation;
        activationPromise = (async () => {
          if (
            cleanedUp
            || !root
            || typeof createClientInitialization !== 'function'
            || typeof createOrchestration !== 'function'
            || typeof renderView !== 'function'
            || typeof createView !== 'function'
          ) return unavailableConfirmation();

          let callbackRequest = null;
          if (!callbackConsumed) {
            callbackConsumed = true;
            if (preparedCallback) {
              callbackRequest = preparedCallback;
              preparedCallback = null;
            } else if (typeof takePreparedCallback === 'function') {
              callbackRequest = takePreparedCallback();
            }
          }

          try {
            if (!preparedClientInitialization) {
              preparedClientInitialization = createClientInitialization(clientDependencies);
            }
            const client = preparedClientInitialization?.initialize?.();
            const orchestration = createOrchestration({ client, preparedCallback: callbackRequest });
            const result = normalizeConfirmation(await orchestration?.activate?.());

            if (!cleanedUp && activationGeneration === generation) {
              renderView(root, createView(result));
            }
            return result;
          } catch {
            const result = unavailableConfirmation();
            if (!cleanedUp && activationGeneration === generation) {
              try {
                renderView(root, createView(result));
              } catch {
                // Rendering failures must not expose provider or callback details.
              }
            }
            return result;
          }
        })();
      }

      return activationPromise;
    },

    cleanup() {
      if (cleanedUp) return false;
      cleanedUp = true;
      generation += 1;
      return true;
    },
  });
}

function setReadinessState(root, state) {
  if (root?.dataset) root.dataset.supabaseClientState = state;
}

export function createCallbackPageInitialization({ loadConfig, sdk, root } = {}) {
  let initializationPromise;
  let preparedClientInitialization;
  let readinessSucceeded = false;

  const sharedClientInitialization = Object.freeze({
    initialize() {
      if (!readinessSucceeded || !preparedClientInitialization) {
        throw new TypeError('Callback client readiness has not completed.');
      }
      return preparedClientInitialization.initialize();
    },
  });

  return Object.freeze({
    initialize() {
      if (!initializationPromise) {
        const attempt = (async () => {
          try {
            if (typeof loadConfig !== 'function') throw new TypeError('Public configuration loader is unavailable.');

            if (!preparedClientInitialization) {
              const configModule = await loadConfig();
              preparedClientInitialization = createCallbackClientInitialization({
                config: configModule?.SUPABASE_CONFIG,
                sdk,
              });
            }
            preparedClientInitialization.initialize();
            setReadinessState(root, CALLBACK_CLIENT_STATE.READY);
            readinessSucceeded = true;
            return CALLBACK_CLIENT_STATE.READY;
          } catch {
            readinessSucceeded = false;
            setReadinessState(root, CALLBACK_CLIENT_STATE.UNAVAILABLE);
            return CALLBACK_CLIENT_STATE.UNAVAILABLE;
          }
        })();
        initializationPromise = attempt;
        void attempt.then((state) => {
          if (state === CALLBACK_CLIENT_STATE.UNAVAILABLE && initializationPromise === attempt) {
            initializationPromise = null;
          }
        });
      }

      return initializationPromise;
    },

    createConfirmationComposition(options = {}) {
      return createCallbackConfirmationComposition({
        ...options,
        clientInitialization: sharedClientInitialization,
      });
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
