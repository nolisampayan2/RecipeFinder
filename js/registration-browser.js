// This registration-only entrypoint intentionally prepares an import seam
// without creating a client. Future activation must add an explicit, reviewed
// configuration import and initializer invocation in source code.
export {
  createPkceBrowserInitializer as prepareRegistrationPkceClient,
} from './supabase-browser.js';
