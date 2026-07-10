import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await kv.get('postings');
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
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/postings] PUT failed:', e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
