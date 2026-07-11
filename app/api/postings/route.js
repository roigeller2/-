import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function kvHostFingerprint() {
  try { return new URL(process.env.KV_REST_API_URL).hostname; } catch { return null; }
}

export async function GET() {
  try {
    const data = await kv.get('postings');
    console.log('[DIAG]', {
      fn: 'GET', ts: new Date().toISOString(),
      region: process.env.VERCEL_REGION,
      kvHost: kvHostFingerprint(),
      type: typeof data,
      isArray: Array.isArray(data),
      count: Array.isArray(data) ? data.length : null,
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
