// מוטטורים טהורים לפרסומים, כולל אכיפת בעלות בתוך read→mutate→CAS על נתונים
// טריים. נבדקים ישירות בבדיקות היחידה.
import { canManagePosting } from './authz.js';

const nowIso = () => new Date().toISOString();

// יצירת פרסום — ההרשאה (canCreate) ו-ownerId נקבעים ב-Route בצד השרת.
export const mutatorCreatePosting = (posting) => (list) => [...list, posting];

// override ידני (בוצע/בוטל/ניקוי) — רק בעל האימון או Admin. הבדיקה על הרשומה
// הטרייה בתוך המוטטור, כך שאין חלון TOCTOU בין בדיקת הבעלות לכתיבה.
export const mutatorSetTrainingOverride = (id, manualStatus, access, userId) => (list) => {
  const target = list.find(p => p.id === id);
  if (!target) return { block: true, reason: 'not_found', httpStatus: 404 };
  if (!canManagePosting(access, userId, target)) return { block: true, reason: 'forbidden', httpStatus: 403 };
  return list.map(p => p.id === id
    ? { ...p, manualStatus: manualStatus || undefined, updatedAt: nowIso() }
    : p);
};
