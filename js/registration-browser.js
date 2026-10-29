import { createPkceBrowserInitializer } from './supabase-browser.js';
import { createRegistrationService } from './registration.js';
import {
  activateRegistrationSubmitController,
  createRegistrationSubmitController,
  deactivateRegistrationSubmitController,
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
  removeController = deactivateRegistrationSubmitController,
} = {}) {
  let controller = null;
  let activated = false;

  return Object.freeze({
    activate() {
      if (activated) return true;
      if (typeof registrationService?.submit !== 'function') return false;
      if (typeof createController !== 'function' || typeof installController !== 'function') return false;

      if (!controller) {
        try {
          controller = createController(registrationService.submit.bind(registrationService));
        } catch {
          controller = null;
          return false;
        }
      }

      try {
        controller.activate?.();
        activated = installController(controller) === true;
        if (!activated) controller.deactivate?.();
      } catch {
        controller.deactivate?.();
        activated = false;
      }
      return activated;
    },

    cleanup() {
      if (!activated || !controller || typeof removeController !== 'function') return false;
      let removed = false;
      try {
        removed = removeController(controller) === true;
      } catch {
        return false;
      }
      if (removed) {
        controller.deactivate?.();
        activated = false;
      }
      return removed;
    },
  });
}

/**
 * Composes the cached PKCE client, registration service, and UI controller.
 * Nothing is initialized or installed until activate() is called explicitly.
 */
export function createRegistrationComposition({
  clientActivation,
  clientDependencies,
  registrationService,
  createClientActivation = createRegistrationClientActivation,
  createService = createRegistrationService,
  createControllerActivation = createRegistrationControllerActivation,
  createController = createRegistrationSubmitController,
  installController = activateRegistrationSubmitController,
  removeController = deactivateRegistrationSubmitController,
} = {}) {
  let preparedClientActivation = clientActivation ?? null;
  let controllerActivation = null;

  return Object.freeze({
    activate() {
      if (!controllerActivation) {
        let service = registrationService;

        if (typeof service?.submit !== 'function') {
          if (typeof createClientActivation !== 'function' || typeof createService !== 'function') return false;

          try {
            if (!preparedClientActivation) {
              preparedClientActivation = createClientActivation(clientDependencies);
            }
            const client = preparedClientActivation?.activate?.();
            service = createService(client);
          } catch {
            return false;
          }
        }

        if (typeof createControllerActivation !== 'function') return false;
        try {
          controllerActivation = createControllerActivation({
            registrationService: service,
            createController,
            installController,
            removeController,
          });
        } catch {
          controllerActivation = null;
          return false;
        }
      }

      try {
        return controllerActivation?.activate?.() === true;
      } catch {
        return false;
      }
    },

    cleanup() {
      if (!controllerActivation) return false;
      try {
        return controllerActivation.cleanup?.() === true;
      } catch {
        return false;
      }
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

export async function loadLocalPublicConfig() {
  return import('./supabase-config.js');
}
