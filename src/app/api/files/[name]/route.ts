import fs from "node:fs";
import path from "node:path";
import { MIME_BY_EXT, resolveUpload } from "@/lib/files";

/** Serves stored uploads (receipt photos, Venmo QR images) from local disk. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const full = resolveUpload(name);
  if (!full) return Response.json({ error: "not found" }, { status: 404 });
  const ext = path.extname(full).slice(1).toLowerCase();
  const data = fs.readFileSync(full);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": MIME_BY_EXT[ext] ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
