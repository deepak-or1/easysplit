import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { RoomState } from "@/lib/types";

/**
 * PATCH /api/splits/[id] { birthdayParticipantIds } — host-gated, full-replace
 * semantics: exactly the listed people are flagged, everyone else is cleared.
 * The route handler is called directly (it is a plain function over Request),
 * so the host-key gate and the store write are both exercised for real.
 */

const dbFile = path.join(os.tmpdir(), `settle-birthday-patch-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_FILE = dbFile;
delete process.env.DATABASE_URL;

const { createSplit, getRoomState, joinParticipant } = await import("@/lib/store");
const { PATCH } = await import("@/app/api/splits/[id]/route");

afterAll(() => {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* never created */
    }
  }
});

function patch(splitId: string, body: unknown, hostKey?: string) {
  return PATCH(
    new Request(`http://localhost/api/splits/${splitId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(hostKey ? { "x-host-key": hostKey } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: splitId }) },
  );
}

/** Host + two guests, one $30 item claimed by nobody. */
async function room() {
  const { splitId, hostKey, hostParticipantId } = await createSplit({
    hostName: "Host",
    tipType: "percent",
    tipValue: 0,
    taxCents: 0,
    items: [{ name: "Cake", quantity: 1, unitPriceCents: 3000, totalCents: 3000 }],
  });
  const maya = await joinParticipant(splitId, "Maya");
  const sam = await joinParticipant(splitId, "Sam");
  return { splitId, hostKey, hostParticipantId, mayaId: maya.id, samId: sam.id };
}

const flagged = (state: RoomState) =>
  state.participants.filter((p) => p.isBirthday).map((p) => p.name);

describe("PATCH birthdayParticipantIds — host gate", () => {
  it("401s without a host key and changes nothing", async () => {
    const { splitId, mayaId } = await room();
    const res = await patch(splitId, { birthdayParticipantIds: [mayaId] });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "host key required" });
    expect(flagged((await getRoomState(splitId))!)).toEqual([]);
  });

  it("401s on a wrong host key and changes nothing", async () => {
    const { splitId, mayaId } = await room();
    const res = await patch(splitId, { birthdayParticipantIds: [mayaId] }, "not-the-key");
    expect(res.status).toBe(401);
    expect(flagged((await getRoomState(splitId))!)).toEqual([]);
  });

  it("404s for an unknown split", async () => {
    const res = await patch("nosuchroom", { birthdayParticipantIds: [] }, "whatever");
    expect(res.status).toBe(404);
  });
});

describe("PATCH birthdayParticipantIds — setting and clearing", () => {
  it("sets the flag and returns fresh room state carrying it", async () => {
    const { splitId, hostKey, mayaId } = await room();
    const res = await patch(splitId, { birthdayParticipantIds: [mayaId] }, hostKey);
    expect(res.status).toBe(200);

    const state = (await res.json()) as RoomState;
    expect(flagged(state)).toEqual(["Maya"]);
    expect(state.participants.find((p) => p.id === mayaId)!.isBirthday).toBe(true);
    // The settlement in the same response already reflects it.
    expect(state.settlement.people.find((p) => p.participantId === mayaId)!.isBirthday).toBe(true);
  });

  it("replaces the whole set, not merges it", async () => {
    const { splitId, hostKey, mayaId, samId } = await room();
    await patch(splitId, { birthdayParticipantIds: [mayaId] }, hostKey);

    const res = await patch(splitId, { birthdayParticipantIds: [samId] }, hostKey);
    expect(flagged((await res.json()) as RoomState)).toEqual(["Sam"]);
  });

  it("flags several people at once", async () => {
    const { splitId, hostKey, mayaId, samId } = await room();
    const res = await patch(splitId, { birthdayParticipantIds: [mayaId, samId] }, hostKey);
    expect(flagged((await res.json()) as RoomState).sort()).toEqual(["Maya", "Sam"]);
  });

  it("clears every flag when sent an empty array", async () => {
    const { splitId, hostKey, mayaId, samId } = await room();
    await patch(splitId, { birthdayParticipantIds: [mayaId, samId] }, hostKey);

    const res = await patch(splitId, { birthdayParticipantIds: [] }, hostKey);
    expect(flagged((await res.json()) as RoomState)).toEqual([]);
  });

  it("ignores unknown ids and still applies the known ones", async () => {
    const { splitId, hostKey, mayaId } = await room();
    const res = await patch(
      splitId,
      { birthdayParticipantIds: [mayaId, "ghost", "also-not-real"] },
      hostKey,
    );
    expect(res.status).toBe(200);
    expect(flagged((await res.json()) as RoomState)).toEqual(["Maya"]);
  });

  it("leaves the flags alone when the field is absent", async () => {
    const { splitId, hostKey, mayaId } = await room();
    await patch(splitId, { birthdayParticipantIds: [mayaId] }, hostKey);

    const res = await patch(splitId, { restaurantName: "Trattoria" }, hostKey);
    const state = (await res.json()) as RoomState;
    expect(state.split.restaurantName).toBe("Trattoria");
    expect(flagged(state)).toEqual(["Maya"]);
  });

  it("rejects a list longer than 50", async () => {
    const { splitId, hostKey } = await room();
    const res = await patch(
      splitId,
      { birthdayParticipantIds: Array.from({ length: 51 }, (_, i) => `p${i}`) },
      hostKey,
    );
    expect(res.status).toBe(400);
  });

  it("never flags a participant in another split", async () => {
    const a = await room();
    const b = await room();
    await patch(a.splitId, { birthdayParticipantIds: [b.mayaId] }, a.hostKey);
    expect(flagged((await getRoomState(b.splitId))!)).toEqual([]);
    expect(flagged((await getRoomState(a.splitId))!)).toEqual([]);
  });
});
