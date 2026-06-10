# web/ — Japanese Verb Trainer study app

## What this is

The **verb-trainer study app**: a single self-contained file, [index.html](index.html)
(HTML + CSS + JS, ~1700 lines, no build step). Served at the apex of the backing
API server (`/` and `/study`). Derived from the offline-only original at
[../../japanese-study/japanese-verbs.html](../../japanese-study/japanese-verbs.html)
plus a cloud-sync layer. User-facing overview: [README.md](README.md). What to do
next: [NEXT_STEPS.md](NEXT_STEPS.md).

This is a **separate surface** from the WaniKani userscript flow — it just shares
the droplet. Backend (auth, progress storage, cookie model) is the server's:
[../CLAUDE.md](../CLAUDE.md) "Accounts + study app", [../deploy/README.md](../deploy/README.md).

**The single best source of truth is the top-of-file block comment** in
`index.html` (architecture map, data model, key design decisions, mnemonic policy,
OUTSTANDING WORK). Read it first. This file adds the *contributor* layer:
how-to-work-on-it, the design-system contracts, and the dead-end warnings.

## How to work on it

1. **No build, no deps.** Edit `index.html` directly. It's served by the API
   server — `cd .. && bun dev`, then reload **http://localhost:3000/**. (Pure
   offline: open the file via `file://`; everything but accounts works.)
2. **Verify visually.** This is a UI; screenshot the change. Drive it with the
   browser-preview tooling (`.claude/launch.json` has a `wk-enhanced-api` config).
   See the preview caveat in the dead-ends below.
3. **Commit conventions** (same as the rest of the repo): one logical change → one
   commit; commit at the end of a feature without being asked; fix stale nearby
   comments in the same commit.
4. **Stay single-file and offline-first.** Do **not** add a CDN icon font, a
   chart library, a framework, or a bundler. The whole value prop is "open it
   anywhere, zero setup, works offline." New icons go in the inline SVG sprite;
   new charts are hand-rolled SVG like `lineChart`/`barChart`.
5. **Accounts need `COOKIE_SECURE=false` in dev** — a `Secure` cookie is dropped
   over `http://localhost` and login silently fails. (#1 thing to check if local
   login won't stick. Defaults false.)

## Architecture (map to the in-file section banners)

Markup: `#panel-study` (flashcard setup → card stage → done), `#panel-browse`
(filter grid), `#panel-stats` (charts + leeches), plus the header/toolbar, tabs,
and the auth modal + sign-up banner.

JS sections (top to bottom): `DATA` (the `VERBS[]` dataset) → `STORAGE`
(localStorage + SRS scheduling + leech logic) → `TAB NAV` → `FONT/THEME` →
`EXPORT/IMPORT` → `DECK BUILDING` (the `passes()` predicate + `makeMultiSelect`) →
`FLASHCARD` (session lifecycle) → `BROWSE` → `STATS+CHARTS` → `CLOUD ACCOUNTS +
SYNC`. Key functions by area:

- **SRS/leech (pure, the core logic):** `cardStat`, `scheduleCard`, `isDue`,
  `dueCards`, `rollingAcc`, `isLeech`, `leeches`. Leitner boxes, not SM-2.
- **Filtering:** `passes(v,cfg)` is the predicate; `makeMultiSelect(selector,…)`
  wires a chip group (OR within a facet, "all" exclusive); `facetAll`.
  `cfg` (flashcard deck) and `bcfg` (browse grid) are independent configs.
- **Render:** `showCard`/`reveal`/`grade`/`endSession` (session), `renderBrowse`,
  `renderStats` + `renderCardBars`, `lineChart`/`barChart` (SVG strings).
- **Cloud:** `api`, `scheduleCloudSync`/`pushCloud`/`pullCloud`, `bootAuth`,
  `updateAccountChip`, `openAuth`. Same-origin, httpOnly cookie, debounced
  full-store PUT.
- **UX helpers (added in the polish pass):** `filterSummary`/`paintSummary`
  (active-filter recap), `setupTopicGroups` (topic disclosure + badge),
  `escapeHtml`.

Persisted store (`localStorage["jpverbs_v3"]`):
`{ cards:{<rank>:{attempts:[1|0…],right,wrong,box:0..5,due:<epochMs>}}, sessions:[{t,right,tot}…] (cap 200), daily:{"YYYY-MM-DD":{right,tot}} }`.

## Design system

All theming flows through CSS custom properties (`--ink/--paper/--paper-2`,
`--godan/--ichidan/--irregular`, `--muted/--line`, `--leech`, `--good`,
`--jp-font`); light/dark is one `data-theme` flip on `<html>`. Colors are
**functional, not decorative** (godan=vermilion, ichidan=indigo, irregular=stone,
leech=purple). Mono labels (`SF Mono`), serif chrome (Georgia), swappable
`.jp` font for Japanese text.

Component contracts you must preserve:

- **`.frow` + `.chips`** is the filter-row layout: a fixed-width label column
  (`.filter-label` at 124px) plus a flex `.chips` track. This is what keeps every
  filter group's chips starting at the same x **and** wrapped chips aligned under
  the first chip. Stacks label-over-chips at ≤640px. Do not revert to a bare
  `.row` with the label as a sibling of the chips — that's what looked misaligned.
- **`.chip` is wired by class + `data-*`** (`makeMultiSelect('.chip.deck',…)`,
  `.bf`, `.jlpt`, `.bjlpt`, `.mode`, `.ord`, `.rpreset`). The JS uses flat
  `querySelectorAll` and ignores DOM nesting — so you can regroup/wrap/collapse
  chip markup freely **as long as each chip keeps its classes + `data-*`**.
- **`.jlptseg`** is the segmented JLPT control (adjacent chips share borders);
  still multi-select.
- **`.topic-region` / `.topic-toggle`** is the collapsible topic disclosure
  (max-height transition; a `· N` badge counts active chips inside).
- **Icons:** `<svg class="ic"><use href="#i-NAME"/></svg>` referencing the inline
  `<symbol>` sprite at the top of `<body>`. `.ic` inherits `currentColor` + `1em`.

## Things that look like bugs but aren't (DEAD-END WARNINGS)

- **Type / Transitivity / Topic chips share ONE OR'd pool** (all `.deck` in the
  flashcard panel, all `.bf` in browse). So "Godan + Motion" = `godan OR motion`,
  not the intersection. The visual tier split (added in the regroup) is *purely
  cosmetic* — it did not change this semantics. Making them separate AND'd facets
  is real work (`passes()` + a second selection set); see in-file OUTSTANDING #2.
