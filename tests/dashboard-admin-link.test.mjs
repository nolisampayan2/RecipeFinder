import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDashboardAdminLink } from '../js/dashboard-admin-link.js';
import { shouldInitializeAdminDashboardLink } from '../js/dashboard-auth.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const attributes = new Map();
  const link = {
    hidden: false,
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
  };
  const requests = [];
  const service = {
    invalidations: 0,
    retired: false,
    check() {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
    invalidate() { this.invalidations += 1; },
    cleanup() { this.retired = true; },
  };
  let clock = 0;
  let nextTimer = 0;
  const timers = new Map();
  const listeners = new Map();
  const controller = createDashboardAdminLink({
    link,
    client: {},
    createAccessService: () => service,
    now: () => clock,
    setTimeoutImpl(callback, ms) {
      const id = ++nextTimer;
      timers.set(id, { callback, due: clock + ms });
      return id;
    },
    clearTimeoutImpl(id) { timers.delete(id); },
    windowLike: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type, listener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    },
  });
  return {
    link, requests, service, controller,
    focus() { listeners.get('focus')?.(); },
    hasFocusListener() { return listeners.has('focus'); },
    advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= clock) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

const authorized = Object.freeze({ status: 'authorized' });
const denied = Object.freeze({ status: 'denied' });
const auth = (userId) => ({ status: 'authenticated', userId });

{
  const h = harness();
  const first = h.controller.handleAuthState(auth(A));
  for (let index = 0; index < 10; index += 1) h.focus();
  assert.equal(h.requests.length, 1, 'Rapid focus events share the current logical role check');
  assert.equal(h.link.hidden, true);
  h.requests[0].resolve(authorized);
  assert.equal(await first, true);
  h.focus();
  assert.equal(h.requests.length, 2, 'Focus after completion deliberately refreshes the role');
  assert.equal(h.link.hidden, true);
  for (let index = 0; index < 10; index += 1) h.focus();
  assert.equal(h.requests.length, 2, 'Repeated focus during refresh does not dispatch again');
  h.requests[1].reject(Error('PRIVATE_FOCUS_FAILURE'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.link.hidden, true);
  assert.equal(h.link.getAttribute('href'), null);
  h.focus();
  assert.equal(h.requests.length, 3, 'Focus can recover after failed verification');
  h.requests[2].resolve(authorized);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.link.hidden, false);
  h.controller.cleanup();
}

{
  const h = harness();
  const old = h.controller.handleAuthState(auth(A));
  for (let index = 0; index < 10; index += 1) h.focus();
  const current = h.controller.handleAuthState(auth(B));
  for (let index = 0; index < 10; index += 1) h.focus();
  assert.equal(h.requests.length, 2, 'Account switching starts one new identity check');
  h.requests[0].resolve(authorized);
  assert.equal(await old, false);
  assert.equal(h.link.hidden, true);
  h.requests[1].resolve(authorized);
  assert.equal(await current, true);
  h.controller.handleAuthState({ status: 'guest', userId: null });
  h.focus();
  assert.equal(h.requests.length, 2, 'Focus after logout cannot dispatch a role check');
  assert.equal(h.link.hidden, true);
  h.controller.cleanup();
  h.focus();
  assert.equal(h.requests.length, 2);
}

{
  const h = harness();
  assert.equal(h.link.hidden, true);
  assert.equal(h.link.getAttribute('href'), null);
  assert.equal(await h.controller.handleAuthState({ status: 'guest', userId: null }), false);
  assert.equal(await h.controller.handleAuthState({ status: 'pending-confirmation', userId: A }), false);
  assert.equal(await h.controller.handleAuthState(auth('invalid')), false);
  assert.equal(await h.controller.handleAuthState({ get status() { throw Error('PRIVATE_AUTH'); } }), false);
  assert.equal(h.requests.length, 0);
  const first = h.controller.handleAuthState(auth(A));
  assert.equal(h.link.hidden, true, 'Role check is pending');
  assert.equal(await h.controller.handleAuthState(auth(A)), false, 'Repeat state does not issue another check');
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(authorized);
  assert.equal(await first, true);
  assert.equal(h.link.hidden, false);
  assert.equal(h.link.getAttribute('href'), 'admin.html');
  assert.equal(await h.controller.handleAuthState({ status: 'guest', userId: null }), false);
  assert.equal(h.link.hidden, true);
  assert.equal(h.link.getAttribute('href'), null);
  const ordinary = h.controller.handleAuthState(auth(B));
  h.requests[1].resolve(denied);
  assert.equal(await ordinary, false);
  assert.equal(h.link.hidden, true);
  assert.equal(h.controller.cleanup(), true);
  assert.equal(h.controller.cleanup(), false);
  assert.equal(h.service.retired, true);
  assert.equal(await h.controller.handleAuthState(auth(A)), false);
}

