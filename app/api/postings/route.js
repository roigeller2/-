import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function kvHostFingerprint() {
  try { return new URL(process.env.KV_REST_API_URL).hostname; } catch { return null; }
}

export async function GET() {
  try {
    const data = await kv.get('postings');

    // אבחון גולמי: קריאה ישירה ל-REST API של Upstash, בעקיפין מ-@vercel/kv,
    // כדי לבודד אם חוסר-העקביות שראינו הוא בפענוח של הספרייה או בתשובה
    // עצמה מהשרת. לא נוגע בלוגיקת התגובה של ה-route (data || [] נשאר כפי שהיה).
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
    await kv.set('postings', body);
    console.log('[DIAG]', {
      fn: 'PUT', ts: new Date().toISOString(),
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
