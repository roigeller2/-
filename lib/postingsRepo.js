import { pool } from './db.js';
import { canManagePosting } from './authz.js';

// שכבת אחסון רלציונית ל-postings מעל Postgres (מחליפה את מסלול ה-collection/Redis).
// שומרת על חוזה ה-HTTP החיצוני כלפי ה-UI: GET מחזיר { value:[...], rev }, וכתיבות
// מחזירות { status:'ok'|'blocked', value, rev, ... }.
//
// העוזרים מקבלים db אופציונלי (ברירת מחדל: ה-pool) כדי לאפשר fake בבדיקות יחידה.
//
// מודל: שורה לכל אימון (טבלת postings), + collection_versions.version('postings') כ-rev.
// שדות שרת (id/status/owner/timestamps/manualStatus) בעמודות ייעודיות; שאר שדות הטופס ב-data jsonb.
//
// עקביות קריאה: listPostings קורא value+rev בטרנזקציית REPEATABLE READ — snapshot יחיד,
// בלי torn read בין הנתונים לגרסה (מחליף את ה-MGET האטומי הישן).
// אטומיות כתיבה: כל כתיבה בטרנזקציה אחת — שינוי השורה + bump הגרסה מתחייבים יחד. ה-bump הוא
// UPDATE ... version+1 (read-modify-write אטומי, נועל את שורת הגרסה → יצירות מקבילות מסתדרות בטור).
// override נועל את שורת האימון (SELECT ... FOR UPDATE) כך ששתי כתיבות על אותו אימון מסתדרות בטור.
// מגבלה מודעת ומתועדת: הלקוח אינו שולח rev בכתיבה, ולכן אין זיהוי "מידע ישן אצל הלקוח" —
// override הוא last-write-wins ברמת-השדה, מוגן בבעלות ובנעילת-השורה בלבד (זהה להתנהגות הקיימת).

// שדות שנשלטים ע"י השרת ואינם נשמרים בתוך data jsonb (נבנים מעמודות ייעודיות).
const SERVER_KEYS = ['id', 'status', 'ownerId', 'ownerName', 'manualStatus', 'createdAt', 'updatedAt'];

const toIso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : v);

// שורה → אובייקט אימון *שטוח* כפי שה-UI צורך: שדות הטופס (data) + העמודות הייעודיות.
// manualStatus מושמט כש-null (לשמר את 'manualStatus || undefined' הקודם).
function rowToPosting(row) {
  if (!row) return null;
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  const posting = {
    ...data,
    id: row.id,
    status: row.status,
    ownerId: row.owner_id ?? null,
    ownerName: row.owner_name ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
  if (row.manual_status != null) posting.manualStatus = row.manual_status;
  return posting;
}

// הסרת שדות-שרת מתוך data הנכנס (מונע כפילות/התחזות; העמודות הן מקור האמת).
function cleanData(data) {
  const out = {};
  for (const k of Object.keys(data || {})) {
    if (!SERVER_KEYS.includes(k)) out[k] = data[k];
  }
  return out;
}

async function withTx(db, fn, { isolation } = {}) {
  const client = await db.connect();
  try {
    await client.query(isolation ? `begin isolation level ${isolation}` : 'begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function bumpVersion(client) {
  const { rows } = await client.query(
    `update collection_versions set version = version + 1 where key = 'postings' returning version`
  );
  return rows[0] ? Number(rows[0].version) : 0;
}

async function readAll(client) {
  const list = await client.query(`select * from postings order by created_at asc`);
  const ver = await client.query(`select version from collection_versions where key = 'postings'`);
  return {
    value: list.rows.map(rowToPosting),
    rev: ver.rows[0] ? Number(ver.rows[0].version) : 0,
  };
}

// GET — value+rev מצילום-מצב עקבי יחיד (REPEATABLE READ).
export async function listPostings(db = pool) {
  return withTx(db, (client) => readAll(client), { isolation: 'repeatable read' });
}

// create — INSERT שורה + bump גרסה + החזרת הרשימה המרועננת, הכול בטרנזקציה אחת.
// השרת שולט ב-id/status/owner/timestamps; שדות הטופס (data) מנוקים מ-SERVER_KEYS.
export async function createPosting({ data, ownerId, ownerName }, db = pool) {
  return withTx(db, async (client) => {
    const ins = await client.query(
      `insert into postings (owner_id, owner_name, status, manual_status, data, created_at, updated_at)
       values ($1, $2, 'available', null, $3, now(), now())
       returning id`,
      [ownerId ?? null, ownerName ?? null, JSON.stringify(cleanData(data))]
    );
    await bumpVersion(client);
    const { value, rev } = await readAll(client);
    return { status: 'ok', value, rev, id: ins.rows[0].id };
  });
}

// setTrainingOverride — נעילת שורת האימון, אכיפת בעלות, UPDATE + bump, בטרנזקציה אחת.
// manualStatus: 'done' | 'cancelled' | null (ניקוי). החזרות blocked תואמות ל-respond().
export async function setTrainingOverride(id, manualStatus, access, userId, db = pool) {
  return withTx(db, async (client) => {
    const sel = await client.query(`select * from postings where id = $1 for update`, [id]);
    const row = sel.rows[0];
    if (!row) return { status: 'blocked', reason: 'not_found', httpStatus: 404 };
    if (!canManagePosting(access, userId, { ownerId: row.owner_id })) {
      return { status: 'blocked', reason: 'forbidden', httpStatus: 403 };
    }
    await client.query(
      `update postings set manual_status = $2, updated_at = now() where id = $1`,
      [id, manualStatus ?? null]
    );
    await bumpVersion(client);
    const { value, rev } = await readAll(client);
    return { status: 'ok', value, rev };
  });
}
