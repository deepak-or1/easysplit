import type { ParseResult } from "../types";
import type { ClaimParser, ParseContext } from "./types";

/**
 * STUB — replaced by the real deterministic parser (see docs/CONTRACTS.md
 * §Claim parser for the full behavior spec and test examples).
 */
export const parseClaimMessage: ClaimParser = (
  message: string,
  _ctx: ParseContext,
): ParseResult => {
  void _ctx;
  return {
    actions: [],
    reply: "",
    clarification: {
      question: `I couldn't parse "${message}" yet — try tapping items instead.`,
    },
  };
};
