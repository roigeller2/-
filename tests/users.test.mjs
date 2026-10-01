import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeDb } from './fakePg.mjs';
import {
  ensureProfileOnSignIn,
  getProfile,
  listProfiles,
  setApprovalStatus,
  cancelRequest,
  setReferral,
  REFERRAL_MAX,
} from '../lib/users.js';

const ADMINS = 'admin@example.com, boss@example.com';

// ---------- ensureProfileOnSignIn ----------

test('ensureProfileOnSignIn: null userId → null', async () => {
  const db = makeFakeDb();
  assert.equal(await ensureProfileOnSignIn(null, 'a@b.com', 'A', db), null);
});

test('ensureProfileOnSignIn: creates new profile with correct defaults', async () => {
  const db = makeFakeDb();
  const p = await ensureProfileOnSignIn('u1', 'User@Example.com ', 'Dana', db);
  assert.equal(p.userId, 'u1');
  assert.equal(p.email, 'user@example.com'); // normalized
  assert.equal(p.name, 'Dana');
  assert.equal(p.approvalStatus, 'pending');
  assert.equal(p.referralSource, null);
  assert.equal(p.onboardingCompletedAt, null);
  assert.equal(p.requestActive, true);
  assert.equal(p.lastChangedBy, null);
  assert.equal(typeof p.createdAt, 'string'); // ISO
});

test('ensureProfileOnSignIn: idempotent — existing returned unchanged', async () => {
  const db = makeFakeDb([
    { user_id: 'u1', email: 'u@e.com', approval_status: 'approved', request_active: true, onboarding_completed_at: new Date() },
  ]);
  const p = await ensureProfileOnSignIn('u1', 'u@e.com', 'X', db);
  assert.equal(p.approvalStatus, 'approved'); // not reset
});

test('ensureProfileOnSignIn: reactivates cancelled request (pending + requestActive=false)', async () => {
  const db = makeFakeDb([
    { user_id: 'u1', email: 'u@e.com', approval_status: 'pending', request_active: false },
  ]);
  const p = await ensureProfileOnSignIn('u1', 'u@e.com', 'X', db);
  assert.equal(p.approvalStatus, 'pending');
  assert.equal(p.requestActive, true);
});

// ---------- getProfile ----------

test('getProfile: absent → null, present → profile', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com' }]);
  assert.equal(await getProfile('nope', db), null);
  assert.equal((await getProfile('u1', db)).userId, 'u1');
});

// ---------- listProfiles ----------

test('listProfiles: returns all, mapped to camelCase', async () => {
  const db = makeFakeDb([
    { user_id: 'a', email: 'a@e.com' },
    { user_id: 'b', email: 'b@e.com' },
  ]);
  const list = await listProfiles(db);
  assert.equal(list.length, 2);
  assert.ok(list.every((p) => typeof p.userId === 'string' && 'approvalStatus' in p));
});

// ---------- setApprovalStatus ----------

test('setApprovalStatus: invalid status', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com' }]);
  assert.deepEqual(await setApprovalStatus('u1', 'bogus', 'adm', db), { ok: false, reason: 'invalid' });
});

test('setApprovalStatus: not_found', async () => {
  const db = makeFakeDb();
  assert.deepEqual(await setApprovalStatus('u1', 'approved', 'adm', db), { ok: false, reason: 'not_found' });
});

test('setApprovalStatus: approve blocked without onboarding', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'pending', onboarding_completed_at: null }]);
  assert.deepEqual(await setApprovalStatus('u1', 'approved', 'adm', db), { ok: false, reason: 'onboarding_incomplete' });
});

test('setApprovalStatus: invalid_transition reports from', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'approved', onboarding_completed_at: new Date() }]);
  // approved → approved is not allowed
  assert.deepEqual(await setApprovalStatus('u1', 'approved', 'adm', db), { ok: false, reason: 'invalid_transition', from: 'approved' });
});

