'use client';
import { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import App from './App';

function Center({ children }) {
  return (
    <div dir="rtl" lang="he" className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-6"
      style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <Center>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
        <h1 className="text-lg font-bold text-slate-800 mb-1">מערכת תיאום אימונים משותפים</h1>
        <p className="text-sm text-slate-500 mb-5">התחברות למערכת</p>
        <button onClick={() => signIn('google')}
          className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl mb-4">
          התחברות עם Google
        </button>
        <div className="text-xs text-slate-400 mb-3">או קישור התחברות למייל</div>
        {sent ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            נשלח קישור התחברות לכתובת {email}. בדקו את תיבת המייל.
          </p>
        ) : (
          <>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 mb-2 text-sm" />
            <button onClick={() => { if (email.trim()) { signIn('resend', { email: email.trim() }); setSent(true); } }}
              className="w-full border-2 border-slate-900 text-slate-900 font-bold py-2.5 rounded-xl">
              שליחת קישור התחברות
            </button>
          </>
        )}
      </div>
    </Center>
  );
}

function StateScreen({ title, subtitle, email, tone = 'amber' }) {
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
        <button onClick={() => signOut()} className="text-sm font-bold underline">התנתקות</button>
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

function AdminUsersScreen({ onBack }) {
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState('');
  const load = async () => {
    try {
      const r = await fetch('/api/admin/users', { cache: 'no-store' });
      const d = await r.json();
      if (d.ok) setUsers(d.users || []); else setErr(d.error || 'שגיאה');
    } catch (e) { setErr(String(e?.message || e)); }
  };
  useEffect(() => { load(); }, []);
  const setStatus = async (userId, status) => {
    const r = await fetch('/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'setStatus', userId, status }) });
    const d = await r.json();
    if (d.ok) setUsers(d.users || []);
  };
  return (
    <div dir="rtl" lang="he" className="min-h-screen bg-slate-50 text-slate-900 px-4 py-5" style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold">ניהול משתמשים</h1>
          <button onClick={onBack} className="text-sm font-bold text-sky-700">חזרה</button>
        </div>
        {err && <p className="text-sm text-rose-600 mb-3">{err}</p>}
        {users === null ? <p className="text-sm text-slate-400">טוען…</p> : users.length === 0 ? (
          <p className="text-sm text-slate-400">אין משתמשים.</p>
        ) : (
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.userId} className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="font-bold text-sm text-slate-800">{u.name || u.email || u.userId}</div>
                <div className="text-xs text-slate-500">{u.email}</div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-[11px] bg-slate-100 rounded-full px-2 py-0.5 font-bold">{STATUS_LABEL[u.approvalStatus] || u.approvalStatus}</span>
                  {(ACTIONS_FOR[u.approvalStatus] || []).map(a => (
                    <button key={a.to} onClick={() => setStatus(u.userId, a.to)}
                      className="text-[11px] font-bold border border-slate-300 rounded-full px-2.5 py-1">{a.label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovedShell({ session }) {
  const [screen, setScreen] = useState('app');
  const me = { userId: session.userId, isAdmin: !!session.access?.isAdmin };
  const user = session.user || {};
  if (screen === 'admin' && me.isAdmin) return <AdminUsersScreen onBack={() => setScreen('app')} />;
  return (
    <div>
      <div dir="rtl" className="bg-slate-900 text-white text-xs px-4 py-2 flex items-center justify-between" style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
        <span className="truncate">{user.name || user.email}{me.isAdmin ? ' · מנהל' : ''}</span>
        <span className="flex items-center gap-3 shrink-0">
          {me.isAdmin && <button onClick={() => setScreen('admin')} className="font-bold underline">ניהול משתמשים</button>}
          <button onClick={() => signOut()} className="font-bold underline">התנתקות</button>
        </span>
      </div>
      <App me={me} />
    </div>
  );
}

export default function AuthGate() {
  const { data: session, status } = useSession();
  if (status === 'loading') return <Center><p className="text-center text-sm text-slate-400">טוען…</p></Center>;
  if (status === 'unauthenticated' || !session) return <LoginScreen />;
  const st = session.access?.approvalStatus;
  const email = session.user?.email;
  if (st === 'approved') return <ApprovedShell session={session} />;
  if (st === 'pending') return <StateScreen title="ממתין לאישור" subtitle="חשבונך נוצר וממתין לאישור מנהל. ניצור קשר לאחר האישור." email={email} tone="amber" />;
  if (st === 'rejected') return <StateScreen title="הבקשה נדחתה" subtitle="בקשת הגישה שלך נדחתה. פנה למנהל המערכת." email={email} tone="rose" />;
  if (st === 'disabled') return <StateScreen title="החשבון הושבת" subtitle="הגישה שלך הושבתה. פנה למנהל המערכת." email={email} tone="slate" />;
  return <StateScreen title="אין גישה" subtitle="פנה למנהל המערכת." email={email} tone="slate" />;
}
