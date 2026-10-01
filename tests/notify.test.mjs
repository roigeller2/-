import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeNotifDb } from './fakePgNotif.mjs';
import {
  createNotificationIfAbsent, listNotifications, markNotificationRead,
  markAllNotificationsRead, notify, buildNotification, NOTIF_TYPES, MAX_NOTIFICATIONS,
} from '../lib/notify.js';

const mkNotif = (over = {}) => ({
  id: over.id || 'request_new:src1',
  type: NOTIF_TYPES.REQUEST_NEW,
  recipientId: over.recipientId || 'u1',
  actorId: over.actorId || 'actor1',
  createdAt: over.createdAt || new Date(Date.UTC(2026, 0, 1)).toISOString(),
  readAt: null,
  data: over.data || { title: 't' },
});

// ---------- מניעת כפילות (מפתח id דטרמיניסטי) ----------

test('createNotificationIfAbsent: first create inserts, duplicate id is no-op (idempotent)', async () => {
  const db = makeFakeNotifDb();
  const r1 = await createNotificationIfAbsent(mkNotif(), db);
  assert.equal(r1.created, true);
  const r2 = await createNotificationIfAbsent(mkNotif(), db); // same id
  assert.equal(r2.created, false);
  const { items } = await listNotifications('u1', db);
  assert.equal(items.length, 1); // saved once
});

test('buildNotification: deterministic id = `${type}:${sourceId}` (dedup key preserved)', () => {
  const b = buildNotification({ type: NOTIF_TYPES.REQUEST_ACCEPTED, sourceId: 'abc', recipientId: 'u1', actorId: 'u2' });
  assert.equal(b.notification.id, 'request_accepted:abc');
});

// ---------- list + order + unread ----------

test('listNotifications: newest-first order + unread count', async () => {
  const db = makeFakeNotifDb([
    { recipient_id: 'u1', id: 'a', created_at: new Date(Date.UTC(2026, 0, 1)), read_at: null },
    { recipient_id: 'u1', id: 'b', created_at: new Date(Date.UTC(2026, 0, 3)), read_at: null },
    { recipient_id: 'u1', id: 'c', created_at: new Date(Date.UTC(2026, 0, 2)), read_at: new Date() },
  ]);
  const { items, unreadCount } = await listNotifications('u1', db);
  assert.deepEqual(items.map((n) => n.id), ['b', 'c', 'a']); // desc by createdAt
  assert.equal(unreadCount, 2);
});

// ---------- markRead: ownership in the query + idempotency + not_found ----------

test('markNotificationRead: not_found → null', async () => {
  const db = makeFakeNotifDb();
  assert.equal(await markNotificationRead('u1', 'nope', db), null);
});

test('markNotificationRead: marks unread, idempotent on already-read', async () => {
  const db = makeFakeNotifDb([{ recipient_id: 'u1', id: 'a', read_at: null }]);
  const first = await markNotificationRead('u1', 'a', db);
  assert.ok(first.readAt);
  const again = await markNotificationRead('u1', 'a', db); // idempotent, not null
  assert.ok(again.readAt);
});

test('markNotificationRead: cannot touch another user notification (ownership filter)', async () => {
  const db = makeFakeNotifDb([{ recipient_id: 'u2', id: 'a', read_at: null }]);
  // u1 tries to mark u2's notification with same id
  assert.equal(await markNotificationRead('u1', 'a', db), null);
  // u2's notification remains unread
  const { unreadCount } = await listNotifications('u2', db);
  assert.equal(unreadCount, 1);
});

// ---------- markAllRead: count + ownership ----------

test('markAllNotificationsRead: marks only this user, returns count', async () => {
  const db = makeFakeNotifDb([
    { recipient_id: 'u1', id: 'a', read_at: null },
    { recipient_id: 'u1', id: 'b', read_at: null },
    { recipient_id: 'u2', id: 'c', read_at: null },
  ]);
  const n = await markAllNotificationsRead('u1', db);
  assert.equal(n, 2);
  assert.equal((await listNotifications('u1', db)).unreadCount, 0);
  assert.equal((await listNotifications('u2', db)).unreadCount, 1); // untouched
});

// ---------- 50-cap trim on create (incl. sequential/converging creates) ----------

test('createNotificationIfAbsent: enforces MAX_NOTIFICATIONS cap, trimming oldest on create', async () => {
  const db = makeFakeNotifDb();
  for (let i = 0; i < MAX_NOTIFICATIONS + 5; i++) {
    await createNotificationIfAbsent(
      mkNotif({ id: 'n' + String(i).padStart(3, '0'), createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }),
      db
    );
  }
  const { items } = await listNotifications('u1', db);
  assert.equal(items.length, MAX_NOTIFICATIONS); // capped at 50
  // oldest 5 (n000..n004) trimmed; newest kept
  assert.ok(!items.some((n) => n.id === 'n000'));
  assert.ok(items.some((n) => n.id === 'n054'));
});

// ---------- notify() orchestration: best-effort, self/no_recipient skips ----------

test('notify: self-recipient skip', async () => {
  const db = makeFakeNotifDb();
  const r = await notify({ type: NOTIF_TYPES.REQUEST_NEW, sourceId: 's', recipientId: 'u1', actorId: 'u1' }, db);
  assert.equal(r.skipped, 'self');
});

test('notify: no_recipient skip', async () => {
  const db = makeFakeNotifDb();
  const r = await notify({ type: NOTIF_TYPES.REQUEST_NEW, sourceId: 's', recipientId: null, actorId: 'u2' }, db);
  assert.equal(r.skipped, 'no_recipient');
});

test('notify: never throws on storage failure (best-effort)', async () => {
  const brokenDb = { connect: () => Promise.reject(new Error('db down')) };
  const r = await notify({ type: NOTIF_TYPES.REQUEST_NEW, sourceId: 's', recipientId: 'u1', actorId: 'u2' }, brokenDb);
  assert.equal(r.error, true); // returned, not thrown
});
