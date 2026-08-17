import { z } from "zod";
import { createSplit, type NewItemInput } from "@/lib/store";
import { saveUpload } from "@/lib/files";
import { parseVenmoInput } from "@/lib/venmo";
import { parseZelleInput } from "@/lib/zelle";
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

/**
 * Tip bounds. `tipValue` feeds computeTipCents(), where a percent is multiplied
 * by the subtotal — an unbounded value there turns every later price into
 * Infinity and permanently breaks the room, so it is capped at parse time.
 */
const MAX_TIP_PERCENT = 500;
const MAX_TIP_CENTS = 10_000_000; // $100,000

/**
 * Discount bounds, the same shape as the tip ones with one difference: more
 * than 100% off a bill is meaningless, so the percent cap is 100 rather than
 * 500. An amount larger than the current subtotal is deliberately ALLOWED here
 * — the items can still change — and computeDiscountCents clamps it at compute
 * time instead.
 */
const MAX_DISCOUNT_PERCENT = 100;
const MAX_DISCOUNT_CENTS = MAX_TIP_CENTS; // $100,000

const createSchema = z
  .object({
    hostName: z.string().min(1, "your name is required").max(40, "name is too long"),
    restaurantName: z.string().max(80).nullish(),
    date: z.string().max(40).nullish(),
    venmoUsername: z.string().nullish(),
    zelleInput: z.string().max(80).nullish(),
    venmoQrDataUrl: z.string().nullish(),
    receiptImageDataUrl: z.string().nullish(),
    tipType: z.enum(["percent", "amount"]),
    tipValue: z.number().finite().min(0, "tip can't be negative"),
    discountType: z.enum(["percent", "amount"]).nullable().optional(),
    discountValue: z.number().finite().min(0, "discount can't be negative").optional(),
    taxCents: z.number().int("tax must be whole cents").min(0, "tax can't be negative"),
    splitType: z.enum(["restaurant", "grocery"]).optional(),
    items: z.array(itemSchema).min(1, "add at least one item"),
  })
  .superRefine((data, ctx) => {
    if (data.tipType === "percent") {
      if (data.tipValue > MAX_TIP_PERCENT) {
        ctx.addIssue({ code: "custom", message: "tip percent too large", path: ["tipValue"] });
      }
      return;
    }
    if (!Number.isInteger(data.tipValue)) {
      ctx.addIssue({ code: "custom", message: "tip must be whole cents", path: ["tipValue"] });
    } else if (data.tipValue > MAX_TIP_CENTS) {
      ctx.addIssue({ code: "custom", message: "tip too large", path: ["tipValue"] });
    }
  })
  .superRefine((data, ctx) => {
    // No type means no discount at all — the value rides along unused.
    if (!data.discountType) return;
    const value = data.discountValue ?? 0;
    if (data.discountType === "percent") {
      if (value > MAX_DISCOUNT_PERCENT) {
        ctx.addIssue({
          code: "custom",
          message: "discount percent too large",
          path: ["discountValue"],
        });
      }
      return;
    }
    if (!Number.isInteger(value)) {
      ctx.addIssue({
        code: "custom",
        message: "discount must be whole cents",
        path: ["discountValue"],
      });
    } else if (value > MAX_DISCOUNT_CENTS) {
      ctx.addIssue({ code: "custom", message: "discount too large", path: ["discountValue"] });
    }
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

  // A zero-value discount IS no discount: store none rather than an
  // (amount, 0) ghost the host dashboard reads as a live discount and
  // auto-expands its editor for.
  const discountType = data.discountType ?? null;
  const discountValue = data.discountValue ?? 0;
  const hasDiscount = discountType !== null && discountValue > 0;

  const result = await createSplit({
    restaurantName: data.restaurantName ?? null,
    date: data.date ?? null,
    hostName: data.hostName,
    venmoUsername: data.venmoUsername ? parseVenmoInput(data.venmoUsername) : null,
    zelleHandle: data.zelleInput ? (parseZelleInput(data.zelleInput)?.handle ?? null) : null,
    venmoQrPath,
    tipType: data.tipType,
    tipValue: data.tipValue,
    discountType: hasDiscount ? discountType : null,
    discountValue: hasDiscount ? discountValue : 0,
    taxCents: data.taxCents,
    splitType: data.splitType ?? "restaurant",
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
