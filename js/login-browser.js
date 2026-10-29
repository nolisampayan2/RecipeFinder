import { createLoginService } from './login.js';
import {
  activateLoginSubmitController,
  createLoginSubmitController,
  deactivateLoginSubmitController,
} from './auth-ui.js';

/**
 * Prepares a login controller without initializing a client or touching the DOM.
 * Activation must be invoked explicitly by a separately reviewed page entrypoint.
 */
export function createLoginControllerActivation({
  loginService,
  client,
  createService = createLoginService,
  createController = createLoginSubmitController,
  installController = activateLoginSubmitController,
  removeController = deactivateLoginSubmitController,
} = {}) {
  let controller = null;
  let activated = false;

  return Object.freeze({
    activate() {
      if (activated) return true;
      if (typeof createController !== 'function' || typeof installController !== 'function') return false;

      if (!controller) {
        let service = loginService;
        if (typeof service?.submit !== 'function') {
          if (typeof createService !== 'function') return false;
          try {
            service = createService(client);
          } catch {
            return false;
          }
        }

        try {
          controller = createController(service.submit.bind(service));
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