{
  const h = harness();
  const old = h.controller.handleAuthState(auth(A));
  const current = h.controller.handleAuthState(auth(B));
  h.requests[0].resolve(authorized);
  assert.equal(await old, false, 'Old account cannot publish navigation');
  assert.equal(h.link.hidden, true);
  h.requests[1].resolve(authorized);
  assert.equal(await current, true);
  assert.equal(h.link.hidden, false);
  h.controller.handleAuthState({ status: 'error', userId: B });
  assert.equal(h.link.hidden, true);
}

{
  const h = harness();
  const pending = h.controller.handleAuthState(auth(A));
  h.controller.handleAuthState({ status: 'guest', userId: null });
  h.requests[0].resolve(authorized);
  assert.equal(await pending, false, 'Late positive response after logout stays hidden');
  assert.equal(h.link.hidden, true);
  const next = h.controller.handleAuthState(auth(A));
  h.requests[1].reject(Error('PRIVATE_ROLE_FAILURE'));
  assert.equal(await next, false);
  assert.equal(h.link.getAttribute('href'), null);
}

{
  const h = harness();
  const pending = [];
  for (let index = 0; index < 20; index += 1) {
    pending.push(h.controller.handleAuthState(auth(index % 2 ? A : B)));
  }
  assert.equal(h.requests.length, 3, 'Unresolved underlying role requests are capped');
  h.advance(15001);
  assert.deepEqual(await Promise.all(pending), Array(20).fill(false));
  assert.equal(h.link.hidden, true);
  assert.equal(h.requests.length, 3, 'Logical timeout does not free transport capacity');
  assert.equal(await h.controller.refresh(), false);
  assert.equal(h.requests.length, 3);
  h.requests[0].resolve(authorized);
  await Promise.resolve();
  h.focus();
  assert.equal(h.requests.length, 4, 'Fresh verification recovers after transport settlement');
  h.requests[3].resolve(authorized);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.link.hidden, false);
  h.requests[1].resolve(authorized);
  h.requests[2].resolve(denied);
  await Promise.resolve();
  assert.equal(h.link.hidden, false, 'Retired results cannot override current verification');
  h.controller.cleanup();
  assert.equal(h.link.hidden, true);
  assert.equal(h.hasFocusListener(), false);
}

{
  const h = harness();
  const pending = h.controller.handleAuthState(auth(A));
  h.controller.cleanup();
  assert.equal(await pending, false);
  h.requests[0].resolve(authorized);
  await Promise.resolve();
  assert.equal(h.link.hidden, true);
}

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const clientStart = app.indexOf('function acceptDashboardClient(client, availability) {');
const clientRemainder = app.indexOf('\n  if (pageRetired || recipeCatalogLoader) return false;', clientStart);
assert.ok(clientStart >= 0 && clientRemainder > clientStart, 'Dashboard client initializer is available');
const originalPrelude = `${app.slice(clientStart, clientRemainder)}\n}`;
const instrumentedPrelude = originalPrelude.replace("import('./js/dashboard-admin-link.js')", 'importAdminLink()');
assert.notEqual(instrumentedPrelude, originalPrelude, 'Actual Admin module import is instrumented');
function importCount(availability, hostname) {
  let count = 0;
  const initialize = Function('shouldInitializeAdminDashboardLink', 'globalThis', 'importAdminLink', `
    let pageRetired = false;
    let dashboardAdminLink = null;
    const latestAuthState = Object.freeze({ status: 'guest', userId: null });
    const $ = () => ({});
    ${instrumentedPrelude}
    return acceptDashboardClient;
  `)(shouldInitializeAdminDashboardLink, { location: { hostname } }, () => {
    count += 1;
    return Promise.resolve({ createDashboardAdminLink: () => ({ handleAuthState() {} }) });
  });
  initialize({}, availability);
  return count;
}
assert.equal(importCount({ adminPreviewAvailable: true }, 'example.com'), 1);
assert.equal(importCount({ adminLocalDevelopmentAvailable: true }, 'localhost'), 1);
assert.equal(importCount({ adminLocalDevelopmentAvailable: true }, '127.0.0.1'), 1);
assert.equal(importCount({ adminLocalDevelopmentAvailable: true }, 'admin.localhost'), 0);
assert.equal(importCount({ adminLocalDevelopmentAvailable: false }, 'localhost'), 0);
assert.equal(importCount({}, 'localhost'), 0);
assert.equal(importCount({ adminPreviewAvailable: false, adminLocalDevelopmentAvailable: false }, 'localhost'), 0,
  'Production config served on localhost cannot import the excluded Admin module');
assert.match(app, /shouldInitializeAdminDashboardLink\(availability, globalThis\.location\?\.hostname\)/);
assert.match(app, /dashboardAdminLink\?\.cleanup\(\)/);
assert.match(index, /data-admin-dashboard-link hidden/);
assert.doesNotMatch(index, /data-admin-dashboard-link[^>]+href=/);
assert.doesNotMatch(index, /class="nav-link[^"]*"[^>]+data-admin-dashboard-link/);

console.log('Offline Preview-only Admin Dashboard link lifecycle tests passed.');
