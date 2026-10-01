import { pool } from './db.js';
import { APPROVAL, APPROVAL_STATES, canTransition, normalizeEmail, resolveAccess } from './authz.js';

// פרופיל ההרשאה שלנו (טבלת profiles ב-Postgres) — נפרד מרשומות הזהות של Auth.js
// (users/accounts/sessions, שה-adapter מנהל). מפתח: user_id = מזהה ה-DB של המשתמש
// (ה-UUID שה-adapter מייצר), *לא* Google sub.
//
// העוזרים מקבלים db אופציונלי (ברירת מחדל: ה-pool המשותף) כדי לאפשר הזרקת fake
// בבדיקות יחידה בלי Postgres אמיתי:
//   • פונקציות קריאה/upsert משתמשות ב-db.query(...).
//   • פונקציות מוטציה מותנית משתמשות ב-db.connect() לטרנזקציה עם SELECT ... FOR UPDATE,
//     כדי לאכוף את המעבר על המצב העדכני ולמנוע מרוץ בין פעולות מקבילות על אותה שורה.

// אורך מקסימלי לתשובת "דרך מי הגעת אלינו?".
export const REFERRAL_MAX = 300;

// ---------- מיפוי שורה → אובייקט פרופיל (חוזה הצרכנים: camelCase + timestamps כ-ISO) ----------
const toIso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : v);

function rowToProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name ?? null,
    approvalStatus: row.approval_status,
    referralSource: row.referral_source ?? null,
    onboardingCompletedAt: toIso(row.onboarding_completed_at),
    requestActive: row.request_active,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    lastChangedBy: row.last_changed_by ?? null,
  };
}

