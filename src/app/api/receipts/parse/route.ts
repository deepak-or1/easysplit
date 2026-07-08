import { z } from "zod";
import { parseReceiptImage } from "@/lib/ocr";
import { DEMO_RECEIPT } from "@/lib/demo-receipt";
import type { ReceiptParseResponse } from "@/lib/types";

/**
 * POST /api/receipts/parse — OCR a receipt image, or return the demo receipt.
 * Persists nothing. See docs/CONTRACTS.md §POST /api/receipts/parse.
 */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

type DecodedUpload = { buffer: Buffer; mime: string } | { error: string };

function decodeDataUrl(dataUrl: string): DecodedUpload {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return { error: "invalid data URL" };
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength === 0) return { error: "invalid data URL" };
  if (buffer.byteLength > MAX_UPLOAD_BYTES) return { error: "image too large (max 8 MB)" };
  return { buffer, mime: match[1] };
}

const parseSchema = z.union([
  z.object({ demo: z.literal(true) }),
  z.object({ imageDataUrl: z.string().min(1, "imageDataUrl is required") }),
]);

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = parseSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, {
      status: 400,
    });
  }

  if ("demo" in parsed.data) {
    const response: ReceiptParseResponse = { source: "mock", receipt: DEMO_RECEIPT };
    return Response.json(response);
  }

  const decoded = decodeDataUrl(parsed.data.imageDataUrl);
  if ("error" in decoded) return Response.json({ error: decoded.error }, { status: 400 });

  const result = await parseReceiptImage(decoded.buffer, decoded.mime);
  return Response.json(result);
}
