-- ============================================================================
-- coordination-app — סכמת Supabase Postgres (fresh start, ללא migration מ-Redis)
-- ============================================================================
-- להרצה מול ה-Direct connection (port 5432 / DIRECT_URL) או דרך SQL Editor של
-- Supabase, בסביבת Preview בלבד. אין להריץ מול Production בשלב זה.
--
-- טבלאות Auth.js תואמות ל-@auth/pg-adapter@1.11.3 — שמות העמודות וה-casing
-- (camelCase במרכאות כפולות) מאומתים מקוד המקור של האדפטר. אין לשנותם.
-- users.id הוא uuid (האדפטר אגנוסטי לסוג ה-id: לעולם אינו מייצר ואינו ממיר id,
-- אלא נשען על ה-DEFAULT של העמודה ומחזיר אותו). כל ה-FKs שלנו uuid כדי להתאים.
-- gen_random_uuid() מובנה ב-Postgres 13+ (Supabase v15) ללא extension.
-- ============================================================================

-- ---------- Auth.js core (מנוהל ע"י @auth/pg-adapter) ----------

create table users (
  id              uuid primary key default gen_random_uuid(),
  name            text,
  email           text not null unique,
  "emailVerified" timestamptz,
  image           text
);

create table accounts (
  id                  uuid primary key default gen_random_uuid(),
  "userId"            uuid not null references users(id) on delete cascade,
  type                text not null,
  provider            text not null,
  "providerAccountId" text not null,
  access_token        text,
  expires_at          bigint,          -- unix seconds (האדפטר עושה parseInt)
  refresh_token       text,
  id_token            text,
  scope               text,
  session_state       text,
  token_type          text,
  unique (provider, "providerAccountId")
);

create table sessions (
  id             uuid primary key default gen_random_uuid(),
  "userId"       uuid not null references users(id) on delete cascade,
  "sessionToken" text not null unique,
  expires        timestamptz not null
);

create table verification_token (
  identifier text not null,
  token      text not null,
  expires    timestamptz not null,
  primary key (identifier, token)
);

-- ---------- פרופילי הרשאה (lib/users.js) ----------
-- admin אינו נשמר כאן — נגזר מ-ADMIN_EMAILS בזמן ריצה (lib/authz.js).

create table profiles (
  user_id                 uuid primary key references users(id) on delete cascade,
  email                   text not null,
  name                    text,
  approval_status         text not null default 'pending'
    check (approval_status in ('pending','approved','rejected','disabled')),
  referral_source         text
    check (referral_source is null or char_length(referral_source) <= 300),
  onboarding_completed_at timestamptz,
  request_active          boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  last_changed_by         uuid           -- user_id של המנהל המבצע; ללא FK קשיח (תואם לקוד)
);
create index idx_profiles_approval on profiles (approval_status);

-- ---------- פרסומי אימונים (lib/posting.js + app/api/postings) ----------

create table postings (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references users(id),
  owner_name    text,
  status        text not null default 'available',
  manual_status text check (manual_status in ('done','cancelled')),  -- NULL = אין override
  data          jsonb not null default '{}',                          -- שדות הטופס (מסוקים/קרקע)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_postings_owner  on postings (owner_id);
create index idx_postings_status on postings (status);

-- ---------- בקשות תיאום (lib/coord.js + app/api/coordination-requests) ----------

create table coordination_requests (
  id                        uuid primary key default gen_random_uuid(),
  post_id                   uuid not null references postings(id) on delete cascade,
  requester_id              uuid references users(id),
  requester_name            text,
  request_status            text not null default 'pending'
    check (request_status in ('pending','accepted','rejected','cancelled')),
  coordination_status       text not null default 'initial_coordination_done'
    check (coordination_status in ('initial_coordination_done','specific_times_closed','planning_summary_done')),
  training_execution_status text not null default 'pending'
    check (training_execution_status in ('pending','completed','cancelled','unknown')),
  completed_at              timestamptz,
  cancellation_reason       text,
  data                      jsonb not null default '{}',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index idx_coord_post      on coordination_requests (post_id);
create index idx_coord_requester on coordination_requests (requester_id);
create index idx_coord_status    on coordination_requests (request_status);

-- גיבוי ברמת-DB לאינווריאנט "accepted יחיד לכל אימון" (mutatorAccept). השומר
-- האמיתי מפני race: גם אם שתי בקשות מנסות להתקבל בו-זמנית, השנייה נדחית ברמת ה-DB.
create unique index uniq_one_accepted_per_post
  on coordination_requests (post_id) where request_status = 'accepted';

-- ---------- התראות in-app (lib/notify.js) ----------
-- id עסקי דטרמיניסטי `${type}:${sourceId}`; ה-PK ההרכבי ≡ HSETNX (create-if-absent).

create table notifications (
  recipient_id uuid not null references users(id) on delete cascade,
  id           text not null,
  type         text not null check (type in ('request_new','request_accepted','request_rejected')),
  actor_id     uuid,
  data         jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  primary key (recipient_id, id)
);
create index idx_notif_unread on notifications (recipient_id, read_at);
create index idx_notif_recent on notifications (recipient_id, created_at desc);

-- ---------- version ברמת-אוסף (שמירת חוזה {value, rev} + 409 מול ה-UI) ----------
-- לב מנגנון ה-OCC: UPDATE ... WHERE version=$expected מחליף את ה-CAS/Lua הישן.

create table collection_versions (
  key     text primary key,               -- 'postings' | 'coordination-requests'
  version bigint not null default 0
);
insert into collection_versions (key, version)
values ('postings', 0), ('coordination-requests', 0);
