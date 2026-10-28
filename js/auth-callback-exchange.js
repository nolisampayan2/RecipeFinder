const SAFE_EXCHANGE_SUCCESS = Object.freeze({
  data: Object.freeze({ confirmed: true }),
  error: null,
});

const SAFE_EXCHANGE_FAILURE = Object.freeze({
  data: null,
  error: true,
});

function isValidAuthorizationCode(code) {
  return typeof code === 'string' && Boolean(code) && code === code.trim() && !/[\u0000-\u001f\u007f]/.test(code);
}

function hasValidSession(result) {
  const session = result?.data?.session;
  return Boolean(
    session &&
    typeof session.access_token === 'string' && session.access_token &&
    typeof session.refresh_token === 'string' && session.refresh_token
  );
}

export function createPkceCodeExchangeAdapter(client) {
  const exchangeCode = client?.auth?.exchangeCodeForSession;
  if (typeof exchangeCode !== 'function') {
    throw new TypeError('A Supabase Auth code exchange client is required.');
  }

  return async function exchangeAuthorizationCode(code) {
    if (!isValidAuthorizationCode(code)) return SAFE_EXCHANGE_FAILURE;

    try {
      const result = await exchangeCode.call(client.auth, code);
      if (!result || typeof result !== 'object' || result.error || !hasValidSession(result)) {
        return SAFE_EXCHANGE_FAILURE;
      }

      return SAFE_EXCHANGE_SUCCESS;
    } catch {
      return SAFE_EXCHANGE_FAILURE;
    }
  };
}
