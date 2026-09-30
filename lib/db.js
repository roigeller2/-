import { Pool } from 'pg';

// לקוח Postgres משותף (Supabase). מחליף את לקוח Upstash הישן כשכבת האחסון.
//
// חיבור:
//   • Runtime ב-Vercel מתחבר דרך Supavisor Transaction Pooler (port 6543).
//     ה-pooler מנהל את ה-concurrency, לכן ה-pool בצד האפליקציה זעיר — max:1 לכל
//     warm instance (ההמלצה הרשמית של Supabase ל-serverless).
//   • migrations/DDL מורצים בנפרד מול ה-Direct connection (port 5432, DIRECT_URL),
//     לא מכאן.
//
// תאימות Transaction Pooler (חשוב ללוגיקת ה-collections שמשתמשת ב-pool.connect()):
//   אסור להסתמך על state שנשמר בין טרנזקציות — כל טרנזקציה עצמאית:
//   BEGIN..COMMIT/ROLLBACK בתוך client יחיד שמשוחרר מיד, בלי named prepared
//   statements, בלי SET SESSION, בלי LISTEN/NOTIFY, בלי temp tables חוצי-טרנזקציה,
//   ובלי advisory locks ברמת-סשן (אם צריך נעילה — pg_advisory_xact_lock בתוך הטרנזקציה).
//
// SSL: Supabase מחייב TLS. אנחנו מפעילים SSL *עם אימות תעודה* ולעולם לא מבטלים
//   אותו. `ssl: true` (או { ca } כשמסופק) מוודא את התעודה מול מאגר ה-CA —
//   rejectUnauthorized נשאר true. קביעה מפורשת בקוד (ולא דרך sslmode במחרוזת)
//   מבטיחה ש-TLS פעיל גם אם ה-connection string לא כולל sslmode, ומונעת תלות
//   בשינוי הסמנטיקה הצפוי של sslmode=require ב-pg v9.
//   אם תעודת ה-pooler של Supabase אינה במאגר ה-CA המובנה של Node והחיבור נכשל
//   באימות — מספקים את ה-CA שלהם דרך SUPABASE_CA_CERT (PEM) ל-verify-full אמיתי,
//   בלי לבטל אימות.
function sslConfig() {
  const ca = process.env.SUPABASE_CA_CERT;
  return ca ? { ca } : true;
}

const g = globalThis;

export const pool =
  g.__pgPool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    ssl: sslConfig(),
  });

if (!g.__pgPool) g.__pgPool = pool;

// עוזר קצר לשאילתות חד-פעמיות (ללא טרנזקציה). לטרנזקציות: pool.connect() →
// BEGIN/COMMIT/ROLLBACK → client.release().
export const query = (text, params) => pool.query(text, params);
