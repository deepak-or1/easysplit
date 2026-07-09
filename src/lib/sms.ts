import { DEMO_RECEIPT } from "./demo-receipt";
import { parseReceiptImage } from "./ocr";
import { parseClaimMessage } from "./claim-parser/parser";
import type { ParseContext } from "./claim-parser/types";
import { formatFrac } from "./fraction";
import { formatCents } from "./money";
import { settlementFor } from "./split-math";
import {
  applyActions,
  checkRateLimit,
  createSplit,
  getPhoneSession,
  getRoomState,
  joinParticipant,
  logMessage,
  setPhoneSession,
  splitExists,
} from "./store";
import type { Participant, ParsedReceipt } from "./types";

/**
 * SMS-first brain for EasySplit.
 *
 * `handleInboundSms` is the single, transport-agnostic entry point: it takes a
 * normalized inbound message and returns the plain-text reply. The Twilio route
 * (src/app/api/sms/inbound/route.ts) is a thin adapter that parses the Twilio
 * webhook form, calls this, and wraps the string in TwiML. Keeping the logic
 * here (pure-ish, no HTTP knowledge) makes it directly unit-invokable — see the
 * smoke script referenced in docs/TWILIO.md.
 *
 * Everything degrades gracefully with zero credentials: with no Twilio creds we
 * never fetch MMS media (we fall back to the demo receipt); with no
 * ANTHROPIC_API_KEY the OCR pipeline itself returns the demo receipt.
 */

export interface InboundSms {
  /** E.164 sender, e.g. "+15551234567". Used as the phone-session key. */
  from: string;
  /** Message text (may be empty for a bare MMS). */
  body: string;
  /** Twilio NumMedia. */
  numMedia: number;
  /** Twilio MediaUrl0..N, in order. */
  mediaUrls: string[];
}

/** Base URL used to build the room / host / pay links we text back. */
function baseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
}

/**
 * Fetch MMS media from Twilio's CDN. Twilio media URLs require HTTP Basic auth
 * (accountSid:authToken). We only attempt this when BOTH creds are present;
 * otherwise the caller falls back to the demo receipt. Any failure returns null
 * so we degrade to the demo path rather than erroring the whole webhook.
 */
async function fetchMedia(url: string): Promise<{ buffer: Buffer; mime: string } | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mime };
  } catch {
    return null;
  }
}

/** A fresh, deep copy of the demo receipt (never hand callers the shared const). */
function demoReceipt(): ParsedReceipt {
  return { ...DEMO_RECEIPT, items: DEMO_RECEIPT.items.map((i) => ({ ...i })) };
}

/**
 * MMS receipt path: turn an inbound photo into a new split and reply with the
 * shareable room link + the host's private dashboard link.
 */
async function handleReceiptMms(input: InboundSms): Promise<string> {
  // Real OCR spends money — cap it per phone number and share the same global
  // hourly budget as the web endpoint so SMS can't be used to drain credits.
  const [phoneOk, globalOk] = await Promise.all([
    checkRateLimit(`ocr:phone:${input.from}`, 5, 60 * 60),
    checkRateLimit("ocr:global", 60, 60 * 60),
  ]);
  if (!phoneOk || !globalOk) {
    return "Whoa — that's a lot of receipts! Give it a little while and text the photo again.";
  }

  // Only fetch when we have creds AND a URL; otherwise (or on failure) demo.
  const media = input.mediaUrls[0] ? await fetchMedia(input.mediaUrls[0]) : null;
  const receipt = media
    ? (await parseReceiptImage(media.buffer, media.mime)).receipt
    : demoReceipt();

  const { splitId, hostKey, hostParticipantId } = await createSplit({
    hostName: "Host",
    restaurantName: receipt.restaurantName,
    date: new Date().toISOString().slice(0, 10), // display-only
    // A printed tip/service charge was already charged — collect exactly it.
    // Only default to 20% when the receipt carries no gratuity of its own.
    tipType: receipt.tipCents > 0 ? "amount" : "percent",
    tipValue: receipt.tipCents > 0 ? receipt.tipCents : 20,
    taxCents: receipt.taxCents,
    items: receipt.items.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      unitPriceCents: it.unitPriceCents,
      totalCents: it.totalCents,
    })),
    ocrJson: JSON.stringify(receipt),
  });

  // Bind this phone to the new split as the host participant, so the host can
  // immediately text their own claims ("I had the tacos") with no join step.
  await setPhoneSession(input.from, splitId, hostParticipantId);

  // Authoritative grand total (includes the 20% tip we just applied).
  const room = await getRoomState(splitId);
  const total = room ? room.settlement.grandTotalCents : receipt.totalCents;
  const restaurant = receipt.restaurantName ?? "Your receipt";
  const base = baseUrl();

  return (
    `Receipt received! 🧾 ${restaurant}: ${receipt.items.length} items, ${formatCents(total)} total. ` +
    `Share this link so everyone can claim: ${base}/split/${splitId} — ` +
    `your host dashboard: ${base}/split/${splitId}/host?key=${hostKey}`
  );
}

