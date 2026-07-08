# Settle — design direction

**Feel:** a great dinner with friends, not an accounting tool. Warm receipt
paper, one confident accent color, playful-but-calm serif headlines, chat-like
energy in the room. Mobile-first — assume a phone held at the table; desktop
just gets more air (`max-w-md`/`max-w-lg` columns, centered).

## Tokens (already defined in `src/app/globals.css` — use these classes)

- Surfaces: `bg-paper` (page), `bg-card` (cards/receipt), `bg-cream` (soft panels)
- Text: `text-ink`, `text-muted`; hairlines `border-line`
- Accent: `bg-primary` / `text-primary` (persimmon #E4572E) — CTAs and moments
  of delight only, never large fills
- States: `bg-success`/`text-success` (claimed, paid), `bg-gold` (progress,
  highlights), `text-danger`
- Venmo actions ONLY: `bg-venmo` (brand blue) — a pay button should be
  unmistakably "the Venmo button"
- Type: `font-display` (Fraunces — headlines, money totals, restaurant names),
  `font-sans` (DM Sans — everything else). Money/qty always with `.tabular`
  (the `Money` component does this).
- Radii: `rounded-card` for cards, `rounded-full` for buttons/chips.
- Motion: `animate-[var(--animate-rise)]` for entering cards,
  `animate-[var(--animate-pop)]` for claim confirmations. Subtle. Never
  animate money changing without a settle.

## Signature elements

- **Receipt card:** wrap item lists in `.receipt-edge` (zig-zag perforated
  paper) with `.receipt-rule` dashed separators, item name left / `Money`
  right, muted `×2` quantity markers. The receipt should look like a receipt.
- **People:** `Avatar` initial circles (deterministic colors) — stack them on
  claimed items (`-space-x-2`) so the room feels alive.
- **Progress:** `ProgressBar` driven by `settlement.claimedRatio` with copy
  like "Everyone claims what they got" → "$41.20 of $150.35 claimed".
- **Chat claims:** guest chat input is a rounded pill with a send button;
  parser replies render as a bot bubble (`bg-cream`) with the friendly reply /
  clarification chips (`Chip` with the `options`).

## Microcopy (use these; keep the voice light, zero finance-speak)

- Hero: "Text a receipt. Split the bill. Venmo settles it."
- Sub: "No accounts. No math. No awkward follow-ups."
- Guest room header: "Everyone claims what they got."
- Pay page: "Venmo handles the money." / "You'll confirm inside Venmo — we
  never touch your account."
- Empty items: "Nothing claimed yet — dibs on the fries?"
- Fully claimed: "That's the whole bill. Time to settle up 🎉"

## Component rules

- Compose from `src/components/ui.tsx` (Button, Card, Input, Chip, Money,
  ProgressBar, Avatar, Badge, EmptyState, Spinner, CopyButton, ErrorNote).
  Add page-specific components under `src/components/<area>/`.
- Every async surface needs loading (Spinner/skeleton), error (ErrorNote with
  retry guidance), and empty states. No dead ends.
- Tap targets ≥ 44px on interactive rows. Sticky bottom bars for the primary
  action on mobile (`sticky bottom-0` + `bg-paper/90 backdrop-blur`).
- Tailwind v4: theme classes come from `@theme` tokens above; arbitrary values
  sparingly. No `tailwind.config.js` — it doesn't exist in v4.
