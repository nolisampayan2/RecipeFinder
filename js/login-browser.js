import { LOGIN_MESSAGES, LOGIN_STATUS, createLoginService } from './login.js';
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

async function loadLocalPublicConfig() {
  return import('./supabase-config.js');
}

const LOGIN_LOADING_MESSAGE = 'Preparing secure sign-in.';

function setLoginReadiness(documentLike, { available, busy, message = '', isError = false }) {
  try {
    const form = documentLike?.querySelector?.('[data-auth-form="login"]');
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

export function createLiveLoginPageActivation(options = {}) {
  let loadConfig;
  let sdk;
  let documentLike;
  let navigate;
  let createPageComposition;
  try {
    loadConfig = options?.loadConfig;
    sdk = options?.sdk;
    documentLike = options?.document;
    navigate = options?.navigate;
    createPageComposition = options?.createPageComposition;
  } catch {
    throw loginClientInitializationFailure();
  }
  if (loadConfig === undefined) loadConfig = loadLocalPublicConfig;
  if (sdk === undefined) sdk = globalThis.supabase;
  if (documentLike === undefined) documentLike = globalThis.document;
  if (navigate === undefined) navigate = () => globalThis.location?.assign?.('index.html');
  if (createPageComposition === undefined) createPageComposition = createLoginPageComposition;

  let activationPromise;
  let pageComposition;
  let controllerActivation;
  let generation = 0;
  let retired = false;

  return Object.freeze({
    activate() {
      if (retired) return Promise.resolve(false);
      if (!activationPromise) {
        const activationGeneration = ++generation;
        const attempt = (async () => {
          let activated = false;
          setLoginReadiness(documentLike, {
            available: false,
            busy: true,
            message: LOGIN_LOADING_MESSAGE,
          });
          try {
            if (typeof loadConfig !== 'function' || typeof createPageComposition !== 'function') return false;
            if (!pageComposition) {
              const configModule = await loadConfig();
              if (retired || activationGeneration !== generation) return false;
              pageComposition = createPageComposition({
                clientDependencies: { config: configModule?.SUPABASE_CONFIG, sdk },
              });
            }
            if (retired || activationGeneration !== generation) return false;
            if (!controllerActivation) {
              controllerActivation = pageComposition.prepareController({
                createService(client) {
                  const service = createLoginService(client);
                  return Object.freeze({
                    async submit(input) {
                      const submissionGeneration = generation;
                      const result = await service.submit(input);
                      if (
                        result?.status === LOGIN_STATUS.AUTHENTICATED
                        && !retired
                        && submissionGeneration === generation
                      ) {
                        try { navigate('index.html'); } catch { /* Navigation remains best-effort. */ }
                      }
                      return result;
                    },
                  });
                },
              });
            }
            if (retired || activationGeneration !== generation) return false;
            activated = controllerActivation?.activate?.() === true;
            if (retired || activationGeneration !== generation) {
              try { controllerActivation?.cleanup?.(); } catch { /* Retired work stays private. */ }
              return false;
            }
            setLoginReadiness(documentLike, {
              available: activated,
              busy: false,
              message: activated ? '' : LOGIN_MESSAGES.UNAVAILABLE,
              isError: !activated,
            });
            return activated;
          } catch {
            return false;
          } finally {
            if (!retired && activationGeneration === generation && !activated) {
              setLoginReadiness(documentLike, {
                available: false,
                busy: false,
                message: LOGIN_MESSAGES.UNAVAILABLE,
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
      setLoginReadiness(documentLike, {
        available: false,
        busy: false,
        message: LOGIN_MESSAGES.UNAVAILABLE,
        isError: true,
      });
      try {
        controllerActivation?.cleanup?.();
      } catch {
        // The lifecycle is retired even if controller cleanup fails.
      }
      return true;
    },
  });
}

if (typeof document !== 'undefined') {
  const liveLogin = createLiveLoginPageActivation();
  void liveLogin.activate();
}
