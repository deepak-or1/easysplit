import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DATA_DIR } from "./db";
import { newId } from "./ids";

/**
 * Upload storage (receipt photos, Venmo QR images) with two backends:
 *
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set → Supabase Storage (public
 *     bucket "uploads"), so files persist on Vercel's ephemeral filesystem.
 *   otherwise → local disk under DATA_DIR/uploads, served by /api/files/[name].
 *
 * The stored *name* (an opaque filename) is what the DB persists and what the
 * app embeds in `/api/files/<name>`. In Supabase mode that route 302-redirects
 * to the object's public URL; on disk it streams the bytes.
 */

const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const BUCKET = "uploads";
/** Safe stored-name shape: `<id>.<ext>` — also blocks path traversal / open redirects. */
const NAME_RE = /^[A-Za-z0-9_-]+\.[a-z0-9]+$/;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
};

export const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
};

function supabaseStorageEnabled(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// One client per process; also ensures the public bucket exists on first use.
let clientPromise: Promise<SupabaseClient> | null = null;
function getSupabase(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(
        process.env.SUPABASE_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        { auth: { persistSession: false } },
      );
      // Create-if-missing, as a public bucket.
      const { data } = await client.storage.getBucket(BUCKET);
      if (!data) await client.storage.createBucket(BUCKET, { public: true });
      return client;
    })();
  }
  return clientPromise;
}

/** Persist an upload; returns the stored filename (safe to embed in URLs). */
export async function saveUpload(buffer: Buffer, mime: string): Promise<string> {
  const ext = EXT_BY_MIME[mime] ?? "bin";
  const name = `${newId()}.${ext}`;
  if (supabaseStorageEnabled()) {
    const client = await getSupabase();
    const { error } = await client.storage
      .from(BUCKET)
      .upload(name, buffer, { contentType: mime, upsert: false });
    if (error) throw new Error(`upload failed: ${error.message}`);
    return name;
  }
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer);
  return name;
}

/**
 * Public URL for a stored upload when running in Supabase mode, else null (disk
 * mode streams the bytes instead). Returns null for malformed names.
 */
export function getPublicUrl(name: string): string | null {
  if (!supabaseStorageEnabled()) return null;
  if (!NAME_RE.test(name)) return null;
  const base = (process.env.SUPABASE_URL as string).replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${BUCKET}/${name}`;
}

/** Resolve a stored filename to an absolute path — refuses traversal. */
export function resolveUpload(name: string): string | null {
  if (!NAME_RE.test(name)) return null;
  const full = path.join(UPLOADS_DIR, name);
  if (!full.startsWith(UPLOADS_DIR)) return null;
  return fs.existsSync(full) ? full : null;
}
