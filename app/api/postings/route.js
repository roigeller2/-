import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DATA_KEY = 'postings';
const REV_KEY = 'postings:rev';

// לקוח Upstash ישיר, מאותחל במפורש עם cache: 'no-store' ו-enableAutoPipelining: false
// (התיקון לבאג ה-null-flicker). אותו מפתח ('postings') ואותו פורמט אחסון.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
  cache: 'no-store',
  enableAutoPipelining: false,
});

// Optimistic Concurrency Control: סקריפט Lua אטומי שבודק שה-revision הנוכחי
// תואם ל-expectedRev, ורק אם כן — כותב את הנתונים ומעלה את ה-revision. הכל
// בפעולה אחת אטומית בצד Redis, כך שאין חלון שבו שתי כתיבות מתחרות דורסות זו את זו.
// מפתח rev חסר נחשב '0' — כך נתונים קיימים בלי revision מתחילים בבטחה מ-0, בלי Migration.
// מחזיר: {currentRev, newRev, successFlag} — successFlag '1' = נכתב, '0' = נדחה (conflict).
const CAS_SCRIPT = `
local currentRev = redis.call('GET', KEYS[2])
if currentRev == false then currentRev = '0' end
if currentRev ~= ARGV[1] then
  return {currentRev, currentRev, '0'}
end
local newRev = tostring(tonumber(currentRev) + 1)
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], newRev)
return {currentRev, newRev, '1'}
`;

export async function GET() {
  try {
    // MGET קורא את הנתונים ואת ה-revision בפקודת Redis אטומית אחת — כך data ו-rev
    // תמיד מגיעים מאותו צילום מצב עקבי, בלי חלון שבו כתיבה מקבילה יוצרת torn read
    // (data ישן עם rev חדש) שעלול לנטרל את ה-OCC.
    const [data, rev] = await redis.mget(DATA_KEY, REV_KEY);
    return NextResponse.json({ value: data || [], rev: typeof rev === 'number' ? rev : 0 });
  } catch (e) {
    console.error('[api/postings] GET failed:', e);
    return NextResponse.json({ value: [], error: String(e?.message || e) }, { status: 503 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();

    // זיהוי לקוח מגרסה ישנה: הגרסה הישנה שולחת מערך גולמי במקום { items, expectedRev }.
    // דוחים אותו (אסור לאפשר כתיבה שעוקפת את ה-OCC), אך עם הודעת רענון ברורה במקום
    // שגיאה גנרית — כך משתמש עם טאב ישן פתוח בזמן Deploy מבין שעליו לרענן.
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

    const result = await redis.eval(
      CAS_SCRIPT,
      [DATA_KEY, REV_KEY],
      [String(expectedRev), JSON.stringify(items)]
    );

    // בדיקת הגנה מחמירה על מבנה התשובה של eval: אם הוא לא בדיוק מה שהסקריפט
    // אמור להחזיר (מערך באורך 3 עם successFlag 0/1), לא מנחשים ולא מדווחים
    // הצלחה — מחזירים שגיאה מפורשת. הכתיבה עצמה כבר הוכרעה אטומית ב-Lua,
    // אז שגיאה כאן לא יכולה לדרוס נתונים; היא רק מונעת דיווח שגוי ללקוח.
    if (!Array.isArray(result) || result.length !== 3) {
      console.error('[api/postings] PUT: מבנה תשובה לא צפוי מ-eval:', result);
      return NextResponse.json({ ok: false, error: 'תשובה לא צפויה מהשרת (CAS)' }, { status: 500 });
    }
    const [actualRev, newRev, successFlag] = result;
    const successNum = Number(successFlag);
    if (successNum !== 0 && successNum !== 1) {
      console.error('[api/postings] PUT: successFlag לא צפוי מ-eval:', successFlag);
      return NextResponse.json({ ok: false, error: 'תשובה לא צפויה מהשרת (CAS flag)' }, { status: 500 });
    }

    console.log(
      `[api/postings] PUT expectedRev=${expectedRev} actualRev=${actualRev} newRev=${newRev} ` +
      `itemsAfter=${items.length} success=${successNum === 1}`
    );

    if (successNum !== 1) {
      // MGET אטומי — data ו-rev של הקונפליקט עקביים זה עם זה (לא torn), כך שהלקוח
      // מאמץ צילום מצב תקין ולא יכול לנסות שוב עם rev שאינו תואם לנתונים.
      const [current, currentRev] = await redis.mget(DATA_KEY, REV_KEY);
      return NextResponse.json(
        {
          ok: false,
          conflict: true,
          rev: typeof currentRev === 'number' ? currentRev : Number(actualRev),
          value: current || [],
          error: 'הנתונים השתנו במכשיר אחר מאז הקריאה האחרונה',
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, rev: Number(newRev) });
  } catch (e) {
    console.error('[api/postings] PUT failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
