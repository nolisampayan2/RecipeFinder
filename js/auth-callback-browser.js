import { createPkceBrowserInitializer } from './supabase-browser.js';

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
