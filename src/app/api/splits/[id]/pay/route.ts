import { z } from "zod";
import { getHostKey, getParticipant, getRoomState, setPaidStatus } from "@/lib/store";

/**
 * POST /api/splits/[id]/pay — mark a participant paid/unpaid.
 * Rules: "confirmed"/"unpaid" require the host key; "reported" may be set by
 * the participant themselves. Amount recorded = that person's current
 * settlement.totalCents. See docs/CONTRACTS.md §POST /api/splits/[id]/pay.
 */

const paySchema = z.object({
  participantId: z.string().min(1, "participantId is required"),
  status: z.enum(["unpaid", "reported", "confirmed"]),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const storedKey = await getHostKey(id);
  if (storedKey === null) return Response.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = paySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, {
      status: 400,
    });
  }
  const { participantId, status } = parsed.data;

  const headerKey = req.headers.get("x-host-key");
  const hostAuthed = !!headerKey && headerKey === storedKey;
  if ((status === "confirmed" || status === "unpaid") && !hostAuthed) {
    return Response.json({ error: "host key required" }, { status: 401 });
  }

  if (!(await getParticipant(id, participantId))) {
    return Response.json({ error: "unknown participant" }, { status: 400 });
  }

  const room = await getRoomState(id);
  if (!room) return Response.json({ error: "not found" }, { status: 404 });
  const person = room.settlement.people.find((p) => p.participantId === participantId);
  const amountCents = person?.totalCents ?? 0;

  await setPaidStatus(id, participantId, status, amountCents);

  const state = await getRoomState(id);
  if (!state) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(state);
}
