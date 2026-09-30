import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';

export const dynamic = 'force-dynamic';

// route זמני לבדיקת runtime של Preview בלבד — מאמת ש-DATABASE_URL נטען ושלקוח
// Postgres (lib/db.js) מתחבר ל-Supabase ושהטבלאות קיימות. read-only בלבד: אינו
// קורא נתוני משתמשים/אפליקציה, אינו חושף credentials או את DATABASE_URL.
// יימחק מיד אחרי שהבדיקה עוברת, לפני חיווט ה-adapter (שלב 2).
export async function GET() {
  try {
    const ping = await query('select 1 as ok');
    const tables = await query(
      `select table_name from information_schema.tables
       where table_schema = 'public'
       order by table_name`
    );
    return NextResponse.json({
      ok: true,
      databaseUrlLoaded: !!process.env.DATABASE_URL,
      ping: ping.rows[0],
      tables: tables.rows.map((r) => r.table_name),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        databaseUrlLoaded: !!process.env.DATABASE_URL,
        error: String(e?.message || e),
        code: e?.code || null,
      },
      { status: 500 }
    );
  }
}
