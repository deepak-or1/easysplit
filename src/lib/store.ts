import { getDb } from "./db";
import { fr, fsub, F_ZERO } from "./fraction";
import { newHostKey, newId, newRoomId } from "./ids";
import { applyClaimActions, type ApplyResult } from "./claims";
import { claimedShare, computeSettlement, computeTipCents } from "./split-math";
import type {
  Claim,
  ClaimAction,
  FeedMessage,
  ItemWithClaims,
  MessageChannel,
  PaidStatus,
  Participant,
  ReceiptItem,
  RoomState,
  Split,
  TipType,
} from "./types";

/**
 * The only module that touches the database. SQL is written ONCE here in the
 * SQLite-compatible dialect with `?` placeholders; src/lib/db.ts picks the
 * driver (SQLite or Postgres) and rewrites placeholders for Postgres. Every
 * exported function is async and awaits the adapter.
 */

/* ------------------------------------------------------------------ */
/* Row types & mappers                                                 */
/* ------------------------------------------------------------------ */

interface SplitRow {
  id: string;
  host_key: string;
  restaurant_name: string | null;
  date: string | null;
  host_name: string;
  venmo_username: string | null;
  venmo_qr_path: string | null;
  zelle_handle: string | null;
  tip_type: TipType;
  tip_value: number;
  tax_cents: number;
  status: "open" | "settled";
  created_at: string;
}

interface ItemRow {
  id: string;
  receipt_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  shared_by_all: number;
  sort_order: number;
}

interface ParticipantRow {
  id: string;
  split_id: string;
  name: string;
  is_host: number;
  paid_status: PaidStatus;
  joined_at: string;
}

interface ClaimRow {
  item_id: string;
  participant_id: string;
  share_n: number;
  share_d: number;
}

function toSplit(r: SplitRow): Split {
  return {
    id: r.id,
    restaurantName: r.restaurant_name,
    date: r.date,
    hostName: r.host_name,
    venmoUsername: r.venmo_username,
    venmoQrUrl: r.venmo_qr_path ? `/api/files/${r.venmo_qr_path}` : null,
    zelleHandle: r.zelle_handle,
    tipType: r.tip_type,
    tipValue: r.tip_value,
    taxCents: r.tax_cents,
    status: r.status,
    createdAt: r.created_at,
  };
}

function toItem(r: ItemRow): ReceiptItem {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    unitPriceCents: r.unit_price_cents,
    totalCents: r.total_cents,
    sharedByAll: r.shared_by_all === 1,
    sortOrder: r.sort_order,
  };
}

function toParticipant(r: ParticipantRow): Participant {
  return {
    id: r.id,
    name: r.name,
    isHost: r.is_host === 1,
    paidStatus: r.paid_status,
    joinedAt: r.joined_at,
  };
}

