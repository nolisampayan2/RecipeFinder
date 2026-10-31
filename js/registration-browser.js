import { createSupabasePageClientOwner } from './supabase-browser.js';
import {
  SUPABASE_CLIENT_PROFILE,
  SUPABASE_SDK_VERSION,
  SUPABASE_UMD_URL,
  SupabaseConfigurationError,
} from './supabase-client.js';
import {
  REGISTRATION_MESSAGES,
  createRegistrationService,
  resolveRegistrationCallbackUrl,
} from './registration.js';
import {
  activateRegistrationSubmitController,
  createRegistrationSubmitController,
  deactivateRegistrationSubmitController,
} from './auth-ui.js';

export const REGISTRATION_CLIENT_STATE = Object.freeze({
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
});

function registrationClientInitializationFailure() {
  return new SupabaseConfigurationError('Supabase client initialization failed.');
}

const SAFE_REGISTRATION_CONFIGURATION_MESSAGES = new Set([
  'Supabase public configuration is missing.',
  'Supabase Project URL is missing or malformed.',
  'Supabase Project URL must be an HTTPS origin without credentials, paths, query parameters, or fragments.',
  'Supabase publishable key is missing or malformed.',
  'Privileged Supabase keys are forbidden in browser configuration.',
  'Supabase client initialization is already in progress.',
  `Supabase JavaScript ${SUPABASE_SDK_VERSION} is not loaded. Load ${SUPABASE_UMD_URL} before the module entrypoint.`,
]);

function getSafeRegistrationConfigurationMessage(error) {
  try {
    if (!(error instanceof SupabaseConfigurationError)) return null;
    const message = error.message;
    return typeof message === 'string' && SAFE_REGISTRATION_CONFIGURATION_MESSAGES.has(message)
      ? message
      : null;
  } catch {
    return null;
  }
}

export function createRegistrationClientActivation(options = {}) {
  let config;
  let sdk;
  let owner;
  let createClientOwner;
  try {
    config = options?.config;
    sdk = options?.sdk;
    owner = options?.owner;
    createClientOwner = options?.createClientOwner;
  } catch {
    throw registrationClientInitializationFailure();
  }
  if (createClientOwner === undefined) createClientOwner = createSupabasePageClientOwner;

  let preparedOwner = owner ?? null;
  const trustedDefaultOwner = owner == null && createClientOwner === createSupabasePageClientOwner;

  return Object.freeze({
    profile: SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION,

    activate() {
      if (!preparedOwner) {
        if (typeof createClientOwner !== 'function') throw registrationClientInitializationFailure();
        try {
          preparedOwner = createClientOwner({
            config,
            sdk,
            profile: SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION,
          });
        } catch {
          throw registrationClientInitializationFailure();
        }
      }

      try {
        return preparedOwner.initialize(SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION);
      } catch (error) {
        const safeMessage = trustedDefaultOwner
          ? getSafeRegistrationConfigurationMessage(error)
          : null;
        if (safeMessage) throw new SupabaseConfigurationError(safeMessage);
        throw registrationClientInitializationFailure();
      }
    },
  });
}