// עוזר טרנזקציה: client ייעודי מה-pool, COMMIT/ROLLBACK, release ב-finally.
// ה-fn מקבל client ומחזיר תוצאה; חריגה גוררת ROLLBACK וזריקה מחדש.
async function withTx(db, fn) {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// נוצר בכניסה הראשונה. אידמפוטנטי: אם כבר קיים — מוחזר כמו שהוא (לא מאפס סטטוס).
// פרופיל חדש נוצר בלי referralSource ובלי onboardingCompletedAt (טרם השלים
// את "דרך מי הגעת אלינו?"). משתמש שבקשתו בוטלה (pending + requestActive=false):
// בכניסה מחדש הבקשה מופעלת מחדש כדי שיחזור להיספר כ"טרם השלים".
export async function ensureProfileOnSignIn(userId, email, name, db = pool) {
  if (!userId) return null;
  const normEmail = normalizeEmail(email);

  // יצירה אטומית אם לא קיים. ON CONFLICT DO NOTHING → אם קיים, אין שורה מוחזרת.
  const inserted = await db.query(
    `insert into profiles
       (user_id, email, name, approval_status, referral_source,
        onboarding_completed_at, request_active, created_at, updated_at, last_changed_by)
     values ($1, $2, $3, 'pending', null, null, true, now(), now(), null)
     on conflict (user_id) do nothing
     returning *`,
    [userId, normEmail, name || null]
  );
  if (inserted.rows[0]) return rowToProfile(inserted.rows[0]);

  // קיים → reactivation אטומי אם במצב "בקשה שבוטלה".
  const reactivated = await db.query(
    `update profiles
        set request_active = true, updated_at = now()
      where user_id = $1 and approval_status = 'pending' and request_active = false
      returning *`,
    [userId]
  );
  if (reactivated.rows[0]) return rowToProfile(reactivated.rows[0]);

  // קיים ולא reactivation → להחזיר את הפרופיל הקיים כפי שהוא (גם אם ה-upsert/update
  // לא עדכנו שורה).
  const existing = await db.query(`select * from profiles where user_id = $1`, [userId]);
  return existing.rows[0] ? rowToProfile(existing.rows[0]) : null;
}

export async function getProfile(userId, db = pool) {
  if (!userId) return null;
  const { rows } = await db.query(`select * from profiles where user_id = $1`, [userId]);
  return rows[0] ? rowToProfile(rows[0]) : null;
}

// רשימת כל הפרופילים (למסך הניהול). Admin בלבד — האכיפה ב-Route. סדר דטרמיניסטי
// לפי created_at (הצרכנים ממיינים בעצמם; הסדר הקודם ב-Redis היה שרירותי).
export async function listProfiles(db = pool) {
  const { rows } = await db.query(`select * from profiles order by created_at asc`);
  return rows.map(rowToProfile);
}

// שינוי סטטוס אישור ע"י מנהל, עם אכיפת מעברים חוקיים (lib/authz) על המצב העדכני.
// טרנזקציה + SELECT ... FOR UPDATE נועלת את שורת הפרופיל כדי שהבדיקה והכתיבה
// יתבצעו על אותו מצב, ללא מרוץ מול פעולת מנהל/משתמש מקבילה.
export async function setApprovalStatus(userId, toStatus, actingAdminId, db = pool) {
  if (!APPROVAL_STATES.includes(toStatus)) return { ok: false, reason: 'invalid' };
  return withTx(db, async (client) => {
    const { rows } = await client.query(
      `select * from profiles where user_id = $1 for update`,
      [userId]
    );
    const profile = rowToProfile(rows[0]);
    if (!profile) return { ok: false, reason: 'not_found' };
    // אכיפת שרת: אי אפשר לאשר משתמש שטרם השלים את "דרך מי הגעת אלינו?".
    // חוסם רק את המעבר ל-approved; reject/disable אינם חסומים.
    if (toStatus === APPROVAL.APPROVED && !profile.onboardingCompletedAt) {
      return { ok: false, reason: 'onboarding_incomplete' };
    }
    if (!canTransition(profile.approvalStatus, toStatus)) {
      return { ok: false, reason: 'invalid_transition', from: profile.approvalStatus };
    }
    const upd = await client.query(
      `update profiles
          set approval_status = $2, updated_at = now(), last_changed_by = $3
        where user_id = $1
        returning *`,
      [userId, toStatus, actingAdminId || null]
    );
    return { ok: true, profile: rowToProfile(upd.rows[0]) };
  });
}

// ביטול בקשת הצטרפות / ביטול דחייה ע"י מנהל — פעולה נפרדת מ-setApprovalStatus.
// מאפסת את המשתמש למצב "טופס מחדש": pending + referralSource=null +
// onboardingCompletedAt=null + requestActive=false (מוסתר מהניהול עד כניסה מחדש).
// מותרת מ-pending (ביטול בקשה) ומ-rejected (ביטול דחייה/הסרת חסימה). טרנזקציה +
// FOR UPDATE לאכיפה על המצב העדכני.
export async function cancelRequest(userId, actingAdminId, db = pool) {
  if (!userId) return { ok: false, reason: 'not_found' };
  return withTx(db, async (client) => {
    const { rows } = await client.query(
      `select * from profiles where user_id = $1 for update`,
      [userId]
    );
    const profile = rowToProfile(rows[0]);
    if (!profile) return { ok: false, reason: 'not_found' };
    if (profile.approvalStatus !== APPROVAL.PENDING && profile.approvalStatus !== APPROVAL.REJECTED) {
      return { ok: false, reason: 'invalid_state', from: profile.approvalStatus };
    }
    const upd = await client.query(
      `update profiles
          set approval_status = 'pending', referral_source = null,
              onboarding_completed_at = null, request_active = false,
              updated_at = now(), last_changed_by = $2
        where user_id = $1
        returning *`,
      [userId, actingAdminId || null]
    );
    return { ok: true, profile: rowToProfile(upd.rows[0]) };
  });
}

// שמירת תשובת "דרך מי הגעת אלינו?" ע"י המשתמש עצמו (userId מהסשן, לא מהלקוח).
// הרשאה מחושבת בשרת לפי הפרופיל, הסטטוס ו-ADMIN_EMAILS:
//   • משתמש רגיל pending — מותר למלא ולערוך (כל עוד pending).
//   • Admin — מדלג על ה-onboarding, ולכן *לעולם* אינו רשאי לשמור (locked).
//   • כל מצב אחר (approved שאינו Admin, rejected, disabled) — locked.
// חותמת ההשלמה נקבעת בפעם הראשונה בלבד (COALESCE) ואינה מתאפסת בעריכה חוזרת.
export async function setReferral(userId, text, adminEmailsCsv, db = pool) {
  if (!userId) return { ok: false, reason: 'not_found' };
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed || trimmed.length > REFERRAL_MAX) return { ok: false, reason: 'invalid' };
  return withTx(db, async (client) => {
    const { rows } = await client.query(
      `select * from profiles where user_id = $1 for update`,
      [userId]
    );
    const profile = rowToProfile(rows[0]);
    if (!profile) return { ok: false, reason: 'not_found' };
    const { isAdmin } = resolveAccess(profile, profile.email, adminEmailsCsv);
    const allowed = !isAdmin && profile.approvalStatus === APPROVAL.PENDING;
    if (!allowed) return { ok: false, reason: 'locked' };
    const upd = await client.query(
      `update profiles
          set referral_source = $2,
              onboarding_completed_at = coalesce(onboarding_completed_at, now()),
              request_active = true,
              updated_at = now()
        where user_id = $1
        returning *`,
      [userId, trimmed]
    );
    return { ok: true, profile: rowToProfile(upd.rows[0]) };
  });
}
