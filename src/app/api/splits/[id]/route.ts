import { z } from "zod";
import {
  getHostKey,
  getRoomState,
  replaceItems,
  setBirthdayParticipants,
  updateSplitMeta,
  type EditableItem,
  type SplitMetaPatch,
} from "@/lib/store";
import { parseVenmoInput } from "@/lib/venmo";
import { parseZelleInput } from "@/lib/zelle";

/**
 * GET  /api/splits/[id] — public room state.
 * PATCH /api/splits/[id] — host-only edits (x-host-key). Full item replace.
 * See docs/CONTRACTS.md §GET/PATCH /api/splits/[id].
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await getRoomState(id);
  if (!state) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(state);
}

const patchItemSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "each item needs a name").max(80, "item name is too long"),
  quantity: z
    .number()
    .int("quantity must be a whole number")
    .min(1, "quantity must be at least 1"),
  unitPriceCents: z.number().int("prices must be whole cents").min(0, "prices can't be negative"),
  totalCents: z.number().int("prices must be whole cents").min(0, "prices can't be negative"),
  sharedByAll: z.boolean(),
});

/**
 * Tip bounds, mirroring POST /api/splits. `tipValue` feeds computeTipCents(),
 * where a percent is multiplied by the subtotal — an unbounded value there
 * turns every later price into Infinity and permanently breaks the room, so it
 * is capped at parse time.
 *
 * Checked in two layers, because a patch is partial. The schema below sees
 * only the fields THIS request carries, so two shapes would slip past it:
 * `{tipValue: 10000000}` on a percent room (no `tipType` sent, so the wider
 * amount cap gets applied to what will be read as a percent), and a bare
 * `{tipType: "percent"}` flip over a stored amount value. The PATCH handler
 * therefore re-checks the EFFECTIVE pair — each field falling back to the
 * room's stored value — before anything is written.
 */
const MAX_TIP_PERCENT = 500;
const MAX_TIP_CENTS = 10_000_000; // $100,000

/**
 * Discount bounds, the same two-layer treatment as the tip above (schema, then
 * the EFFECTIVE stored+patched pair) with one difference: more than 100% off a
 * bill is meaningless, so the percent cap is 100 rather than 500. An amount
 * larger than the current subtotal is deliberately allowed — the items can
 * still change — and computeDiscountCents clamps it at compute time.
 */
const MAX_DISCOUNT_PERCENT = 100;
const MAX_DISCOUNT_CENTS = MAX_TIP_CENTS; // $100,000

