# Settle

**Text a receipt, everyone claims their food, Venmo settles it.** The host snaps
a photo of the bill, shares one link, and each friend taps (or just types "I had
the burger and a marg") to claim their items. Settle splits tax and tip
proportionally, reconciles to the exact cent, and hands everyone a prefilled
Venmo link. No accounts, no spreadsheet, no "who owes what" group text.

## Quickstart

Zero environment variables needed — it runs fully local and fully mocked.

```bash
npm install
npm run seed     # creates a demo split and prints its room + host links
npm run dev      # start the app on http://localhost:3000
```

Open the **room link** the seed printed (e.g. `http://localhost:3000/split/mfjnapxr`)
to see a fully-claimed, reconciled split. The **host dashboard** link (with
`?key=…`) is the private host view.

## Try it in 60 seconds

Prefer to click through it yourself? Skip the seed and go straight to the create
flow with the demo receipt preloaded:

```
http://localhost:3000/new?demo=1
```

Pick a tip, share the room link, open it in a second tab, join as a friend, and
claim a few items. That's the whole product.

## What's real vs mocked

Everything that makes Settle *work* is real. The two integrations that need
third-party credentials degrade gracefully to local mocks.

| Capability | Status |
|---|---|
| Split math — exact-cents allocation, proportional tax/tip, **reconciliation to the cent** | **Real** |
| Claims — checkbox taps **and** the natural-language parser ("half the nachos", "2 margaritas", "split the fries with Sam") | **Real** |
| Rooms, joining, live polling of room state | **Real** |
| Venmo pay links (web + deep link), copy-amount / copy-note fallbacks | **Real** |
| SQLite persistence (local, zero-config) | **Real** |
| Receipt OCR | **Mocked by default** — returns an editable demo receipt. Set `ANTHROPIC_API_KEY` and real photos are parsed by Claude vision. |
| Inbound SMS/MMS webhook | **Twilio-compatible, locally simulated.** No Twilio account needed to develop — POST to `/api/sms/inbound` with `curl` (see `docs/TWILIO.md`). |
| Venmo prefill | **Best-effort by design.** The amount/note prefill is a convenience; copy buttons are always shown as the reliable fallback. We never automate, script, or log into Venmo — the payer confirms every payment inside their own Venmo app. |

Simulate an inbound text locally:

```bash
curl -X POST -d "From=%2B15550001111&Body=hi&NumMedia=0" \
  http://localhost:3000/api/sms/inbound
```

## Environment

All variables are optional (see `.env.example`). With none set, Settle runs
demo OCR + local SQLite + simulated SMS.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enable real receipt-photo parsing via Claude vision. Unset → demo receipt. |
| `DATA_DIR` | Where uploads + the SQLite file live (default `./data`, gitignored). |
| `DATABASE_FILE` | Override the SQLite path (default `$DATA_DIR/settle.db`). |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | Wire up a real Twilio number for SMS/MMS. See `docs/TWILIO.md`. |
| `PUBLIC_BASE_URL` | Public origin used to build room links in SMS replies (default `http://localhost:3000`). |

## Architecture

**`src/lib/` is the foundation** — pure, framework-free, and the only place money
math or SQL lives:

- `types.ts` — domain types. `fraction.ts` — exact rationals (`Frac {n,d}`).
- `money.ts` — `formatCents` + **largest-remainder allocation**. `split-math.ts` —
  `computeSettlement`. `claims.ts` — pure claim application (over-claim rejection).
- `claim-parser/` — deterministic natural-language claim parser (no I/O).
- `store.ts` — the only module that touches the DB; `db.ts` / `schema.sql` —
  SQLite. `files.ts` — local upload storage. `ocr.ts` — receipt parsing (mock
  or Claude vision). `venmo.ts` — pay-link builder. `sms.ts` — SMS routing.
  `api.ts` — the typed client every UI calls (never raw `fetch`).

**Invariants (enforced, not aspirational):**

- **Money is always integer cents.** Rendering is the only place it becomes a
  string (`formatCents` / the `Money` component).
- **Fractional ownership is always an exact rational**, never a float — "half the
  fries" is `{1,2}`, "2 of 3 margaritas" is `{2,1}`.
- Tax and tip are allocated **proportionally by each person's item subtotal**
  using **largest-remainder rounding**, with the unclaimed bucket taking the
  degenerate remainder last.
- **Reconciliation invariant:** `Σ people.totalCents + unclaimed.totalCents ===
  grandTotalCents`, exactly, always — `settlement.reconciles` proves it. `npm run
  seed` prints this check.

Data flow: **UI → `src/lib/api.ts` (typed) → API route → `src/lib/store.ts` → DB.**
UI never calls raw `fetch`; routes never write SQL directly. Full request/response
contracts live in `docs/CONTRACTS.md`.

## Routes

**Pages**

| Path | What |
|---|---|
| `/` | Landing / pitch |
| `/new` (`?demo=1`) | Host create flow — snap or demo, correct items, set tip |
| `/split/[id]` | Guest room — claim items by tap or chat |
| `/split/[id]/host?key=…` | Host dashboard — edit items, track claims + payments |

**API** (contracts in `docs/CONTRACTS.md`)

| Method + path | What |
|---|---|
| `POST /api/receipts/parse` | Parse a receipt image (or `{demo:true}`). Never persists. |
| `POST /api/splits` | Create a split → `{ splitId, hostKey, url }`. |
| `GET /api/splits/[id]` | Full `RoomState` incl. computed settlement. |
| `PATCH /api/splits/[id]` | Host-only edits (`x-host-key`); full item replace. |
| `POST /api/splits/[id]/join` | Join by name (idempotent). |
| `POST /api/splits/[id]/claim` | Claim via `actions` (taps) or `message` (NL parser). |
| `POST /api/splits/[id]/pay` | Set paid status; records the person's current total. |
| `POST /api/sms/inbound` | Twilio-compatible SMS/MMS webhook (TwiML reply). |
| `GET /api/files/[name]` | Serve a stored upload (receipt photo / Venmo QR). |

## Testing

```bash
npm test        # vitest — split math, claims engine, parser, allocation
```

## Deploying to Vercel (free)

Settle runs on Vercel with a free Supabase Postgres + Storage backend. No code
changes — the storage layer switches drivers by env var.

1. **Push to GitHub.** Commit the repo and push it to a GitHub repository.
2. **Import to Vercel.** Go to [vercel.com/new](https://vercel.com/new), import
   the repo, and deploy (framework auto-detected as Next.js).
3. **Create a Supabase project** (free tier) and set these Environment Variables
   in Vercel → Project Settings → Environment Variables:
   - `DATABASE_URL` — the Supabase **Transaction pooler** connection string
     (Database → Connection string → Transaction pooler, port 6543).
   - `SUPABASE_URL` — the Project URL (API settings).
   - `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` key (API settings;
     server-only secret).
   - *(optional)* `ANTHROPIC_API_KEY` for real receipt OCR, and `PUBLIC_BASE_URL`
     set to your deployed origin so SMS room links resolve.
4. **Redeploy.** On the first request the Postgres schema **auto-bootstraps**
   (idempotent `CREATE TABLE IF NOT EXISTS …`) — no migration step to run.

Notes:

- With `DATABASE_URL` set the app uses Postgres; unset, it falls back to local
  SQLite. See `.env.example` → *Deploy (Vercel + Supabase)*.
- Without the two `SUPABASE_*` storage vars, image uploads **won't persist** on
  Vercel's ephemeral filesystem — the demo receipt and typed/edited receipts
  still work end to end; only uploaded photos/QRs are lost.

## Production checklist

- **Database:** set `DATABASE_URL` (Supabase Transaction pooler) — the app runs
  on Postgres automatically and bootstraps the schema on first request. The DDL
  lives in `supabase/migration.sql` (a parity mirror of `src/lib/schema.sql`);
  nothing else touches SQL — the whole app goes through `src/lib/store.ts`.
- **Object storage:** set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — uploads
  go to a public Supabase Storage bucket (`uploads`, auto-created) and
  `/api/files/[name]` 302-redirects to the object's public URL. Unset → local
  disk, as in dev. Only `src/lib/files.ts` and that route touch storage.
- **SMS:** set the Twilio env vars and point your number's inbound webhook at
  `/api/sms/inbound` (see `docs/TWILIO.md`).
- **Public URL:** set `PUBLIC_BASE_URL` to your real domain so SMS room links resolve.
- **Rate limiting:** add it in front of the write routes (`/api/splits*`,
  `/api/sms/inbound`) — creation and claims are unauthenticated by design.
- **Backups:** schedule Postgres backups and object-storage lifecycle rules.
