// fake Postgres לבדיקות שכבת האחסון של notifications. מפרש את ה-SQL של lib/notify.js
// ומנהל טבלה בזיכרון (מפתח `${recipient_id}|${id}`). begin/commit/rollback = no-op.
// מחזיר rows ו-rowCount (ל-markAll). ON CONFLICT DO NOTHING ממומש לפי PK (recipient_id,id).

export function makeFakeNotifDb(initialRows = []) {
  const store = new Map(); // key → row
  let seq = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1) + seq++ * 1000);
  const keyOf = (recipient, id) => `${recipient}|${id}`;

  for (const r of initialRows) {
    store.set(keyOf(r.recipient_id, r.id), {
      recipient_id: r.recipient_id,
      id: r.id,
      type: r.type ?? 'request_new',
      actor_id: r.actor_id ?? null,
      data: r.data ?? {},
      created_at: r.created_at ?? now(),
      read_at: r.read_at ?? null,
    });
  }

  function run(sql, params = []) {
    const s = sql.trim().toLowerCase().replace(/\s+/g, ' ');
    if (s === 'begin' || s === 'commit' || s === 'rollback') return { rows: [], rowCount: 0 };

    if (s.startsWith('insert into notifications')) {
      const [recipient, id, type, actorId, dataJson, createdAt] = params;
      const k = keyOf(recipient, id);
      if (store.has(k)) return { rows: [], rowCount: 0 }; // on conflict do nothing
      store.set(k, {
        recipient_id: recipient, id, type, actor_id: actorId ?? null,
        data: typeof dataJson === 'string' ? JSON.parse(dataJson) : (dataJson ?? {}),
        created_at: createdAt ? new Date(createdAt) : now(),
        read_at: null,
      });
      return { rows: [{ id }], rowCount: 1 };
    }

    if (s.startsWith('delete from notifications')) {
      // trim: מחיקת הישנות מעבר ל-OFFSET עבור אותו recipient
      const [recipient, offset] = params;
      const rows = [...store.values()]
        .filter((r) => r.recipient_id === recipient)
        .sort((a, b) => b.created_at - a.created_at);
      const victims = rows.slice(offset);
      victims.forEach((v) => store.delete(keyOf(v.recipient_id, v.id)));
      return { rows: [], rowCount: victims.length };
    }

    if (s.startsWith('select * from notifications where recipient_id = $1 and id = $2')) {
      const row = store.get(keyOf(params[0], params[1]));
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    if (s.startsWith('select * from notifications where recipient_id = $1')) {
      const rows = [...store.values()].filter((r) => r.recipient_id === params[0]);
      return { rows: rows.map((r) => ({ ...r })), rowCount: rows.length };
    }

    if (s.startsWith('update notifications set read_at = now() where recipient_id = $1 and id = $2')) {
      const row = store.get(keyOf(params[0], params[1]));
      if (!row || row.read_at) return { rows: [], rowCount: 0 };
      row.read_at = now();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (s.startsWith('update notifications set read_at = now() where recipient_id = $1 and read_at is null')) {
      const rows = [...store.values()].filter((r) => r.recipient_id === params[0] && !r.read_at);
      rows.forEach((r) => { r.read_at = now(); });
      return { rows: [], rowCount: rows.length };
    }

    throw new Error('fakePgNotif: unhandled SQL: ' + sql);
  }

  return {
    query: (sql, params) => Promise.resolve(run(sql, params)),
    connect: () => Promise.resolve({
      query: (sql, params) => Promise.resolve(run(sql, params)),
      release: () => {},
    }),
    _store: store,
  };
}
