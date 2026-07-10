import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await kv.get('postings');
    return NextResponse.json({ value: data || [] });
  } catch (e) {
    return NextResponse.json({ value: [], error: String(e) }, { status: 200 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    await kv.set('postings', body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
