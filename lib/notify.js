import { pool } from './db.js';

// מערכת התראות in-app (N1). אחסון ב-Postgres (טבלת notifications): שורה לכל התראה,
// PK הרכבי (recipient_id, id) — ה-id הדטרמיניסטי `${type}:${sourceId}` משמש כמפתח
// מניעת כפילות. היצירה פנימית בשרת בלבד, best-effort, ואינה מכשילה פעולה עסקית.
//
// מבנה בשתי שכבות:
//   • פונקציות טהורות (buildNotification / applyMarkRead / selectTrimVictims /
//     sortByCreatedAtDesc / deriveUnreadCount / parseNotification) — בלי I/O, ניתנות לבדיקה.
//   • עוזרי אחסון מעל Postgres — מקבלים db אופציונלי (ברירת מחדל: ה-pool) להזרקת fake בבדיקות.

export const NOTIF_TYPES = {
  REQUEST_NEW: 'request_new',
  REQUEST_ACCEPTED: 'request_accepted',
  REQUEST_REJECTED: 'request_rejected',
};
const KNOWN_TYPES = new Set(Object.values(NOTIF_TYPES));

// תקרת התראות למשתמש. מעבר לכך — הישנות ביותר נמחקות (גם אם לא-נקראו).
export const MAX_NOTIFICATIONS = 50;

// נשמר לתאימות (שם ה-Hash הישן); אינו בשימוש במסלול ה-Postgres.
export const notifKey = (userId) => `notif:${userId}`;

// ---------- שכבה טהורה ----------

export function parseNotification(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

// בונה את מעטפת ההתראה, או מחליט לדלג. ה-id דטרמיניסטי: `${type}:${sourceId}`.
export function buildNotification({ type, sourceId, recipientId, actorId, data, now }) {
  if (!type || !KNOWN_TYPES.has(type) || !sourceId) return { skip: 'invalid' };
  if (!recipientId) return { skip: 'no_recipient' };
  if (actorId && recipientId === actorId) return { skip: 'self' };
  return {
    notification: {
      id: `${type}:${sourceId}`,
      type,
      recipientId,
      actorId: actorId || null,
      createdAt: now || new Date().toISOString(),
      readAt: null,
      data: data || {},
    },
  };
}

export function applyMarkRead(notification, now) {
  if (!notification) return notification;
  if (notification.readAt) return notification;
  return { ...notification, readAt: now || new Date().toISOString() };
}

export function sortByCreatedAtDesc(list) {
  return [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export function deriveUnreadCount(list) {
  return list.reduce((n, x) => (x && !x.readAt ? n + 1 : n), 0);
}

export function selectTrimVictims(list, max = MAX_NOTIFICATIONS) {
  if (list.length <= max) return [];
  return sortByCreatedAtDesc(list).slice(max).map((x) => x.id);
}

// ---------- שכבת אחסון (Postgres) ----------

const toIso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : v);

function rowToNotif(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    recipientId: row.recipient_id,
    actorId: row.actor_id ?? null,
    createdAt: toIso(row.created_at),
    readAt: toIso(row.read_at),
    data: row.data && typeof row.data === 'object' ? row.data : {},
  };
}

async function withTx(db, fn) {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// create-if-absent אטומי: INSERT ... ON CONFLICT (recipient_id, id) DO NOTHING — גם יצירות
// מקבילות של אותה התראה נשמרות פעם אחת (ה-PK הייחודי מבטיח זאת ברמת ה-DB). גיזום לשמירת
// מגבלת 50 מתבצע רק כשנוצרה התראה חדשה, באותה טרנזקציה (מתכנס גם ביצירות מקבילות).
export async function createNotificationIfAbsent(notification, db = pool) {
  return withTx(db, async (client) => {
    const ins = await client.query(
      `insert into notifications (recipient_id, id, type, actor_id, data, created_at, read_at)
       values ($1, $2, $3, $4, $5, $6, null)
       on conflict (recipient_id, id) do nothing
       returning id`,
      [
        notification.recipientId,
        notification.id,
        notification.type,
        notification.actorId ?? null,
        JSON.stringify(notification.data || {}),
        notification.createdAt,
      ]
    );
    const created = ins.rows.length === 1;
    if (created) await trimNotifications(notification.recipientId, client);
    return { created };
  });
}

// גיזום: מחיקת ההתראות הישנות של המשתמש מעבר ל-50 החדשות (לפי created_at). מוחק *התראות
// בלבד* — לעולם לא postings/coordination. פועל על client קיים (בתוך טרנזקציית היצירה).
async function trimNotifications(recipientId, client) {
  await client.query(
    `delete from notifications
      where recipient_id = $1
        and id in (
          select id from notifications where recipient_id = $1
          order by created_at desc offset $2
        )`,
    [recipientId, MAX_NOTIFICATIONS]
  );
}

async function readAll(recipientId, db = pool) {
  const { rows } = await db.query(`select * from notifications where recipient_id = $1`, [recipientId]);
  return rows.map(rowToNotif);
}

// רשימת ההתראות של המשתמש, מהחדש לישן, עם מונה לא-נקראו.
export async function listNotifications(userId, db = pool) {
  const all = await readAll(userId, db);
  return { items: sortByCreatedAtDesc(all), unreadCount: deriveUnreadCount(all) };
}

// סימון פריט בודד כנקרא (אידמפוטני). בעלות נאכפת בשאילתה עצמה (recipient_id = userId),
// כך שמשתמש לעולם אינו נוגע בהתראה של אחר. לא קיים → null; כבר נקרא → מוחזר כמות שהוא.
export async function markNotificationRead(userId, id, db = pool) {
  return withTx(db, async (client) => {
    const sel = await client.query(
      `select * from notifications where recipient_id = $1 and id = $2 for update`,
      [userId, id]
    );
    const existing = rowToNotif(sel.rows[0]);
    if (!existing) return null;
    if (existing.readAt) return existing;
    const upd = await client.query(
      `update notifications set read_at = now()
        where recipient_id = $1 and id = $2 and read_at is null
        returning *`,
      [userId, id]
    );
    return rowToNotif(upd.rows[0]) || existing;
  });
}

// סימון כל הלא-נקראו כנקראו. בעלות נאכפת בשאילתת העדכון עצמה. מחזיר כמה עודכנו.
export async function markAllNotificationsRead(userId, db = pool) {
  const res = await db.query(
    `update notifications set read_at = now() where recipient_id = $1 and read_at is null`,
    [userId]
  );
  return res.rowCount || 0;
}

// נקודת כניסה פנימית ליצירת התראה. best-effort: לעולם אינה זורקת.
export async function notify(event, db = pool) {
  const built = buildNotification({ ...event, now: new Date().toISOString() });
  if (built.skip === 'self' || built.skip === 'invalid') return { skipped: built.skip };
  if (built.skip === 'no_recipient') {
    console.error('[notify] דילוג — אין נמען', { type: event?.type, sourceId: event?.sourceId });
    return { skipped: 'no_recipient' };
  }
  try {
    const { created } = await createNotificationIfAbsent(built.notification, db);
    return { created };
  } catch (err) {
    console.error('[notify] כשל ביצירת התראה', {
      type: built.notification.type,
      id: built.notification.id,
      recipientId: built.notification.recipientId,
      error: err?.message || String(err),
    });
    return { error: true };
  }
}
