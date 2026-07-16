import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import { UpstashRedisAdapter } from '@auth/upstash-redis-adapter';
import { redis } from './lib/redis.js';
import { ensureProfileOnSignIn } from './lib/users.js';
import { resolveAccess } from './lib/authz.js';

// ה-MVP הנוכחי: Google בלבד. תשתית ה-Magic Link (Resend) נשמרת אופציונלית
// לעתיד — היא נטענת רק אם AUTH_RESEND_KEY ו-EMAIL_FROM מוגדרים, כך שה-Build
// והפריסה אינם תלויים בהם.
const providers = [
  Google({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    // קישור חשבונות לפי אימייל מאומת: גם Google וגם Magic Link מאמתים את
    // האימייל, כך שמשתמש יחיד נשמר לשתי דרכי הכניסה (מונע כפילות).
    allowDangerousEmailAccountLinking: true,
  }),
];
if (process.env.AUTH_RESEND_KEY && process.env.EMAIL_FROM) {
  providers.push(
    Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: process.env.EMAIL_FROM }),
  );
}

// קונפיגורציית Auth.js (NextAuth v5). זהות בלבד; ה-authorization (approval/
// ownerId) הוא לוגיקה שלנו ב-Redis, נבדק טרי בכל בקשה.
export const { handlers, auth, signIn, signOut } = NextAuth({
  // רשומות הזהות (user/account/session/verification-token) נשמרות ב-Redis
  // תחת התחילית 'auth:', בנפרד מהנתונים ומפרופילי ההרשאה שלנו.
  adapter: UpstashRedisAdapter(redis, { baseKeyPrefix: 'auth:' }),
  providers,
  session: { strategy: 'database' },
  callbacks: {
    // חשוב: לא יוצרים כאן פרופיל. בכניסה ראשונה של משתמש חדש, ה-user שמגיע
    // ל-signIn הוא אובייקט הספק (Google), ו-user.id שלו הוא מזהה-הספק (sub) —
    // *לא* מזהה ה-DB. ה-adapter מייצר UUID נפרד ל-DB. יצירה כאן הייתה יוצרת
    // פרופיל תחת מזהה שגוי (sub) שלא תואם ל-session.userId (UUID). לכן היצירה
    // עברה ל-session callback, שם user.id הוא מזהה ה-DB.
    async signIn() {
      return true;
    },
    // get-or-create אידמפוטנטי תחת מזהה ה-DB (user.id = UUID) — מבטיח שהפרופיל
    // קיים תחת אותו מזהה שבו משתמשים session.userId ו-setReferral, ואינו דורס
    // פרופיל קיים. מחזיר את הפרופיל ומשתמשים בו ישירות (בלי getProfile נוסף).
    // ההרשאה (approval/admin/onboarded) נקראת טרייה מ-Redis בכל בקשה.
    async session({ session, user }) {
      const profile = await ensureProfileOnSignIn(user.id, user.email, user.name);
      session.userId = user.id;
      session.access = resolveAccess(profile, user.email, process.env.ADMIN_EMAILS);
      // דגל השלמת ה-onboarding ("דרך מי הגעת אלינו?"), נגזר בשרת מהפרופיל.
      session.access.onboarded = !!profile?.onboardingCompletedAt;
      return session;
    },
  },
});
