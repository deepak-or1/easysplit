import crypto from "node:crypto";
import { handleInboundSms } from "@/lib/sms";

/** Allow up to 2 minutes: the OCR escalation pass on hard receipts can run ~30s+. */
export const maxDuration = 120;

/**
 * POST /api/sms/inbound — Twilio-compatible inbound SMS/MMS webhook.
 *
 * This is THE integration point for a real Twilio number. Twilio POSTs
 * `application/x-www-form-urlencoded` with fields like `From`, `Body`,
 * `NumMedia`, `MediaUrl0..N`, `MessageSid`, `To`, etc. We parse those, hand a
 * normalized message to `handleInboundSms` (all the product logic lives there,
 * in src/lib/sms.ts), and return TwiML so Twilio replies to the sender:
 *
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <Response><Message>…reply…</Message></Response>
 *
 * LOCAL MOCK MODE: with no `TWILIO_AUTH_TOKEN` set we skip signature
 * validation, so you can curl this route directly (see docs/TWILIO.md). Set the
 * token in production and every request is verified against Twilio's HMAC-SHA1
 * `X-Twilio-Signature`. See docs/TWILIO.md for wiring, ngrok, and MMS media auth.
 */

/**
 * Validate Twilio's `X-Twilio-Signature`.
 *
 * Twilio's algorithm (unchanged for years):
 *   1. Start with the exact webhook URL Twilio requested (scheme+host+path+query).
 *   2. Append every POST param, sorted alphabetically by key, as `key + value`
 *      concatenated with no separators.
 *   3. HMAC-SHA1 that string with the account auth token, base64-encode it.
 *   4. Constant-time compare against the header.
 *
 * IMPORTANT: `url` must match what Twilio signed. Behind ngrok / a proxy the
 * public URL differs from the local `req.url`, so we reconstruct it from
 * `PUBLIC_BASE_URL` + path when that env var is set.
 */
function isValidTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on length mismatch — guard it (also short-circuits forgeries).
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Minimal XML escaping for the reply text inside <Message>. Order matters: `&` first. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Wrap a reply string in a one-message TwiML document. */
function twiml(reply: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(reply)}</Message></Response>`;
  return new Response(xml, {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export async function POST(req: Request): Promise<Response> {
  // Twilio always sends url-encoded form data.
  const form = await req.formData();

  // Collect ALL params for signature validation (Twilio signs every field,
  // not just the ones we read below).
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  // --- Signature validation (only when a token is configured) ---
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    // Reconstruct the URL Twilio signed. Prefer PUBLIC_BASE_URL (the real public
    // origin) over req.url, which is the internal address behind a proxy/ngrok.
    const reqUrl = new URL(req.url);
    const signedUrl = process.env.PUBLIC_BASE_URL
      ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}${reqUrl.pathname}${reqUrl.search}`
      : req.url;
    const signature = req.headers.get("x-twilio-signature");
    if (!isValidTwilioSignature(authToken, signedUrl, params, signature)) {
      return new Response("Invalid Twilio signature", { status: 403 });
    }
  }
  // else: local mock mode — no token, no validation (curl freely).

  // --- Read the fields we care about ---
  const from = (form.get("From") as string) ?? "";
  const body = (form.get("Body") as string) ?? "";
  const numMedia = Math.max(0, parseInt((form.get("NumMedia") as string) ?? "0", 10) || 0);
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const u = form.get(`MediaUrl${i}`);
    if (typeof u === "string" && u) mediaUrls.push(u);
  }
  // MessageSid is read for completeness / future logging & idempotency.
  void (form.get("MessageSid") as string | null);

  const reply = await handleInboundSms({ from, body, numMedia, mediaUrls });
  return twiml(reply);
}
