-- Settle — Postgres / Supabase schema (production path).
-- Keep in sync with src/lib/schema.sql (the SQLite schema used for local dev).
--
-- Differences from the SQLite version are idiomatic translations only:
--   * INTEGER 0/1 flags  -> BOOLEAN
--   * TEXT datetime()    -> TIMESTAMPTZ DEFAULT now()
--   * REAL               -> DOUBLE PRECISION
-- Table names, columns, CHECK constraints, foreign keys and indexes match.
-- To use this in production: apply this file, then swap src/lib/db.ts for a
-- Postgres client (the rest of the app only talks to src/lib/store.ts).

CREATE TABLE IF NOT EXISTS splits (
  id              TEXT PRIMARY KEY,
  host_key        TEXT NOT NULL,
  restaurant_name TEXT,
  date            TEXT,
  host_name       TEXT NOT NULL,
  venmo_username  TEXT,
  venmo_qr_path   TEXT,
  tip_type        TEXT NOT NULL DEFAULT 'percent' CHECK (tip_type IN ('percent','amount')),
  tip_value       DOUBLE PRECISION NOT NULL DEFAULT 20,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipts (
  id         TEXT PRIMARY KEY,
  split_id   TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  image_path TEXT,
  ocr_json   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_receipts_split ON receipts(split_id);

CREATE TABLE IF NOT EXISTS receipt_items (
  id               TEXT PRIMARY KEY,
  receipt_id       TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0,
  shared_by_all    BOOLEAN NOT NULL DEFAULT false,
  sort_order       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_receipt ON receipt_items(receipt_id);

CREATE TABLE IF NOT EXISTS participants (
  id          TEXT PRIMARY KEY,
  split_id    TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_host     BOOLEAN NOT NULL DEFAULT false,
  paid_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (paid_status IN ('unpaid','reported','confirmed')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_participants_split ON participants(split_id);

CREATE TABLE IF NOT EXISTS claims (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  share_n        INTEGER NOT NULL,
  share_d        INTEGER NOT NULL CHECK (share_d > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_claims_item ON claims(item_id);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  split_id       TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('reported','confirmed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
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
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_split ON messages(split_id);

-- Maps a phone number to its active split/participant so SMS claims route
-- without the guest re-identifying every text. See src/lib/sms.ts.
CREATE TABLE IF NOT EXISTS phone_sessions (
  phone          TEXT PRIMARY KEY,
  split_id       TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  participant_id TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
