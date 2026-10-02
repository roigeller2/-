import { pool } from './db.js';
import { canCancelRequest, canActAsPostingOwner } from './authz.js';

// שכבת אחסון רלציונית ל-coordination_requests מעל Postgres (מחליפה collection/Redis).
// שומרת על חוזה ה-HTTP ({value, rev} + blocked/404/403/409) וכל ההרשאות והכללים הקיימים.
// אותו דפוס כמו postingsRepo: REPEATABLE READ ל-list; טרנזקציה לכל כתיבה + bump אטומי;
// FOR UPDATE על שורת הבקשה. db אופציונלי (ברירת מחדל pool) לצורך fake בבדיקות.
//
// כללי המעבר הקיימים נשמרים *כפי שהם* — לא נוספו guards חדשים:
//   • not_found (404), בעלות (403: cancel=מבקש/Admin; accept/reject/setStage/setExec=בעל הפרסום),
//     accepted-יחיד (409) ב-accept בלבד.
//   • הערה מתועדת: הקוד מאפשר אישור בקשה שבוטלה/נדחתה (אין בדיקת from-state) — התנהגות קיימת,
//     מועמדת לתיקון עתידי בנפרד.
//
// accepted-יחיד נאכף במסד ע"י ה-partial unique index uniq_one_accepted_per_post. ב-accept
// עוטפים את ה-UPDATE ב-SAVEPOINT; הפרת האילוץ (SQLSTATE 23505) *של אותו אילוץ בלבד* מתורגמת
// ל-accepted_exists/409; כל הפרת אילוץ אחרת נזרקת הלאה (→ 500 גנרי).

const VERSION_KEY = 'coordination-requests';

const SERVER_KEYS = [
  'id', 'postId', 'postingId', 'requesterId', 'requesterName', 'coordinationStatus',
  'requestStatus', 'trainingExecutionStatus', 'completedAt', 'cancellationReason',
  'createdAt', 'updatedAt',
];

const toIso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : v);

function rowToCoord(row) {
  if (!row) return null;
  const data = row.data && typeof row.data === 'object' ? row.data : {};
  return {
    ...data,
    id: row.id,
    postId: row.post_id,
    requesterId: row.requester_id ?? null,
    requesterName: row.requester_name ?? null,
    coordinationStatus: row.coordination_status,
    requestStatus: row.request_status,
    trainingExecutionStatus: row.training_execution_status,
    completedAt: toIso(row.completed_at),
    cancellationReason: row.cancellation_reason ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

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
    `update collection_versions set version = version + 1 where key = '${VERSION_KEY}' returning version`
  );
  return rows[0] ? Number(rows[0].version) : 0;
}

async function readAll(client) {
  const list = await client.query(`select * from coordination_requests order by created_at asc`);
  const ver = await client.query(`select version from collection_versions where key = '${VERSION_KEY}'`);
  return {
    value: list.rows.map(rowToCoord),
    rev: ver.rows[0] ? Number(ver.rows[0].version) : 0,
  };
}

async function lockRow(client, id) {
  const { rows } = await client.query(`select * from coordination_requests where id = $1 for update`, [id]);
  return rows[0] || null;
}

async function postingOwnerId(client, postId) {
  const { rows } = await client.query(`select owner_id from postings where id = $1`, [postId]);
  return rows[0] ? rows[0].owner_id : null;
}

// GET — value+rev מצילום-מצב עקבי יחיד.
export async function listCoordRequests(db = pool) {
  return withTx(db, (client) => readAll(client), { isolation: 'repeatable read' });
}

// create — requesterId מהסשן; סטטוסים נכפים; post_id מתוך data.postId. מחזיר גם
// postingOwnerId (לצורך התראת request_new ב-route, best-effort).
export async function createCoord({ data, requesterId, requesterName }, db = pool) {
  const postId = (data && (data.postId ?? data.postingId)) ?? null;
  return withTx(db, async (client) => {
    const ins = await client.query(
      `insert into coordination_requests
         (post_id, requester_id, requester_name, request_status, coordination_status,
          training_execution_status, completed_at, cancellation_reason, data, created_at, updated_at)
       values ($1, $2, $3, 'pending', 'initial_coordination_done', 'pending', null, null, $4, now(), now())
       returning id`,
      [postId, requesterId ?? null, requesterName ?? null, JSON.stringify(cleanData(data))]
    );
    const ownerId = await postingOwnerId(client, postId);
    await bumpVersion(client);
    const { value, rev } = await readAll(client);
    return { status: 'ok', value, rev, id: ins.rows[0].id, postingOwnerId: ownerId };
  });
}

