export const AUTH_SESSION_STATUS = Object.freeze({
  LOADING: 'loading',
  GUEST: 'guest',
  PENDING_CONFIRMATION: 'pending-confirmation',
  AUTHENTICATED: 'authenticated',
  ERROR: 'error',
});

const PUBLIC_ERROR = Object.freeze({
  code: 'AUTH_UNAVAILABLE',
  message: 'Account status is temporarily unavailable.',
});

function publicUser(user) {
  if (!user || typeof user !== 'object' || typeof user.id !== 'string' || !user.id) return null;
  return Object.freeze({
    id: user.id,
    email: typeof user.email === 'string' ? user.email : '',
  });
}

const EMAIL_CONFIRMATION_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isValidConfirmationTimestamp(value) {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  const match = EMAIL_CONFIRMATION_TIMESTAMP.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    month < 1 || month > 12
    || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59
  ) return false;

  if (zone !== 'Z') {
    const offsetHour = Number(offsetHourText);
    const offsetMinute = Number(offsetMinuteText);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  }

  return Number.isFinite(Date.parse(value));
}

/**
 * Only Supabase's server-owned, email-specific confirmation timestamp is
 * accepted. Generic confirmation fields and user metadata fail closed.
 */
export function isEmailConfirmed(user) {
  if (!user || typeof user !== 'object') return false;
  return isValidConfirmationTimestamp(user.email_confirmed_at);
}

function stateForSession(session) {
  const user = publicUser(session?.user);
  if (!user) return Object.freeze({ status: AUTH_SESSION_STATUS.GUEST, user: null });
  return Object.freeze({
    status: isEmailConfirmed(session.user)
      ? AUTH_SESSION_STATUS.AUTHENTICATED
      : AUTH_SESSION_STATUS.PENDING_CONFIRMATION,
    user,
  });
}

function errorState() {
  return Object.freeze({ status: AUTH_SESSION_STATUS.ERROR, user: null, error: PUBLIC_ERROR });
}

function requireAuthClient(client) {
  const auth = client?.auth;
  if (
    !auth
    || typeof auth.getSession !== 'function'
    || typeof auth.onAuthStateChange !== 'function'
    || typeof auth.signOut !== 'function'
  ) {
    throw new TypeError('A compatible Supabase Auth session client is required.');
  }
  return auth;
}

/**
 * Creates an explicit, offline-testable session state boundary.
 * Public snapshots contain no access tokens, refresh tokens, or raw errors.
 */
export function createAuthSessionService(client) {
  const auth = requireAuthClient(client);
  const listeners = new Set();
  let state = Object.freeze({ status: AUTH_SESSION_STATUS.LOADING, user: null });
  let bootstrapPromise = null;
  let authSubscription = null;
  let generation = 0;
  let cleanedUp = false;

  const notifyListener = (listener) => {
    try {
      listener(state);
    } catch {
      // A consumer failure must not interrupt Auth lifecycle processing.
    }
  };

  const publish = (nextState) => {
    state = nextState;
    listeners.forEach(notifyListener);
    return state;
  };

  const installAuthSubscription = () => {
    if (authSubscription) return true;
    const response = auth.onAuthStateChange((_event, session) => {
      if (cleanedUp) return;
      generation += 1;
      publish(stateForSession(session));
    });
    const subscription = response?.data?.subscription;
    if (!subscription || typeof subscription.unsubscribe !== 'function') {
      throw new TypeError('Supabase Auth subscription is unavailable.');
    }
    authSubscription = subscription;
    return true;
  };

  return Object.freeze({
    getState() {
      return state;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('An Auth session listener is required.');
      if (cleanedUp) return () => {};
      listeners.add(listener);
      notifyListener(listener);
      let active = true;
      return () => {
        if (!active) return false;
        active = false;
        return listeners.delete(listener);
      };
    },

    /**
     * Bootstrap is single-attempt and idempotent. After a terminal failure,
     * callers must create a fresh service instance before trying again.
     */
    bootstrap() {
      if (cleanedUp) return Promise.resolve(errorState());
      if (!bootstrapPromise) {
        publish(Object.freeze({ status: AUTH_SESSION_STATUS.LOADING, user: null }));
        const bootstrapGeneration = ++generation;
        bootstrapPromise = (async () => {
          try {
            installAuthSubscription();
            const result = await auth.getSession();
            if (cleanedUp || bootstrapGeneration !== generation) return state;
            if (!result || typeof result !== 'object' || result.error) return publish(errorState());
            return publish(stateForSession(result.data?.session));
          } catch {
            if (cleanedUp || bootstrapGeneration !== generation) return state;
            return publish(errorState());
          }
        })();
      }
      return bootstrapPromise;
    },

    async logout() {
      if (cleanedUp) return errorState();
      const logoutGeneration = ++generation;
      publish(Object.freeze({ status: AUTH_SESSION_STATUS.LOADING, user: null }));
      try {
        const result = await auth.signOut({ scope: 'local' });
        if (cleanedUp || logoutGeneration !== generation) return state;
        if (!result || typeof result !== 'object' || result.error) return publish(errorState());
        return publish(Object.freeze({ status: AUTH_SESSION_STATUS.GUEST, user: null }));
      } catch {
        if (cleanedUp || logoutGeneration !== generation) return state;
        return publish(errorState());
      }
    },

    cleanup() {
      if (cleanedUp) return false;
      cleanedUp = true;
      generation += 1;
      authSubscription?.unsubscribe();
      authSubscription = null;
      listeners.clear();
      return true;
    },
  });
}
