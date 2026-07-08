# Settle — API contracts & module boundaries

This is the source of truth for request/response shapes. UI code calls the
typed helpers in `src/lib/api.ts` (never raw `fetch`); API routes call
`src/lib/store.ts` (never SQL directly). All types live in `src/lib/types.ts`.

**Money is always integer cents. Fractional ownership is always an exact
rational `Frac {n, d}` (see `src/lib/fraction.ts`) — never floats.**

## Identity model (no accounts, by design)

- A **split** is a room addressed by short code: `/split/[id]`.
- The **host key** (`x-host-key` header) is a bearer secret returned once at
  creation; it gates all mutations of split metadata/items and paid-marking.
  The client stores it in localStorage (`settle:<id>:hostKey`).
- A **participant id** is created by `POST /join` and stored client-side
  (`settle:<id>:participant`). Guests self-identify by first name; rejoining
  with the same name returns the same participant.
- Room state (GET) is public to anyone with the link — that's the product.

## Routes

### `POST /api/receipts/parse`
Body: `{ imageDataUrl: string }` (data URL) **or** `{ demo: true }`.
Response: `ReceiptParseResponse` — `{ source: "llm" | "mock", receipt: ParsedReceipt, warning? }`.
Implementation: decode data URL → `parseReceiptImage(buffer, mime)` from
`src/lib/ocr.ts` (handles the no-key mock path itself). `{demo: true}` returns
`DEMO_RECEIPT` from `src/lib/demo-receipt.ts` with `source: "mock"`, no warning.
Does NOT persist anything.

### `POST /api/splits`
Body: `CreateSplitPayload` (see `src/lib/api.ts`) — includes optional
`receiptImageDataUrl` / `venmoQrDataUrl` (base64 data URLs; decode and persist
via `saveUpload()` from `src/lib/files.ts`), host name, venmo username
(normalize with `parseVenmoInput()`), tip/tax config, and the item list
(already corrected by the host in the UI).
Response: `CreateSplitResponse` — `{ splitId, hostKey, hostParticipantId, url }`.
Implementation: `createSplit()` from store. Validate with zod: hostName
required (1–40 chars), ≥1 item, each item name 1–80 chars, quantity int ≥1,
cents ints ≥0, tipValue ≥ 0, taxCents ≥ 0.

### `GET /api/splits/[id]`
Response: `RoomState` (already fully assembled — including computed
`settlement` — by `getRoomState()` from store). 404 `{error}` if unknown.

### `PATCH /api/splits/[id]`  (host only — `x-host-key`)
Body: `PatchSplitPayload` — any of the meta fields and/or the full `items`
array (full replace semantics; `replaceItems()` handles claim cleanup).
Response: fresh `RoomState`. 401 if key mismatch (`getHostKey()`).

### `POST /api/splits/[id]/join`
Body: `{ name: string }`. Response: `Participant`. Uses `joinParticipant()`
(idempotent per name).

### `POST /api/splits/[id]/claim`
Body: `{ participantId: string, actions?: ClaimAction[], message?: string }` —
exactly one of `actions` (checkbox taps; UI computed the shares) or `message`
(natural language).
Implementation:
1. Validate participant belongs to split (`getParticipant()`).
2. If `message`: build `ParseContext` and call `parseClaimMessage()` from
   `src/lib/claim-parser/parser.ts` → gives `actions` + `reply` +
   `clarification`. Log the message + reply via `logMessage()` (also log when
   parsing yields only a clarification).
3. Apply via `applyActions()` from store (validates over-claims etc.).
4. Response `ClaimResponse`: `{ parse: ParseResult | null, rejected:
   {reason}[], state: RoomState }`. Rejections come from
   `applyActions().rejected` — surface reasons; never 500 on a rejection.

### `POST /api/splits/[id]/pay`
Body: `{ participantId, status: "unpaid" | "reported" | "confirmed" }`.
Rules: `confirmed`/`unpaid` require host key; `reported` may be set by the
participant themselves (self-reported "I've paid"). Amount recorded =
that person's current `settlement.totalCents` (compute via `getRoomState()`).
Response: fresh `RoomState`.

