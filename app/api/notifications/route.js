import { NextResponse } from 'next/server';
import { auth } from '../../../auth';
import { notificationsGet, notificationsPost } from '../../../lib/notifApi';

export const dynamic = 'force-dynamic';

// מעטפת דקה: מזהה את הסשן (בשרת), מאצילה ל-handler הטהור, וממפה ל-NextResponse.
// אין קבלת userId/recipientId מהלקוח — הזהות נלקחת אך ורק מהסשן.

export async function GET() {
  const session = await auth();
  const res = await notificationsGet({ access: session?.access, userId: session?.userId });
  return NextResponse.json(res.body, { status: res.status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const session = await auth();
  const res = await notificationsPost({
    access: session?.access,
    userId: session?.userId,
    readBody: () => request.json(),
  });
  return NextResponse.json(res.body, { status: res.status });
}
