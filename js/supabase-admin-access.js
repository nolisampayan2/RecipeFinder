export const ADMIN_ACCESS_STATUS = Object.freeze({
  AUTHORIZED: 'authorized',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  STALE: 'stale',
});

const AUTHORIZED_RESULT = Object.freeze({ status: ADMIN_ACCESS_STATUS.AUTHORIZED });
const DENIED_RESULT = Object.freeze({ status: ADMIN_ACCESS_STATUS.DENIED });
const UNAVAILABLE_RESULT = Object.freeze({ status: ADMIN_ACCESS_STATUS.UNAVAILABLE });
const STALE_RESULT = Object.freeze({ status: ADMIN_ACCESS_STATUS.STALE });

function requireRpc(client) {
  let rpc;
  try {
    rpc = client?.rpc;
  } catch {
    throw new TypeError('A compatible Supabase admin-access client is required.');
  }
  if (typeof rpc !== 'function') {
    throw new TypeError('A compatible Supabase admin-access client is required.');
  }
  return rpc;
}

export function createSupabaseAdminAccessService(client) {
  const rpc = requireRpc(client);
  let pending = null;
  let generation = 0;
  let retired = false;

  return Object.freeze({
    check() {
      if (retired) return Promise.resolve(STALE_RESULT);
      if (pending) return pending;

      const requestGeneration = generation;
      const attempt = (async () => {
        try {
          const response = await rpc.call(client, 'current_user_is_admin');
          if (retired || requestGeneration !== generation) return STALE_RESULT;
          if (
            !response
            || typeof response !== 'object'
            || Array.isArray(response)
            || !Object.prototype.hasOwnProperty.call(response, 'error')
            || response.error !== null
            || !Object.prototype.hasOwnProperty.call(response, 'data')
            || typeof response.data !== 'boolean'
          ) return UNAVAILABLE_RESULT;
          return response.data ? AUTHORIZED_RESULT : DENIED_RESULT;
        } catch {
          return retired || requestGeneration !== generation ? STALE_RESULT : UNAVAILABLE_RESULT;
        } finally {
          if (pending === attempt) pending = null;
        }
      })();
      pending = attempt;
      return attempt;
    },

    invalidate() {
      if (retired) return false;
      generation += 1;
      pending = null;
      return true;
    },

    cleanup() {
      if (retired) return false;
      retired = true;
      generation += 1;
      pending = null;
      return true;
    },
  });
}
