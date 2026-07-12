import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// לקוח Upstash ישיר, מאותחל במפורש כדי לעקוף את שתי ההגדרות של @vercel/kv
// שגרמו לבאג: cache: 'no-store' (במקום 'default' ש-@vercel/kv כופה, מה שגרם
// לקריאות מקוֹשות שהחזירו null ישן), ו-enableAutoPipelining: false. אותו מפתח
// ('coordination-requests') ואותו פורמט אחסון בדיוק — אין שינוי בנתונים הקיימים.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
  cache: 'no-store',
  enableAutoPipelining: false,
});

export async function GET() {
  try {
    const data = await redis.get('coordination-requests');
    return NextResponse.json({ value: data || [] });
  } catch (e) {
    console.error('[api/coordination-requests] GET failed:', e);
    return NextResponse.json({ value: [], error: String(e?.message || e) }, { status: 503 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    await redis.set('coordination-requests', body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/coordination-requests] PUT failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
