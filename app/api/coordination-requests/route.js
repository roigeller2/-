import { NextResponse } from 'next/server';
import { auth } from '../../../auth';
import { readCollection, mutateCollectionServer } from '../../../lib/collection';
import { canCreate, canActAsPostingOwner } from '../../../lib/authz';
import {
  COORD_STAGE_KEYS, EXEC_STATUS_KEYS, coordPostId,
  mutatorCreate, mutatorAccept, mutatorSetRequestStatus, mutatorSetStage, mutatorSetExec, mutatorCancelOwned,
} from '../../../lib/coord';
import { notify, NOTIF_TYPES } from '../../../lib/notify';
import { buildRequestNewEvent, buildRequestStatusEvent, emitIfOk } from '../../../lib/coordNotify';

export const dynamic = 'force-dynamic';

const DATA_KEY = 'coordination-requests';
const REV_KEY = 'coordination-requests:rev';
const POSTINGS_KEY = 'postings';
const POSTINGS_REV = 'postings:rev';

const uid = () =>
  (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);

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

// פעולות בעל-האימון (accept/reject/setStage/setExec): הבעלות נקבעת לפי בעל
// *הפרסום* שהבקשה מפנה אליו. postId ו-ownerId הם שדות בלתי-משתנים, לכן בדיקה
// מול קריאה טרייה שלהם בטוחה (אין TOCTOU על בעלות). מחזיר null אם מותר, או
// תשובת שגיאה (404/403) אם לא.
async function checkPostingOwnerForCoord(id, access, userId) {
  const { value: coords } = await readCollection(DATA_KEY, REV_KEY);
  const coord = coords.find(c => c.id === id);
  if (!coord) return NextResponse.json({ ok: false, blocked: true, reason: 'not_found' }, { status: 404 });
  const { value: postings } = await readCollection(POSTINGS_KEY, POSTINGS_REV);
  const posting = postings.find(p => p.id === coordPostId(coord));
  if (!canActAsPostingOwner(access, userId, posting)) return forbidden();
  return null;
}

export async function GET() {
  const session = await auth();
  if (!session?.access?.canUse) return forbidden();
  try {
    const { value, rev } = await readCollection(DATA_KEY, REV_KEY);
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
      const now = new Date().toISOString();
      // requesterId מה-session, לא מהלקוח. סטטוס נכפה ל-pending.
      const coord = {
        ...data,
        id: uid(),
        requesterId: userId,
        requesterName: session.user?.name || null,
        coordinationStatus: 'initial_coordination_done',
        requestStatus: 'pending',
        trainingExecutionStatus: 'pending',
        completedAt: null,
        cancellationReason: null,
        createdAt: now,
        updatedAt: now,
      };
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorCreate(coord));
      // התראה רק אחרי הצלחת ה-CAS. הנתונים נלקחים מהבקשה שנוצרה (coord); רק
      // ownerId מגיע מהפרסום — שדה בלתי-משתנה, לכן קריאה אחת בטוחה (ללא TOCTOU).
      await emitIfOk(result, async () => {
        const { value: postings } = await readCollection(POSTINGS_KEY, POSTINGS_REV);
        const posting = postings.find(p => p.id === coordPostId(coord));
        await notify(buildRequestNewEvent(coord, posting, userId));
      });
      return respond(result, { id: coord.id });
    }

    const id = body?.id;
    if (typeof id !== 'string') return NextResponse.json({ ok: false, error: 'מזהה בקשה חסר' }, { status: 400 });

    if (op === 'cancel') {
      // ביטול — בעלות requesterId, נאכפת בתוך המוטטור על נתונים טריים.
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorCancelOwned(id, access, userId));
      return respond(result);
    }

    // מכאן — פעולות בעל-האימון בלבד.
    if (op === 'accept') {
      const deny = await checkPostingOwnerForCoord(id, access, userId);
      if (deny) return deny;
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorAccept(id));
      // נמען = יוצר הבקשה, מתוך הבקשה הטרייה שהוחזרה מהמוטציה (result.value).
      await emitIfOk(result, async (fresh) => {
        const coord = (fresh || []).find(c => c.id === id);
        if (coord) await notify(buildRequestStatusEvent(NOTIF_TYPES.REQUEST_ACCEPTED, coord, userId));
      });
      return respond(result);
    }

    if (op === 'reject') {
      const deny = await checkPostingOwnerForCoord(id, access, userId);
      if (deny) return deny;
      const result = await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorSetRequestStatus(id, 'rejected'));
      await emitIfOk(result, async (fresh) => {
        const coord = (fresh || []).find(c => c.id === id);
        if (coord) await notify(buildRequestStatusEvent(NOTIF_TYPES.REQUEST_REJECTED, coord, userId));
      });
      return respond(result);
    }

    if (op === 'setStage') {
      const stageKey = body?.stageKey;
      if (!COORD_STAGE_KEYS.includes(stageKey)) return NextResponse.json({ ok: false, error: 'שלב תיאום לא תקין' }, { status: 400 });
      const deny = await checkPostingOwnerForCoord(id, access, userId);
      if (deny) return deny;
      return respond(await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorSetStage(id, stageKey)));
    }

    if (op === 'setExec') {
      const execStatus = body?.execStatus;
      const cancellationReason = body?.cancellationReason;
      if (!EXEC_STATUS_KEYS.includes(execStatus)) return NextResponse.json({ ok: false, error: 'סטטוס ביצוע לא תקין' }, { status: 400 });
      const deny = await checkPostingOwnerForCoord(id, access, userId);
      if (deny) return deny;
      return respond(await mutateCollectionServer(DATA_KEY, REV_KEY, mutatorSetExec(id, execStatus, cancellationReason)));
    }

    return NextResponse.json({ ok: false, error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (e) {
    console.error('[api/coordination-requests] POST failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
