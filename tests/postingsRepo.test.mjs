import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakePostingsDb } from './fakePgPostings.mjs';
import { listPostings, createPosting, setTrainingOverride } from '../lib/postingsRepo.js';

const adminAccess = { canUse: true, isAdmin: true };
const ownerAccess = { canUse: true, isAdmin: false };

// ---------- createPosting ----------

test('createPosting: inserts row, bumps version, returns flat value + rev + id', async () => {
  const db = makeFakePostingsDb([], 0);
  const r = await createPosting({ data: { trainingType: 'heli', note: 'x' }, ownerId: 'u1', ownerName: 'Dana' }, db);
  assert.equal(r.status, 'ok');
  assert.equal(r.rev, 1); // bumped from 0
  assert.ok(r.id);
  assert.equal(r.value.length, 1);
  const p = r.value[0];
  assert.equal(p.trainingType, 'heli'); // form field flat
  assert.equal(p.note, 'x');
  assert.equal(p.status, 'available');
  assert.equal(p.ownerId, 'u1');
  assert.equal(p.ownerName, 'Dana');
  assert.ok(!('manualStatus' in p)); // omitted when null
  assert.equal(typeof p.createdAt, 'string'); // ISO
});

test('createPosting: strips server keys from data (columns are source of truth)', async () => {
  const db = makeFakePostingsDb([], 0);
  // client tries to sneak ownerId/status/id into data
  const r = await createPosting({ data: { ownerId: 'HACK', status: 'HACK', id: 'HACK', real: 1 }, ownerId: 'u1', ownerName: 'D' }, db);
  const p = r.value[0];
  assert.equal(p.ownerId, 'u1'); // not HACK
  assert.equal(p.status, 'available'); // not HACK
  assert.notEqual(p.id, 'HACK');
  assert.equal(p.real, 1); // legit field kept
});

// ---------- listPostings ----------

test('listPostings: returns value + rev consistently, ordered by created_at', async () => {
  const db = makeFakePostingsDb(
    [
      { id: 'p1', owner_id: 'u1', data: { a: 1 }, created_at: new Date(Date.UTC(2026, 0, 1)) },
      { id: 'p2', owner_id: 'u2', data: { b: 2 }, created_at: new Date(Date.UTC(2026, 0, 2)) },
    ],
    7
  );
  const { value, rev } = await listPostings(db);
  assert.equal(rev, 7);
  assert.deepEqual(value.map((p) => p.id), ['p1', 'p2']);
  assert.equal(value[0].a, 1);
});

// ---------- setTrainingOverride ----------

test('setTrainingOverride: not_found → blocked 404', async () => {
  const db = makeFakePostingsDb([], 0);
  const r = await setTrainingOverride('nope', 'done', adminAccess, 'adm', db);
  assert.deepEqual(r, { status: 'blocked', reason: 'not_found', httpStatus: 404 });
});

test('setTrainingOverride: non-owner non-admin → blocked 403', async () => {
  const db = makeFakePostingsDb([{ id: 'p1', owner_id: 'owner1' }], 0);
  const r = await setTrainingOverride('p1', 'done', ownerAccess, 'someoneElse', db);
  assert.deepEqual(r, { status: 'blocked', reason: 'forbidden', httpStatus: 403 });
});

test('setTrainingOverride: owner sets done, bumps version, manualStatus present', async () => {
  const db = makeFakePostingsDb([{ id: 'p1', owner_id: 'u1' }], 3);
  const r = await setTrainingOverride('p1', 'done', ownerAccess, 'u1', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.rev, 4);
  assert.equal(r.value[0].manualStatus, 'done');
});

test('setTrainingOverride: admin can override any posting', async () => {
  const db = makeFakePostingsDb([{ id: 'p1', owner_id: 'someoneElse' }], 0);
  const r = await setTrainingOverride('p1', 'cancelled', adminAccess, 'adm', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.value[0].manualStatus, 'cancelled');
});

test('setTrainingOverride: clearing to null omits manualStatus', async () => {
  const db = makeFakePostingsDb([{ id: 'p1', owner_id: 'u1', manual_status: 'done' }], 0);
  const r = await setTrainingOverride('p1', null, ownerAccess, 'u1', db);
  assert.equal(r.status, 'ok');
  assert.ok(!('manualStatus' in r.value[0])); // omitted when null
});
