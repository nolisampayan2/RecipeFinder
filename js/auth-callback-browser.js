import { createPkceBrowserInitializer } from './supabase-browser.js';

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
