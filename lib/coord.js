// עוזרים ומוטטורים טהורים ללוגיקת בקשות התיאום. מקור אמת יחיד שמשמש את
// ה-Route Handler בצד השרת ואת בדיקות היחידה — כך לוגיקת האכיפה (ובראשה
// אינווריאנט accepted-היחיד) נבדקת ישירות, בלי תלות ב-Redis.

// שדה שיוך בקשה-לאימון. השדה האמיתי הוא postId; fallback ל-postingId הגנתי בלבד.
export const coordPostId = (c) => (c && (c.postId ?? c.postingId));

// נרמול סטטוס בקשה (תאימות-בקריאה). 'active' ישן → 'pending'.
export const normalizeRequestStatus = (c) => {
  const s = c && c.requestStatus;
  if (s === 'accepted') return 'accepted';
  if (s === 'rejected') return 'rejected';
  if (s === 'cancelled') return 'cancelled';
  return 'pending';
};

// מפתחות תקינים לוולידציה בצד השרת.
export const COORD_STAGE_KEYS = ['initial_coordination_done', 'specific_times_closed', 'planning_summary_done'];
export const EXEC_STATUS_KEYS = ['pending', 'completed', 'cancelled', 'unknown'];

const nowIso = () => new Date().toISOString();

// כל פונקציה מחזירה "mutator" תואם ל-mutateCollectionServer:
//   (list) => מערך חדש | { block:true, reason, httpStatus }
// כך הבדיקה/האינווריאנט מתבצעים על הנתונים הטריים שהשרת קרא, בכל ניסיון.

export const mutatorCreate = (coord) => (list) => [...list, coord];

// אישור בקשה — אכיפת accepted-יחיד: אם קיימת בקשה אחרת accepted לאותו אימון, חסום.
export const mutatorAccept = (id) => (list) => {
  const target = list.find(c => c.id === id);
  if (!target) return { block: true, reason: 'not_found', httpStatus: 404 };
  const exists = list.some(c => c.id !== id
    && coordPostId(c) === coordPostId(target)
    && normalizeRequestStatus(c) === 'accepted');
  if (exists) return { block: true, reason: 'accepted_exists', httpStatus: 409 };
  return list.map(c => c.id === id ? { ...c, requestStatus: 'accepted', updatedAt: nowIso() } : c);
};

// קביעת סטטוס בקשה ל-'rejected' או 'cancelled'.
export const mutatorSetRequestStatus = (id, status) => (list) => {
  const target = list.find(c => c.id === id);
  if (!target) return { block: true, reason: 'not_found', httpStatus: 404 };
  return list.map(c => c.id === id ? { ...c, requestStatus: status, updatedAt: nowIso() } : c);
};

// עדכון שלב התיאום המקצועי של הבקשה (coordinationStatus).
export const mutatorSetStage = (id, stageKey) => (list) => {
  const target = list.find(c => c.id === id);
  if (!target) return { block: true, reason: 'not_found', httpStatus: 404 };
  return list.map(c => c.id === id ? { ...c, coordinationStatus: stageKey, updatedAt: nowIso() } : c);
};

// עדכון סטטוס הביצוע בפועל (trainingExecutionStatus) + completedAt/סיבת ביטול.
export const mutatorSetExec = (id, execStatus, cancellationReason) => (list) => {
  const target = list.find(c => c.id === id);
  if (!target) return { block: true, reason: 'not_found', httpStatus: 404 };
  return list.map(c => {
    if (c.id !== id) return c;
    return {
      ...c,
      trainingExecutionStatus: execStatus,
      completedAt: execStatus === 'completed' ? nowIso() : c.completedAt,
      cancellationReason: execStatus === 'cancelled' ? cancellationReason : c.cancellationReason,
      updatedAt: nowIso(),
    };
  });
};
