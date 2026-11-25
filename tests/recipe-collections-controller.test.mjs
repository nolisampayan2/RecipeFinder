import assert from 'node:assert/strict';
import { createRecipeCollectionsController } from '../js/recipe-collections-controller.js';

const A = '123e4567-e89b-42d3-a456-426614174000';
const B = '223e4567-e89b-42d3-a456-426614174000';
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const success = (name) => ({ data: Object.freeze([{ id: A, name, items: Object.freeze([]) }]), error: null });
const pendingA = deferred();
const calls = { list: [], create: [], rename: [], delete: [], add: [], remove: [] };
const service = {
  listOwn(id) { calls.list.push(id); return calls.list.length === 1 ? pendingA.promise : success(id === B ? 'B only' : 'A only'); },
  createOwn(id, name) { calls.create.push([id, name]); return { data: { id: A, name }, error: null }; },
  renameOwn(id, collection, name) { calls.rename.push([id, collection, name]); return { data: { id: collection, name }, error: null }; },
  deleteOwn(id, collection) { calls.delete.push([id, collection]); return { data: { id: collection }, error: null }; },
  addOwn(id, collection, recipe) { calls.add.push([id, collection, recipe.id]); return { data: { id: A }, error: null }; },
  removeOwn(id, collection, item) { calls.remove.push([id, collection, item]); return { data: { id: item }, error: null }; },
};
const states = [];
const controller = createRecipeCollectionsController({ service, onState: (state) => states.push(state) });
assert.equal((await controller.create('Guest')).code, 'DENIED');
controller.handleAuthState({ status: 'guest' });
assert.equal(controller.getState().status, 'guest');
assert.deepEqual(calls.list, []);
const oldLoad = controller.handleAuthState({ status: 'authenticated', userId: A });
assert.equal(controller.getState().status, 'loading');
const newLoad = controller.handleAuthState({ status: 'authenticated', userId: B });
assert.equal((await newLoad).ok, true);
assert.equal(controller.getState().collections[0].name, 'B only');
pendingA.resolve(success('A secret collection'));
assert.equal((await oldLoad).code, 'STALE');
assert.equal(JSON.stringify(controller.getState()).includes('A secret collection'), false);

const create = controller.create('New');
controller.handleAuthState({ status: 'guest' });
assert.equal((await create).code, 'STALE');
assert.equal(calls.create.length, 0, 'Same-turn logout prevents provider dispatch');
assert.equal(controller.getState().collections.length, 0);
assert.equal((await controller.add(A, { id: 'creamy-garlic-pasta' })).code, 'DENIED');

await controller.handleAuthState({ status: 'authenticated', userId: B });
assert.equal((await controller.create('New')).ok, true);
assert.deepEqual(calls.create, [[B, 'New']]);
assert.equal((await controller.rename(A, 'Renamed')).ok, true);
assert.equal((await controller.add(A, { id: 'creamy-garlic-pasta' })).ok, true);
assert.equal((await controller.remove(A, B)).ok, true);
assert.equal((await controller.delete(A)).ok, true);
assert.equal(calls.list.every((id) => id === A || id === B), true);
assert.equal((await controller.handleAuthState({ status: 'authenticated', userId: B })), true,
  'Same-account refresh preserves current state');
assert.equal(controller.getState().status, 'ready');
controller.cleanup();
assert.equal(controller.getState().collections.length, 0);
assert.equal((await controller.create('After cleanup')).code, 'DENIED');
assert.equal(states.at(-1).status, 'loading');
const hostile = createRecipeCollectionsController({ service: {
  listOwn: async () => success('Safe'),
  createOwn: async () => ({ data: null, error: { code: 'PRIVATE_BACKEND', message: 'secret raw error' } }),
} });
await hostile.handleAuthState({ status: 'authenticated', userId: A });
assert.equal((await hostile.create('Safe')).code, 'UNAVAILABLE');
assert.equal(JSON.stringify(hostile.getState()).includes('secret raw error'), false);
const lateWrite = deferred();
const lateCalls = [];
const late = createRecipeCollectionsController({ service: {
  listOwn: async (id) => success(id === A ? 'Account A' : 'Account B'),
  createOwn(id) { lateCalls.push(id); return lateWrite.promise; },
} });
await late.handleAuthState({ status: 'authenticated', userId: A });
const inFlight = late.create('First');
await Promise.resolve();
assert.deepEqual(lateCalls, [A]);
assert.equal((await late.create('Duplicate click')).code, 'BUSY');
await late.handleAuthState({ status: 'authenticated', userId: B });
lateWrite.resolve({ data: { id: A, name: 'Old account result' }, error: null });
assert.equal((await inFlight).code, 'STALE');
assert.equal(late.getState().collections[0].name, 'Account B');
console.log('Collections guest denial, CRUD, logout, and stale-account lifecycles passed.');
