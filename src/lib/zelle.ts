/**
 * Zelle settlement — same safety stance as Venmo: no automation, no login, no
 * scraping. Zelle has NO public pay-link standard with amount/note prefill; it
 * routes purely on the recipient's enrolled email or US phone number inside
 * each bank's app. So the first-class path is copy buttons (handle + amount +
 * note), plus a best-effort handoff link built from Zelle's own QR payload
 * format (the URL their printed QR codes encode) — tapping it walks the payer
 * into their banking app with the recipient attached. Amount is always
 * entered/confirmed by the payer inside their bank.
 */

export type ZelleHandle =
  | { type: "email"; handle: string }
  | { type: "phone"; handle: string }; // 10-digit US number

/** Normalize whatever the host typed into an enrolled-looking handle. */
export function parseZelleInput(raw: string): ZelleHandle | null {
  const s = raw.trim();
  if (!s) return null;
  // Email?
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) {
    return { type: "email", handle: s.toLowerCase() };
  }
  // US phone? Strip formatting; accept 10 digits or 11 with leading 1.
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return { type: "phone", handle: digits };
  if (digits.length === 11 && digits.startsWith("1")) {
    return { type: "phone", handle: digits.slice(1) };
  }
  return null;
}

export function formatZelleHandle(handle: string): string {
  if (/^\d{10}$/.test(handle)) {
    return `(${handle.slice(0, 3)}) ${handle.slice(3, 6)}-${handle.slice(6)}`;
  }
  return handle;
}

/**
 * Best-effort "open Zelle" link: the URL Zelle's own recipient QR codes encode
 * ({token, name, action:"payment"} base64-wrapped). On phones it lands on
 * Zelle's handoff page, which routes into the payer's banking app with the
 * recipient prefilled. Copy buttons remain the guaranteed path.
 */
export function buildZelleLink(handle: string, recipientName: string): string {
  const payload = {
    token: /^\d{10}$/.test(handle) ? `+1${handle}` : handle,
    name: recipientName.toUpperCase().slice(0, 40),
    action: "payment",
  };
  // btoa exists in both browsers and Node 20+ (this module is client- AND
  // server-imported); the encodeURIComponent dance keeps non-ASCII names safe.
  const json = JSON.stringify(payload);
  const data = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return `https://enroll.zellepay.com/qr-codes?data=${encodeURIComponent(data)}`;
}
