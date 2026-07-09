import Anthropic from "@anthropic-ai/sdk";
import { DEMO_RECEIPT } from "./demo-receipt";
import type { ParsedReceipt, ReceiptParseResponse } from "./types";

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
  required: ["restaurantName", "date", "items", "subtotalCents", "taxCents", "tipCents", "totalCents"],
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
    const firstDelta = subtotalDelta(first);
    if (firstDelta <= CHECKSUM_TOLERANCE_CENTS) {
      return { source: "llm", receipt: first };
    }

    // Pass 2 (hard receipts only — rotated, shadowed, crumpled): strongest
    // model with reasoning enabled and the checksum failure spelled out.
    const second = await ocrPass(client, buffer, mime, "strong", first);
    const secondDelta = subtotalDelta(second);
    const best = secondDelta <= firstDelta ? second : first;
    const bestDelta = Math.min(firstDelta, secondDelta);
    if (bestDelta <= CHECKSUM_TOLERANCE_CENTS) {
      return { source: "llm", receipt: best };
    }
    return {
      source: "llm",
      receipt: best,
      warning:
        "The line items don't quite add up to the receipt's printed subtotal — worth a quick once-over below.",
    };
  } catch (err) {
    return {
      source: "mock",
      receipt: { ...DEMO_RECEIPT, items: DEMO_RECEIPT.items.map((i) => ({ ...i })) },
      warning: `OCR failed (${err instanceof Error ? err.message : "unknown error"}) — returning a demo receipt to edit.`,
    };
  }
}

const CHECKSUM_TOLERANCE_CENTS = 50;

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
  "subtotal, tax, and any tip or service charge in their fields (0 if not printed). Before " +
  "answering, verify your line totals sum to the printed subtotal; if they don't, re-read the " +
  "misaligned lines and fix them.";

async function ocrPass(
  client: Anthropic,
  buffer: Buffer,
  mime: string,
  tier: "fast" | "strong",
  previous?: ParsedReceipt,
): Promise<ParsedReceipt> {
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

/** Defensive cleanup: OCR output is never trusted blindly. */
function normalizeParsed(raw: ParsedReceipt): ParsedReceipt {
  const items = (raw.items ?? [])
    .filter((i) => i && typeof i.name === "string" && i.name.trim())
    .map((i) => {
      const quantity = Math.max(1, Math.round(Number(i.quantity) || 1));
      let totalCents = Math.max(0, Math.round(Number(i.totalCents) || 0));
      let unitPriceCents = Math.max(0, Math.round(Number(i.unitPriceCents) || 0));
      if (totalCents === 0 && unitPriceCents > 0) totalCents = unitPriceCents * quantity;
      if (unitPriceCents === 0 && totalCents > 0) unitPriceCents = Math.round(totalCents / quantity);
      return { name: i.name.trim().slice(0, 80), quantity, unitPriceCents, totalCents };
    });
  const itemsSum = items.reduce((s, i) => s + i.totalCents, 0);
  // Keep the PRINTED subtotal when the model read one — the correction UI
  // compares it against Σ items and warns the host on a mismatch, which is
  // exactly how imperfect line extraction gets caught. Recompute only when
  // no subtotal was printed/read.
  const printedSubtotal = Math.max(0, Math.round(Number(raw.subtotalCents) || 0));
  const subtotalCents = printedSubtotal > 0 ? printedSubtotal : itemsSum;
  const taxCents = Math.max(0, Math.round(Number(raw.taxCents) || 0));
  const tipCents = Math.max(0, Math.round(Number(raw.tipCents) || 0));
  return {
    restaurantName: raw.restaurantName?.toString().trim().slice(0, 80) || null,
    date: raw.date?.toString().slice(0, 10) || null,
    items,
    subtotalCents,
    taxCents,
    tipCents,
    totalCents: itemsSum + taxCents + tipCents,
  };
}
