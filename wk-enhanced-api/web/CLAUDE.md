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
- **Filtering (AND'd facets):** `passes(v,c)` intersects four token facets
  (`type`/`trans`/`topic`/`status`) + JLPT + rank. `facetMatch` = OR-within-one,
  `facetAll` = no-constraint test, `oneGroup` = does a verb match one token.
  `wireFacets(selector,c,onChange)` wires the `.deck`/`.bf` chips, deriving each
  chip's facet from its token via `TOKEN_FACET` (topic is the default); the lone
  "all" chip clears every facet. `makeMultiSelect` still wires the JLPT segs.
  `cfg` (flashcard deck) and `bcfg` (browse grid) are independent configs.
  `annotateJlptChips` disables empty JLPT levels.
- **Data + custom verbs:** `DATA` is a `let` = baked `VERBS` + `loadCustom().verbs`,
  rebuilt by `rebuildData()`; `MAXRANK` tracks the top rank (rank filter extends
  past 100). `openVerbModal`/`saveVerb`/`deleteVerb` are the #verbModal CRUD;
  custom verbs persist in `jpverbs_custom` (`loadCustom`/`saveCustom`), local-only.
- **Render:** `showCard`/`reveal`/`grade`/`endSession` (session), `renderBrowse`,
  `renderStats` + `renderCardBars`, `lineChart` (axis caption + avg line + value
  labels + `<title>` hover) / `barChart` (SVG strings).
- **Typed mode + TTS:** `revealAnswer` (shared show-answer + autoplay) feeds both
  `reveal` (self-graded) and `submitTyped` (typed: `normKana`-compares the kana, sets
  an advisory verdict + `session.suggested`). `speak`/`playReading`/`pickVoice` +
  the `TTS_OK` flag drive the Web Speech API. `bindSingle` wires the Input/Audio
  single-select chips. Prefs persist as `jpverbs_input` / `jpverbs_audio`.
- **Cloud:** `api`, `scheduleCloudSync`/`pushCloud`/`pullCloud`, `bootAuth`,
  `updateAccountChip`, `openAuth`. Same-origin, httpOnly cookie, debounced
  full-store PUT. `maybeShowSignup` (called from `endSession`) shows the sign-up
  nudge after the first session, not on first paint.
- **UX helpers (added in the polish pass):** `filterSummary`/`paintSummary`
  (active-filter recap), `setupTopicGroups` (topic disclosure + badge),
  `escapeHtml`.
- **A11y:** `setupRoving(container)` gives a chip group a roving tabindex (one tab
  stop, ←/→/↑/↓ + Home/End to move, `role=group` + aria-label). Wired over every
  `.chips` + `.topic-inner`; collapsed topic chips leave the tab order.

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
  `.chips` is ALSO the roving-tabindex group boundary (`setupRoving`) and the
  source of each group's aria-label (read from the row's `.filter-label`), so keep
  one logical facet per `.chips` track.
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

- **Type / Transitivity / Topic / Leech chips are FOUR AND'd facets, not one OR'd
  pool** (this changed — older docs/commits describing a shared pool are stale). A
  chip's facet is derived from its token via `TOKEN_FACET` (`tokenFacet`), not from
  markup, so the chips still carry class `.deck`/`.bf` + `data-deck`/`data-filter`.
  "Godan + Motion" = `godan AND motion` (intersection); tokens within one facet OR.
  `cfg`/`bcfg` hold `type`/`trans`/`topic`/`status` arrays (empty = no constraint).
  Don't reintroduce a single shared array — that was the old confusing behavior.
- **The single "All" chip is a master reset** that clears all four facets at once
  (not just its own row), and shows active when every facet is empty. Exactly one
  per panel — keep it that way. `wireFacets` returns a `paint()` fn that deep-links
  (`startDueSession` → status:['due'], `studyLeeches` → status:['leech']) call to
  resync the chips after mutating the config directly.
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
- **Custom verbs are keyed by a monotonic rank, never reused.** New custom verbs
  get `rank = ++seq` (seq starts at 100, persisted in `jpverbs_custom`), so deleting
  one never frees its rank for reuse — `store.cards[rank]` progress can't collide
  with a future verb. Editing keeps the rank (and progress); deleting drops the
  orphaned card stat. `DATA` is a `let` (not `const`) so `rebuildData()` can swap it
  in place — don't change it back to `const`, and don't cache `DATA`/`MAXRANK` in a
  closure that won't see the rebuild. Custom verbs are LOCAL-only (the cloud sync
  mirrors the progress `store` blob, not the verb dataset) — by design.
- **Empty JLPT levels are disabled, not hidden** (`annotateJlptChips`, run at boot
  and on any DATA change). The 100 frequent verbs are almost all N5–N4, so N2/N1
  start disabled; adding a custom N2 verb re-enables N2. Roving nav recomputes its
  navigable list each keypress so it skips disabled chips — keep that if you touch
  `setupRoving`.
- **Roving tabindex groups by `.chips`/`.topic-inner` container and matches only
  `button.chip`.** `setupRoving` deliberately excludes the Font `<select class="chip">`
  and the rank number inputs (focus on a non-chip returns -1 from `indexOf` →
  arrows fall through to native behavior), so they stay normal tab stops. It's
  TOOLBAR semantics (arrows move focus; Space/Enter selects via the existing click
  handler) — NOT an ARIA radiogroup, so don't expect `aria-checked`. Collapsed
  `.topic-inner` chips are forced to tabindex -1 via a MutationObserver on the
  region's `open` class; if you change how the topic disclosure toggles (e.g. to
  `display:none`), re-check that observer still fires.
