import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import type BetterSqlite3 from "better-sqlite3";

/**
 * Storage adapter — one tiny async interface, two drivers behind it.
 *
 *   DATABASE_URL set   → Postgres (Supabase). A `pg.Pool` on globalThis.
 *   DATABASE_URL unset → better-sqlite3, exactly as local dev always has.
 *
 * store.ts writes SQL ONCE, in the SQLite-compatible dialect with `?`
 * placeholders; the Postgres adapter mechanically rewrites `?` → `$1..$n`.
 * No other module knows which driver is running.
 *
 * better-sqlite3 is a native module that must NEVER load on Vercel — so it is
 * imported lazily, inside the SQLite branch only. When DATABASE_URL is set the
 * `import("better-sqlite3")` line is never reached.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.DATABASE_FILE ?? path.join(DATA_DIR, "settle.db");

/** Read-only + write query surface handed to a transaction closure. */
export interface Query {
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
}

/** The full adapter: the query surface plus a transaction runner. */
export interface Db extends Query {
  tx<T>(fn: (q: Query) => Promise<T>): Promise<T>;
}

/* ------------------------------------------------------------------ */
/* Postgres dialect                                                    */
/* ------------------------------------------------------------------ */

/**
 * Rewrite SQLite's positional `?` placeholders to Postgres' `$1..$n`. The SQL
 * in store.ts never contains a literal `?` outside a placeholder, so a plain
 * left-to-right substitution is exact.
 */
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Postgres schema — parity translation of src/lib/schema.sql. KEY DECISION:
 * boolean flags stay INTEGER 0/1 and timestamps stay TEXT in SQLite's exact
 * `YYYY-MM-DD HH24:MI:SS` shape, so every row mapper in store.ts reads
 * byte-identical values regardless of driver. Kept in sync with
 * supabase/migration.sql (same DDL). Bootstrapped idempotently, once per
 * process, before the first query.
 */
const PG_SCHEMA = `
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

CREATE TABLE IF NOT EXISTS phone_sessions (
  phone          TEXT PRIMARY KEY,
  split_id       TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  participant_id TEXT,
  updated_at     TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1
);

-- The app reaches Postgres only through this server-side pool, connecting as
-- the table owner — which RLS never restricts. Enabling RLS with no policies
-- closes the one other door: Supabase's auto-generated public REST API.
ALTER TABLE splits         ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE claims         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits    ENABLE ROW LEVEL SECURITY;
`;

/**
 * Additive migrations for databases created before a column existed. The
 * bootstrap above is CREATE TABLE IF NOT EXISTS, which is a no-op against an
 * existing table — so every column added after a schema ships needs an entry
 * here too, in both dialects. Kept in sync with the tail of
 * supabase/migration.sql. Order matters only in that each is independent.
 */
const ADDITIVE_MIGRATIONS_PG = [
  "ALTER TABLE splits ADD COLUMN IF NOT EXISTS zelle_handle TEXT",
  "ALTER TABLE splits ADD COLUMN IF NOT EXISTS split_type TEXT NOT NULL DEFAULT 'restaurant' CHECK (split_type IN ('restaurant','grocery'))",
  "ALTER TABLE participants ADD COLUMN IF NOT EXISTS is_birthday INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE splits ADD COLUMN IF NOT EXISTS discount_type TEXT CHECK (discount_type IN ('percent','amount'))",
  "ALTER TABLE splits ADD COLUMN IF NOT EXISTS discount_value DOUBLE PRECISION NOT NULL DEFAULT 0",
];

/** Same migrations, SQLite dialect — no IF NOT EXISTS, so each is try/caught. */
const ADDITIVE_MIGRATIONS_SQLITE = [
  "ALTER TABLE splits ADD COLUMN zelle_handle TEXT",
  "ALTER TABLE splits ADD COLUMN split_type TEXT NOT NULL DEFAULT 'restaurant' CHECK (split_type IN ('restaurant','grocery'))",
  "ALTER TABLE participants ADD COLUMN is_birthday INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE splits ADD COLUMN discount_type TEXT CHECK (discount_type IN ('percent','amount'))",
  "ALTER TABLE splits ADD COLUMN discount_value REAL NOT NULL DEFAULT 0",
];

interface PgGlobals {
  __settlePgReady?: Promise<Pool>;
}

/**
 * Lazily create the pool (one per process, on globalThis for Next hot-reload
 * safety), bootstrap the schema once, and return the ready pool. Every query
 * awaits this, so the schema is guaranteed present before the first read/write.
 */
