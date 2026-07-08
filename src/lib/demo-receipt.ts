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
