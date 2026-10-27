import { createPkceBrowserInitializer } from './supabase-browser.js';

// Importing this registration-only entrypoint does not create a client. A
// future reviewed integration must inject public configuration and the pinned
// SDK, create an activation context, and call activate() explicitly.
export function createRegistrationClientActivation(dependencies) {
  const initializer = createPkceBrowserInitializer(dependencies);

  return Object.freeze({
    activate() {
      return initializer.initialize();
    },
  });
}
