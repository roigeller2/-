import { NextResponse } from 'next/server';
import { auth } from '../../../auth';
import { canCreate } from '../../../lib/authz';
import { COORD_STAGE_KEYS, EXEC_STATUS_KEYS } from '../../../lib/coord';
import {
  listCoordRequests, createCoord, cancelCoord, acceptCoord, rejectCoord, setStage, setExec,
} from '../../../lib/coordRepo';
import { notify, NOTIF_TYPES } from '../../../lib/notify';
import { buildRequestNewEvent, buildRequestStatusEvent, emitIfOk } from '../../../lib/coordNotify';

export const dynamic = 'force-dynamic';

const forbidden = () => NextResponse.json({ ok: false, error: 'אין הרשאה' }, { status: 403 });

function respond(result, extra = {}) {
  if (result.status === 'ok') return NextResponse.json({ ok: true, value: result.value, rev: result.rev, ...extra });
  if (result.status === 'blocked') {
    return NextResponse.json({ ok: false, blocked: true, reason: result.reason }, { status: result.httpStatus });
  }
  if (result.status === 'conflict') {
    return NextResponse.json({ ok: false, conflict: true, error: 'הנתונים השתנו במכשיר אחר. נסו שוב.' }, { status: 409 });
  }
  return NextResponse.json({ ok: false, error: result.message || 'שגיאת שרת' }, { status: 500 });
}

export async function GET() {
  const session = await auth();
  if (!session?.access?.canUse) return forbidden();
  try {
    const { value, rev } = await listCoordRequests();
    return NextResponse.json({ value, rev });
  } catch (e) {
    console.error('[api/coordination-requests] GET failed:', e);
    return NextResponse.json({ value: [], error: String(e?.message || e) }, { status: 503 });
  }
}

export async function POST(request) {
  const session = await auth();
  const access = session?.access;
  const userId = session?.userId;
  if (!access?.canUse) return forbidden();

  try {
    const body = await request.json();
    const op = body?.op;

    if (op === 'create') {
      if (!canCreate(access)) return forbidden();
      const data = body?.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return NextResponse.json({ ok: false, error: 'נתוני בקשה לא תקינים' }, { status: 400 });
      }
      // requesterId מה-session, לא מהלקוח. סטטוסים נכפים ב-repo.
      const result = await createCoord({ data, requesterId: userId, requesterName: session.user?.name || null });
      // התראה רק אחרי הצלחה; נמען = בעל הפרסום (postingOwnerId מה-repo). best-effort.
      await emitIfOk(result, async (fresh) => {
        const coord = (fresh || []).find((c) => c.id === result.id);
        if (coord) await notify(buildRequestNewEvent(coord, { ownerId: result.postingOwnerId }, userId));
      });
      return respond(result, { id: result.id });
    }

    const id = body?.id;
    if (typeof id !== 'string') return NextResponse.json({ ok: false, error: 'מזהה בקשה חסר' }, { status: 400 });

    if (op === 'cancel') {
      const result = await cancelCoord(id, access, userId);
      return respond(result);
    }

    if (op === 'accept') {
      const result = await acceptCoord(id, access, userId);
      await emitIfOk(result, async (fresh) => {
        const coord = (fresh || []).find((c) => c.id === id);
        if (coord) await notify(buildRequestStatusEvent(NOTIF_TYPES.REQUEST_ACCEPTED, coord, userId));
      });
      return respond(result);
    }

    if (op === 'reject') {
      const result = await rejectCoord(id, access, userId);
      await emitIfOk(result, async (fresh) => {
        const coord = (fresh || []).find((c) => c.id === id);
        if (coord) await notify(buildRequestStatusEvent(NOTIF_TYPES.REQUEST_REJECTED, coord, userId));
      });
      return respond(result);
    }

    if (op === 'setStage') {
      const stageKey = body?.stageKey;
      if (!COORD_STAGE_KEYS.includes(stageKey)) return NextResponse.json({ ok: false, error: 'שלב תיאום לא תקין' }, { status: 400 });
      return respond(await setStage(id, stageKey, access, userId));
    }

    if (op === 'setExec') {
      const execStatus = body?.execStatus;
      const cancellationReason = body?.cancellationReason;
      if (!EXEC_STATUS_KEYS.includes(execStatus)) return NextResponse.json({ ok: false, error: 'סטטוס ביצוע לא תקין' }, { status: 400 });
      return respond(await setExec(id, execStatus, cancellationReason, access, userId));
    }

    return NextResponse.json({ ok: false, error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (e) {
    console.error('[api/coordination-requests] POST failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
