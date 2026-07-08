import { z } from "zod";
import { createSplit, type NewItemInput } from "@/lib/store";
import { saveUpload } from "@/lib/files";
import { parseVenmoInput } from "@/lib/venmo";
import type { CreateSplitResponse } from "@/lib/api";

/**
 * POST /api/splits — create a split from the host's (already corrected) items.
 * See docs/CONTRACTS.md §POST /api/splits.
 */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

type DecodedUpload = { buffer: Buffer; mime: string } | { error: string };

/** Parse a `data:<mime>;base64,<payload>` URL, rejecting anything > 8 MB decoded. */
function decodeDataUrl(dataUrl: string): DecodedUpload {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return { error: "invalid data URL" };
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength === 0) return { error: "invalid data URL" };
  if (buffer.byteLength > MAX_UPLOAD_BYTES) return { error: "image too large (max 8 MB)" };
  return { buffer, mime: match[1] };
}

const itemSchema = z.object({
  name: z.string().min(1, "each item needs a name").max(80, "item name is too long"),
  quantity: z
    .number()
    .int("quantity must be a whole number")
    .min(1, "quantity must be at least 1"),
  unitPriceCents: z.number().int("prices must be whole cents").min(0, "prices can't be negative"),
  totalCents: z.number().int("prices must be whole cents").min(0, "prices can't be negative"),
  sharedByAll: z.boolean().optional(),
});

const createSchema = z.object({
  hostName: z.string().min(1, "your name is required").max(40, "name is too long"),
  restaurantName: z.string().max(80).nullish(),
  date: z.string().max(40).nullish(),
  venmoUsername: z.string().nullish(),
  venmoQrDataUrl: z.string().nullish(),
  receiptImageDataUrl: z.string().nullish(),
  tipType: z.enum(["percent", "amount"]),
  tipValue: z.number().min(0, "tip can't be negative"),
  taxCents: z.number().int("tax must be whole cents").min(0, "tax can't be negative"),
  items: z.array(itemSchema).min(1, "add at least one item"),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, {
      status: 400,
    });
  }
  const data = parsed.data;

  let imagePath: string | null = null;
  if (data.receiptImageDataUrl) {
    const decoded = decodeDataUrl(data.receiptImageDataUrl);
    if ("error" in decoded) return Response.json({ error: decoded.error }, { status: 400 });
    imagePath = await saveUpload(decoded.buffer, decoded.mime);
  }

  let venmoQrPath: string | null = null;
  if (data.venmoQrDataUrl) {
    const decoded = decodeDataUrl(data.venmoQrDataUrl);
    if ("error" in decoded) return Response.json({ error: decoded.error }, { status: 400 });
    venmoQrPath = await saveUpload(decoded.buffer, decoded.mime);
  }

  const items: NewItemInput[] = data.items.map((it) => ({
    name: it.name,
    quantity: it.quantity,
    unitPriceCents: it.unitPriceCents,
    totalCents: it.totalCents,
    sharedByAll: it.sharedByAll ?? false,
  }));

  const result = await createSplit({
    restaurantName: data.restaurantName ?? null,
    date: data.date ?? null,
    hostName: data.hostName,
    venmoUsername: data.venmoUsername ? parseVenmoInput(data.venmoUsername) : null,
    venmoQrPath,
    tipType: data.tipType,
    tipValue: data.tipValue,
    taxCents: data.taxCents,
    imagePath,
    items,
  });

  const response: CreateSplitResponse = {
    splitId: result.splitId,
    hostKey: result.hostKey,
    hostParticipantId: result.hostParticipantId,
    url: `/split/${result.splitId}`,
  };
  return Response.json(response);
}
