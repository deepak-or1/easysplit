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

export function createSplit(input: CreateSplitInput): CreateSplitResult {
  const db = getDb();
  const splitId = newRoomId();
  const hostKey = newHostKey();
  const receiptId = newId();
  const hostParticipantId = newId();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO splits (id, host_key, restaurant_name, date, host_name, venmo_username, venmo_qr_path, tip_type, tip_value, tax_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      splitId,
      hostKey,
      input.restaurantName ?? null,
      input.date ?? null,
      input.hostName,
      input.venmoUsername ?? null,
      input.venmoQrPath ?? null,
      input.tipType,
      input.tipValue,
      input.taxCents,
    );
    db.prepare(`INSERT INTO receipts (id, split_id, image_path, ocr_json) VALUES (?, ?, ?, ?)`).run(
      receiptId,
      splitId,
      input.imagePath ?? null,
      input.ocrJson ?? null,
    );
    const insertItem = db.prepare(
      `INSERT INTO receipt_items (id, receipt_id, name, quantity, unit_price_cents, total_cents, shared_by_all, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    input.items.forEach((it, i) => {
      insertItem.run(
        newId(),
        receiptId,
        it.name,
        Math.max(1, Math.round(it.quantity)),
        it.unitPriceCents,
        it.totalCents,
        it.sharedByAll ? 1 : 0,
        i,
      );
    });
    db.prepare(
      `INSERT INTO participants (id, split_id, name, is_host) VALUES (?, ?, ?, 1)`,
    ).run(hostParticipantId, splitId, input.hostName);
  });
  tx();

  return { splitId, hostKey, hostParticipantId };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export function getHostKey(splitId: string): string | null {
  const row = getDb().prepare(`SELECT host_key FROM splits WHERE id = ?`).get(splitId) as
    | { host_key: string }
    | undefined;
  return row?.host_key ?? null;
}

export function splitExists(splitId: string): boolean {
  return !!getDb().prepare(`SELECT 1 FROM splits WHERE id = ?`).get(splitId);
}

export function getRoomState(splitId: string): RoomState | null {
  const db = getDb();
  const splitRow = db.prepare(`SELECT * FROM splits WHERE id = ?`).get(splitId) as
    | SplitRow
    | undefined;
  if (!splitRow) return null;

  const receiptRow = db
    .prepare(`SELECT * FROM receipts WHERE split_id = ? ORDER BY created_at LIMIT 1`)
    .get(splitId) as { id: string; image_path: string | null } | undefined;
  if (!receiptRow) return null;

  const itemRows = db
    .prepare(`SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY sort_order`)
    .all(receiptRow.id) as ItemRow[];
  const participantRows = db
    .prepare(`SELECT * FROM participants WHERE split_id = ? ORDER BY joined_at`)
    .all(splitId) as ParticipantRow[];
  const claimRows = db
    .prepare(
      `SELECT c.item_id, c.participant_id, c.share_n, c.share_d
       FROM claims c JOIN receipt_items i ON i.id = c.item_id
       WHERE i.receipt_id = ?`,
    )
    .all(receiptRow.id) as ClaimRow[];
  const messageRows = db
    .prepare(
      `SELECT m.id, m.participant_id, m.channel, m.body, m.reply, m.created_at, p.name AS participant_name
       FROM messages m LEFT JOIN participants p ON p.id = m.participant_id
       WHERE m.split_id = ? AND m.direction = 'in'
       ORDER BY m.created_at DESC, m.id DESC LIMIT 30`,
    )
    .all(splitId) as {
    id: string;
    participant_id: string | null;
    channel: MessageChannel;
    body: string;
    reply: string | null;
    created_at: string;
    participant_name: string | null;
  }[];

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
  tipType?: TipType;
  tipValue?: number;
  taxCents?: number;
  status?: "open" | "settled";
}

export function updateSplitMeta(splitId: string, patch: SplitMetaPatch): void {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const map: [keyof SplitMetaPatch, string][] = [
    ["restaurantName", "restaurant_name"],
    ["date", "date"],
    ["venmoUsername", "venmo_username"],
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
  db.prepare(`UPDATE splits SET ${sets.join(", ")} WHERE id = ?`).run(...vals, splitId);
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
export function replaceItems(splitId: string, items: EditableItem[]): void {
  const db = getDb();
  const receipt = db
    .prepare(`SELECT id FROM receipts WHERE split_id = ? ORDER BY created_at LIMIT 1`)
    .get(splitId) as { id: string } | undefined;
  if (!receipt) throw new Error("split has no receipt");

  const tx = db.transaction(() => {
    const keepIds = items.filter((i) => i.id).map((i) => i.id as string);
    if (keepIds.length) {
      db.prepare(
        `DELETE FROM receipt_items WHERE receipt_id = ? AND id NOT IN (${keepIds.map(() => "?").join(",")})`,
      ).run(receipt.id, ...keepIds);
    } else {
      db.prepare(`DELETE FROM receipt_items WHERE receipt_id = ?`).run(receipt.id);
    }
    const update = db.prepare(
      `UPDATE receipt_items SET name = ?, quantity = ?, unit_price_cents = ?, total_cents = ?, shared_by_all = ?, sort_order = ? WHERE id = ? AND receipt_id = ?`,
    );
    const insert = db.prepare(
      `INSERT INTO receipt_items (id, receipt_id, name, quantity, unit_price_cents, total_cents, shared_by_all, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    items.forEach((it, i) => {
      const qty = Math.max(1, Math.round(it.quantity));
      const shared = it.sharedByAll ? 1 : 0;
      if (it.id) {
        update.run(it.name, qty, it.unitPriceCents, it.totalCents, shared, i, it.id, receipt.id);
        // Shrinking quantity can strand over-claims; drop claims that no longer fit.
        db.prepare(
          `DELETE FROM claims WHERE item_id = ? AND CAST(share_n AS REAL) / share_d > ?`,
        ).run(it.id, qty);
      } else {
        insert.run(newId(), receipt.id, it.name, qty, it.unitPriceCents, it.totalCents, shared, i);
      }
    });
  });
  tx();
}

