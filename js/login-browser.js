import { createLoginService } from './login.js';
import { createSupabasePageClientOwner } from './supabase-browser.js';
import {
  SUPABASE_CLIENT_PROFILE,
  SupabaseConfigurationError,
} from './supabase-client.js';
import {
  activateLoginSubmitController,
  createLoginSubmitController,
  deactivateLoginSubmitController,
} from './auth-ui.js';

function loginClientInitializationFailure() {
  return new SupabaseConfigurationError('Supabase client initialization failed.');
}

const SAFE_LOGIN_CONFIGURATION_MESSAGES = new Set([
  'Supabase public configuration is missing.',
  'Supabase Project URL is missing or malformed.',
  'Supabase Project URL must be an HTTPS origin without credentials, paths, query parameters, or fragments.',
  'Supabase publishable key is missing or malformed.',
  'Privileged Supabase keys are forbidden in browser configuration.',
  'Supabase client initialization is already in progress.',
]);

function getSafeLoginConfigurationMessage(error) {
  try {
    if (!(error instanceof SupabaseConfigurationError)) return null;
    const message = error.message;
    return typeof message === 'string' && SAFE_LOGIN_CONFIGURATION_MESSAGES.has(message)
      ? message
      : null;
  } catch {
    return null;
  }
}

/**
 * Creates one inert login-page composition around one application-session
 * client owner. Nothing is constructed until prepareClient() or
 * prepareController() is called explicitly by a future reviewed entrypoint.
 */
export function createLoginPageComposition(options = {}) {
  let clientOwner;
  let clientDependencies;
  let createClientOwner;
  let createControllerActivation;
  try {
    clientOwner = options?.clientOwner;
    clientDependencies = options?.clientDependencies;
    createClientOwner = options?.createClientOwner;
    createControllerActivation = options?.createControllerActivation;
  } catch {
    throw loginClientInitializationFailure();
  }
  if (createClientOwner === undefined) createClientOwner = createSupabasePageClientOwner;
  if (createControllerActivation === undefined) {
    createControllerActivation = createLoginControllerActivation;
  }

  let preparedOwner = clientOwner ?? null;
  const trustedDefaultOwner = clientOwner == null
    && createClientOwner === createSupabasePageClientOwner;

  const prepareClient = () => {
    if (!preparedOwner) {
      if (typeof createClientOwner !== 'function') {
        throw new TypeError('A login page client owner factory is required.');
      }

      let ownerOptions;
      try {
        ownerOptions = {
          ...clientDependencies,
          profile: SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION,
        };
      } catch {
        throw loginClientInitializationFailure();
      }

      let owner;
      try {
        owner = createClientOwner(ownerOptions);
      } catch {
        throw loginClientInitializationFailure();
      }
      preparedOwner = owner;
    }

    try {
      return preparedOwner.initialize(SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION);
    } catch (error) {
      const safeMessage = trustedDefaultOwner
        ? getSafeLoginConfigurationMessage(error)
        : null;
      if (safeMessage) throw new SupabaseConfigurationError(safeMessage);
      throw loginClientInitializationFailure();
    }
  };

  return Object.freeze({
    profile: SUPABASE_CLIENT_PROFILE.APPLICATION_SESSION,

    prepareClient,

    prepareController(options = {}) {
      if (typeof createControllerActivation !== 'function') {
        throw new TypeError('A login controller activation factory is required.');
      }

      let controllerOptions;
      try {
        controllerOptions = { ...options };
      } catch {
        throw loginClientInitializationFailure();
      }
      controllerOptions.client = prepareClient();

      try {
        return createControllerActivation(controllerOptions);
      } catch {
        throw loginClientInitializationFailure();
      }
    },
  });
}

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
