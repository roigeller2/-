import { NextResponse } from 'next/server';
import { readCollection, mutateCollectionServer } from '../../../lib/collection';

export const dynamic = 'force-dynamic';

const DATA_KEY = 'postings';
const REV_KEY = 'postings:rev';

const uid = () =>
  (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);

// ממיר תוצאת mutateCollectionServer לתשובת HTTP אחידה.
function respond(result, extra = {}) {
  if (result.status === 'ok') {
    return NextResponse.json({ ok: true, value: result.value, rev: result.rev, ...extra });
  }
  if (result.status === 'blocked') {
    return NextResponse.json({ ok: false, blocked: true, reason: result.reason }, { status: result.httpStatus });
  }
  if (result.status === 'conflict') {
    return NextResponse.json(
      { ok: false, conflict: true, error: 'הנתונים השתנו במכשיר אחר. נסו שוב.' },
      { status: 409 }
    );
  }
  return NextResponse.json({ ok: false, error: result.message || 'שגיאת שרת' }, { status: 500 });
}

export async function GET() {
  try {
    const { value, rev } = await readCollection(DATA_KEY, REV_KEY);
    return NextResponse.json({ value, rev });
  } catch (e) {
    console.error('[api/postings] GET failed:', e);
    return NextResponse.json({ value: [], error: String(e?.message || e) }, { status: 503 });
  }
}

// endpoints ממוקדי-פעולה. השרת מבצע את המוטציה על נתונים טריים (לא מקבל
// collection שלמה מהלקוח), כך שבהמשך ניתן יהיה לאכוף בעלות פר-רשומה בבטחה.
export async function POST(request) {
  try {
    const body = await request.json();
    const op = body?.op;

    if (op === 'create') {
      const data = body?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return NextResponse.json({ ok: false, error: 'נתוני פרסום לא תקינים' }, { status: 400 });
      }
      // השרת שולט בשדות המבניים (id/status/timestamps) — לא סומכים על הלקוח.
      const now = new Date().toISOString();
      const posting = { ...data, id: uid(), status: 'available', createdAt: now, updatedAt: now };
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, list => [...list, posting]);
      return respond(result, { id: posting.id });
    }

    if (op === 'setTrainingOverride') {
      const id = body?.id;
      const manualStatus = body?.manualStatus;
      if (typeof id !== 'string') {
        return NextResponse.json({ ok: false, error: 'מזהה פרסום חסר' }, { status: 400 });
      }
      if (!(manualStatus === 'done' || manualStatus === 'cancelled' || manualStatus === null)) {
        return NextResponse.json({ ok: false, error: 'ערך override לא תקין' }, { status: 400 });
      }
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, list => {
        const target = list.find(p => p.id === id);
        if (!target) return { block: true, reason: 'not_found', httpStatus: 404 };
        return list.map(p => p.id === id
          ? { ...p, manualStatus: manualStatus || undefined, updatedAt: new Date().toISOString() }
          : p);
      });
      return respond(result);
    }

    return NextResponse.json({ ok: false, error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (e) {
    console.error('[api/postings] POST failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
