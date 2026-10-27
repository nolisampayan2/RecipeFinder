import { createPkceBrowserInitializer } from './supabase-browser.js';
import {
  activateRegistrationSubmitController,
  createRegistrationSubmitController,
} from './auth-ui.js';

export const REGISTRATION_CLIENT_STATE = Object.freeze({
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
});

export function createRegistrationClientActivation(dependencies) {
  const initializer = createPkceBrowserInitializer(dependencies);

  return Object.freeze({
    activate() {
      return initializer.initialize();
    },
  });
}

export function createRegistrationControllerActivation({
  registrationService,
  createController = createRegistrationSubmitController,
  installController = activateRegistrationSubmitController,
} = {}) {
  let activated = false;

  return Object.freeze({
    activate() {
      if (activated) return true;
      if (typeof registrationService?.submit !== 'function') return false;
      if (typeof createController !== 'function' || typeof installController !== 'function') return false;

      const controller = createController(registrationService.submit.bind(registrationService));
      activated = installController(controller) === true;
      return activated;
    },
  });
}

function setReadinessState(root, state) {
  if (root?.dataset) root.dataset.supabaseClientState = state;
}

export function createRegistrationPageInitialization({ loadConfig, sdk, root } = {}) {
  let initializationPromise;

  return Object.freeze({
    initialize() {
      if (!initializationPromise) {
        initializationPromise = (async () => {
          try {
            if (typeof loadConfig !== 'function') throw new TypeError('Public configuration loader is unavailable.');

            const configModule = await loadConfig();
            const activation = createRegistrationClientActivation({
              config: configModule?.SUPABASE_CONFIG,
              sdk,
            });
            activation.activate();
            setReadinessState(root, REGISTRATION_CLIENT_STATE.READY);
            return REGISTRATION_CLIENT_STATE.READY;
          } catch {
            setReadinessState(root, REGISTRATION_CLIENT_STATE.UNAVAILABLE);
            return REGISTRATION_CLIENT_STATE.UNAVAILABLE;
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
  const pageInitialization = createRegistrationPageInitialization({
    loadConfig: loadLocalPublicConfig,
    sdk: globalThis.supabase,
    root: document.documentElement,
  });
  void pageInitialization.initialize();
}
