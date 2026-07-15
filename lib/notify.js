import { redis } from './redis.js';

// מערכת התראות in-app (N1). אחסון fan-out-on-write: לכל משתמש Hash משלו תחת
// 'notif:{userId}', field = notifId → אובייקט ההתראה. היצירה פנימית בשרת בלבד
// (אין endpoint ציבורי ליצירה), best-effort ואינה מכשילה פעולה עסקית.
//
// המבנה מחולק בכוונה לשתי שכבות:
//   • פונקציות טהורות (buildNotification / applyMarkRead / selectTrimVictims /
//     sortByCreatedAtDesc / deriveUnreadCount) — בלי Redis, ניתנות לבדיקת יחידה.
//   • עוזרי אחסון דקים מעל Redis — מקבלים client אופציונלי (ברירת מחדל: הלקוח
//     המשותף) כדי לאפשר הזרקת fake בבדיקות.

export const NOTIF_TYPES = {
  REQUEST_NEW: 'request_new',
  REQUEST_ACCEPTED: 'request_accepted',
  REQUEST_REJECTED: 'request_rejected',
};
const KNOWN_TYPES = new Set(Object.values(NOTIF_TYPES));

// תקרת התראות למשתמש. מעבר לכך — הישנות ביותר נמחקות (מוסכם ל-MVP, גם אם
// לא-נקראו).
export const MAX_NOTIFICATIONS = 50;

export const notifKey = (userId) => `notif:${userId}`;

// ---------- שכבה טהורה ----------

// פענוח הגנתי: Upstash מחזיר אובייקטים מפוענחים, אך אם הגיע string (או fake
// שמאחסן string) — ננסה JSON.parse. ערך לא-תקין → null (מסונן במעלה).
export function parseNotification(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

// בונה את מעטפת ההתראה, או מחליט לדלג. מחזיר:
//   { skip: 'self' }         — הנמען הוא מבצע הפעולה (לא מתריעים על פעולה עצמית)
//   { skip: 'no_recipient' } — אין נמען (למשל פרסום legacy בלי ownerId)
//   { skip: 'invalid' }      — קלט חסר type/sourceId (שגיאת תכנות)
//   { notification }         — אובייקט מוכן לכתיבה (readAt: null)
// ה-id דטרמיניסטי: `${type}:${sourceId}` — בסיס לאידמפוטנטיות (create-if-absent).
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

// סימון כנקרא אידמפוטנטי (טהור): אם readAt כבר קיים — מוחזר ללא שינוי; אם null
// — נקבע הזמן הנוכחי. לעולם אינו דורס readAt קיים.
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

// בוחר את מזהי ההתראות לגיזום: כל מה שמעבר ל-max האחרונות (לפי createdAt).
// מחזיר מערך ids למחיקה (ריק אם אין עודף).
export function selectTrimVictims(list, max = MAX_NOTIFICATIONS) {
  if (list.length <= max) return [];
  return sortByCreatedAtDesc(list).slice(max).map((x) => x.id);
}

// ---------- שכבת אחסון (Redis דק) ----------

// create-if-absent אטומי: HSETNX כותב רק אם ה-field אינו קיים, ולכן לעולם אינו
// דורס createdAt/readAt של התראה קיימת. גיזום מתבצע רק כשנוצרה התראה חדשה.
export async function createNotificationIfAbsent(notification, client = redis) {
  const key = notifKey(notification.recipientId);
  const created = await client.hsetnx(key, notification.id, notification);
  if (created === 1 || created === true) {
    await trimNotifications(notification.recipientId, client);
  }
  return { created: created === 1 || created === true };
}

async function trimNotifications(userId, client = redis) {
  const key = notifKey(userId);
  const len = await client.hlen(key);
  if (!len || len <= MAX_NOTIFICATIONS) return;
  const all = await readAll(userId, client);
  const victims = selectTrimVictims(all, MAX_NOTIFICATIONS);
  if (victims.length) await client.hdel(key, ...victims);
}

async function readAll(userId, client = redis) {
  const map = await client.hgetall(notifKey(userId));
  if (!map) return [];
  return Object.values(map).map(parseNotification).filter(Boolean);
}

// רשימת ההתראות של המשתמש, מהחדש לישן, עם מונה לא-נקראו.
export async function listNotifications(userId, client = redis) {
  const all = await readAll(userId, client);
  return { items: sortByCreatedAtDesc(all), unreadCount: deriveUnreadCount(all) };
}

// סימון פריט בודד כנקרא (RMW אידמפוטני). הכותב היחיד שיכול להתחרות על אותו
// field אחרי היצירה הוא mark-read אחר של אותו משתמש — התוצאה אידמפוטנטית.
// מחזיר את ההתראה המעודכנת, או null אם אינה קיימת.
export async function markNotificationRead(userId, id, client = redis) {
  const key = notifKey(userId);
  const existing = parseNotification(await client.hget(key, id));
  if (!existing) return null;
  if (existing.readAt) return existing;
  const updated = applyMarkRead(existing, new Date().toISOString());
  await client.hset(key, { [id]: updated });
  return updated;
}

// סימון כל הלא-נקראו כנקראו. מחזיר את מספר הפריטים שעודכנו.
export async function markAllNotificationsRead(userId, client = redis) {
  const key = notifKey(userId);
  const all = await readAll(userId, client);
  const now = new Date().toISOString();
  let updated = 0;
  for (const n of all) {
    if (!n.readAt) {
      await client.hset(key, { [n.id]: applyMarkRead(n, now) });
      updated++;
    }
  }
  return updated;
}

// נקודת הכניסה הפנימית ליצירת התראה. best-effort: לעולם אינה זורקת. דילוגים
// (self/no_recipient) וכשלים נרשמים ב-console.error מובנה, והפעולה העסקית
// שקראה לה ממשיכה כרגיל.
export async function notify(event, client = redis) {
  const built = buildNotification({ ...event, now: new Date().toISOString() });
  if (built.skip === 'self' || built.skip === 'invalid') return { skipped: built.skip };
  if (built.skip === 'no_recipient') {
    console.error('[notify] דילוג — אין נמען', { type: event?.type, sourceId: event?.sourceId });
    return { skipped: 'no_recipient' };
  }
  try {
    const { created } = await createNotificationIfAbsent(built.notification, client);
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
