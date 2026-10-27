export const SUPABASE_SDK_VERSION = '2.118.0';
export const SUPABASE_UMD_URL = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_SDK_VERSION}/dist/umd/supabase.js`;
export const SUPABASE_UMD_INTEGRITY = 'sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK';

export const SUPABASE_CLIENT_PROFILE = Object.freeze({
  FOUNDATION: 'foundation',
  PKCE_PREPARATION: 'pkce-preparation',
});

export const PKCE_STORAGE_REQUIREMENT =
  'PKCE uses persistent browser storage for both the email-round-trip verifier and any resulting session; hosted behavior still requires real-browser verification before activation.';

const CONTROL_OR_WHITESPACE = /[\u0000-\u0020\u007f]/;
const PLACEHOLDER_VALUE = /YOUR_|PROJECT_REF|REPLACE_|<[^>]+>/i;
const PRIVILEGED_KEY_MARKER = /service[_-]?role|supabase[_-]?admin/i;

export class SupabaseConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupabaseConfigurationError';
  }
}

function decodeJwtPayload(value) {
  const parts = value.split('.');
  if (parts.length !== 3 || typeof globalThis.atob !== 'function') return null;

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(globalThis.atob(padded));
  } catch {
    return null;
  }
}

function validateProjectUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new SupabaseConfigurationError('Supabase Project URL is missing or malformed.');
  }

  if (CONTROL_OR_WHITESPACE.test(value) || value.includes('\\') || PLACEHOLDER_VALUE.test(value)) {
    throw new SupabaseConfigurationError('Supabase Project URL is missing or malformed.');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new SupabaseConfigurationError('Supabase Project URL is missing or malformed.');
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new SupabaseConfigurationError('Supabase Project URL must be an HTTPS origin without credentials, paths, query parameters, or fragments.');
  }

  return parsed.origin;
}

function validatePublishableKey(value) {
  if (typeof value !== 'string' || value.length < 20 || value !== value.trim()) {
    throw new SupabaseConfigurationError('Supabase publishable key is missing or malformed.');
  }

  if (CONTROL_OR_WHITESPACE.test(value) || PLACEHOLDER_VALUE.test(value)) {
    throw new SupabaseConfigurationError('Supabase publishable key is missing or malformed.');
  }

  if (value.startsWith('sb_secret_') || PRIVILEGED_KEY_MARKER.test(value)) {
    throw new SupabaseConfigurationError('Privileged Supabase keys are forbidden in browser configuration.');
  }

  const jwtPayload = decodeJwtPayload(value);
  if (jwtPayload && PRIVILEGED_KEY_MARKER.test(String(jwtPayload.role || ''))) {
    throw new SupabaseConfigurationError('Privileged Supabase keys are forbidden in browser configuration.');
  }

  return value;
}

export function validateSupabaseConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new SupabaseConfigurationError('Supabase public configuration is missing.');
  }

  return Object.freeze({
    url: validateProjectUrl(config.url),
    publishableKey: validatePublishableKey(config.publishableKey),
  });
}

export function getSupabaseClientOptions(profile = SUPABASE_CLIENT_PROFILE.FOUNDATION) {
  const auth = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  };

  if (profile === SUPABASE_CLIENT_PROFILE.PKCE_PREPARATION) {
    auth.flowType = 'pkce';
    auth.persistSession = true;
  } else if (profile !== SUPABASE_CLIENT_PROFILE.FOUNDATION) {
    throw new SupabaseConfigurationError('Unknown Supabase client profile.');
  }

  // In supabase-js v2.118.0, persistSession also selects persistent storage for
  // the PKCE verifier. A later successful exchange may persist its session in
  // that same storage, so this profile must remain isolated from public pages
  // until the complete authentication lifecycle is explicitly approved.
  return Object.freeze({ auth: Object.freeze(auth) });
}

export function initializeSupabaseClient(
  config,
  sdk = globalThis.supabase,
  profile = SUPABASE_CLIENT_PROFILE.FOUNDATION
) {
  const validated = validateSupabaseConfig(config);

  if (!sdk || typeof sdk.createClient !== 'function') {
    throw new SupabaseConfigurationError(
      `Supabase JavaScript ${SUPABASE_SDK_VERSION} is not loaded. Load ${SUPABASE_UMD_URL} before the module entrypoint.`
    );
  }

  return sdk.createClient(validated.url, validated.publishableKey, getSupabaseClientOptions(profile));
}
