import jsQR from "jsqr";
import { nanoid } from "nanoid";
import type { CreateSplitPayload } from "@/lib/api";
import { centsToDollarString, dollarsToCents } from "@/lib/money";
import type { DiscountType, ParsedReceipt, SplitType, TipType } from "@/lib/types";
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
  /**
   * The line total the receipt actually printed, kept ONLY when it disagrees
   * with quantity × unit price — which happens whenever ocr.ts had to back-fill
   * a unit price by dividing an indivisible total ("3 Tacos $10.00" → 333¢ each,
   * which multiplies back to 999¢). Undefined for every other item, and cleared
   * the moment the host edits the price or quantity (see applyItemEdit).
   */
  receiptTotalCents?: number;
}

export interface Draft {
  /** What kind of bill this is. Grocery runs skip the tip and share by default. */
  splitType: SplitType;
  restaurantName: string;
  date: string; // yyyy-mm-dd (input[type=date])
  items: DraftItem[];
  tax: string; // dollars, as typed
  ocrSubtotalCents: number | null; // printed subtotal from parse, for a sanity check
  ocrTipCents: number | null; // printed tip/service charge from parse (already owed!)
  ocrDiscountCents: number | null; // whole-bill discount read off the receipt
  hostName: string;
  tipMode: TipType; // "percent" | "amount"
  tipPercent: number; // used when tipMode === "percent"
  tipFlat: string; // dollars, used when tipMode === "amount"
  discountMode: DiscountType; // "percent" | "amount"
  discountPercent: number; // used when discountMode === "percent"
  discountFlat: string; // dollars, used when discountMode === "amount"
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
    splitType: "restaurant",
    restaurantName: "",
    date: todayString(),
    items: [],
    tax: "",
    ocrSubtotalCents: null,
    ocrTipCents: null,
    ocrDiscountCents: null,
    hostName: "",
    tipMode: "percent",
    tipPercent: 20,
    tipFlat: "",
    // A zero discount IS "no discount": the control stays collapsed and the
    // payload sends discountType null, so nothing about the room changes until
    // the host actually enters one.
    discountMode: "percent",
    discountPercent: 0,
    discountFlat: "",
    venmoInput: "",
    venmoUsername: null,
    zelleInput: "",
    venmoQrDataUrl: null,
    receiptImageDataUrl: null,
  };
}

export function newItem(sharedByAll = false): DraftItem {
  return { key: nanoid(), name: "", quantity: 1, price: "", sharedByAll };
}

/** A grocery run is shared by default — one cart, one household. A restaurant
 * bill is not: everyone claims what they ordered. */
export function sharedByDefault(splitType: SplitType): boolean {
  return splitType === "grocery";
}

/** The name a split falls back to when the host never typed one. */
export function draftSplitName(draft: Draft): string {
  return draft.restaurantName.trim() || (draft.splitType === "grocery" ? "Grocery run" : "Dinner");
}

export function itemsFromReceipt(r: ParsedReceipt, sharedByAll = false): DraftItem[] {
  return r.items.map((it) => {
    const quantity = Math.max(1, Math.round(it.quantity) || 1);
    const draft: DraftItem = {
      key: nanoid(),
      name: it.name,
      quantity,
      price: centsToDollarString(it.unitPriceCents),
      sharedByAll,
    };
    // Only worth keeping when the printed total isn't reproducible from the
    // unit price — otherwise quantity × unit already says the same thing.
    if (it.totalCents !== quantity * it.unitPriceCents) {
      draft.receiptTotalCents = it.totalCents;
    }
    return draft;
  });
}

/** Merge a wizard edit into a draft item. Touching the price or quantity means
 * the host is now the source of truth for this line, so the receipt's printed
 * total is dropped and the row prices exactly as a hand-entered one would. */
export function applyItemEdit(it: DraftItem, next: Partial<DraftItem>): DraftItem {
  const merged: DraftItem = { ...it, ...next };
  if (next.price !== undefined || next.quantity !== undefined) {
    delete merged.receiptTotalCents;
  }
  return merged;
}

