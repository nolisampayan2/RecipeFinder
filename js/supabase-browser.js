import {
  SUPABASE_CLIENT_PROFILE,
  SupabaseConfigurationError,
  initializeSupabaseClient,
  validateSupabaseConfig,
} from './supabase-client.js';

const SUPPORTED_PAGE_PROFILES = new Set(Object.values(SUPABASE_CLIENT_PROFILE));

function consumeNativePromiseRejection(value) {
  try {
    if (!(value instanceof Promise)) return false;
    Promise.prototype.then.call(value, undefined, () => {});
    return true;
  } catch {
    return false;
  }
}

function isValidSupabaseClient(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (consumeNativePromiseRejection(value)) return false;

  try {
    if (typeof value.then === 'function') return false;
    return Boolean(value.auth && typeof value.auth === 'object' && !Array.isArray(value.auth));
  } catch {
    return false;
  }
}

function initializationFailure() {
  return new SupabaseConfigurationError('Supabase client initialization failed.');
}

/**
 * Creates one explicit client owner for one browser page lifecycle.
 *
 * Consumers must share this owner rather than create independent initializers.
 * Construction and import remain inert; the client is created on the first
 * initialize() call and is never implicitly signed out or destroyed.
 */
export function createSupabasePageClientOwner({
  config,
  sdk,
  profile = SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION,
} = {}) {
  if (!SUPPORTED_PAGE_PROFILES.has(profile)) {
    throw new SupabaseConfigurationError('Unknown Supabase client profile.');
  }

  let client;
  let initializing = false;

  return Object.freeze({
    profile,

    initialize(requestedProfile = profile) {
      if (requestedProfile !== profile) {
        throw new SupabaseConfigurationError('A page client owner cannot change profiles.');
      }
      if (client) return client;
      if (initializing) {
        throw new SupabaseConfigurationError('Supabase client initialization is already in progress.');
      }

      initializing = true;
      try {
        // Preserve the foundation's controlled configuration errors before the
        // injected SDK boundary, whose failures must be normalized.
        let validatedConfig;
        try {
          if (!config || typeof config !== 'object' || Array.isArray(config)) {
            validatedConfig = validateSupabaseConfig(config);
          } else {
            validatedConfig = validateSupabaseConfig({
              url: config.url,
              publishableKey: config.publishableKey,
            });
          }
        } catch (error) {
          if (error instanceof SupabaseConfigurationError) throw error;
          throw initializationFailure();
        }

        let createClient;
        try {
          createClient = sdk?.createClient;
        } catch {
          throw initializationFailure();
        }
        if (typeof createClient !== 'function') {
          return initializeSupabaseClient(validatedConfig, null, profile);
        }

        let candidate;
        try {
          candidate = initializeSupabaseClient(validatedConfig, {
            createClient(...args) {
              return createClient.call(sdk, ...args);
            },
          }, profile);
        } catch {
          throw initializationFailure();
        }
        if (!isValidSupabaseClient(candidate)) {
          throw initializationFailure();
        }

        client = candidate;
        return client;
      } finally {
        initializing = false;
      }
    },
  });
}

/**
 * Creates an explicitly invoked, single-client initialization context.
 *
 * Both public configuration and the SDK are injected by the caller. Importing
 * this module performs no validation, storage access, client creation, or
 * network operation. This module is intentionally not loaded by a live page.
 */
export function createPkceBrowserInitializer({ config, sdk } = {}) {
  const owner = createSupabasePageClientOwner({
    config,
    sdk,
    profile: SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION,
  });

  return Object.freeze({
    initialize() {
      return owner.initialize();
    },
  });
}
