import type {
  ClaimAction,
  Frac,
  Participant,
  ParseResult,
  ReceiptParseResponse,
  RoomState,
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
  taxCents: number;
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
  taxCents?: number;
  status?: "open" | "settled";
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

export function demoReceipt(): Promise<ReceiptParseResponse> {
  return jsonFetch("/api/receipts/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ demo: true }),
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

/* ---------------- Frac helper for client-side share math ---------------- */
export type { Frac };
