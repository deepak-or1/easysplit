import Anthropic from "@anthropic-ai/sdk";
import { DEMO_RECEIPT } from "./demo-receipt";
import { formatCents } from "./money";
import type { ParsedReceipt, ParsedReceiptItem, ReceiptParseResponse } from "./types";

/**
 * Receipt parsing pipeline.
 *
 * - With ANTHROPIC_API_KEY set: the image goes to Claude vision with a strict
 *   JSON schema (structured outputs), which reads real receipts well.
 * - Without a key: a clean mock (the demo receipt) so the whole app works
 *   immediately with zero credentials. The manual correction UI in /new and
 *   the host dashboard is the real safety net either way — OCR is never
 *   trusted blindly.
 */

const RECEIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "restaurantName",
    "date",
    "items",
    "subtotalCents",
    "taxCents",
    "tipCents",
    "discountCents",
    "totalCents",
  ],
  properties: {
    restaurantName: { type: ["string", "null"] },
    date: { type: ["string", "null"], description: "ISO date if visible, else null" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unitPriceCents", "totalCents"],
        properties: {
          name: { type: "string" },
          quantity: { type: "integer" },
          unitPriceCents: { type: "integer", description: "price per unit in cents" },
          totalCents: { type: "integer", description: "line total in cents" },
        },
      },
    },
    subtotalCents: { type: "integer" },
    taxCents: { type: "integer" },
    tipCents: { type: "integer", description: "0 if no tip is printed" },
    discountCents: {
      type: "integer",
      description:
        "a discount applied to the WHOLE bill, as a positive number of cents; 0 if none",
    },
    totalCents: { type: "integer" },
  },
} as const;

const SUPPORTED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type SupportedMedia = (typeof SUPPORTED_MEDIA)[number];

export async function parseReceiptImage(
  buffer: Buffer,
  mime: string,
): Promise<ReceiptParseResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      source: "mock",
      receipt: { ...DEMO_RECEIPT, items: DEMO_RECEIPT.items.map((i) => ({ ...i })) },
      warning:
        "No ANTHROPIC_API_KEY configured — returning a demo receipt. Edit items below to match your real receipt, or set the key in .env.local for real OCR.",
    };
  }
  if (!SUPPORTED_MEDIA.includes(mime as SupportedMedia)) {
    return {
      source: "mock",
      receipt: { ...DEMO_RECEIPT, items: DEMO_RECEIPT.items.map((i) => ({ ...i })) },
      warning: `Unsupported image type ${mime} — returning a demo receipt to edit.`,
    };
  }

  try {
    const client = new Anthropic();

    // Pass 1: fast + cheap. The printed subtotal acts as a checksum — when the
    // extracted line items don't sum to it, the read is suspect.
    const first = await ocrPass(client, buffer, mime, "fast");
    const firstDelta = subtotalDelta(first.receipt);
    if (firstDelta <= CHECKSUM_TOLERANCE_CENTS) {
      return { source: "llm", receipt: first.receipt, ...warn(first.warning) };
    }

    // Pass 2 (hard receipts only — rotated, shadowed, crumpled): strongest
    // model with reasoning enabled and the checksum failure spelled out.
    // Escalations cost ~5x the fast pass, so they get their own global cap —
    // garbage images that always fail the checksum can't force expensive
    // reruns at the full OCR rate.
    const { checkRateLimit } = await import("./store");
    if (!(await checkRateLimit("ocr:escalate:global", 20, 60 * 60))) {
      return { source: "llm", receipt: first.receipt, ...warn(first.warning, CHECKSUM_WARNING) };
    }
    const second = await ocrPass(client, buffer, mime, "strong", first.receipt);
    const secondDelta = subtotalDelta(second.receipt);
    const best = secondDelta <= firstDelta ? second : first;
    const bestDelta = Math.min(firstDelta, secondDelta);
    if (bestDelta <= CHECKSUM_TOLERANCE_CENTS) {
      return { source: "llm", receipt: best.receipt, ...warn(best.warning) };
    }
    return { source: "llm", receipt: best.receipt, ...warn(best.warning, CHECKSUM_WARNING) };
  } catch (err) {
    return {
      source: "mock",
      receipt: { ...DEMO_RECEIPT, items: DEMO_RECEIPT.items.map((i) => ({ ...i })) },
      warning: `OCR failed (${err instanceof Error ? err.message : "unknown error"}) — returning a demo receipt to edit.`,
    };
  }
}

