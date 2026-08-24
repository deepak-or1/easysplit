-- EasySplit — SQLite schema (local dev). A Postgres/Supabase translation lives
-- in supabase/migration.sql; keep the two in sync.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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
  tip_value       REAL NOT NULL DEFAULT 20,
  discount_type   TEXT CHECK (discount_type IN ('percent','amount')), -- NULL = no discount
  discount_value  REAL NOT NULL DEFAULT 0,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled')),
  split_type      TEXT NOT NULL DEFAULT 'restaurant' CHECK (split_type IN ('restaurant','grocery')),
  group_size      INTEGER, -- NULL = host declared no headcount; shared items split by joiners only
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receipts (
  id         TEXT PRIMARY KEY,
  split_id   TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  image_path TEXT,
  ocr_json   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  joined_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_participants_split ON participants(split_id);

CREATE TABLE IF NOT EXISTS claims (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES receipt_items(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  share_n        INTEGER NOT NULL,
  share_d        INTEGER NOT NULL CHECK (share_d > 0),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_claims_item ON claims(item_id);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  split_id       TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('reported','confirmed')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
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
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_split ON messages(split_id);

-- Maps a phone number to its active split/participant so SMS claims route
-- without the guest re-identifying every text. See src/lib/sms.ts.
CREATE TABLE IF NOT EXISTS phone_sessions (
  phone          TEXT PRIMARY KEY,
  split_id       TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  participant_id TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Best-effort rate limiting for endpoints that spend money (LLM OCR). Keys
-- look like "ocr:ip:1.2.3.4" or "ocr:global"; approximate counting is fine.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1
);
