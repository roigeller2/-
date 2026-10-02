import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCoordDb } from './fakePgCoord.mjs';
import {
  listCoordRequests, createCoord, cancelCoord, acceptCoord, rejectCoord, setStage, setExec,
} from '../lib/coordRepo.js';

const owner = { canUse: true, isAdmin: false };   // בעל הפרסום
const admin = { canUse: true, isAdmin: true };
const other = { canUse: true, isAdmin: false };

// ---------- create ----------

test('createCoord: forces statuses, stores post_id, returns id + postingOwnerId', async () => {
  const db = makeFakeCoordDb({ postings: [{ id: 'post1', owner_id: 'u-owner' }], version: 0 });
  const r = await createCoord({ data: { postId: 'post1', area: 'north' }, requesterId: 'u-req', requesterName: 'Req' }, db);
  assert.equal(r.status, 'ok');
  assert.equal(r.rev, 1);
  assert.equal(r.postingOwnerId, 'u-owner');
  const c = r.value.find((x) => x.id === r.id);
  assert.equal(c.postId, 'post1');
  assert.equal(c.requesterId, 'u-req');
  assert.equal(c.requestStatus, 'pending');
  assert.equal(c.coordinationStatus, 'initial_coordination_done');
  assert.equal(c.trainingExecutionStatus, 'pending');
  assert.equal(c.area, 'north'); // form field flat
});

// ---------- list ----------

test('listCoordRequests: returns value + rev', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'p1', data: { x: 1 } }],
    version: 4,
  });
  const { value, rev } = await listCoordRequests(db);
  assert.equal(rev, 4);
  assert.equal(value[0].id, 'c1');
  assert.equal(value[0].x, 1);
});

// ---------- cancel (requester / admin) ----------

test('cancelCoord: not_found', async () => {
  const db = makeFakeCoordDb();
  assert.deepEqual(await cancelCoord('nope', owner, 'u1', db), { status: 'blocked', reason: 'not_found', httpStatus: 404 });
});

test('cancelCoord: forbidden for non-requester non-admin', async () => {
  const db = makeFakeCoordDb({ coords: [{ id: 'c1', requester_id: 'u-req' }] });
  assert.deepEqual(await cancelCoord('c1', other, 'someoneElse', db), { status: 'blocked', reason: 'forbidden', httpStatus: 403 });
});

test('cancelCoord: requester can cancel', async () => {
  const db = makeFakeCoordDb({ coords: [{ id: 'c1', requester_id: 'u-req', request_status: 'pending' }], version: 0 });
  const r = await cancelCoord('c1', other, 'u-req', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.rev, 1);
  assert.equal(r.value[0].requestStatus, 'cancelled');
});

test('cancelCoord: admin can cancel', async () => {
  const db = makeFakeCoordDb({ coords: [{ id: 'c1', requester_id: 'u-req' }] });
  const r = await cancelCoord('c1', admin, 'adm', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.value[0].requestStatus, 'cancelled');
});

// ---------- accept (posting owner) + accepted-single ----------

test('acceptCoord: not_found', async () => {
  const db = makeFakeCoordDb();
  assert.deepEqual(await acceptCoord('nope', owner, 'u1', db), { status: 'blocked', reason: 'not_found', httpStatus: 404 });
});

test('acceptCoord: forbidden when not posting owner', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  assert.deepEqual(await acceptCoord('c1', other, 'someoneElse', db), { status: 'blocked', reason: 'forbidden', httpStatus: 403 });
});

test('acceptCoord: posting owner accepts', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1', request_status: 'pending' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
    version: 2,
  });
  const r = await acceptCoord('c1', owner, 'u-owner', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.rev, 3);
  assert.equal(r.value.find((c) => c.id === 'c1').requestStatus, 'accepted');
});

test('acceptCoord: second accept on same post → accepted_exists/409 (from unique constraint)', async () => {
  const db = makeFakeCoordDb({
    coords: [
      { id: 'c1', post_id: 'post1', request_status: 'accepted' },
      { id: 'c2', post_id: 'post1', request_status: 'pending' },
    ],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  const r = await acceptCoord('c2', owner, 'u-owner', db);
  assert.deepEqual(r, { status: 'blocked', reason: 'accepted_exists', httpStatus: 409 });
});

test('acceptCoord: cannot accept a cancelled request (not_pending/409)', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1', request_status: 'cancelled' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  const r = await acceptCoord('c1', owner, 'u-owner', db);
  assert.deepEqual(r, { status: 'blocked', reason: 'not_pending', httpStatus: 409 });
});

test('acceptCoord: cannot accept a rejected request (not_pending/409)', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1', request_status: 'rejected' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  const r = await acceptCoord('c1', owner, 'u-owner', db);
  assert.deepEqual(r, { status: 'blocked', reason: 'not_pending', httpStatus: 409 });
});

// release path preserved: an ACCEPTED request can still be rejected/cancelled to free the posting
test('rejectCoord: owner can reject an accepted request (release path)', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1', request_status: 'accepted' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  const r = await rejectCoord('c1', owner, 'u-owner', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.value[0].requestStatus, 'rejected');
});

test('cancelCoord: requester can cancel an accepted request (release path)', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1', request_status: 'accepted', requester_id: 'u-req' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  const r = await cancelCoord('c1', other, 'u-req', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.value[0].requestStatus, 'cancelled');
});

// ---------- reject / setStage / setExec (posting owner) ----------

test('rejectCoord: posting owner rejects', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1', request_status: 'pending' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  const r = await rejectCoord('c1', owner, 'u-owner', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.value[0].requestStatus, 'rejected');
});

test('setStage: updates coordination_status (owner)', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  const r = await setStage('c1', 'specific_times_closed', owner, 'u-owner', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.value[0].coordinationStatus, 'specific_times_closed');
});

test('setExec: completed sets completedAt; forbidden for non-owner', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  assert.deepEqual(await setExec('c1', 'completed', null, other, 'x', db), { status: 'blocked', reason: 'forbidden', httpStatus: 403 });
  const r = await setExec('c1', 'completed', null, owner, 'u-owner', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.value[0].trainingExecutionStatus, 'completed');
  assert.ok(r.value[0].completedAt);
});

test('setExec: cancelled stores cancellationReason', async () => {
  const db = makeFakeCoordDb({
    coords: [{ id: 'c1', post_id: 'post1' }],
    postings: [{ id: 'post1', owner_id: 'u-owner' }],
  });
  const r = await setExec('c1', 'cancelled', 'weather', owner, 'u-owner', db);
  assert.equal(r.status, 'ok');
  assert.equal(r.value[0].cancellationReason, 'weather');
});
