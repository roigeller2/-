// fake Postgres לבדיקות coordRepo — coordination_requests + postings (לבדיקת בעלות) +
// collection_versions('coordination-requests'). מפרש את ה-SQL של coordRepo.
// מדמה את ה-partial unique index: UPDATE ל-'accepted' כשקיימת כבר בקשה accepted אחרת
// לאותו post_id → זורק שגיאה { code:'23505', constraint:'uniq_one_accepted_per_post' }.
// savepoint/rollback to savepoint/release = no-op. אין נעילה אמיתית.

export function makeFakeCoordDb({ coords = [], postings = [], version = 0 } = {}) {
  const coordStore = new Map();
  const postingOwners = new Map(); // id → owner_id
  let ver = version;
  let seq = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1) + seq++ * 1000);

  for (const c of coords) {
    coordStore.set(c.id, {
      id: c.id,
      post_id: c.post_id ?? null,
      requester_id: c.requester_id ?? null,
      requester_name: c.requester_name ?? null,
      request_status: c.request_status ?? 'pending',
      coordination_status: c.coordination_status ?? 'initial_coordination_done',
      training_execution_status: c.training_execution_status ?? 'pending',
      completed_at: c.completed_at ?? null,
      cancellation_reason: c.cancellation_reason ?? null,
      data: c.data ?? {},
      created_at: c.created_at ?? now(),
      updated_at: c.updated_at ?? now(),
    });
  }
  for (const p of postings) postingOwners.set(p.id, p.owner_id ?? null);

  function run(sql, params = []) {
    const s = sql.trim().toLowerCase();

    if (s.startsWith('begin') || s === 'commit' || s === 'rollback') return { rows: [] };
    if (s.startsWith('savepoint') || s.startsWith('rollback to savepoint') || s.startsWith('release savepoint')) return { rows: [] };

    if (s.startsWith('insert into coordination_requests')) {
      const [postId, requesterId, requesterName, dataJson] = params;
      const id = 'c' + (coordStore.size + 1);
      coordStore.set(id, {
        id, post_id: postId ?? null, requester_id: requesterId ?? null,
        requester_name: requesterName ?? null, request_status: 'pending',
        coordination_status: 'initial_coordination_done', training_execution_status: 'pending',
        completed_at: null, cancellation_reason: null,
        data: typeof dataJson === 'string' ? JSON.parse(dataJson) : (dataJson ?? {}),
        created_at: now(), updated_at: now(),
      });
      return { rows: [{ id }] };
    }

    if (s.startsWith('select owner_id from postings where id')) {
      return { rows: postingOwners.has(params[0]) ? [{ owner_id: postingOwners.get(params[0]) }] : [] };
    }

    if (s.startsWith('update collection_versions set version = version + 1')) {
      ver += 1; return { rows: [{ version: ver }] };
    }
    if (s.startsWith('select version from collection_versions')) return { rows: [{ version: ver }] };

    if (s.startsWith('select * from coordination_requests order by created_at asc')) {
      const rows = [...coordStore.values()].sort((a, b) => a.created_at - b.created_at);
      return { rows: rows.map((r) => ({ ...r })) };
    }
    if (s.startsWith('select * from coordination_requests where id')) {
      const row = coordStore.get(params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (s.includes("set request_status = 'cancelled'")) return setStatus(params[0], 'cancelled');
    if (s.includes("set request_status = 'rejected'")) return setStatus(params[0], 'rejected');
    if (s.includes("set request_status = 'accepted'")) {
      const id = params[0];
      const target = coordStore.get(id);
      if (!target) return { rows: [] };
      // מדמה partial unique index: בקשה accepted אחרת לאותו post_id
      const clash = [...coordStore.values()].some(
        (c) => c.id !== id && c.post_id === target.post_id && c.request_status === 'accepted'
      );
      if (clash) {
        const err = new Error('duplicate key value violates unique constraint "uniq_one_accepted_per_post"');
        err.code = '23505';
        err.constraint = 'uniq_one_accepted_per_post';
        throw err;
      }
      return setStatus(id, 'accepted');
    }
    if (s.startsWith('update coordination_requests') && s.includes('set coordination_status =')) {
      const [id, stage] = params;
      const row = coordStore.get(id);
      if (!row) return { rows: [] };
      row.coordination_status = stage; row.updated_at = now();
      return { rows: [{ ...row }] };
    }
    if (s.startsWith('update coordination_requests') && s.includes('set training_execution_status =')) {
      const [id, execStatus, reason] = params;
      const row = coordStore.get(id);
      if (!row) return { rows: [] };
      row.training_execution_status = execStatus;
      if (execStatus === 'completed') row.completed_at = now();
      if (execStatus === 'cancelled') row.cancellation_reason = reason ?? null;
      row.updated_at = now();
      return { rows: [{ ...row }] };
    }

    throw new Error('fakePgCoord: unhandled SQL: ' + sql);
  }

  function setStatus(id, status) {
    const row = coordStore.get(id);
    if (!row) return { rows: [] };
    row.request_status = status; row.updated_at = now();
    return { rows: [{ ...row }] };
  }

  return {
    query: (sql, params) => Promise.resolve(run(sql, params)),
    connect: () => Promise.resolve({
      query: (sql, params) => Promise.resolve(run(sql, params)),
      release: () => {},
    }),
    _coords: coordStore,
    getVersion: () => ver,
  };
}
