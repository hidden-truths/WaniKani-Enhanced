// Pure-core tests for the verb-trainer study app (web/index.html).
//
// The app is a single self-contained HTML file by design (no build, no deps), so
// there's nothing to `import`. To unit-test the pure logic that future refactors
// break silently — passes()/scheduleCard()/isDue()/rollingAcc()/isLeech()/
// normKana()/filterSummary()/the facet helpers — we extract the inline <script>
// and evaluate it inside a tiny DOM stub, then return the functions we care about.
//
// This keeps the app dependency-free (the stub lives only in the test) while still
// giving the core real coverage. If index.html stops booting under the stub, this
// file fails loudly — which is itself a useful signal.
import { test, expect, beforeEach } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

type Core = {
  passes: (v: any, c: any) => boolean;
  oneGroup: (v: any, d: string) => boolean;
  facetAll: (a: any) => boolean;
  facetMatch: (v: any, a: any) => boolean;
  scheduleCard: (c: any, correct: boolean) => void;
  cardStat: (rank: number) => any;
  isDue: (rank: number) => boolean;
  dueCards: () => any[];
  rollingAcc: (rank: number, n?: number) => number | null;
  isLeech: (rank: number) => boolean;
  leeches: () => any[];
  normKana: (s: string) => string;
  filterSummary: (c: any) => string[];
  tokenFacet: (t: string) => string;
  BOX_DAYS: number[];
  DATA: any[];
  store: any;
};

function loadCore(): Core {
  const html = readFileSync(join(import.meta.dir, "index.html"), "utf8");
  // NB: the top-of-file HTML comment also contains the literal text "<script>"
  // (the architecture map), so take the content after the LAST <script> tag, then
  // up to its </script>, rather than a lazy regex that would match the comment.
  const after = html.split("<script>").pop()!;
  const src = after.split("</script>")[0];
  if (!src || !src.includes("function passes")) throw new Error("could not extract the app script");
  const body =
    src +
    `\n;return { passes, oneGroup, facetAll, facetMatch, scheduleCard, cardStat,
      isDue, dueCards, rollingAcc, isLeech, leeches, normKana, filterSummary, tokenFacet,
      BOX_DAYS, get DATA(){return DATA}, get store(){return store}, set store(v){store=v} };`;

  // --- minimal DOM / browser stubs (only what index.html touches at boot) ---
  const METHODS = new Set([
    "addEventListener", "removeEventListener", "appendChild", "removeChild",
    "insertBefore", "setAttribute", "removeAttribute", "focus", "blur", "click",
    "dispatchEvent", "scrollIntoView", "remove", "append", "prepend",
  ]);
  const el = () =>
    new Proxy(
      { classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
        dataset: {} } as any,
      {
        get(t, p) {
          if (p in t) return (t as any)[p];
          if (METHODS.has(p as string)) return () => {};
          if (p === "querySelector" || p === "closest") return () => null;
          if (p === "querySelectorAll") return () => [];
          if (p === "getAttribute") return () => null;
          if (p === "hasAttribute" || p === "contains") return () => false;
          if (p === "getBoundingClientRect")
            return () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });
          return ""; // value/innerHTML/textContent/className/title/… read as empty string
        },
        set() { return true; },
      }
    );
  const documentStub: any = {
    getElementById: () => el(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener() {},
    removeEventListener() {},
    documentElement: el(),
    body: el(),
  };
  const ls: Record<string, string> = {};
  const localStorageStub = {
    getItem: (k: string) => (k in ls ? ls[k] : null),
    setItem: (k: string, v: any) => { ls[k] = String(v); },
    removeItem: (k: string) => { delete ls[k]; },
    clear() { for (const k in ls) delete ls[k]; },
  };
  const windowStub: any = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    location: { reload() {} },
  };
  const fetchStub = () => Promise.reject(new Error("no network in tests"));

  // Non-strict Function body so the inner `function` declarations hoist and the
  // appended `return {…}` can hand them back. Browser globals are passed as params
  // (shadowing the absent globalThis equivalents); JSON/Math/Date/etc. resolve to Bun.
  const fn = new Function(
    "window", "document", "localStorage", "fetch", "navigator", "alert", "confirm",
    body
  );
  return fn(windowStub, documentStub, localStorageStub, fetchStub, {}, () => {}, () => true);
}

