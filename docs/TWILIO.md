# Wiring Settle to Twilio SMS

Settle is **SMS-first**: a host texts a photo of a receipt, friends text `join`
and what they ordered, and everyone gets a Venmo pay link back. The whole flow
runs **fully mocked with zero credentials** — the inbound webhook works out of
the box against `localhost`, no Twilio account required. This doc explains how
to point a real Twilio number at it when you're ready.

- **Route:** `POST /api/sms/inbound` (`src/app/api/sms/inbound/route.ts`)
- **Logic:** `handleInboundSms()` in `src/lib/sms.ts` (transport-agnostic, unit-invokable)
- **Contract:** see the `POST /api/sms/inbound` section of `docs/CONTRACTS.md`

The route parses Twilio's `application/x-www-form-urlencoded` webhook body,
calls `handleInboundSms`, and replies with TwiML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>…reply…</Message></Response>
```

Content-type is `text/xml`, and the reply text is XML-escaped.

---

## What the webhook understands

| Inbound | Result |
|---|---|
| **MMS with a photo** (`NumMedia >= 1`) | OCR the receipt → create a split (host "Host", 20% tip) → reply with the room link + the host dashboard link. Binds this phone to the split as host. |
| `join <code> <name>` | Join (or rejoin) that split, bind this phone to it, reply with the room link. |
| `status` (with an active session) | Per-person running totals + the unclaimed remainder. |
| any other text (with an active session) | Route through the claim parser as that person; reply with a confirmation + their running total and pay link. |
| anything (no session) | Help text. |

---

## Required environment variables

All of these are **optional** — see `.env.example`. With none set, the app runs
fully mocked (demo OCR, local SQLite, no signature checks, no MMS fetch).

| Var | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Account SID (`AC…`). Used as the HTTP Basic **username** to fetch MMS media. |
| `TWILIO_AUTH_TOKEN` | Auth token. Used both to (a) fetch MMS media and (b) validate the `X-Twilio-Signature` on every inbound request. **When this is set, signature validation is enforced and unsigned/forged requests get a 403.** |
| `TWILIO_PHONE_NUMBER` | Your Twilio number in E.164 (`+1555…`). Informational for the app; the number's console config is what actually routes messages. |
| `PUBLIC_BASE_URL` | Public origin (e.g. `https://settle.example.com`). Used to build the room/host/pay links in replies **and** to reconstruct the exact URL Twilio signed when validating behind a proxy/ngrok. Defaults to `http://localhost:3000`. |
| `ANTHROPIC_API_KEY` | Optional. With it, receipt photos are parsed by Claude vision; without it, the OCR pipeline returns an editable demo receipt. |

---

## Go-live steps

1. **Buy a number** with SMS/MMS capability in the
   [Twilio Console](https://console.twilio.com/) → Phone Numbers → Buy a number.
2. **Set the inbound webhook.** On the number's config page, under
   **Messaging → "A message comes in"**, choose **Webhook**, method **HTTP POST**,
   and set the URL to:

   ```
   <PUBLIC_BASE_URL>/api/sms/inbound
   ```

   e.g. `https://settle.example.com/api/sms/inbound`.
3. **Set env vars** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_PHONE_NUMBER`, `PUBLIC_BASE_URL`) on the deployment and restart.
4. **Text the number a receipt photo** from your phone. You should get the room
   link back within a couple of seconds.

---

## Local testing with ngrok

Twilio must reach your machine over HTTPS, so tunnel your dev server:

```bash
# terminal 1 — the app
npm run dev                      # http://localhost:3000

# terminal 2 — expose it
ngrok http 3000                  # -> https://<random>.ngrok-free.app
```

Then set the number's webhook to `https://<random>.ngrok-free.app/api/sms/inbound`
and set `PUBLIC_BASE_URL=https://<random>.ngrok-free.app` in `.env.local`.

> **Why `PUBLIC_BASE_URL` matters for ngrok:** Twilio signs the request against
> the **public** URL it called (the ngrok HTTPS URL), but inside Next `req.url`
> is the internal `http://localhost:3000` address. The route reconstructs the
> signed URL from `PUBLIC_BASE_URL` + path so signature validation still passes
> behind the tunnel. Get this wrong and every request 403s.

You do **not** need ngrok to exercise the logic — the curl examples below hit
`localhost` directly (signature validation is skipped when `TWILIO_AUTH_TOKEN`
is unset).

---

## Signature validation

When `TWILIO_AUTH_TOKEN` is set, the route validates the `X-Twilio-Signature`
header using Twilio's standard algorithm (see `isValidTwilioSignature` in the
route):

1. Take the exact webhook URL Twilio requested (scheme + host + path + query).
2. Append every POST param, **sorted alphabetically by key**, as `key + value`
   concatenated with no separators.
3. HMAC-SHA1 that string with the auth token; base64-encode.
4. Constant-time compare against the header; mismatch → **403**.

When the token is **unset**, validation is skipped (local mock mode) so you can
curl the endpoint freely.

---

## MMS media auth

Twilio's media URLs (`MediaUrl0…`) are **not public** — fetching them requires
HTTP Basic auth with `accountSid:authToken`. `handleInboundSms` only attempts
the fetch when **both** `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set;
otherwise (or on any fetch failure) it falls back to the demo receipt so the
flow never dead-ends. When bytes are in hand it runs them through
`parseReceiptImage` (which itself falls back to the demo receipt if
`ANTHROPIC_API_KEY` is absent).

---

## Copy-pasteable curl examples

These simulate Twilio's POST against a local dev server (mock mode — no creds,
no signature). Each prints the TwiML reply.

**1. An MMS receipt** (`NumMedia=1` + a media URL → creates a split):

```bash
curl -X POST http://localhost:3000/api/sms/inbound \
  --data-urlencode "From=+15550001111" \
  --data-urlencode "Body=" \
  --data-urlencode "NumMedia=1" \
  --data-urlencode "MediaUrl0=https://example.com/r.jpg" \
  --data-urlencode "MessageSid=SM00000000000000000000000000000001"
```

Copy the `<code>` out of the `/split/<code>` link in the reply for the next call.

**2. Joining that split** (replace `abc123` with the code from step 1):

```bash
curl -X POST http://localhost:3000/api/sms/inbound \
  --data-urlencode "From=+15550002222" \
  --data-urlencode "Body=join abc123 Maya" \
  --data-urlencode "NumMedia=0" \
  --data-urlencode "MessageSid=SM00000000000000000000000000000002"
```

**3. Claiming an item** (from the same phone that joined in step 2):

```bash
curl -X POST http://localhost:3000/api/sms/inbound \
  --data-urlencode "From=+15550002222" \
  --data-urlencode "Body=I had the tacos" \
  --data-urlencode "NumMedia=0" \
  --data-urlencode "MessageSid=SM00000000000000000000000000000003"
```

> The `--data-urlencode` flags handle spaces and the leading `+` in `From` for
> you. To watch the whole flow without HTTP at all, run the throwaway smoke
> script (dynamic-imports `src/lib/sms.ts` with a temp DB):
>
> ```bash
> rm -f /tmp/sms-smoke.db && npx tsx /tmp/sms-smoke.ts
> ```
