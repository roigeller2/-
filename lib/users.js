import { redis } from './redis.js';
import { APPROVAL, APPROVAL_STATES, canTransition, normalizeEmail, resolveAccess } from './authz.js';

// פרופיל ההרשאה שלנו — נפרד מרשומות הזהות של Auth.js (שה-Adapter מנהל תחת
// baseKeyPrefix 'auth:'). מפתחות פרופיל תחת 'profile:' + אינדקס לרשימת המנהל.
const PROFILE_KEY = (id) => `profile:${id}`;
const PROFILE_INDEX = 'profile:index';

// אורך מקסימלי לתשובת "דרך מי הגעת אלינו?".
export const REFERRAL_MAX = 300;

// העוזרים מקבלים client אופציונלי (ברירת מחדל: הלקוח המשותף) כדי לאפשר הזרקת
// fake בבדיקות יחידה בלי Redis אמיתי.

// נוצר בכניסה הראשונה. אידמפוטנטי: אם כבר קיים — מוחזר כמו שהוא (לא מאפס סטטוס).
// פרופיל חדש נוצר בלי referralSource ובלי onboardingCompletedAt (טרם השלים
// את "דרך מי הגעת אלינו?").
export async function ensureProfileOnSignIn(userId, email, name, client = redis) {
  if (!userId) return null;
  const existing = await client.get(PROFILE_KEY(userId));
  if (existing) return existing;
  const profile = {
    userId,
    email: normalizeEmail(email),
    name: name || null,
    approvalStatus: APPROVAL.PENDING,
    referralSource: null,
    onboardingCompletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastChangedBy: null,
  };
  await client.set(PROFILE_KEY(userId), profile);
  await client.sadd(PROFILE_INDEX, userId);
  return profile;
}

export async function getProfile(userId, client = redis) {
  if (!userId) return null;
  return (await client.get(PROFILE_KEY(userId))) || null;
}

// רשימת כל הפרופילים (למסך הניהול). Admin בלבד — האכיפה ב-Route.
export async function listProfiles() {
  const ids = await redis.smembers(PROFILE_INDEX);
  if (!ids || ids.length === 0) return [];
  const vals = await redis.mget(...ids.map(PROFILE_KEY));
  return (vals || []).filter(Boolean);
}

// שינוי סטטוס אישור ע"י מנהל, עם אכיפת מעברים חוקיים (lib/authz).
export async function setApprovalStatus(userId, toStatus, actingAdminId, client = redis) {
  if (!APPROVAL_STATES.includes(toStatus)) return { ok: false, reason: 'invalid' };
  const profile = await client.get(PROFILE_KEY(userId));
  if (!profile) return { ok: false, reason: 'not_found' };
  // אכיפת שרת: אי אפשר לאשר משתמש שטרם השלים את "דרך מי הגעת אלינו?".
  // חוסם רק את המעבר ל-approved; reject/disable אינם חסומים.
  if (toStatus === APPROVAL.APPROVED && !profile.onboardingCompletedAt) {
    return { ok: false, reason: 'onboarding_incomplete' };
  }
  if (!canTransition(profile.approvalStatus, toStatus)) {
    return { ok: false, reason: 'invalid_transition', from: profile.approvalStatus };
  }
  const updated = {
    ...profile,
    approvalStatus: toStatus,
    updatedAt: new Date().toISOString(),
    lastChangedBy: actingAdminId || null,
  };
  await client.set(PROFILE_KEY(userId), updated);
  return { ok: true, profile: updated };
}

// ביטול בקשת הצטרפות ע"י מנהל — פעולה נפרדת מ-setApprovalStatus. מאפסת את
// המשתמש למצב "טופס מחדש": pending + referralSource=null + onboardingCompletedAt=null.
// המשתמש אינו נחסם ואינו נדחה, וחוזר אוטומטית לטופס ההגשה בכניסה הבאה. מותרת רק
// כשהמשתמש pending; לא תלויה ב-referralSource (עובדת גם כשריק/חסר).
export async function cancelRequest(userId, actingAdminId, client = redis) {
  if (!userId) return { ok: false, reason: 'not_found' };
  const profile = await client.get(PROFILE_KEY(userId));
  if (!profile) return { ok: false, reason: 'not_found' };
  if (profile.approvalStatus !== APPROVAL.PENDING) {
    return { ok: false, reason: 'invalid_state', from: profile.approvalStatus };
  }
  const updated = {
    ...profile,
    approvalStatus: APPROVAL.PENDING,
    referralSource: null,
    onboardingCompletedAt: null,
    updatedAt: new Date().toISOString(),
    lastChangedBy: actingAdminId || null,
  };
  await client.set(PROFILE_KEY(userId), updated);
  return { ok: true, profile: updated };
}

// שמירת תשובת "דרך מי הגעת אלינו?" ע"י המשתמש עצמו (userId מהסשן, לא מהלקוח).
// הרשאה מפורשת, מחושבת בשרת לפי הפרופיל, הסטטוס ו-ADMIN_EMAILS:
//   • משתמש רגיל pending — מותר למלא ולערוך (כל עוד pending).
//   • Admin — מדלג לחלוטין על ה-onboarding, ולכן *לעולם* אינו רשאי לשמור (locked).
//   • כל מצב אחר (approved שאינו Admin, rejected, disabled) — locked.
// חותמת ההשלמה נקבעת בפעם הראשונה בלבד ואינה מתאפסת בעריכה חוזרת.
export async function setReferral(userId, text, adminEmailsCsv, client = redis) {
  if (!userId) return { ok: false, reason: 'not_found' };
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length > REFERRAL_MAX) return { ok: false, reason: 'invalid' };
  const profile = await client.get(PROFILE_KEY(userId));
  if (!profile) return { ok: false, reason: 'not_found' };
  const { isAdmin } = resolveAccess(profile, profile.email, adminEmailsCsv);
  const allowed = !isAdmin && profile.approvalStatus === APPROVAL.PENDING;
  if (!allowed) return { ok: false, reason: 'locked' };
  const now = new Date().toISOString();
  const updated = {
    ...profile,
    referralSource: trimmed,
    onboardingCompletedAt: profile.onboardingCompletedAt || now,
    updatedAt: now,
  };
  await client.set(PROFILE_KEY(userId), updated);
  return { ok: true, profile: updated };
}
