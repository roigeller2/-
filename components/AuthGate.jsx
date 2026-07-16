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

  const submit = async () => {
    if (savingRef.current) return; // מניעת שליחה כפולה
    const t = text.trim();
    if (!t) { setErr('נא למלא את השדה כדי להמשיך.'); return; }
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
    </Center>
  );
}

const STATUS_LABEL = { pending: 'ממתין', approved: 'מאושר', rejected: 'נדחה', disabled: 'מושבת' };
const ACTIONS_FOR = {
  pending: [{ to: 'approved', label: 'אשר' }, { to: 'rejected', label: 'דחה' }],
  approved: [{ to: 'disabled', label: 'השבת' }],
  rejected: [{ to: 'approved', label: 'אשר' }],
  disabled: [{ to: 'approved', label: 'הפעל מחדש' }],
};

// מצב השלמת ההצטרפות של משתמש לתצוגת ה-Admin. משתמש ותיק (approved לפני הפיצ'ר,
// בלי השדות החדשים) אינו מסומן כ"בקשה לא מלאה".
function referralInfo(u) {
  if (u.referralSource || u.onboardingCompletedAt) {
    return { kind: 'answer', text: u.referralSource || '(ללא טקסט)' };
  }
  if (u.approvalStatus === 'pending') return { kind: 'incomplete', text: 'טרם השלים בקשת הצטרפות' };
  return { kind: 'legacy', text: 'לא קיים מידע — משתמש ותיק' };
}

function AdminUsersScreen({ onBack }) {
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const load = async () => {
    try {
      const r = await fetch('/api/admin/users', { cache: 'no-store' });
      const d = await r.json();
      if (d.ok) setUsers(d.users || []); else setErr(d.error || 'שגיאה');
    } catch (e) { setErr(String(e?.message || e)); }
  };
  useEffect(() => { load(); }, []);
  const setStatus = async (userId, status) => {
    setActionMsg('');
    try {
      const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'setStatus', userId, status }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) { setUsers(d.users || []); return; }
      // הודעה ידידותית — לא לחשוף את שם ה-reason הטכני מהשרת.
      setActionMsg(d.error === 'onboarding_incomplete'
        ? 'לא ניתן לאשר לפני השלמת בקשת ההצטרפות.'
        : 'הפעולה נכשלה. נסו שוב.');
    } catch { setActionMsg('שגיאת רשת. נסו שוב.'); }
  };
  return (
    <div dir="rtl" lang="he" className="min-h-screen bg-slate-50 text-slate-900 px-4 py-5" style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold">ניהול משתמשים</h1>
          <button onClick={onBack} className="text-sm font-bold text-sky-700">חזרה</button>
        </div>
        {err && <p className="text-sm text-rose-600 mb-3">{err}</p>}
        {actionMsg && <p className="text-sm text-amber-700 mb-3" role="alert">{actionMsg}</p>}
        {users === null ? <p className="text-sm text-slate-400">טוען…</p> : users.length === 0 ? (
          <p className="text-sm text-slate-400">אין משתמשים.</p>
        ) : (
          <div className="space-y-2">
            {users.map(u => {
              // Admin (נגזר בשרת מ-ADMIN_EMAILS): מוצג כ"מנהל", בלי אזור
              // "דרך מי הגיע אלינו", בלי תווית "טרם השלים", ובלי פעולות סטטוס.
              if (u.isAdmin) {
                return (
                  <div key={u.userId} className="bg-white border border-slate-200 rounded-xl p-3">
                    <div className="font-bold text-sm text-slate-800">{u.name || u.email || u.userId}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-[11px] bg-sky-100 text-sky-800 rounded-full px-2 py-0.5 font-bold">מנהל</span>
                    </div>
                  </div>
                );
              }
              const info = referralInfo(u);
              const infoCls = info.kind === 'incomplete' ? 'text-amber-700' : info.kind === 'legacy' ? 'text-slate-400' : 'text-slate-700';
              const incompletePending = u.approvalStatus === 'pending' && !u.onboardingCompletedAt;
              const actions = (ACTIONS_FOR[u.approvalStatus] || []).filter(a => !(incompletePending && a.to === 'approved'));
              return (
                <div key={u.userId} className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="font-bold text-sm text-slate-800">{u.name || u.email || u.userId}</div>
                  <div className="text-xs text-slate-500">{u.email}</div>
                  <div className="mt-1 text-xs">
                    <span className="text-slate-400">דרך מי הגיע אלינו: </span>
                    <span className={`font-semibold ${infoCls}`}>{info.text}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[11px] bg-slate-100 rounded-full px-2 py-0.5 font-bold">{STATUS_LABEL[u.approvalStatus] || u.approvalStatus}</span>
                    {actions.map(a => (
                      <button key={a.to} onClick={() => setStatus(u.userId, a.to)}
                        className="text-[11px] font-bold border border-slate-300 rounded-full px-2.5 py-1">{a.label}</button>
                    ))}
                  </div>
                  {incompletePending && <p className="text-[11px] text-amber-700 mt-1">לא ניתן לאשר לפני השלמת בקשת ההצטרפות</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
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
