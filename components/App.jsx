'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef, useContext } from "react";
import {
  Home, Users, BarChart3, Plus, ArrowRight, Phone, MapPin,
  Calendar, Clock, Search, X, Check, ChevronLeft, ChevronDown,
  AlertTriangle, Download, RefreshCw, Filter, CalendarDays
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";

function HeliIcon({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 10l1 2h6" />
      <path d="M12 9a2 2 0 0 0 -2 2v3c0 1.1 .9 2 2 2h7a2 2 0 0 0 2 -2c0 -3.31 -3.13 -5 -7 -5h-2" />
      <path d="M13 9l0 -3" />
      <path d="M5 6l15 0" />
      <path d="M15 9.1v3.9h5.5" />
      <path d="M15 19l0 -3" />
      <path d="M19 19l-8 0" />
    </svg>
  );
}

/* ============================== קבועים ============================== */

const APP_VERSION = 'Vercel · גרסה 11 💰';

const REGION = 'איו״ש';

const SQUADRONS = [
  { number: '190', type: 'attack' },
  { number: '113', type: 'attack' },
  { number: '123', type: 'utility' },
  { number: '124', type: 'utility' },
  { number: '118', type: 'utility' },
];

const SQUADRON_TYPE_LABEL = { attack: 'מסוקי קרב', utility: 'מסוקי סער' };

const BRIGADES = ['מנשה', 'אפרים', 'שומרון', 'בנימין', 'יהודה', 'עציון', 'בקעה'];

const SPACES = {
  'איו״ש': ['מנשה', 'אפרים', 'שומרון', 'בנימין', 'יהודה', 'עציון'],
  'גבול ירדן': ['צפונית לים המלח', 'ים המלח ודרומה'],
};
const SPACE_NAMES = Object.keys(SPACES);
const ALL_AREAS = [...SPACES['איו״ש'], ...SPACES['גבול ירדן']];

// סטטוס אימון (שכבה 2) — נגזר בזמן קריאה מהבקשות + override ידני. ארבעה מצבים,
// עם שפת צבעים אחידה: פנוי=ירוק, בתהליך=כתום, בוצע=כחול, בוטל=אדום.
const COORD_STATE = {
  open: { label: 'פנוי לתיאום', bg: 'bg-emerald-100', text: 'text-emerald-800', bar: '#10b981' },
  in_process: { label: 'בתהליך תיאום', bg: 'bg-amber-100', text: 'text-amber-800', bar: '#f59e0b' },
  done: { label: 'בוצע תיאום', bg: 'bg-sky-100', text: 'text-sky-800', bar: '#0284c7' },
  cancelled: { label: 'בוטל', bg: 'bg-rose-100', text: 'text-rose-800', bar: '#e11d48' },
};

const TRAINING_TYPES = ['תרח"ט', 'תרג"ד', 'אימון מקומי'];
const AIR_SUPPORT_TYPES = ['פינוי פצועים', 'הטסת כוחות', 'מסוק קרב', 'פתוח להכול'];

const POSTING_STATUS = {
  available: { label: 'פנוי', bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500' },
  pending_approval: { label: 'ממתין לאישור', bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' },
  in_coordination: { label: 'עבר לתיאום', bg: 'bg-sky-100', text: 'text-sky-800', dot: 'bg-sky-500' },
  completed: { label: 'הושלם', bg: 'bg-slate-200', text: 'text-slate-700', dot: 'bg-slate-500' },
  cancelled: { label: 'בוטל', bg: 'bg-rose-100', text: 'text-rose-800', dot: 'bg-rose-500' },
};

const COORD_STAGES = [
  { key: 'initial_coordination_done', label: 'תיאום ראשוני' },
  { key: 'specific_times_closed', label: 'הוחלט על שת״פ' },
  { key: 'planning_summary_done', label: 'סיכום תכנון' },
];

// סטטוס בקשה (שכבה 1) — ערכים חדשים. 'active' ישן ממופה בזמן קריאה ל-'pending'.
const REQUEST_STATUS_LABEL = { pending: 'ממתינה', accepted: 'התקבלה', rejected: 'נדחתה', cancelled: 'בוטלה' };
const REQUEST_STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-200 text-slate-600',
};

const EXEC_STATUS = {
  pending: { label: 'טרם בוצע', bg: 'bg-slate-100', text: 'text-slate-700' },
  completed: { label: 'בוצע', bg: 'bg-emerald-100', text: 'text-emerald-800' },
  cancelled: { label: 'בוטל', bg: 'bg-rose-100', text: 'text-rose-800' },
  unknown: { label: 'לא ידוע', bg: 'bg-amber-100', text: 'text-amber-800' },
};

/* ============================== עזרים ============================== */

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));

// זהות המשתמש הנוכחי (מגיע מה-AuthGate). משמש להסתרת פעולות לא-מורשות ב-UI
// בלבד — האכיפה האמיתית בשרת. { userId, isAdmin }.
const MeContext = React.createContext({ userId: null, isAdmin: false });
const useMe = () => useContext(MeContext);
// האם המשתמש רשאי לנהל את האימון (בעל האימון או מנהל). ownerId חסר = legacy → מנהל בלבד.
const canManagePostingUI = (me, posting) => !!me?.isAdmin || (posting?.ownerId != null && posting.ownerId === me?.userId);
const canCancelRequestUI = (me, coord) => !!me?.isAdmin || (coord?.requesterId != null && coord.requesterId === me?.userId);

const fmtDate = (d) => {
  if (!d) return '—';
  const t = new Date(d);
  if (isNaN(t)) return String(d);
  return `${t.getDate()}/${t.getMonth() + 1}/${t.getFullYear()}`;
};
const fmtDateTime = (d) => {
  if (!d) return '—';
  const t = new Date(d);
  if (isNaN(t)) return String(d);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `${t.getDate()}/${t.getMonth() + 1}/${t.getFullYear()} ${hh}:${mm}`;
};

// ========== וואטסאפ: קישור עם הודעה מוכנה מראש מפרטי האימון ==========
const waPhone = (raw) => {
  let d = (raw || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d;
};
const buildWhatsAppUrl = (posting, request = null) => {
  // המספר תמיד של הצד הקרקעי: אם הועברה בקשה מפורשת (תרחיש הטייסת, שלב 2) —
  // מהבקשה; אחרת (תרחיש הכוח שפרסם) — מהפרסום עצמו.
  const phone = waPhone(request ? request.contactPhone : posting.contactPhone);
  if (!phone) return null;
  const w = postingWindows(posting)[0] || {};
  const dateStr = fmtDate(w.date || posting.date);
  const times = (w.startTime || w.endTime) ? ` בשעות ${w.startTime || '--:--'}–${w.endTime || '--:--'}` : '';
  const areas = postingAreas(posting);
  const loc = `${postingSpace(posting)}${areas.length ? ' / ' + areas[0] : ''}`;
  const typePart = posting.type === 'ground' && posting.trainingType ? ` (${posting.trainingType})` : '';
  const msg = `היי, שלום. ראיתי את האימון שפרסמת ב${loc} בתאריך ${dateStr}${times}${typePart}. אני מעוניין להצטרף ולתאם את האימון איתך. אשמח שניצור קשר.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
};

const squadronType = (number) => SQUADRONS.find(s => s.number === number)?.type;

function stageIndex(key) { return COORD_STAGES.findIndex(s => s.key === key); }

const postingAreas = (p) => (p.areas && p.areas.length ? p.areas : (p.region ? [p.region] : []));

const postingWindows = (p) => {
  if (p.windows && p.windows.length) return p.windows;
  if (p.date) return [{
    id: 'legacy', date: p.date, startTime: p.startTime || '', endTime: p.endTime || '',
    location: p.generalLocationDescription || '', durationMinutes: p.windowDurationMinutes || '',
    windowsCount: p.trainingWindowsCount || '', notes: ''
  }];
  return [];
};

const postingDate = (p) => {
  const ws = postingWindows(p);
  const dates = ws.map(w => w.date).filter(Boolean).sort();
  return dates[0] || p.date || '';
};

const postingSpace = (p) => {
  if (p.space) return p.space;
  const as = p.areas || [];
  if (as.some(a => SPACES['גבול ירדן'].includes(a))) return 'גבול ירדן';
  return 'איו״ש';
};

const postingCoordState = (p) => p.coordState || (
  (p.status === 'in_coordination' || p.status === 'pending_approval') ? 'in_process'
  : p.status === 'completed' ? 'done' : 'open');

// שדה שיוך בקשה-לאימון. השדה האמיתי הוא postId; fallback ל-postingId הגנתי בלבד.
const coordPostId = (c) => (c && (c.postId ?? c.postingId));

// נרמול אחיד של סטטוס בקשה (תאימות-בקריאה). 'active' ישן → 'pending'.
// בשימוש בכל מקום: גזירה, תצוגה, בדיקת accepted-קיים, פילטרים, בדיקות.
const normalizeRequestStatus = (c) => {
  const s = c && c.requestStatus;
  if (s === 'accepted') return 'accepted';
  if (s === 'rejected') return 'rejected';
  if (s === 'cancelled') return 'cancelled';
  return 'pending'; // 'active' ישן וכל ערך לא-מוכר
};

// קיבוץ בקשות לפי אימון (למניעת O(n^2) בתצוגות רשימה).
const groupCoordsByPost = (coordRequests) => {
  const m = {};
  (coordRequests || []).forEach(c => {
    const k = coordPostId(c);
    (m[k] || (m[k] = [])).push(c);
  });
  return m;
};

// גזירת סטטוס האימון בזמן קריאה. סדר קדימות: override ידני גובר; אחריו
// תאימות-לאחור לרשומות ישנות; אחריו accepted מפורש → בתהליך; אחרת פנוי.
// active ישן (→pending) לעולם לא גורם ל"בתהליך".
const deriveTrainingStatus = (posting, requests) => {
  const m = posting.manualStatus;
  if (m === 'cancelled') return 'cancelled';
  if (m === 'done') return 'done';
  // תאימות-לאחור (רשומות ללא manualStatus)
  if (posting.status === 'cancelled') return 'cancelled';
  const anyExecCompleted = (requests || []).some(r => r.trainingExecutionStatus === 'completed');
  if (posting.status === 'completed' || anyExecCompleted) return 'done';
  if (posting.coordState === 'done') return 'in_process'; // done ישן בלי completed → בתהליך
  // מבוסס על הבקשה שהתקבלה בלבד (accepted יחיד). שלב "הוחלט על שת״פ" ומעלה →
  // "בוצע תיאום" (כחול); שלב "תיאום ראשוני" → "בתהליך" (כתום). בקשות שאינן
  // accepted (ממתינה/נדחתה/בוטלה) אינן משפיעות על צבע האימון.
  const accepted = (requests || []).find(r => normalizeRequestStatus(r) === 'accepted');
  if (accepted) {
    return stageIndex(accepted.coordinationStatus) >= stageIndex('specific_times_closed') ? 'done' : 'in_process';
  }
  return 'open';
};

/* ============================== שכבת שמירה משותפת ============================== */

const KEY_POSTINGS = 'postings';
const KEY_COORDS = 'coordination-requests';

const API_PATH = { postings: '/api/postings', 'coordination-requests': '/api/coordination-requests' };

// בדיקת זמינות ה-API (מסד הנתונים המשותף ב-Vercel KV)
async function storagePing() {
  try {
    const res = await fetch(API_PATH.postings, { cache: 'no-store' });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || `שגיאת שרת (קוד ${res.status})` };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function loadCollection(key) {
  try {
    const res = await fetch(API_PATH[key], { cache: 'no-store' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `שגיאת שרת (קוד ${res.status})`);
    }
    const data = await res.json();
    return {
      items: Array.isArray(data.value) ? data.value : [],
      rev: typeof data.rev === 'number' ? data.rev : 0,
    };
  } catch (e) {
    console.error(`[loadCollection] קריאת "${key}" נכשלה:`, e);
    throw e;
  }
}


// מיזוג לפי id — הרשומה עם updatedAt חדש יותר מנצחת.
// כך שני טלפונים שכותבים במקביל לא דורסים אחד את השני.
function mergeById(a, b) {
  const map = new Map();
  [...(a || []), ...(b || [])].forEach(r => {
    if (!r || !r.id) return;
    const ex = map.get(r.id);
    if (!ex || (r.updatedAt || r.createdAt || '') >= (ex.updatedAt || ex.createdAt || '')) {
      map.set(r.id, r);
    }
  });
  return [...map.values()];
}

/* ============================== רכיבי UI קטנים/* ============================== רכיבי UI קטנים ============================== */

function StatusBadge({ status }) {
  const s = POSTING_STATUS[status] || POSTING_STATUS.available;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`}></span>
      {s.label}
    </span>
  );
}