const CHECKSUM_TOLERANCE_CENTS = 50;

const CHECKSUM_WARNING =
  "The line items don't quite add up to the receipt's printed subtotal — worth a quick once-over below.";

/** Spreads into a ReceiptParseResponse: keeps `warning` absent (not undefined)
 * when there's nothing to say, and joins the two things that can go wrong. */
function warn(...parts: (string | null)[]): { warning?: string } {
  const warning = parts.filter(Boolean).join(" ");
  return warning ? { warning } : {};
}

/** |Σ line items − printed subtotal|, or 0 when no subtotal was printed/read
 * (no checksum available — nothing to disagree with). */
function subtotalDelta(r: ParsedReceipt): number {
  const itemsSum = r.items.reduce((s, i) => s + i.totalCents, 0);
  if (r.subtotalCents <= 0 || r.subtotalCents === itemsSum) return 0;
  return Math.abs(itemsSum - r.subtotalCents);
}

const BASE_PROMPT =
  "Extract this restaurant receipt into the schema. All money values are integer cents. " +
  "The photo may be rotated, dim, or partially shadowed — align each item name to ITS OWN " +
  "price column entry carefully. If a line shows quantity > 1, set quantity and unitPriceCents " +
  "accordingly (totalCents = quantity × unitPriceCents when consistent). Zero-priced " +
  "package sub-lines (e.g. drink choices under an all-you-can order) are not items. Exclude " +
  "subtotal/tax/tip/service-charge/total/payment lines from items, but DO report the printed " +
  "subtotal, tax, and any tip or service charge in their fields (0 if not printed). " +
  // Warehouse clubs print each discount as its own line — a bare item number
  // like "/1218574" with a trailing-minus amount — and their SUBTOTAL is
  // already net of them. Emitted as items, those lines become $0.00 junk rows
  // in the room AND leave the real item at its pre-discount price.
  "DISCOUNTS: an amount printed with a trailing minus (e.g. `3.20-`) or a leading minus is " +
  "NEGATIVE. Lines that are discounts, coupons, or instant savings — names like `/1218574`, " +
  "`1218574`, \"INSTANT SAVINGS\", \"COUPON\", \"MFR COUPON\", \"MEMBER SAVINGS\" — must NOT be " +
  "output as items. Subtract each one from the item it applies to: the item whose printed item " +
  "number it references when it names one (`/1218574` applies to the line whose item number is " +
  "1218574), otherwise the item immediately above it. Report that item at its NET price " +
  "(gross − discount) and drop the discount line entirely. Never output a negative total, and " +
  "never output a discount as its own line item. On a receipt with PER-ITEM discount lines like " +
  "these, the printed SUBTOTAL is already net of them, so it is your NET item totals that must " +
  "sum to it. " +
  // A whole-bill discount has no single item to net into — it belongs to the
  // receipt, not to a line, so it rides in its own field and the app subtracts
  // it from the table's total. Its printed subtotal is the PRE-discount one, so
  // the items stay at their printed prices and the checksum still works.
  "A WHOLE-BILL discount is a different case. A discount applied to the WHOLE bill rather than " +
  "to one item (e.g. \"15% OFF ENTIRE CHECK\", a promo code, a percentage taken off the " +
  "subtotal, a manager comp on the whole check) goes in `discountCents` as a POSITIVE integer " +
  "number of cents — ONLY there, never as a line item and never netted into an individual " +
  "item's price. On such a receipt the items are reported at their PRINTED prices, and the " +
  "printed subtotal is normally the PRE-discount amount, so your line totals must sum to it " +
  "with the discount left out of them. Use 0 when no whole-bill discount is printed. " +
  "Before answering, verify your line totals sum to the printed subtotal — NET totals on a " +
  "receipt with per-item discount lines, PRINTED totals on one with a whole-bill discount; if " +
  "they don't, re-read the misaligned lines and fix them.";

/** A normalized read plus anything the cleanup had to warn the host about.
 * `discountCents` is always set here, even though it is optional on the wider
 * ParsedReceipt (the hand-written demo receipts predate the field). */
