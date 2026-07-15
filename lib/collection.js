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
