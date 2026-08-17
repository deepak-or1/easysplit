-- EasySplit — Postgres / Supabase schema (production path).
--
-- PARITY, NOT IDIOMATIC TRANSLATION. This schema is a deliberate byte-for-byte
-- mirror of src/lib/schema.sql (the SQLite dev schema), NOT a Postgres-idiomatic
-- port. The reason: the app writes SQL exactly once in src/lib/store.ts and runs
-- it on either driver, and every row mapper in store.ts reads the raw column
-- values. So the two schemas must return identically-shaped values:
--
--   * Boolean flags (is_host, shared_by_all) stay INTEGER 0/1 — NOT BOOLEAN —
--     so `is_host === 1` / `shared_by_all === 1` hold on both drivers.
--   * Timestamps stay TEXT in SQLite's exact `YYYY-MM-DD HH24:MI:SS` shape,
--     defaulted via to_char(now() AT TIME ZONE 'utc', ...) — NOT TIMESTAMPTZ —
--     so created_at/joined_at strings are byte-compatible and sort correctly.
--   * tip_value is DOUBLE PRECISION (returned as a JS number by node-pg).
--
-- This file is applied automatically & idempotently at runtime by
-- src/lib/db.ts (it embeds the same DDL as PG_SCHEMA) on first request; keeping
-- the two in sync is required. You can also run it by hand against a fresh DB.

CREATE TABLE IF NOT EXISTS splits (
  id              TEXT PRIMARY KEY,
  host_key        TEXT NOT NULL,
  restaurant_name TEXT,
  date            TEXT,
  host_name       TEXT NOT NULL,
  venmo_username  TEXT,
  venmo_qr_path   TEXT,
  zelle_handle    TEXT, -- enrolled email or 10-digit US phone
  tip_type        TEXT NOT NULL DEFAULT 'percent' CHECK (tip_type IN ('percent','amount')),
  tip_value       DOUBLE PRECISION NOT NULL DEFAULT 20,
  discount_type   TEXT CHECK (discount_type IN ('percent','amount')), -- NULL = no discount
  discount_value  DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  split_type      TEXT NOT NULL DEFAULT 'restaurant' CHECK (split_type IN ('restaurant','grocery')),
  created_at      TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS receipts (
  id         TEXT PRIMARY KEY,
  split_id   TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  image_path TEXT,
  ocr_json   TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_receipts_split ON receipts(split_id);

CREATE TABLE IF NOT EXISTS receipt_items (
  id               TEXT PRIMARY KEY,
  receipt_id       TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0,
  shared_by_all    INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_receipt ON receipt_items(receipt_id);

CREATE TABLE IF NOT EXISTS participants (
  id          TEXT PRIMARY KEY,
  split_id    TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_host     INTEGER NOT NULL DEFAULT 0,
  is_birthday INTEGER NOT NULL DEFAULT 0,
  paid_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (paid_status IN ('unpaid','reported','confirmed')),
  joined_at   TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_participants_split ON participants(split_id);

CREATE TABLE IF NOT EXISTS claims (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  share_n        INTEGER NOT NULL,
  share_d        INTEGER NOT NULL CHECK (share_d > 0),
  created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE (item_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_claims_item ON claims(item_id);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  split_id       TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('reported','confirmed')),
  created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_payments_split ON payments(split_id);

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  split_id       TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  participant_id TEXT,
  channel        TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','sms')),
  direction      TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  body           TEXT NOT NULL,
  reply          TEXT,
  created_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_messages_split ON messages(split_id);

-- Maps a phone number to its active split/participant so SMS claims route
-- without the guest re-identifying every text. See src/lib/sms.ts.
CREATE TABLE IF NOT EXISTS phone_sessions (
  phone          TEXT PRIMARY KEY,
  split_id       TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  participant_id TEXT,
  updated_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

-- Best-effort rate limiting for money-spending endpoints (LLM OCR).

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1
);

-- Additive migrations for databases created before these columns existed. The
-- CREATE TABLE statements above are IF NOT EXISTS, so they never alter a table
-- that already exists. Kept in sync with ADDITIVE_MIGRATIONS_PG in src/lib/db.ts.
ALTER TABLE splits ADD COLUMN IF NOT EXISTS zelle_handle TEXT;
ALTER TABLE splits ADD COLUMN IF NOT EXISTS split_type TEXT NOT NULL DEFAULT 'restaurant' CHECK (split_type IN ('restaurant','grocery'));
ALTER TABLE participants ADD COLUMN IF NOT EXISTS is_birthday INTEGER NOT NULL DEFAULT 0;
ALTER TABLE splits ADD COLUMN IF NOT EXISTS discount_type TEXT CHECK (discount_type IN ('percent','amount'));
ALTER TABLE splits ADD COLUMN IF NOT EXISTS discount_value DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Row-Level Security. The app reaches Postgres only through the server-side
-- pool in src/lib/db.ts, connecting as the table owner — which RLS never
-- restricts. Enabling RLS with no policies closes the one other door:
-- Supabase's auto-generated public REST API.
ALTER TABLE splits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits    ENABLE ROW LEVEL SECURITY;
