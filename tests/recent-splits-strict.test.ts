import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRecentSplits, type RecentSplit } from "@/lib/api";

/**
 * getRecentSplits() promises RecentSplit[] to its callers, so every field the
 * type advertises is validated — not just splitId. localStorage is shared with
 * older builds of this app (and with anything else on the origin), so a stored
 * entry can be any shape at all; a UI doing `.name.trim()` on one of those
 * would throw and take the whole page down with it.
 */

const KEY = "settle:recent";

/** Minimal localStorage stand-in; the node test env has neither it nor window. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  return store;
}

const good: RecentSplit = {
  splitId: "abc123",
  name: "Taqueria",
  role: "host",
  at: "2026-07-27T12:00:00.000Z",
};

let store: Map<string, string>;

/** Write a raw array (entries deliberately off-type) and read it back. */
function readBack(entries: unknown[]): RecentSplit[] {
  store.set(KEY, JSON.stringify(entries));
  return getRecentSplits();
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  store = stubStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("getRecentSplits — every advertised field is validated", () => {
  it("keeps a fully valid entry", () => {
    expect(readBack([good])).toEqual([good]);
  });

  it("drops an entry with a splitId but no name", () => {
    const { name: _name, ...noName } = good;
    expect(readBack([noName, good])).toEqual([good]);
  });

  it("drops an entry whose name isn't a string", () => {
    expect(readBack([{ ...good, name: 42 }, good])).toEqual([good]);
  });

  it("drops an entry with a role outside host/guest", () => {
    expect(readBack([{ ...good, role: "owner" }, good])).toEqual([good]);
  });

  it("drops an entry with a missing role", () => {
    const { role: _role, ...noRole } = good;
    expect(readBack([noRole, good])).toEqual([good]);
  });

  it("drops an entry whose `at` is null", () => {
    expect(readBack([{ ...good, at: null }, good])).toEqual([good]);
  });

  it("drops an entry with a missing `at`", () => {
    const { at: _at, ...noAt } = good;
    expect(readBack([noAt, good])).toEqual([good]);
  });

  it("still drops non-objects and entries without a splitId", () => {
    expect(readBack([null, 42, "nope", [], { name: "no id" }, good])).toEqual([good]);
  });

  it("keeps both roles and ignores extra fields", () => {
    const guest: RecentSplit = { ...good, splitId: "def456", role: "guest" };
    const withExtra = { ...good, splitId: "ghi789", note: "written by an older build" };
    expect(readBack([guest, withExtra])).toEqual([guest, withExtra]);
  });

  it("survives a garbage entry sitting next to good ones", () => {
    const older = { splitId: "old1", name: "Diner", role: "guest", at: "2026-01-01T00:00:00.000Z" };
    expect(readBack([{ splitId: "half-written" }, older, good]).map((e) => e.splitId)).toEqual([
      "old1",
      "abc123",
    ]);
  });
});
