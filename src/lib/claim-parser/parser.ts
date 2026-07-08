import type { ClaimAction, Clarification, Frac, ParseResult, Participant, ReceiptItem } from "../types";
import type { ClaimParser, ParseContext } from "./types";
import { fr, formatFrac } from "../fraction";

/**
 * Deterministic natural-language claim parser. Pure function, no I/O, no LLM.
 *
 * Pipeline: normalize -> split into clauses (keeping "with A and B" name lists
 * intact) -> per clause, pattern-match in a fixed order (unclaim, split-with,
 * cover, then a generic set matcher that folds fraction / quantity / plain
 * claims together). Item resolution is fuzzy (case-insensitive scoring with
 * singular/plural + partial-word handling and a small synonym map). Anything it
 * can't pin down comes back as a friendly `clarification` rather than a failure.
 */

// Sentinel that stands in for a protected "and"/"," inside a name list so the
// clause splitter doesn't break "split X with A and B" apart. It never appears
// in user text (a private-use control char).
const NAME_SEP = "\u0001";

// ---------- word tables ----------

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

// Category words -> ordered list of item-name tokens they may stand in for.
// Braces denote an (unordered) set in the spec; the order here is the
// resolution priority — the first target that exists on the receipt wins. This
// makes a bare "drink" resolve to the beer (per the CONTRACTS cover example)
// while "coke"/"soda" resolve to the cola.
const SYNONYMS: Record<string, string[]> = {
  beer: ["ipa", "lager", "ale", "pilsner", "stout", "beer"],
  coke: ["coke", "cola", "soda"],
  cola: ["coke", "cola", "soda"],
  soda: ["coke", "cola", "soda"],
  drink: ["ipa", "beer", "lager", "ale", "stout", "margarita", "cocktail", "coke", "cola", "wine"],
};

// Stored apostrophe-free; membership is always tested after stripping apostrophes.
const STOPWORDS = new Set<string>([
  // pronouns / speaker
  "i", "im", "ive", "id", "ill", "we", "weve", "well", "us", "you", "your", "youre",
  "he", "she", "they", "them", "lets",
  // claim / possession verbs
  "had", "have", "has", "having", "get", "got", "getting", "gets", "grab", "grabbed",
  "grabbing", "take", "took", "taking", "taken", "order", "ordered", "ordering", "orders",
  "eat", "ate", "eaten", "eating", "want", "wanted", "wants", "would", "like", "likes",
  "liked", "do", "did", "does", "doing", "done", "was", "were", "is", "are", "am", "be",
  "been", "being", "gonna", "wanna", "gimme", "give", "gave", "pay", "paid", "paying", "pays",
  // action verbs handled by dedicated branches (drop them from item text)
  "cover", "covered", "covering", "covers", "split", "splitting", "splits", "share",
  "shared", "sharing", "shares", "halve", "divide", "divvy", "remove", "removed",
  "removing", "removes", "undo", "undid", "cancel", "cancelled", "canceled", "scratch",
  "drop", "dropped", "off", "out",
  // articles / fillers / prepositions
  "the", "a", "an", "some", "that", "this", "these", "those", "it", "its", "my", "mine",
  "me", "myself", "our", "ours", "for", "to", "of", "on", "in", "at", "please", "just",
  "also", "only", "too", "really", "actually", "then", "plus", "already", "um", "uh",
  "yeah", "ok", "okay", "put", "down", "claim", "claiming", "claimed", "claims", "think",
  "guess", "went", "go", "going", "and", "with", "but", "or", "all",
  // negations
  "didnt", "dont", "doesnt", "cant", "wont", "isnt", "arent", "wasnt", "werent",
  "havent", "hadnt", "not", "never", "no", "nope",
]);

const FRACTION_WORDS = new Set<string>([
  "half", "halves", "third", "thirds", "quarter", "quarters", "fourth", "fourths",
]);

// ---------- small helpers ----------

