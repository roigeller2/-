import { NextResponse } from 'next/server';
import { auth } from '../../../auth';
import { canCreate } from '../../../lib/authz';
import { listPostings, createPosting, setTrainingOverride } from '../../../lib/postingsRepo';

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
    const { value, rev } = await listPostings();
    return NextResponse.json({ value, rev });
  } catch (e) {
    console.error('[api/postings] GET failed:', e);
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
        return NextResponse.json({ ok: false, error: 'נתוני פרסום לא תקינים' }, { status: 400 });
      }
      // השרת שולט ב-id/status/timestamps *ובבעלות* — ownerId נלקח מה-session, לא מהלקוח.
      const result = await createPosting({ data, ownerId: userId, ownerName: session.user?.name || null });
      return respond(result, { id: result.id });
    }

    if (op === 'setTrainingOverride') {
      const id = body?.id;
      const manualStatus = body?.manualStatus;
      if (typeof id !== 'string') return NextResponse.json({ ok: false, error: 'מזהה פרסום חסר' }, { status: 400 });
      if (!(manualStatus === 'done' || manualStatus === 'cancelled' || manualStatus === null)) {
        return NextResponse.json({ ok: false, error: 'ערך override לא תקין' }, { status: 400 });
      }
      // אכיפת הבעלות בתוך ה-repo על השורה הנעולה (SELECT ... FOR UPDATE).
      const result = await setTrainingOverride(id, manualStatus, access, userId);
      return respond(result);
    }

    return NextResponse.json({ ok: false, error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (e) {
    console.error('[api/postings] POST failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
