import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRecentSplits, recordRecentSplit, type RecentSplit } from "@/lib/api";

/**
 * The recent-splits registry is the only "my splits" that exists — there are
 * no accounts — so it has to survive whatever is already in localStorage,
 * including nothing at all (SSR) and garbage written by an older build.
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

function entry(splitId: string, over: Partial<RecentSplit> = {}): RecentSplit {
  return {
    splitId,
    name: `Room ${splitId}`,
    role: "guest",
    at: "2026-07-27T12:00:00.000Z",
    ...over,
  };
}

let store: Map<string, string>;

beforeEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  store = stubStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("getRecentSplits", () => {
  it("returns [] when nothing has been recorded", () => {
    expect(getRecentSplits()).toEqual([]);
  });

  it("returns [] on corrupted JSON", () => {
    store.set(KEY, "{not json at all");
    expect(getRecentSplits()).toEqual([]);
  });

  it("returns [] when the stored value isn't an array", () => {
    store.set(KEY, JSON.stringify({ splitId: "abc" }));
    expect(getRecentSplits()).toEqual([]);
  });

  it("drops junk entries rather than throwing on them", () => {
    store.set(KEY, JSON.stringify([null, entry("good"), 42, { name: "no id" }, "nope"]));
    expect(getRecentSplits()).toEqual([entry("good")]);
  });

  it("reads back exactly what was written", () => {
    const e = entry("abc123", { role: "host", name: "Taqueria" });
    recordRecentSplit(e);
    expect(getRecentSplits()).toEqual([e]);
  });
});

describe("recordRecentSplit", () => {
  it("prepends, newest first", () => {
    recordRecentSplit(entry("one"));
    recordRecentSplit(entry("two"));
    recordRecentSplit(entry("three"));
    expect(getRecentSplits().map((e) => e.splitId)).toEqual(["three", "two", "one"]);
  });

  it("de-duplicates on splitId, moving the room to the front", () => {
    recordRecentSplit(entry("a"));
    recordRecentSplit(entry("b"));
    recordRecentSplit(entry("c"));
    recordRecentSplit(entry("a", { at: "2026-07-27T18:00:00.000Z" }));

    const recents = getRecentSplits();
    expect(recents.map((e) => e.splitId)).toEqual(["a", "c", "b"]);
    expect(recents).toHaveLength(3);
    // The newer record wins outright, it isn't merged with the old one.
    expect(recents[0].at).toBe("2026-07-27T18:00:00.000Z");
  });

  it("keeps an updated role/name on re-record", () => {
    recordRecentSplit(entry("a", { role: "guest", name: "Untitled" }));
    recordRecentSplit(entry("a", { role: "host", name: "Taqueria" }));
    expect(getRecentSplits()).toEqual([entry("a", { role: "host", name: "Taqueria" })]);
  });

  it("caps the list at 20, dropping the oldest", () => {
    for (let i = 0; i < 25; i++) recordRecentSplit(entry(`s${i}`));

    const recents = getRecentSplits();
    expect(recents).toHaveLength(20);
    expect(recents[0].splitId).toBe("s24");
    expect(recents[19].splitId).toBe("s5");
    expect(recents.some((e) => e.splitId === "s4")).toBe(false);
  });

  it("caps at 20 even when a de-dup happens at the boundary", () => {
    for (let i = 0; i < 20; i++) recordRecentSplit(entry(`s${i}`));
    recordRecentSplit(entry("s0")); // oldest surfaces again — still 20 rooms
    expect(getRecentSplits()).toHaveLength(20);
    expect(getRecentSplits()[0].splitId).toBe("s0");
  });

  it("recovers from corrupted storage by starting a fresh list", () => {
    store.set(KEY, "<<<garbage>>>");
    recordRecentSplit(entry("fresh"));
    expect(getRecentSplits().map((e) => e.splitId)).toEqual(["fresh"]);
  });

  it("survives a localStorage that throws on write", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => recordRecentSplit(entry("a"))).not.toThrow();
  });
});

describe("SSR safety", () => {
  it("no-ops without a window, never touching localStorage", () => {
    Reflect.deleteProperty(globalThis, "window");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("localStorage touched during SSR");
        },
        setItem: () => {
          throw new Error("localStorage touched during SSR");
        },
      },
    });
    expect(getRecentSplits()).toEqual([]);
    expect(() => recordRecentSplit(entry("a"))).not.toThrow();
  });
});
