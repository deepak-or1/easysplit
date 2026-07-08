import type { Participant, ParseResult, ReceiptItem } from "../types";

/**
 * Claim-parser abstraction. The default implementation (parser.ts) is
 * deterministic — fuzzy matching + pattern rules, no network calls — so it's
 * fast, free, and testable. Because the interface is one pure function, an
 * LLM-backed implementation can be swapped in later without touching callers
 * (the claim API route and the SMS webhook are the only consumers).
 */

export interface ParseContext {
  /** The person speaking. Their claims are the default target. */
  self: Participant;
  items: ReceiptItem[];
  participants: Participant[];
  /** Existing claims by self, so "actually just half" style corrections have context. */
  selfClaims: { itemId: string; shareLabel: string }[];
}

export type ClaimParser = (message: string, ctx: ParseContext) => ParseResult;
