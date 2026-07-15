import { redis } from './redis.js';
import { APPROVAL, APPROVAL_STATES, canTransition, normalizeEmail } from './authz.js';

// פרופיל ההרשאה שלנו — נפרד מרשומות הזהות של Auth.js (שה-Adapter מנהל תחת
// baseKeyPrefix 'auth:'). מפתחות פרופיל תחת 'profile:' + אינדקס לרשימת המנהל.
const PROFILE_KEY = (id) => `profile:${id}`;
const PROFILE_INDEX = 'profile:index';

// נוצר בכניסה הראשונה. אידמפוטנטי: אם כבר קיים — מוחזר כמו שהוא (לא מאפס סטטוס).
export async function ensureProfileOnSignIn(userId, email, name) {
  if (!userId) return null;
  const existing = await redis.get(PROFILE_KEY(userId));
  if (existing) return existing;
  const profile = {
    userId,
    email: normalizeEmail(email),
    name: name || null,
    approvalStatus: APPROVAL.PENDING,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastChangedBy: null,
  };
  await redis.set(PROFILE_KEY(userId), profile);
  await redis.sadd(PROFILE_INDEX, userId);
  return profile;
}

export async function getProfile(userId) {
  if (!userId) return null;
  return (await redis.get(PROFILE_KEY(userId))) || null;
}

// רשימת כל הפרופילים (למסך הניהול). Admin בלבד — האכיפה ב-Route.
export async function listProfiles() {
  const ids = await redis.smembers(PROFILE_INDEX);
  if (!ids || ids.length === 0) return [];
  const vals = await redis.mget(...ids.map(PROFILE_KEY));
  return (vals || []).filter(Boolean);
}

// שינוי סטטוס אישור ע"י מנהל, עם אכיפת מעברים חוקיים (lib/authz).
export async function setApprovalStatus(userId, toStatus, actingAdminId) {
  if (!APPROVAL_STATES.includes(toStatus)) return { ok: false, reason: 'invalid' };
  const profile = await getProfile(userId);
  if (!profile) return { ok: false, reason: 'not_found' };
  if (!canTransition(profile.approvalStatus, toStatus)) {
    return { ok: false, reason: 'invalid_transition', from: profile.approvalStatus };
  }
  const updated = {
    ...profile,
    approvalStatus: toStatus,
    updatedAt: new Date().toISOString(),
    lastChangedBy: actingAdminId || null,
  };
  await redis.set(PROFILE_KEY(userId), updated);
  return { ok: true, profile: updated };
}
