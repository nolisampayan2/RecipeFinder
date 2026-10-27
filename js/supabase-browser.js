import {
  SUPABASE_CLIENT_PROFILE,
  initializeSupabaseClient,
} from './supabase-client.js';

/**
 * Creates an explicitly invoked, single-client initialization context.
 *
 * Both public configuration and the SDK are injected by the caller. Importing
 * this module performs no validation, storage access, client creation, or
 * network operation. This module is intentionally not loaded by a live page.
 */
export function createPkceBrowserInitializer({ config, sdk } = {}) {
  let client;

  return Object.freeze({
    initialize() {
      if (!client) {
        client = initializeSupabaseClient(
          config,
          sdk,
          SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION
        );
      }

      return client;
    },
  });
}
