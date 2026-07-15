import { NextResponse } from 'next/server';
import { readCollection, casWrite } from '../../../lib/collection';

export const dynamic = 'force-dynamic';

const DATA_KEY = 'coordination-requests';
const REV_KEY = 'coordination-requests:rev';

export async function GET() {
  try {
    const { value, rev } = await readCollection(DATA_KEY, REV_KEY);
    return NextResponse.json({ value, rev });
  } catch (e) {
    console.error('[api/coordination-requests] GET failed:', e);
    return NextResponse.json({ value: [], error: String(e?.message || e) }, { status: 503 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();

    // זיהוי לקוח מגרסה ישנה: הגרסה הישנה שולחת מערך גולמי במקום { items, expectedRev }.
    // דוחים אותו עם הודעת רענון ברורה (אסור לאפשר כתיבה שעוקפת את ה-OCC).
    if (Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: 'גרסת האתר התעדכנה — רעננו את הדף (F5) כדי להמשיך.' },
        { status: 400 }
      );
    }

    const items = body?.items;
    const expectedRev = body?.expectedRev;
    if (!Array.isArray(items) || typeof expectedRev !== 'number') {
      return NextResponse.json(
        { ok: false, error: 'בקשה לא תקינה: נדרשים items (מערך) ו-expectedRev (מספר)' },
        { status: 400 }
      );
    }

    const w = await casWrite(DATA_KEY, REV_KEY, expectedRev, items);
    if (w.status === 'error') {
      console.error('[api/coordination-requests] PUT: CAS error:', w.message);
      return NextResponse.json({ ok: false, error: w.message }, { status: 500 });
    }
    if (w.status === 'conflict') {
      return NextResponse.json(
        {
          ok: false,
          conflict: true,
          rev: w.rev,
          value: w.value,
          error: 'הנתונים השתנו במכשיר אחר מאז הקריאה האחרונה',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, rev: w.rev });
  } catch (e) {
    console.error('[api/coordination-requests] PUT failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
