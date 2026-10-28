import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLiveMealDbDashboard } from '../js/live-mealdb-dashboard.js';
import { createLiveMealDbSearch } from '../js/live-mealdb-search.js';

let importRequests = 0;
globalThis.fetch = () => { importRequests += 1; throw new Error('Import must remain inert'); };
await import(`../js/live-mealdb-dashboard.js?inert=${Date.now()}`);
assert.equal(importRequests, 0);
delete globalThis.fetch;

const requests = [];
const states = [];
let coordinatorCreations = 0;
const session = createLiveMealDbDashboard({
  fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ meals: [{
        idMeal: '7001', strMeal: 'Live Fixture', strCategory: 'Vegetarian', strArea: 'Fictionland',
        strMealThumb: 'https://www.themealdb.com/images/media/meals/fixture.jpg', strInstructions: 'Prepare safely.',
      }] }),
    };
  },
  createCoordinator(options) {
    coordinatorCreations += 1;
    return createLiveMealDbSearch(options);
  },
  onState: (state) => states.push(state),
});
assert.equal(requests.length, 0);
assert.equal(coordinatorCreations, 0, 'Session construction must remain lazy');
assert.equal(session.isActive(), false);
assert.equal((await session.search('   ')).status, 'idle');
assert.equal(coordinatorCreations, 0, 'Blank search must not construct a coordinator');

const request = session.search('rice & beans');
assert.equal(session.isActive(), true);
assert.equal(session.getState().status, 'loading');
assert.equal(states.at(-1).status, 'loading');
const ready = await request;
assert.equal(ready.status, 'ready');
assert.equal(ready.recipes[0].id, 'external:themealdb:7001');
assert.equal(coordinatorCreations, 1);
assert.equal(requests.length, 1);
assert.equal(new URL(requests[0].url).pathname, '/api/json/v1/1/search.php');
assert.equal(new URL(requests[0].url).searchParams.get('s'), 'rice & beans');
assert.equal(requests[0].options.credentials, 'omit');
assert.equal(requests[0].options.referrerPolicy, 'no-referrer');

let retryCalls = 0;
let retryResolver;
let retryState = { status: 'idle', recipes: [], error: null, generation: 0, provider: 'themealdb', query: '' };
const retrySession = createLiveMealDbDashboard({
  fetchImpl: () => {},
  createCoordinator: () => ({
    getState: () => retryState,
    search: async (query) => {
      retryState = { status: 'error', recipes: [], error: { code: 'service' }, generation: 1, provider: 'themealdb', query };
      return retryState;
    },
    retry: () => {
      retryCalls += 1;
      retryState = { ...retryState, status: 'loading', error: null };
      return new Promise((resolve) => { retryResolver = () => {
        retryState = { ...retryState, status: 'ready', recipes: [] };
        resolve(retryState);
      }; });
    },
    reset: () => { retryState = { ...retryState, status: 'idle', query: '' }; },
  }),
});
assert.equal((await retrySession.search('retry')).status, 'error');
const retryRequest = retrySession.retry();
assert.equal(retrySession.getState().status, 'loading');
await retrySession.retry();
assert.equal(retryCalls, 1, 'Repeated retry while loading must not overlap');
retryResolver();
assert.equal((await retryRequest).status, 'ready');

let resolveLate;
let lateState = { status: 'idle', recipes: [], error: null, generation: 0, provider: 'themealdb', query: '' };
const lateNotifications = [];
const lateSession = createLiveMealDbDashboard({
  fetchImpl: () => {},
  createCoordinator: () => ({
    getState: () => lateState,
    search: (query) => {
      lateState = { ...lateState, status: 'loading', query };
      return new Promise((resolve) => { resolveLate = () => {
        lateState = { ...lateState, status: 'ready', recipes: [{ id: 'external:themealdb:7002' }] };
        resolve(lateState);
      }; });
    },
    retry: async () => lateState,
    reset: () => { lateState = { ...lateState, status: 'idle', recipes: [], query: '' }; },
  }),
  onState: (state) => lateNotifications.push(state),
});
const lateRequest = lateSession.search('late');
assert.equal(lateSession.reset().status, 'idle');
const notificationsAfterReset = lateNotifications.length;
resolveLate();
const staleResult = await lateRequest;
assert.equal(staleResult.status, 'idle');
assert.equal(staleResult.recipes.length, 0);
assert.equal(lateSession.getState().status, 'idle');
assert.equal(lateSession.isActive(), false);
assert.equal(lateNotifications.length, notificationsAfterReset, 'Late completion must not publish after reset');

const pendingSearches = new Map();
let unorderedState = { status: 'idle', recipes: [], error: null, generation: 0, provider: 'themealdb', query: '' };
const unorderedNotifications = [];
const unorderedSession = createLiveMealDbDashboard({
  fetchImpl: () => {},
  createCoordinator: () => ({
    getState: () => unorderedState,
    search: (query) => {
      unorderedState = { ...unorderedState, status: 'loading', query };
      return new Promise((resolve) => pendingSearches.set(query, () => {
        unorderedState = {
          ...unorderedState,
          status: 'ready',
          query,
          recipes: [{ id: `external:themealdb:${query === 'A' ? '7003' : '7004'}` }],
        };
        resolve(unorderedState);
      }));
    },
    retry: async () => unorderedState,
    reset: () => { unorderedState = { ...unorderedState, status: 'idle', recipes: [], query: '' }; },
  }),
  onState: (state) => unorderedNotifications.push(state),
});
const requestA = unorderedSession.search('A');
const requestB = unorderedSession.search('B');
pendingSearches.get('B')();
const resultB = await requestB;
const notificationsAfterB = unorderedNotifications.length;
pendingSearches.get('A')();
const staleA = await requestA;
assert.equal(resultB.recipes[0].id, 'external:themealdb:7004');
assert.equal(staleA.recipes[0].id, 'external:themealdb:7004');
assert.equal(unorderedSession.getState().query, 'B');
assert.equal(unorderedNotifications.length, notificationsAfterB, 'Stale A must not publish after B');

const source = await readFile(new URL('../js/live-mealdb-dashboard.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /localStorage|sessionStorage|document\.|window\.|setInterval|setTimeout|console\./);
assert.doesNotMatch(source, /supabase|signUp|signIn|exchangeCodeForSession/i);

console.log('Offline live TheMealDB dashboard session tests passed with injected fakes only.');
