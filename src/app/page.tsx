import { Card, Money } from "@/components/ui";
import { LinkButton } from "@/components/new/LinkButton";
import { Logo } from "@/components/Logo";

/* Landing — the pitch. Warm, confident, one accent color. Server component. */

const STEPS = [
  {
    emoji: "📸",
    title: "Snap the receipt",
    body: "Take a photo — we read every item, price, and the tax for you.",
  },
  {
    emoji: "🙋",
    title: "Everyone claims what they got",
    body: "Friends open one link and tap their items, or just type “I had the burger.”",
  },
  {
    emoji: "💸",
    title: "Venmo handles the money",
    body: "Each person gets their exact share with a pay link. No chasing, no math.",
  },
];

// A tiny receipt to make the page feel like the product.
const PEEK = [
  { name: "Nachos Grande", cents: 1400 },
  { name: "Smash Burger", cents: 1650 },
  { name: "Margarita", cents: 1200, qty: 3 },
  { name: "Truffle Fries", cents: 600 },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-16 px-5 pb-16 pt-10 sm:pt-16">
        {/* Brand */}
        <div className="flex justify-center">
          <Logo />
        </div>

        {/* Hero */}
        <section className="flex flex-col items-center gap-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary-deep">
            No accounts · just a link
          </span>
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl">
            Text a receipt. Split the bill. Venmo settles it.
          </h1>
          <p className="max-w-sm text-base text-muted">
            No accounts. No math. No awkward follow-ups.
          </p>

          <div className="mt-2 flex w-full max-w-xs flex-col gap-3">
            <LinkButton href="/new" size="lg">
              Split a bill
            </LinkButton>
            <LinkButton href="/new?demo=1" variant="secondary" size="lg">
              Try it with a demo receipt
            </LinkButton>
          </div>

          {/* Receipt flourish */}
          <div className="receipt-edge mt-6 w-full max-w-xs px-5 py-6 text-left">
            <p className="text-center font-display text-base font-semibold text-ink">
              El Camino Cantina
            </p>
            <p className="mb-3 text-center text-xs text-muted">Table of 4 · tonight</p>
            <hr className="receipt-rule" />
            <ul className="my-3 flex flex-col gap-2">
              {PEEK.map((it) => (
                <li key={it.name} className="flex items-baseline justify-between text-sm">
                  <span className="text-ink">
                    {it.name}
                    {it.qty ? <span className="ml-1 text-muted tabular">×{it.qty}</span> : null}
                  </span>
                  <Money cents={it.qty ? it.cents * it.qty : it.cents} className="text-muted" />
                </li>
              ))}
            </ul>
            <hr className="receipt-rule" />
            <div className="mt-3 flex items-baseline justify-between">
              <span className="font-display text-sm font-semibold text-ink">Your share</span>
              <Money cents={2329} className="font-display text-base font-semibold text-primary" />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="flex flex-col gap-4">
          <h2 className="text-center font-display text-2xl font-semibold text-ink">
            How it works
          </h2>
          <div className="flex flex-col gap-3">
            {STEPS.map((s, i) => (
              <Card key={s.title} className="flex items-start gap-4 p-5">
                <span className="text-3xl leading-none" aria-hidden>
                  {s.emoji}
                </span>
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
                    <span className="tabular text-sm text-muted">{i + 1}.</span>
                    {s.title}
                  </span>
                  <p className="text-sm leading-snug text-muted">{s.body}</p>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Coming soon */}
        <p className="text-center text-sm text-muted">
          <span className="font-semibold text-ink">Coming soon:</span> text your receipt to a
          number, get a link back.
        </p>
      </main>

      <footer className="border-t border-line/70 py-6 text-center text-xs text-muted">
        <p className="font-display text-sm font-semibold text-ink">🧾 Settle</p>
        <p className="mt-1">Made for good dinners. We never touch your Venmo account.</p>
      </footer>
    </div>
  );
}
