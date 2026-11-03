import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ADMIN_ACCESS_STATUS,
  createSupabaseAdminAccessService,
} from '../js/supabase-admin-access.js';

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function fakeClient(response) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push({ name, args });
        return typeof response === 'function' ? response() : response;
      },
    },
  };
}

for (const [value, expected] of [
  [true, ADMIN_ACCESS_STATUS.AUTHORIZED],
  [false, ADMIN_ACCESS_STATUS.DENIED],
]) {
  const fake = fakeClient({ data: value, error: null });
  const service = createSupabaseAdminAccessService(fake.client);
  assert.deepEqual(await service.check(), { status: expected });
  assert.deepEqual(fake.calls, [{ name: 'current_user_is_admin', args: undefined }]);
}

for (const response of [
  null,
  undefined,
  [],
  {},
  { data: true },
  { data: true, error: undefined },
  { data: 'true', error: null },
  { data: null, error: null },
  { data: false, error: { message: 'PRIVATE_ROLE_DETAIL' } },
]) {
  const result = await createSupabaseAdminAccessService(fakeClient(response).client).check();
  assert.deepEqual(result, { status: ADMIN_ACCESS_STATUS.UNAVAILABLE });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|role/i);
}

const throwing = fakeClient(() => { throw new Error('PRIVATE_RPC_FAILURE'); });
assert.deepEqual(
  await createSupabaseAdminAccessService(throwing.client).check(),
  { status: ADMIN_ACCESS_STATUS.UNAVAILABLE }
);

const pending = deferred();
const pendingFake = fakeClient(() => pending.promise);
const pendingService = createSupabaseAdminAccessService(pendingFake.client);
const first = pendingService.check();
assert.equal(pendingService.check(), first, 'Same-generation role checks must share one request');
assert.equal(pendingFake.calls.length, 1);
assert.equal(pendingService.invalidate(), true);
const second = pendingService.check();
assert.equal(pendingFake.calls.length, 2, 'Invalidation must force a fresh Auth-context RPC');
pending.resolve({ data: true, error: null });
assert.deepEqual(await first, { status: ADMIN_ACCESS_STATUS.STALE });
assert.deepEqual(await second, { status: ADMIN_ACCESS_STATUS.AUTHORIZED });

const late = deferred();
const lateService = createSupabaseAdminAccessService(fakeClient(() => late.promise).client);
const lateResult = lateService.check();
assert.equal(lateService.cleanup(), true);
assert.equal(lateService.cleanup(), false);
late.resolve({ data: true, error: null });
assert.deepEqual(await lateResult, { status: ADMIN_ACCESS_STATUS.STALE });
assert.deepEqual(await lateService.check(), { status: ADMIN_ACCESS_STATUS.STALE });

assert.throws(() => createSupabaseAdminAccessService(null), /compatible Supabase admin-access client/i);
assert.throws(() => createSupabaseAdminAccessService({}), /compatible Supabase admin-access client/i);

const migration = await readFile(
  new URL('../supabase/migrations/202611030001_admin_access_rpc.sql', import.meta.url),
  'utf8'
);
assert.match(migration, /create or replace function public\.current_user_is_admin\(\)/i);
assert.match(migration, /security invoker/i);
assert.match(migration, /set search_path = ''/i);
assert.match(migration, /select private\.is_admin\(\)/i);
assert.match(migration, /revoke all on function public\.current_user_is_admin\(\) from public, anon, authenticated, service_role/i);
assert.match(migration, /grant execute on function public\.current_user_is_admin\(\) to authenticated/i);
assert.doesNotMatch(migration, /insert\s+into|update\s+public\.user_roles|delete\s+from/i);

const source = await readFile(new URL('../js/supabase-admin-access.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /createClient|supabase-config|service_role|user_roles|\.from\s*\(|localStorage|sessionStorage|console\./i);

console.log('Offline Supabase admin-access tests passed with fake clients only.');
