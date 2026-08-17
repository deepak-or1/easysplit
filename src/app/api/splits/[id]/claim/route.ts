import { z } from "zod";
import { applyActions, getParticipant, getRoomState, logMessage, splitExists } from "@/lib/store";
import { parseClaimMessage } from "@/lib/claim-parser/parser";
import type { ParseContext } from "@/lib/claim-parser/types";
import { fr, formatFrac } from "@/lib/fraction";
import type { ClaimAction, ParseResult } from "@/lib/types";
import type { ClaimResponse } from "@/lib/api";

/**
 * POST /api/splits/[id]/claim — apply checkbox taps (actions) OR route a
 * natural-language message through the claim parser.
 * See docs/CONTRACTS.md §POST /api/splits/[id]/claim.
 */

const shareSchema = z.object({
  n: z.number().int("share numerator must be an integer"),
  d: z
    .number()
    .int("share denominator must be an integer")
    .positive("share denominator must be positive"),
});

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set"),
    itemId: z.string().min(1),
    participantId: z.string().min(1),
    share: shareSchema,
  }),
  z.object({
    type: z.literal("unclaim"),
    itemId: z.string().min(1),
    participantId: z.string().min(1),
  }),
  z.object({
    type: z.literal("split"),
    itemId: z.string().min(1),
    participantIds: z.array(z.string().min(1)).min(1, "split needs at least one person"),
  }),
  // takeover carries no participantId of its own: it is filled in below from
  // the body's top-level participantId. That is a shape convenience, not an
  // authentication check — participant identity is self-asserted here, as it
  // is for every other action (the room link is the credential; there are no
  // guest accounts). Anything inside the action object is stripped by zod.
  z.object({
    type: z.literal("takeover"),
    itemId: z.string().min(1),
  }),
]);

const claimSchema = z
  .object({
    participantId: z.string().min(1, "participantId is required"),
    actions: z.array(actionSchema).optional(),
    message: z.string().optional(),
  })
  .refine((b) => (b.actions !== undefined) !== (b.message !== undefined), {
    message: "provide exactly one of actions or message",
  });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await splitExists(id))) return Response.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, {
      status: 400,
    });
  }
  const data = parsed.data;

  const participant = await getParticipant(id, data.participantId);
  if (!participant) return Response.json({ error: "unknown participant" }, { status: 400 });

  let parseResult: ParseResult | null = null;
  let actions: ClaimAction[];

  if (data.message !== undefined) {
    const room = await getRoomState(id);
    if (!room) return Response.json({ error: "not found" }, { status: 404 });

    const selfClaims = room.items.flatMap((it) =>
      it.claims
        .filter((c) => c.participantId === participant.id)
        .map((c) => ({ itemId: c.itemId, shareLabel: formatFrac(c.share) })),
    );
    const ctx: ParseContext = {
      self: participant,
      items: room.items,
      participants: room.participants,
      selfClaims,
    };
    parseResult = parseClaimMessage(data.message, ctx);

    await logMessage({
      splitId: id,
      participantId: participant.id,
      channel: "web",
      body: data.message,
      reply: parseResult.reply || parseResult.clarification?.question || null,
    });

    actions = parseResult.actions;
  } else {
    // Direct actions — shares arrive as plain {n,d}; re-normalize via fr().
    // takeover is bound to the body's top-level participantId, so a per-action
    // one can't name someone else — same self-asserted identity as every other
    // action, not a stronger guarantee.
    actions = data.actions!.map((a) => {
      if (a.type === "set") {
        return {
          type: "set",
          itemId: a.itemId,
          participantId: a.participantId,
          share: fr(a.share.n, a.share.d),
        };
      }
      if (a.type === "takeover") {
        return { type: "takeover", itemId: a.itemId, participantId: participant.id };
      }
      return a;
    });
  }

  const applied = await applyActions(id, actions);

  const state = await getRoomState(id);
  if (!state) return Response.json({ error: "not found" }, { status: 404 });

  const response: ClaimResponse = {
    parse: parseResult,
    rejected: applied.rejected.map((r) => ({ reason: r.reason })),
    state,
  };
  return Response.json(response);
}
