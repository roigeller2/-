import { setReferral, getProfile } from './users.js';

// לוגיקת ה-handlers של /api/profile, מופרדת מ-route.js לבדיקת יחידה בלי
// next/server/auth/Redis. מקבל { userId, ... } (userId מהסשן, בשרת) ו-deps
// מוזרקות, ומחזיר { status, body } טהור. הנתיב פתוח לכל משתמש מחובר — גם pending
// (זהו endpoint של מצב-החשבון, מותר לפני אישור). הזהות נלקחת אך ורק מהסשן.

const defaultDeps = {
  setReferral: (userId, text) => setReferral(userId, text, process.env.ADMIN_EMAILS),
  getProfile: (userId) => getProfile(userId),
};

// GET — פרופיל עצמי בלבד. מחזיר אך ורק את השדות הנדרשים למילוי-מוקדם של טופס
// העריכה (referralSource, onboardingCompletedAt) — לא את שאר הפרופיל, ולעולם
// לא פרופיל של משתמש אחר (userId מהסשן בלבד).
export async function profileGet({ userId }, deps = defaultDeps) {
  if (!userId) return { status: 403, body: { ok: false, error: 'אין הרשאה' } };
  try {
    const profile = await deps.getProfile(userId);
    return {
      status: 200,
      body: {
        ok: true,
        referralSource: profile?.referralSource ?? null,
        onboardingCompletedAt: profile?.onboardingCompletedAt ?? null,
      },
    };
  } catch (e) {
    console.error('[api/profile] GET failed:', e);
    return { status: 503, body: { ok: false, error: 'שגיאת שרת' } };
  }
}

export async function profilePost({ userId, readBody }, deps = defaultDeps) {
  if (!userId) return { status: 403, body: { ok: false, error: 'אין הרשאה' } };

  let body;
  try {
    body = await readBody();
  } catch {
    return { status: 400, body: { ok: false, error: 'גוף הבקשה אינו JSON תקין' } };
  }

  if (body?.op !== 'setReferral') return { status: 400, body: { ok: false, error: 'פעולה לא מוכרת' } };
  if (typeof body.text !== 'string') return { status: 400, body: { ok: false, error: 'טקסט חסר' } };

  try {
    const r = await deps.setReferral(userId, body.text);
    if (r.ok) return { status: 200, body: { ok: true } };
    const map = { invalid: 400, not_found: 404, locked: 403 };
    return { status: map[r.reason] || 400, body: { ok: false, error: r.reason } };
  } catch (e) {
    console.error('[api/profile] POST failed:', e);
    return { status: 500, body: { ok: false, error: 'שגיאת שרת' } };
  }
}
