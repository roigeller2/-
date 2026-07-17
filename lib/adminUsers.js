// לוגיקה טהורה למסך ניהול המשתמשים: שיוך-דלי, מונים, חיפוש, סינון ומיון.
// הכל בצד לקוח על listProfiles הקיים (כולל הדגל isAdmin הנגזר בשרת). בלי I/O,
// ניתן לבדיקת יחידה. אין מחיקה ואין שינוי סטטוס כאן — רק תצוגה/ארגון.

// דליי הסינון לפי הסדר שמוצג ב-UI. 'all' הוא מטא-דלי (כולם).
export const USER_BUCKETS = ['pending', 'approved', 'disabled', 'rejected', 'admins', 'all'];

// סדר מיון-סטטוס קבוע (נמוך=ראשון).
const STATUS_ORDER = { pending: 0, approved: 1, disabled: 2, rejected: 3, admins: 4 };
const APPROVAL_STATES = ['pending', 'approved', 'rejected', 'disabled'];

// שיוך משתמש לדלי: Admin (נגזר) → 'admins' תמיד (מתעלמים מהסטטוס השמור); אחרת
// לפי approvalStatus (ברירת מחדל לערך לא-מוכר: 'pending').
export function bucketOf(user) {
  if (user?.isAdmin) return 'admins';
  const s = user?.approvalStatus;
  return APPROVAL_STATES.includes(s) ? s : 'pending';
}

// מונה לכל דלי. כל משתמש נספר בדלי-סטטוס אחד בדיוק; 'all' = הכול.
export function countsByBucket(users) {
  const c = { pending: 0, approved: 0, disabled: 0, rejected: 0, admins: 0, all: 0 };
  for (const u of users || []) {
    c.all++;
    c[bucketOf(u)]++;
  }
  return c;
}

// ברירת מחדל של המסנן: "ממתינים" אם יש ≥1 ממתין; אחרת "הכול".
export function defaultStatusFilter(users) {
  return countsByBucket(users).pending > 0 ? 'pending' : 'all';
}

const norm = (s) => String(s ?? '').trim().toLowerCase();

// סינון לפי סטטוס (דלי) + חיפוש טקסט (שם/אימייל, case-insensitive).
export function filterUsers(users, { search = '', status = 'all' } = {}) {
  const q = norm(search);
  return (users || []).filter((u) => {
    if (status !== 'all' && bucketOf(u) !== status) return false;
    if (!q) return true;
    return norm(u?.name).includes(q) || norm(u?.email).includes(q);
  });
}

const cmpDateDesc = (a, b) => String(b?.createdAt ?? '').localeCompare(String(a?.createdAt ?? ''));

// מיון (מחזיר עותק): joined (ברירת מחדל, חדש→ישן) / name (א-ת, locale עברי) /
// email / status (סדר קבוע, שובר-שוויון createdAt יורד).
export function sortUsers(users, sortKey = 'joined') {
  const arr = [...(users || [])];
  if (sortKey === 'name') {
    arr.sort((a, b) => (a?.name || a?.email || '').localeCompare(b?.name || b?.email || '', 'he'));
  } else if (sortKey === 'email') {
    arr.sort((a, b) => String(a?.email || '').localeCompare(String(b?.email || ''), 'he'));
  } else if (sortKey === 'status') {
    arr.sort((a, b) => {
      const d = STATUS_ORDER[bucketOf(a)] - STATUS_ORDER[bucketOf(b)];
      return d !== 0 ? d : cmpDateDesc(a, b);
    });
  } else {
    arr.sort(cmpDateDesc); // joined
  }
  return arr;
}

// תאריך הצטרפות לתצוגה: 'DD/MM/YYYY' (או '' אם חסר/לא-תקין).
export function formatDMY(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
