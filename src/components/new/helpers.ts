import jsQR from "jsqr";
import { nanoid } from "nanoid";
import type { CreateSplitPayload } from "@/lib/api";
import { centsToDollarString, dollarsToCents } from "@/lib/money";
import type { ParsedReceipt, TipType } from "@/lib/types";
import { parseVenmoInput } from "@/lib/venmo";

/**
 * Local draft state for the create-split wizard. Prices live as dollar strings
 * (what the host types); everything is converted to integer cents exactly once,
 * at payload-build time, via money.ts helpers.
 */
export interface DraftItem {
  key: string; // stable React key, local only
  name: string;
  quantity: number; // whole units, >= 1
  price: string; // UNIT price in dollars, as typed
  sharedByAll: boolean;
}

export interface Draft {
  restaurantName: string;
  date: string; // yyyy-mm-dd (input[type=date])
  items: DraftItem[];
  tax: string; // dollars, as typed
  ocrSubtotalCents: number | null; // printed subtotal from parse, for a sanity check
  ocrTipCents: number | null; // printed tip/service charge from parse (already owed!)
  hostName: string;
  tipMode: TipType; // "percent" | "amount"
  tipPercent: number; // used when tipMode === "percent"
  tipFlat: string; // dollars, used when tipMode === "amount"
  venmoInput: string; // raw text the host typed
  venmoUsername: string | null; // normalized handle (parseVenmoInput)
  zelleInput: string; // raw email/phone the host typed (server normalizes)
  venmoQrDataUrl: string | null; // uploaded QR image, kept even if undecodable
  receiptImageDataUrl: string | null; // real photo only (null for demo)
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyDraft(): Draft {
  return {
    restaurantName: "",
    date: todayString(),
    items: [],
    tax: "",
    ocrSubtotalCents: null,
    ocrTipCents: null,
    hostName: "",
    tipMode: "percent",
    tipPercent: 20,
    tipFlat: "",
    venmoInput: "",
    venmoUsername: null,
    zelleInput: "",
    venmoQrDataUrl: null,
    receiptImageDataUrl: null,
  };
}

export function newItem(): DraftItem {
  return { key: nanoid(), name: "", quantity: 1, price: "", sharedByAll: false };
}

export function itemsFromReceipt(r: ParsedReceipt): DraftItem[] {
  return r.items.map((it) => ({
    key: nanoid(),
    name: it.name,
    quantity: Math.max(1, Math.round(it.quantity) || 1),
    price: centsToDollarString(it.unitPriceCents),
    sharedByAll: false,
  }));
}

export function itemUnitCents(it: DraftItem): number {
  return dollarsToCents(it.price);
}

export function itemLineCents(it: DraftItem): number {
  return it.quantity * itemUnitCents(it);
}

export function computeSubtotalCents(items: DraftItem[]): number {
  return items.reduce((sum, it) => sum + itemLineCents(it), 0);
}

export function tipPreviewCents(draft: Draft): number {
  if (draft.tipMode === "amount") return dollarsToCents(draft.tipFlat);
  const subtotal = computeSubtotalCents(draft.items);
  return Math.round((subtotal * draft.tipPercent) / 100);
}

/** Items that will actually be sent (named, non-empty). */
export function payableItems(items: DraftItem[]): DraftItem[] {
  return items.filter((it) => it.name.trim().length > 0);
}

export function buildCreatePayload(draft: Draft): CreateSplitPayload {
  const venmoUsername = draft.venmoUsername ?? parseVenmoInput(draft.venmoInput);
  return {
    hostName: draft.hostName.trim(),
    restaurantName: draft.restaurantName.trim() || null,
    date: draft.date || null,
    venmoUsername: venmoUsername ?? null,
    zelleInput: draft.zelleInput.trim() || null,
    venmoQrDataUrl: draft.venmoQrDataUrl,
    receiptImageDataUrl: draft.receiptImageDataUrl,
    tipType: draft.tipMode,
    tipValue: draft.tipMode === "percent" ? draft.tipPercent : dollarsToCents(draft.tipFlat),
    taxCents: dollarsToCents(draft.tax),
    items: payableItems(draft.items).map((it) => {
      const unitPriceCents = itemUnitCents(it);
      return {
        name: it.name.trim(),
        quantity: it.quantity,
        unitPriceCents,
        totalCents: it.quantity * unitPriceCents,
        sharedByAll: it.sharedByAll,
      };
    }),
  };
}

/**
 * Downscale an image data URL to at most `maxEdge` px on its long side and
 * re-encode as JPEG. Receipt photos off a phone are 8–48MP; the OCR model
 * reads a 2000px receipt just as well, at a fraction of the image tokens
 * (and upload time). Falls back to the original on any failure.
 */
export function downscaleImageDataUrl(dataUrl: string, maxEdge = 2000): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return resolve(dataUrl);
      const scale = Math.min(1, maxEdge / Math.max(w, h));
      if (scale === 1) return resolve(dataUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(dataUrl);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** Read a File as a base64 data URL (for preview + upload). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Couldn't read that image — try another one."));
    reader.readAsDataURL(file);
  });
}

/** Decode a QR code from an image data URL entirely client-side. Returns the
 * raw payload string, or null if nothing could be decoded. */
export function decodeQrFromDataUrl(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return resolve(null);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0);
      try {
        const { data, width, height } = ctx.getImageData(0, 0, w, h);
        const code = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
        resolve(code ? code.data : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
