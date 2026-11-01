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

function isNonArrayObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isMeaningfulString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasValidSessionExpiry(session, now) {
  const expiresAt = session.expires_at;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return false;
  const nowMilliseconds = now();
  if (typeof nowMilliseconds !== 'number' || !Number.isFinite(nowMilliseconds)) return false;
  return expiresAt > Math.floor(nowMilliseconds / 1000);
}

function isExplicitSuccess(response) {
  return Boolean(
    isNonArrayObject(response)
    && Object.prototype.hasOwnProperty.call(response, 'error')
    && response.error === null
  );
}

function consumeInvalidSubscriptionPromise(value) {
  try {
    if (!isNonArrayObject(value) || typeof value.then !== 'function') return false;
    Promise.resolve(value).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function publicUser(user) {
  if (!isNonArrayObject(user) || !isMeaningfulString(user.id)) return null;
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
  if (!isNonArrayObject(user)) return false;
  return isValidConfirmationTimestamp(user.email_confirmed_at);
}

function stateForSession(session, now) {
  if (session === null) return Object.freeze({ status: AUTH_SESSION_STATUS.GUEST, user: null });
  if (
    !isNonArrayObject(session)
    || !isMeaningfulString(session.access_token)
    || !isMeaningfulString(session.refresh_token)
    || !isNonArrayObject(session.user)
    || !hasValidSessionExpiry(session, now)
  ) return errorState();

  const user = publicUser(session.user);
  if (!user) return errorState();
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

function stateForSessionResponse(result, now) {
  if (
    !isExplicitSuccess(result)
    || !Object.prototype.hasOwnProperty.call(result, 'data')
    || !isNonArrayObject(result.data)
    || !Object.prototype.hasOwnProperty.call(result.data, 'session')
    || result.data.session === undefined
  ) return errorState();
  return stateForSession(result.data.session, now);
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
export function createAuthSessionService(client, { now = Date.now } = {}) {
  const auth = requireAuthClient(client);
  if (typeof now !== 'function') throw new TypeError('An Auth session clock is required.');
  const listeners = new Set();
  let state = Object.freeze({ status: AUTH_SESSION_STATUS.LOADING, user: null });
  let bootstrapPromise = null;
  let logoutPromise = null;
  let authSubscription = null;
  let generation = 0;
  let cleanedUp = false;
  let logoutPending = false;

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

  const processAuthEvent = (event, session) => {
    if (cleanedUp || logoutPending) return state;
    const eventGeneration = ++generation;
    try {
      let nextState;
      if (event === 'SIGNED_OUT') {
        nextState = session === null ? stateForSession(null, now) : errorState();
      } else if (session === null && event !== 'INITIAL_SESSION') {
        nextState = errorState();
      } else {
        nextState = stateForSession(session, now);
      }
      return cleanedUp || eventGeneration !== generation ? state : publish(nextState);
    } catch {
      return cleanedUp || eventGeneration !== generation ? state : publish(errorState());
    }
  };

  const installAuthSubscription = () => {
    if (authSubscription) return true;
    let subscriptionAccepted = false;
    let subscriptionRejected = false;
    let queuedEvent = null;
    const response = auth.onAuthStateChange((event, session) => {
      if (cleanedUp || subscriptionRejected) return;
      if (!subscriptionAccepted) {
        queuedEvent = { event, session };
        return;
      }
      processAuthEvent(event, session);
    });
    const invalidSubscriptionPromise = consumeInvalidSubscriptionPromise(response);
    if (
      invalidSubscriptionPromise
      || !isNonArrayObject(response)
      || !Object.prototype.hasOwnProperty.call(response, 'data')
      || !isNonArrayObject(response.data)
      || !Object.prototype.hasOwnProperty.call(response.data, 'subscription')
      || !isNonArrayObject(response.data.subscription)
      || typeof response.data.subscription.unsubscribe !== 'function'
    ) {
      subscriptionRejected = true;
      queuedEvent = null;
      throw new TypeError('Supabase Auth subscription is unavailable.');
    }

    const subscription = response.data.subscription;
    if (cleanedUp) {
      subscriptionRejected = true;
      queuedEvent = null;
      try {
        subscription.unsubscribe();
      } catch {
        // Cleanup already owns the lifecycle; provider failures remain private.
      }
      return false;
    }

    authSubscription = subscription;
    subscriptionAccepted = true;
    const acceptedEvent = queuedEvent;
    queuedEvent = null;
    if (acceptedEvent) processAuthEvent(acceptedEvent.event, acceptedEvent.session);
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
            if (!installAuthSubscription()) return state;
            const result = await auth.getSession();
            if (cleanedUp || bootstrapGeneration !== generation) return state;
            return publish(stateForSessionResponse(result, now));
          } catch {
            if (cleanedUp || bootstrapGeneration !== generation) return state;
            return publish(errorState());
          }
        })();
      }
      return bootstrapPromise;
    },

    logout() {
      if (cleanedUp) return Promise.resolve(errorState());
      if (logoutPromise) return logoutPromise;
      generation += 1;
      logoutPending = true;
      publish(Object.freeze({ status: AUTH_SESSION_STATUS.LOADING, user: null }));
      const attempt = (async () => {
        try {
          const result = await auth.signOut({ scope: 'local' });
          if (cleanedUp) return state;
          if (!isExplicitSuccess(result)) return publish(errorState());
          return publish(Object.freeze({ status: AUTH_SESSION_STATUS.GUEST, user: null }));
        } catch {
          if (cleanedUp) return state;
          return publish(errorState());
        } finally {
          logoutPending = false;
        }
      })();
      logoutPromise = attempt;
      void attempt.then(() => {
        if (logoutPromise === attempt) logoutPromise = null;
      });
      return attempt;
    },

    cleanup() {
      if (cleanedUp) return false;
      cleanedUp = true;
      generation += 1;
      const subscription = authSubscription;
      authSubscription = null;
      listeners.clear();
      try {
        subscription?.unsubscribe();
      } catch {
        // Local references are already cleared; provider cleanup failures stay private.
      }
      return true;
    },
  });
}
