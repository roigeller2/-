import { NextResponse } from 'next/server';
import { readCollection, mutateCollectionServer } from '../../../lib/collection';
import {
  COORD_STAGE_KEYS, EXEC_STATUS_KEYS,
  mutatorCreate, mutatorAccept, mutatorSetRequestStatus, mutatorSetStage, mutatorSetExec,
} from '../../../lib/coord';

export const dynamic = 'force-dynamic';

const DATA_KEY = 'coordination-requests';
const REV_KEY = 'coordination-requests:rev';

const uid = () =>
  (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);

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
    console.error('[api/coordination-requests] GET failed:', e);
    return NextResponse.json({ value: [], error: String(e?.message || e) }, { status: 503 });
  }
}

// endpoints ממוקדי-פעולה. השרת מבצע את המוטציה על נתונים טריים ושולט בשדות
// המבניים/הסטטוס — כך שבהמשך ניתן לאכוף בעלות פר-רשומה בבטחה. לוגיקת המוטטורים
// (כולל אכיפת accepted-היחיד) יושבת ב-lib/coord ונבדקת שם ישירות.
export async function POST(request) {
  try {
    const body = await request.json();
    const op = body?.op;

    if (op === 'create') {
      const data = body?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return NextResponse.json({ ok: false, error: 'נתוני בקשה לא תקינים' }, { status: 400 });
      }
      const now = new Date().toISOString();
      // השרת שולט בשדות המבניים והסטטוס — בקשה חדשה נכנסת תמיד כ-pending.
      const coord = {
        ...data,
        id: uid(),
        coordinationStatus: 'initial_coordination_done',
        requestStatus: 'pending',
        trainingExecutionStatus: 'pending',
        completedAt: null,
        cancellationReason: null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorCreate(coord));
      return respond(result, { id: coord.id });
    }

    // שאר הפעולות פועלות על בקשה קיימת לפי id.
    const id = body?.id;
    if (typeof id !== 'string') {
      return NextResponse.json({ ok: false, error: 'מזהה בקשה חסר' }, { status: 400 });
    }

    if (op === 'accept') {
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorAccept(id));
      return respond(result);
    }

    if (op === 'reject' || op === 'cancel') {
      const newStatus = op === 'reject' ? 'rejected' : 'cancelled';
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorSetRequestStatus(id, newStatus));
      return respond(result);
    }

    if (op === 'setStage') {
      const stageKey = body?.stageKey;
      if (!COORD_STAGE_KEYS.includes(stageKey)) {
        return NextResponse.json({ ok: false, error: 'שלב תיאום לא תקין' }, { status: 400 });
      }
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorSetStage(id, stageKey));
      return respond(result);
    }

    if (op === 'setExec') {
      const execStatus = body?.execStatus;
      const cancellationReason = body?.cancellationReason;
      if (!EXEC_STATUS_KEYS.includes(execStatus)) {
        return NextResponse.json({ ok: false, error: 'סטטוס ביצוע לא תקין' }, { status: 400 });
      }
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorSetExec(id, execStatus, cancellationReason));
      return respond(result);
    }

    return NextResponse.json({ ok: false, error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (e) {
    console.error('[api/coordination-requests] POST failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
