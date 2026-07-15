'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

// פעמון ההתראות של N1 (in-app). מוצג רק בתוך ה-shell של משתמש approved (מי
// שרואה את הרכיב). כל הקריאות/העדכונים מבוצעים בשרת אך ורק על ההתראות של הסשן
// (הלקוח לעולם אינו שולח userId). ה-UI אינו שכבת האבטחה — הוא נשען על ה-API.

const API = '/api/notifications';
const POLL_MS = 60000;

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'עכשיו';
  const m = Math.floor(s / 60); if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60); if (h < 24) return `לפני ${h} שע׳`;
  const d = Math.floor(h / 24); if (d < 7) return `לפני ${d} י׳`;
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return ''; }
}

function BellIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// ---------- hook: כל לוגיקת הנתונים, ה-Polling, האופטימיות והמירוצים ----------
function useNotifications() {
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [allBusy, setAllBusy] = useState(false);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);   // מונע Poll חופף בזמן ש-GET פעיל
  const reqSeqRef = useRef(0);         // רצף בקשות — תגובה ישנה לא דורסת מצב חדש
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const applyData = (d) => {
    const list = Array.isArray(d.items) ? d.items : [];
    setItems(list);
    setUnreadCount(typeof d.unreadCount === 'number' ? d.unreadCount : list.filter(x => !x.readAt).length);
  };

  const fetchNotifications = useCallback(async ({ initial = false } = {}) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const seq = ++reqSeqRef.current;
    if (initial) { setLoading(true); setError(false); }
    try {
      const r = await fetch(API, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!mountedRef.current || seq !== reqSeqRef.current) return; // בוטלה/הוחלפה
      if (r.ok && d.ok) { applyData(d); setError(false); }
      else setError(true);
    } catch {
      if (mountedRef.current && seq === reqSeqRef.current) setError(true);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current && initial) setLoading(false);
    }
  }, []);

  // Polling יחיד + רענון ב-focus (visibilitychange). ניקוי מלא ב-unmount.
  useEffect(() => {
    mountedRef.current = true;
    fetchNotifications({ initial: true });
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchNotifications();
    }, POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') fetchNotifications(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchNotifications]);

  // סימון קריאה — אופטימי, לא חוסם. פעולה מיותרת נמנעת (כבר נקראה → אין POST).
  const markRead = useCallback(async (id) => {
    const target = itemsRef.current.find(n => n.id === id);
    if (!target || target.readAt) return;
    setItems(prev => prev.map(n => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount(c => Math.max(0, c - 1));
    reqSeqRef.current++; // מבטל GET באוויר כדי שלא ידרוס את העדכון האופטימי
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'markRead', id }) });
      // 404 = ההתראה כבר אינה קיימת בשרת; מבחינת ה-UI היא "נקראה" ואין צורך לסגת.
      if (!r.ok && r.status !== 404) await fetchNotifications();
    } catch { await fetchNotifications(); }
  }, [fetchNotifications]);

  const markAllRead = useCallback(async () => {
    if (allBusy) return;
    if (!itemsRef.current.some(n => !n.readAt)) return;
    setAllBusy(true);
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => (n.readAt ? n : { ...n, readAt: now })));
    setUnreadCount(0);
    reqSeqRef.current++;
    try {
      const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'markAllRead' }) });
      const d = await r.json().catch(() => ({}));
      if (!(r.ok && d.ok)) await fetchNotifications();
    } catch { await fetchNotifications(); } finally { if (mountedRef.current) setAllBusy(false); }
  }, [allBusy, fetchNotifications]);

  return { items, unreadCount, loading, error, allBusy, markRead, markAllRead, refetch: fetchNotifications };
}

// ---------- קביעת יעד הניווט מסוג ההתראה (מסכים קיימים בלבד) ----------
function targetFor(n) {
  if (n?.type === 'request_new') return { screen: 'posting', id: n.data?.postingId };
  if (n?.type === 'request_accepted' || n?.type === 'request_rejected') return { screen: 'coordination', id: n.data?.requestId };
  return null;
}

function NotificationItem({ n, onClick }) {
  const unread = !n.readAt;
  return (
    <button
      type="button"
      onClick={() => onClick(n)}
      className={`w-full text-right px-3 py-3 flex gap-2.5 items-start border-b border-slate-100 last:border-b-0 focus:outline-none focus:bg-slate-100 hover:bg-slate-50 ${unread ? 'bg-sky-50/70' : 'bg-white'}`}
    >
      {/* חיווי לא-נקרא: נקודה + הדגשה + תווית טקסט — לא רק צבע */}
      <span className="mt-1 shrink-0 w-2 h-2 rounded-full" aria-hidden="true"
        style={{ backgroundColor: unread ? '#0284c7' : 'transparent' }} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span className={`text-sm ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-600'}`}>{n.data?.title || 'התראה'}</span>
          {unread && <span className="text-[10px] font-bold text-sky-700 bg-sky-100 rounded-full px-1.5 py-0.5">חדש</span>}
        </span>
        {n.data?.message && <span className="block text-xs text-slate-500 mt-0.5">{n.data.message}</span>}
        <span className="block text-[11px] text-slate-400 mt-1">{timeAgo(n.createdAt)}</span>
      </span>
    </button>
  );
}

export default function NotificationsBell({ onNavigate }) {
  const { items, unreadCount, loading, error, allBusy, markRead, markAllRead, refetch } = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // סגירה: לחיצה בחוץ + Escape. ניקוי listeners ביציאה/סגירה.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const onItemClick = (n) => {
    if (!n.readAt) markRead(n.id);   // fire-and-forget — לא מעכב ניווט
    setOpen(false);
    const t = targetFor(n);
    if (t && t.id && onNavigate) onNavigate(t);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={unreadCount > 0 ? `התראות, ${unreadCount} שלא נקראו` : 'התראות'}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative flex items-center justify-center w-8 h-8 rounded-full text-white/90 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -left-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="התראות"
          className="absolute z-50 mt-2 end-0 w-80 max-w-[calc(100vw-1rem)] bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
          style={{ insetInlineEnd: 0 }}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
            <span className="text-sm font-bold text-slate-800">התראות</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={allBusy}
                className="text-xs font-bold text-sky-700 disabled:opacity-50 focus:outline-none focus:underline"
              >
                סמן הכול כנקרא
              </button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {loading ? (
              <div className="px-3 py-8 text-center text-sm text-slate-400">טוען…</div>
            ) : error ? (
              <div className="px-3 py-8 text-center">
                <p className="text-sm text-slate-500 mb-2">לא הצלחנו לטעון את ההתראות.</p>
                <button type="button" onClick={() => refetch({ initial: true })}
                  className="text-sm font-bold text-sky-700 focus:outline-none focus:underline">נסה שוב</button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-slate-400">אין התראות כרגע.</div>
            ) : (
              items.map(n => <NotificationItem key={n.id} n={n} onClick={onItemClick} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