export function createRegistrationControllerActivation(options = {}) {
  let registrationService;
  let createController;
  let installController;
  let removeController;
  try {
    registrationService = options?.registrationService;
    createController = options?.createController;
    installController = options?.installController;
    removeController = options?.removeController;
  } catch {
    return Object.freeze({ activate: () => false, cleanup: () => false });
  }
  if (createController === undefined) createController = createRegistrationSubmitController;
  if (installController === undefined) installController = activateRegistrationSubmitController;
  if (removeController === undefined) removeController = deactivateRegistrationSubmitController;
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
export function createRegistrationComposition(options = {}) {
  let clientActivation;
  let clientDependencies;
  let registrationService;
  let createClientActivation;
  let createService;
  let createControllerActivation;
  let createController;
  let installController;
  let removeController;
  try {
    clientActivation = options?.clientActivation;
    clientDependencies = options?.clientDependencies;
    registrationService = options?.registrationService;
    createClientActivation = options?.createClientActivation;
    createService = options?.createService;
    createControllerActivation = options?.createControllerActivation;
    createController = options?.createController;
    installController = options?.installController;
    removeController = options?.removeController;
  } catch {
    return Object.freeze({ activate: () => false, cleanup: () => false });
  }
  if (createClientActivation === undefined) createClientActivation = createRegistrationClientActivation;
  if (createService === undefined) createService = createRegistrationService;
  if (createControllerActivation === undefined) createControllerActivation = createRegistrationControllerActivation;
  if (createController === undefined) createController = createRegistrationSubmitController;
  if (installController === undefined) installController = activateRegistrationSubmitController;
  if (removeController === undefined) removeController = deactivateRegistrationSubmitController;
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
  try {
    if (root?.dataset) root.dataset.supabaseClientState = state;
  } catch {
    // Readiness state is advisory; hostile DOM-like dependencies stay private.
  }
}

export function createRegistrationPageInitialization(options = {}) {
  let loadConfig;
  let sdk;
  let root;
  let createClientActivation;
  let createComposition;
  try {
    loadConfig = options?.loadConfig;
    sdk = options?.sdk;
    root = options?.root;
    createClientActivation = options?.createClientActivation;
    createComposition = options?.createComposition;
  } catch {
    throw registrationClientInitializationFailure();
  }
  if (createClientActivation === undefined) createClientActivation = createRegistrationClientActivation;
  if (createComposition === undefined) createComposition = createRegistrationComposition;

  let initializationPromise;
  let preparedClientActivation;
  let readinessSucceeded = false;

  const sharedClientActivation = Object.freeze({
    activate() {
      if (!readinessSucceeded || !preparedClientActivation) {
        throw registrationClientInitializationFailure();
      }
      return preparedClientActivation.activate();
    },
  });

  return Object.freeze({
    initialize() {
      if (!initializationPromise) {
        const attempt = (async () => {
          try {
            if (typeof loadConfig !== 'function') throw new TypeError('Public configuration loader is unavailable.');
            if (typeof createClientActivation !== 'function') throw new TypeError('Client activation factory is unavailable.');

            if (!preparedClientActivation) {
              const configModule = await loadConfig();
              let config;
              try {
                config = configModule?.SUPABASE_CONFIG;
              } catch {
                throw registrationClientInitializationFailure();
              }
              preparedClientActivation = createClientActivation({ config, sdk });
            }
            preparedClientActivation.activate();
            setReadinessState(root, REGISTRATION_CLIENT_STATE.READY);
            readinessSucceeded = true;
            return REGISTRATION_CLIENT_STATE.READY;
          } catch {
            readinessSucceeded = false;
            setReadinessState(root, REGISTRATION_CLIENT_STATE.UNAVAILABLE);
            return REGISTRATION_CLIENT_STATE.UNAVAILABLE;
          }
        })();
        initializationPromise = attempt;
        void attempt.then((state) => {
          if (state === REGISTRATION_CLIENT_STATE.UNAVAILABLE && initializationPromise === attempt) {
            initializationPromise = null;
          }
        });
      }

      return initializationPromise;
    },

    createComposition(compositionOptions = {}) {
      if (typeof createComposition !== 'function') {
        return Object.freeze({ activate: () => false, cleanup: () => false });
      }
      let preparedOptions;
      try {
        preparedOptions = {
          ...compositionOptions,
          clientActivation: sharedClientActivation,
        };
      } catch {
        return Object.freeze({ activate: () => false, cleanup: () => false });
      }
      try {
        return createComposition(preparedOptions);
      } catch {
        return Object.freeze({ activate: () => false, cleanup: () => false });
      }
    },
  });
}

export async function loadLocalPublicConfig() {
  return import('./supabase-config.js');
}

const REGISTRATION_LOADING_MESSAGE = 'Preparing secure account registration.';

function setRegistrationReadiness(documentLike, { available, busy, message = '', isError = false }) {
  try {
    const form = documentLike?.querySelector?.('[data-auth-form="register"]');
    const submit = form?.querySelector?.('[type="submit"]');
    const status = form?.querySelector?.('[data-form-status]');
    if (submit) submit.disabled = !available;
    form?.setAttribute?.('aria-busy', String(busy));
    if (status) {
      status.textContent = message;
      status.classList?.toggle?.('is-error', isError);
    }
  } catch {
    // Page readiness failures must not expose dependency details.
  }
}

export function createLiveRegistrationPageActivation(options = {}) {
  let loadConfig;
  let sdk;
  let root;
  let documentLike;
  let location;
  let createPageInitialization;
  try {
    loadConfig = options?.loadConfig;
    sdk = options?.sdk;
    root = options?.root;
    documentLike = options?.document;
    location = options?.location;
    createPageInitialization = options?.createPageInitialization;
  } catch {
    throw registrationClientInitializationFailure();
  }
  if (loadConfig === undefined) loadConfig = loadLocalPublicConfig;
  if (sdk === undefined) sdk = globalThis.supabase;
  if (root === undefined) root = globalThis.document?.documentElement;
  if (documentLike === undefined) documentLike = globalThis.document;
  if (location === undefined) location = globalThis.location;
  if (createPageInitialization === undefined) createPageInitialization = createRegistrationPageInitialization;

  let activationPromise;
  let pageInitialization;
  let composition;
  let generation = 0;
  let retired = false;

  return Object.freeze({
    activate() {
      if (retired) return Promise.resolve(false);
      if (!activationPromise) {
        const activationGeneration = ++generation;
        const attempt = (async () => {
          let activated = false;
          setRegistrationReadiness(documentLike, {
            available: false,
            busy: true,
            message: REGISTRATION_LOADING_MESSAGE,
          });
          try {
            if (!pageInitialization) {
              pageInitialization = createPageInitialization({ loadConfig, sdk, root });
            }
            if (await pageInitialization.initialize() !== REGISTRATION_CLIENT_STATE.READY) return false;
            if (retired || activationGeneration !== generation) return false;

            const callbackUrl = resolveRegistrationCallbackUrl(location);
            const applicationOrigin = new URL(callbackUrl).origin;
            composition = pageInitialization.createComposition({
              createService(client) {
                return createRegistrationService(client, { callbackUrl, applicationOrigin });
              },
            });
            if (retired || activationGeneration !== generation) return false;
            activated = composition?.activate?.() === true;
            if (retired || activationGeneration !== generation) {
              try { composition?.cleanup?.(); } catch { /* Retired work stays private. */ }
              return false;
            }
            setRegistrationReadiness(documentLike, {
              available: activated,
              busy: false,
              message: activated ? '' : REGISTRATION_MESSAGES.UNAVAILABLE,
              isError: !activated,
            });
            return activated;
          } catch {
            return false;
          } finally {
            if (!retired && activationGeneration === generation && !activated) {
              setRegistrationReadiness(documentLike, {
                available: false,
                busy: false,
                message: REGISTRATION_MESSAGES.UNAVAILABLE,
                isError: true,
              });
            }
          }
        })();
        activationPromise = attempt;
        void attempt.then((activated) => {
          if (!activated && activationPromise === attempt) activationPromise = null;
        });
      }
      return activationPromise;
    },

    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      setRegistrationReadiness(documentLike, {
        available: false,
        busy: false,
        message: REGISTRATION_MESSAGES.UNAVAILABLE,
        isError: true,
      });
      try {
        composition?.cleanup?.();
      } catch {
        // The lifecycle is retired even if controller cleanup fails.
      }
      return true;
    },
  });
}

if (typeof document !== 'undefined') {
  const liveRegistration = createLiveRegistrationPageActivation();
  void liveRegistration.activate();
}
