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
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      output_config: { format: { type: "json_schema", schema: RECEIPT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mime as SupportedMedia, data: buffer.toString("base64") },
            },
            {
              type: "text",
              text: "Extract this restaurant receipt into the schema. All money values are integer cents. If a line shows quantity > 1, set quantity and unitPriceCents accordingly (totalCents = quantity × unitPriceCents when consistent). Exclude subtotal/tax/tip/total lines from items. Use 0 for taxCents/tipCents if not printed.",
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("model declined the request");
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("no text block in response");
    const receipt = normalizeParsed(JSON.parse(text.text) as ParsedReceipt);
    return { source: "llm", receipt };
  } catch (err) {
    return {
      source: "mock",
      receipt: { ...DEMO_RECEIPT, items: DEMO_RECEIPT.items.map((i) => ({ ...i })) },
      warning: `OCR failed (${err instanceof Error ? err.message : "unknown error"}) — returning a demo receipt to edit.`,
    };
  }
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
  const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);
  const taxCents = Math.max(0, Math.round(Number(raw.taxCents) || 0));
  const tipCents = Math.max(0, Math.round(Number(raw.tipCents) || 0));
  return {
    restaurantName: raw.restaurantName?.toString().trim().slice(0, 80) || null,
    date: raw.date?.toString().slice(0, 10) || null,
    items,
    subtotalCents,
    taxCents,
    tipCents,
    totalCents: subtotalCents + taxCents + tipCents,
  };
}
