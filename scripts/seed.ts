/**
 * Seed a fully-claimed demo split so you can see Settle working end to end
 * without touching the UI. Run it, then open the printed room link.
 *
 *   npm run seed
 *
 * Storage honours the same env as the app (DATA_DIR / DATABASE_FILE), so this
 * writes into the local SQLite DB that `npm run dev` reads. Every run creates a
 * NEW room (random code) — old rooms are left untouched.
 *
 * Imports use RELATIVE paths (not the @ alias) so `tsx` can run it directly.
 */

import { DEMO_RECEIPT } from "../src/lib/demo-receipt";
import { fr } from "../src/lib/fraction";
import { formatCents } from "../src/lib/money";
import {
  applyActions,
  createSplit,
  getRoomState,
  joinParticipant,
  logMessage,
  setPaidStatus,
} from "../src/lib/store";
import type { ClaimAction, RoomState } from "../src/lib/types";

const BASE_URL = process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD, display only

function fail(message: string): never {
  console.error(`\nseed failed: ${message}`);
  process.exit(1);
}

function main(): void {
  /* 1. Host "Priya" creates the split from the demo receipt. Queso Fundido is
     flagged shared-by-all here (it is not flagged in DEMO_RECEIPT). ---------- */
  const { splitId, hostKey, hostParticipantId } = createSplit({
    restaurantName: DEMO_RECEIPT.restaurantName,
    date: TODAY,
    hostName: "Priya",
    venmoUsername: "priya-sharma",
    tipType: "percent",
    tipValue: 20,
    taxCents: 995,
    items: DEMO_RECEIPT.items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      totalCents: it.totalCents,
      sharedByAll: it.name === "Queso Fundido",
    })),
  });

  /* 2. Friends join (idempotent by name). --------------------------------- */
  const priya = hostParticipantId;
  const alex = joinParticipant(splitId, "Alex").id;
  const maya = joinParticipant(splitId, "Maya").id;
  const sam = joinParticipant(splitId, "Sam").id;

  /* 3. Resolve item ids by name (names are unique in the demo receipt). ---- */
  const preState = getRoomState(splitId) ?? fail("room vanished after create");
  const itemId = (name: string): string => {
    const item = preState.items.find((i) => i.name === name);
    if (!item) return fail(`item not found: ${name}`);
    return item.id;
  };

  /* 4. Everyone claims what they had. -------------------------------------- */
  const actions: ClaimAction[] = [
    // Shared starter split evenly among the whole table.
    { type: "split", itemId: itemId("Nachos Grande"), participantIds: [priya, alex, maya, sam] },
    // Alex: the burger + half the truffle fries.
    { type: "set", itemId: itemId("Smash Burger"), participantId: alex, share: fr(1, 1) },
    { type: "set", itemId: itemId("Truffle Fries"), participantId: alex, share: fr(1, 2) },
    // Maya: 2 of the 3 margaritas + the tacos.
    { type: "set", itemId: itemId("Margarita"), participantId: maya, share: fr(2, 1) },
    { type: "set", itemId: itemId("Tacos al Pastor"), participantId: maya, share: fr(1, 1) },
    // Sam: both IPAs + the coke.
    { type: "set", itemId: itemId("Hazy IPA"), participantId: sam, share: fr(2, 1) },
    { type: "set", itemId: itemId("Mexican Coke"), participantId: sam, share: fr(1, 1) },
    // Priya: the last margarita + the other half of the fries.
    { type: "set", itemId: itemId("Margarita"), participantId: priya, share: fr(1, 1) },
    { type: "set", itemId: itemId("Truffle Fries"), participantId: priya, share: fr(1, 2) },
  ];

  const result = applyActions(splitId, actions);
  if (result.rejected.length) {
    fail(
      "claims were rejected:\n" +
        result.rejected.map((r) => `  - ${r.reason}`).join("\n"),
    );
  }

  /* 5. A few chat messages so the room feed feels alive. ------------------- */
  logMessage({
    splitId,
    participantId: maya,
    body: "I had 2 margaritas and the tacos",
    reply: "Got it — 2 Margaritas and Tacos al Pastor. You're all set.",
  });
  logMessage({
    splitId,
    participantId: sam,
    body: "both IPAs + the coke were mine",
    reply: "Nice — 2 Hazy IPAs and the Mexican Coke are yours.",
  });
  logMessage({
    splitId,
    participantId: alex,
    body: "burger and I'll split the fries with Priya",
    reply: "Done — Smash Burger and ½ Truffle Fries. Priya's got the other half.",
  });

  /* 6. Compute totals, mark Sam as self-reported paid. --------------------- */
  const settled = getRoomState(splitId) ?? fail("room vanished after claims");
  const samTotal = settled.settlement.people.find((p) => p.participantId === sam);
  setPaidStatus(splitId, sam, "reported", samTotal?.totalCents ?? 0);

  const room = getRoomState(splitId) ?? fail("room vanished after payment");
  print(room, splitId, hostKey);

  if (!room.settlement.reconciles) fail("settlement does not reconcile");
  process.exit(0);
}