// cancel — בעלות המבקש (requester/Admin).
export async function cancelCoord(id, access, userId, db = pool) {
  return withTx(db, async (client) => {
    const row = await lockRow(client, id);
    if (!row) return { status: 'blocked', reason: 'not_found', httpStatus: 404 };
    if (!canCancelRequest(access, userId, { requesterId: row.requester_id })) {
      return { status: 'blocked', reason: 'forbidden', httpStatus: 403 };
    }
    await client.query(
      `update coordination_requests set request_status = 'cancelled', updated_at = now() where id = $1`,
      [id]
    );
    await bumpVersion(client);
    const { value, rev } = await readAll(client);
    return { status: 'ok', value, rev };
  });
}

// פעולות בעל-הפרסום: בעלות נקבעת לפי בעל ה-posting שהבקשה מפנה אליו.
async function denyIfNotPostingOwner(client, row, access, userId) {
  const ownerId = await postingOwnerId(client, row.post_id);
  if (!canActAsPostingOwner(access, userId, { ownerId })) {
    return { status: 'blocked', reason: 'forbidden', httpStatus: 403 };
  }
  return null;
}

// accept — accepted-יחיד נאכף במסד; 23505 מהאילוץ → accepted_exists/409.
export async function acceptCoord(id, access, userId, db = pool) {
  return withTx(db, async (client) => {
    const row = await lockRow(client, id);
    if (!row) return { status: 'blocked', reason: 'not_found', httpStatus: 404 };
    const deny = await denyIfNotPostingOwner(client, row, access, userId);
    if (deny) return deny;
    // אישור מותר רק מבקשה *ממתינה* — אי אפשר לאשר בקשה שבוטלה/נדחתה (מתה). שחרור אימון
    // מאושר נעשה דרך reject/cancel, לא דרך accept. נבדק על השורה הנעולה (המצב העדכני).
    if (row.request_status !== 'pending') {
      return { status: 'blocked', reason: 'not_pending', httpStatus: 409 };
    }
    await client.query('savepoint sp_accept');
    try {
      await client.query(
        `update coordination_requests set request_status = 'accepted', updated_at = now() where id = $1`,
        [id]
      );
    } catch (e) {
      if (e && e.code === '23505' && e.constraint === 'uniq_one_accepted_per_post') {
        await client.query('rollback to savepoint sp_accept');
        return { status: 'blocked', reason: 'accepted_exists', httpStatus: 409 };
      }
      throw e;
    }
    await bumpVersion(client);
    const { value, rev } = await readAll(client);
    return { status: 'ok', value, rev };
  });
}

export async function rejectCoord(id, access, userId, db = pool) {
  return withTx(db, async (client) => {
    const row = await lockRow(client, id);
    if (!row) return { status: 'blocked', reason: 'not_found', httpStatus: 404 };
    const deny = await denyIfNotPostingOwner(client, row, access, userId);
    if (deny) return deny;
    await client.query(
      `update coordination_requests set request_status = 'rejected', updated_at = now() where id = $1`,
      [id]
    );
    await bumpVersion(client);
    const { value, rev } = await readAll(client);
    return { status: 'ok', value, rev };
  });
}

export async function setStage(id, stageKey, access, userId, db = pool) {
  return withTx(db, async (client) => {
    const row = await lockRow(client, id);
    if (!row) return { status: 'blocked', reason: 'not_found', httpStatus: 404 };
    const deny = await denyIfNotPostingOwner(client, row, access, userId);
    if (deny) return deny;
    await client.query(
      `update coordination_requests set coordination_status = $2, updated_at = now() where id = $1`,
      [id, stageKey]
    );
    await bumpVersion(client);
    const { value, rev } = await readAll(client);
    return { status: 'ok', value, rev };
  });
}

export async function setExec(id, execStatus, cancellationReason, access, userId, db = pool) {
  return withTx(db, async (client) => {
    const row = await lockRow(client, id);
    if (!row) return { status: 'blocked', reason: 'not_found', httpStatus: 404 };
    const deny = await denyIfNotPostingOwner(client, row, access, userId);
    if (deny) return deny;
    await client.query(
      `update coordination_requests
          set training_execution_status = $2,
              completed_at = case when $2 = 'completed' then now() else completed_at end,
              cancellation_reason = case when $2 = 'cancelled' then $3 else cancellation_reason end,
              updated_at = now()
        where id = $1`,
      [id, execStatus, cancellationReason ?? null]
    );
    await bumpVersion(client);
    const { value, rev } = await readAll(client);
    return { status: 'ok', value, rev };
  });
}