test('setApprovalStatus: pending → approved succeeds after onboarding', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'pending', onboarding_completed_at: new Date() }]);
  const r = await setApprovalStatus('u1', 'approved', 'adm', db);
  assert.equal(r.ok, true);
  assert.equal(r.profile.approvalStatus, 'approved');
  assert.equal(r.profile.lastChangedBy, 'adm');
});

test('setApprovalStatus: pending → rejected succeeds (no onboarding needed)', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'pending', onboarding_completed_at: null }]);
  const r = await setApprovalStatus('u1', 'rejected', 'adm', db);
  assert.equal(r.ok, true);
  assert.equal(r.profile.approvalStatus, 'rejected');
});

// ---------- cancelRequest ----------

test('cancelRequest: not_found', async () => {
  const db = makeFakeDb();
  assert.deepEqual(await cancelRequest('u1', 'adm', db), { ok: false, reason: 'not_found' });
});

test('cancelRequest: invalid_state for approved', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'approved' }]);
  assert.deepEqual(await cancelRequest('u1', 'adm', db), { ok: false, reason: 'invalid_state', from: 'approved' });
});

test('cancelRequest: from pending resets to pending + inactive', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'pending', referral_source: 'friend', onboarding_completed_at: new Date(), request_active: true }]);
  const r = await cancelRequest('u1', 'adm', db);
  assert.equal(r.ok, true);
  assert.equal(r.profile.approvalStatus, 'pending');
  assert.equal(r.profile.referralSource, null);
  assert.equal(r.profile.onboardingCompletedAt, null);
  assert.equal(r.profile.requestActive, false);
});

test('cancelRequest: from rejected (unreject) resets', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'rejected', request_active: true }]);
  const r = await cancelRequest('u1', 'adm', db);
  assert.equal(r.ok, true);
  assert.equal(r.profile.approvalStatus, 'pending');
  assert.equal(r.profile.requestActive, false);
});

// ---------- setReferral ----------

test('setReferral: invalid (empty / too long)', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'pending' }]);
  assert.deepEqual(await setReferral('u1', '   ', ADMINS, db), { ok: false, reason: 'invalid' });
  assert.deepEqual(await setReferral('u1', 'x'.repeat(REFERRAL_MAX + 1), ADMINS, db), { ok: false, reason: 'invalid' });
});

test('setReferral: not_found', async () => {
  const db = makeFakeDb();
  assert.deepEqual(await setReferral('u1', 'friend', ADMINS, db), { ok: false, reason: 'not_found' });
});

test('setReferral: locked for admin', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'admin@example.com', approval_status: 'pending' }]);
  assert.deepEqual(await setReferral('u1', 'friend', ADMINS, db), { ok: false, reason: 'locked' });
});

test('setReferral: locked for non-pending (approved)', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'approved' }]);
  assert.deepEqual(await setReferral('u1', 'friend', ADMINS, db), { ok: false, reason: 'locked' });
});

test('setReferral: pending non-admin succeeds, sets onboarding + active', async () => {
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'pending' }]);
  const r = await setReferral('u1', '  from a friend  ', ADMINS, db);
  assert.equal(r.ok, true);
  assert.equal(r.profile.referralSource, 'from a friend'); // trimmed
  assert.ok(r.profile.onboardingCompletedAt); // set
  assert.equal(r.profile.requestActive, true);
});

test('setReferral: second edit keeps original onboardingCompletedAt (coalesce)', async () => {
  const original = new Date(Date.UTC(2025, 5, 1));
  const db = makeFakeDb([{ user_id: 'u1', email: 'u@e.com', approval_status: 'pending', onboarding_completed_at: original }]);
  const r = await setReferral('u1', 'updated', ADMINS, db);
  assert.equal(r.ok, true);
  assert.equal(r.profile.onboardingCompletedAt, original.toISOString()); // unchanged
});