function ExecBadge({ status }) {
  const s = EXEC_STATUS[status] || EXEC_STATUS.pending;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function CoordStateBadge({ state }) {
  const s = COORD_STATE[state] || COORD_STATE.open;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function SquadronTag({ number }) {
  const t = squadronType(number);
  return (
    <span className="inline-flex items-center gap-2 bg-sky-700 text-white rounded-lg px-3 py-1.5 font-mono font-bold text-sm">
      <HeliIcon size={14} />
      טייסת {number}
      <span className="text-sky-200 font-sans font-normal text-xs border-r border-sky-500 pr-2">
        {SQUADRON_TYPE_LABEL[t] || ''}
      </span>
    </span>
  );
}

function GroundTag({ unitName, brigade }) {
  return (
    <span className="inline-flex items-center gap-2 text-white rounded-lg px-3 py-1.5 font-bold text-sm" style={{ backgroundColor: '#4b5320' }}>
      <Users size={14} />
      {unitName}
      <span className="text-lime-200 font-normal text-xs border-r pr-2" style={{ borderColor: '#78834b' }}>
        חטיבת {brigade}
      </span>
    </span>
  );
}

function ProgressBar({ currentKey, onStageClick, editable }) {
  const idx = stageIndex(currentKey);
  return (
    <div className="flex items-stretch">
      {COORD_STAGES.map((stage, i) => {
        const done = i <= idx;
        const isCurrent = i === idx;
        const canAdvance = editable && i > idx;
        const canRevert = editable && done && i > 0; // שלב 1 נעול (נובע מעצם קיום הבקשה)
        const clickable = canAdvance || canRevert;
        return (
          <div key={stage.key} className="flex-1 flex flex-col items-center relative">
            <div className="flex items-center w-full">
              <div className={`flex-1 h-0.5 ${i === 0 ? 'opacity-0' : (i <= idx ? 'bg-emerald-500' : 'bg-slate-300')}`}></div>
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onStageClick(stage, i, done)}
                className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold border-2 transition
                  ${done ? 'bg-emerald-500 border-emerald-500 text-white' :
                    isCurrent ? 'bg-sky-500 border-sky-500 text-white' :
                    'bg-white border-slate-300 text-slate-400'}
                  ${clickable ? 'cursor-pointer hover:opacity-80' : ''}`}
              >
                {done ? <Check size={16} /> : i + 1}
              </button>
              <div className={`flex-1 h-0.5 ${i === COORD_STAGES.length - 1 ? 'opacity-0' : (i < idx ? 'bg-emerald-500' : 'bg-slate-300')}`}></div>
            </div>
            <span className={`text-[11px] mt-1.5 text-center px-1 font-semibold ${isCurrent ? 'text-sky-700' : done ? 'text-emerald-700' : 'text-slate-400'}`}>
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Icon size={28} className="text-slate-400" />
      </div>
      <h3 className="font-bold text-slate-700 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 mb-4">{subtitle}</p>
      {action}
    </div>
  );
}

function FieldLabel({ children, required }) {
  return (
    <label className="block text-sm font-bold text-slate-700 mb-1.5">
      {children} {required && <span className="text-rose-500">*</span>}
    </label>
  );
}

const inputCls = "w-full border border-slate-300 rounded-xl px-3 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-sky-400 bg-white";


/* ============================== בחירת אזור/חטיבות ============================== */

function BrigadeMultiSelect({ selected, onChange }) {
  const toggle = (b) => onChange(selected.includes(b) ? selected.filter(x => x !== b) : [...selected, b]);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="flex items-center gap-2 mb-2">
        <MapPin size={14} className="text-slate-500" />
        <span className="text-sm font-bold text-slate-700">{REGION}</span>
        <span className="text-xs text-slate-400">· ניתן לבחור יותר מחטיבה אחת</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {BRIGADES.map(b => {
          const on = selected.includes(b);
          return (
            <button key={b} type="button" onClick={() => toggle(b)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${on ? 'bg-slate-900 text-amber-300 border-slate-900' : 'bg-white text-slate-600 border-slate-300 active:bg-slate-50'}`}>
              {on ? '✓ ' : ''}{b}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AreaChips({ areas, space }) {
  if ((!areas || !areas.length) && !space) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {space && (
        <span className="text-[11px] bg-slate-800 text-amber-300 rounded-full px-2 py-0.5 inline-flex items-center gap-1 font-bold">
          <MapPin size={10} />{space}
        </span>
      )}
      {(areas || []).map(a => (
        <span key={a} className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 inline-flex items-center gap-1">
          {a}
        </span>
      ))}
    </div>
  );
}

function SpaceAreaSelect({ space, onSpaceChange, areas, onAreasChange }) {
  const options = SPACES[space] || [];
  const toggle = (a) => onAreasChange(areas.includes(a) ? areas.filter(x => x !== a) : [...areas, a]);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="text-xs font-bold text-slate-500 mb-1.5">מרחב <span className="text-rose-500">*</span></div>
      <div className="flex gap-2 mb-3">
        {SPACE_NAMES.map(s => (
          <button key={s} type="button" onClick={() => { onSpaceChange(s); onAreasChange([]); }}
            className={`flex-1 py-2 rounded-lg text-sm font-bold border transition ${space === s ? 'bg-slate-900 text-amber-300 border-slate-900' : 'bg-white text-slate-600 border-slate-300'}`}>
            {s}
          </button>
        ))}
      </div>
      <div className="text-xs font-bold text-slate-500 mb-1.5">אזור <span className="text-rose-500">*</span> <span className="font-normal text-slate-400">· ניתן לבחור יותר מאחד</span></div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(a => {
          const on = areas.includes(a);
          return (
            <button key={a} type="button" onClick={() => toggle(a)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${on ? 'bg-slate-900 text-amber-300 border-slate-900' : 'bg-white text-slate-600 border-slate-300 active:bg-slate-50'}`}>
              {on ? '✓ ' : ''}{a}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ============================== חלונות אימון (Accordion) ============================== */

const emptyWindow = () => ({ id: uid(), date: '', startTime: '', endTime: '', location: '', durationMinutes: '', windowsCount: '', notes: '' });

function windowSummary(w) {
  const parts = [w.date ? fmtDate(w.date) : 'ללא תאריך'];
  if (w.startTime || w.endTime) parts.push(`${w.startTime || '--:--'}–${w.endTime || '--:--'}`);
  if (w.location) parts.push(w.location);
  return parts.join(' · ');
}

function TrainingWindowEditor({ windows, onChange }) {
  const [openId, setOpenId] = useState(windows[0]?.id || null);
  const update = (id, patch) => onChange(windows.map(w => w.id === id ? { ...w, ...patch } : w));
  const remove = (id) => onChange(windows.filter(w => w.id !== id));
  const add = () => { const w = emptyWindow(); onChange([...windows, w]); setOpenId(w.id); };
  return (
    <div className="space-y-2">
      {windows.map((w, i) => {
        const open = openId === w.id;
        return (
          <div key={w.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <button type="button" onClick={() => setOpenId(open ? null : w.id)} className="w-full flex items-center justify-between px-3 py-3 text-right">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-800">חלון {i + 1}</div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">{windowSummary(w)}</div>
              </div>
              <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <div className="px-3 pb-3 border-t border-slate-100 pt-3">
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div><FieldLabel required>תאריך</FieldLabel><input type="date" value={w.date} onChange={e => update(w.id, { date: e.target.value })} className={inputCls} /></div>
                  <div><FieldLabel required>התחלה</FieldLabel><input type="time" value={w.startTime} onChange={e => update(w.id, { startTime: e.target.value })} className={inputCls} /></div>
                  <div><FieldLabel required>סיום</FieldLabel><input type="time" value={w.endTime} onChange={e => update(w.id, { endTime: e.target.value })} className={inputCls} /></div>
                </div>
                <div className="mb-3"><FieldLabel>מיקום</FieldLabel><input value={w.location} onChange={e => update(w.id, { location: e.target.value })} className={inputCls} placeholder="למשל: שטח אימונים ..." /></div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div><FieldLabel>משך כל חלון (דק')</FieldLabel><input type="number" min="1" value={w.durationMinutes} onChange={e => update(w.id, { durationMinutes: e.target.value })} className={inputCls} /></div>
                  <div><FieldLabel>מספר חלונות</FieldLabel><input type="number" min="1" value={w.windowsCount} onChange={e => update(w.id, { windowsCount: e.target.value })} className={inputCls} /></div>
                </div>
                <div className="mb-2"><FieldLabel>הערות לחלון</FieldLabel><textarea rows={2} value={w.notes} onChange={e => update(w.id, { notes: e.target.value })} className={inputCls} /></div>
                <div className="flex justify-between items-center">
                  {windows.length > 1 ? (
                    <button type="button" onClick={() => remove(w.id)} className="text-rose-600 text-xs font-bold">מחק חלון</button>
                  ) : <span />}
                  <button type="button" onClick={() => setOpenId(null)} className="text-sky-600 text-xs font-bold">סגור כרטיס ✓</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button type="button" onClick={add} className="w-full border-2 border-dashed border-slate-300 rounded-xl py-2.5 text-sm font-bold text-slate-500 flex items-center justify-center gap-1.5 active:bg-slate-50">
        <Plus size={16} /> הוסף חלון נוסף
      </button>
    </div>
  );
}

function WindowsReadOnly({ windows }) {
  const [openKey, setOpenKey] = useState(null);
  if (!windows.length) return null;
  return (
    <div className="space-y-2">
      {windows.map((w, i) => {
        const key = w.id || String(i);
        const open = openKey === key;
        return (
          <div key={key} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <button type="button" onClick={() => setOpenKey(open ? null : key)} className="w-full flex items-center justify-between px-3 py-3 text-right">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-800">חלון {i + 1}</div>
                <div className="text-xs text-slate-500 mt-0.5 truncate">{windowSummary(w)}</div>
              </div>
              <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <div className="px-3 pb-3 border-t border-slate-100 pt-2">
                <InfoRow icon={Calendar} label="תאריך" value={fmtDate(w.date)} />
                <InfoRow icon={Clock} label="שעות" value={(w.startTime || w.endTime) ? `${w.startTime || '--:--'}–${w.endTime || '--:--'}` : ''} />
                <InfoRow icon={MapPin} label="מיקום" value={w.location} />
                <InfoRow icon={Clock} label="משך כל חלון (דק')" value={w.durationMinutes} />
                <InfoRow icon={HeliIcon} label="מספר חלונות" value={w.windowsCount} />
                <InfoRow icon={AlertTriangle} label="הערות" value={w.notes} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================== ניווט ============================== */

function Header({ title, onBack, tone }) {
  const bgCls = tone === 'heli' ? 'bg-sky-800' : tone === 'ground' ? '' : 'bg-slate-900';
  const bgStyle = tone === 'ground' ? { backgroundColor: '#3f4d23' } : undefined;
  return (
    <div className={`sticky top-0 z-20 ${bgCls} text-white px-4 py-3.5 flex items-center gap-3 shadow-md`} style={bgStyle}>
      {onBack && (
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-800 active:bg-slate-700">
          <ArrowRight size={20} />
        </button>
      )}
      <h1 className="font-bold text-[17px] truncate">{title}</h1>
    </div>
  );
}

function BottomNav({ screen, go }) {
  const items = [
    { key: 'dashboard', label: 'בית', icon: Home },
    { key: 'helicopters', label: 'אימוני מסוקים', icon: HeliIcon },
    { key: 'ground', label: 'אימוני כוחות', icon: Users },
    { key: 'analytics', label: 'נתונים', icon: BarChart3 },
  ];
  return (
    <div className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex items-stretch" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {items.map(it => {
        const active = screen === it.key;
        const activeCls = it.key === 'ground' ? 'text-green-700' : 'text-sky-600';
        return (
          <button key={it.key} onClick={() => go(it.key)} className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 ${active ? activeCls : 'text-slate-400'}`}>
            <it.icon size={20} strokeWidth={active ? 2.5 : 2} />
            <span className={`text-[10px] ${active ? 'font-bold' : 'font-medium'}`}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ============================== כרטיס פרסום ============================== */

function PostingCard({ posting, onClick, coordState }) {
  const isHeli = posting.type === 'helicopter';
  const d = postingDate(posting);
  const areas = postingAreas(posting);
  const space = postingSpace(posting);
  const wins = postingWindows(posting);
  const first = wins[0] || {};
  return (
    <button onClick={onClick} className="w-full text-right bg-white rounded-2xl border border-slate-200 p-4 shadow-sm active:scale-[0.99] transition">
      <div className="flex items-start justify-between gap-2 mb-2.5">
        {isHeli
          ? <SquadronTag number={posting.squadronNumber} />
          : <GroundTag unitName={posting.unitName} brigade={posting.brigade} />}
        <CoordStateBadge state={coordState || postingCoordState(posting)} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 mb-2">
        <span className="flex items-center gap-1"><Calendar size={14} />{fmtDate(d)}</span>
        {(first.startTime || first.endTime) && (
          <span className="flex items-center gap-1"><Clock size={14} />{first.startTime || '--:--'}–{first.endTime || '--:--'}</span>
        )}
        {isHeli && wins.length > 1 && (
          <span className="text-xs bg-sky-50 text-sky-700 rounded-full px-2 py-0.5 font-bold">{wins.length} חלונות</span>
        )}
      </div>
      <div className="mb-2"><AreaChips areas={areas} space={space} /></div>
      {!isHeli && (posting.trainingType || posting.airSupportType) && (
        <div className="flex flex-wrap gap-1 mb-2">
          {posting.trainingType && <span className="text-[11px] bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5 font-bold">{posting.trainingType}</span>}
          {posting.airSupportType && <span className="text-[11px] bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 font-bold">{posting.airSupportType}</span>}
        </div>
      )}
      {posting.description && (
        <p className="text-sm text-slate-500 line-clamp-2">{posting.description}</p>
      )}
    </button>
  );
}

/* ============================== דאשבורד ============================== */

function Dashboard({ postings, coordRequests, go }) {
  const heli = postings.filter(p => p.type === 'helicopter');
  const ground = postings.filter(p => p.type === 'ground');
  const byPost = groupCoordsByPost(coordRequests);
  const stateOf = (p) => deriveTrainingStatus(p, byPost[p.id] || []);
  const stats = {
    heliAvailable: heli.filter(p => stateOf(p) === 'open').length,
    groundAvailable: ground.filter(p => stateOf(p) === 'open').length,
    inCoordination: postings.filter(p => stateOf(p) === 'in_process').length,
    completed: postings.filter(p => stateOf(p) === 'done').length,
  };
  const recent = [...postings].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

  return (
    <div className="pb-6">
      <div className="bg-gradient-to-l from-slate-900 to-slate-800 text-white px-4 pt-5 pb-6 rounded-b-3xl">
        <p className="text-slate-400 text-sm mb-1">מערכת תיאום אימונים משותפים · <span className="text-amber-400 font-bold">{APP_VERSION}</span></p>
        <h2 className="text-xl font-bold mb-4">מסוקים ⇄ כוחות קרקעיים · {REGION}</h2>
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-white/10 rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold">{stats.heliAvailable}</div>
            <div className="text-[10px] text-slate-300 mt-0.5">מסוקים פנויים</div>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold">{stats.groundAvailable}</div>
            <div className="text-[10px] text-slate-300 mt-0.5">קרקע פנויים</div>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold">{stats.inCoordination}</div>
            <div className="text-[10px] text-slate-300 mt-0.5">בתיאום</div>
          </div>
          <div className="bg-white/10 rounded-xl p-2.5 text-center">
            <div className="text-xl font-bold">{stats.completed}</div>
            <div className="text-[10px] text-slate-300 mt-0.5">הושלמו</div>
          </div>
        </div>
      </div>

      <div className="px-4 mt-5 grid grid-cols-2 gap-3">
        <button onClick={() => go('newHelicopter')} className="bg-sky-700 text-white rounded-2xl p-4 text-right shadow-sm active:scale-[0.98] transition">
          <HeliIcon size={26} className="mb-2" />
          <div className="font-bold text-sm">פרסום חדש</div>
          <div className="text-xs text-sky-100">טייסת מסוקים</div>
        </button>
        <button onClick={() => go('newGround')} className="text-white rounded-2xl p-4 text-right shadow-sm active:scale-[0.98] transition" style={{ backgroundColor: '#556b2f' }}>
          <Users size={22} className="mb-2 text-lime-200" />
          <div className="font-bold text-sm">פרסום חדש</div>
          <div className="text-xs text-lime-100">כוח קרקעי</div>
        </button>
      </div>

      <div className="px-4 mt-3">
        <button onClick={() => go('timeline')} className="w-full bg-white border border-slate-200 rounded-2xl p-3.5 flex items-center justify-center gap-2 font-bold text-slate-700 text-sm shadow-sm active:scale-[0.98] transition">
          <CalendarDays size={18} className="text-sky-600" /> תצוגת גאנט — ציר זמן אימונים
        </button>
      </div>

      <div className="px-4 mt-6">
        <h3 className="font-bold text-slate-800 mb-3">פרסומים אחרונים</h3>
        {recent.length === 0 ? (
          <EmptyState icon={Calendar} title="אין עדיין פרסומים" subtitle="פרסמו הזדמנות אימון ראשונה כדי להתחיל" />
        ) : (
          <div className="space-y-3">
            {recent.map(p => (
              <PostingCard key={p.id} posting={p} coordState={stateOf(p)} onClick={() => go('posting', { id: p.id })} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== רשימת פרסומים ============================== */

function PostingListScreen({ type, postings, coordRequests, go, onBack }) {
  const [view, setView] = useState('gantt'); // ברירת מחדל: גאנט
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [coordStateF, setCoordStateF] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [spaceF, setSpaceF] = useState('all');
  const [areaF, setAreaF] = useState('all');
  const [squadronsF, setSquadronsF] = useState([]);
  const [trainingTypeF, setTrainingTypeF] = useState('all');
  const [airSupportF, setAirSupportF] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const areaOptions = spaceF === 'all' ? ALL_AREAS : (SPACES[spaceF] || []);

  const toggleSquadron = (n) => setSquadronsF(s => s.includes(n) ? s.filter(x => x !== n) : [...s, n]);

  const byPost = useMemo(() => groupCoordsByPost(coordRequests), [coordRequests]);

  const list = useMemo(() => {
    return postings
      .filter(p => p.type === type)
      .filter(p => statusFilter === 'all' || p.status === statusFilter)
      .filter(p => coordStateF === 'all' || deriveTrainingStatus(p, byPost[p.id] || []) === coordStateF)
      .filter(p => !dateFrom || postingDate(p) >= dateFrom)
      .filter(p => spaceF === 'all' || postingSpace(p) === spaceF)
      .filter(p => areaF === 'all' || postingAreas(p).includes(areaF))
      .filter(p => squadronsF.length === 0 || squadronsF.includes(p.squadronNumber))
      .filter(p => trainingTypeF === 'all' || p.trainingType === trainingTypeF)
      .filter(p => airSupportF === 'all' || p.airSupportType === airSupportF)
      .filter(p => {
        if (!q.trim()) return true;
        const hay = [
          p.description, p.notes, p.squadronNumber, p.unitName, p.brigade,
          p.generalLocationDescription, p.trainingDescription,
          p.trainingType, p.airSupportType, postingSpace(p),
          ...postingAreas(p),
          ...postingWindows(p).map(w => w.location)
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q.toLowerCase());
      })
      .sort((a, b) => (postingDate(a) || '9999').localeCompare(postingDate(b) || '9999'));
  }, [postings, byPost, type, statusFilter, coordStateF, dateFrom, spaceF, areaF, squadronsF, trainingTypeF, airSupportF, q]);

  const isHeli = type === 'helicopter';

  return (
    <div className="pb-6">
      <Header title={isHeli ? 'אימוני מסוקים' : 'אימוני כוחות'} onBack={onBack} tone={isHeli ? 'heli' : 'ground'} />
      <div className="px-4 pt-4 sticky top-[57px] z-10 bg-slate-50 pb-3">
        <div className="relative">
          <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש חופשי..." className={inputCls + " pr-10"} />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button onClick={() => setShowFilters(s => !s)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-600">
            <Filter size={15} /> סינון {showFilters ? <ChevronDown size={15} /> : <ChevronLeft size={15} />}
          </button>
          <div className="flex bg-slate-100 rounded-lg p-0.5">
            <button onClick={() => setView('gantt')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1 ${view === 'gantt' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
              <CalendarDays size={13} /> גאנט
            </button>
            <button onClick={() => setView('list')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold ${view === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
              רשימה
            </button>
          </div>
        </div>
        {showFilters && (
          <div className="mt-2 bg-white p-3 rounded-xl border border-slate-200">
            {isHeli && (
              <div className="mb-3">
                <FieldLabel>טייסות (ניתן לבחור כמה)</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  {SQUADRONS.map(s => {
                    const on = squadronsF.includes(s.number);
                    return (
                      <button key={s.number} type="button" onClick={() => toggleSquadron(s.number)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${on ? 'bg-slate-900 text-amber-300 border-slate-900' : 'bg-white text-slate-600 border-slate-300'}`}>
                        {on ? '✓ ' : ''}טייסת {s.number}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>מרחב</FieldLabel>
                <select value={spaceF} onChange={e => { setSpaceF(e.target.value); setAreaF('all'); }} className={inputCls}>
                  <option value="all">הכל</option>
                  {SPACE_NAMES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>אזור</FieldLabel>
                <select value={areaF} onChange={e => setAreaF(e.target.value)} className={inputCls}>
                  <option value="all">הכל</option>
                  {areaOptions.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>סטטוס תיאום</FieldLabel>
                <select value={coordStateF} onChange={e => setCoordStateF(e.target.value)} className={inputCls}>
                  <option value="all">הכל</option>
                  {Object.entries(COORD_STATE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>סטטוס פרסום</FieldLabel>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={inputCls}>
                  <option value="all">הכל</option>
                  {Object.entries(POSTING_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <FieldLabel>מתאריך</FieldLabel>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
              </div>
              {!isHeli && (
                <div>
                  <FieldLabel>סוג אימון</FieldLabel>
                  <select value={trainingTypeF} onChange={e => setTrainingTypeF(e.target.value)} className={inputCls}>
                    <option value="all">הכל</option>
                    {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
              {!isHeli && (
                <div>
                  <FieldLabel>סוג סיוע מבוקש</FieldLabel>
                  <select value={airSupportF} onChange={e => setAirSupportF(e.target.value)} className={inputCls}>
                    <option value="all">הכל</option>
                    {AIR_SUPPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {view === 'gantt' ? (
        <div className="px-4">
          <GanttBoard items={list} type={type} go={go} coordRequests={coordRequests} />
        </div>
      ) : (
        <div className="px-4 space-y-3">
          {list.length === 0 ? (
            <EmptyState icon={isHeli ? HeliIcon : Users} title="לא נמצאו פרסומים" subtitle="נסו לשנות את הסינון או פרסמו הזדמנות חדשה" />
          ) : list.map(p => (
            <PostingCard key={p.id} posting={p} coordState={deriveTrainingStatus(p, byPost[p.id] || [])} onClick={() => go('posting', { id: p.id })} />
          ))}
        </div>
      )}

      <div className="px-4 mt-4">
        <button onClick={() => go(isHeli ? 'newHelicopter' : 'newGround')}
          className={`w-full text-white font-bold text-[15px] py-4 rounded-2xl flex items-center justify-center gap-2 shadow-md active:scale-[0.98] transition ${isHeli ? 'bg-sky-600' : ''}`}
          style={isHeli ? undefined : { backgroundColor: '#556b2f' }}>
          <Plus size={20} />
          {isHeli ? 'פתיחת אימון חדש – מיועד לטייסות' : 'פתיחת אימון חדש – מיועד לכוחות'}
        </button>
      </div>
    </div>
  );
}

/* ============================== מודל: פתיחת/הבעת עניין בתיאום ============================== */

function CoordinationModal({ posting, onClose, onSubmit }) {
  const isTargetHeli = posting.type === 'helicopter'; // אם הפרסום הוא מסוק, הפונה הוא כוח קרקעי
  const [squadronNumber, setSquadronNumber] = useState(SQUADRONS[0].number);
  const [brigade, setBrigade] = useState(BRIGADES[0]);
  const [unitName, setUnitName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    // טלפון נדרש רק מכוח קרקעי (isTargetHeli = הפרסום של טייסת ⇐ הפונה הוא כוח).
    // טייס (isTargetHeli=false) אינו מזין טלפון — הוא זה שיוזם קשר בהמשך.
    if (!contactName.trim() || (isTargetHeli && !contactPhone.trim())) {
      setError(isTargetHeli ? 'נא למלא שם איש קשר וטלפון' : 'נא למלא שם איש קשר');
      return;
    }
    if (isTargetHeli && !unitName.trim()) {
      setError('נא להזין שם כוח');
      return;
    }
    onSubmit({
      requestedByType: isTargetHeli ? 'ground_force' : 'helicopter',
      squadronNumber: isTargetHeli ? undefined : squadronNumber,
      brigade: isTargetHeli ? brigade : undefined,
      unitName: isTargetHeli ? unitName.trim() : undefined,
      contactName: contactName.trim(),
      contactPhone: isTargetHeli ? contactPhone.trim() : '',
      message: message.trim(),
    });
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-slate-800">
            {isTargetHeli ? 'פתיחת תיאום מול הטייסת' : 'מעוניין בתיאום'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={20} /></button>
        </div>

        {isTargetHeli ? (
          <div className="mb-3">
            <FieldLabel required>חטיבה</FieldLabel>
            <select value={brigade} onChange={e => setBrigade(e.target.value)} className={inputCls}>
              {BRIGADES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <div className="mt-3">
              <FieldLabel required>שם הכוח / היחידה</FieldLabel>
              <input value={unitName} onChange={e => setUnitName(e.target.value)} placeholder="למשל: פלוגה א׳" className={inputCls} />
            </div>
          </div>
        ) : (
          <div className="mb-3">
            <FieldLabel required>טייסת</FieldLabel>
            <select value={squadronNumber} onChange={e => setSquadronNumber(e.target.value)} className={inputCls}>
              {SQUADRONS.map(s => <option key={s.number} value={s.number}>{s.number} · {SQUADRON_TYPE_LABEL[s.type]}</option>)}
            </select>
          </div>
        )}

        <div className={`grid ${isTargetHeli ? 'grid-cols-2' : 'grid-cols-1'} gap-2 mb-3`}>
          <div>
            <FieldLabel required>איש קשר</FieldLabel>
            <input value={contactName} onChange={e => setContactName(e.target.value)} className={inputCls} />
          </div>
          {isTargetHeli && (
            <div>
              <FieldLabel required>טלפון</FieldLabel>
              <input value={contactPhone} onChange={e => setContactPhone(e.target.value)} type="tel" className={inputCls} />
            </div>
          )}
        </div>

        <div className="mb-4">
          <FieldLabel>הודעה / הערה (לא חובה)</FieldLabel>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} className={inputCls} />
        </div>

        {error && <p className="text-rose-600 text-sm mb-3 flex items-center gap-1.5"><AlertTriangle size={15} />{error}</p>}

        <button onClick={handleSubmit}
          className={`w-full text-white font-bold py-3 rounded-xl active:scale-[0.98] transition ${isTargetHeli ? 'bg-sky-600' : ''}`}
          style={isTargetHeli ? undefined : { backgroundColor: '#556b2f' }}>
          {isTargetHeli ? 'שליחת בקשה' : 'שליחת בקשה ומעבר לוואטסאפ'}
        </button>
      </div>
    </div>
  );
}

/* ============================== מסך פרטי פרסום ============================== */

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-slate-100 last:border-0">
      <Icon size={16} className="text-slate-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-slate-400">{label}</div>
        <div className="text-sm text-slate-700 font-medium break-words">{value}</div>
      </div>
    </div>
  );
}

function PostingDetailScreen({ postingId, postings, coordRequests, onBack, go, actions }) {
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const posting = postings.find(p => p.id === postingId);

  if (!posting) {
    return (
      <div className="pb-6">
        <Header title="פרסום" onBack={onBack} />
        <EmptyState icon={AlertTriangle} title="הפרסום לא נמצא" subtitle="ייתכן שהוא נמחק" />
      </div>
    );
  }

  const isHeli = posting.type === 'helicopter';
  const areas = postingAreas(posting);
  const wins = postingWindows(posting);
  const relatedCoords = coordRequests
    .filter(c => coordPostId(c) === posting.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const derivedState = deriveTrainingStatus(posting, relatedCoords);
  const hasAccepted = relatedCoords.some(c => normalizeRequestStatus(c) === 'accepted');
  const me = useMe();
  const canManage = canManagePostingUI(me, posting); // בעל האימון או מנהל — פעולות ניהול מוסתרות לאחרים (האכיפה בשרת)

  const handleOpenCoordination = (data) => {
    setError('');
    setSuccess('');
    // תרחיש 2 (כוח פרסם, טייסת שולחת בקשה): הטייס יוזם קשר — נפתח וואטסאפ אל הכוח
    // (בתוך מחוות הלחיצה, לפני פעולה אסינכרונית).
    // תרחיש 1 (טייסת פרסמה, כוח שולח בקשה): לא נפתח וואטסאפ — הטייס יוזם קשר בהמשך;
    // מציגים הודעת הצלחה כדי שברור שזו התנהגות מכוונת ולא תקלה.
    if (posting.type === 'ground') {
      const waUrl = buildWhatsAppUrl(posting);
      if (waUrl) window.open(waUrl, '_blank', 'noopener');
    } else {
      setSuccess('בקשת התיאום נשלחה בהצלחה. אם הטייסת תאשר את הבקשה, היא תיצור איתך קשר ב-WhatsApp.');
    }
    actions.createCoordination(posting, data);
    setShowModal(false);
  };

  return (
    <div className="pb-10">
      <Header title={isHeli ? `טייסת ${posting.squadronNumber}` : posting.unitName} onBack={onBack} tone={isHeli ? 'heli' : 'ground'} />

      <div className="px-4 pt-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          {isHeli
            ? <SquadronTag number={posting.squadronNumber} />
            : <GroundTag unitName={posting.unitName} brigade={posting.brigade} />}
          <CoordStateBadge state={derivedState} />
        </div>

        <div className="mb-3"><AreaChips areas={areas} space={postingSpace(posting)} /></div>

        {!isHeli && (posting.trainingType || posting.airSupportType) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {posting.trainingType && <span className="text-xs bg-indigo-50 text-indigo-700 rounded-full px-2.5 py-1 font-bold">סוג אימון: {posting.trainingType}</span>}
            {posting.airSupportType && <span className="text-xs bg-amber-50 text-amber-700 rounded-full px-2.5 py-1 font-bold">סיוע מבוקש: {posting.airSupportType}</span>}
          </div>
        )}

        {isHeli ? (
          <div className="mb-4">
            <h3 className="font-bold text-slate-800 mb-2">חלונות אימון ({wins.length})</h3>
            <WindowsReadOnly windows={wins} />
          </div>
        ) : null}

        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
          {!isHeli && <InfoRow icon={Calendar} label="תאריך אימון" value={fmtDate(posting.date)} />}
          {!isHeli && <InfoRow icon={Clock} label="שעות" value={(posting.startTime || posting.endTime) ? `${posting.startTime || '--:--'}–${posting.endTime || '--:--'}` : ''} />}
          {!isHeli && <InfoRow icon={MapPin} label="תיאור מיקום כללי" value={posting.generalLocationDescription} />}
          {!isHeli && <InfoRow icon={Users} label="תיאור האימון" value={posting.trainingDescription} />}
          <InfoRow icon={Search} label={isHeli ? 'מה הטייסת מחפשת' : 'מה מחפשים מהמסוקים'} value={posting.description} />
          <InfoRow icon={AlertTriangle} label="הערות" value={posting.notes} />
          <InfoRow icon={Phone} label="איש קשר" value={isHeli ? posting.contactName : `${posting.contactName} · ${posting.contactPhone}`} />
        </div>

        {error && (
          <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={16} />{error}
          </div>
        )}

        {success && (
          <div className="mb-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-3 py-2 flex items-start gap-2">
            <Check size={16} className="mt-0.5 shrink-0" />{success}
          </div>
        )}

        {/* יצירת בקשה חדשה — הצד השני מגיש. ריבוי בקשות ממתינות מותר. */}
        <button onClick={() => setShowModal(true)}
          className={`w-full text-white font-bold py-3.5 rounded-2xl mb-4 active:scale-[0.98] transition ${isHeli ? 'bg-sky-600' : ''}`}
          style={isHeli ? undefined : { backgroundColor: '#556b2f' }}>
          {isHeli ? 'פתח תיאום מול הטייסת' : 'טייסת? הצטרפו לאימון הזה'}
        </button>

        <h3 className="font-bold text-slate-800 mb-2">בקשות תיאום ({relatedCoords.length})</h3>
        {relatedCoords.length === 0 ? (
          <p className="text-sm text-slate-400 mb-4">אין עדיין בקשות תיאום לאימון הזה.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {relatedCoords.map(c => {
              const st = normalizeRequestStatus(c);
              // WhatsApp מוצג רק לאחר שהבקשה אושרה (accepted), ורק לבקשת כוח קרקעי.
              const waUrl = (c.requestedByType === 'ground_force' && st === 'accepted')
                ? buildWhatsAppUrl(posting, c) : null;
              return (
                <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      {c.requestedByType === 'helicopter'
                        ? <SquadronTag number={c.squadronNumber} />
                        : <GroundTag unitName={c.unitName} brigade={c.brigade} />}
                      <div className="mt-1.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${REQUEST_STATUS_STYLE[st]}`}>
                          {REQUEST_STATUS_LABEL[st]}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => go('coordination', { id: c.id })} className="text-slate-400 flex items-center gap-1 text-xs font-semibold shrink-0">
                      פרטים <ChevronLeft size={15} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {canManage && st === 'pending' && (
                      <button onClick={() => actions.acceptRequest(c.id)} disabled={hasAccepted}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${hasAccepted ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-emerald-600 text-white active:scale-[0.98]'}`}>
                        אשר בקשה
                      </button>
                    )}
                    {canManage && st === 'pending' && (
                      <button onClick={() => actions.rejectRequest(c.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-rose-300 text-rose-600 active:scale-[0.98]">
                        דחה
                      </button>
                    )}
                    {canManage && waUrl && (
                      <a href={waUrl} target="_blank" rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-white active:scale-[0.98]" style={{ backgroundColor: '#16a34a' }}>
                        WhatsApp לכוח
                      </a>
                    )}
                  </div>
                  {/* סרגל התקדמות התיאום — מוצג רק בבקשה שהתקבלה, ומבוסס על ה-coordinationStatus
                      שלה בלבד. "הוחלט על שת״פ" מסמן את האימון כ"בוצע תיאום" (כחול) דרך הגזירה. */}
                  {canManage && st === 'accepted' && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <div className="text-xs font-bold text-slate-500 mb-2">התקדמות התיאום</div>
                      <ProgressBar
                        currentKey={c.coordinationStatus}
                        editable={true}
                        onStageClick={(stage, i, isDone) => {
                          if (isDone) actions.updateCoordinationStage(c.id, COORD_STAGES[i - 1].key);
                          else actions.updateCoordinationStage(c.id, stage.key);
                        }}
                      />
                      <p className="text-[11px] text-slate-400 mt-2 text-center">לחיצה על שלב מסמנת אותו · "הוחלט על שת״פ" מסמן את האימון כבוצע · לחיצה חוזרת על שלב ירוק מבטלת אותו</p>
                    </div>
                  )}
                  {hasAccepted && st === 'pending' && (
                    <p className="text-[11px] text-slate-400 mt-2">כדי לאשר בקשה זו יש קודם לדחות/לבטל את הבקשה שהתקבלה.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* פעולות אימון (בעל האימון/מנהל בלבד) — ביטול/פתיחה מחדש. */}
        {canManage && (posting.manualStatus === 'cancelled' ? (
          <button onClick={() => actions.setTrainingOverride(posting.id, null)}
            className="w-full bg-white border border-slate-300 text-slate-700 font-bold py-3 rounded-2xl mt-2">
            פתיחה מחדש של האימון
          </button>
        ) : (
          <button onClick={() => actions.setTrainingOverride(posting.id, 'cancelled')}
            className="w-full bg-white border border-rose-300 text-rose-600 font-bold py-3 rounded-2xl mt-2">
            בטל אימון
          </button>
        ))}
      </div>

      {showModal && (
        <CoordinationModal posting={posting} onClose={() => setShowModal(false)} onSubmit={handleOpenCoordination} />
      )}
    </div>
  );
}

/* ============================== מסך פרטי תיאום ============================== */

function CoordinationDetailScreen({ coordId, coordRequests, postings, onBack, go, actions }) {
  const coord = coordRequests.find(c => c.id === coordId);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  if (!coord) {
    return (
      <div className="pb-6">
        <Header title="תיאום" onBack={onBack} />
        <EmptyState icon={AlertTriangle} title="התיאום לא נמצא" subtitle="ייתכן שהוא נמחק" />
      </div>
    );
  }

  const posting = postings.find(p => p.id === coord.postId);
  const isHeliPost = coord.postType === 'helicopter';
  const me = useMe();
  const canManage = canManagePostingUI(me, posting); // בעל האימון/מנהל — עדכון סטטוס ביצוע
  const canCancel = canCancelRequestUI(me, coord);    // שולח הבקשה/מנהל — ביטול הבקשה

  return (
    <div className="pb-10">
      <Header title="פרטי תיאום" onBack={onBack} tone={isHeliPost ? 'heli' : 'ground'} />

      <div className="px-4 pt-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {isHeliPost ? (
              <SquadronTag number={posting?.squadronNumber} />
            ) : (
              <GroundTag unitName={posting?.unitName} brigade={posting?.brigade} />
            )}
            <span className="text-slate-400">⇄</span>
            {coord.requestedByType === 'helicopter' ? (
              <SquadronTag number={coord.squadronNumber} />
            ) : (
              <GroundTag unitName={coord.unitName} brigade={coord.brigade} />
            )}
          </div>
          <InfoRow icon={Calendar} label="תאריך האימון" value={fmtDate(posting?.date)} />
          <InfoRow icon={MapPin} label="אזור" value={posting?.region} />
          <InfoRow icon={Phone} label="איש קשר בבקשה" value={coord.requestedByType === 'ground_force' ? `${coord.contactName} · ${coord.contactPhone}` : coord.contactName} />
          <InfoRow icon={AlertTriangle} label="הודעה" value={coord.message} />
        </div>

        {/* סרגל התקדמות התיאום הועבר לכרטיס הבקשה שהתקבלה במסך הפרסום — כאן מוצג
            רק סטטוס הבקשה, כדי למנוע כפילות. */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">סטטוס הבקשה</h3>
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${REQUEST_STATUS_STYLE[normalizeRequestStatus(coord)]}`}>
            {REQUEST_STATUS_LABEL[normalizeRequestStatus(coord)]}
          </span>
        </div>

        {canManage && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
          <h3 className="font-bold text-slate-800 mb-3">סטטוס ביצוע בפועל</h3>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(EXEC_STATUS).map(([k, v]) => (
              <button key={k}
                onClick={() => {
                  if (k === 'cancelled') { setShowCancel(true); return; }
                  actions.updateExecutionStatus(coord.id, k);
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border ${coord.trainingExecutionStatus === k ? `${v.bg} ${v.text} border-transparent` : 'border-slate-200 text-slate-500'}`}>
                {v.label}
              </button>
            ))}
          </div>
          {coord.trainingExecutionStatus === 'completed' && coord.completedAt && (
            <p className="text-xs text-slate-400 mt-2">בוצע ב-{fmtDateTime(coord.completedAt)}</p>
          )}
          {coord.trainingExecutionStatus === 'cancelled' && coord.cancellationReason && (
            <p className="text-xs text-rose-500 mt-2">סיבת ביטול: {coord.cancellationReason}</p>
          )}
          {showCancel && (
            <div className="mt-3 bg-rose-50 rounded-xl p-3">
              <FieldLabel required>סיבת ביטול</FieldLabel>
              <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} className={inputCls} rows={2} />
              <div className="flex gap-2 mt-2">
                <button onClick={() => { actions.updateExecutionStatus(coord.id, 'cancelled', cancelReason); setShowCancel(false); setCancelReason(''); }}
                  className="flex-1 bg-rose-600 text-white rounded-lg py-2 text-sm font-bold">אישור ביטול</button>
                <button onClick={() => setShowCancel(false)} className="flex-1 bg-white border border-slate-300 rounded-lg py-2 text-sm font-bold">ביטול</button>
              </div>
            </div>
          )}
        </div>
        )}

        {canCancel && ['pending', 'accepted'].includes(normalizeRequestStatus(coord)) && (
          <button
            onClick={() => actions.cancelRequest(coord.id)}
            className="w-full bg-white border border-rose-300 text-rose-600 font-bold py-3 rounded-2xl">
            בטל את בקשת התיאום הזו
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================== טופס יצירת פרסום ============================== */

function NewPostingScreen({ initialType, onBack, actions, go }) {
  const [type, setType] = useState(initialType || 'helicopter');
  const [squadronNumber, setSquadronNumber] = useState(SQUADRONS[0].number);
  const [brigade, setBrigade] = useState(BRIGADES[0]);
  const [unitName, setUnitName] = useState('');
  const [areas, setAreas] = useState([]);
  const [space, setSpace] = useState(SPACE_NAMES[0]);
  const [windows, setWindows] = useState([emptyWindow()]);
  const [trainingType, setTrainingType] = useState('');
  const [airSupportType, setAirSupportType] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [generalLocationDescription, setGeneralLocationDescription] = useState('');
  const [trainingDescription, setTrainingDescription] = useState('');
  const [error, setError] = useState('');

  const isHeli = type === 'helicopter';

  const submit = () => {
    setError('');
    // טלפון נדרש רק בפרסום כוח קרקעי; טייס אינו מזין טלפון.
    if (!contactName.trim() || (!isHeli && !contactPhone.trim())) {
      setError(isHeli ? 'נא למלא שם איש קשר' : 'נא למלא שם איש קשר וטלפון'); return;
    }
    if (areas.length === 0) {
      setError('נא לבחור מרחב ולפחות אזור אחד'); return;
    }
    if (isHeli) {
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        if (!w.date || !w.startTime || !w.endTime) {
          setError(`חלון ${i + 1}: נא למלא תאריך, שעת התחלה ושעת סיום`); return;
        }
        if (w.endTime <= w.startTime) {
          setError(`חלון ${i + 1}: שעת סיום חייבת להיות אחרי שעת התחלה`); return;
        }
      }
    } else {
      if (!unitName.trim()) { setError('נא להזין שם כוח / יחידה'); return; }
      if (!trainingType) { setError('נא לבחור סוג אימון (תרח"ט / תרג"ד / תרפ"ל)'); return; }
      if (!airSupportType) { setError('נא לבחור את סוג הסיוע האווירי המבוקש'); return; }
      if (!date || !startTime || !endTime) { setError('נא למלא תאריך ושעות'); return; }
      if (endTime <= startTime) { setError('שעת סיום חייבת להיות אחרי שעת התחלה'); return; }
    }

    const base = {
      type, space, areas, region: REGION,
      description: description.trim(), notes: notes.trim(),
      contactName: contactName.trim(), contactPhone: isHeli ? '' : contactPhone.trim(),
    };
    const posting = isHeli
      ? { ...base, squadronNumber, windows: windows.map(w => ({ ...w })) }
      : {
          ...base, brigade, unitName: unitName.trim(),
          trainingType, airSupportType,
          date, startTime, endTime,
          generalLocationDescription: generalLocationDescription.trim(),
          trainingDescription: trainingDescription.trim(),
        };
    actions.createPosting(posting, (newId) => go('posting', { id: newId }));
  };

  return (
    <div className="pb-10">
      <Header title="פרסום הזדמנות אימון חדשה" onBack={onBack} tone={isHeli ? 'heli' : 'ground'} />
      <div className="px-4 pt-4">
        <div className="flex gap-2 mb-5 bg-slate-100 p-1 rounded-xl">
          <button onClick={() => setType('helicopter')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 ${isHeli ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-500'}`}>
            <HeliIcon size={16} /> טייסת מסוקים
          </button>
          <button onClick={() => setType('ground')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 ${!isHeli ? 'text-white shadow-sm' : 'text-slate-500'}`}
            style={!isHeli ? { backgroundColor: '#556b2f' } : undefined}>
            <Users size={16} /> כוח קרקעי
          </button>
        </div>

        {isHeli ? (
          <div className="mb-4">
            <FieldLabel required>טייסת</FieldLabel>
            <select value={squadronNumber} onChange={e => setSquadronNumber(e.target.value)} className={inputCls}>
              {SQUADRONS.map(s => <option key={s.number} value={s.number}>{s.number} · {SQUADRON_TYPE_LABEL[s.type]}</option>)}
            </select>
          </div>
        ) : (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div>
              <FieldLabel required>חטיבה</FieldLabel>
              <select value={brigade} onChange={e => setBrigade(e.target.value)} className={inputCls}>
                {BRIGADES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel required>שם הכוח / היחידה</FieldLabel>
              <input value={unitName} onChange={e => setUnitName(e.target.value)} className={inputCls} placeholder="למשל: פלוגה א׳" />
            </div>
          </div>
        )}

        {!isHeli && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div>
              <FieldLabel required>סוג האימון</FieldLabel>
              <select value={trainingType} onChange={e => setTrainingType(e.target.value)} className={inputCls}>
                <option value="">בחרו...</option>
                {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel required>סוג הסיוע האווירי המבוקש</FieldLabel>
              <select value={airSupportType} onChange={e => setAirSupportType(e.target.value)} className={inputCls}>
                <option value="">בחרו...</option>
                {AIR_SUPPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="mb-4">
          <FieldLabel required>{isHeli ? 'מרחב ואזורים בהם הטייסת זמינה' : 'מרחב ואזור האימון'}</FieldLabel>
          <SpaceAreaSelect space={space} onSpaceChange={setSpace} areas={areas} onAreasChange={setAreas} />
        </div>

        {isHeli ? (
          <div className="mb-4">
            <FieldLabel required>חלונות אימון</FieldLabel>
            <TrainingWindowEditor windows={windows} onChange={setWindows} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-4">
              <div>
                <FieldLabel required>תאריך</FieldLabel>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel required>שעת התחלה</FieldLabel>
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={inputCls} />
              </div>
              <div>
                <FieldLabel required>שעת סיום</FieldLabel>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="mb-4">
              <FieldLabel>תיאור מיקום כללי</FieldLabel>
              <input value={generalLocationDescription} onChange={e => setGeneralLocationDescription(e.target.value)} className={inputCls} />
            </div>
            <div className="mb-4">
              <FieldLabel>תיאור האימון / מה האימון כולל</FieldLabel>
              <textarea value={trainingDescription} onChange={e => setTrainingDescription(e.target.value)} rows={2} className={inputCls} />
            </div>
          </>
        )}

        <div className="mb-4">
          <FieldLabel>{isHeli ? 'מה הטייסת מחפשת באימון' : 'מה מחפשים מהמסוקים'}</FieldLabel>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputCls} />
        </div>

        <div className="mb-4">
          <FieldLabel>הערות</FieldLabel>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} />
        </div>

        <div className={`grid ${isHeli ? 'grid-cols-1' : 'grid-cols-2'} gap-2 mb-6`}>
          <div>
            <FieldLabel required>איש קשר</FieldLabel>
            <input value={contactName} onChange={e => setContactName(e.target.value)} className={inputCls} />
          </div>
          {!isHeli && (
            <div>
              <FieldLabel required>טלפון</FieldLabel>
              <input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} className={inputCls} />
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl px-3 py-2 flex items-center gap-2">
            <AlertTriangle size={16} />{error}
          </div>
        )}

        <button onClick={submit}
          className={`w-full text-white font-bold py-3.5 rounded-2xl active:scale-[0.98] transition ${isHeli ? 'bg-sky-600' : ''}`}
          style={isHeli ? undefined : { backgroundColor: '#556b2f' }}>
          פרסם הזדמנות אימון
        </button>
      </div>
    </div>
  );
}

/* ============================== תצוגת גאנט — לוח שבועי ============================== */

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function weekStart(d) { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; } // ראשון
function toISO(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${dd}`; }

const CAL_RANGE_OPTIONS = [
  { key: 'week', label: 'שבוע' },
  { key: '2w', label: 'שבועיים' },
  { key: '3w', label: 'שלושה שבועות' },
  { key: 'month', label: 'חודש' },
];

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function useCalendarRange() {
  const [rangeKey, setRangeKey] = useState('2w');
  const [monthPick, setMonthPick] = useState(currentMonthValue());

  const today = startOfDay(new Date());
  let firstWeek, numWeeks, pickedMonth = null;

  if (rangeKey === 'week') { firstWeek = weekStart(today); numWeeks = 1; }
  else if (rangeKey === '2w') { firstWeek = weekStart(today); numWeeks = 2; }
  else if (rangeKey === '3w') { firstWeek = weekStart(today); numWeeks = 3; }
  else {
    const [y, m] = monthPick.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    firstWeek = weekStart(first);
    numWeeks = Math.ceil((Math.round((startOfDay(last) - firstWeek) / 86400000) + 1) / 7);
    pickedMonth = monthPick;
  }

  const weeks = [];
  for (let wI = 0; wI < numWeeks; wI++) {
    const row = [];
    for (let dI = 0; dI < 7; dI++) row.push(addDays(firstWeek, wI * 7 + dI));
    weeks.push(row);
  }
  const todayISO = toISO(today);

  return { rangeKey, setRangeKey, monthPick, setMonthPick, weeks, todayISO, pickedMonth };
}

function CalendarRangeControls({ tr }) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {CAL_RANGE_OPTIONS.map(o => (
          <button key={o.key} onClick={() => tr.setRangeKey(o.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${tr.rangeKey === o.key ? 'bg-slate-900 text-amber-300 border-slate-900' : 'bg-white text-slate-600 border-slate-300'}`}>
            {o.label}
          </button>
        ))}
      </div>
      {tr.rangeKey === 'month' && (
        <div className="mb-3 bg-white p-3 rounded-xl border border-slate-200">
          <FieldLabel required>בחרו חודש</FieldLabel>
          <input type="month" value={tr.monthPick} onChange={e => e.target.value && tr.setMonthPick(e.target.value)} className={inputCls} />
        </div>
      )}
    </>
  );
}

function GanttLegend() {
  return (
    <div className="flex flex-wrap gap-3 mb-3 text-[11px] text-slate-500">
      {Object.entries(COORD_STATE).map(([k, v]) => (
        <span key={k} className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: v.bar }}></span>{v.label}
        </span>
      ))}
    </div>
  );
}

// בניית אירועים: כל חלון אימון = אירוע ביום שלו
function buildCalendarEvents(items) {
  const byDate = {};
  items.filter(p => p.status !== 'cancelled').forEach(p => {
    postingWindows(p).forEach(w => {
      if (!w.date) return;
      if (!byDate[w.date]) byDate[w.date] = [];
      byDate[w.date].push({ p, w });
    });
  });
  Object.values(byDate).forEach(list => list.sort((a, b) => (a.w.startTime || '').localeCompare(b.w.startTime || '')));
  return byDate;
}

function CalendarEventCard({ p, w, go, coordState }) {
  const isHeli = p.type === 'helicopter';
  const color = COORD_STATE[coordState || postingCoordState(p)].bar;
  const areas = postingAreas(p);
  const areaText = areas.length ? (areas.length > 1 ? areas[0] + '+' : areas[0]) : '';
  return (
    <button onClick={() => go('posting', { id: p.id })}
      className="w-full rounded-md px-0.5 py-1 mb-1 text-center active:opacity-80 flex flex-col items-center"
      style={{ backgroundColor: color }}>
      <div className="text-[8px] text-white/90 leading-tight break-words w-full font-semibold">{postingSpace(p)} / {areaText}</div>
      <div className="text-[9px] font-bold text-white leading-tight break-words w-full">
        {isHeli ? p.squadronNumber : (p.unitName || '')}
      </div>
      <div className="text-[8px] text-white/90 leading-tight break-words w-full">
        {isHeli
          ? (SQUADRON_TYPE_LABEL[squadronType(p.squadronNumber)] || '')
          : (p.brigade ? 'חטיבת ' + p.brigade : '')}
      </div>
      {(w.startTime || w.endTime) && (
        <div className="text-[9px] text-white font-bold leading-tight" dir="ltr">
          {w.startTime || '--:--'}–{w.endTime || '--:--'}
        </div>
      )}
    </button>
  );
}

function CalendarGantt({ items, tr, go, coordRequests }) {
  const byPost = groupCoordsByPost(coordRequests);
  const events = buildCalendarEvents(items);
  const hasAny = Object.keys(events).some(iso =>
    tr.weeks.some(week => week.some(d => toISO(d) === iso))
  );
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* כותרת ימי שבוע */}
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map(d => (
          <div key={d} className="text-center py-1.5 text-[10px] font-bold text-slate-500">{d}</div>
        ))}
      </div>
      {/* שורת שבוע מתחת לשבוע */}
      {tr.weeks.map((week, wI) => (
        <div key={wI} className="grid grid-cols-7 border-b border-slate-100 last:border-0">
          {week.map((d, dI) => {
            const iso = toISO(d);
            const isToday = iso === tr.todayISO;
            const inPickedMonth = !tr.pickedMonth || iso.slice(0, 7) === tr.pickedMonth;
            const dayEvents = events[iso] || [];
            return (
              <div key={dI}
                className={`min-h-[64px] border-l border-slate-100 last:border-l-0 p-0.5 ${isToday ? 'bg-sky-50' : !inPickedMonth ? 'bg-slate-50/70' : ''}`}>
                <div className={`text-[10px] font-bold text-center mb-0.5 ${isToday ? 'text-sky-700' : inPickedMonth ? 'text-slate-500' : 'text-slate-300'}`}>
                  {d.getDate()}/{d.getMonth() + 1}
                </div>
                {dayEvents.map((ev, i) => (
                  <CalendarEventCard key={ev.p.id + '-' + i} p={ev.p} w={ev.w} go={go} coordState={deriveTrainingStatus(ev.p, byPost[ev.p.id] || [])} />
                ))}
              </div>
            );
          })}
        </div>
      ))}
      {!hasAny && (
        <p className="text-sm text-slate-400 text-center py-4">אין אימונים בטווח הנבחר</p>
      )}
    </div>
  );
}

function GanttBoard({ items, type, go, coordRequests }) {
  const tr = useCalendarRange();
  return (
    <div className="pt-1">
      <CalendarRangeControls tr={tr} />
      <GanttLegend />
      <CalendarGantt items={items} tr={tr} go={go} coordRequests={coordRequests} />
      <p className="text-[11px] text-slate-400 text-center mt-2 mb-2">לחיצה על אימון פותחת את הפרסום המלא</p>
    </div>
  );
}

function TimelineScreen({ postings, coordRequests, go, onBack }) {
  const tr = useCalendarRange();
  const heli = postings.filter(p => p.type === 'helicopter');
  const ground = postings.filter(p => p.type === 'ground');

  return (
    <div className="pb-10">
      <Header title="תצוגת גאנט — ציר זמן אימונים" onBack={onBack} />
      <div className="px-4 pt-4">
        <CalendarRangeControls tr={tr} />
        <GanttLegend />
        <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><HeliIcon size={16} />אימוני מסוקים</h3>
        <div className="mb-5"><CalendarGantt items={heli} tr={tr} go={go} coordRequests={coordRequests} /></div>
        <h3 className="font-bold text-slate-800 mb-2 flex items-center gap-1.5"><Users size={16} />אימוני כוחות</h3>
        <CalendarGantt items={ground} tr={tr} go={go} coordRequests={coordRequests} />
        <p className="text-[11px] text-slate-400 text-center mt-3">לחיצה על אימון פותחת את הפרסום המלא</p>
      </div>
    </div>
  );
}

/* ============================== Analytics/* ============================== Analytics/* ============================== Analytics ============================== */

function csvEscape(v) {
  const s = (v ?? '').toString();
  return `"${s.replace(/"/g, '""')}"`;
}

// הורדת קובץ בדפדפן בלבד — קריאה בלבד, לא נוגעת בנתונים במסד המשותף.
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ייצוא מלא לקובץ CSV (נפתח היטב באקסל) — כולל כל הפרסומים (מסוקים + כוחות קרקע) וכל בקשות התיאום.
function exportFullCsv(postings, coordRequests) {
  const now = new Date();
  const byPost = groupCoordsByPost(coordRequests);
  const lines = [];
  lines.push(csvEscape(`ייצוא נתונים — הופק בתאריך ${fmtDateTime(now)}`));
  lines.push('');

  lines.push(csvEscape('פרסומי אימונים (מסוקים וכוחות קרקע)'));
  const postingHeaders = [
    'מזהה', 'סוג', 'סטטוס', 'מצב תיאום', 'טייסת', 'סוג טייסת', 'חטיבה', 'שם כוח/יחידה',
    'מרחב', 'אזורים', 'חלונות אימון (תאריך ושעות)', 'סוג אימון', 'סוג סיוע מבוקש',
    'תיאור', 'הערות', 'איש קשר', 'טלפון', 'תאריך יצירה', 'עודכן לאחרונה',
  ];
  lines.push(postingHeaders.map(csvEscape).join(','));
  postings.forEach(p => {
    const windows = postingWindows(p)
      .map(w => `${fmtDate(w.date)} ${w.startTime || '--:--'}-${w.endTime || '--:--'}`)
      .join(' | ');
    lines.push([
      p.id, p.type === 'helicopter' ? 'מסוקים' : 'כוח קרקעי',
      POSTING_STATUS[p.status]?.label || p.status || '—',
      COORD_STATE[deriveTrainingStatus(p, byPost[p.id] || [])]?.label || '—',
      p.squadronNumber || '—', p.squadronNumber ? (SQUADRON_TYPE_LABEL[squadronType(p.squadronNumber)] || '—') : '—',
      p.brigade || '—', p.unitName || '—',
      postingSpace(p), postingAreas(p).join(' | ') || '—',
      windows || '—',
      p.trainingType || '—', p.airSupportType || '—',
      p.description || '—', p.notes || '—',
      p.contactName || '—', p.type === 'ground' ? (p.contactPhone || '—') : '—',
      fmtDateTime(p.createdAt), fmtDateTime(p.updatedAt),
    ].map(csvEscape).join(','));
  });

  lines.push('');
  lines.push(csvEscape('בקשות תיאום'));
  const coordHeaders = [
    'מזהה', 'מזהה פרסום', 'סוג פרסום', 'נשלח ע"י', 'טייסת', 'סוג טייסת', 'חטיבה', 'שם כוח/יחידה',
    'מרחב', 'אזורים', 'תאריך אימון', 'סוג אימון', 'סוג סיוע מבוקש',
    'שלב תיאום', 'סטטוס בקשה', 'סטטוס ביצוע', 'הודעה', 'סיבת ביטול',
    'איש קשר', 'טלפון', 'תאריך יצירה', 'תאריך השלמה/ביטול', 'עודכן לאחרונה',
  ];
  lines.push(coordHeaders.map(csvEscape).join(','));
  coordRequests.forEach(r => {
    lines.push([
      r.id, r.postId, r.postType === 'helicopter' ? 'מסוקים' : 'כוח קרקעי',
      r.requestedByType === 'helicopter' ? 'טייסת' : 'כוח קרקעי',
      r.squadronNumber || '—', r.squadronType ? (SQUADRON_TYPE_LABEL[r.squadronType] || '—') : '—',
      r.brigade || '—', r.unitName || '—',
      r.space || '—', (r.areas || []).join(' | ') || '—',
      fmtDate(r.trainingDate), r.trainingType || '—', r.airSupportType || '—',
      COORD_STAGES.find(s => s.key === r.coordinationStatus)?.label || r.coordinationStatus || '—',
      REQUEST_STATUS_LABEL[normalizeRequestStatus(r)] || '—',
      EXEC_STATUS[r.trainingExecutionStatus]?.label || r.trainingExecutionStatus || '—',
      r.message || '—', r.cancellationReason || '—',
      r.contactName || '—', r.requestedByType === 'ground_force' ? (r.contactPhone || '—') : '—',
      fmtDateTime(r.createdAt), fmtDateTime(r.completedAt), fmtDateTime(r.updatedAt),
    ].map(csvEscape).join(','));
  });

  downloadBlob('﻿' + lines.join('\n'), `גיבוי-נתונים-${now.toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8;');
}

// גיבוי מלא ב-JSON — כל השדות כפי שהם נשמרים במסד, בלי אובדן מידע. לקריאה/גיבוי בלבד.
function exportJsonBackup(postings, coordRequests) {
  const now = new Date();
  const backup = {
    exportedAt: now.toISOString(),
    exportedAtLabel: fmtDateTime(now),
    appVersion: APP_VERSION,
    postings,
    coordRequests,
  };
  downloadBlob(JSON.stringify(backup, null, 2), `גיבוי-מלא-${now.toISOString().slice(0, 10)}.json`, 'application/json;charset=utf-8;');
}

function ExportPanel({ postings, coordRequests }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
      <h4 className="font-bold text-slate-800 mb-1 text-sm">גיבוי וייצוא נתונים</h4>
      <p className="text-xs text-slate-500 mb-3">תאריך ושעת ייצוא: {fmtDateTime(now)}</p>
      <div className="space-y-2">
        <button
          onClick={() => exportFullCsv(postings, coordRequests)}
          className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition"
        >
          <Download size={16} /> ייצוא נתונים ל-CSV / Excel ({postings.length} פרסומים, {coordRequests.length} בקשות תיאום)
        </button>
        <button
          onClick={() => exportJsonBackup(postings, coordRequests)}
          className="w-full border-2 border-slate-900 text-slate-900 font-bold py-3 rounded-xl flex items-center justify-center gap-2 active:scale-[0.98] transition"
        >
          <Download size={16} /> גיבוי מלא (JSON) — כל השדות ללא אובדן מידע
        </button>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">הייצוא לקריאה בלבד — לא משנה ולא מוחק נתונים.</p>
    </div>
  );
}

function exportCsv(rows) {
  const headers = ['תאריך אימון', 'סוג פרסום', 'טייסת', 'חטיבה', 'כוח', 'אזורים', 'סוג אימון', 'סוג סיוע מבוקש', 'סטטוס תיאום', 'סטטוס ביצוע', 'איש קשר', 'תאריך יצירה', 'תאריך השלמה/ביטול'];
  const lines = [headers.map(csvEscape).join(',')];
  rows.forEach(r => {
    lines.push([
      fmtDate(r.trainingDate), r.postType === 'helicopter' ? 'פרסום מסוקים' : 'פרסום כוח קרקעי',
      r.squadronNumber || '—', r.brigade || '—', r.unitName || '—',
      (r.areas && r.areas.length ? r.areas.join(' | ') : REGION),
      r.trainingType || '—', r.airSupportType || '—',
      COORD_STAGES.find(s => s.key === r.coordinationStatus)?.label || r.coordinationStatus,
      EXEC_STATUS[r.trainingExecutionStatus]?.label || r.trainingExecutionStatus,
      r.requestedByType === 'ground_force' ? `${r.contactName} / ${r.contactPhone}` : r.contactName, fmtDateTime(r.createdAt),
      fmtDateTime(r.completedAt || (['rejected', 'cancelled'].includes(normalizeRequestStatus(r)) ? r.updatedAt : ''))
    ].map(csvEscape).join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `תיאומים-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function KpiCard({ label, value, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3.5 text-center">
      <div className={`text-2xl font-extrabold ${accent || 'text-slate-800'}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-1">{label}</div>
    </div>
  );
}

function BreakdownTable({ title, rows }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
      <h4 className="font-bold text-slate-800 mb-3 text-sm">{title}</h4>
      {rows.length === 0 ? <p className="text-xs text-slate-400">אין נתונים</p> : (
        <div className="space-y-1.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-slate-600">{k}</span>
              <span className="font-bold text-slate-800 bg-slate-100 rounded-full px-2.5 py-0.5 text-xs">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalyticsScreen({ postings, coordRequests, onBack }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [squadron, setSquadron] = useState('all');
  const [brigadeF, setBrigadeF] = useState('all');
  const [areaF, setAreaF] = useState('all');
  const [trainingTypeF, setTrainingTypeF] = useState('all');
  const [airSupportF, setAirSupportF] = useState('all');
  const [coordStatusF, setCoordStatusF] = useState('all');
  const [execStatusF, setExecStatusF] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    return coordRequests.filter(r => {
      if (dateFrom && (r.trainingDate || '') < dateFrom) return false;
      if (dateTo && (r.trainingDate || '') > dateTo) return false;
      if (squadron !== 'all' && r.squadronNumber !== squadron) return false;
      if (brigadeF !== 'all' && r.brigade !== brigadeF) return false;
      if (areaF !== 'all' && !(r.areas || []).includes(areaF)) return false;
      if (trainingTypeF !== 'all' && r.trainingType !== trainingTypeF) return false;
      if (airSupportF !== 'all' && r.airSupportType !== airSupportF) return false;
      if (coordStatusF !== 'all' && r.coordinationStatus !== coordStatusF) return false;
      if (execStatusF !== 'all' && r.trainingExecutionStatus !== execStatusF) return false;
      return true;
    });
  }, [coordRequests, dateFrom, dateTo, squadron, brigadeF, areaF, trainingTypeF, airSupportF, coordStatusF, execStatusF]);

  const kpis = {
    total: filtered.length,
    planningDone: filtered.filter(r => r.coordinationStatus === 'planning_summary_done').length,
    executed: filtered.filter(r => r.trainingExecutionStatus === 'completed').length,
    open: filtered.filter(r => ['pending', 'accepted'].includes(normalizeRequestStatus(r))).length,
    cancelled: filtered.filter(r => ['rejected', 'cancelled'].includes(normalizeRequestStatus(r))).length,
  };

  const groupCount = (keyFn) => {
    const m = {};
    filtered.forEach(r => { const k = keyFn(r); if (!k) return; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const bySquadron = groupCount(r => r.squadronNumber && `${r.squadronNumber} · ${SQUADRON_TYPE_LABEL[squadronType(r.squadronNumber)]}`);
  const byBrigade = groupCount(r => r.brigade);
  const byUnit = groupCount(r => r.unitName && r.brigade ? `${r.unitName} (${r.brigade})` : null);
  const byTrainingType = groupCount(r => r.trainingType);
  const byAirSupport = groupCount(r => r.airSupportType);
  const byArea = (() => {
    const m = {};
    filtered.forEach(r => (r.areas || []).forEach(a => { m[a] = (m[a] || 0) + 1; }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  })();
  const byMonth = groupCount(r => r.trainingDate ? r.trainingDate.slice(0, 7) : null);
  const monthChartData = byMonth.map(([m, c]) => ({ month: m, count: c })).sort((a, b) => a.month.localeCompare(b.month));

  return (
    <div className="pb-10">
      <Header title="נתונים וסטטיסטיקות" onBack={onBack} />
      <div className="px-4 pt-4">
        <ExportPanel postings={postings} coordRequests={coordRequests} />

        <button onClick={() => setShowFilters(s => !s)} className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-600">
          <Filter size={15} /> פילטרים {showFilters ? <ChevronDown size={15} /> : <ChevronLeft size={15} />}
        </button>
        {showFilters && (
          <div className="bg-white p-3 rounded-xl border border-slate-200 mb-4 grid grid-cols-2 gap-2">
            <div><FieldLabel>מתאריך</FieldLabel><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} /></div>
            <div><FieldLabel>עד תאריך</FieldLabel><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} /></div>
            <div>
              <FieldLabel>טייסת</FieldLabel>
              <select value={squadron} onChange={e => setSquadron(e.target.value)} className={inputCls}>
                <option value="all">הכל</option>
                {SQUADRONS.map(s => <option key={s.number} value={s.number}>{s.number}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>חטיבה (של הכוח)</FieldLabel>
              <select value={brigadeF} onChange={e => setBrigadeF(e.target.value)} className={inputCls}>
                <option value="all">הכל</option>
                {BRIGADES.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>אזור אימון</FieldLabel>
              <select value={areaF} onChange={e => setAreaF(e.target.value)} className={inputCls}>
                <option value="all">הכל</option>
                {ALL_AREAS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>סוג אימון</FieldLabel>
              <select value={trainingTypeF} onChange={e => setTrainingTypeF(e.target.value)} className={inputCls}>
                <option value="all">הכל</option>
                {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>סוג סיוע מבוקש</FieldLabel>
              <select value={airSupportF} onChange={e => setAirSupportF(e.target.value)} className={inputCls}>
                <option value="all">הכל</option>
                {AIR_SUPPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>סטטוס תיאום</FieldLabel>
              <select value={coordStatusF} onChange={e => setCoordStatusF(e.target.value)} className={inputCls}>
                <option value="all">הכל</option>
                {COORD_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>סטטוס ביצוע</FieldLabel>
              <select value={execStatusF} onChange={e => setExecStatusF(e.target.value)} className={inputCls}>
                <option value="all">הכל</option>
                {Object.entries(EXEC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5 mb-5">
          <KpiCard label="סה״כ תיאומים שנפתחו" value={kpis.total} />
          <KpiCard label="הגיעו לסיכום תכנון" value={kpis.planningDone} accent="text-sky-600" />
          <KpiCard label="אימונים שבוצעו" value={kpis.executed} accent="text-emerald-600" />
          <KpiCard label="פעילים / בוטלו" value={`${kpis.open} / ${kpis.cancelled}`} accent="text-amber-600" />
        </div>

        {monthChartData.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
            <h4 className="font-bold text-slate-800 mb-3 text-sm">תיאומים לפי חודש</h4>
            <div style={{ width: '100%', height: 180 }}>
              <ResponsiveContainer>
                <BarChart data={monthChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0284c7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <BreakdownTable title="אימונים לפי טייסת" rows={bySquadron} />
        <BreakdownTable title="אימונים לפי חטיבה" rows={byBrigade} />
        <BreakdownTable title="אימונים לפי כוח" rows={byUnit} />
        <BreakdownTable title="אימונים לפי אזור" rows={byArea} />
        <BreakdownTable title="לפי סוג אימון" rows={byTrainingType} />
        <BreakdownTable title="לפי סוג סיוע מבוקש" rows={byAirSupport} />

        <button onClick={() => exportCsv(filtered)} className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-2xl flex items-center justify-center gap-2 active:scale-[0.98] transition">
          <Download size={18} /> ייצוא בקשות תיאום מסוננות ל-CSV ({filtered.length} שורות)
        </button>
      </div>
    </div>
  );
}

/* ============================== App ראשי ============================== */

const SYNC_INTERVAL_MS = 3000;

export default function App({ me = { userId: null, isAdmin: false } }) {
  const [loading, setLoading] = useState(true);
  const [postings, setPostings] = useState([]);
  const [coordRequests, setCoordRequests] = useState([]);
  const [storageState, setStorageState] = useState('checking'); // 'ok' | 'unavailable' | 'error'
  const [lastError, setLastError] = useState('');
  const [lastSync, setLastSync] = useState(null);
  const [screen, setScreen] = useState('dashboard');
  const [params, setParams] = useState({});
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState('');

  const postingsRef = useRef([]);
  const coordsRef = useRef([]);
  const postingsRevRef = useRef(0);
  const coordsRevRef = useRef(0);
  useEffect(() => { postingsRef.current = postings; }, [postings]);
  useEffect(() => { coordsRef.current = coordRequests; }, [coordRequests]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200); };

  /* ---------- סנכרון מהאחסון המשותף ---------- */

  const refreshFromStorage = useCallback(async () => {
    // אם הקריאה נכשלת, לא נוגעים בנתונים המקומיים הקיימים — עדיף להשאיר
    // את המסך כמו שהוא מאשר להחליף אותו בטעות בנתונים חלקיים/ריקים.
    let remoteP, remoteC;
    try {
      [remoteP, remoteC] = await Promise.all([loadCollection(KEY_POSTINGS), loadCollection(KEY_COORDS)]);
    } catch (e) {
      console.error('[refreshFromStorage] הסנכרון נכשל, הנתונים המקומיים נשארים ללא שינוי:', e);
      return;
    }
    postingsRevRef.current = remoteP.rev;
    coordsRevRef.current = remoteC.rev;
    const mergedP = mergeById(postingsRef.current, remoteP.items);
    const mergedC = mergeById(coordsRef.current, remoteC.items);
    if (JSON.stringify(mergedP) !== JSON.stringify(postingsRef.current)) setPostings(mergedP);
    if (JSON.stringify(mergedC) !== JSON.stringify(coordsRef.current)) setCoordRequests(mergedC);
    setLastSync(new Date());
  }, []);

  useEffect(() => {
    let interval = null;
    (async () => {
      const ping = await storagePing();
      if (!ping.ok) {
        setStorageState('unavailable');
        setLastError(ping.error || '');
        setLoading(false);
        return;
      }
      setStorageState('ok');
      await refreshFromStorage();
      setLoading(false);
      interval = setInterval(refreshFromStorage, SYNC_INTERVAL_MS);
    })();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshFromStorage(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshFromStorage]);

  /* ---------- כתיבה: פקודות ממוקדות מול השרת ---------- */

  // קריאה ל-endpoint ממוקד-פעולה. השרת מבצע את המוטציה על נתונים טריים (כולל
  // בדיקות אינווריאנט/הרשאה עתידיות) ומחזיר את ה-collection המעודכן; הלקוח
  // מאמץ אותו כמקור אמת במקום לשלוח collection שלמה. מיישר מצב אחסון/סנכרון.
  // תשובות: ok / conflict / blocked(reason) / שגיאה — ה-toast הגנרי מוצג כאן,
  // וה-caller מטפל ב-blocked לפי ה-reason.
  const runCommand = async (apiPath, setState, ref, revRef, op, payload) => {
    let res, data;
    try {
      res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, ...payload }),
      });
      data = await res.json().catch(() => ({}));
    } catch (e) {
      setStorageState(s => s === 'unavailable' ? s : 'error');
      setLastError(e?.message || String(e));
      showToast('השמירה נכשלה — בעיית רשת. נסו שוב.');
      return { ok: false, networkError: true };
    }
    if (data.ok) {
      setState(data.value);
      ref.current = data.value;
      revRef.current = data.rev;
      setStorageState(s => s === 'unavailable' ? s : 'ok');
      setLastError('');
      setLastSync(new Date());
    } else {
      setStorageState(s => s === 'unavailable' ? s : 'error');
      setLastError(data.error || '');
      if (data.conflict) {
        showToast('הנתונים השתנו במכשיר אחר בזמן השמירה — הפעולה לא בוצעה. נסו שוב.');
      } else if (!data.blocked) {
        showToast(`שגיאת שמירה: ${data.error || 'שגיאה לא ידועה בשרת'}`);
      }
    }
    return { httpStatus: res.status, ...data };
  };

  const postingCommand = (op, payload) =>
    runCommand(API_PATH.postings, setPostings, postingsRef, postingsRevRef, op, payload);
  const coordCommand = (op, payload) =>
    runCommand(API_PATH[KEY_COORDS], setCoordRequests, coordsRef, coordsRevRef, op, payload);

  /* ---------- ניווט ---------- */

  const go = useCallback((s, p = {}) => {
    setHistory(h => [...h, { screen, params }]);
    setScreen(s); setParams(p);
    window.scrollTo(0, 0);
  }, [screen, params]);

  const goBack = useCallback(() => {
    setHistory(h => {
      if (h.length === 0) { setScreen('dashboard'); setParams({}); return h; }
      const prev = h[h.length - 1];
      setScreen(prev.screen); setParams(prev.params);
      return h.slice(0, -1);
    });
    window.scrollTo(0, 0);
  }, []);

  const goTab = useCallback((s) => { setHistory([]); setScreen(s); setParams({}); window.scrollTo(0, 0); }, []);

  /* ---------- לוגיקה עסקית ---------- */

  const actions = {
    createPosting: async (data, onDone) => {
      // השרת מייצר id/status/timestamps ומבצע את הכתיבה. שולחים רק את שדות הנתונים.
      const r = await postingCommand('create', { data });
      if (!r.ok) return;
      showToast('הפרסום נוצר ונשמר');
      onDone && onDone(r.id);
    },

    // override ידני לסטטוס האימון: 'done' (בוצע) / 'cancelled' (בוטל) / null (חזרה לגזירה).
    setTrainingOverride: async (postingId, manualStatus) => {
      const r = await postingCommand('setTrainingOverride', { id: postingId, manualStatus });
      if (r.blocked) { showToast('הפרסום לא נמצא (ייתכן שנמחק). רעננו ונסו שוב.'); return; }
      if (!r.ok) return;
      showToast(manualStatus === 'done' ? 'האימון סומן כבוצע תיאום'
        : manualStatus === 'cancelled' ? 'האימון סומן כבוטל'
        : 'הסימון בוטל — הסטטוס נגזר מהבקשות');
    },

    createCoordination: async (posting, data) => {
      // הלקוח מחשב את שדות התיאור מהפרסום; השרת מייצר id וקובע את שדות
      // הסטטוס/המבנה (requestStatus='pending' וכו') — לא סומכים על הלקוח לאלה.
      const coordData = {
        postId: posting.id,
        postType: posting.type,
        requestedByType: data.requestedByType,
        squadronNumber: data.squadronNumber || (posting.type === 'helicopter' ? posting.squadronNumber : undefined),
        squadronType: (data.squadronNumber || (posting.type === 'helicopter' ? posting.squadronNumber : null))
          ? squadronType(data.squadronNumber || posting.squadronNumber) : undefined,
        brigade: data.brigade || (posting.type === 'ground' ? posting.brigade : undefined),
        unitName: data.unitName || (posting.type === 'ground' ? posting.unitName : undefined),
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        message: data.message,
        trainingDate: postingDate(posting),
        trainingType: posting.trainingType || null,
        airSupportType: posting.airSupportType || null,
        areas: postingAreas(posting),
        space: postingSpace(posting),
      };
      const r = await coordCommand('create', { data: coordData });
      if (!r.ok) return;
      showToast('בקשת התיאום נשלחה ונשמרה');
    },

    // אישור בקשה — אכיפת accepted-יחיד מתבצעת בצד השרת על נתונים טריים.
    acceptRequest: async (coordId) => {
      const r = await coordCommand('accept', { id: coordId });
      if (r.blocked) {
        if (r.reason === 'accepted_exists') {
          showToast('כבר קיימת בקשה מאושרת לאימון הזה. יש לדחות או לבטל אותה כדי לאשר בקשה אחרת.');
        } else {
          showToast('הבקשה לא נמצאה (ייתכן שנמחקה). רעננו ונסו שוב.');
        }
        return;
      }
      if (!r.ok) return; // conflict/שגיאה — ההודעה כבר הוצגה ב-runCommand
      showToast('הבקשה אושרה');
    },

    rejectRequest: async (coordId) => {
      const r = await coordCommand('reject', { id: coordId });
      if (r.blocked) { showToast('הבקשה לא נמצאה (ייתכן שנמחקה). רעננו ונסו שוב.'); return; }
      if (!r.ok) return;
      showToast('הבקשה נדחתה');
    },

    cancelRequest: async (coordId) => {
      const r = await coordCommand('cancel', { id: coordId });
      if (r.blocked) { showToast('הבקשה לא נמצאה (ייתכן שנמחקה). רעננו ונסו שוב.'); return; }
      if (!r.ok) return;
      showToast('הבקשה בוטלה');
    },

    // מעדכן אך ורק את שלב התיאום המקצועי (coordinationStatus) של הבקשה. מנותק
    // לחלוטין מסטטוס האימון — אינו כותב posting.status / coordState / manualStatus.
    updateCoordinationStage: async (coordId, stageKey) => {
      const r = await coordCommand('setStage', { id: coordId, stageKey });
      if (r.blocked) { showToast('הבקשה לא נמצאה (ייתכן שנמחקה). רעננו ונסו שוב.'); return; }
      if (!r.ok) return;
      showToast('שלב התיאום עודכן');
    },

    updateExecutionStatus: async (coordId, execStatus, cancellationReason) => {
      const r = await coordCommand('setExec', { id: coordId, execStatus, cancellationReason });
      if (r.blocked) { showToast('הבקשה לא נמצאה (ייתכן שנמחקה). רעננו ונסו שוב.'); return; }
      if (!r.ok) return;
      showToast('סטטוס הביצוע עודכן');
    },
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
        <div className="text-center">
          <RefreshCw className="animate-spin text-slate-400 mx-auto mb-3" size={28} />
          <p className="text-sm text-slate-400">טוען נתונים משותפים...</p>
        </div>
      </div>
    );
  }

  let content;
  if (screen === 'dashboard') content = <Dashboard postings={postings} coordRequests={coordRequests} go={go} />;
  else if (screen === 'helicopters') content = <PostingListScreen type="helicopter" postings={postings} coordRequests={coordRequests} go={go} onBack={goBack} />;
  else if (screen === 'ground') content = <PostingListScreen type="ground" postings={postings} coordRequests={coordRequests} go={go} onBack={goBack} />;
  else if (screen === 'posting') content = <PostingDetailScreen postingId={params.id} postings={postings} coordRequests={coordRequests} onBack={goBack} go={go} actions={actions} />;
  else if (screen === 'coordination') content = <CoordinationDetailScreen coordId={params.id} coordRequests={coordRequests} postings={postings} onBack={goBack} go={go} actions={actions} />;
  else if (screen === 'new') content = <NewPostingScreen onBack={goBack} actions={actions} go={go} />;
  else if (screen === 'newHelicopter') content = <NewPostingScreen initialType="helicopter" onBack={goBack} actions={actions} go={go} />;
  else if (screen === 'newGround') content = <NewPostingScreen initialType="ground" onBack={goBack} actions={actions} go={go} />;
  else if (screen === 'timeline') content = <TimelineScreen postings={postings} coordRequests={coordRequests} go={go} onBack={goBack} />;
  else if (screen === 'analytics') content = <AnalyticsScreen postings={postings} coordRequests={coordRequests} onBack={goBack} />;
  else content = <Dashboard postings={postings} coordRequests={coordRequests} go={go} />;

  const bottomTabs = ['dashboard', 'helicopters', 'ground', 'analytics'];

  return (
    <MeContext.Provider value={me}>
    <div dir="rtl" lang="he" className="min-h-screen bg-slate-50 text-slate-900" style={{ fontFamily: "'Heebo', system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto pb-20 min-h-screen bg-slate-50 relative">

        {storageState === 'unavailable' && (
          <div className="bg-amber-500 text-white text-xs font-bold px-4 py-2.5 flex items-start gap-2">
            <AlertTriangle size={15} className="shrink-0 mt-0.5" />
            <span>
              מסד הנתונים המשותף (Vercel KV) לא זמין — הנתונים לא נשמרים לשיתוף.
              יש לוודא שה-KV מחובר לפרויקט ב-Vercel ושמשתני הסביבה שלו מוגדרים.
              {lastError && <> שגיאה: {lastError}</>}
            </span>
          </div>
        )}
        {storageState === 'error' && (
          <div className="bg-rose-500 text-white text-xs font-bold px-4 py-2.5 flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>שגיאת שמירה: {lastError || 'שגיאה לא ידועה בשרת'}</span>
          </div>
        )}

        {content}
        <BottomNav screen={bottomTabs.includes(screen) ? screen : ''} go={goTab} />

        {storageState === 'ok' && lastSync && (
          <div className="fixed bottom-[76px] left-2 z-20">
            <span className="text-[10px] text-slate-400 bg-white/80 rounded-full px-2 py-0.5 border border-slate-200 flex items-center gap-1">
              <RefreshCw size={9} /> {APP_VERSION} · מסונכרן {lastSync.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}

        {toast && (
          <div className="fixed bottom-24 inset-x-0 flex justify-center z-50 px-4">
            <div className="bg-slate-900 text-white text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2">
              <Check size={15} className="text-emerald-400" />{toast}
            </div>
          </div>
        )}
      </div>
    </div>
    </MeContext.Provider>
  );
}