function stripApostrophes(t: string): string {
  return t.replace(/'/g, "");
}

function isStop(t: string): boolean {
  return STOPWORDS.has(stripApostrophes(t));
}

function isFracWord(t: string): boolean {
  return FRACTION_WORDS.has(t);
}

function parseCount(t: string): number | null {
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    return n >= 1 ? n : null;
  }
  return NUMBER_WORDS[t] ?? null;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/** Lowercase, normalize apostrophes, strip punctuation but keep ' & , for later. */
function preclean(msg: string): string {
  return msg
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9'&,\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a message into clauses on " and " / commas / "&", but never split the
 * name list that follows "with" in a "split/share … with A and B" phrase.
 */
function splitClauses(text: string): string[] {
  let working = text;
  const withMatch = text.match(/\b(?:split|share)\b.*?\bwith\b(.*)$/);
  if (withMatch) {
    const names = withMatch[1];
    const start = text.length - names.length;
    const head = text.slice(0, start);
    const protectedNames = names
      .replace(/\s+and\s+/g, ` ${NAME_SEP} `)
      .replace(/\s*&\s*/g, ` ${NAME_SEP} `)
      .replace(/\s*,\s*/g, ` ${NAME_SEP} `);
    working = head + protectedNames;
  }
  return working
    .split(/\s+and\s+|\s*,\s*|\s*&\s*/)
    .map((s) => s.split(NAME_SEP).join("and").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Normalize a token for item scoring: alphanumerics only, singularize trailing -s. */
function normToken(t: string): string {
  let s = t.replace(/[^a-z0-9]/g, "");
  if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return s;
}

function itemTokens(item: ReceiptItem): string[] {
  return tokenize(item.name.toLowerCase())
    .map(normToken)
    .filter((t) => t.length > 0);
}

// ---------- item matching ----------

const MIN_MATCH = 0.4;
const CLOSE_RATIO = 0.85;

type MatchResult =
  | { kind: "match"; item: ReceiptItem }
  | { kind: "ambiguous"; options: string[] }
  | { kind: "none"; options: string[] }
  | { kind: "empty" };

function tokenScore(q: string, it: string): number {
  if (!q || !it) return 0;
  if (q === it) return 1;
  if (q.length >= 3 && it.startsWith(q)) return 0.8;
  if (it.length >= 3 && q.startsWith(it)) return 0.7;
  if (q.length >= 3 && it.includes(q)) return 0.5;
  if (it.length >= 3 && q.includes(it)) return 0.45;
  return 0;
}

function scoreItem(qTokens: string[], iTokens: string[]): number {
  let sum = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const it of iTokens) best = Math.max(best, tokenScore(q, it));
    sum += best;
  }
  // Reward an exact full-phrase match so "margarita" beats "margarita flight".
  if (qTokens.length > 0 && qTokens.join(" ") === iTokens.join(" ")) sum += 2;
  return sum;
}

function synonymMatch(qTokens: string[], items: ReceiptItem[]): ReceiptItem | null {
  const tokenLists = items.map((it) => ({ it, toks: itemTokens(it) }));
  for (const q of qTokens) {
    const targets = SYNONYMS[q];
    if (!targets) continue;
    for (const target of targets) {
      const nt = normToken(target);
      const hit = tokenLists.find((entry) => entry.toks.includes(nt));
      if (hit) return hit.it;
    }
  }
  return null;
}

function matchItem(phrase: string, items: ReceiptItem[]): MatchResult {
  const qTokens = tokenize(phrase)
    .map(normToken)
    .filter((t) => t.length > 0 && !isStop(t));
  if (qTokens.length === 0) return { kind: "empty" };

  const scored = items
    .map((item, idx) => ({ item, idx, score: scoreItem(qTokens, itemTokens(item)) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  const top = scored[0];
  const second = scored[1];

  if (top && top.score >= MIN_MATCH) {
    if (
      second &&
      second.score > 0 &&
      second.score >= top.score * CLOSE_RATIO &&
      second.item.name !== top.item.name
    ) {
      const options = scored
        .filter((s) => s.score > 0 && s.score >= top.score * CLOSE_RATIO)
        .map((s) => s.item.name);
      return { kind: "ambiguous", options };
    }
    return { kind: "match", item: top.item };
  }

  const syn = synonymMatch(qTokens, items);
  if (syn) return { kind: "match", item: syn };

  const options = scored.slice(0, 3).map((s) => s.item.name);
  return { kind: "none", options };
}

// ---------- participant matching ----------

function firstName(p: Participant): string {
  return p.name.toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, "");
}

function matchParticipant(typed: string, participants: Participant[]): Participant | null {
  const t = typed.toLowerCase().replace(/[^a-z]/g, "");
  if (!t) return null;
  for (const p of participants) if (firstName(p) === t) return p;
  for (const p of participants) {
    const f = firstName(p);
    if (f.length >= 2 && (f.startsWith(t) || t.startsWith(f))) return p;
  }
  return null;
}

// ---------- share extraction (fraction / quantity / plain) ----------

interface FractionHit {
  den: number;
  num: number;
  index: number;
  numIndex: number | null;
}

function findFraction(tokens: string[]): FractionHit | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    let den = 0;
    if (t === "half" || t === "halves") den = 2;
    else if (t === "third" || t === "thirds") den = 3;
    else if (t === "quarter" || t === "quarters" || t === "fourth" || t === "fourths") den = 4;
    if (den) {
      let num = 1;
      let numIndex: number | null = null;
      if (den !== 2 && i > 0) {
        const p = parseCount(tokens[i - 1]);
        if (p != null) {
          num = p;
          numIndex = i - 1;
        }
      }
      return { den, num, index: i, numIndex };
    }
  }
  return null;
}

/** Pull a share (fraction or quantity, default 1/1) out of a clause and return the leftover item text. */
function extractShareAndItem(tokens: string[]): { share: Frac; itemPhrase: string } {
  const consumed = new Set<number>();
  let share = fr(1, 1);

  const fh = findFraction(tokens);
  if (fh) {
    consumed.add(fh.index);
    if (fh.numIndex != null) consumed.add(fh.numIndex);
    share = fr(fh.num, fh.den);
  } else {
    for (let i = 0; i < tokens.length; i++) {
      const n = parseCount(tokens[i]);
      if (n != null) {
        consumed.add(i);
        share = fr(n, 1);
        break;
      }
    }
  }

  const itemPhrase = tokens
    .filter((t, i) => !consumed.has(i) && !isStop(t) && !isFracWord(t) && parseCount(t) == null)
    .join(" ");
  return { share, itemPhrase };
}

// ---------- clause results ----------

type ClauseResult =
  | { kind: "actions"; actions: ClaimAction[]; summaries: string[] }
  | { kind: "clarification"; clarification: Clarification };

function setSummary(share: Frac, name: string): string {
  return share.n === 1 && share.d === 1 ? name : `${formatFrac(share)} ${name}`;
}

function gentleClar(): Clarification {
  return { question: "I didn't catch that. Try: I had the burger and half the fries." };
}

function clarFromMatch(m: MatchResult, phrase: string): Clarification {
  if (m.kind === "ambiguous") {
    return { question: `Which one did you mean — ${m.options.join(" or ")}?`, options: m.options };
  }
  if (m.kind === "none") {
    return {
      question: `I don't see "${phrase}" on the receipt. Which item did you mean?`,
      options: m.options,
    };
  }
  return gentleClar();
}

// ---------- pattern matchers ----------

function isUnclaim(clause: string): boolean {
  if (/\b(remove|removing|removed|undo|unclaim|cancel|scratch|drop)\b/.test(clause)) return true;
  if (/\btake\s+(off|out)\b/.test(clause)) return true;
  const negated = /\b(didn'?t|did\s?not|don'?t|do\s?not|never|not)\b/.test(clause);
  const claimish = /\b(have|had|having|want|order|ordered|get|got|mine|it|that|this)\b/.test(clause);
  return negated && claimish;
}

function isCover(clause: string): boolean {
  const m = clause.match(/\b([a-z]+)'s\b/);
  if (!m) return false;
  const name = m[1];
  const generic = ["it", "that", "what", "let", "here", "there", "one", "he", "she", "they", "who", "someone", "everyone"];
  if (generic.includes(name)) return false;
  return /\b(cover|covering|covered|got|get|getting|grab|grabbed|grabbing|buy|buying|bought|treat|treating|pay|paying)\b/.test(clause);
}

function handleUnclaim(clause: string, ctx: ParseContext): ClauseResult {
  const itemPhrase = tokenize(clause)
    .filter((t) => !isStop(t) && !isFracWord(t) && parseCount(t) == null)
    .join(" ");
  if (!itemPhrase.trim()) return { kind: "clarification", clarification: gentleClar() };
  const m = matchItem(itemPhrase, ctx.items);
  if (m.kind === "match") {
    return {
      kind: "actions",
      actions: [{ type: "unclaim", itemId: m.item.id, participantId: ctx.self.id }],
      summaries: [`removed ${m.item.name}`],
    };
  }
  return { kind: "clarification", clarification: clarFromMatch(m, itemPhrase) };
}

function handleSplit(clause: string, ctx: ParseContext): ClauseResult {
  const m = clause.match(/\b(?:split|splitting|share|sharing|halve|divide|divvy)\b(.*?)\bwith\b(.*)$/);
  if (!m) {
    return { kind: "clarification", clarification: { question: "Who do you want to split it with?" } };
  }
  const itemPhrase = tokenize(m[1])
    .filter((t) => !isStop(t) && !isFracWord(t) && parseCount(t) == null)
    .join(" ");
  const im = matchItem(itemPhrase, ctx.items);
  if (im.kind !== "match") {
    return { kind: "clarification", clarification: clarFromMatch(im, itemPhrase) };
  }

  const rawNames = m[2].split(/\s+and\s+|\s*,\s*|\s*&\s*/).map((s) => s.trim()).filter(Boolean);
  const ids: string[] = [ctx.self.id];
  const labels: string[] = [];
  for (const nm of rawNames) {
    if (["me", "myself", "i"].includes(nm)) continue;
    const p = matchParticipant(nm, ctx.participants);
    if (!p) {
      return {
        kind: "clarification",
        clarification: {
          question: `${capitalize(nm)} hasn't joined yet — they can open the room link. Split it without them for now?`,
          options: ["Split among the rest", "Never mind"],
        },
      };
    }
    if (!ids.includes(p.id)) ids.push(p.id);
    labels.push(p.name);
  }

  return {
    kind: "actions",
    actions: [{ type: "split", itemId: im.item.id, participantIds: ids }],
    summaries: [labels.length ? `split ${im.item.name} with ${joinList(labels)}` : `split ${im.item.name}`],
  };
}

function handleCover(clause: string, ctx: ParseContext): ClauseResult {
  const pm = clause.match(/\b([a-z]+)'s\b/);
  const name = pm ? pm[1] : null;
  const afterIdx = pm ? clause.indexOf(pm[0]) + pm[0].length : 0;
  const rest = clause.slice(afterIdx);
  const { share, itemPhrase } = extractShareAndItem(tokenize(rest));
  if (!itemPhrase.trim()) return { kind: "clarification", clarification: gentleClar() };
  const m = matchItem(itemPhrase, ctx.items);
  if (m.kind === "match") {
    const who = name ? capitalize(name) : "them";
    return {
      kind: "actions",
      actions: [{ type: "set", itemId: m.item.id, participantId: ctx.self.id, share }],
      summaries: [`${setSummary(share, m.item.name)} (covering ${who})`],
    };
  }
  return { kind: "clarification", clarification: clarFromMatch(m, itemPhrase) };
}

function handleSet(clause: string, ctx: ParseContext): ClauseResult {
  const { share, itemPhrase } = extractShareAndItem(tokenize(clause));
  if (!itemPhrase.trim()) return { kind: "clarification", clarification: gentleClar() };
  const m = matchItem(itemPhrase, ctx.items);
  if (m.kind === "match") {
    return {
      kind: "actions",
      actions: [{ type: "set", itemId: m.item.id, participantId: ctx.self.id, share }],
      summaries: [setSummary(share, m.item.name)],
    };
  }
  return { kind: "clarification", clarification: clarFromMatch(m, itemPhrase) };
}

function matchClause(clause: string, ctx: ParseContext): ClauseResult {
  if (isUnclaim(clause)) return handleUnclaim(clause, ctx);
  if (/\b(split|splitting|share|sharing|halve|divide|divvy)\b/.test(clause) && /\bwith\b/.test(clause)) {
    return handleSplit(clause, ctx);
  }
  if (isCover(clause)) return handleCover(clause, ctx);
  return handleSet(clause, ctx);
}

// ---------- reply assembly ----------

function joinList(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ---------- entry point ----------

export const parseClaimMessage: ClaimParser = (message: string, ctx: ParseContext): ParseResult => {
  const cleaned = preclean(message);
  if (!cleaned) {
    const g = gentleClar();
    return { actions: [], reply: g.question, clarification: g };
  }

  const clauses = splitClauses(cleaned);
  const actions: ClaimAction[] = [];
  const summaries: string[] = [];

  for (const clause of clauses) {
    const res = matchClause(clause, ctx);
    if (res.kind === "clarification") {
      return { actions: [], reply: res.clarification.question, clarification: res.clarification };
    }
    actions.push(...res.actions);
    summaries.push(...res.summaries);
  }

  if (actions.length === 0) {
    const g = gentleClar();
    return { actions: [], reply: g.question, clarification: g };
  }

  return { actions, reply: `Got it — ${joinList(summaries)}.` };
};