### `POST /api/sms/inbound`
Twilio-compatible: accepts `application/x-www-form-urlencoded` with `From`,
`Body`, `NumMedia`, `MediaUrl0`, `MessageSid`. Responds TwiML XML
(`<Response><Message>…</Message></Response>`, content-type `text/xml`).
Flow (see `src/lib/sms.ts`):
- MMS with image → parse receipt (`parseReceiptImage`; mock w/o key) → create
  split (host name "Host", default 20% tip) → `setPhoneSession(From, splitId)`
  → reply with room link (`PUBLIC_BASE_URL ?? http://localhost:3000`).
- Text starting with a room code (e.g. `join abc123 Maya`) → join + session.
- Other text with an active phone session → route through the claim parser as
  that participant; reply with their running total + pay link.
- No session → help text.
Local testing: `curl -X POST -d "From=%2B15550001111&Body=hi&NumMedia=0" localhost:3000/api/sms/inbound`.
Twilio wiring notes live in `docs/TWILIO.md`; never require real creds.

## Claim parser (`src/lib/claim-parser/`)

`parseClaimMessage(message, ctx) → ParseResult` — pure, deterministic, no I/O.
`ctx`: `{ self, items, participants, selfClaims }`.

Required behaviors (all case-insensitive, fuzzy on item names — singular/plural,
partial words, e.g. "burger" → "Smash Burger", "marg" → "Margarita"):

| Input | Actions |
|---|---|
| "I had the burger" | set self→Burger share 1/1 |
| "I had burger and fries" | two `set` actions, 1 each |
| "half the nachos" / "I had half the fries" | set share 1/2 |
| "a third of the queso" | set share 1/3 |
| "2 beers" / "I had 2 margaritas" | set share 2/1 |
| "split the nachos with Alex and Maya" | `split` action, participantIds = [self, Alex, Maya] |
| "share fries with Sam" | `split`, [self, Sam] |
| "I'll cover Sam's beer" / "I got Sam's drink" | set self→Beer 1/1 (self pays) |
| "remove the burger" / "I didn't have the fries" / "undo the tacos" | `unclaim` |

Clarifications instead of failures:
- Item text matches ≥2 items about equally → `clarification` with `options`
  listing the candidate item names.
- Item text matches nothing → clarification: "I don't see that on the
  receipt…" + 2–3 closest item names as options.
- "split with X" where X isn't a participant → clarification "X hasn't joined
  yet — they can open the room link. Split it without them for now?" with
  options ["Split among the rest", "Never mind"].
- Empty/unintelligible → gentle help text with an example.

`reply` should read like a friendly confirmation: "Got it — Smash Burger and
½ Truffle Fries. You're at $23.40 before tax/tip." (running total optional —
if included, compute items-only cents from shares × item prices).

Multi-clause: split on " and " / commas ONLY when the clause isn't a
"split … with A and B" name list. Quantity words: "two"→2 … up to "six".
"the rest of"/"rest of the" may map to the item's remaining share if simple.

## Frac quick reference

`fr(n, d)` normalize; `fadd/fsub/fmul/fcmp/fsum`; `formatFrac({1,2}) === "½"`.
Claims: share is in item units — "2 of 3 margaritas" = `fr(2)`, "half the
fries" (qty 1) = `fr(1,2)`. `split` among N people of qty q = `fr(q, N)` each
(computed inside `applyClaimActions`; parser just emits `{type:"split"}`).

## Settlement semantics (already implemented — do not re-derive in UI)

- `computeSettlement()` allocates each item's `totalCents` across its claims
  plus an unclaimed remainder, then tax & tip proportional to each person's
  item subtotal, all via largest-remainder rounding. Σ person totals +
  unclaimed = grand total, exactly, always (`settlement.reconciles`).
- `sharedByAll` items are auto-split among all current participants.
- UIs display `settlement.people[…]` and `settlement.unclaimed`; never do
  money math client-side beyond formatting.

## Venmo (`src/lib/venmo.ts`)

`buildVenmoPayment(split, personSettlement, items)` → `{ amount, note, webUrl,
deepLink, username }`. Pay pages show, in order: big Venmo button (webUrl),
copy-amount + copy-note buttons (first-class, always shown), username display,
host QR image if present, and "always confirm inside Venmo" microcopy. If
`username` is null: copy buttons + "ask the host for their Venmo" note.
