import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Resend from 'next-auth/providers/resend';
import { UpstashRedisAdapter } from '@auth/upstash-redis-adapter';
import { redis } from './lib/redis.js';
import { ensureProfileOnSignIn, getProfile } from './lib/users.js';
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
    // נוצר פרופיל הרשאה (pending) בכניסה הראשונה. אידמפוטנטי.
    async signIn({ user }) {
      if (user?.id) await ensureProfileOnSignIn(user.id, user.email, user.name);
      return true;
    },
    // מצרפים לסשן את מצב הגישה — נקרא טרי מ-Redis בכל בקשה (approval/admin
    // אינם נסמכים על snapshot; השבתה תופסת מיד).
    async session({ session, user }) {
      const profile = await getProfile(user.id);
      session.userId = user.id;
      session.access = resolveAccess(profile, user.email, process.env.ADMIN_EMAILS);
      // דגל השלמת ה-onboarding ("דרך מי הגעת אלינו?"), נגזר בשרת מהפרופיל.
      session.access.onboarded = !!profile?.onboardingCompletedAt;
      return session;
    },
  },
});
