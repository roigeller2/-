// fake Postgres לבדיקות postingsRepo — מיישם את החלק מ-pg שבו הוא משתמש:
//   db.connect() → client עם query/release; begin/commit/rollback כ-no-op.
// מנהל טבלת postings (לפי id) ושורת collection_versions('postings') בזיכרון, ומפרש
// את ה-SQL הספציפי של הריפו. אין נעילה אמיתית — מרוץ אמיתי נבדק ב-Preview.

export function makeFakePostingsDb(initialRows = [], initialVersion = 0) {
  const postings = new Map();
  let version = initialVersion;
  let seq = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1) + seq++ * 1000);

  for (const r of initialRows) {
    postings.set(r.id, {
      id: r.id,
      owner_id: r.owner_id ?? null,
      owner_name: r.owner_name ?? null,
      status: r.status ?? 'available',
      manual_status: r.manual_status ?? null,
      data: r.data ?? {},
      created_at: r.created_at ?? now(),
      updated_at: r.updated_at ?? now(),
    });
  }

  function run(sql, params = []) {
    const s = sql.trim().toLowerCase();

    if (s.startsWith('begin') || s === 'commit' || s === 'rollback') return { rows: [] };

    if (s.startsWith('insert into postings')) {
      const [ownerId, ownerName, dataJson] = params;
      const id = 'p' + (postings.size + 1);
      const row = {
        id,
        owner_id: ownerId ?? null,
        owner_name: ownerName ?? null,
        status: 'available',
        manual_status: null,
        data: typeof dataJson === 'string' ? JSON.parse(dataJson) : (dataJson ?? {}),
        created_at: now(),
        updated_at: now(),
      };
      postings.set(id, row);
      return { rows: [{ id }] };
    }

    if (s.startsWith('update collection_versions set version = version + 1')) {
      version += 1;
      return { rows: [{ version }] };
    }

    if (s.startsWith('select version from collection_versions')) {
      return { rows: [{ version }] };
    }

    if (s.startsWith('select * from postings order by created_at asc')) {
      const rows = [...postings.values()].sort((a, b) => a.created_at - b.created_at);
      return { rows: rows.map((r) => ({ ...r })) };
    }

    if (s.startsWith('select * from postings where id')) {
      const row = postings.get(params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }

    if (s.startsWith('update postings set manual_status')) {
      const [id, manualStatus] = params;
      const row = postings.get(id);
      if (!row) return { rows: [] };
      row.manual_status = manualStatus ?? null;
      row.updated_at = now();
      return { rows: [{ ...row }] };
    }

    throw new Error('fakePgPostings: unhandled SQL: ' + sql);
  }

  return {
    query: (sql, params) => Promise.resolve(run(sql, params)),
    connect: () =>
      Promise.resolve({
        query: (sql, params) => Promise.resolve(run(sql, params)),
        release: () => {},
      }),
    _postings: postings,
    getVersion: () => version,
  };
}
