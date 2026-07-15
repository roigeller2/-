import { NOTIF_TYPES } from './notify.js';
import { coordPostId } from './coord.js';

// בניית אירועי ההתראה של N1 מתוך הנתונים הטריים של המוטציה המוצלחת (הבקשה
// שנוצרה/אושרה/נדחתה), בלי קריאה מאוחרת שעלולה לראות מצב שכבר השתנה. פונקציות
// טהורות — בלי Redis, בלי notify — כדי שיהיו ניתנות לבדיקת יחידה.
//
// requesterId, postId ו-ownerId הם שדות בלתי-משתנים, ולכן בטוח לגזור מהם נמען.
// self-skip, no_recipient-skip ואי-כפילות (HSETNX) מטופלים בשכבת notify עצמה.

const TEXT = {
  [NOTIF_TYPES.REQUEST_NEW]: { title: 'בקשת תיאום חדשה', message: 'התקבלה בקשת תיאום חדשה לאימון שלך.' },
  [NOTIF_TYPES.REQUEST_ACCEPTED]: { title: 'בקשת התיאום אושרה', message: 'בקשת התיאום שלך אושרה.' },
  [NOTIF_TYPES.REQUEST_REJECTED]: { title: 'בקשת התיאום נדחתה', message: 'בקשת התיאום שלך נדחתה.' },
};

// שדות תצוגה נבנים בצד השרת, הגנתי: ההתראה מובנת גם אם חלקם חסרים. אין מידע
// רגיש (למשל טלפון) — רק שדות הקשר לא-רגישים.
export function notifDataFor(type, coord) {
  const area = Array.isArray(coord?.areas) ? (coord.areas[0] ?? null) : (coord?.area ?? null);
  return {
    ...(TEXT[type] || {}),
    postingId: coordPostId(coord) ?? null,
    requestId: coord?.id ?? null,
    trainingDate: coord?.trainingDate ?? null,
    area,
    space: coord?.space ?? null,
    postType: coord?.postType ?? null,
  };
}

// request_new → נמען = בעל האימון (ownerId של הפרסום). ללא ownerId (legacy) →
// recipientId=null, ו-notify ידלג וירשום לוג (לא מפנים ל-Admin).
export function buildRequestNewEvent(coord, posting, actorId) {
  return {
    type: NOTIF_TYPES.REQUEST_NEW,
    sourceId: coord?.id,
    recipientId: posting?.ownerId ?? null,
    actorId: actorId ?? null,
    data: notifDataFor(NOTIF_TYPES.REQUEST_NEW, coord),
  };
}

// request_accepted / request_rejected → נמען = יוצר הבקשה (requesterId).
export function buildRequestStatusEvent(type, coord, actorId) {
  return {
    type,
    sourceId: coord?.id,
    recipientId: coord?.requesterId ?? null,
    actorId: actorId ?? null,
    data: notifDataFor(type, coord),
  };
}

// חוזה "רק אחרי הצלחת ה-CAS": מריץ את ה-emit אך ורק כשהמוטציה החזירה status
// 'ok' (לא blocked/conflict/error), ובולע כל כשל של פתרון נמען/בניית התראה/
// כתיבה כך שלעולם לא ישפיע על תגובת הפעולה העסקית. מחזיר {emitted} לצורך בדיקה.
export async function emitIfOk(result, emit) {
  if (result?.status !== 'ok') return { emitted: false, skipped: 'not_ok' };
  try {
    await emit(result.value);
    return { emitted: true };
  } catch (e) {
    console.error('[notify] כשל בחיווט התראה אחרי מוטציה מוצלחת', { error: e?.message || String(e) });
    return { emitted: false, error: true };
  }
}
