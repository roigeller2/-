import { coordPostId, normalizeRequestStatus, COORD_STAGE_KEYS } from './coord.js';

// "המשימות שלי" — נגזרות מהמצב החי (postings + coordRequests + זהות המשתמש),
// אינן נשמרות כישות. פונקציה טהורה, ניתנת לבדיקת יחידה בלי Redis/רשת.
//
// המשימות אישיות בלבד — לפי ownerId (בעל האימון) ו-requesterId (שולח הבקשה),
// גם עבור Admin (Admin אינו רואה משימות של המערכת כולה). אימונים/בקשות legacy
// ללא ownerId/requesterId אינם משויכים ולכן אינם מופיעים.

export const TASK_TYPES = {
  TRAINING_TODAY: 'training_today',
  INCOMING_REQUEST: 'incoming_request',
  TRAINING_TOMORROW: 'training_tomorrow',
  REQUEST_ACCEPTED: 'request_accepted',
};

// סדר עדיפויות (נמוך = דחוף/עליון): אימון היום → בקשה חדשה → אימון מחר →
// בקשה שאושרה.
const PRIORITY = {
  [TASK_TYPES.TRAINING_TODAY]: 1,
  [TASK_TYPES.INCOMING_REQUEST]: 2,
  [TASK_TYPES.TRAINING_TOMORROW]: 3,
  [TASK_TYPES.REQUEST_ACCEPTED]: 4,
};

// אינדקס שלב התיאום; שלב לא-מוכר/חסר נחשב לשלב הראשוני (0).
const stageIndex = (c) => {
  const i = COORD_STAGE_KEYS.indexOf(c && c.coordinationStatus);
  return i === -1 ? 0 : i;
};

const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// היום/מחר לפי זמן מקומי; מחזיר 'today' | 'tomorrow' | null.
function dateKind(trainingDate, now) {
  if (!trainingDate) return null;
  const d = String(trainingDate).slice(0, 10);
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (d === today) return 'today';
  if (d === tomorrow) return 'tomorrow';
  return null;
}

// הקשר תצוגה לא-רגיש לכותרת המשנה של הכרטיס.
function contextOf(coord) {
  const area = Array.isArray(coord?.areas) ? (coord.areas[0] ?? null) : (coord?.area ?? null);
  return {
    unitName: coord?.unitName ?? null,
    brigade: coord?.brigade ?? null,
    squadronNumber: coord?.squadronNumber ?? null,
    postType: coord?.postType ?? null,
    // מי הגיש את הבקשה — קובע בצד השולח אם הוא הצד שיוזם WhatsApp (helicopter).
    requestedByType: coord?.requestedByType ?? null,
    trainingDate: coord?.trainingDate ?? null,
    area,
    space: coord?.space ?? null,
  };
}

// "כל האימונים שלי" — רשימה מלאה של האימונים שהמשתמש מעורב בהם: אימונים שפרסם
// (ownerId) + אימונים שביקש להצטרף אליהם (requesterId על בקשת תיאום). מחזירה את
// אובייקטי ה-postings, ללא כפילויות, בלי סינון סטטוס (כולל היסטוריה). פונקציה
// טהורה. אימונים/בקשות legacy ללא ownerId/requesterId אינם משויכים.
export function deriveMyTrainings(postings, coordRequests, me) {
  const userId = me?.userId;
  if (!userId) return [];
  const byId = new Map((postings || []).map((p) => [p.id, p]));
  const ids = new Set();
  for (const p of postings || []) {
    if (p && p.ownerId != null && p.ownerId === userId) ids.add(p.id);
  }
  for (const c of coordRequests || []) {
    if (c && c.requesterId != null && c.requesterId === userId) {
      const pid = coordPostId(c);
      if (pid != null && byId.has(pid)) ids.add(pid);
    }
  }
  return [...ids].map((id) => byId.get(id)).filter(Boolean);
}

// נגזרת המשימות של המשתמש, ממוינת. now מוזרק לבדיקות (ברירת מחדל: עכשיו).
export function deriveMyTasks(postings, coordRequests, me, now = new Date()) {
  const userId = me?.userId;
  if (!userId) return [];

  const byId = new Map((postings || []).map((p) => [p.id, p]));
  const tasks = [];

  for (const coord of coordRequests || []) {
    const status = normalizeRequestStatus(coord);
    if (status === 'rejected' || status === 'cancelled') continue;
    const exec = coord?.trainingExecutionStatus;
    if (exec === 'completed' || exec === 'cancelled') continue;

    const posting = byId.get(coordPostId(coord));
    // בעלות מדויקת בלבד (ownerId/requesterId) — גם עבור Admin. legacy ללא
    // מזהים אלה אינו משויך.
    const isOwner = posting && posting.ownerId != null && posting.ownerId === userId;
    const isRequester = coord?.requesterId != null && coord.requesterId === userId;
    if (!isOwner && !isRequester) continue;

    // מועמדי סוג לתיאום זה; נבחר את בעל העדיפות הגבוהה ביותר (דה-דופ per-coord).
    const candidates = [];
    if (status === 'pending' && isOwner) {
      candidates.push(TASK_TYPES.INCOMING_REQUEST);
    }
    if (status === 'accepted') {
      const kind = dateKind(coord.trainingDate, now);
      if (kind === 'today' && (isOwner || isRequester)) candidates.push(TASK_TYPES.TRAINING_TODAY);
      if (kind === 'tomorrow' && (isOwner || isRequester)) candidates.push(TASK_TYPES.TRAINING_TOMORROW);
      // "הבקשה שלך אושרה" — רק לשולח, ורק בשלב הראשוני (נעלמת כשהתקדם מעבר לו).
      if (isRequester && stageIndex(coord) === 0) candidates.push(TASK_TYPES.REQUEST_ACCEPTED);
    }
    if (candidates.length === 0) continue;

    const type = candidates.sort((a, b) => PRIORITY[a] - PRIORITY[b])[0];
    tasks.push({
      id: `${type}:${coord.id}`,
      type,
      coordId: coord.id,
      postingId: coordPostId(coord) ?? null,
      context: contextOf(coord),
    });
  }

  // מיון: לפי עדיפות, ואז לפי תאריך האימון עולה, ואז לפי coordId (יציב).
  tasks.sort((a, b) => {
    const p = PRIORITY[a.type] - PRIORITY[b.type];
    if (p !== 0) return p;
    const da = a.context.trainingDate || '';
    const db = b.context.trainingDate || '';
    if (da !== db) return da < db ? -1 : 1;
    return a.coordId < b.coordId ? -1 : a.coordId > b.coordId ? 1 : 0;
  });

  return tasks;
}