/* ------------------------------------------------------------------ */
/* Participants                                                        */
/* ------------------------------------------------------------------ */

/** Join (or rejoin by name, case-insensitive — keeps refreshes and SMS idempotent). */
export function joinParticipant(splitId: string, name: string): Participant {
  const db = getDb();
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new Error("name required");
  const existing = db
    .prepare(`SELECT * FROM participants WHERE split_id = ? AND lower(name) = lower(?)`)
    .get(splitId, trimmed) as ParticipantRow | undefined;
  if (existing) return toParticipant(existing);
  const id = newId();
  db.prepare(`INSERT INTO participants (id, split_id, name) VALUES (?, ?, ?)`).run(
    id,
    splitId,
    trimmed,
  );
  return toParticipant(
    db.prepare(`SELECT * FROM participants WHERE id = ?`).get(id) as ParticipantRow,
  );
}

export function getParticipants(splitId: string): Participant[] {
  const rows = getDb()
    .prepare(`SELECT * FROM participants WHERE split_id = ? ORDER BY joined_at`)
    .all(splitId) as ParticipantRow[];
  return rows.map(toParticipant);
}

export function getParticipant(splitId: string, participantId: string): Participant | null {
  const row = getDb()
    .prepare(`SELECT * FROM participants WHERE split_id = ? AND id = ?`)
    .get(splitId, participantId) as ParticipantRow | undefined;
  return row ? toParticipant(row) : null;
}

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

function loadItemsAndClaims(splitId: string): { items: ReceiptItem[]; claims: Claim[] } {
  const db = getDb();
  const receipt = db
    .prepare(`SELECT id FROM receipts WHERE split_id = ? ORDER BY created_at LIMIT 1`)
    .get(splitId) as { id: string } | undefined;
  if (!receipt) throw new Error("split has no receipt");
  const items = (
    db
      .prepare(`SELECT * FROM receipt_items WHERE receipt_id = ? ORDER BY sort_order`)
      .all(receipt.id) as ItemRow[]
  ).map(toItem);
  const claims = (
    db
      .prepare(
        `SELECT c.item_id, c.participant_id, c.share_n, c.share_d
         FROM claims c JOIN receipt_items i ON i.id = c.item_id WHERE i.receipt_id = ?`,
      )
      .all(receipt.id) as ClaimRow[]
  ).map(toClaim);
  return { items, claims };
}

/** Validate + persist claim actions atomically. Returns the apply result. */
export function applyActions(splitId: string, actions: ClaimAction[]): ApplyResult {
  const db = getDb();
  const { items, claims } = loadItemsAndClaims(splitId);
  const participants = getParticipants(splitId);
  const result = applyClaimActions(items, claims, actions, participants);

  if (result.changedItemIds.length) {
    const tx = db.transaction(() => {
      const del = db.prepare(`DELETE FROM claims WHERE item_id = ?`);
      const ins = db.prepare(
        `INSERT INTO claims (id, item_id, participant_id, share_n, share_d) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const itemId of result.changedItemIds) {
        del.run(itemId);
        for (const c of result.claims.filter((c) => c.itemId === itemId)) {
          ins.run(newId(), c.itemId, c.participantId, c.share.n, c.share.d);
        }
      }
    });
    tx();
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export function setPaidStatus(
  splitId: string,
  participantId: string,
  status: PaidStatus,
  amountCents: number,
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE participants SET paid_status = ? WHERE id = ? AND split_id = ?`).run(
      status,
      participantId,
      splitId,
    );
    if (status !== "unpaid") {
      db.prepare(
        `INSERT INTO payments (id, split_id, participant_id, amount_cents, status) VALUES (?, ?, ?, ?, ?)`,
      ).run(newId(), splitId, participantId, amountCents, status);
    }
  });
  tx();
}

/* ------------------------------------------------------------------ */
/* Messages & SMS sessions                                             */
/* ------------------------------------------------------------------ */

export function logMessage(args: {
  splitId: string;
  participantId?: string | null;
  channel?: MessageChannel;
  direction?: "in" | "out";
  body: string;
  reply?: string | null;
}): string {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO messages (id, split_id, participant_id, channel, direction, body, reply)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      args.splitId,
      args.participantId ?? null,
      args.channel ?? "web",
      args.direction ?? "in",
      args.body,
      args.reply ?? null,
    );
  return id;
}

export interface PhoneSession {
  phone: string;
  splitId: string;
  participantId: string | null;
}

export function getPhoneSession(phone: string): PhoneSession | null {
  const row = getDb().prepare(`SELECT * FROM phone_sessions WHERE phone = ?`).get(phone) as
    | { phone: string; split_id: string; participant_id: string | null }
    | undefined;
  return row ? { phone: row.phone, splitId: row.split_id, participantId: row.participant_id } : null;
}

export function setPhoneSession(phone: string, splitId: string, participantId?: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO phone_sessions (phone, split_id, participant_id, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(phone) DO UPDATE SET split_id = excluded.split_id,
         participant_id = excluded.participant_id, updated_at = excluded.updated_at`,
    )
    .run(phone, splitId, participantId ?? null);
}
