import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// לקוח Upstash ישיר, מאותחל במפורש כדי לעקוף את שתי ההגדרות של @vercel/kv
// שחשדנו בהן: cache: 'no-store' (במקום 'default' ש-@vercel/kv כופה, מה שגרם
// לקריאות מקוֹשות שהחזירו null ישן), ו-enableAutoPipelining: false. אותו מפתח
// ('postings') ואותו פורמט אחסון בדיוק — אין שינוי בנתונים הקיימים.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
  cache: 'no-store',
  enableAutoPipelining: false,
});

function kvHostFingerprint() {
  try { return new URL(process.env.KV_REST_API_URL).hostname; } catch { return null; }
}

export async function GET() {
  try {
    const data = await redis.get('postings');

    // אבחון זמני: משווים את התוצאה הראשית (עכשיו מ-@upstash/redis הישיר עם
    // no-store) מול קריאת REST גולמית לחלוטין, כדי לוודא שהריצוד ל-null נעלם.
    // לוג metadata בלבד — בלי תוכן נתונים ובלי Token.
    let raw = 'not-fetched';
    try {
      const rawRes = await fetch(`${process.env.KV_REST_API_URL}/get/postings`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
        cache: 'no-store',
      });
      const rawJson = await rawRes.json();
      let rawParsedIsArray = null;
      let rawParsedCount = null;
      let rawParseError = null;
      if (typeof rawJson.result === 'string') {
        try {
          const parsed = JSON.parse(rawJson.result);
          rawParsedIsArray = Array.isArray(parsed);
          rawParsedCount = Array.isArray(parsed) ? parsed.length : null;
        } catch (parseErr) {
          rawParseError = String(parseErr?.message || parseErr);
        }
      }
      raw = {
        status: rawRes.status,
        resultIsNull: rawJson.result === null,
        resultLength: typeof rawJson.result === 'string' ? rawJson.result.length : null,
        rawParsedIsArray,
        rawParsedCount,
        rawParseError,
      };
    } catch (rawErr) {
      raw = { error: String(rawErr?.message || rawErr) };
    }

    console.log('[DIAG]', {
      fn: 'GET', ts: new Date().toISOString(),
      source: '@upstash/redis direct (no-store, no-pipeline)',
      region: process.env.VERCEL_REGION,
      kvHost: kvHostFingerprint(),
      type: typeof data,
      isArray: Array.isArray(data),
      count: Array.isArray(data) ? data.length : null,
      dataIsNull: data === null,
      objectTag: Object.prototype.toString.call(data),
      ctorName: data?.constructor?.name ?? null,
      jsonLen: (() => { try { return JSON.stringify(data)?.length ?? null; } catch { return 'unstringifiable'; } })(),
      raw,
    });
    return NextResponse.json({ value: data || [] });
  } catch (e) {
    console.error('[api/postings] GET failed:', e);
    return NextResponse.json({ value: [], error: String(e?.message || e) }, { status: 503 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    await redis.set('postings', body);
    console.log('[DIAG]', {
      fn: 'PUT', ts: new Date().toISOString(),
      source: '@upstash/redis direct (no-store, no-pipeline)',
      region: process.env.VERCEL_REGION,
      kvHost: kvHostFingerprint(),
      itemsWritten: Array.isArray(body) ? body.length : null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/postings] PUT failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