let core: Core;
beforeEach(() => {
  core = loadCore();
  // Fresh, empty progress per test (the boot value is fine, but be explicit).
  core.store = { cards: {}, sessions: [], daily: {} };
});

// helper: count deck size for a partial config (fills facet defaults)
const cfg = (o: Partial<any>) =>
  ({ type: [], trans: [], topic: [], status: [], jlpt: ["all"], rmin: 1, rmax: 999, ...o });
const count = (c: any) => core.DATA.filter((v) => core.passes(v, c)).length;

test("the dataset loads under the DOM stub", () => {
  expect(core.DATA.length).toBeGreaterThanOrEqual(100);
  expect(core.DATA.every((v) => v.jp && v.read && v.type)).toBe(true);
});

test("normKana folds katakana→hiragana, strips spaces, unifies long marks", () => {
  expect(core.normKana("ハシル")).toBe("はしる");      // katakana → hiragana
  expect(core.normKana("  は し る ")).toBe("はしる");  // whitespace stripped
  expect(core.normKana("タベル")).toBe("たべる");
  expect(core.normKana("はしる")).toBe("はしる");        // already-hiragana unchanged
  expect(core.normKana("ラーメン")).toBe("らーめん");    // chōonpu preserved as ー
});

test("facetAll: empty or ['all'] is no-constraint; specific tokens constrain", () => {
  expect(core.facetAll([])).toBe(true);
  expect(core.facetAll(["all"])).toBe(true);
  expect(core.facetAll(undefined)).toBe(true);
  expect(core.facetAll(["godan"])).toBe(false);
});

test("tokenFacet routes tokens to the right facet", () => {
  expect(core.tokenFacet("godan")).toBe("type");
  expect(core.tokenFacet("ichidan")).toBe("type");
  expect(core.tokenFacet("trans")).toBe("trans");
  expect(core.tokenFacet("ti-pair")).toBe("trans");
  expect(core.tokenFacet("leech")).toBe("status");
  expect(core.tokenFacet("due")).toBe("status");
  expect(core.tokenFacet("motion")).toBe("topic"); // default
  expect(core.tokenFacet("emotion")).toBe("topic");
});

test("passes: facets AND across, OR within (the headline behavior)", () => {
  const godan = core.DATA.filter((v) => v.type === "godan").length;
  const motion = core.DATA.filter((v) => v.tags.includes("motion")).length;
  const godanAndMotion = core.DATA.filter((v) => v.type === "godan" && v.tags.includes("motion")).length;

  // type AND topic = intersection (not the old union)
  expect(count(cfg({ type: ["godan"], topic: ["motion"] }))).toBe(godanAndMotion);
  expect(godanAndMotion).toBeLessThan(godan); // sanity: intersection is smaller
  expect(godanAndMotion).toBeLessThan(motion);

  // OR within one facet
  const godanOrIchidan = core.DATA.filter((v) => v.type === "godan" || v.type === "ichidan").length;
  expect(count(cfg({ type: ["godan", "ichidan"] }))).toBe(godanOrIchidan);

  // no constraints = whole deck
  expect(count(cfg({}))).toBe(core.DATA.length);
});

test("passes: jlpt facet and rank range AND on top", () => {
  const n5 = core.DATA.filter((v) => v.jlpt === "N5").length;
  expect(count(cfg({ jlpt: ["N5"] }))).toBe(n5);
  // rank band
  expect(count(cfg({ rmin: 1, rmax: 25 }))).toBe(core.DATA.filter((v) => v.rank >= 1 && v.rank <= 25).length);
});

