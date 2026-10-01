// לקוח Postgres מזויף לבדיקות יחידה — מיישם את החלק מ-pg שבו lib/users.js משתמש:
//   • db.query(sql, params)
//   • db.connect() → client עם query/release (לטרנזקציות)
// הוא מפרש את ה-SQL הספציפי של lib/users.js לפי תבניות ומנהל מאגר שורות בזיכרון
// (עמודות ב-snake_case, כמו ב-DB). begin/commit/rollback הם no-op.
//
// אין כאן אכיפת נעילה אמיתית (FOR UPDATE) — מרוץ בפועל נבדק ב-Preview מול Postgres
// עם שני חיבורים עצמאיים. הבדיקות כאן מכסות לוגיקה, חוזים, שדות וסיבות שגיאה.

export function makeFakeDb(initialRows = []) {
  const store = new Map();
  let seq = 0;
  const now = () => new Date(Date.UTC(2026, 0, 1) + seq++ * 1000);

  for (const r of initialRows) {
    store.set(r.user_id, {
      user_id: r.user_id,
      email: r.email ?? null,
      name: r.name ?? null,
      approval_status: r.approval_status ?? 'pending',
      referral_source: r.referral_source ?? null,
      onboarding_completed_at: r.onboarding_completed_at ?? null,
      request_active: r.request_active ?? true,
      created_at: r.created_at ?? now(),
      updated_at: r.updated_at ?? now(),
      last_changed_by: r.last_changed_by ?? null,
    });
  }

  function run(sql, params = []) {
    const s = sql.trim().toLowerCase();

    if (s === 'begin' || s === 'commit' || s === 'rollback') return { rows: [] };

    // ensureProfileOnSignIn — insert ... on conflict do nothing
    if (s.startsWith('insert into profiles')) {
      const [userId, email, name] = params;
      if (store.has(userId)) return { rows: [] };
      const row = {
        user_id: userId,
        email,
        name: name ?? null,
        approval_status: 'pending',
        referral_source: null,
        onboarding_completed_at: null,
        request_active: true,
        created_at: now(),
        updated_at: now(),
        last_changed_by: null,
      };
      store.set(userId, row);
      return { rows: [{ ...row }] };
    }

    // reactivation update (WHERE ... request_active = false)
    if (s.includes('set request_active = true') && s.includes('request_active = false')) {
      const [userId] = params;
      const row = store.get(userId);
      if (row && row.approval_status === 'pending' && row.request_active === false) {
        row.request_active = true;
        row.updated_at = now();
        return { rows: [{ ...row }] };
      }
      return { rows: [] };
    }

    // listProfiles
    if (s.includes('order by created_at asc')) {
      const rows = [...store.values()].sort((a, b) => a.created_at - b.created_at);
      return { rows: rows.map((r) => ({ ...r })) };
    }

    // cancelRequest update (literal approval_status = 'pending', referral_source = null)
    if (s.includes("approval_status = 'pending'") && s.includes('referral_source = null')) {
      const userId = params[0];
      const actingAdminId = params[1] ?? null;
      const row = store.get(userId);
      if (!row) return { rows: [] };
      row.approval_status = 'pending';
      row.referral_source = null;
      row.onboarding_completed_at = null;
      row.request_active = false;
      row.updated_at = now();
      row.last_changed_by = actingAdminId;
      return { rows: [{ ...row }] };
    }

    // setApprovalStatus update (approval_status = $2)
    if (s.includes('set approval_status = $2')) {
      const [userId, toStatus, actingAdminId] = params;
      const row = store.get(userId);
      if (!row) return { rows: [] };
      row.approval_status = toStatus;
      row.updated_at = now();
      row.last_changed_by = actingAdminId ?? null;
      return { rows: [{ ...row }] };
    }

    // setReferral update (referral_source = $2, coalesce onboarding)
    if (s.includes('set referral_source = $2')) {
      const [userId, text] = params;
      const row = store.get(userId);
      if (!row) return { rows: [] };
      row.referral_source = text;
      row.onboarding_completed_at = row.onboarding_completed_at || now();
      row.request_active = true;
      row.updated_at = now();
      return { rows: [{ ...row }] };
    }

    // select * from profiles where user_id = $1  (plain or "for update")
    if (s.startsWith('select * from profiles where user_id')) {
      const row = store.get(params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }

    throw new Error('fakePg: unhandled SQL: ' + sql);
  }

  const db = {
    query: (sql, params) => Promise.resolve(run(sql, params)),
    connect: () =>
      Promise.resolve({
        query: (sql, params) => Promise.resolve(run(sql, params)),
        release: () => {},
      }),
    _store: store, // חשיפה לבדיקות
  };
  return db;
}
