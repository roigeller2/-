import { listNotifications, markNotificationRead, markAllNotificationsRead } from './notify.js';

// לוגיקת ה-handlers של /api/notifications, מופרדת מ-route.js כדי להיות ניתנת
// לבדיקת יחידה בלי next/server, בלי auth ובלי Redis אמיתי. כל handler מקבל
// { access, userId } (מהסשן, בשרת) ומחזיר { status, body } טהור; ה-route רק
// ממפה אותו ל-NextResponse. deps מוזרקות (ברירת מחדל: העוזרים האמיתיים).
//
// חוזה ההרשאות עקבי עם שאר ה-API בפרויקט: 403 אחיד גם ללא session וגם למשתמש
// שאינו approved (canUse=false). אין הפרדת 401/403 בפרויקט — לא ממציאים כזו.

const defaultDeps = { listNotifications, markNotificationRead, markAllNotificationsRead };

const forbidden = () => ({ status: 403, body: { ok: false, error: 'אין הרשאה' } });

// שגיאת שרת גנרית — בלי חשיפת פרטים פנימיים ללקוח. הפרטים נרשמים ב-console.error.
const serverError = (status) => ({ status, body: { ok: false, error: 'שגיאת שרת' } });

export async function notificationsGet({ access, userId }, deps = defaultDeps) {
  if (!access?.canUse) return forbidden();
  try {
    const { items, unreadCount } = await deps.listNotifications(userId);
    return { status: 200, body: { ok: true, items, unreadCount } };
  } catch (e) {
    console.error('[api/notifications] GET failed:', e);
    return serverError(503);
  }
}

// readBody: thunk אסינכרוני שמחזיר את גוף ה-JSON (בשרת: request.json()). כישלון
// פענוח מטופל כאן כ-400, בנפרד משגיאות אחסון (500).
export async function notificationsPost({ access, userId, readBody }, deps = defaultDeps) {
  if (!access?.canUse) return forbidden();

  let body;
  try {
    body = await readBody();
  } catch {
    return { status: 400, body: { ok: false, error: 'גוף הבקשה אינו JSON תקין' } };
  }

  const op = body?.op;
  try {
    if (op === 'markRead') {
      const id = body?.id;
      if (typeof id !== 'string' || id.trim() === '') {
        return { status: 400, body: { ok: false, error: 'מזהה התראה חסר' } };
      }
      // פועל אך ורק בתוך notif:{userId} של המשתמש המחובר — id של משתמש אחר
      // פשוט לא יימצא ב-Hash שלו ויחזיר not_found (אין דרך לגעת בהתראות של אחר).
      const updated = await deps.markNotificationRead(userId, id);
      if (!updated) return { status: 404, body: { ok: false, error: 'not_found' } };
      return { status: 200, body: { ok: true, notification: updated } };
    }

    if (op === 'markAllRead') {
      const updated = await deps.markAllNotificationsRead(userId);
      return { status: 200, body: { ok: true, updated } };
    }

    return { status: 400, body: { ok: false, error: 'פעולה לא מוכרת' } };
  } catch (e) {
    console.error('[api/notifications] POST failed:', e);
    return serverError(500);
  }
}
