import { centsToDollarString } from "./money";
import type { PersonSettlement, Split } from "./types";

/**
 * Venmo settlement is deliberately "dumb and safe": we never log in, automate,
 * or scrape Venmo. We build best-effort profile/pay links from host-provided
 * info; the user always confirms the payment inside Venmo. Copy-to-clipboard
 * for amount + note is the first-class fallback.
 */

/** Extract a Venmo username from whatever the host pasted: "@user", "user",
 * "https://venmo.com/u/user", "https://account.venmo.com/u/user",
 * "venmo://users/user", or a venmo.com QR payload. Returns null if no luck. */
export function parseVenmoInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const urlMatch = s.match(
    /(?:venmo\.com\/(?:u\/|code\?user_id=)?|venmo:\/\/(?:users|paycharge\?recipients=)?\/?)([A-Za-z0-9\-_@.]+)/i,
  );
  const candidate = (urlMatch ? urlMatch[1] : s).replace(/^@/, "").replace(/[/?#].*$/, "");
  if (/^[A-Za-z0-9\-_]{3,30}$/.test(candidate)) return candidate;
  return null;
}

export interface VenmoPayment {
  amountCents: number;
  amount: string; // "12.34"
  note: string;
  /**
   * Web pay link (account.venmo.com/pay) — prefills recipient/amount/note on
   * desktop web. On phones, prefer `deepLink` first: universal links into the
   * app can land on the profile screen and drop the query params.
   */
  webUrl: string | null;
  /** Native deep link — opens the app's compose-payment screen prefilled. */
  deepLink: string | null;
  username: string | null;
}

export function buildVenmoNote(split: Split, person: PersonSettlement): string {
  const where = split.restaurantName ? ` at ${split.restaurantName}` : "";
  const itemNames = person.lines.slice(0, 3).map((l) => l.label);
  const more = person.lines.length > 3 ? ` +${person.lines.length - 3} more` : "";
  const what = itemNames.length ? `: ${itemNames.join(", ")}${more}` : "";
  const note = `Dinner split${where}${what} + tax/tip`;
  // Venmo notes get awkward past ~140 chars; trim politely.
  return note.length > 140 ? `${note.slice(0, 137)}…` : note;
}

export function buildVenmoPayment(split: Split, person: PersonSettlement): VenmoPayment {
  const amount = centsToDollarString(person.totalCents);
  const note = buildVenmoNote(split, person);
  const username = split.venmoUsername;
  if (!username) {
    return { amountCents: person.totalCents, amount, note, webUrl: null, deepLink: null, username: null };
  }
  const q = `txn=pay&recipients=${encodeURIComponent(username)}&amount=${encodeURIComponent(amount)}&note=${encodeURIComponent(note)}`;
  return {
    amountCents: person.totalCents,
    amount,
    note,
    webUrl: `https://account.venmo.com/pay?${q}`,
    deepLink: `venmo://paycharge?${q}`,
    username,
  };
}
