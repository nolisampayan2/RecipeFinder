// Copy this file to supabase-config.js for local development, or generate it
// from SUPABASE_URL plus exactly one of SUPABASE_PUBLISHABLE_KEY or
// SUPABASE_ANON_KEY during a reviewed deployment build.
// Never place a service_role key, secret key, database password, or management
// token in browser code. RLS remains the authorization boundary.
export const SUPABASE_CONFIG = Object.freeze({
  url: 'https://YOUR_PROJECT_REF.supabase.co',
  publishableKey: 'YOUR_SUPABASE_PUBLISHABLE_KEY',
});
