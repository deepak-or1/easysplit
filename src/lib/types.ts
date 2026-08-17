/**
 * Domain types for EasySplit. All money is integer cents. All fractional
 * ownership is an exact rational Frac {n, d} — never floats — so totals
 * always reconcile to the receipt total.
 */

export type Frac = { n: number; d: number };

export type TipType = "percent" | "amount";
/** Shape of a whole-bill discount. null on the split means there is none. */
export type DiscountType = "percent" | "amount";
export type PaidStatus = "unpaid" | "reported" | "confirmed";
export type SplitStatus = "open" | "settled";
export type MessageChannel = "web" | "sms";
/** What kind of bill this is. Grocery rooms allow single-person item takeovers. */
export type SplitType = "restaurant" | "grocery";

export interface Split {
  id: string;
  restaurantName: string | null;
  date: string | null; // ISO date, display only
  hostName: string;
  venmoUsername: string | null;
  venmoQrUrl: string | null; // served via /api/files/…
  zelleHandle: string | null; // enrolled email or 10-digit US phone
  tipType: TipType;
  tipValue: number; // percent (e.g. 20) or cents when tipType === "amount"
  /** null = no whole-bill discount. Tip is always computed PRE-discount. */
  discountType: DiscountType | null;
  discountValue: number; // percent (e.g. 15) or cents when discountType === "amount"
  taxCents: number;
  status: SplitStatus;
  splitType: SplitType;
  createdAt: string;
}

export interface Receipt {
  id: string;
  splitId: string;
  imageUrl: string | null;
  subtotalCents: number; // always Σ item.totalCents
  taxCents: number;
  tipCents: number;
  totalCents: number;
}

export interface ReceiptItem {
  id: string;
  name: string;
  quantity: number; // whole units on the receipt line (>= 1)
  unitPriceCents: number;
  totalCents: number; // the line total; source of truth for allocation
  sharedByAll: boolean; // split evenly among everyone; explicit claims ignored
  sortOrder: number;
}

export interface Participant {
  id: string;
  name: string;
  isHost: boolean;
  /** Birthday people pay $0; their share is redistributed across everyone else. */
  isBirthday: boolean;
  paidStatus: PaidStatus;
  joinedAt: string;
}

export interface Claim {
  itemId: string;
  participantId: string;
  share: Frac; // units of the item claimed, e.g. {1,2} = half a unit, {2,1} = two units
}

export interface FeedMessage {
  id: string;
  participantId: string | null;
  participantName: string | null;
  channel: MessageChannel;
  body: string;
  reply: string | null;
  createdAt: string;
}

// ---------- Settlement (computed, never stored) ----------

export interface SettlementLine {
  itemId: string;
  label: string; // e.g. "Nachos Grande (⅓)"
  share: Frac;
  amountCents: number;
}

export interface PersonSettlement {
  participantId: string;
  lines: SettlementLine[];
  itemsCents: number;
  taxCents: number;
  tipCents: number;
  /** Their slice of the whole-bill discount, allocated like tax and tip. Subtracted. */
  discountCents: number;
  isBirthday: boolean;
  /**
   * Birthday redistribution, in cents. Negative for a birthday person (exactly
   * −(items + tax + tip − discount), zeroing their total); positive for
   * everyone else, their even slice of what the birthday people owed. Sums to 0
   * across the room, so the grand-total invariant is untouched. 0 when nobody
   * is flagged.
   */
  birthdayAdjustmentCents: number;
  /** itemsCents + taxCents + tipCents − discountCents + birthdayAdjustmentCents. */
  totalCents: number;
}

export interface UnclaimedSettlement {
  lines: SettlementLine[];
  itemsCents: number;
  taxCents: number;
  tipCents: number;
  discountCents: number;
  totalCents: number;
}

export interface Settlement {
  people: PersonSettlement[];
  unclaimed: UnclaimedSettlement;
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  /** The whole-bill discount, clamped to [0, subtotalCents]. 0 when there is none. */
  discountCents: number;
  /** subtotal + tax + tip − discount. */
  grandTotalCents: number;
  /** Σ people.totalCents + unclaimed.totalCents === grandTotalCents. Always true by construction. */
  reconciles: boolean;
  /** 0..1 as a float, for progress UI */
  claimedRatio: number;
}

// ---------- Room state (GET /api/splits/[id] response) ----------

export interface ItemWithClaims extends ReceiptItem {
  claims: Claim[];
  claimedShare: Frac; // Σ claim shares (or quantity if sharedByAll and people exist)
  remaining: Frac; // quantity − claimedShare, clamped at 0
}

export interface RoomState {
  split: Split;
  receipt: Receipt;
  items: ItemWithClaims[];
  participants: Participant[];
  settlement: Settlement;
  feed: FeedMessage[];
}

// ---------- Claim actions (parser output & claim API input) ----------

export type ClaimAction =
  | { type: "set"; itemId: string; participantId: string; share: Frac }
  | { type: "unclaim"; itemId: string; participantId: string }
  | { type: "split"; itemId: string; participantIds: string[] } // even split of whole item
  // Grocery rooms only: stop sharing an item and claim all of it. Clears the
  // item's sharedByAll flag and every other claim on it.
  | { type: "takeover"; itemId: string; participantId: string };

export interface Clarification {
  question: string;
  options?: string[]; // suggested quick replies
}

export interface ParseResult {
  actions: ClaimAction[];
  /** Human reply summarizing what was understood, e.g. "Got it — Burger and ½ Fries." */
  reply: string;
  clarification?: Clarification;
}

// ---------- Receipt parsing (OCR) ----------

export interface ParsedReceiptItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface ParsedReceipt {
  restaurantName: string | null;
  date: string | null;
  items: ParsedReceiptItem[];
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  /**
   * A discount applied to the WHOLE bill (e.g. "15% off entire check"), in
   * cents, plus any per-line discount the fold couldn't match to an item.
   * Optional because the hand-written demo receipts predate it and carry none;
   * every receipt that comes out of `normalizeParsed` sets it (see PassResult).
   */
  discountCents?: number;
  totalCents: number;
}

export interface ReceiptParseResponse {
  source: "llm" | "mock";
  receipt: ParsedReceipt;
  warning?: string;
}
