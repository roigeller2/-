import { NextResponse } from 'next/server';
import { auth } from '../../../auth';
import { profilePost, profileGet } from '../../../lib/profileApi';

export const dynamic = 'force-dynamic';

// מעטפת דקה: מזהה את הסשן (בשרת) ומאצילה ל-handler הטהור. פתוח לכל משתמש מחובר
// (כולל pending) — זהו endpoint של מצב-החשבון. userId נלקח מהסשן בלבד.

export async function GET() {
  const session = await auth();
  const res = await profileGet({ userId: session?.userId });
  return NextResponse.json(res.body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const session = await auth();
  const res = await profilePost({ userId: session?.userId, readBody: () => request.json() });
  return NextResponse.json(res.body, { status: res.status });
}
