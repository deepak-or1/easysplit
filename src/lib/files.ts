import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db";
import { newId } from "./ids";

/**
 * Local-disk upload storage (receipt photos, Venmo QR images), served via
 * /api/files/[name]. Production: swap for S3 / Supabase Storage — only this
 * module and that route touch the filesystem.
 */

const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

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

export function isSupportedImage(mime: string): boolean {
  return mime in EXT_BY_MIME;
}

/** Persist an upload; returns the stored filename (safe to embed in URLs). */
export function saveUpload(buffer: Buffer, mime: string): string {
  const ext = EXT_BY_MIME[mime] ?? "bin";
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const name = `${newId()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buffer);
  return name;
}

/** Resolve a stored filename to an absolute path — refuses traversal. */
export function resolveUpload(name: string): string | null {
  if (!/^[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(name)) return null;
  const full = path.join(UPLOADS_DIR, name);
  if (!full.startsWith(UPLOADS_DIR)) return null;
  return fs.existsSync(full) ? full : null;
}
