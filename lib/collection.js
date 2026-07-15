import { redis } from './redis';

// Optimistic Concurrency Control: סקריפט Lua אטומי שבודק שה-revision הנוכחי
// תואם ל-expectedRev, ורק אם כן — כותב את הנתונים ומעלה את ה-revision. הכל
// בפעולה אחת אטומית בצד Redis, כך שאין חלון שבו שתי כתיבות מתחרות דורסות זו את זו.
// מפתח rev חסר נחשב '0' — כך נתונים קיימים בלי revision מתחילים בבטחה מ-0, בלי Migration.
// מחזיר: {currentRev, newRev, successFlag} — successFlag '1' = נכתב, '0' = נדחה (conflict).
const CAS_SCRIPT = `
local currentRev = redis.call('GET', KEYS[2])
if currentRev == false then currentRev = '0' end
if currentRev ~= ARGV[1] then
  return {currentRev, currentRev, '0'}
end
local newRev = tostring(tonumber(currentRev) + 1)
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], newRev)
return {currentRev, newRev, '1'}
`;

// קריאה אטומית של הנתונים וה-revision בפקודת MGET אחת — כך data ו-rev תמיד
// מגיעים מאותו צילום מצב עקבי, בלי חלון שבו כתיבה מקבילה יוצרת torn read.
export async function readCollection(dataKey, revKey) {
  const [data, rev] = await redis.mget(dataKey, revKey);
  return { value: data || [], rev: typeof rev === 'number' ? rev : 0 };
}

// כתיבת CAS אטומית. מחזיר תוצאה מנורמלית:
//   { status: 'ok', rev }                         — נכתב בהצלחה
//   { status: 'conflict', rev, value }            — נדחה; מצורפים הנתונים וה-rev העדכניים
//   { status: 'error', message }                  — תשובה לא צפויה מ-eval (לא נכתב)
export async function casWrite(dataKey, revKey, expectedRev, items) {
  const result = await redis.eval(
    CAS_SCRIPT,
    [dataKey, revKey],
    [String(expectedRev), JSON.stringify(items)]
  );

  // בדיקת הגנה מחמירה על מבנה התשובה של eval.
  if (!Array.isArray(result) || result.length !== 3) {
    return { status: 'error', message: 'תשובה לא צפויה מהשרת (CAS)' };
  }
  const [actualRev, newRev, successFlag] = result;
  const successNum = Number(successFlag);
  if (successNum !== 0 && successNum !== 1) {
    return { status: 'error', message: 'תשובה לא צפויה מהשרת (CAS flag)' };
  }

  if (successNum === 1) {
    return { status: 'ok', rev: Number(newRev) };
  }

  // conflict — קוראים את המצב העדכני (MGET אטומי, data ו-rev עקביים).
  const [current, currentRev] = await redis.mget(dataKey, revKey);
  return {
    status: 'conflict',
    rev: typeof currentRev === 'number' ? currentRev : Number(actualRev),
    value: current || [],
  };
}

// מוטציה עם OCC בצד השרת: קורא טרי → מריץ mutator → CAS, עם retry על conflict.
// ה-mutator מקבל את המערך הטרי ומחזיר:
//   • מערך חדש → ייכתב.
//   • { block: true, reason, httpStatus } → לא ייכתב (חסימה מפורשת, למשל בעלות/not_found).
// כל בדיקת הרשאה/אינווריאנט חייבת להתבצע בתוך ה-mutator על הנתונים הטריים, כך
// שהיא נבדקת מחדש בכל ניסיון ואין חלון TOCTOU בין הבדיקה לכתיבה.
// מחזיר: { status:'ok', value, rev } | { status:'blocked', reason, httpStatus }
//        | { status:'conflict' } | { status:'error', message }
export async function mutateCollectionServer(dataKey, revKey, mutator, { maxAttempts = 3 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { value, rev } = await readCollection(dataKey, revKey);
    const out = mutator(value);
    if (out && out.block === true) {
      return { status: 'blocked', reason: out.reason, httpStatus: out.httpStatus || 409 };
    }
    const w = await casWrite(dataKey, revKey, rev, out);
    if (w.status === 'ok') return { status: 'ok', value: out, rev: w.rev };
    if (w.status === 'error') return { status: 'error', message: w.message };
    // conflict → ניסיון חוזר על נתונים טריים
  }
  return { status: 'conflict' };
}