test("oneGroup: transitivity, class, and tag tokens", () => {
  const t = core.DATA.find((v) => v.trans === "t")!;
  const i = core.DATA.find((v) => v.trans === "i")!;
  expect(core.oneGroup(t, "trans")).toBe(true);
  expect(core.oneGroup(t, "intrans")).toBe(false);
  expect(core.oneGroup(i, "intrans")).toBe(true);
  const g = core.DATA.find((v) => v.type === "godan")!;
  expect(core.oneGroup(g, "godan")).toBe(true);
  expect(core.oneGroup(g, "ichidan")).toBe(false);
});

test("scheduleCard: Leitner promote on correct (cap 5), reset to box 1 on miss", () => {
  const c: any = { box: 0, due: 0, attempts: [], right: 0, wrong: 0 };
  core.scheduleCard(c, true);
  expect(c.box).toBe(1);
  expect(c.due).toBeGreaterThan(Date.now()); // 1-day interval in the future
  core.scheduleCard(c, true);
  expect(c.box).toBe(2);
  for (let k = 0; k < 10; k++) core.scheduleCard(c, true);
  expect(c.box).toBe(5); // capped
  core.scheduleCard(c, false);
  expect(c.box).toBe(1); // lapse → box 1, not box 0
});

test("isDue: new/box-0/overdue are due; future box is not", () => {
  const DAY = 86400000;
  core.store = {
    cards: {
      1: { attempts: [1], right: 1, wrong: 0, box: 3, due: Date.now() + 5 * DAY }, // future → not due
      2: { attempts: [1], right: 1, wrong: 0, box: 2, due: Date.now() - DAY },      // overdue → due
      3: { attempts: [], right: 0, wrong: 0, box: 0, due: 0 },                       // new → due
    },
    sessions: [], daily: {},
  };
  expect(core.isDue(1)).toBe(false);
  expect(core.isDue(2)).toBe(true);
  expect(core.isDue(3)).toBe(true);
  expect(core.isDue(99999)).toBe(true); // never seen → due
});

test("rollingAcc: mean of last n attempts; null when never drilled", () => {
  core.store = { cards: { 1: { attempts: [1, 1, 0, 1], right: 3, wrong: 1, box: 2, due: 0 } }, sessions: [], daily: {} };
  expect(core.rollingAcc(1)).toBeCloseTo(0.75, 5);
  expect(core.rollingAcc(2)).toBeNull(); // no card
  // only the last n (default 8) count
  core.store.cards[3] = { attempts: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1], right: 2, wrong: 8, box: 1, due: 0 };
  expect(core.rollingAcc(3)).toBeCloseTo(0.25, 5); // last 8 = six 0s + two 1s
});

test("isLeech: <60% over the last ≥4 attempts", () => {
  core.store = {
    cards: {
      1: { attempts: [0, 0, 1, 0], right: 1, wrong: 3, box: 1, due: 0 }, // 25% over 4 → leech
      2: { attempts: [1, 0, 1], right: 2, wrong: 1, box: 1, due: 0 },     // only 3 attempts → not yet
      3: { attempts: [1, 1, 0, 1], right: 3, wrong: 1, box: 2, due: 0 },  // 75% → not a leech
    },
    sessions: [], daily: {},
  };
  expect(core.isLeech(1)).toBe(true);
  expect(core.isLeech(2)).toBe(false);
  expect(core.isLeech(3)).toBe(false);
  expect(core.isLeech(99999)).toBe(false); // no card
});

test("filterSummary: one part per non-empty facet (the AND'd recap)", () => {
  const parts = core.filterSummary(cfg({ type: ["godan"], topic: ["motion"], rmin: 1, rmax: 25 }));
  expect(parts).toContain("Godan");
  expect(parts).toContain("Motion");
  expect(parts.some((p) => p.includes("rank 1"))).toBe(true);
  expect(core.filterSummary(cfg({}))).toEqual([]); // nothing active
});

test("dueCards / leeches derive from store over the live DATA", () => {
  expect(core.dueCards().length).toBe(core.DATA.length); // empty store → everything new → all due
  expect(core.leeches().length).toBe(0);
});