function print(room: RoomState, splitId: string, hostKey: string): void {
  const { settlement, participants } = room;
  const nameOf = (id: string): string =>
    participants.find((p) => p.id === id)?.name ?? "?";
  const paidOf = (id: string): string => {
    const status = participants.find((p) => p.id === id)?.paidStatus;
    return status === "reported"
      ? "  (paid · reported)"
      : status === "confirmed"
        ? "  (paid · confirmed)"
        : "";
  };

  const line = "─".repeat(64);
  console.log(`\n${line}`);
  console.log("  Settle — demo split seeded 🎉");
  console.log(line);
  console.log(`  Restaurant   ${room.split.restaurantName} · ${room.split.date}`);
  console.log(`  Bill         ${formatCents(settlement.grandTotalCents)}` +
    `  (items ${formatCents(settlement.subtotalCents)}` +
    ` + tax ${formatCents(settlement.taxCents)}` +
    ` + tip ${formatCents(settlement.tipCents)})`);
  console.log(line);
  console.log("  Room link (share this):");
  console.log(`    ${BASE_URL}/split/${splitId}`);
  console.log("  Host dashboard (keep private — includes host key):");
  console.log(`    ${BASE_URL}/split/${splitId}/host?key=${hostKey}`);
  console.log(line);
  console.log("  Per-person totals");
  for (const p of settlement.people) {
    const name = nameOf(p.participantId).padEnd(8);
    const total = formatCents(p.totalCents).padStart(8);
    console.log(
      `    ${name} ${total}` +
        `   (items ${formatCents(p.itemsCents)}` +
        ` + tax ${formatCents(p.taxCents)}` +
        ` + tip ${formatCents(p.tipCents)})` +
        paidOf(p.participantId),
    );
  }
  if (settlement.unclaimed.totalCents > 0) {
    console.log(`    ${"unclaimed".padEnd(8)} ${formatCents(settlement.unclaimed.totalCents).padStart(8)}`);
  }
  console.log(line);

  const peopleSum = settlement.people.reduce((s, p) => s + p.totalCents, 0);
  const total = peopleSum + settlement.unclaimed.totalCents;
  const ok = total === settlement.grandTotalCents && settlement.reconciles;
  console.log(
    `  Reconciliation: Σ people ${formatCents(peopleSum)}` +
      ` + unclaimed ${formatCents(settlement.unclaimed.totalCents)}` +
      ` = ${formatCents(total)}` +
      `  vs grand total ${formatCents(settlement.grandTotalCents)}` +
      `  →  ${ok ? "✓ balances to the cent" : "✗ MISMATCH"}`,
  );
  console.log(line + "\n");
}

main();