export interface PassResult {
  receipt: ParsedReceipt & { discountCents: number };
  warning: string | null;
}

async function ocrPass(
  client: Anthropic,
  buffer: Buffer,
  mime: string,
  tier: "fast" | "strong",
  previous?: ParsedReceipt,
): Promise<PassResult> {
  const escalationHint = previous
    ? `\n\nIMPORTANT: a previous read of this exact receipt extracted items summing to ${previous.items
        .reduce((s, i) => s + i.totalCents, 0)} cents, but the printed subtotal is ${previous.subtotalCents} cents — so at least one line was misread or mis-aligned. Read slowly, match every name to its own price, and make your line totals reconcile with the printed subtotal.`
    : "";
  const response = await client.messages.create({
    // fast: Sonnet, no thinking (~1.3¢) — right for the ~90% of receipts that
    // pass the checksum. strong: Opus with adaptive reasoning (~4-6¢) — only
    // pays out on reads the checksum already flagged as wrong.
    model:
      tier === "fast"
        ? (process.env.OCR_MODEL ?? "claude-sonnet-5")
        : (process.env.OCR_MODEL_STRONG ?? "claude-opus-4-8"),
    max_tokens: tier === "fast" ? 2500 : 8000,
    thinking: tier === "fast" ? { type: "disabled" } : { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mime as SupportedMedia, data: buffer.toString("base64") },
          },
          { type: "text", text: BASE_PROMPT + escalationHint },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") throw new Error("model declined the request");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("no text block in response");
  return normalizeParsed(JSON.parse(text.text) as ParsedReceipt);
}

/** $100,000 — the same ceiling the create/patch APIs put on tip and tax. */
const MAX_MONEY_CENTS = 10_000_000;

/** A row that is a discount rather than a thing anyone ate or bought: a bare
 * item number (Costco prints `/1218574` for the item the discount applies to)
 * or an explicit savings word. Only ever consulted for $0 rows — a real item
 * never costs nothing AND names itself like a coupon. */
export function isDiscountName(name: string): boolean {
  const n = name.trim();
  return /^\/?\d+$/.test(n) || /discount|coupon|savings/i.test(n);
}

export interface NormalizedItems {
  items: ParsedReceiptItem[];
  /** Discount money that couldn't be applied to any item, in cents. What
   * happens to it is normalizeParsed's call: it folds the money into the
   * receipt-level discount only when the PRINTED subtotal proves it is still
   * outstanding (Σ items − unapplied === printed subtotal), because a subtotal
   * already net of it would otherwise get the money subtracted twice. When
   * that can't be confirmed the money is left out and the host is warned. */
  unappliedDiscountCents: number;
  /** Item-cleanup warnings. Nothing sets it today — the unmatched-discount
   * warning is raised in normalizeParsed, which is where the fold decision
   * lives — but it stays the channel such warnings pass through. */
  warning: string | null;
}

/**
 * Item cleanup — the discount fold, then the defensive clamp.
 *
 * The prompt tells the model to net discounts into the item they reference, but
 * OCR is never trusted blindly: when a discount survives as its own negative
 * line, fold it into the item above rather than clamping it to $0. Clamping
 * alone produced both halves of the bug — an unclaimable "$0.00 /1218574" row
 * in the room, and the discounted item still priced at its gross amount, which
 * overcharges the table.
 *
 * Exported for tests; also runs on the SMS path via normalizeParsed.
 */
export function normalizeItems(rawItems: readonly ParsedReceiptItem[] | null | undefined): NormalizedItems {
  const items: ParsedReceiptItem[] = [];
  let unappliedDiscountCents = 0;

  for (const i of rawItems ?? []) {
    if (!i || typeof i.name !== "string" || !i.name.trim()) continue;
    const name = i.name.trim().slice(0, 80);
    const quantity = Math.max(1, Math.round(Number(i.quantity) || 1));
    const rawTotal = Math.round(Number(i.totalCents) || 0);
    const rawUnit = Math.round(Number(i.unitPriceCents) || 0);
    // A discount the model priced only per-unit (total left at 0) is still a
    // discount; a real item never carries a negative unit price.
    const signedTotal = rawTotal === 0 && rawUnit < 0 ? rawUnit * quantity : rawTotal;

    if (signedTotal < 0) {
      const discount = -signedTotal;
      const prev = items[items.length - 1];
      if (!prev) {
        // Nothing above it to discount — the money is unaccounted for, and
        // guessing which later item it belongs to would be worse than saying so.
        unappliedDiscountCents += discount;
        continue;
      }
      const applied = Math.min(discount, prev.totalCents);
      prev.totalCents -= applied;
      prev.unitPriceCents = Math.round(prev.totalCents / prev.quantity);
      unappliedDiscountCents += discount - applied;
      continue;
    }

    let totalCents = Math.max(0, signedTotal);
    let unitPriceCents = Math.max(0, rawUnit);
    if (totalCents === 0 && unitPriceCents > 0) totalCents = unitPriceCents * quantity;
    if (unitPriceCents === 0 && totalCents > 0) unitPriceCents = Math.round(totalCents / quantity);
    // A $0 row named like a coupon is a discount the model already zeroed out —
    // it isn't an item, and it must not become the anchor for the next fold.
    if (totalCents === 0 && isDiscountName(name)) continue;
    items.push({ name, quantity, unitPriceCents, totalCents });
  }

  // Discount money with no item to land on is reported, not judged here:
  // normalizeParsed decides — against the printed subtotal — whether it is
  // still owed to the table or already baked into that subtotal.
  return { items, unappliedDiscountCents, warning: null };
}

/** Defensive cleanup: OCR output is never trusted blindly. */
export function normalizeParsed(raw: ParsedReceipt): PassResult {
  const { items, unappliedDiscountCents, warning: itemWarning } = normalizeItems(raw.items);
  const itemsSum = items.reduce((s, i) => s + i.totalCents, 0);
  // Keep the PRINTED subtotal when the model read one — the correction UI
  // compares it against Σ items and warns the host on a mismatch, which is
  // exactly how imperfect line extraction gets caught. Recompute only when
  // no subtotal was printed/read.
  const printedSubtotal = Math.max(0, Math.round(Number(raw.subtotalCents) || 0));
  // Per-line discount money the fold couldn't match to an item joins the
  // receipt-level discount ONLY when the printed subtotal proves it is still
  // outstanding: Σ items minus that money lands exactly on the printed
  // subtotal, so the subtotal is the PRE-discount base and the money hasn't
  // been taken off yet. A warehouse-club subtotal is already net of it, and
  // folding there would subtract the same dollars twice and undercharge the
  // table. Unconfirmed, the money stays out and the host gets told instead.
  const confirmedFold =
    unappliedDiscountCents > 0 &&
    printedSubtotal > 0 &&
    itemsSum - unappliedDiscountCents === printedSubtotal;
  // A confirmed fold means the printed subtotal is net of money now living in
  // `discountCents`; report the PRE-discount base so the check step's Σ-items
  // comparison agrees with itself.
  const subtotalCents = confirmedFold || printedSubtotal <= 0 ? itemsSum : printedSubtotal;
  // Bounded at both ends: this parse also runs on inbound MMS, where the
  // "receipt" is whatever a stranger texted in. Same $100,000 ceiling the API
  // enforces on tip/tax, so a wild read can't create an absurd room.
  const taxCents = Math.min(MAX_MONEY_CENTS, Math.max(0, Math.round(Number(raw.taxCents) || 0)));
  const tipCents = Math.min(MAX_MONEY_CENTS, Math.max(0, Math.round(Number(raw.tipCents) || 0)));
  const discountCents = Math.min(
    MAX_MONEY_CENTS,
    Math.max(
      0,
      Math.round(Number(raw.discountCents) || 0) + (confirmedFold ? unappliedDiscountCents : 0),
    ),
  );
  const unmatchedWarning =
    unappliedDiscountCents > 0 && !confirmedFold
      ? `${formatCents(unappliedDiscountCents)} in discounts couldn't be matched to an item — the prices below may read a little high.`
      : null;
  return {
    receipt: {
      restaurantName: raw.restaurantName?.toString().trim().slice(0, 80) || null,
      date: raw.date?.toString().slice(0, 10) || null,
      items,
      subtotalCents,
      taxCents,
      tipCents,
      discountCents,
      totalCents: itemsSum + taxCents + tipCents,
    },
    warning: itemWarning ?? unmatchedWarning,
  };
}