- **The single "All" chip clears the whole shared pool** (type+transitivity+topic),
  not just its own row. There is exactly one per panel; keep it that way.
- **Alignment needs the `.chips` wrapper, not just a fixed label width.** A fixed
  `.filter-label` width alone still lets wrapped chips break to x=0 behind the
  label. The two-track `.frow>.filter-label` + `.frow>.chips` structure is the fix.
- **The topic-disclosure badge is kept current by a MutationObserver** on the
  region's class attributes — not just click handlers — so programmatic selection
  changes (Reset / Study-leeches / due-session) update the `· N` count too.
- **Per-card accuracy bars are deliberately capped** to the worst 20 with a
  show-all toggle (`renderCardBars`, `CARDBARS_CAP`). They're sorted worst-first;
  an uncapped full deck is a ~2600px wall of mostly-mastered bars. Don't "restore"
  the full list as the default.
- **`updateAccountChip` / `updateDueBanner` set `innerHTML`** to embed icons, so
  they no longer use `textContent`. The account email is **`escapeHtml`'d** before
  interpolation — keep that (it's user-controlled → XSS otherwise).
- **The icon sprite is inline + offline-first.** Don't replace it with Tabler/
  Lucide-via-CDN — icons would break offline, defeating the single-file premise.
  Add new glyphs as `<symbol>`s. (`-filled` style names don't exist here; these
  are hand-drawn stroke paths on a 24-grid.)
- **Google Fonts is the only external dependency and degrades gracefully.** Offline
  you get system fonts for the Japanese text; the app still fully works. Don't add
  a hard dependency on it.
- **Browser-preview tooling reloads/recreates the tab on capture**, which resets
  in-memory state (active tab defaults back to Flashcards; `cfg`/`bcfg` filter
  selections are lost — only localStorage persists). To verify a *transient* state
  (a specific tab, applied filters, expanded topics, seeded stats), set it up and
  assert via DOM `eval` rather than relying on a follow-up screenshot. Seed stats
  data by mutating `store` + calling `renderStats()` in an eval.

## Change log — UX/design pass (this is the conversation record)

Commits, newest first (all on `main`, all touching only `index.html` unless noted):

1. **`0712d65` align filter rows + site-wide icons + polish.** Filter rows →
   `.frow`/`.chips` fixed-label-column layout (fixes the misaligned chip
   start-x). Inline SVG icon sprite applied to tabs, toolbar, action buttons,
   topic chevron, Leeches chip, leech list, search field, account chip.
   Replaced the blocking first-visit "Create account" modal with a dismissible
   inline banner (`#signupBanner`, remembered in localStorage). Added the
   active-filter recap line (`filterSummary`/`paintSummary` → `#deckSummary`,
   `#bSummary`). Carded the leech list (`.leech-row`).
2. **`5021b84` cap per-card accuracy bars.** Worst-20 default + show-all toggle
   (`renderCardBars`).
3. **`23e627d` regroup verb filters into legible tiers.** Split the 29-chip
   "Category" wall into Type / Transitivity / Topic(collapsible) / Level & rank;
   moved Leeches out of the category pool; segmented JLPT control.

Earlier history (the integration itself) is in `7fea5e3`/`f2bb4d8` and the server
docs. Each change preserved the chip wiring; verification was live (preview +
DOM eval), not a test suite — see NEXT_STEPS for the testing debt.