function readyPool(): Promise<Pool> {
  const g = globalThis as unknown as PgGlobals;
  if (g.__settlePgReady) return g.__settlePgReady;
  g.__settlePgReady = (async () => {
    try {
      const { Pool } = await import("pg");
      const url = process.env.DATABASE_URL as string;
      const host = new URL(url).hostname;
      const isLocal = host === "localhost" || host === "127.0.0.1";
      const pool = new Pool({
        connectionString: url,
        // Supabase (and most hosted PG) require TLS; managed certs are fine.
        ssl: isLocal ? undefined : { rejectUnauthorized: false },
      });
      await pool.query(PG_SCHEMA);
      // Additive migrations for databases created before these columns existed.
      for (const sql of ADDITIVE_MIGRATIONS_PG) await pool.query(sql);
      return pool;
    } catch (err) {
      // The promise is cached before it settles, so a rejected one would be
      // handed to every later query — one transient ALTER/lock failure at
      // boot would 500 the instance until it recycled. Drop it so the next
      // request bootstraps again; the failure itself still propagates.
      g.__settlePgReady = undefined;
      throw err;
    }
  })();
  return g.__settlePgReady;
}

function makePgAdapter(): Db {
  const get = async <T>(sql: string, params: unknown[] = []): Promise<T | undefined> => {
    const pool = await readyPool();
    const res = await pool.query(toPg(sql), params);
    return res.rows[0] as T | undefined;
  };
  const all = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const pool = await readyPool();
    const res = await pool.query(toPg(sql), params);
    return res.rows as T[];
  };
  const run = async (sql: string, params: unknown[] = []): Promise<void> => {
    const pool = await readyPool();
    await pool.query(toPg(sql), params);
  };
  const tx = async <T>(fn: (q: Query) => Promise<T>): Promise<T> => {
    const pool = await readyPool();
    const client = await pool.connect();
    const q: Query = {
      get: async <U>(sql: string, params: unknown[] = []) =>
        (await client.query(toPg(sql), params)).rows[0] as U | undefined,
      all: async <U>(sql: string, params: unknown[] = []) =>
        (await client.query(toPg(sql), params)).rows as U[],
      run: async (sql: string, params: unknown[] = []) => {
        await client.query(toPg(sql), params);
      },
    };
    try {
      await client.query("BEGIN");
      const result = await fn(q);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  };
  return { get, all, run, tx };
}

/* ------------------------------------------------------------------ */
/* SQLite dialect                                                      */
/* ------------------------------------------------------------------ */

interface SqliteGlobals {
  __settleSqlite?: BetterSqlite3.Database;
}

async function getSqlite(): Promise<BetterSqlite3.Database> {
  const g = globalThis as unknown as SqliteGlobals;
  if (g.__settleSqlite) return g.__settleSqlite;
  // Lazy: this line is unreachable when DATABASE_URL is set (Vercel).
  const { default: Database } = await import("better-sqlite3");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  // Additive migrations for databases created before these columns existed
  // (SQLite has no ADD COLUMN IF NOT EXISTS — a duplicate add just throws).
  for (const sql of ADDITIVE_MIGRATIONS_SQLITE) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
  g.__settleSqlite = db;
  return db;
}

function makeSqliteAdapter(): Db {
  const get = async <T>(sql: string, params: unknown[] = []): Promise<T | undefined> => {
    const db = await getSqlite();
    return db.prepare(sql).get(...params) as T | undefined;
  };
  const all = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const db = await getSqlite();
    return db.prepare(sql).all(...params) as T[];
  };
  const run = async (sql: string, params: unknown[] = []): Promise<void> => {
    const db = await getSqlite();
    db.prepare(sql).run(...params);
  };
  // better-sqlite3's own db.transaction() rejects async callbacks, so we drive
  // BEGIN/COMMIT/ROLLBACK manually. The connection is shared, so CONCURRENT
  // tx() calls (e.g. two rate-limit checks in a Promise.all) must not
  // interleave their BEGINs — queue them so each pair runs alone. Postgres
  // doesn't need this: its tx() checks out a dedicated client per call.
  let txChain: Promise<unknown> = Promise.resolve();
  const tx = <T>(fn: (q: Query) => Promise<T>): Promise<T> => {
    const runTx = async (): Promise<T> => {
      const db = await getSqlite();
      const q: Query = {
        get: async <U>(sql: string, params: unknown[] = []) =>
          db.prepare(sql).get(...params) as U | undefined,
        all: async <U>(sql: string, params: unknown[] = []) =>
          db.prepare(sql).all(...params) as U[],
        run: async (sql: string, params: unknown[] = []) => {
          db.prepare(sql).run(...params);
        },
      };
      db.exec("BEGIN");
      try {
        const result = await fn(q);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    };
    const result = txChain.then(runTx, runTx);
    txChain = result.catch(() => undefined);
    return result;
  };
  return { get, all, run, tx };
}

/* ------------------------------------------------------------------ */
/* Driver selection                                                    */
/* ------------------------------------------------------------------ */

let adapter: Db | undefined;

/** The storage adapter for this process — Postgres if DATABASE_URL is set, else SQLite. */
export function getDb(): Db {
  if (adapter) return adapter;
  adapter = process.env.DATABASE_URL ? makePgAdapter() : makeSqliteAdapter();
  return adapter;
}

export { DATA_DIR };
