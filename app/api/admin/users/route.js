import { NextResponse } from 'next/server';
import { auth } from '../../../../auth';
import { listProfiles, setApprovalStatus } from '../../../../lib/users';

export const dynamic = 'force-dynamic';

const forbidden = () => NextResponse.json({ ok: false, error: 'אין הרשאה' }, { status: 403 });

export async function GET() {
  const session = await auth();
  if (!session?.access?.isAdmin) return forbidden();
  try {
    const users = await listProfiles();
    return NextResponse.json({ ok: true, users });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 503 });
  }
}

export async function POST(request) {
  const session = await auth();
  if (!session?.access?.isAdmin) return forbidden();
  try {
    const body = await request.json();
    if (body?.op !== 'setStatus') return NextResponse.json({ ok: false, error: 'פעולה לא מוכרת' }, { status: 400 });
    const { userId, status } = body;
    if (typeof userId !== 'string' || typeof status !== 'string') {
      return NextResponse.json({ ok: false, error: 'פרמטרים חסרים' }, { status: 400 });
    }
    const result = await setApprovalStatus(userId, status, session.userId);
    if (!result.ok) {
      const code = result.reason === 'not_found' ? 404 : 400;
      return NextResponse.json({ ok: false, error: result.reason, from: result.from }, { status: code });
    }
    const users = await listProfiles();
    return NextResponse.json({ ok: true, profile: result.profile, users });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
