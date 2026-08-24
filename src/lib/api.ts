import type {
  ClaimAction,
  DiscountType,
  Frac,
  Participant,
  ParseResult,
  ReceiptParseResponse,
  RoomState,
  SplitType,
  TipType,
} from "./types";

/**
 * Typed client for the API routes. Every UI goes through these helpers so the
 * request/response shapes live in exactly one place (see docs/CONTRACTS.md).
 */

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

export interface CreateSplitPayload {
  hostName: string;
  restaurantName?: string | null;
  date?: string | null;
  venmoUsername?: string | null;
  zelleInput?: string | null; // raw email/phone; server normalizes
  venmoQrDataUrl?: string | null; // base64 data URL of QR image, optional
  receiptImageDataUrl?: string | null; // base64 data URL of the receipt photo
  tipType: TipType;
  tipValue: number;
  discountType?: DiscountType | null; // omitted / null = no discount
  discountValue?: number; // percent, or cents when discountType === "amount"
  taxCents: number;
  splitType?: SplitType; // defaults to "restaurant"
  groupSize?: number | null; // declared headcount; omitted / null = not set
  items: { name: string; quantity: number; unitPriceCents: number; totalCents: number; sharedByAll: boolean }[];
}

export interface CreateSplitResponse {
  splitId: string;
  hostKey: string;
  hostParticipantId: string;
  url: string; // shareable room path, e.g. /split/abc123
}

export function createSplit(payload: CreateSplitPayload): Promise<CreateSplitResponse> {
  return jsonFetch("/api/splits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getRoom(splitId: string): Promise<RoomState> {
  return jsonFetch(`/api/splits/${splitId}`);
}

export interface PatchSplitPayload {
  restaurantName?: string | null;
  date?: string | null;
  venmoUsername?: string | null;
  zelleHandle?: string | null; // raw email/phone; server normalizes
  tipType?: TipType;
  tipValue?: number;
  /** null clears the discount; omit to leave it alone. */
  discountType?: DiscountType | null;
  discountValue?: number;
  taxCents?: number;
  status?: "open" | "settled";
  /** Declared headcount; null clears it, omit to leave it alone. */
  groupSize?: number | null;
  /** Full replace — exactly these people are birthday people; [] clears it. */
  birthdayParticipantIds?: string[];
  items?: {
    id?: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    sharedByAll: boolean;
  }[];
}

export function patchSplit(
  splitId: string,
  hostKey: string,
  payload: PatchSplitPayload,
): Promise<RoomState> {
  return jsonFetch(`/api/splits/${splitId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-host-key": hostKey },
    body: JSON.stringify(payload),
  });
}

export function joinSplit(splitId: string, name: string): Promise<Participant> {
  return jsonFetch(`/api/splits/${splitId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export interface ClaimResponse {
  parse: ParseResult | null; // null when actions were sent directly
  rejected: { reason: string }[];
  state: RoomState;
}

/** Send explicit actions (checkbox taps) or a natural-language message. */
export function sendClaim(
  splitId: string,
  participantId: string,
  input: { actions?: ClaimAction[]; message?: string },
): Promise<ClaimResponse> {
  return jsonFetch(`/api/splits/${splitId}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantId, ...input }),
  });
}

export function markPaid(
  splitId: string,
  participantId: string,
  status: "unpaid" | "reported" | "confirmed",
  hostKey?: string,
): Promise<RoomState> {
  return jsonFetch(`/api/splits/${splitId}/pay`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(hostKey ? { "x-host-key": hostKey } : {}),
    },
    body: JSON.stringify({ participantId, status }),
  });
}

export function parseReceipt(imageDataUrl: string): Promise<ReceiptParseResponse> {
  return jsonFetch("/api/receipts/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageDataUrl }),
  });
}

/** The sample receipt, in the shape of the bill being split — a grocery run
 * gets a cart, everything else gets the restaurant check. */
export function demoReceipt(kind: SplitType = "restaurant"): Promise<ReceiptParseResponse> {
  return jsonFetch("/api/receipts/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ demo: true, kind }),
  });
}

/* ---------------- localStorage identity helpers ---------------- */

export function getStoredParticipantId(splitId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`settle:${splitId}:participant`);
}

export function storeParticipantId(splitId: string, participantId: string): void {
  localStorage.setItem(`settle:${splitId}:participant`, participantId);
}

export function getStoredHostKey(splitId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`settle:${splitId}:hostKey`);
}

export function storeHostKey(splitId: string, hostKey: string): void {
  localStorage.setItem(`settle:${splitId}:hostKey`, hostKey);
}

/* ---------------- recent-splits registry ---------------- */

/**
 * Rooms this browser has opened, newest first, so someone can find their way
 * back to a split without the link. Purely local — there are no accounts, so
 * this list is the only "my splits" that exists.
 */
export interface RecentSplit {
  splitId: string;
  name: string;
  role: "host" | "guest";
  at: string; // ISO timestamp
}

const RECENT_KEY = "settle:recent";
const RECENT_LIMIT = 20;

/** Newest first. Absent, unparseable or non-array storage all read as empty. */
export function getRecentSplits(): RecentSplit[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Entries are dropped rather than trusted: storage is shared with older
    // builds and with anything else that can write this key, so every field
    // the RecentSplit type promises is checked — a caller doing `.name.trim()`
    // must not be handed an entry that only happens to have a splitId.
    return parsed.filter((e): e is RecentSplit => {
      if (!e || typeof e !== "object") return false;
      const r = e as Partial<RecentSplit>;
      return (
        typeof r.splitId === "string" &&
        typeof r.name === "string" &&
        (r.role === "host" || r.role === "guest") &&
        typeof r.at === "string"
      );
    });
  } catch {
    return [];
  }
}

/** Prepend (de-duplicating on splitId) and cap the list. No-op during SSR. */
export function recordRecentSplit(entry: RecentSplit): void {
  if (typeof window === "undefined") return;
  const next = [entry, ...getRecentSplits().filter((e) => e.splitId !== entry.splitId)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked — the registry is a convenience, never load-bearing */
  }
}