/** "join <code> <name>" — join (or rejoin) a split and bind this phone to it. */
async function handleJoin(input: InboundSms, code: string, name: string): Promise<string> {
  const base = baseUrl();
  if (!(await splitExists(code))) {
    return `I couldn't find a split with the code "${code}". Double-check it with your host, or text a photo of a receipt to start your own.`;
  }
  const participant = await joinParticipant(code, name);
  await setPhoneSession(input.from, code, participant.id);
  return (
    `You're in, ${participant.name}! 🎉 Follow along at ${base}/split/${code}. ` +
    `Text me what you ordered (e.g. "I had the tacos") and I'll add it to your tab.`
  );
}

/** "status" — per-person running totals + the unclaimed remainder. */
async function handleStatus(splitId: string): Promise<string> {
  const room = await getRoomState(splitId);
  if (!room) return noSessionHelp();
  const nameById = new Map(room.participants.map((p) => [p.id, p.name]));
  const lines = room.settlement.people.map(
    (p) => `${nameById.get(p.participantId) ?? "Someone"}: ${formatCents(p.totalCents)}`,
  );
  const unclaimed = room.settlement.unclaimed.totalCents;
  const where = room.split.restaurantName ?? "Your split";
  const tail =
    unclaimed > 0 ? `Still unclaimed: ${formatCents(unclaimed)}` : "Everything's claimed! 🎉";
  const body = lines.length ? lines.join("\n") : "No one's claimed anything yet.";
  return `${where} — where things stand:\n${body}\n${tail}`;
}

/**
 * Natural-language claim path: route the text through the (pure) claim parser
 * as `self`, persist the resulting actions, log the exchange, and reply with a
 * confirmation + the sender's running total and pay link.
 */
async function handleClaim(input: InboundSms, splitId: string, self: Participant): Promise<string> {
  const room = await getRoomState(splitId);
  if (!room) return noSessionHelp();
  const base = baseUrl();

  // Build ParseContext exactly like the /claim route does.
  const selfClaims = room.items.flatMap((it) =>
    it.claims
      .filter((c) => c.participantId === self.id)
      .map((c) => ({ itemId: c.itemId, shareLabel: formatFrac(c.share) })),
  );
  const ctx: ParseContext = {
    self,
    items: room.items,
    participants: room.participants,
    selfClaims,
  };

  const parse = parseClaimMessage(input.body, ctx);
  const applied = await applyActions(splitId, parse.actions);

  await logMessage({
    splitId,
    participantId: self.id,
    channel: "sms",
    body: input.body,
    reply: parse.reply || parse.clarification?.question || null,
  });

  // Fresh settlement after applying, so the running total reflects this message.
  const after = await getRoomState(splitId);
  const person = after ? settlementFor(after.settlement, self.id) : null;
  const total = person?.totalCents ?? 0;

  const summary =
    parse.reply?.trim() ||
    parse.clarification?.question ||
    'Hmm, I didn\'t catch that — try naming an item, like "I had the tacos".';

  const rejections = applied.rejected.length
    ? "\n" + applied.rejected.map((r) => `⚠️ ${r.reason}`).join("\n")
    : "";

  return (
    `${summary}${rejections}\n` +
    `You're at ${formatCents(total)} — pay here: ${base}/split/${splitId}/pay/${self.id}`
  );
}

/** First-contact help for a phone with no active session. */
function noSessionHelp(): string {
  return (
    "👋 I'm EasySplit. Text a photo of a receipt to start a new split, or reply " +
    '"join <code> <your name>" to join one a friend already started.'
  );
}

/**
 * Route one inbound SMS/MMS to a reply. Order of precedence:
 *   1. MMS with media  → create a split (host).
 *   2. "join <code> <name>" → join a split.
 *   3. active session + "status" → running totals.
 *   4. active session (any other text) → claim as the session participant
 *      (or the host participant, if the session has no participantId yet).
 *   5. no session → help text.
 */
export async function handleInboundSms(input: InboundSms): Promise<string> {
  const trimmed = input.body.trim();

  // 1. MMS receipt (takes priority even if there's a caption).
  if (input.numMedia > 0) {
    return handleReceiptMms(input);
  }

  // 2. "join <code> <name>" — name is the rest of the line (may be multi-word).
  const joinMatch = trimmed.match(/^join\s+(\S+)\s+([\s\S]+)$/i);
  if (joinMatch) {
    return handleJoin(input, joinMatch[1], joinMatch[2].trim());
  }

  // 3 & 4 require an active phone session.
  const session = await getPhoneSession(input.from);
  if (session) {
    const room = await getRoomState(session.splitId);
    if (!room) return noSessionHelp(); // session points at a deleted split

    if (/^status$/i.test(trimmed)) {
      return handleStatus(session.splitId);
    }

    // Resolve who's speaking: the session participant, else the host
    // participant (the person who texted the receipt has no participantId).
    let self: Participant | null = session.participantId
      ? room.participants.find((p) => p.id === session.participantId) ?? null
      : null;
    if (!self) self = room.participants.find((p) => p.isHost) ?? null;
    if (!self) return noSessionHelp();

    return handleClaim(input, session.splitId, self);
  }

  // 5. No session.
  return noSessionHelp();
}
