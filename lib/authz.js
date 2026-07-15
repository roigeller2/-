// לוגיקת הרשאות טהורה (בלי I/O). מקור אמת יחיד לכללי האישור והבעלות,
// בשימוש ה-Route Handlers בצד השרת ובבדיקות היחידה.

// ארבעה מצבים: rejected = מעולם לא אושר; disabled = אושר ואז הושבת.
export const APPROVAL = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', DISABLED: 'disabled' };
export const APPROVAL_STATES = [APPROVAL.PENDING, APPROVAL.APPROVED, APPROVAL.REJECTED, APPROVAL.DISABLED];

// מעברים מותרים שמנהל רשאי לבצע (נאכף בצד השרת):
//   pending → approved | rejected ; approved → disabled ;
//   rejected → approved ; disabled → approved.
export const ALLOWED_TRANSITIONS = {
  pending: ['approved', 'rejected'],
  approved: ['disabled'],
  rejected: ['approved'],
  disabled: ['approved'],
};
export function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

// Admin נגזר מ-ADMIN_EMAILS (רשימה מופרדת בפסיקים) — לא מאוחסן, לא ניתן להסלמה
// ע"י עריכת רשומת המשתמש. נבדק בכל בקשה בצד השרת.
export function isAdminEmail(email, adminEmailsCsv) {
  const e = normalizeEmail(email);
  if (!e) return false;
  const list = (adminEmailsCsv || '').split(',').map(x => normalizeEmail(x)).filter(Boolean);
  return list.includes(e);
}

// מחשב את הגישה האפקטיבית של משתמש לפי הפרופיל השמור + ADMIN_EMAILS.
// Admin תמיד approved (bootstrap), ללא תלות בסטטוס השמור.
export function resolveAccess(profile, email, adminEmailsCsv) {
  const isAdmin = isAdminEmail(email, adminEmailsCsv);
  const approvalStatus = isAdmin ? APPROVAL.APPROVED : (profile?.approvalStatus || APPROVAL.PENDING);
  return { isAdmin, approvalStatus, canUse: approvalStatus === APPROVAL.APPROVED };
}

// כל משתמש approved רשאי ליצור אימון/בקשה.
export function canCreate(access) {
  return !!access && access.canUse;
}

// ניהול אימון (עריכה/מחיקה/ביטול/override/אישור-דחיית בקשות/שלב/ביצוע):
// רק בעל האימון או Admin. אימון legacy ללא ownerId — Admin בלבד.
export function canManagePosting(access, userId, posting) {
  if (!access || !access.canUse) return false;
  if (access.isAdmin) return true;
  if (!posting || posting.ownerId == null) return false;
  return posting.ownerId === userId;
}

// פעולות של בעל האימון על בקשה (accept/reject/setStage/setExec) — נקבעות לפי
// בעלות על *הפרסום* שהבקשה מפנה אליו.
export function canActAsPostingOwner(access, userId, posting) {
  return canManagePosting(access, userId, posting);
}

// ביטול בקשה — רק שולח הבקשה או Admin. בקשת legacy ללא requesterId — Admin בלבד.
export function canCancelRequest(access, userId, req) {
  if (!access || !access.canUse) return false;
  if (access.isAdmin) return true;
  if (!req || req.requesterId == null) return false;
  return req.requesterId === userId;
}
