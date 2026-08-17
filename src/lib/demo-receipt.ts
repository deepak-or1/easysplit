import type { ParsedReceipt } from "./types";

/**
 * The demo receipt — used by the mock OCR path, the "Try a demo" flow on the
 * landing page, and the seed script. Numbers are chosen so the math exercises
 * quantities > 1, shared items, and non-trivial tax/tip allocation.
 */
export const DEMO_RECEIPT: ParsedReceipt = {
  restaurantName: "El Camino Cantina",
  date: null, // set at creation time
  items: [
    { name: "Queso Fundido", quantity: 1, unitPriceCents: 1200, totalCents: 1200 },
    { name: "Nachos Grande", quantity: 1, unitPriceCents: 1400, totalCents: 1400 },
    { name: "Smash Burger", quantity: 1, unitPriceCents: 1650, totalCents: 1650 },
    { name: "Truffle Fries", quantity: 1, unitPriceCents: 600, totalCents: 600 },
    { name: "Tacos al Pastor", quantity: 1, unitPriceCents: 1350, totalCents: 1350 },
    { name: "Margarita", quantity: 3, unitPriceCents: 1200, totalCents: 3600 },
    { name: "Hazy IPA", quantity: 2, unitPriceCents: 800, totalCents: 1600 },
    { name: "Mexican Coke", quantity: 1, unitPriceCents: 300, totalCents: 300 },
  ],
  subtotalCents: 11700,
  taxCents: 995, // ~8.5%
  tipCents: 0, // host picks tip at creation
  totalCents: 12695,
};

/**
 * The grocery demo — a household cart, returned by the demo parse when the
 * wizard is in grocery mode. Everything starts shared, nobody tips, and the
 * lines are the ones a grocery haul actually has: multi-unit staples plus one
 * by-the-each line whose printed total doesn't divide evenly.
 *
 * The sums here are LOAD-BEARING, not decoration: subtotalCents must equal the
 * exact sum of the item totalCents (the wizard's check step compares them and
 * warns on a mismatch), and totalCents must equal subtotal + tax with tip 0.
 * The Avocados line is deliberately indivisible — 500 ÷ 3 = 166.67, so the
 * unit price rounds to 167 and 3 × 167 = 501 ≠ 500. That mismatch is what
 * drives itemsFromReceipt to keep receiptTotalCents, so the printed 500 is
 * what the split charges. Edit any number and fix all three sums.
 */
export const DEMO_GROCERY_RECEIPT: ParsedReceipt = {
  restaurantName: "Green Basket Market",
  date: null, // set at creation time
  items: [
    { name: "Rotisserie Chicken", quantity: 1, unitPriceCents: 899, totalCents: 899 },
    { name: "Organic Bananas", quantity: 1, unitPriceCents: 249, totalCents: 249 },
    // 500 ÷ 3 doesn't divide — the printed line total wins over 3 × 167.
    { name: "Avocados", quantity: 3, unitPriceCents: 167, totalCents: 500 },
    { name: "Oat Milk", quantity: 2, unitPriceCents: 449, totalCents: 898 },
    { name: "Sourdough Loaf", quantity: 1, unitPriceCents: 549, totalCents: 549 },
    { name: "Greek Yogurt", quantity: 4, unitPriceCents: 129, totalCents: 516 },
    { name: "Baby Spinach", quantity: 1, unitPriceCents: 399, totalCents: 399 },
    { name: "Cherry Tomatoes", quantity: 1, unitPriceCents: 429, totalCents: 429 },
    { name: "Sharp Cheddar", quantity: 1, unitPriceCents: 679, totalCents: 679 },
    { name: "Ground Coffee", quantity: 1, unitPriceCents: 1199, totalCents: 1199 },
    { name: "Eggs, Dozen", quantity: 1, unitPriceCents: 559, totalCents: 559 },
    { name: "Rigatoni", quantity: 2, unitPriceCents: 219, totalCents: 438 },
    { name: "Olive Oil", quantity: 1, unitPriceCents: 1249, totalCents: 1249 },
    { name: "Dark Chocolate", quantity: 1, unitPriceCents: 379, totalCents: 379 },
  ],
  subtotalCents: 8942, // = exact sum of the item totals above
  taxCents: 760, // ~8.5%
  tipCents: 0, // nobody tips the self-checkout
  totalCents: 9702, // = subtotal + tax
};
