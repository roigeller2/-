'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import App from './App';
import NotificationsBell from './NotificationsBell';

function Center({ children }) {
  return (
    <div dir="rtl" lang="he" className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-6"
      style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function LoginScreen() {
  // MVP: Google בלבד. תשתית ה-Magic Link נשמרה בשרת (auth.js) לעתיד, אך אינה
  // נטענת ואינה מוצגת כאן כל עוד משתני Resend אינם מוגדרים.
  // מסך Hero מלא: תמונת רקע על כל המסך + Overlay כהה + תוכן לבן ממורכז.
  // UI בלבד — ללא שינוי בלוגיקת ההתחברות.
  return (
    <div dir="rtl" lang="he" className="relative min-h-screen w-full overflow-hidden"
      style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
      {/* תמונת רקע מלאה */}
      <img src="/login-hero.jpg" alt="" aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover" />
      {/* שכבת Overlay כהה לקריאוּת */}
      <div className="absolute inset-0 bg-black/50" />
      {/* תוכן ממורכז אופקית ואנכית */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center text-white">
        <h1 className="mb-2 text-2xl font-bold drop-shadow-md md:text-3xl">מערכת תיאום אימונים משותפים</h1>
        <p className="mb-8 text-base text-white/85 drop-shadow md:text-lg">התחברות למערכת</p>
        <button onClick={() => signIn('google')}
          className="w-full max-w-xs rounded-2xl bg-slate-900 py-4 text-lg font-bold text-white shadow-xl transition hover:bg-slate-800 active:scale-[0.99]">
          התחברות עם Google
        </button>
      </div>
    </div>
  );
}

function StateScreen({ title, subtitle, email, tone = 'amber', action }) {
  const colors = {
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    rose: 'bg-rose-50 border-rose-200 text-rose-800',
    slate: 'bg-slate-100 border-slate-200 text-slate-700',
  }[tone];
  return (
    <Center>
      <div className={`rounded-2xl border p-6 text-center ${colors}`}>
        <h1 className="text-lg font-bold mb-2">{title}</h1>
        <p className="text-sm mb-4">{subtitle}</p>
        {email && <p className="text-xs opacity-70 mb-4">מחובר כ-{email}</p>}
        {action && (
          <button onClick={action.onClick} className="block w-full text-sm font-bold text-sky-700 underline mb-3">{action.label}</button>
        )}
        <button onClick={() => signOut()} className="text-sm font-bold underline">התנתקות</button>
      </div>
    </Center>
  );
}

// מסך "דרך מי הגעת אלינו?". שני מצבים:
//   • initial — מסך חובה חוסם (לא מודאל) למי שטרם השלים onboarding. onDone מרים
//     דגל מקומי בהורה כדי לעבור מיד למסך הבא; רענון דף יביא את המצב מהשרת.
//   • edit — עריכה חוזרת של pending: טוען את הערך הקיים דרך GET /api/profile,
//     שומר דרך אותו POST (onboardingCompletedAt אינו משתנה), וניתן לביטול.
function OnboardingScreen({ email, onDone, mode = 'initial', onCancel }) {
  const isEdit = mode === 'edit';
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [loadErr, setLoadErr] = useState(false);
  const [showEmptyAlert, setShowEmptyAlert] = useState(false); // התרעה קופצת: שדה ריק
  const savingRef = useRef(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true); setLoadErr(false);
    try {
      const r = await fetch('/api/profile', { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!mountedRef.current) return;
      if (r.ok && d.ok) { setText(d.referralSource || ''); setLoading(false); }
      else { setLoadErr(true); setLoading(false); }
    } catch { if (mountedRef.current) { setLoadErr(true); setLoading(false); } }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (isEdit) load();
    return () => { mountedRef.current = false; };
  }, [isEdit, load]);

  // סגירת ההתרעה הקופצת ב-Escape.
  useEffect(() => {
    if (!showEmptyAlert) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowEmptyAlert(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showEmptyAlert]);

  const submit = async () => {
    if (savingRef.current) return; // מניעת שליחה כפולה
    const t = text.trim();
    // שדה ריק → התרעה קופצת חוסמת; לא ניתן להמשיך בלי מילוי.
    if (!t) { setShowEmptyAlert(true); return; }
    if (t.length > 300) { setErr('התשובה ארוכה מדי (עד 300 תווים).'); return; }
    setErr('');
    savingRef.current = true;
    setSaving(true);
    try {
      const r = await fetch('/api/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'setReferral', text: t }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) { onDone(); return; } // ההורה מנתב מחדש ומסיר את המסך — לא לעדכן state אחרי unmount
      if (d.error === 'locked') setErr('המצב השתנה ואי אפשר עוד לערוך. רעננו את הדף.');
      else if (d.error === 'invalid') setErr('התשובה אינה תקינה (עד 300 תווים).');
      else setErr('השמירה נכשלה. נסו שוב.');
    } catch {
      setErr('שגיאת רשת. נסו שוב.');
    }
    savingRef.current = false;
    setSaving(false);
  };

  return (
    <Center>
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h1 className="text-lg font-bold text-slate-800 mb-1 text-center">{isEdit ? 'עריכת התשובה' : 'השלמת בקשת הצטרפות'}</h1>
        {!isEdit && <p className="text-xs text-slate-500 mb-4 text-center">כדי להשלים את הבקשה, ענו על שאלה אחת.</p>}
        {isEdit && loading ? (
          <p className="text-sm text-slate-400 text-center py-6">טוען…</p>
        ) : isEdit && loadErr ? (
          <div className="text-center py-6">
            <p className="text-sm text-slate-500 mb-2">טעינת התשובה נכשלה.</p>
            <button onClick={load} className="text-sm font-bold text-sky-700 underline">נסה שוב</button>
            <div className="mt-3"><button onClick={onCancel} className="text-xs text-slate-500 underline">חזרה</button></div>
          </div>
        ) : (
          <>
            <label htmlFor="referral" className="block text-sm font-bold text-slate-700 mb-2 mt-3">דרך מי הגעת אלינו?</label>
            <textarea id="referral" value={text} onChange={e => setText(e.target.value)} maxLength={300} rows={3}
              disabled={saving} placeholder="ספרו לנו בכמה מילים…"
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm resize-none disabled:bg-slate-50" />
            <div className="text-left text-[11px] text-slate-400 mt-1">{text.trim().length}/300</div>
            {err && <p className="text-sm text-rose-600 mt-2" role="alert">{err}</p>}
            <button onClick={submit} disabled={saving}
              className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl mt-4 disabled:opacity-50">
              {saving ? 'שומר…' : (isEdit ? 'שמירה' : 'שמירה והמשך')}
            </button>
            {isEdit && (
              <button onClick={onCancel} disabled={saving} className="w-full text-sm text-slate-500 underline mt-3 disabled:opacity-50">ביטול</button>
            )}
          </>
        )}
        {email && !isEdit && (
          <p className="text-xs text-slate-400 mt-4 text-center">
            מחובר כ-{email} · <button onClick={() => signOut()} className="underline">התנתקות</button>
          </p>
        )}
      </div>

      {/* התרעה קופצת: ניסיון לשמור בלי למלא את השדה. כפתור "חזרה" סוגר ומחזיר לטופס. */}
      {showEmptyAlert && (
        <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEmptyAlert(false)} />
          <div role="alertdialog" aria-modal="true" className="relative w-full max-w-xs bg-white rounded-2xl border border-slate-200 p-5 shadow-xl text-center">
            <div className="text-3xl mb-2" aria-hidden="true">⚠️</div>
            <p className="text-sm font-bold text-slate-800 mb-4">לא ניתן להמשיך ללא מילוי השדה "דרך מי הגעת אלינו".</p>
            <button onClick={() => setShowEmptyAlert(false)}
              className="w-full bg-slate-900 text-white font-bold py-2.5 rounded-xl">חזרה</button>
          </div>
        </div>
      )}
    </Center>
  );
}

import { USER_BUCKETS, bucketOf, countsByBucket, defaultStatusFilter, filterUsers, sortUsers, formatDMY } from '../lib/adminUsers';

// פעולות המנהל לפי הסטטוס השמור (לא-אדמין בלבד). op מזהה את הפעולה:
//   approve/reject/disable → setStatus ; cancel → cancelRequest (פעולה נפרדת).
// 'danger' → דורש מודאל אישור. אין מחיקה.
const OP_STATUS = { approve: 'approved', reject: 'rejected', disable: 'disabled' };
const ACTIONS_FOR = {
  pending: [
    { op: 'approve', label: 'אשר' },
    { op: 'reject', label: 'דחה', danger: true },
    { op: 'cancel', label: 'בטל בקשה', danger: true },
  ],
  approved: [{ op: 'disable', label: 'השבת', danger: true }],
  rejected: [{ op: 'approve', label: 'אשר' }],
  disabled: [{ op: 'approve', label: 'הפעל מחדש' }],
};

// תג סטטוס: תווית + צבע עדין (לפי הדלי, כולל "טרם השלים"). אין אדום מלא.
const STATUS_TAG = {
  pending: { label: 'ממתין לאישור', cls: 'bg-amber-100 text-amber-800' },
  incomplete: { label: 'טרם השלים', cls: 'bg-slate-100 text-slate-600' },
  approved: { label: 'מאושר', cls: 'bg-emerald-100 text-emerald-800' },
  disabled: { label: 'מושבת', cls: 'bg-slate-200 text-slate-600' },
  rejected: { label: 'נדחה', cls: 'bg-rose-50 text-rose-700 border border-rose-200' },
};

// תוויות ומצבי-ריק לכל דלי במסנן.
const BUCKET_LABEL = { pending: 'ממתינים לאישור', incomplete: 'טרם השלימו', approved: 'מאושרים', disabled: 'מושבתים', rejected: 'נדחו', admins: 'מנהלים', all: 'הכול' };
const EMPTY_FOR = { pending: 'אין בקשות שממתינות לאישור.', incomplete: 'אין משתמשים שטרם השלימו.', approved: 'אין משתמשים מאושרים.', disabled: 'אין משתמשים מושבתים.', rejected: 'אין משתמשים שנדחו.', admins: 'אין מנהלים.', all: 'אין משתמשים.' };
const SORT_OPTIONS = [
  { key: 'joined', label: 'הצטרפות (חדש→ישן)' },
  { key: 'name', label: 'שם (א-ת)' },
  { key: 'email', label: 'אימייל' },
  { key: 'status', label: 'סטטוס' },
];

// טקסטי מודאל האישור, ממופים לפי op הפעולה.
const CONFIRM_COPY = {
  reject: { title: 'לדחות את המשתמש?', explain: 'המשתמש ייחסם מהגשת בקשת הצטרפות חדשה.' },
  disable: { title: 'להשבית את המשתמש?', explain: 'הגישה תיחסם, אך ההיסטוריה והנתונים שלו יישמרו.' },
  cancel: { title: 'לבטל את הבקשה?', explain: 'הבקשה תבוטל. המשתמש לא ייחסם ויוכל להגיש בקשה חדשה בכניסה הבאה.' },
};

// מודאל אישור לפעולה משמעותית. עצמאי בניהול busy/שגיאה. onConfirm מבצע את
// קריאת השרת ומחזיר { ok, error }: בהצלחה ההורה סוגר (unmount); בכישלון נשאר
// פתוח עם הודעת שגיאה. סגירה: "ביטול", לחיצה על הרקע, או Escape — כולן נחסמות
// בזמן busy כדי למנוע סגירה/כפל תוך כדי פעולת שרת. כפתור אישור ב-rose עדין (לא אדום מלא).
function ConfirmDialog({ user, action, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const copy = CONFIRM_COPY[action.op] || { title: 'לאשר את הפעולה?', explain: '' };
  const name = user.name || user.email || user.userId;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const confirm = async () => {
    if (busy) return;
    setErr(''); setBusy(true);
    const res = await onConfirm();
    if (res && res.ok) return; // ההורה סוגר את המודאל — לא לעדכן state אחרי unmount
    setBusy(false);
    setErr((res && res.error) || 'הפעולה נכשלה. נסו שוב.');
  };

  return (
    <div dir="rtl" className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-xs bg-white rounded-2xl border border-slate-200 p-5 shadow-xl">
        <h2 className="text-base font-bold text-slate-800 mb-2">{copy.title}</h2>
        <p className="text-sm text-slate-700 mb-1 break-words"><span className="font-bold">{name}</span></p>
        <p className="text-sm text-slate-500 mb-4">{copy.explain}</p>
        {err && <p className="text-sm text-rose-600 mb-3" role="alert">{err}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={() => !busy && onCancel()} disabled={busy}
            className="text-sm font-bold rounded-full px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">ביטול</button>
          <button onClick={confirm} disabled={busy}
            className="text-sm font-bold rounded-full px-4 py-2 border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50">
            {busy ? 'מבצע…' : action.label}
          </button>
        </div>
      </div>
    </div>
  );
}

// שורת ה-referral ("דרך מי הגיע אלינו") — מוצגת בכרטיס רק לממתינים (לפי סדר
// המידע שהוגדר). ממתין שהשלים → הטקסט; ממתין שטרם השלים → "טרם השלים".
function pendingReferral(u) {
  if (u.referralSource) return { text: u.referralSource, cls: 'text-slate-700' };
  if (u.onboardingCompletedAt) return { text: '(ללא טקסט)', cls: 'text-slate-500' };
  return { text: 'טרם השלים בקשת הצטרפות', cls: 'text-amber-700' };
}

// כרטיס משתמש בודד. סדר המידע (מלמעלה למטה): שם · תג סטטוס + תג "מנהל" · אימייל ·
// תאריך הצטרפות · "דרך מי הגיע אלינו" (ממתינים בלבד) · שורת ביקורת עדינה · פעולות.
function UserCard({ u, onAction }) {
  const isAdmin = !!u.isAdmin;
  const tag = STATUS_TAG[bucketOf(u)]; // תג לפי הדלי (כולל "טרם השלים")
  const joined = formatDMY(u.createdAt);
  // ממתין שטרם השלים onboarding — אי אפשר לאשר (חסימת שרת; מוסתר גם בכפתור).
  const incompletePending = !isAdmin && u.approvalStatus === 'pending' && !u.onboardingCompletedAt;
  const actions = isAdmin ? [] : (ACTIONS_FOR[u.approvalStatus] || []).filter(a => !(incompletePending && a.op === 'approve'));
  const ref = !isAdmin && u.approvalStatus === 'pending' ? pendingReferral(u) : null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      {/* שם */}
      <div className="font-bold text-sm text-slate-800 break-words">{u.name || u.email || u.userId}</div>
      {/* תג סטטוס + תג מנהל */}
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {isAdmin
          ? <span className="text-[11px] bg-sky-100 text-sky-800 rounded-full px-2 py-0.5 font-bold">מנהל</span>
          : tag && <span className={`text-[11px] rounded-full px-2 py-0.5 font-bold ${tag.cls}`}>{tag.label}</span>}
      </div>
      {/* אימייל */}
      <div className="text-xs text-slate-500 mt-1.5 break-all">{u.email}</div>
      {/* תאריך הצטרפות */}
      {joined && <div className="text-xs text-slate-400 mt-0.5">הצטרף/ה: {joined}</div>}
      {/* דרך מי הגיע אלינו — ממתינים בלבד */}
      {ref && (
        <div className="mt-1.5 text-xs">
          <span className="text-slate-400">דרך מי הגיע אלינו: </span>
          <span className={`font-semibold ${ref.cls}`}>{ref.text}</span>
        </div>
      )}
      {/* שורת ביקורת עדינה — רק אם בוצע שינוי סטטוס ע"י מנהל (יש lastChangedBy) */}
      {!isAdmin && u.lastChangedBy && formatDMY(u.updatedAt) && (
        <div className="text-[11px] text-slate-400 mt-1">עודכן ב-{formatDMY(u.updatedAt)}</div>
      )}
      {/* פעולות בתחתית הכרטיס */}
      {actions.length > 0 && (
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {actions.map(a => (
            <button key={a.op} onClick={() => onAction(u, a)}
              className={`text-[11px] font-bold rounded-full px-3 py-1 border ${a.danger ? 'border-rose-300 text-rose-700 hover:bg-rose-50' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {incompletePending && <p className="text-[11px] text-amber-700 mt-1.5">לא ניתן לאשר לפני השלמת בקשת ההצטרפות</p>}
    </div>
  );
}

function AdminUsersScreen({ onBack }) {
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null); // null → נגזר (defaultStatusFilter)
  const [sortKey, setSortKey] = useState('joined');
  const [confirm, setConfirm] = useState(null); // { u, a } לפעולה משמעותית

  const load = async () => {
    try {
      const r = await fetch('/api/admin/users', { cache: 'no-store' });
      const d = await r.json();
      if (d.ok) setUsers(d.users || []); else setErr(d.error || 'שגיאה');
    } catch (e) { setErr(String(e?.message || e)); }
  };
  useEffect(() => { load(); }, []);

  // נועלים את ברירת המחדל של המסנן פעם אחת כשהנתונים נטענים, במקום לגזור אותה
  // בכל render. אחרת פעולה שמרוקנת את דלי "ממתינים" (למשל דחיית האחרון) הייתה
  // מקפיצה את התצוגה אוטומטית ל"הכול" והמשתמש שזה עתה נדחה היה חוזר להופיע.
  useEffect(() => {
    if (users && statusFilter === null) setStatusFilter(defaultStatusFilter(users));
  }, [users, statusFilter]);

  // מבצע את מעבר הסטטוס דרך ה-API הקיים (setStatus יחיד לכל המעברים; אין מחיקה
  // ואין מעברים חדשים). מחזיר { ok, error } כדי שגם המסלול הישיר וגם המודאל
  // יגיבו נכון בלי "להעמיד פנים" שהצליח.
  const setStatus = async (userId, status) => {
    try {
      const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'setStatus', userId, status }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setUsers(d.users || []); return { ok: true }; }
      // הודעה ידידותית — לא לחשוף את שם ה-reason הטכני מהשרת.
      return { ok: false, error: d.error === 'onboarding_incomplete' ? 'לא ניתן לאשר לפני השלמת בקשת ההצטרפות.' : 'הפעולה נכשלה. נסו שוב.' };
    } catch { return { ok: false, error: 'שגיאת רשת. נסו שוב.' }; }
  };

  // "בטל בקשה" — op נפרד בשרת (cancelRequest). מאפס את המשתמש למצב טופס-מחדש.
  const cancelRequest = async (userId) => {
    try {
      const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'cancelRequest', userId }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setUsers(d.users || []); return { ok: true }; }
      return { ok: false, error: d.error === 'invalid_state' ? 'ניתן לבטל רק בקשה ממתינה.' : 'הפעולה נכשלה. נסו שוב.' };
    } catch { return { ok: false, error: 'שגיאת רשת. נסו שוב.' }; }
  };

  // מפעיל את הפעולה לפי ה-op: cancel → cancelRequest, אחרת setStatus.
  const perform = (userId, a) => (a.op === 'cancel' ? cancelRequest(userId) : setStatus(userId, OP_STATUS[a.op]));

  // מסלול ישיר (בלי מודאל): אשר / הפעל מחדש. שגיאה מוצגת בפס ההודעות של המסך.
  const runDirect = async (userId, a) => {
    setActionMsg('');
    const res = await perform(userId, a);
    if (!res.ok) setActionMsg(res.error);
  };

  // פעולה משמעותית (danger: דחה/השבת/בטל בקשה) → מודאל אישור. אחרת → ביצוע ישיר.
  const onAction = (u, a) => { setActionMsg(''); if (a.danger) setConfirm({ u, a }); else runDirect(u.userId, a); };

  const list = users || [];
  const counts = countsByBucket(list);
  const effectiveStatus = statusFilter ?? defaultStatusFilter(list);
  const visible = sortUsers(filterUsers(list, { search, status: effectiveStatus }), sortKey);
  const searching = search.trim().length > 0;

  return (
    <div dir="rtl" lang="he" className="min-h-screen bg-slate-50 text-slate-900 px-4 py-5" style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold">ניהול משתמשים</h1>
          <button onClick={onBack} className="text-sm font-bold text-sky-700">חזרה</button>
        </div>
        {err && <p className="text-sm text-rose-600 mb-3">{err}</p>}
        {actionMsg && <p className="text-sm text-amber-700 mb-3" role="alert">{actionMsg}</p>}

        {users === null ? (
          <p className="text-sm text-slate-400">טוען…</p>
        ) : (
          <>
            {/* חיפוש */}
            <input
              type="search" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או אימייל…"
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm mb-3"
            />

            {/* מסנן סטטוס מקטעי עם מונים — גלילה אופקית במובייל בלי חיתוך */}
            <div className="-mx-4 px-4 mb-3 overflow-x-auto">
              <div className="flex gap-2 w-max">
                {USER_BUCKETS.map(b => {
                  const active = effectiveStatus === b;
                  return (
                    <button key={b} onClick={() => setStatusFilter(b)}
                      className={`shrink-0 whitespace-nowrap text-xs font-bold rounded-full px-3 py-1.5 border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'}`}>
                      {BUCKET_LABEL[b]} ({counts[b]})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* מיון */}
            <div className="flex items-center gap-2 mb-3">
              <label htmlFor="sort" className="text-xs text-slate-500 shrink-0">מיון:</label>
              <select id="sort" value={sortKey} onChange={e => setSortKey(e.target.value)}
                className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white">
                {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <span className="text-xs text-slate-400 mr-auto">{visible.length} מוצגים</span>
            </div>

            {/* רשימה / מצב-ריק */}
            {visible.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">
                {searching ? `לא נמצאו תוצאות עבור "${search.trim()}".` : (EMPTY_FOR[effectiveStatus] || 'אין משתמשים.')}
              </p>
            ) : (
              <div className="space-y-2">
                {visible.map(u => <UserCard key={u.userId} u={u} onAction={onAction} />)}
              </div>
            )}
          </>
        )}
      </div>

      {/* מודאל אישור לפעולות משמעותיות (דחה/השבת). בהצלחה נסגר והרשימה+המונים
          מתעדכנים דרך setStatus; בכישלון נשאר פתוח עם שגיאה (בתוך המודאל). */}
      {confirm && (
        <ConfirmDialog
          user={confirm.u} action={confirm.a}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const res = await perform(confirm.u.userId, confirm.a);
            if (res.ok) setConfirm(null);
            return res;
          }}
        />
      )}
    </div>
  );
}

function ApprovedShell({ session }) {
  const [screen, setScreen] = useState('app');
  const [navRequest, setNavRequest] = useState(null);
  const me = { userId: session.userId, isAdmin: !!session.access?.isAdmin };
  const user = session.user || {};
  if (screen === 'admin' && me.isAdmin) return <AdminUsersScreen onBack={() => setScreen('app')} />;
  // לחיצה על התראה: מבטיחים שאנחנו במסך האפליקציה, ומעבירים בקשת ניווט ל-App
  // (שמנווט למסך הקיים המתאים לפי הסוג). הפעמון מוצג רק כאן — למשתמש approved.
  const handleNavigate = (target) => { setScreen('app'); setNavRequest(target); };
  return (
    <div>
      <div dir="rtl" className="bg-slate-900 text-white text-xs px-4 py-2 flex items-center justify-between" style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
        <span className="truncate">{user.name || user.email}{me.isAdmin ? ' · מנהל' : ''}</span>
        <span className="flex items-center gap-3 shrink-0">
          <NotificationsBell onNavigate={handleNavigate} />
          {me.isAdmin && <button onClick={() => setScreen('admin')} className="font-bold underline">ניהול משתמשים</button>}
          <button onClick={() => signOut()} className="font-bold underline">התנתקות</button>
        </span>
      </div>
      <App me={me} navRequest={navRequest} onNavHandled={() => setNavRequest(null)} />
    </div>
  );
}

export default function AuthGate() {
  const { data: session, status } = useSession();
  // דגל מקומי: אחרי שמירת ה-onboarding עוברים מיד למסך הבא בלי להמתין לרענון
  // ה-session. מונוטוני (רק true) — אינו מחזיר את המשתמש למסך החובה.
  const [justOnboarded, setJustOnboarded] = useState(false);
  // עריכה חוזרת של התשובה במסך "ממתין לאישור" (pending בלבד).
  const [editingReferral, setEditingReferral] = useState(false);

  if (status === 'loading') return <Center><p className="text-center text-sm text-slate-400">טוען…</p></Center>;
  if (status === 'unauthenticated' || !session) return <LoginScreen />;

  const st = session.access?.approvalStatus;
  const onboarded = !!session.access?.onboarded || justOnboarded;
  const email = session.user?.email;

  // סדר קשיח: rejected/disabled קודם — לעולם אינם רואים onboarding.
  if (st === 'rejected') return <StateScreen title="הבקשה נדחתה" subtitle="בקשת הגישה שלך נדחתה. פנה למנהל המערכת." email={email} tone="rose" />;
  if (st === 'disabled') return <StateScreen title="החשבון הושבת" subtitle="הגישה שלך הושבתה. פנה למנהל המערכת." email={email} tone="slate" />;

  // מסך חובה: רק למשתמש pending שטרם השלים onboarding. Admin מדלג לחלוטין —
  // הוא approved דרך ADMIN_EMAILS ונכנס ישירות לאפליקציה, בלי onboarding ובלי
  // "ממתין לאישור". משתמש רגיל שכבר approved (legacy) גם הוא אינו נחסם.
  if (!onboarded && st === 'pending') {
    return <OnboardingScreen email={email} onDone={() => setJustOnboarded(true)} />;
  }

  if (st === 'approved') return <ApprovedShell session={session} />;
  if (st === 'pending') {
    // עריכה חוזרת (pending בלבד): טעינת הערך הקיים דרך GET, שמירה דרך אותו POST.
    if (editingReferral) {
      return <OnboardingScreen mode="edit" email={email} onDone={() => setEditingReferral(false)} onCancel={() => setEditingReferral(false)} />;
    }
    return (
      <StateScreen title="ממתין לאישור" subtitle="חשבונך נוצר וממתין לאישור מנהל. ניצור קשר לאחר האישור."
        email={email} tone="amber" action={{ label: 'עריכת התשובה', onClick: () => setEditingReferral(true) }} />
    );
  }
  return <StateScreen title="אין גישה" subtitle="פנה למנהל המערכת." email={email} tone="slate" />;
}