function toClaim(r: ClaimRow): Claim {
  return {
    itemId: r.item_id,
    participantId: r.participant_id,
    share: fr(r.share_n, r.share_d),
  };
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export interface NewItemInput {
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  sharedByAll?: boolean;
}

export interface CreateSplitInput {
  restaurantName?: string | null;
  date?: string | null;
  hostName: string;
  venmoUsername?: string | null;
  venmoQrPath?: string | null; // stored upload filename
  zelleHandle?: string | null; // normalized by parseZelleInput
  tipType: TipType;
  tipValue: number;
  taxCents: number;
  imagePath?: string | null; // stored upload filename
  ocrJson?: string | null;
  items: NewItemInput[];
}

export interface CreateSplitResult {
  splitId: string;
  hostKey: string;
  hostParticipantId: string;
}

export async function createSplit(input: CreateSplitInput): Promise<CreateSplitResult> {
  const db = getDb();
  const splitId = newRoomId();
  const hostKey = newHostKey();
  const receiptId = newId();
  const hostParticipantId = newId();

  await db.tx(async (q) => {
    await q.run(
      `INSERT INTO splits (id, host_key, restaurant_name, date, host_name, venmo_username, venmo_qr_path, zelle_handle, tip_type, tip_value, tax_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        splitId,
        hostKey,
        input.restaurantName ?? null,
        input.date ?? null,
        input.hostName,
        input.venmoUsername ?? null,
        input.venmoQrPath ?? null,
        input.zelleHandle ?? null,
        input.tipType,
        input.tipValue,
        input.taxCents,
      ],
    );
    await q.run(`INSERT INTO receipts (id, split_id, image_path, ocr_json) VALUES (?, ?, ?, ?)`, [
      receiptId,
      splitId,
      input.imagePath ?? null,
      input.ocrJson ?? null,
    ]);
    for (const [i, it] of input.items.entries()) {
      await q.run(
        `INSERT INTO receipt_items (id, receipt_id, name, quantity, unit_price_cents, total_cents, shared_by_all, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          receiptId,
          it.name,
          Math.max(1, Math.round(it.quantity)),
          it.unitPriceCents,
          it.totalCents,
          it.sharedByAll ? 1 : 0,
          i,
        ],
      );
    }
    await q.run(`INSERT INTO participants (id, split_id, name, is_host) VALUES (?, ?, ?, 1)`, [
      hostParticipantId,
      splitId,
      input.hostName,
    ]);
  });

  return { splitId, hostKey, hostParticipantId };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function getHostKey(splitId: string): Promise<string | null> {
  const row = await getDb().get<{ host_key: string }>(
    `SELECT host_key FROM splits WHERE id = ?`,
    [splitId],
  );
  return row?.host_key ?? null;
}

export async function splitExists(splitId: string): Promise<boolean> {
  const row = await getDb().get<{ one: number }>(`SELECT 1 AS one FROM splits WHERE id = ?`, [
    splitId,
  ]);
  return !!row;
}

export async function getRoomState(splitId: string): Promise<RoomState | null> {
  const db = getDb();
  const splitRow = await db.get<SplitRow>(`SELECT * FROM splits WHERE id = ?`, [splitId]);
  if (!splitRow) return null;

  const receiptRow = await db.get<{ id: string; image_path: string | null }>(
    `SELECT * FROM receipts WHERE split_id = ? ORDER BY created_at LIMIT 1`,
    [splitId],
  );
  if (!receiptRow) return null;

  const itemRows = await db.all<ItemRow>(
    `SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY sort_order`,
    [receiptRow.id],
  );
  const participantRows = await db.all<ParticipantRow>(
    `SELECT * FROM participants WHERE split_id = ? ORDER BY joined_at`,
    [splitId],
  );
  const claimRows = await db.all<ClaimRow>(
    `SELECT c.item_id, c.participant_id, c.share_n, c.share_d
       FROM claims c JOIN receipt_items i ON i.id = c.item_id
       WHERE i.receipt_id = ?`,
    [receiptRow.id],
  );
  const messageRows = await db.all<{
    id: string;
    participant_id: string | null;
    channel: MessageChannel;
    body: string;
    reply: string | null;
    created_at: string;
    participant_name: string | null;
  }>(
    `SELECT m.id, m.participant_id, m.channel, m.body, m.reply, m.created_at, p.name AS participant_name
       FROM messages m LEFT JOIN participants p ON p.id = m.participant_id
       WHERE m.split_id = ? AND m.direction = 'in'
       ORDER BY m.created_at DESC, m.id DESC LIMIT 30`,
    [splitId],
  );

  const split = toSplit(splitRow);
  const items = itemRows.map(toItem);
  const participants = participantRows.map(toParticipant);
  const claims = claimRows.map(toClaim);

  const settlement = computeSettlement({
    items,
    claims,
    participants,
    taxCents: split.taxCents,
    tipType: split.tipType,
    tipValue: split.tipValue,
  });

  const itemsWithClaims: ItemWithClaims[] = items.map((item) => {
    const cs = claimedShare(item, claims, participants);
    const rem = fsub(fr(item.quantity), cs);
    return {
      ...item,
      claims: item.sharedByAll ? [] : claims.filter((c) => c.itemId === item.id),
      claimedShare: cs,
      remaining: rem.n < 0 ? F_ZERO : rem,
    };
  });

  const subtotalCents = items.reduce((s, it) => s + it.totalCents, 0);
  const tipCents = computeTipCents(subtotalCents, split.tipType, split.tipValue);

  const feed: FeedMessage[] = messageRows
    .map((m) => ({
      id: m.id,
      participantId: m.participant_id,
      participantName: m.participant_name,
      channel: m.channel,
      body: m.body,
      reply: m.reply,
      createdAt: m.created_at,
    }))
    .reverse();

  return {
    split,
    receipt: {
      id: receiptRow.id,
      splitId,
      imageUrl: receiptRow.image_path ? `/api/files/${receiptRow.image_path}` : null,
      subtotalCents,
      taxCents: split.taxCents,
      tipCents,
      totalCents: subtotalCents + split.taxCents + tipCents,
    },
    items: itemsWithClaims,
    participants,
    settlement,
    feed,
  };
}

/* ------------------------------------------------------------------ */
/* Host edits                                                          */
/* ------------------------------------------------------------------ */

export interface SplitMetaPatch {
  restaurantName?: string | null;
  date?: string | null;
  venmoUsername?: string | null;
  zelleHandle?: string | null;
  tipType?: TipType;
  tipValue?: number;
  taxCents?: number;
  status?: "open" | "settled";
}

export async function updateSplitMeta(splitId: string, patch: SplitMetaPatch): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const map: [keyof SplitMetaPatch, string][] = [
    ["restaurantName", "restaurant_name"],
    ["date", "date"],
    ["venmoUsername", "venmo_username"],
    ["zelleHandle", "zelle_handle"],
    ["tipType", "tip_type"],
    ["tipValue", "tip_value"],
    ["taxCents", "tax_cents"],
    ["status", "status"],
  ];
  for (const [key, col] of map) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(patch[key]);
    }
  }
  if (!sets.length) return;
  await getDb().run(`UPDATE splits SET ${sets.join(", ")} WHERE id = ?`, [...vals, splitId]);
}

