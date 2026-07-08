import { z } from "zod";
import {
  getHostKey,
  getRoomState,
  replaceItems,
  updateSplitMeta,
  type EditableItem,
  type SplitMetaPatch,
} from "@/lib/store";
import { parseVenmoInput } from "@/lib/venmo";

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

const patchSchema = z.object({
  restaurantName: z.string().max(80).nullish(),
  date: z.string().max(40).nullish(),
  venmoUsername: z.string().nullish(),
  tipType: z.enum(["percent", "amount"]).optional(),
  tipValue: z.number().min(0, "tip can't be negative").optional(),
  taxCents: z.number().int("tax must be whole cents").min(0, "tax can't be negative").optional(),
  status: z.enum(["open", "settled"]).optional(),
  items: z.array(patchItemSchema).optional(),
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

  const meta: SplitMetaPatch = {};
  if (data.restaurantName !== undefined) meta.restaurantName = data.restaurantName;
  if (data.date !== undefined) meta.date = data.date;
  if (data.venmoUsername !== undefined) {
    meta.venmoUsername = data.venmoUsername ? parseVenmoInput(data.venmoUsername) : null;
  }
  if (data.tipType !== undefined) meta.tipType = data.tipType;
  if (data.tipValue !== undefined) meta.tipValue = data.tipValue;
  if (data.taxCents !== undefined) meta.taxCents = data.taxCents;
  if (data.status !== undefined) meta.status = data.status;
  if (Object.keys(meta).length) await updateSplitMeta(id, meta);

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