export function itemUnitCents(it: DraftItem): number {
  return dollarsToCents(it.price);
}

export function itemLineCents(it: DraftItem): number {
  return it.receiptTotalCents ?? it.quantity * itemUnitCents(it);
}

export function computeSubtotalCents(items: DraftItem[]): number {
  return items.reduce((sum, it) => sum + itemLineCents(it), 0);
}

export function tipPreviewCents(draft: Draft): number {
  // Groceries have no tip at all — the wizard hides the editor, and the payload
  // sends a flat 0% so nothing can leak in from an earlier step.
  if (draft.splitType === "grocery") return 0;
  if (draft.tipMode === "amount") return dollarsToCents(draft.tipFlat);
  const subtotal = computeSubtotalCents(draft.items);
  return Math.round((subtotal * draft.tipPercent) / 100);
}

/**
 * The raw discount the host entered — percent points, or cents when the mode is
 * a flat amount. 0 means "no discount", which is the whole reason the control
 * can stay invisible until it's used: nothing is sent and nothing is shown.
 */
export function draftDiscountValue(draft: Draft): number {
  return Math.max(
    0,
    draft.discountMode === "amount" ? dollarsToCents(draft.discountFlat) : draft.discountPercent,
  );
}

/**
 * The whole-bill discount the draft currently describes, in cents. Clamped to
 * the items subtotal — a bigger coupon than the bill can't take the total
 * negative — matching computeDiscountCents on the server. Unlike the tip, a
 * grocery run keeps its discount: coupons are exactly what a cart has.
 */
export function discountPreviewCents(draft: Draft): number {
  const subtotal = computeSubtotalCents(draft.items);
  const raw =
    draft.discountMode === "amount"
      ? dollarsToCents(draft.discountFlat)
      : Math.round((subtotal * draft.discountPercent) / 100);
  return Math.min(Math.max(0, subtotal), Math.max(0, raw));
}

/** Items that will actually be sent (named, non-empty). */
export function payableItems(items: DraftItem[]): DraftItem[] {
  return items.filter((it) => it.name.trim().length > 0);
}

export function buildCreatePayload(draft: Draft): CreateSplitPayload {
  const venmoUsername = draft.venmoUsername ?? parseVenmoInput(draft.venmoInput);
  const grocery = draft.splitType === "grocery";
  // A grocery run skips the tip but keeps the discount — coupons are exactly
  // what a cart has.
  const discountValue = draftDiscountValue(draft);
  return {
    hostName: draft.hostName.trim(),
    splitType: draft.splitType,
    restaurantName: draft.restaurantName.trim() || null,
    date: draft.date || null,
    venmoUsername: venmoUsername ?? null,
    zelleInput: draft.zelleInput.trim() || null,
    venmoQrDataUrl: draft.venmoQrDataUrl,
    receiptImageDataUrl: draft.receiptImageDataUrl,
    // 0% of anything is $0, whatever the items add up to — the one tip shape
    // that can't round to a stray cent on a grocery run.
    tipType: grocery ? "percent" : draft.tipMode,
    tipValue: grocery ? 0 : draft.tipMode === "percent" ? draft.tipPercent : dollarsToCents(draft.tipFlat),
    discountType: discountValue > 0 ? draft.discountMode : null,
    discountValue: discountValue > 0 ? discountValue : 0,
    taxCents: dollarsToCents(draft.tax),
    items: payableItems(draft.items).map((it) => {
      const unitPriceCents = itemUnitCents(it);
      return {
        name: it.name.trim(),
        quantity: it.quantity,
        unitPriceCents,
        // Prefer what the receipt printed: quantity × unit loses the remainder
        // whenever the unit price was derived by dividing an indivisible total.
        totalCents: it.receiptTotalCents ?? it.quantity * unitPriceCents,
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
