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
  romajiToKana: (s: string) => string;
  reviewForecast: (h: string) => { bars: { label: string; count: number; now: boolean }[]; max: number };
  filterSummary: (c: any) => string[];
  tokenFacet: (t: string) => string;
  deckLabel: (t: string) => string;
  cardStamp: (v: any) => { label: string; cls: string };
  colorClass: (v: any) => string;
  CATS: string[];
  exampleForLevel: (v: any, level: string) => [string, string] | null;
  availableTiers: (v: any) => string[];
  JLPT_TIERS: string[];
  BOX_DAYS: number[];
  DATA: any[];
  store: any;
};

function loadCore(): Core {
  // The app is split into verbs.js (the `VERBS` dataset) + app.js (the logic),
  // both loaded as classic scripts in index.html (so they share one global scope).
  // Concatenate them in load order and evaluate the result under a DOM stub.
  const verbs = readFileSync(join(import.meta.dir, "verbs.js"), "utf8");
  const examples = readFileSync(join(import.meta.dir, "examples.js"), "utf8");
  const appSrc = readFileSync(join(import.meta.dir, "app.js"), "utf8");
  if (!appSrc.includes("function passes")) throw new Error("app.js missing — did the split move it?");
  const body =
    verbs + "\n" + examples + "\n" + appSrc +
    `\n;return { passes, oneGroup, facetAll, facetMatch, scheduleCard, cardStat,
      isDue, dueCards, rollingAcc, isLeech, leeches, normKana, romajiToKana, reviewForecast, filterSummary, tokenFacet, deckLabel,
      cardStamp, colorClass, CATS,
      exampleForLevel, availableTiers, JLPT_TIERS,
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
  const locationStub = { protocol: "http:", reload() {} };
  const windowStub: any = {
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {},
    location: locationStub,
  };
  const fetchStub = () => Promise.reject(new Error("no network in tests"));

  // Non-strict Function body so the inner `function` declarations hoist and the
  // appended `return {…}` can hand them back. Browser globals are passed as params
  // (shadowing the absent globalThis equivalents); JSON/Math/Date/etc. resolve to Bun.
  const fn = new Function(
    "window", "document", "localStorage", "fetch", "navigator", "alert", "confirm", "location",
    body
  );
  return fn(windowStub, documentStub, localStorageStub, fetchStub, {}, () => {}, () => true, locationStub);
}

let core: Core;
beforeEach(() => {
  core = loadCore();
  // Fresh, empty progress per test (the boot value is fine, but be explicit).
  core.store = { cards: {}, sessions: [], daily: {} };
});

// helper: count deck size for a partial config (fills facet defaults)
const cfg = (o: Partial<any>) =>
  ({ cat: [], type: [], trans: [], topic: [], status: [], jlpt: ["all"], rmin: 1, rmax: 999, ...o });
const count = (c: any) => core.DATA.filter((v) => core.passes(v, c)).length;

test("the dataset loads under the DOM stub", () => {
  expect(core.DATA.length).toBeGreaterThanOrEqual(100);
  expect(core.DATA.every((v) => v.jp && v.read && v.type)).toBe(true);
  // attachLevels() defaults a part-of-speech category onto every card (transition
  // groundwork away from verbs-only — all current entries are "verb").
  expect(core.DATA.every((v) => v.cat === "verb")).toBe(true);
});

test("every built-in verb has all 5 leveled examples (well-formed)", () => {
  const builtin = core.DATA.filter((v) => !v.custom);
  expect(builtin.length).toBe(100);
  for (const v of builtin) {
    expect(v.levels).toBeTruthy();
    for (const t of core.JLPT_TIERS) {
      const e = v.levels[t];
      expect(Array.isArray(e) && e.length === 2).toBe(true);
      expect(typeof e[0] === "string" && e[0].trim().length).toBeTruthy(); // jp
      expect(typeof e[1] === "string" && e[1].trim().length).toBeTruthy(); // en
      // ruby tags balanced
      const ro = (e[0].match(/<ruby>/g) || []).length;
      const rc = (e[0].match(/<\/ruby>/g) || []).length;
      expect(ro).toBe(rc);
    }
  }
});

test("exampleForLevel: exact tier, then nearest-tier fallback, then ex, then null", () => {
  const v = { rank: 1, jlpt: "N5", levels: { N5: ["go5", "e5"], N3: ["go3", "e3"] }, ex: [["EX", "exEN"]] };
  expect(core.exampleForLevel(v, "N5")).toEqual(["go5", "e5"]);      // exact
  expect(core.exampleForLevel(v, "N3")).toEqual(["go3", "e3"]);      // exact
  // N4 missing → nearest tier (N5 and N3 are equidistant; either is acceptable)
  expect(["go5", "go3"]).toContain(core.exampleForLevel(v, "N4")![0]);
  // N1 missing → nearest available walking down is N3
  expect(core.exampleForLevel(v, "N1")).toEqual(["go3", "e3"]);
  // no levels at all → fall back to ex
  const c = { rank: 200, levels: null, ex: [["CUSTOM", "customEN"]] };
  expect(core.exampleForLevel(c, "N5")).toEqual(["CUSTOM", "customEN"]);
  // nothing at all → null
  expect(core.exampleForLevel({ rank: 201, levels: null, ex: [] }, "N5")).toBeNull();
});

test("availableTiers lists only the tiers that have a sentence", () => {
  expect(core.availableTiers({ levels: { N5: ["a", "b"], N2: ["c", "d"] } })).toEqual(["N5", "N2"]);
  expect(core.availableTiers({ levels: null })).toEqual([]);
  // a real built-in verb has all five, in easy→hard order
  expect(core.availableTiers(core.DATA.find((v) => v.rank === 1))).toEqual(["N5", "N4", "N3", "N2", "N1"]);
});

test("normKana folds katakana→hiragana, strips spaces, unifies long marks", () => {
  expect(core.normKana("ハシル")).toBe("はしる");      // katakana → hiragana
  expect(core.normKana("  は し る ")).toBe("はしる");  // whitespace stripped
  expect(core.normKana("タベル")).toBe("たべる");
  expect(core.normKana("はしる")).toBe("はしる");        // already-hiragana unchanged
  expect(core.normKana("ラーメン")).toBe("らーめん");    // chōonpu preserved as ー
});

test("romajiToKana: Hepburn + wāpuro variants → hiragana", () => {
  expect(core.romajiToKana("taberu")).toBe("たべる");
  expect(core.romajiToKana("miru")).toBe("みる");
  expect(core.romajiToKana("kau")).toBe("かう");
  expect(core.romajiToKana("matsu")).toBe("まつ");      // tsu trigraph
  expect(core.romajiToKana("shaberu")).toBe("しゃべる"); // sha digraph
  expect(core.romajiToKana("hanasu")).toBe("はなす");
  expect(core.romajiToKana("oyogu")).toBe("およぐ");
  // wāpuro variants resolve to the same kana as Hepburn
  expect(core.romajiToKana("hanasi")).toBe(core.romajiToKana("hanashi"));
  expect(core.romajiToKana("tatu")).toBe("たつ");        // tu → つ
  expect(core.romajiToKana("huku")).toBe("ふく");        // hu → ふ
});

test("romajiToKana: sokuon, ん, and kana pass-through", () => {
  expect(core.romajiToKana("kitte")).toBe("きって");     // doubled consonant → っ
  expect(core.romajiToKana("matcha")).toBe("まっちゃ");  // tch → っ + ちゃ
  expect(core.romajiToKana("hon")).toBe("ほん");          // trailing n → ん
  expect(core.romajiToKana("onna")).toBe("おんな");       // nn → ん then な
  expect(core.romajiToKana("shin'you")).toBe("しんよう"); // n' boundary
  expect(core.romajiToKana("たべる")).toBe("たべる");     // already-kana untouched
});

test("reviewForecast: buckets scheduled cards; overdue folds into slot 0", () => {
  const r0 = core.DATA[0].rank, r1 = core.DATA[1].rank, r2 = core.DATA[2].rank;
  const now = Date.now();
  core.store = {
    cards: {
      [r0]: { attempts: [1], right: 1, wrong: 0, box: 2, due: now - core.BOX_DAYS[1] }, // overdue
      [r1]: { attempts: [1], right: 1, wrong: 0, box: 1, due: now + 1 * 86400000 + 1000 }, // +1 day
      [r2]: { attempts: [], right: 0, wrong: 0, box: 0, due: 0 }, // new/unseen → not scheduled
    },
    sessions: [], daily: {},
  };
  const wk = core.reviewForecast("week");
  expect(wk.bars.length).toBe(7);
  expect(wk.bars[0].count).toBe(1);  // overdue → today
  expect(wk.bars[0].now).toBe(true);
  expect(wk.bars[1].count).toBe(1);  // +1 day
  expect(wk.bars.reduce((s, b) => s + b.count, 0)).toBe(2); // box-0 card excluded
  expect(core.reviewForecast("24h").bars.length).toBe(24);
  expect(core.reviewForecast("year").bars.length).toBe(12);
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
  // part-of-speech tokens route to the cat facet
  expect(core.tokenFacet("verb")).toBe("cat");
  expect(core.tokenFacet("adjective")).toBe("cat");
  expect(core.tokenFacet("noun")).toBe("cat");
});

test("passes: category facet ANDs in (built-ins are all verbs)", () => {
  // every built-in card is a verb → cat:['verb'] keeps the whole deck, the rest empty it
  expect(count(cfg({ cat: ["verb"] }))).toBe(core.DATA.length);
  expect(count(cfg({ cat: ["noun"] }))).toBe(0);
  expect(count(cfg({ cat: ["adjective", "adverb"] }))).toBe(0);
  // cat AND type still intersect
  const godan = core.DATA.filter((v) => v.type === "godan").length;
  expect(count(cfg({ cat: ["verb"], type: ["godan"] }))).toBe(godan);
  expect(count(cfg({ cat: ["noun"], type: ["godan"] }))).toBe(0);
});

test("oneGroup + cardStamp/colorClass cover non-verb categories", () => {
  expect(core.CATS).toContain("phrase");
  const noun = { cat: "noun", type: "" };
  const adj = { cat: "adjective", type: "na-adj" };
  const verb = core.DATA.find((v) => v.type === "godan")!;
  // category membership (a missing cat defaults to verb)
  expect(core.oneGroup(noun, "noun")).toBe(true);
  expect(core.oneGroup(noun, "verb")).toBe(false);
  expect(core.oneGroup(verb, "verb")).toBe(true);
  // stamp: subtype label when present, else the bare category
  expect(core.cardStamp(verb)).toEqual({ label: "GODAN", cls: "godan" });
  expect(core.cardStamp(adj)).toEqual({ label: "な-ADJ", cls: "na-adj" });
  expect(core.cardStamp(noun)).toEqual({ label: "NOUN", cls: "noun" });
  // color class: subtype, then category
  expect(core.colorClass(verb)).toBe("godan");
  expect(core.colorClass(adj)).toBe("na-adj");
  expect(core.colorClass(noun)).toBe("noun");
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

// --- Source facet (Minna no Nihongo provenance: みんなの日本語 / iTalki / per-lesson) ---
test("tokenFacet routes Minna source tokens to the source facet", () => {
  expect(core.tokenFacet("minna")).toBe("source");
  expect(core.tokenFacet("italki")).toBe("source");
  expect(core.tokenFacet("mnn-l23")).toBe("source"); // per-lesson, via the regex
  expect(core.tokenFacet("mnn-l7")).toBe("source");
  expect(core.tokenFacet("money")).toBe("topic"); // an unrelated tag still defaults to topic
});

test("oneGroup: source tokens match the minna/italki flags + per-lesson tag", () => {
  const both = { minna: true, italki: true, tags: ["みんなの日本語", "mnn-l23", "iTalki"] };
  const minnaOnly = { minna: true, italki: false, tags: ["みんなの日本語", "mnn-l24"] };
  const plain = { tags: [] };
  expect(core.oneGroup(both, "minna")).toBe(true);
  expect(core.oneGroup(both, "italki")).toBe(true);
  expect(core.oneGroup(both, "mnn-l23")).toBe(true);
  expect(core.oneGroup(minnaOnly, "minna")).toBe(true);
  expect(core.oneGroup(minnaOnly, "italki")).toBe(false); // not covered in an iTalki lesson
  expect(core.oneGroup(minnaOnly, "mnn-l23")).toBe(false); // a different lesson
  expect(core.oneGroup(minnaOnly, "mnn-l24")).toBe(true);
  expect(core.oneGroup(plain, "minna")).toBe(false);
  expect(core.oneGroup(plain, "italki")).toBe(false);
});

test("passes: source is an AND'd facet (iTalki ∩ noun intersect)", () => {
  const deck = [
    { jlpt: "N4", rank: 101, cat: "verb", type: "godan", trans: "t", minna: true, italki: true,  tags: ["みんなの日本語", "mnn-l23", "iTalki"] },
    { jlpt: "N4", rank: 102, cat: "noun", type: "",      trans: "",  minna: true, italki: true,  tags: ["みんなの日本語", "mnn-l23", "iTalki"] },
    { jlpt: "N4", rank: 103, cat: "noun", type: "",      trans: "",  minna: true, italki: false, tags: ["みんなの日本語", "mnn-l24"] },
    { jlpt: "N5", rank: 5,   cat: "verb", type: "godan", trans: "t", tags: ["motion"] }, // a normal, non-Minna card
  ];
  const hits = (o: any) => deck.filter((v) => core.passes(v, cfg(o))).length;
  expect(hits({ source: ["minna"] })).toBe(3); // all three Minna cards
  expect(hits({ source: ["italki"] })).toBe(2); // only the iTalki subset
  expect(hits({ source: ["italki"], cat: ["noun"] })).toBe(1); // AND across facets
  expect(hits({ source: ["mnn-l24"] })).toBe(1); // a single lesson
  expect(hits({ source: ["minna"], cat: ["noun"] })).toBe(2);
  expect(hits({})).toBe(4); // no source constraint = whole synthetic deck
});

test("deckLabel + filterSummary surface the source facet (per-lesson → 'L23')", () => {
  expect(core.deckLabel("italki")).toBe("iTalki");
  expect(core.deckLabel("minna")).toBe("みんなの日本語");
  expect(core.deckLabel("mnn-l23")).toBe("L23");
  expect(core.deckLabel("mnn-l7")).toBe("L7");
  const parts = core.filterSummary({ cat: ["noun"], source: ["italki", "mnn-l23"] });
  expect(parts).toContain("Noun");
  expect(parts).toContain("iTalki/L23");
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
