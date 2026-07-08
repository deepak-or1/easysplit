import { z } from "zod";
import { joinParticipant, splitExists } from "@/lib/store";

/**
 * POST /api/splits/[id]/join — join (or rejoin by name) a room.
 * See docs/CONTRACTS.md §POST /api/splits/[id]/join.
 */

const joinSchema = z.object({
  name: z
    .string()
    .max(40, "name is too long")
    .refine((s) => s.trim().length >= 1, "your name is required"),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!splitExists(id)) return Response.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid request" }, {
      status: 400,
    });
  }

  const participant = joinParticipant(id, parsed.data.name);
  return Response.json(participant);
}