export interface EditableItem {
  id?: string; // present = update, absent = insert
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  sharedByAll: boolean;
}

/** Full item-list replace. Items omitted from `items` are deleted (their claims cascade). */
export async function replaceItems(splitId: string, items: EditableItem[]): Promise<void> {
  const db = getDb();
  const receipt = await db.get<{ id: string }>(
    `SELECT id FROM receipts WHERE split_id = ? ORDER BY created_at LIMIT 1`,
    [splitId],
  );
  if (!receipt) throw new Error("split has no receipt");

  await db.tx(async (q) => {
    const keepIds = items.filter((i) => i.id).map((i) => i.id as string);
    if (keepIds.length) {
      await q.run(
        `DELETE FROM receipt_items WHERE receipt_id = ? AND id NOT IN (${keepIds.map(() => "?").join(",")})`,
        [receipt.id, ...keepIds],
      );
    } else {
      await q.run(`DELETE FROM receipt_items WHERE receipt_id = ?`, [receipt.id]);
    }
    for (const [i, it] of items.entries()) {
      const qty = Math.max(1, Math.round(it.quantity));
      const shared = it.sharedByAll ? 1 : 0;
      if (it.id) {
        await q.run(
          `UPDATE receipt_items SET name = ?, quantity = ?, unit_price_cents = ?, total_cents = ?, shared_by_all = ?, sort_order = ? WHERE id = ? AND receipt_id = ?`,
          [it.name, qty, it.unitPriceCents, it.totalCents, shared, i, it.id, receipt.id],
        );
        // Shrinking quantity can strand over-claims; drop claims that no longer fit.
        await q.run(`DELETE FROM claims WHERE item_id = ? AND CAST(share_n AS REAL) / share_d > ?`, [
          it.id,
          qty,
        ]);
      } else {
        await q.run(
          `INSERT INTO receipt_items (id, receipt_id, name, quantity, unit_price_cents, total_cents, shared_by_all, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId(), receipt.id, it.name, qty, it.unitPriceCents, it.totalCents, shared, i],
        );
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Participants                                                        */
/* ------------------------------------------------------------------ */

/** Join (or rejoin by name, case-insensitive — keeps refreshes and SMS idempotent). */
export async function joinParticipant(splitId: string, name: string): Promise<Participant> {
  const db = getDb();
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new Error("name required");
  const existing = await db.get<ParticipantRow>(
    `SELECT * FROM participants WHERE split_id = ? AND lower(name) = lower(?)`,
    [splitId, trimmed],
  );
  if (existing) return toParticipant(existing);
  const id = newId();
  await db.run(`INSERT INTO participants (id, split_id, name) VALUES (?, ?, ?)`, [
    id,
    splitId,
    trimmed,
  ]);
  const row = await db.get<ParticipantRow>(`SELECT * FROM participants WHERE id = ?`, [id]);
  return toParticipant(row as ParticipantRow);
}

export async function getParticipants(splitId: string): Promise<Participant[]> {
  const rows = await getDb().all<ParticipantRow>(
    `SELECT * FROM participants WHERE split_id = ? ORDER BY joined_at`,
    [splitId],
  );
  return rows.map(toParticipant);
}

export async function getParticipant(
  splitId: string,
  participantId: string,
): Promise<Participant | null> {
  const row = await getDb().get<ParticipantRow>(
    `SELECT * FROM participants WHERE split_id = ? AND id = ?`,
    [splitId, participantId],
  );
  return row ? toParticipant(row) : null;
}

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

async function loadItemsAndClaims(
  splitId: string,
): Promise<{ items: ReceiptItem[]; claims: Claim[] }> {
  const db = getDb();
  const receipt = await db.get<{ id: string }>(
    `SELECT id FROM receipts WHERE split_id = ? ORDER BY created_at LIMIT 1`,
    [splitId],
  );
  if (!receipt) throw new Error("split has no receipt");
  const itemRows = await db.all<ItemRow>(
    `SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY sort_order`,
    [receipt.id],
  );
  const claimRows = await db.all<ClaimRow>(
    `SELECT c.item_id, c.participant_id, c.share_n, c.share_d
       FROM claims c JOIN receipt_items i ON i.id = c.item_id WHERE i.receipt_id = ?`,
    [receipt.id],
  );
  return { items: itemRows.map(toItem), claims: claimRows.map(toClaim) };
}

/** Validate + persist claim actions atomically. Returns the apply result. */
export async function applyActions(splitId: string, actions: ClaimAction[]): Promise<ApplyResult> {
  const db = getDb();
  const { items, claims } = await loadItemsAndClaims(splitId);
  const participants = await getParticipants(splitId);
  const result = applyClaimActions(items, claims, actions, participants);

  if (result.changedItemIds.length) {
    await db.tx(async (q) => {
      for (const itemId of result.changedItemIds) {
        await q.run(`DELETE FROM claims WHERE item_id = ?`, [itemId]);
        for (const c of result.claims.filter((c) => c.itemId === itemId)) {
          await q.run(
            `INSERT INTO claims (id, item_id, participant_id, share_n, share_d) VALUES (?, ?, ?, ?, ?)`,
            [newId(), c.itemId, c.participantId, c.share.n, c.share.d],
          );
        }
      }
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export async function setPaidStatus(
  splitId: string,
  participantId: string,
  status: PaidStatus,
  amountCents: number,
): Promise<void> {
  const db = getDb();
  await db.tx(async (q) => {
    await q.run(`UPDATE participants SET paid_status = ? WHERE id = ? AND split_id = ?`, [
      status,
      participantId,
      splitId,
    ]);
    if (status !== "unpaid") {
      await q.run(
        `INSERT INTO payments (id, split_id, participant_id, amount_cents, status) VALUES (?, ?, ?, ?, ?)`,
        [newId(), splitId, participantId, amountCents, status],
      );
    }
  });
}

/* ------------------------------------------------------------------ */
/* Messages & SMS sessions                                             */
/* ------------------------------------------------------------------ */

export async function logMessage(args: {
  splitId: string;
  participantId?: string | null;
  channel?: MessageChannel;
  direction?: "in" | "out";
  body: string;
  reply?: string | null;
}): Promise<string> {
  const id = newId();
  await getDb().run(
    `INSERT INTO messages (id, split_id, participant_id, channel, direction, body, reply)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      args.splitId,
      args.participantId ?? null,
      args.channel ?? "web",
      args.direction ?? "in",
      args.body,
      args.reply ?? null,
    ],
  );
  return id;
}

export interface PhoneSession {
  phone: string;
  splitId: string;
  participantId: string | null;
}

export async function getPhoneSession(phone: string): Promise<PhoneSession | null> {
  const row = await getDb().get<{
    phone: string;
    split_id: string;
    participant_id: string | null;
  }>(`SELECT * FROM phone_sessions WHERE phone = ?`, [phone]);
  return row ? { phone: row.phone, splitId: row.split_id, participantId: row.participant_id } : null;
}

export async function setPhoneSession(
  phone: string,
  splitId: string,
  participantId?: string | null,
): Promise<void> {
  // Portable timestamp (SQLite datetime('now') shape) passed as a param so the
  // SQL is identical across drivers — no datetime()/now() dialect functions.
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  await getDb().run(
    `INSERT INTO phone_sessions (phone, split_id, participant_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(phone) DO UPDATE SET split_id = excluded.split_id,
         participant_id = excluded.participant_id, updated_at = excluded.updated_at`,
    [phone, splitId, participantId ?? null, now],
  );
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

/**
 * Best-effort fixed-window rate limiter backed by the DB (so it works across
 * serverless instances with zero extra infra). Returns true when the call is
 * allowed. Approximate under concurrency — fine, it guards spend, not auth.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSecs: number,
): Promise<boolean> {
  const db = getDb();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  return db.tx(async (q) => {
    const row = await q.get<{ window_start: string; count: number }>(
      `SELECT window_start, count FROM rate_limits WHERE key = ?`,
      [key],
    );
    const expired = !row || now - Date.parse(row.window_start) > windowSecs * 1000;
    if (expired) {
      await q.run(
        `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1`,
        [key, nowIso],
      );
      return true;
    }
    if (row.count >= limit) return false;
    await q.run(`UPDATE rate_limits SET count = count + 1 WHERE key = ?`, [key]);
    return true;
  });
}