- **Typed grading is advisory, and only grades the READING.** `submitTyped`
  `normKana`-compares the typed kana against `v.read` and *suggests* a grade
  (green/red verdict + a `.suggested` ring on the matching button), but the user
  still records it via 1/2 or a click — so a typo or an unjudged-meaning recall can
  be overridden. Don't make it auto-advance on match. `normKana` folds
  katakana→hiragana, strips spaces/separators, and unifies long-vowel marks; it is
  deliberately NOT romaji-aware (learners type kana directly or via an IME).
- **TTS is gated behind `TTS_OK` (`'speechSynthesis' in window`) and reveal.** The
  reading is the answer in both directions, so the speaker button lives inside the
  revealed `.answer` panel (and on Browse cards where the reading is already shown)
  — never on the flashcard prompt. When `TTS_OK` is false the whole Audio chip row
  + the flashcard speaker hide; `speak()` is a best-effort no-op. Voices can load
  async, so `pickVoice` re-runs on `voiceschanged`. This stays dependency-free
  (Web Speech API) — don't swap in a cloud TTS / audio-file dependency.
- **The kana field owns its own keys.** The global flashcard keydown handler bails
  when `#answerInput` is focused (so typing `1`/`2`/space goes into the field);
  Enter-to-submit is bound on the input itself, and Enter *after* reveal accepts
  `session.suggested`. Keep that focus guard if you touch the keyboard handler.
- **Browser-preview tooling reloads/recreates the tab on capture**, which resets
  in-memory state (active tab defaults back to Flashcards; `cfg`/`bcfg` filter
  selections are lost — only localStorage persists). To verify a *transient* state
  (a specific tab, applied filters, expanded topics, seeded stats), set it up and
  assert via DOM `eval` rather than relying on a follow-up screenshot. Seed stats
  data by mutating `store` + calling `renderStats()` in an eval.

## Change log — UX/design pass (this is the conversation record)

Commits, newest first (all on `main`, all touching only `index.html` unless noted):

1. **rate-limit auth (server — touches `src/`, not `index.html`).** Per-IP in-memory
   limiter on `/v1/auth/{login,register}`; see [../src/lib/rateLimit.ts](../src/lib/rateLimit.ts).
1. **pure-core test suite (`web/verbs-core.test.ts`).** Extracts the inline script,
   runs it under a DOM stub, tests passes/scheduleCard/isDue/rollingAcc/isLeech/
   normKana/filterSummary/facets. Guards the core through a future file split.
1. **add/edit/delete custom verbs.** "Add verb" modal in Browse; `jpverbs_custom`
   merged into `DATA` via `rebuildData()`; CUSTOM badge + Edit/Delete; MAXRANK
   extends the rank filter past 100; local-only.
1. **disable empty JLPT levels.** `annotateJlptChips` dims/disables zero-count
   levels (N2/N1) with count tooltips; roving nav skips disabled chips.
1. **defer sign-up nudge.** `maybeShowSignup` (from `endSession`) replaces the
   first-paint banner — shows after the first completed session.
1. **richer Stats line charts.** Axis caption, dashed average line, value labels,
   area fill, `<title>` hover readouts, theme-aware gridlines; session line indigo.
1. **AND'd filter facets.** Split the shared OR'd `.deck`/`.bf` pool into four AND'd
   facets (type/trans/topic/status) via `wireFacets` + `TOKEN_FACET`; `passes()`
   intersects. "Godan + Motion" now = the intersection.
1. **typed-reading mode + TTS.** Input toggle auto-grades typed kana
   (`normKana`/`submitTyped`); Audio toggle + speaker buttons via `speechSynthesis`.
1. **roving tabindex for chip groups.** `setupRoving` over every `.chips` +
   `.topic-inner`: one tab stop per group, ←/→/↑/↓ + Home/End to move (wrapping),
   the stop follows focus, `role=group` + aria-label per row. Collapsed topic chips
   leave the tab order (MutationObserver on the region's `open` class). Font select
   + rank inputs excluded. Closes in-file OUTSTANDING #4.
2. **typed-reading mode + TTS.** Flashcard "Input" toggle (Self-graded / Type the
   reading): typed kana is `normKana`-compared to `v.read`, with an advisory verdict
   + a `.suggested` ring (1/2 still override). "Audio" toggle + `.speak-btn`
   (flashcard answer panel + every Browse card) play the reading via the Web Speech
   API (`speak`/`playReading`, ja-JP voice, `TTS_OK`-gated). New `i-volume` icon;
   prefs persist (`jpverbs_input`/`jpverbs_audio`). Closes in-file OUTSTANDING #1.
3. **`0712d65` align filter rows + site-wide icons + polish.** Filter rows →
   `.frow`/`.chips` fixed-label-column layout (fixes the misaligned chip
   start-x). Inline SVG icon sprite applied to tabs, toolbar, action buttons,
   topic chevron, Leeches chip, leech list, search field, account chip.
   Replaced the blocking first-visit "Create account" modal with a dismissible
   inline banner (`#signupBanner`, remembered in localStorage). Added the
   active-filter recap line (`filterSummary`/`paintSummary` → `#deckSummary`,
   `#bSummary`). Carded the leech list (`.leech-row`).
4. **`5021b84` cap per-card accuracy bars.** Worst-20 default + show-all toggle
   (`renderCardBars`).
5. **`23e627d` regroup verb filters into legible tiers.** Split the 29-chip
   "Category" wall into Type / Transitivity / Topic(collapsible) / Level & rank;
   moved Leeches out of the category pool; segmented JLPT control.

Earlier history (the integration itself) is in `7fea5e3`/`f2bb4d8` and the server
docs. Each change preserved the chip wiring; verification was live (preview +
DOM eval), not a test suite — see NEXT_STEPS for the testing debt.
