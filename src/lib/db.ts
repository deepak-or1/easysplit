import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * SQLite via better-sqlite3 — zero-config local persistence. The schema is
 * idempotent (CREATE TABLE IF NOT EXISTS) and applied on every open.
 *
 * Production path: swap this module for a Postgres/Supabase client — the rest
 * of the app only talks to src/lib/store.ts. supabase/migration.sql has the
 * equivalent DDL.
 */

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const DB_PATH = process.env.DATABASE_FILE ?? path.join(DATA_DIR, "settle.db");

// Next dev hot-reloads modules; keep one connection on globalThis.
const globalForDb = globalThis as unknown as { __settleDb?: Database.Database };

export function getDb(): Database.Database {
  if (globalForDb.__settleDb) return globalForDb.__settleDb;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8"));
  globalForDb.__settleDb = db;
  return db;
}

export { DATA_DIR };