const patchSchema = z
  .object({
    restaurantName: z.string().max(80).nullish(),
    date: z.string().max(40).nullish(),
    venmoUsername: z.string().nullish(),
    zelleHandle: z.string().max(80).nullish(),
    tipType: z.enum(["percent", "amount"]).optional(),
    tipValue: z.number().finite().min(0, "tip can't be negative").optional(),
    // null clears the discount; undefined leaves it alone.
    discountType: z.enum(["percent", "amount"]).nullable().optional(),
    discountValue: z.number().finite().min(0, "discount can't be negative").optional(),
    taxCents: z.number().int("tax must be whole cents").min(0, "tax can't be negative").optional(),
    status: z.enum(["open", "settled"]).optional(),
    birthdayParticipantIds: z.array(z.string().min(1)).max(50).optional(),
    items: z.array(patchItemSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.tipValue === undefined) return;
    if (data.tipType === "percent") {
      if (data.tipValue > MAX_TIP_PERCENT) {
        ctx.addIssue({ code: "custom", message: "tip percent too large", path: ["tipValue"] });
      }
      return;
    }
    if (data.tipType === "amount" && !Number.isInteger(data.tipValue)) {
      ctx.addIssue({ code: "custom", message: "tip must be whole cents", path: ["tipValue"] });
    } else if (data.tipValue > MAX_TIP_CENTS) {
      ctx.addIssue({ code: "custom", message: "tip too large", path: ["tipValue"] });
    }
  })
  .superRefine((data, ctx) => {
    if (data.discountValue === undefined) return;
    // Clearing the discount: whatever value rides along is inert, so it must
    // never be the reason a removal is refused.
    if (data.discountType === null) return;
    if (data.discountType === "percent") {
      if (data.discountValue > MAX_DISCOUNT_PERCENT) {
        ctx.addIssue({
          code: "custom",
          message: "discount percent too large",
          path: ["discountValue"],
        });
      }
      return;
    }
    if (data.discountType === "amount") {
      if (!Number.isInteger(data.discountValue)) {
        ctx.addIssue({
          code: "custom",
          message: "discount must be whole cents",
          path: ["discountValue"],
        });
      } else if (data.discountValue > MAX_DISCOUNT_CENTS) {
        ctx.addIssue({ code: "custom", message: "discount too large", path: ["discountValue"] });
      }
      return;
    }
    // No type in THIS patch — the stored one decides how the value reads, so
    // only the universal ceiling applies here and the type-aware checks wait
    // for the EFFECTIVE pair below. No integer check: a stored percent is
    // allowed to be fractional (12.5%).
    if (data.discountValue > MAX_DISCOUNT_CENTS) {
      ctx.addIssue({ code: "custom", message: "discount too large", path: ["discountValue"] });
    }
  });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const storedKey = await getHostKey(id);
  if (storedKey === null) return Response.json({ error: "not found" }, { status: 404 });
  const headerKey = req.headers.get("x-host-key");
  if (!headerKey || headerKey !== storedKey) {
    return Response.json({ error: "host key required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, {
      status: 400,
    });
  }
  const data = parsed.data;

  // Effective tip/discount bounds: the schema judged this patch alone, so a
  // partial one has to be re-checked against what the room will actually end up
  // storing. One read serves both checks.
  const touchesTip = data.tipType !== undefined || data.tipValue !== undefined;
  const touchesDiscount = data.discountType !== undefined || data.discountValue !== undefined;
  // The discount this room will actually end up storing: computed for the
  // bounds check below, reused by the meta write to normalize a zero away.
  let effectiveDiscount: { type: "percent" | "amount" | null; value: number } | null = null;
  if (touchesTip || touchesDiscount) {
    const current = await getRoomState(id);
    if (!current) return Response.json({ error: "not found" }, { status: 404 });

    if (touchesTip) {
      const effectiveType = data.tipType ?? current.split.tipType;
      const effectiveValue = data.tipValue ?? current.split.tipValue;
      if (effectiveType === "percent") {
        if (effectiveValue > MAX_TIP_PERCENT) {
          return Response.json({ error: "tip percent too large" }, { status: 400 });
        }
      } else if (!Number.isInteger(effectiveValue)) {
        return Response.json({ error: "tip must be whole cents" }, { status: 400 });
      } else if (effectiveValue > MAX_TIP_CENTS) {
        return Response.json({ error: "tip too large" }, { status: 400 });
      }
    }

    if (touchesDiscount) {
      // `??` won't do here: discountType null is an explicit "remove the
      // discount", not "fall back to what's stored".
      const effectiveType =
        data.discountType !== undefined ? data.discountType : current.split.discountType;
      const effectiveValue = data.discountValue ?? current.split.discountValue;
      effectiveDiscount = { type: effectiveType, value: effectiveValue };
      // No type means no discount — whatever value rides along is inert.
      if (effectiveType === "percent") {
        if (effectiveValue > MAX_DISCOUNT_PERCENT) {
          return Response.json({ error: "discount percent too large" }, { status: 400 });
        }
      } else if (effectiveType === "amount") {
        if (!Number.isInteger(effectiveValue)) {
          return Response.json({ error: "discount must be whole cents" }, { status: 400 });
        } else if (effectiveValue > MAX_DISCOUNT_CENTS) {
          return Response.json({ error: "discount too large" }, { status: 400 });
        }
      }
    }
  }

  const meta: SplitMetaPatch = {};
  if (data.restaurantName !== undefined) meta.restaurantName = data.restaurantName;
  if (data.date !== undefined) meta.date = data.date;
  if (data.zelleHandle !== undefined) {
    meta.zelleHandle = data.zelleHandle ? (parseZelleInput(data.zelleHandle)?.handle ?? null) : null;
  }
  if (data.venmoUsername !== undefined) {
    meta.venmoUsername = data.venmoUsername ? parseVenmoInput(data.venmoUsername) : null;
  }
  if (data.tipType !== undefined) meta.tipType = data.tipType;
  if (data.tipValue !== undefined) meta.tipValue = data.tipValue;
  // A zero-value discount IS no discount: store it as none rather than leaving
  // an (amount, 0) ghost the host dashboard reads as a live discount and
  // auto-expands its editor for.
  if (effectiveDiscount && effectiveDiscount.type !== null && effectiveDiscount.value === 0) {
    meta.discountType = null;
    meta.discountValue = 0;
  } else {
    if (data.discountType !== undefined) meta.discountType = data.discountType;
    if (data.discountValue !== undefined) meta.discountValue = data.discountValue;
  }
  if (data.taxCents !== undefined) meta.taxCents = data.taxCents;
  if (data.status !== undefined) meta.status = data.status;
  if (Object.keys(meta).length) await updateSplitMeta(id, meta);

  // Full replace: exactly these participants are birthday people, everyone
  // else is cleared. Sending [] turns birthday mode off.
  if (data.birthdayParticipantIds !== undefined) {
    await setBirthdayParticipants(id, data.birthdayParticipantIds);
  }

  if (data.items !== undefined) {
    const items: EditableItem[] = data.items.map((it) => ({
      id: it.id,
      name: it.name,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      totalCents: it.totalCents,
      sharedByAll: it.sharedByAll,
    }));
    await replaceItems(id, items);
  }

  const state = await getRoomState(id);
  if (!state) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(state);
}
