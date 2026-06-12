# study-app — 日常日本語 Japanese Trainer

## What this is

The **日常日本語 study app**: a standalone **Vite** project (ES modules, no framework).
[index.html](index.html) loads one entry — [src/main.js](src/main.js), a thin boot file
that owns NO feature logic: it builds the initial deck and calls each module's `initX()` in
order. The actual DOM/render/feature glue is split into **`src/features/*`** modules:

- **`src/features/`** — one module per surface/concern: `chrome` (tabs/font/theme), `io`
  (export/import), `deck` (filter model + picker + forecast + due banner; owns `cfg`),
  `flashcard` (session lifecycle; owns `session`), `browse` (grid + detail modal + topic
  groups; owns `bcfg`), `stats` (charts), `custom-cards` (rebuildData + #verbModal CRUD),
  `settings-page`, `minna` (the みんなの日本語 dashboard), `selftalk` (the 独り言 Self-Talk
  output/speaking-practice tab — see [SELFTALK.md](SELFTALK.md)), `record-compare` (the generic
  record-and-compare engine: MediaRecorder capture + take list + the reference/you/sequence/both
  compare player — fed by Minna AND Self-Talk), `a11y` (roving tabindex + chip
  annotations), `tts`, `audio` (the shared `playItem(item,context)` player — resolves an item to a
  tagged voice variant + routes public-vs-credentialed `<audio>` by `gated`), `render-helpers`
  (shared `jishoUrl`/`provenanceBadge`), and the cloud
  pair `cloud-core` (`api`/`account`/`setSyncStatus`) + `cloud` (sync trios + auth + bootAuth).
  `render-helpers` also owns `copyBtnHtml`/`copyText` — the "copy sentence to clipboard" button
  beside each example's ▶ play (flashcard answer, Browse detail, Minna example rows).
- **`src/core/`** — the PURE, unit-tested core (DOM-free): `srs`, `forecast`, `facets`,
  `examples`, `kana`, `pitch`, `text`, `minna`, `audio` (the per-context voice-priority
  `resolveVariant`), behind a barrel `core/index.js`.
- **`src/state.js`** — the ONE shared mutable hub: `state.store` (progress), `state.DATA`
  (the live deck), `state.minnaStore`, `state.MAXRANK`, `state.BUILTIN_RANK_BY_JP`, plus
  `attachLevels()`. An object whose **properties are mutated** (not `export let` — importers
  can't reassign those, and the test does `state.store = {...}`).
- **`src/persistence/`** (localStorage: `store`/`custom`), **`src/settings-store.js`**
  (synced prefs + `setSettings`), **`src/config.js`** (`API_BASE`/`localDay`), and
  **`src/sync-bus.js`** — the seam where persistence schedules cloud pushes (`sync.progress`/
  `custom`/`settings`) that `cloud.js` registers, replacing the old `typeof` forward-refs.
- **`src/data/`** — `verbs.js` (`export const VERBS`/`ACCENTS`) + `examples.js`
  (`export const EXAMPLES` — now the SEED SOURCE for the sentence store, not read at runtime;
  the deck fetches examples from the server store).

**Module wiring.** Cross-feature calls use direct imports (live bindings — safe even when
circular, e.g. cloud⇄minna, because every call fires at event/runtime, not module-eval). A
few callback seams in `main.js` break would-be eval-time cycles: `registerStartSession`
(deck→flashcard), `registerCardActions` (browse→custom-cards), `registerSessionHooks`
(flashcard←cloud's logSession/maybeShowSignup). Single-writer mutable singletons are plain
`export let`/`const` in their owner module (`cfg`/`bcfg`/`session`/`account`); `settings` is
the one two-writer case, reassigned via `setSettings()`.

Built + content-hashed by Vite, served by its **own nginx container** at the apex
`https://wkenhanced.dev` — **separate** from the API container at `api.wkenhanced.dev`
(two containers, one droplet). The app talks to the API over HTTP **cross-origin**
(same-site): every `/v1/*` call is rebased onto `API_BASE` (`import.meta.env.VITE_API_BASE`).
Originally one self-contained HTML file (derived from
[../japanese-study/japanese-verbs.html](../japanese-study/japanese-verbs.html)); grew into
classic-script files served by the API, then extracted here as its own Vite project.

User-facing overview: [README.md](README.md). What to do next: [NEXT_STEPS.md](NEXT_STEPS.md).
**Card data model + authoring: [CARDS.md](CARDS.md).** みんなの日本語: [MINNA.md](MINNA.md).
Backend (auth, progress, cookie, the cross-origin CORS) is the server's:
[../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md) "Accounts + study app",
[../wk-enhanced-api/deploy/README.md](../wk-enhanced-api/deploy/README.md). This file adds the
*contributor* layer: how-to-work-on-it, the design-system contracts, and the dead-end warnings.

## How to work on it

1. **Vite.** `bun install` once, then `bun run dev` (→ http://localhost:5173) with
   `bun dev` in `../wk-enhanced-api` (→ :3000) for accounts/TTS/Minna. `bun run build`
   → `dist/`; `bun run preview` serves the built bundle. Edit modules under `src/`:
   pure logic in `src/core/*`, shared state in `src/state.js`, DOM/feature glue in
   `src/features/*` (boot order in `src/main.js`), markup in `index.html`, styles in
   `src/styles.css` (imported by `main.js`).
2. **Verify visually.** This is a UI; screenshot the change. Drive it with the
   browser-preview tooling (`.claude/launch.json` has both `study-app` and
   `wk-enhanced-api` configs). See the preview caveat in the dead-ends below. **Run
   `bun run test` too** — `test/core.test.ts` (Vitest + happy-dom) imports the real
   `src/core/*` modules, so a broken export/import fails it loudly.
3. **Commit conventions** (same as the rest of the repo): one logical change → one
   commit; commit at the end of a feature without being asked; fix stale nearby
   comments in the same commit.
4. **The no-framework / offline-friendly ethos still holds — but modules + a bundler
   are now IN** (that's the whole point of the extraction). Do **not** add a framework,
   a CDN icon font, or a chart library: icons stay an inline SVG `<symbol>` sprite, charts
   stay hand-rolled SVG (`lineChart`/`barChart`). Keep `src/core/*` **DOM-free** (the test
   imports them under happy-dom) and **parameterize** anything that reads app state via the
   `state` object — don't make core import DOM. The old `file://` double-click is gone by
   decision (server-only); runtime offline-degradation against localStorage stays.
5. **Cross-origin auth (dev mirrors prod).** Vite :5173 → API :3000 is cross-origin +
   same-site. Keep `COOKIE_SECURE=false` (a `Secure` cookie is dropped over
   `http://localhost`) and the API's `STUDY_APP_ORIGINS` allowlisting the Vite origin
   (defaults to `http://localhost:5173`). #1 thing to check if local login won't stick.
   See the cross-origin dead-end below + [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md).

## Architecture (map to the in-file section banners)

Markup: `#panel-study` (flashcard setup → card stage → done), `#panel-browse`
(filter grid), `#panel-stats` (charts + leeches), `#panel-minna` (the みんなの日本語
lesson dashboard — near-empty in markup, filled at runtime by `renderMinna`), plus
the header/toolbar, tabs, and the auth modal + sign-up banner.

`data/verbs.js` holds the `VERBS` dataset. The old single-file `app.js` sections are now
one module each under `src/features/*` (the section names map 1:1 to filenames): persistence
(`persistence/store`+`custom`) + SRS (`core/srs`) → `settings-store` → `chrome`
(font/theme/tabs) → `io` (export/import) → `deck` (`passes()` + `wireFacets`, owns `cfg`) →
`flashcard` (session lifecycle, owns `session`) → `browse` (+ detail modal, owns `bcfg`) →
`stats` → `custom-cards` (modal CRUD + `rebuildData`) → `cloud-core`+`cloud` → `settings-page`
→ `minna`. `main.js` calls their `initX()` in that order. Key functions by area:

- **SRS/leech (pure, the core logic):** `cardStat`, `scheduleCard`, `isDue`,
  `dueCards`, `rollingAcc`, `isLeech`, `leeches`. Leitner boxes, not SM-2.
- **Study type (`cfg.kind` ∈ `free`/`srs`):** the picker's "Study type" toggle.
  `buildDeck` restricts an SRS deck to due cards; `grade` only calls `scheduleCard`
  when `session.kind==='srs' && isDue(rank)`. Free study records attempts/accuracy
  but NEVER touches the box/due. Session kind is captured at `startSession` into
  `session.kind`, tagged onto `store.sessions[*].kind` + the durable log's
  `details.kind`, and split out in `renderStats` (the SRS vs Free-study boxes).
- **Filtering (AND'd facets):** `passes(v,c)` intersects six token facets
  (`cat`/`type`/`trans`/`topic`/`status`/`source`) + JLPT + rank. `facetMatch` =
  OR-within-one, `facetAll` = no-constraint test, `oneGroup` = does a card match one
  token. `wireFacets(selector,c,onChange)` wires the `.deck`/`.bf` chips, deriving each
  chip's facet from its token via `TOKEN_FACET` (topic is the default; `mnn-l<n>` →
  `source` via a regex); the lone "all" chip clears every facet. `makeMultiSelect` still
  wires the JLPT segs. `cfg` (flashcard deck) and `bcfg` (browse grid) are independent
  configs. The `source` facet (みんなの日本語 / iTalki / per-lesson) is the Minna-provenance
  filter — see [MINNA.md](MINNA.md) "The Source filter facet".
  `annotateJlptChips`/`annotateCatChips`/`annotateSourceChips` disable empty JLPT levels /
  categories / sources (the Source row also hides entirely until the deck has Minna cards).
  `syncVerbRows` hides the verb-only Type+Transitivity rows when the `cat` facet
  excludes verbs (and clears any stranded type/trans tokens).
- **Categories (`cat` facet):** `CATS` = `verb/adjective/noun/adverb/phrase`; all
  100 built-ins are `verb`, the rest are user-added. `cardStamp(v)` + `colorClass(v)`
  pick the hanko-stamp label/CSS class — the word-class subtype (`GODAN`, `い-ADJ`)
  when present, else the bare category (`NOUN`). The add-card modal's `syncVerbFields`
  shows Type for verbs+adjectives (repopulating `#vfType` via `VF_TYPE_OPTS`) and
  Transitivity for verbs alone; `saveVerb` stores `''` for the hidden fields.
- **Data + custom verbs:** `DATA` is a `let` = baked `VERBS` + `loadCustom().verbs`,
  rebuilt by `rebuildData()`; `attachLevels()` also defaults `v.cat='verb'` on every
  card (transition groundwork — see the de-verb-ify dead-end); `MAXRANK` tracks the top rank (rank filter extends
  past 100). `openVerbModal`/`saveVerb`/`deleteVerb` are the #verbModal CRUD;
  custom verbs persist in `jpverbs_custom` and SYNC to the cloud — `saveCustom`
  writes localStorage + schedules a push; `saveCustomLocal` is the no-push variant
  for hydration.
- **TTS:** `speak(text)` plays the server's Google TTS (`/v1/tts`) via a reused
  `<audio>` when served over http(s) (`HTTP_SERVED`), falling back to
  `speakSynth` (Web Speech) over `file://` or on failure. `TTS_OK` = either path
  available (gates the Audio UI). See the TTS dead-end.
- **Leveled examples:** `attachLevels()` sets `v.levels = state.exampleLevels[rank]`
  (built-in only) after each rebuild. `state.exampleLevels` is the `{[rank]:{N5:[jp,en],…}}`
  model **fetched from the server sentence store** (Phase 2 — `GET /v1/sentences?ownerType=card`
  via `features/examples.js` `initExamples()`), cache-hydrated from `jpverbs_examples_cache` at
  boot and rebuilt from the fetch by the pure `sentencesToLevels` adapter (`core/examples.js`);
  degrades to the cache offline. `data/examples.js` is the **seed source** for
  `seed-sentences.ts`, no longer read at runtime (it tree-shakes out of the app bundle).
  `availableTiers(v)` + `exampleForLevel(v, level)` (pure, fallback: exact tier → nearest → `ex`
  → null) drive the answer-side selector (`renderExample`, default tier = `settings.exampleLevel`)
  and the Browse detail modal's level filter. `JLPT_TIERS` is the easy→hard order.
- **Settings (DB-synced):** `settings` ({exampleLevel, furigana, input, audio,
  freeReviewDue}) in
  `jpverbs_settings`, synced as app `settings`. `loadSettings` (migrates old per-key
  prefs), `saveSettings` (persist + `applyFurigana` + push), `renderSettings`
  (Settings-modal controls), `paintPrefChips` (mirror onto the setup chips).
  `applyFurigana` flips `<html data-furigana>` (CSS hides `<rt>` when off).
- **Render:** `showCard`/`reveal`/`grade`/`endSession` (session, `endSession` also
  POSTs to the durable session log), `renderBrowse` (summary cards) +
  `openVerbDetail`/`renderDetailExample` (the detail modal), `renderStats` +
  `renderCardBars`, `lineChart`/`barChart` (SVG strings).
- **SRS forecast (study panel):** `reviewForecast(h)` (pure) buckets every
  scheduled card (`box>0`) into time slots for the chosen window (`forecastHorizon`
  ∈ `24h`/`week`/`month`/`year`); overdue folds into slot 0, beyond-window drops.
  `renderForecast` draws the hand-rolled vertical-bar SVG into `#forecastChart` and
  is called from `updateDueBanner` (so it tracks the schedule). The `#fcHorizons`
  toggle is view-only state, not synced. Tests in `verbs-core.test.ts`.
- **Per-card SRS indicator:** `detailMemoryLine(v)` (Browse detail modal) renders a
  5-segment Leitner track (filled up to the card's box, each lit pip in its
  `BOX_COLORS` tone) + box number + a "next review" chip that flips red ("due now")
  once due. `BOX_COLORS` (index 0=New…5) is shared with the Stats box histogram.
- **Typed mode + audio:** `revealAnswer` (shared show-answer + autoplay) feeds both
  `reveal` (self-graded) and `submitTyped` (typed: `normKana`-compares the kana, sets
  an advisory verdict + `session.suggested`). `bindSingle` wires the Input/Audio
  single-select chips. Prefs persist as `jpverbs_input` / `jpverbs_audio`. (Audio
  playback itself is the TTS bullet above.)
- **Cloud:** `api`, `bootAuth`, `updateAccountChip`, `openAuth`. **Cross-origin**
  (`api()` rebases every path onto `API_BASE` + sends `credentials:'include'`), the
  session lives in a `.wkenhanced.dev` httpOnly cookie. THREE debounced synced blobs: progress (app `verbs`), custom
  verbs (app `custom-verbs`), settings (app `settings`) — each with a
  `schedule*Sync`/`push*Cloud`/`pull*Cloud` trio; all server-wins on login, fresh
  account seeds from local (`pullCloud` chains all three). Plus `logSession` →
  `POST /v1/sessions` (durable append-only history, signed-in only).
  `maybeShowSignup` (from `endSession`) shows the sign-up nudge after the first
  session, not on first paint.
- **UX helpers (added in the polish pass):** `filterSummary`/`paintSummary`
  (active-filter recap), `setupTopicGroups` (topic disclosure + badge),
  `escapeHtml`, `jishoUrl(jp)` (Jisho.org dictionary deep-link, shown on the
  flashcard answer side + the Browse detail modal; `target=_blank`).
- **A11y:** `setupRoving(container)` gives a chip group a roving tabindex (one tab
  stop, ←/→/↑/↓ + Home/End to move, aria-label from the row's `.filter-label`).
  Wired over every `.chips` + `.topic-inner`; collapsed topic chips leave the tab
  order. Multi-select rows are `role=group` (arrows move focus); single-select rows
  that declare `role="radiogroup"` in the markup become real radio groups (chips
  `role=radio` + synced `aria-checked`, arrows move the selection). See the roving
  dead-end for the radiogroup contract.

Persisted store (`localStorage["jpverbs_v3"]`, synced as app `verbs`):
`{ cards:{<rank>:{attempts:[1|0…],right,wrong,box:0..5,due:<epochMs>}}, sessions:[{t,right,tot}…] (cap 1000, for charts), daily:{"YYYY-MM-DD":{right,tot}} }`.
The capped `sessions` is just for the charts — the durable record is the server's
`study_sessions` table (`POST /v1/sessions` on every session end).
Custom verbs (`localStorage["jpverbs_custom"]`, synced as app `custom-verbs`):
`{ seq:<monotonic rank counter>, verbs:[<verb + {rank, custom:true}>…] }`.
Settings (`localStorage["jpverbs_settings"]`, synced as app `settings`):
`{ exampleLevel, furigana, input, audio, freeReviewDue, recordingsKeep, trimSilence, compareSpeed,
audioPrefs:{<context>:[<token>…]} }` (the Settings page; migrated from the old
jpverbs_exlevel/input/audio keys; `freeReviewDue` defaults on). `audioPrefs` is the audio-unify
per-context voice priority — keyed by `reviews`/`browse`/`minna`, each an ordered list of tokens
(a specific voice `siri:female` or a kind `kind:native`/`kind:tts`/`kind:user`); a missing/empty
context falls back to `core/audio.js` `DEFAULT_AUDIO_PREFS`. Unknown tokens are pruned on load +
cloud-pull (`settings-store.js` `normalizeSettings` → `core/audio.js` `pruneAudioPrefs`) so a stale
synced blob can't carry a foreign token into the editor/resolver.
Minna state (`localStorage["jpverbs_minna"]`, synced as app `minna`):
`{ notes:{<lesson>:string}, lastLesson:<n>, overlays:{<builtinRank>:{tags,italki,minnaLesson,minnaKey,accent?,tts?}} }`
— the みんなの日本語 dashboard's per-lesson scratchpad PLUS the dedup overlays (Minna words
that map onto a built-in verb). Activated *new* Minna vocab is NOT here — it lives in
`jpverbs_custom` as tagged cards; only built-in-overlap words live here (see the
みんなの日本語 dead-end).
Self-Talk state (`localStorage["jpverbs_selftalk"]`, synced as app `selftalk`):
`{ practice:{lastDay,streak,doneToday} }` — the practice/streak signal ONLY (output reps, not SRS).
**Phrases moved to the server sentence store** (Phase 1 of the unified store): built-ins are public
rows, user-authored phrases are private rows, fetched from `GET /v1/sentences?ownerType=selftalk`
and cached in `localStorage["jpverbs_selftalk_cache"]` (read-through). `data/selftalk.js` is the
seed source, not read at runtime. A pre-store blob's `phrases` are migrated into the store once on
sign-in. See [SELFTALK.md](SELFTALK.md).
Leveled examples (server sentence store; `localStorage["jpverbs_examples_cache"]` read-through):
the `{[rank]:{N5:[jp,en],…}}` model in `state.exampleLevels`, fetched from
`GET /v1/sentences?ownerType=card` on boot and cached. `data/examples.js`
(`EXAMPLES[rank]={N5:[jp,en],…}`) is the **seed source** only — not read at runtime.
Pitch accents (`verbs.js`, static): `ACCENTS[rank] = <Tokyo accent number>` — backfilled
onto built-in cards' `v.accent` by `attachLevels` (Minna cards carry their own).

## Design system

**Type-label rule:** uppercase-mono (the signature) is for SHORT labels only —
filter/stat/section labels, kickers, tabs. Longer descriptive strings (chart
titles, helper/hint text) are sentence-case mono so they stay scannable; don't
add `text-transform:uppercase` to a multi-word sentence.

All theming flows through CSS custom properties (`--ink/--paper/--paper-2`,
`--godan/--ichidan/--irregular`, `--adjective/--noun/--adverb/--phrase`,
`--muted/--line`, `--leech`, `--good`, `--jp-font`); light/dark is one `data-theme`
flip on `<html>`. Colors are **functional, not decorative** — verb classes
(godan=vermilion, ichidan=indigo, irregular=stone) and the non-verb category
accents (adjective=teal, noun=amber, adverb=rose, phrase=slate) both paint the card
spine + hanko stamp via `colorClass(v)`; leech=purple. Mono labels (`SF Mono`), serif chrome (Georgia), swappable
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
  chip markup freely **as long as each chip keeps its classes + `data-*`**. The
  study picker's secondary rows are wrapped in a `<details class="more-filters">`
  for exactly this reason; the wiring is blind to it. **Active state is a tinted
  wash + colored border + bold (`.chip.active` via `color-mix`), NOT a solid-ink
  fill** — don't revert it; the solid fill made a defaults-laden picker a wall of
  black blocks. `.chip.primary` (Start) and `.btn.srs` stay solid — they're CTAs.
- **`.jlptseg`** is the segmented JLPT control (adjacent chips share borders);
  still multi-select.
- **`.topic-region` / `.topic-toggle`** is the collapsible topic disclosure
  (max-height transition; a `· N` badge counts active chips inside).
- **Icons:** `<svg class="ic"><use href="#i-NAME"/></svg>` referencing the inline
  `<symbol>` sprite at the top of `<body>`. `.ic` inherits `currentColor` + `1em`.
- **Modals scroll, they don't overflow the viewport.** `.modal` caps at `calc(100vh - 40px)` with
  `overflow-y:auto` (the overlay's 20px×2 padding); its `.modal-x` close button is `position:sticky`
  + `float:right` so it stays pinned top-right while the body scrolls (don't revert it to plain
  `absolute` — a tall modal like Settings would scroll the × out of reach). Add long modal content
  freely; it just scrolls.
- **Sticky navbar (`.navbar` / `.nav-inner`)** is the anchored top bar: title (left), the
  `#navExtra` slot (a context-controls dock — `minna.js` fills it with the speaking/compare bar,
  empties it on tab-leave), and `.nav-actions` (right) — theme + settings are `.nav-btn.icon-only`
  (icon, no text label; keep their `aria-label`/`title`), the account button is a `.nav-btn` with
  the cloud icon + email. Transient sync/feedback is the auto-clearing `#syncStatus` pill (set via
  `setSyncStatus`), NOT a persistent label. Import/Export live in the Settings modal's "Backup"
  row (`io.js` still finds them by id). There is no `<header>`/`<h1>` headline anymore.

## Things that look like bugs but aren't (DEAD-END WARNINGS)

- **The API is CROSS-ORIGIN — every call must go through `API_BASE`, not a relative
  `/v1`.** The app is its own container at `wkenhanced.dev`; the API is at
  `api.wkenhanced.dev`. `const API_BASE = import.meta.env.VITE_API_BASE` (dev
  `http://localhost:3000`, prod `https://api.wkenhanced.dev`, baked by the Dockerfile arg);
  `api()` fetches `API_BASE+path` with `credentials:'include'`, and the TTS + Minna
  `<audio>` srcs prepend it too. The session cookie rides because the two are **same-site**
  (`Domain=.wkenhanced.dev`, `SameSite=Lax`). **Minna native audio is cookie-gated**, so its
  `<audio>` sets `crossOrigin='use-credentials'` — without it the cookie isn't sent and the
  audio 401s; the server answers `/v1/minna/audio` with an origin-scoped
  `Allow-Credentials` (never `*`). **Gotcha that bit us once:** the `store`→`state.store`
  module-split rename also rewrote the string `cache:'no-store'` → `'no-state.store'` (the
  hyphen is a word boundary), making every `api()` fetch throw an invalid-`RequestCache`
  TypeError that surfaced only signed-in. Server side of all this: the credentialed-CORS
  branch + cookie `Domain` in [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md).
- **Category / Type / Transitivity / Topic / Status / Source chips are SIX AND'd
  facets, not one OR'd pool** (this changed — older docs/commits describing a shared
  pool, or four/five facets, are stale). A chip's facet is derived from its token via
  `TOKEN_FACET` (`tokenFacet`), not from markup, so the chips still carry class
  `.deck`/`.bf` + `data-deck`/`data-filter`. "Godan + Motion" = `godan AND motion`
  (intersection); tokens within one facet OR. `cfg`/`bcfg` hold
  `cat`/`type`/`trans`/`topic`/`status`/`source` arrays (empty = no constraint).
  `source` (added for みんなの日本語 provenance) matches the `minna`/`italki` card flags and
  `mnn-l<n>` tags. Don't reintroduce a single shared array — that was the old confusing
  behavior. (`passes` treats a *missing* facet array as no-constraint too, so older test
  cfgs without `source`/`cat` still pass.)
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
- **The inline SVG sprite must hide its size via INLINE STYLE, not width/height
  attributes.** There's a global `svg{display:block;width:100%;height:auto}` rule for
  the charts. CSS beats presentation attributes, so the old
  `<svg width="0" height="0" style="position:absolute">` sprite got `width:100%`
  applied — and since `height:auto` on a viewBox-less SVG resolves to 0 in Chromium
  but ~150px in Firefox/Safari, the absolutely-positioned sprite became a full-width
  invisible overlay across the top of the page in those browsers, eating clicks and
  text selection on the header (reported as "can't select the buttons/text at the
  top"; invisible in a Chromium preview). Fix: dimensions live in the sprite's inline
  `style="...width:0;height:0;overflow:hidden;pointer-events:none"` (inline style
  outranks the type selector). Keep them there; don't move them back to attributes,
  and don't widen the global `svg{}` rule.
- **A "no border" edge in a `border-collapse` table must be `0`-width + `transparent`
  colour, NOT `border:none`/`hidden` — Safari paints `none`/`hidden` edges anyway.** The
  みんなの日本語 vocab table (`.mn-vocab`, collapsed borders) separates word groups with a
  `border-top` on word rows and zeroes the word↔controls edge. With `border-top:none` (and even
  `hidden`), **WebKit/Safari still painted that edge** using the cell's border *width* +
  *currentColor* (≈ `--ink`, near-white in dark mode) → a phantom white line under every word
  that Chromium never drew (so it's invisible in the Chromium preview — verify table-border
  changes in Safari, or reason from computed `borderTop`). `none`/`hidden` change only the
  *style*, leaving width+colour to paint. The fix: base every cell edge at
  `border:0 solid transparent` and re-add ONLY the real separator (`.mn-vocab td` word-row
  `border-top:1px solid var(--line)`); the first row + `.mn-rec-row` zero their top edge to
  `0 solid transparent`. Don't "tidy" those back to `none`/`hidden`. (Inline comment in
  [src/styles.css](src/styles.css) by `.mn-vocab`.)
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
  closure that won't see the rebuild. Custom verbs sync to the cloud under a SEPARATE
  app key (`custom-verbs`) from the progress blob (`verbs`) — `saveCustom` schedules
  the push (so add/edit/delete all propagate, including removals); `saveCustomLocal`
  is the no-push write used by `pullCustomCloud` to avoid a re-push loop.
- **Empty JLPT levels are disabled, not hidden** (`annotateJlptChips`, run at boot
  and on any DATA change). The 100 frequent verbs are almost all N5–N4, so N2/N1
  start disabled; adding a custom N2 verb re-enables N2. Roving nav recomputes its
  navigable list each keypress so it skips disabled chips — keep that if you touch
  `setupRoving`.
- **Roving tabindex groups by `.chips`/`.topic-inner` container and matches only
  `button.chip`.** `setupRoving` deliberately excludes the Font `<select class="chip">`
  and the rank number inputs (focus on a non-chip returns -1 from `indexOf` →
  arrows fall through to native behavior), so they stay normal tab stops. It has
  **two flavours, chosen by the container's role:**
  - MULTI-select facet rows (Category/Type/Transitivity/Topic/Status/JLPT, topics)
    are `role=group` TOOLBAR semantics — arrows MOVE FOCUS only; Space/Enter toggles
    via the existing click handler. No `aria-checked` here.
  - SINGLE-select rows (Study type, Test direction, Input, Audio, Order) opt into
    `role="radiogroup"` IN THE MARKUP (the `<div class="chips" role="radiogroup">`).
    `setupRoving` then makes each chip `role="radio"`, mirrors `aria-checked` from
    its `.active` class, makes the checked chip the lone tab stop, and arrows MOVE
    THE SELECTION (radio behavior) by calling the chip's own `click()`. To add a
    new single-select row, add `role="radiogroup"` to its `.chips` container — that
    flag is the ONLY switch; the JS keys off it. Don't add it to a multi-select row.
    `aria-checked` is kept in sync SYNCHRONOUSLY via a `click` listener on the
    container (the chip's click bubbles up after its own handler flipped `.active`)
    plus a class MutationObserver for programmatic selection (`paintPrefChips` /
    deep-links). Don't reintroduce a per-chip-only observer — its microtask lag let
    the AT read stale `aria-checked` right after an arrow keypress.

  Collapsed `.topic-inner` chips are forced to tabindex -1 via a MutationObserver on
  the region's `open` class; if you change how the topic disclosure toggles (e.g. to
  `display:none`), re-check that observer still fires.
- **Typed grading is advisory, and only grades the READING.** `submitTyped`
  compares the typed input against `v.read` and *suggests* a grade (green/red
  verdict + a `.suggested` ring on the matching button), but the user still records
  it via 1/2 or a click — so a typo or an unjudged-meaning recall can be overridden.
  Don't make it auto-advance on match. The compare is
  `normKana(romajiToKana(input)) === normKana(v.read)`: `romajiToKana` first folds
  any romaji to hiragana (greedy longest-match Hepburn + wāpuro variants:
  si/shi, tu/tsu, hu/fu, zi/ji, sya/sha, double-consonant→っ, n'/nn/trailing-n→ん),
  then `normKana` folds katakana→hiragana, strips spaces/separators, and unifies
  long-vowel marks. **Romaji support is intentional (per request)** — it relaxes the
  old "normKana is deliberately NOT romaji-aware" stance. Anything not in the romaji
  table (including already-kana) passes through `romajiToKana` untouched, so a kana
  IME and a romaji typist share one code path. It feeds only the advisory grade,
  never the SRS schedule, so over-permissiveness is harmless. Tests in
  `verbs-core.test.ts`.
- **Audio is unified behind one player + a per-context voice picker (audio-unify Phase 2).**
  `speak(text, context)`/`speakWord(v, context)` are thin wrappers over `playItem(item, context, btn)`
  ([features/audio.js](src/features/audio.js)): it builds the item's available variants (synth from
  the text; `native` from a vnjpclub path; `user` from the newest take), resolves which to play via
  `resolveVariant(context, available, settings.audioPrefs)` ([core/audio.js](src/core/audio.js)), and
  plays synth on a PUBLIC `<audio>` (`/v1/audio/tts?voice=`) but native/take on a CREDENTIALED
  `<audio crossOrigin='use-credentials'>` (`/v1/audio/native`, `/v1/audio/recordings`). Contexts:
  `reviews` (flashcards), `browse`, `minna`. The user orders voices per context in Settings → Voice
  priority (specific voices or kinds); the server falls through to the default clip when a chosen
  voice isn't pre-generated, so naming `siri:female` is always safe. Errors cascade (gated → synth →
  speechSynthesis). In Minna the vocab word button offers the full native/synth/your-take catalog;
  the conversation button is native-only. The Settings Voice-priority editor's per-row ▶ auditions a
  voice via `previewVoice(voiceId, btn)` (also [features/audio.js](src/features/audio.js)), which
  forces a specific synth voice on the sample word (`PREVIEW_SAMPLE`, 食べる) PAST the resolver. **Per-item
  voice cycle (③):** `playItem` takes an `opts.cycle` flag — an **Alt/Shift-click** (`cycleMod(e)`,
  passed by every play handler) walks that item's `variantOrder(available)` (pure, core/audio.js:
  native → each synth voice → user) via a module-level per-item cursor seeded at the resolver's
  default, so the click steps to the *next* voice and the button `title` names it. Preview + cycle are
  the two places playback bypasses `resolveVariant`'s default pick. The editor also dims synth voices
  the server hasn't pre-generated (④): `fetchAvailableVoices` (features/audio.js) reads
  `/v1/audio/variants` once per modal-open and the picker annotates "· not generated" (fails open). **Phase 3 (not yet done):** generalize the
  record-compare "▶ native" into "▶ reference" against any chosen voice. Follow-ups (preview, per-item
  cycle, availability hinting, Phase 3) are tracked in [NEXT_STEPS.md](NEXT_STEPS.md). See
  [NEXT_AUDIO_UNIFY.md](NEXT_AUDIO_UNIFY.md).
- **TTS prefers the server's Google proxy, falls back to Web Speech.** The synth tier of the player
  above: `speak()` ultimately
  plays `/v1/audio/tts?text=<reading>&voice=<chosen>` (legacy `/v1/tts` still works) via a reused
  `<audio>` when served over http(s)
  (`HTTP_SERVED`); over `file://` or on play/network failure it falls back to
  `speakSynth` (Web Speech, `SPEECH_OK`). `TTS_OK = HTTP_SERVED || SPEECH_OK` gates
  whether the Audio UI shows — so audio is on by default when served, even on
  browsers with poor/no speechSynthesis voices. The reading is the answer in both
  directions, so the speaker button lives inside the revealed `.answer` panel (and
  on Browse cards where the reading is already shown) — never on the flashcard
  prompt. The server endpoint caches text→audio (so don't worry about replays); see
  the server's `/v1/tts` (uses the existing `googleTts` service). **What we SEND to TTS
  is `ttsText(v)`, not the raw reading:** Google derives pitch accent from the written
  form, so a bare kana reading is accent-ambiguous for homographs (橋 "bridge" vs 箸
  "chopsticks" are both はし). `ttsText` sends the **kanji headword** (`v.jp`) when it has
  kanji so Google applies the dictionary accent; `v.tts` overrides an ambiguous single
  kanji (e.g. 角→つの). The visible reading is always `v.read`. `speakWord(v)` wraps it.
  **`/v1/tts` is storage-backed + Apple-voice-preferred (server side).** The server now serves
  `/v1/tts` from a three-tier cache (in-process → our storage → Google), persisting the Google
  clip on first hit and preferring a **locally pre-generated `.m4a`** when one exists — so the
  same `speak()` call gets the nicer voice for any text we've pre-generated by
  `wk-enhanced-api/scripts/generate-tts.ts` (default `--engine say` = macOS `say` with a
  Japanese **Siri** system voice, the highest quality; or the `jp-tts` Swift CLI for a specific
  installed voice). **Example
  sentences are now spoken too:** the answer-side example (`#exSpeak` in `flashcard.js`), the
  Browse detail modal (`#dExSpeak` in `browse.js`), and the みんなの日本語 grammar/lesson example rows
  (`ttsSentenceBtn` in `minna.js`) carry a `.speak-btn.sm` that plays `speak(plainText(jp))` —
  `plainText` (core/text.js) strips ruby to the base sentence, the exact string `/v1/tts` keys on,
  so the client request and the pre-gen driver agree.
  **Audio pitch is approximate by design — don't "fix" it by sending kana.** Reading audio sends
  the KANJI headword (`ttsText`), never the kana (verified: a homograph like 橋 sends `橋`, not `はし`).
  But an isolated word still can't realize a 尾高 (odaka) accent — the drop lands on a *following*
  particle that isn't there — and no TTS engine (Siri/Google) can be *told* an accent; it predicts
  one, badly for isolated homographs (橋/箸/端). So the AUDIO accent is approximate and the visual
  `pitchHtml` overline/drop is the source of truth. The lever, if audio accent ever needs to
  improve, is a carrier particle (e.g. speak `橋が`, not `橋`) — a coordinated `ttsText`/driver change
  + full regen, deliberately NOT done. In sentences the accent is already contextually correct.
- **Pitch accent is shown VISUALLY (`pitchHtml`), because the TTS audio can't be pitch-
  controlled.** A card's `accent` number (0=heiban, 1=atamadaka, k=drop after mora k) →
  `pitchHtml(reading, accent)` splits the reading into morae (`splitMora`) and draws an
  overline over the high morae + a step-down at the drop, on the flashcard answer, Browse
  card, and detail modal. No accent → plain reading. This is the source of truth for pitch;
  the kanji-to-TTS trick above only nudges the audio. **Where `accent` comes from:** Minna
  cards carry it from the lesson JSON item / dedup overlay; the 100 built-ins get it from
  the `ACCENTS` map (rank → number) in `verbs.js`, backfilled by `attachLevels`
  (`if(v.accent==null) v.accent=ACCENTS[v.rank]` — a card's own accent wins). Both sets are
  model-generated → proofread; a fix is a one-number edit. Custom verbs have no accent
  unless the user sets one.
- **Flashcard grading keys.** Before reveal: Space/Enter flip the card (typed mode:
  Enter submits instead, bound on the field). After reveal: **Space / Enter / 2 =
  correct; X / 1 = wrong.** The global keydown handler bails when `#answerInput` is
  focused so typing isn't hijacked. (This replaced the old "Enter accepts the
  auto-suggested grade" — Enter now always means correct, per request; the typed-mode
  suggestion ring is still shown, and X/1 overrides it to wrong.)
- **Browse cards are SUMMARY only — clicking opens the detail MODAL** (`openVerbDetail`,
  `#detailModal`), not an inline expand. The old `.detail`/`.open` inline expansion is
  gone (the `.card.open .detail` CSS is dead but harmless). Inside the modal, Mnemonic/
  Trap/Examples are collapsible `<details>` (don't dump everything at once); Examples
  are JLPT-level-filtered via a selector defaulting to `settings.exampleLevel` — that
  filter is a LOCAL view, it does NOT write the global default (study vs. browse).
- **Furigana is a global CSS flip** (`<html data-furigana="off">` → `rt{display:none}`),
  driven by `settings.furigana`/`applyFurigana()`. It affects every `<ruby>` at once
  (examples, browse modal). Don't gate furigana per-element; toggle the attribute.
- **`store.sessions` is capped (1000) and is JUST for the charts.** The durable,
  never-pruned session history is the server's `study_sessions` table — `endSession`
  POSTs there (signed-in). Don't "fix" the cap by unbounding the synced blob (it'd
  grow the 1 MB `verbs` PUT); the DB log is the answer for lifetime history.
- **The leveled example sentences in `examples.js` are MODEL-GENERATED** (fanned out
  across agents, then format-validated: valid JSON, all 5 tiers, balanced `<ruby>`,
  English present; a sample was hand-reviewed for grammar/furigana). They're solid
  but not human-proofread end to end — if you spot an error, fix that
  `EXAMPLES[rank][tier]` entry (it's plain data). **`examples.js` is now the SEED SOURCE
  for the server sentence store, not read at runtime** — so a fix only reaches the app
  after re-running `wk-enhanced-api/scripts/seed-sentences.ts` (idempotent; re-seed
  refreshes the changed row's furigana/translation in place). The deck fetches examples
  from `GET /v1/sentences?ownerType=card` and caches them (`jpverbs_examples_cache`).
  The headword should appear in every sentence and tiers should escalate N5→N1; keep
  that if you regenerate. The example shows on the ANSWER side only (the sentence reveals
  the reading via furigana, so it would spoil the reading-recall question if shown on the prompt).
- **The app now supports multiple part-of-speech categories — prefer "word"/"card"
  in new copy.** It was born a verb trainer (the dataset global is still `VERBS`, the
  data file is `verbs.js`, and all 100 *built-ins* ARE verbs), and renaming those
  internals would be churn for no gain — keep them. But user-added cards can be any
  `cat` in `CATS` (`verb/adjective/noun/adverb/phrase`), the user-facing identity is
  generic (日常日本語 / "Japanese Trainer"), and the verb-specific UI is now
  conditional: the Type + Transitivity filter rows carry `.verb-only` and hide via
  `syncVerbRows` when the `cat` facet excludes verbs; the add-card modal's Type/
  Transitivity fields show only for the categories that have them (`syncVerbFields`).
  Adjectives reuse the `type` field for the い/な split (`i-adj`/`na-adj`); nouns/
  adverbs/phrases have no subtype. Don't reintroduce verb-only framing in headers/
  empty-states, and don't make Type/Transitivity unconditional again. **Still not
  done** (tracked in NEXT_STEPS): conjugation drills, and proofed built-in non-verb
  content (the dataset is still 100 verbs — categories are a model/UI capability that
  users populate).
- **Reviewing a card early never promotes it; free study reschedules only ALREADY-DUE
  cards, and only when the setting allows.** Two study kinds (`cfg.kind`): *SRS review*
  serves only due cards (`buildDeck` intersects `isDue`) and reschedules them; *free
  study* is practice over any deck. The gate lives in `grade`:
  `if(isDue(v.rank) && (session.kind==='srs' || settings.freeReviewDue)) scheduleCard(...)`.
  So: a NOT-due card is never rescheduled (the `isDue` guard — reviewing early can't
  bump a card up); a due card is rescheduled in SRS always, and in free study iff the
  `freeReviewDue` setting is on (default on — "Free study advances due cards" in
  Settings). Both kinds always append to `attempts`/`right`/`wrong` (accuracy + leech
  detection cover free study too) — only the schedule is conditional. Don't
  "simplify" `grade` back to an unconditional `scheduleCard`. Legacy sessions saved
  before the kind-split have no `kind` and count as SRS in the stats. The "Review due
  cards" banner just sets `cfg.kind='srs'` + `status:['due']`.
- **The review forecast is front-loaded by design** — Leitner intervals top out at
  16 days (`BOX_DAYS`), so EVERY scheduled card is due within ~16 days. The `month`
  view (the current month's day count, 28–31 slots) therefore captures the whole
  real schedule; the `year` view (12 monthly slots) collapses everything into slot 0
  until the deck grows long intervals it can't reach. That's accurate, not a bug —
  don't "fix" it by faking spread. `24h` (24 hourly slots) is mostly a single "now"
  spike for the same reason (nothing comes due sub-daily). EVERY slot is drawn as a
  faint background box (via `forecastWindow(h,base)`'s fixed `slots` count) so the
  full breakdown is visible even where nothing is due — that's the point of the
  "draw all boxes" pass; don't go back to only emitting bars for non-empty buckets.
  Labels are date-aware (weekday names for week, month names for year). New/unseen
  cards (`box===0`) are excluded — they're not scheduled yet.
- **Browser-preview tooling reloads/recreates the tab on capture**, which resets
  in-memory state (active tab defaults back to Flashcards; `cfg`/`bcfg` filter
  selections are lost — only localStorage persists). To verify a *transient* state
  (a specific tab, applied filters, expanded topics, seeded stats), set it up and
  assert via DOM `eval` rather than relying on a follow-up screenshot. Seed stats
  data by mutating `store` + calling `renderStats()` in an eval.
- **みんなの日本語 tab (`#panel-minna`) is account-gated + fetched at runtime —
  intentionally NOT offline-first.** Unlike the rest of the app, the Minna dashboard
  loads content live from `/v1/minna/*` (signed-in only), so the copyrighted textbook
  material never ships to anonymous visitors. `renderMinna()` (lazy on tab activation)
  shows a sign-in gate when `!account`, else fetches the lesson and renders
  vocab/grammar/examples/conversation + native-audio buttons (`/v1/minna/audio`, one
  reused `<audio>` with `crossOrigin='use-credentials'` so the session cookie authorizes
  it cross-origin — see the cross-origin dead-end above). **Vocab "activation"
  REUSES the custom-verb system, not a new data path:** each word becomes a tagged
  (`みんなの日本語` + `mnn-l<n>`, plus `iTalki` for words flagged `italki:true` in the lesson
  JSON) DICTIONARY-form custom card via `loadCustom`/`saveCustom` +`seq`, so it joins the
  deck/SRS/Browse/Stats and syncs under `custom-verbs` for free — idempotent via a stable
  `minnaKey` AND self-updating (re-activation patches metadata like the iTalki tag onto an
  existing card without losing its rank — see `minnaActivationStatus`), marked
  `minna:true`/`italki` (Browse shows a みんなの日本語 badge over CUSTOM via `provenanceBadge`;
  iTalki words add a table badge). The `source` filter facet (みんなの日本語 / iTalki /
  per-lesson) studies any of these slices from the normal deck. **A word that already exists
  as a built-in verb is NOT duplicated** — activation writes a provenance *overlay*
  (`minnaStore.overlays`, keyed by built-in rank) that `applyMinnaOverlays` merges onto a
  copy of the built-in (keeping its examples/mnemonic/progress), and `migrateMinnaDupes`
  converts pre-dedup twins on boot. Genuinely-new words become custom cards carrying
  generated `levels`/`mnem`/`tip`/`accent` from the lesson JSON (so they reach parity with
  built-ins — same `renderExample`/`pitchHtml` paths). The only NEW synced blob is
  per-lesson NOTES + the overlays + the Phase-2 conversation **clips** under the `minna` app
  key (4th sync trio). Content source of truth is the server's
  `data/minna/lesson-<n>.json` (git-tracked, curated from the `scripts/scrape-minna.ts`
  draft). **Phase 2 — record-your-voice + compare to native audio — has SHIPPED (MVP).**
  **Full feature doc (architecture + data model + roadmap): [MINNA.md](MINNA.md).**
- **独り言 Self-Talk (`selftalk.js`) is anon-READABLE but account-gated for AUTHORING, and reuses the
  record-compare engine via a reserved partition.** Reading is open to anon (built-in phrases are
  public rows in the server **sentence store**, fetched via `GET /v1/sentences?ownerType=selftalk`
  with a `jpverbs_selftalk_cache` read-through — NOT shipped in the bundle at runtime; `data/selftalk.js`
  is the seed source). **Authoring requires an account** (your phrases are PRIVATE store rows written
  via `POST/PUT/DELETE /v1/sentences`; the "Add phrase" affordance gates on `account` and anon sees a
  sign-in nudge) — so does *recording*. This is NOT the old Minna copyright gate (reading stays anon);
  don't gate reading. A pre-store `selftalk` blob's `phrases` migrate into the store once on sign-in;
  the blob now carries only `{practice}`. The phrase `id` is the store `ext_id` (`st-*`/`usr-<uuid>`),
  preserved verbatim — it's the record-compare itemKey + practice key.
  Recordings reuse the generic engine with a **reserved `SELFTALK_SCOPE = 90000`** (the engine's
  `scope` → the server's opaque numeric `lesson` param; Minna uses 1–50) + a **synth-only reference**
  (no native clip → ▶ reference is a Siri/Google voice from the phrase text, resolved with the
  `selftalk` audio context). Don't reuse `90000` for a Minna lesson. **"Today's focus" is a FILTER,
  not a duplicated section** — rendering today's set as its own group on top of the scene groups
  would double each phrase's `.rec-control` for the same `(scope,itemKey)`; keep it a toggle that
  narrows `visiblePhrases()`. The **speaking-mode singletons + `setOnTakeSaved` hook are shared
  module-global** with Minna: only one tab is active at a time, both leave-hooks call the idempotent
  `exitSpeakingMode`, the `visibilitychange` handler is **guarded on `#panel-selftalk` being active**
  (so it doesn't fight Minna's), and the take-saved hook is **filtered to `SELFTALK_SCOPE`** (so a
  Minna take can't mark Self-Talk practice). Phrases carry **no `accent`** — sentence-level pitch is
  meaningless (`pitchHtml` is per-word); the furigana + synth prosody carry the reading. Full doc:
  [SELFTALK.md](SELFTALK.md).
- **Record-and-compare (`record-compare.js`, the generic engine; Minna + Self-Talk glue feed it):
  the conversation has ONE whole-dialogue MP3, so
  per-line native compare slices it — it does NOT have per-line audio.** A line's native
  compare plays `[startSec,endSec]` of the cached conversation MP3 via `currentTime` + a
  `timeupdate` stop (Media-Fragments `#t=` is unreliable on `<audio>` — don't switch to it).
  Clips resolve `line.clip` (lesson JSON) ∪ `state.minnaStore.clips[lesson][lineIdx]` (synced,
  set by the in-app marker) — **store wins** (`resolveClip`). A line with no clip still
  records; only its native compare is gated (a hint shows). **The record/compare/clip
  delegated handlers attach ONCE to the persistent `#mnBody`** (`body.dataset.recWired` /
  `clipWired` guards) because `renderMinnaLesson` re-renders `body.innerHTML` on
  activation/clip-save — re-attaching per render would stack listeners and double-fire. The
  handlers read all context (lesson, itemKey, native src, clip) off the rec-control's
  `data-*`, so they need no closure over the lesson. **The per-item rec-controls live in
  `#mnBody`, but the GLOBAL speaking bar (toggle + mic picker + speed + bias) is docked in the
  navbar `#navExtra` slot** (`renderNavSpeaking` fills it; `clearNavSpeaking` empties it on
  tab-leave/gate) so it floats at the top while you scroll the lesson. Its delegate
  (`wireSpeakingControls`, speed chips + bias slider) attaches once to `#navExtra` —
  SEPARATE from `wireRecordCompare`'s `#mnBody` delegate; don't move the speed/bias handlers back
  onto `#mnBody` (the controls aren't there anymore). The toggle + mic picker are wired
  per-render in `renderNavSpeaking` (the slot's innerHTML is replaced each lesson render). **Recordings are PRIVATE on the server**
  and played via one reused `<audio crossOrigin='use-credentials'>` (gated, cross-origin) —
  the same cookie-gated-audio path as the native-audio button. The **binary upload uses its
  own credentialed `fetch`** (not the JSON-only `api()`); list/delete use `api()`. Retention
  is the `recordingsKeep` setting (default 3, 1–20), sent as `keep` and enforced server-side.
  **The compare player has ▶ you / reference / →you (seq) / both / loop** (audio-unify Phase 3 / ⑤):
  the **reference** generalizes the old native-only target to ANY voice — it resolves via
  `resolveVariant('minna', refAvailable(ctx), prefs)` (per-context priority picks the default), and
  **Alt/Shift-click** the ▶ reference button cycles the item's voices (native → Siri F/M → Google,
  `referenceVariants`/`cycleReference`, persisted on the control's `data-ref`). `refUrl` maps a variant
  to the gated native clip OR the public `/v1/audio/tts?voice=` (both play on the one reused
  credentialed `<audio>` — the public TTS endpoint is under the study-app CORS allowlist); each
  rec-control carries the item's synth `text` (`data-text`) so a clipless line / native-less word can
  still compare against synth. `seq`/`both`/`loop` compare against the selected reference; **both**
  overlays reference + take on the two separate `<audio>` elements with a 2-count barrier (one-shot; loop is
  seq-only). Playback speed is `settings.compareSpeed` (synced, snapped by `clampSpeed` to
  {0.5,0.75,1}) applied via `applySpeed` (`playbackRate` + `preservesPitch`) on every compare
  play; the segmented control lives in the navbar-docked speaking bar. **Volume is normalized** so native + take
  play at ~equal loudness: `levelFor` (RMS over each spoken window) → `normGains` (attenuate-only,
  since `<audio>.volume` can't boost — the louder is brought down to the quieter, floored at 0.3)
  → a `volume` passed through `playRange`. The **▶ both balance slider** (`compareBias`, view-only,
  in the speaking bar) is a `you ⟷ native` crossfader applied ON TOP of the gains, **only** for
  ▶ both (`applyBothVolumes`, live via `bothPlaying`); single playback ignores it. The take-list
  ▶ resets `volume` to 1 (raw listen, not normalized). **A cross-lesson "Practice history"
  overview** (`practiceHistorySection` in `minna.js`, fed by `GET /v1/minna/practice` → DB
  `recordingSummary`) renders a collapsed section in the lesson view: per-lesson distinct-item +
  take counts + last-practiced date, current lesson highlighted, hidden until the first recording.
  It's fetched fresh each lesson render and **fails open** (offline → no section); a take saved
  after render won't show until the next render/switch (an upload only re-renders its own control).
  The route has its **own path** (`/practice`, not under `/recordings/`) so the `/recordings/{id}`
  param route can't shadow it.
- **Every compare playback plays a SPEECH WINDOW, not the whole file — this is what makes ▶ both
  line up.** The native MP3 has built-in lead/tail silence; overlapping it raw on your
  (already-tight) take would start the native speaker late, so ▶ both wouldn't align. `playRange`
  (a generic windowed `<audio>` player: seek to `start`, stop at `end` via a `timeupdate`
  listener — Media-Fragments `#t=` is unreliable) plays `[start,end]` from `windowFor(url, clip)`
  → `speechWindow`, which runs **the same `findTrimBounds`** as the save-time trim over the
  decoded buffer (clip-sliced first for a conversation line) with a **small EQUAL lead pad on
  both sources** (`COMPARE_TRIM`) so the spoken onsets coincide. Windows are computed off the
  decoded buffers (`resolvedBuffers`) and memoized (`windowCache`); before a buffer decodes,
  playback falls back to the clip / whole file. Don't revert native/take playback to raw
  whole-file or raw-clip — the windowing is the alignment. The take-list ▶ (`playTake`) still
  plays the WHOLE take (a quick listen, not a compare) and tears down any windowed `takeStop`
  first.
- **The compare waveforms use a `<canvas>`, the deliberate exception to "charts stay hand-rolled
  SVG".** `paintCompareWaveforms` (per-render hook from `wireMinnaLesson`; also called by
  `resetControl` after save/delete) decodes the newest take + the native audio via
  `fetchAudioBuffer` — a **credentialed** `fetch` (the gated-audio path; plain `fetch` 401s) →
  `decodeAudioData`, promise-cached per URL — then crops each to its `windowFor` SPEECH WINDOW
  (the same region playback uses, so what's drawn is what plays) and `waveformPeaks` (pure) →
  canvas (you=`--godan`, native=`--ichidan`). A per-sample waveform is the wrong shape for SVG
  and the bytes are right there to decode, so canvas is correct here — don't "fix" it to SVG.
  Decode **fails safe**: offline / Safari-can't-decode-opus (a non-trimmed take) / 404 → the
  waveform simply doesn't draw, and the `<audio>`-driven compare buttons keep working. A single
  rAF loop (`tickCursors`) moves an overlay cursor for whichever element is sounding, mapping its
  `currentTime` over the **active play window** (`activeNativeWindow`/`activeTakeWindow`). Canvas
  is sized to fixed `WAVE_W/H` (not `clientWidth`) so it paints correctly even inside a closed
  `<details>`.
- **"Speaking mode" keeps ONE mic stream open; the record controls only render while it's
  on.** Acquiring/releasing the mic per take renegotiates the macOS input each time — that
  hitches (and re-triggers the AirPods HFP switch). So `enterSpeakingMode()` opens one
  persistent `liveStream` and keeps it; `startRecording` spins a `MediaRecorder` on it with
  **no `getUserMedia` per take**; `onstop` does NOT stop the stream. `minna.js` renders the
  vocab/line rec-controls only `if (isSpeakingMode())`; the **toggle button lives in the
  navbar-docked speaking bar** (`#navExtra`, `renderNavSpeaking`) and re-renders the lesson on
  click (which repaints both the body rec-controls and the navbar bar). Don't revert
  `startRecording` to per-take `getUserMedia`, and don't render controls outside speaking mode.
  `exitSpeakingMode()` stops the recorder + releases the stream. **Navigating out
  of the lesson context auto-exits speaking mode** so the mic doesn't linger: `chrome.js`
  `initTabs` tracks the active tab and fires a `leaveMinna` handler when switching AWAY from the
  みんなの日本語 tab → wired in `main.js` to `minna.js`'s `onMinnaHidden()` → `exitSpeakingMode()`;
  a chapter-chip click also calls `exitSpeakingMode()` before re-rendering. The stale
  speaking-mode DOM is never seen because returning to the tab re-renders fresh via `renderMinna()`.
  Don't move the tab-leave hook into `chrome.js` directly (it'd make chrome import a feature) —
  keep it a `handlers.leaveMinna` callback like the per-tab renders. **Changing the BROWSER tab
  (or minimizing) also exits** via a `document` `visibilitychange` listener (`handleBrowserTabHidden`,
  attached once in `initMinna`) — those in-app hooks don't fire on a browser-tab change. That path
  DOES re-render the lesson itself (`renderMinnaLesson(lastLesson, #mnBody)`), because returning to
  the browser tab — unlike an in-app tab activation — does NOT re-run `renderMinna()`, so without
  the re-render the toggle/controls would show a stale "speaking" state after the mic was released.
- **The mic picker pins a `deviceId` ON PURPOSE — it's the fix for AirPods dropping to
  hands-free.** macOS switches AirPods to low-quality HFP the instant any app opens *their*
  mic; the persistent stream is acquired with an explicit non-AirPods
  `getUserMedia({audio:{deviceId:{exact}}})`, so the AirPods input is never activated. The
  chosen device is **device-local** (`localStorage jpverbs_micDevice`), NOT in the synced
  `settings` blob — a deviceId is per-browser/machine and meaningless on another device; don't
  move it into `settings`. Labels are empty until permission is granted (browser privacy), so
  the picker shows "Microphone N" until the first stream, then re-enumerates. A vanished
  stored id is dropped → system default (one-shot `{audio:true}` retry if `exact` fails).
- **Silence trim is DELIBERATELY forgiving — clipping real speech is worse than leaving a
  little dead air.** `findTrimBounds` (pure/tested) uses four guards: an **adaptive** threshold
  (`max(floor, peakRMS·ratio)`, not a fixed absolute one) so it tracks the speaker's level; a
  **robust peak** (the 95th-percentile window RMS, `peakPct`, NOT the raw max) so one
  impossibly-loud window can't inflate the threshold; a **sustain gate** (`minRunMs`, ~30 ms)
  so an edge only counts as speech when energy stays up for a real syllable's worth, not a
  click; and a **generous asymmetric lead pad** (~160 ms vs ~140 ms tail) so voiceless/aspirated
  onsets — ひ [çi], ふ [ɸɯ], the breathy start of 引きます — survive even though they sit BELOW
  the vowel's RMS (the sustained run starts at the vowel; the lead pad reaches back over the
  consonant). Don't "tighten" it back to a fixed threshold, a raw-max peak, or a symmetric
  pad — the asymmetric pad fixed the bug that ate 引きます's ひ, and the robust-peak + sustain
  gate fixed a **laptop trackpad-click** recording (a mechanical click impulse at the very
  start/end was inflating the threshold AND anchoring the edges, so nothing trimmed and quiet
  onsets clipped). `maybeTrim` mixes to mono and re-encodes 16-bit PCM **WAV** (no in-browser
  opus encoder for an `AudioBuffer`; short clips stay under the 2 MB cap). Gated by
  `trimSilence` (default on) and **fails safe**: decode error / no sustained run above
  threshold / <150 ms result all return the ORIGINAL blob. The server's recording
  content-type allowlist includes `audio/wav` (+ a `.wav` ext mapping).

## Change log — UX/design pass (this is the conversation record)

Commits, newest first (all on `main`; touch the split web/ files + `src/` where noted):

1. **`app.js` → `features/*` + a thin `main.js` (10 commits).** Peeled the 1934-line
   single-module `src/app.js` into one feature module per section (`chrome`/`io`/`deck`/
   `flashcard`/`browse`/`stats`/`custom-cards`/`settings-page`/`minna`/`a11y`/`tts`/
   `cloud-core`+`cloud`/`render-helpers`), plus `config.js`, `persistence/*`,
   `settings-store.js`, and `sync-bus.js`. `main.js` is now the entry and owns no feature
   logic — it builds the initial deck and calls each module's `initX()` in boot order;
   `index.html` points at it. The old `typeof X==='function'` forward-ref guards became real
   imports; the few would-be eval-time cycles are broken by callback seams
   (`registerStartSession`/`registerCardActions`/`registerSessionHooks`) and by the
   `sync-bus` (persistence schedules pushes; `cloud` registers the real ones). Mutable
   singletons stay single-writer `export let` in their owner (`cfg`/`bcfg`/`session`/
   `account`), except `settings` (two writers → `setSettings`). Behavior unchanged; the
   33-test core suite + `bun run build` gate each step, and the full flow (sessions, browse,
   stats, custom CRUD, cross-origin sign-in + all four sync blobs + session log) was
   preview-verified against the dev API. No new features — pure structure.
1. **みんなの日本語: content parity + dedup + pitch accent (4 commits).** Fixes for
   second-class activated cards. (1) **TTS** sends the kanji headword (`ttsText`/
   `speakWord`) so Google applies the right pitch for homographs (橋≠箸). (2) **Dedup**:
   words that already exist as built-in verbs reuse them via a provenance overlay
   (`minnaStore.overlays`/`applyMinnaOverlays`/`migrateMinnaDupes`) instead of a bare
   duplicate — they inherit the built-in's examples/mnemonic. (3) **Content plumbing +
   visual pitch**: `minnaCard` carries `levels`/`mnem`/`tip`/`accent`; `attachLevels`
   keeps embedded levels; `pitchHtml`/`splitMora` draw overline+drop notation on the
   reading. (4) **Generated content**: N5–N1 examples + mnemonic + tip + accent for the 47
   new words (workflow, validated). Tests: ttsText/pitchHtml/splitMora/minnaBuiltinRank/
   applyMinnaOverlays. Full doc: [MINNA.md](MINNA.md).
1. **みんなの日本語: iTalki tag + Source facet + lessons 22/24 (4 commits).** (1) An
   `italki:true` flag in the lesson JSON → activated cards gain an `iTalki` tag/flag +
   a vocab-table badge; `activateMinnaVocab` now patches metadata onto already-added
   cards (`minnaActivationStatus` drives an "Update N tags" button) so the tag applies
   retroactively without losing rank. (2) A sixth AND'd **`source`** facet
   (みんなの日本語 / iTalki / per-lesson `mnn-l<n>` via a `tokenFacet` regex) in both
   pickers, with `annotateSourceChips` (hide-until-Minna + dim-empty) and `deckLabel`
   recap support. (3) Curated `data/minna/lesson-22.json` + `lesson-24.json` from the
   scraper. (4) Polish: Source chips tinted to the badge colours, Browse cards drop the
   redundant みんなの日本語/lesson tag chips (the provenance badge covers them). Tests in
   `verbs-core.test.ts` (tokenFacet/oneGroup/passes/deckLabel for `source`). Full doc:
   [MINNA.md](MINNA.md).
1. **ARIA radiogroup semantics for single-select chip rows.** The five mutually-
   exclusive `.chips` rows (Study type, Test direction, Input, Audio, Order) now
   declare `role="radiogroup"` in the markup; `setupRoving` branches on that flag to
   make each chip `role="radio"` with `aria-checked` mirrored from `.active`, the
   checked chip the lone tab stop, and ←/→/↑/↓/Home/End MOVE THE SELECTION (calling
   the chip's own click handler) the way a native radio group does. Multi-select
   facet rows (Category/Type/Transitivity/Topic/Status/JLPT, topics) keep
   `role=group` toolbar semantics. `aria-checked` syncs synchronously via a `click`
   listener on the container (+ a class observer for programmatic selection). Markup-
   only opt-in: add `role="radiogroup"` to a row's `.chips` to make it a radio group.
1. **Multi-category content (finish the de-verb-ify transition).** Added a `cat`
   filter facet (`verb/adjective/noun/adverb/phrase`, `CATS`) as a fifth AND'd facet
   in `passes`/`TOKEN_FACET`/`DECK_FACETS`; a Category chip row leads both filter
   panels (the master "All" reset moved there). The Type + Transitivity rows are now
   `.verb-only` and hide via `syncVerbRows` when the category excludes verbs (clearing
   stranded tokens). The add-card modal gained a Category select; `syncVerbFields`
   shows Type for verbs+adjectives (い/な via `i-adj`/`na-adj`) and Transitivity for
   verbs only, repopulating `#vfType` from `VF_TYPE_OPTS`; `saveVerb` stores `''` for
   hidden fields. New `cardStamp`/`colorClass` drive the spine + hanko stamp (subtype
   label, else category) with `--adjective/--noun/--adverb/--phrase` accent tokens.
   `annotateCatChips` dims empty categories. Copy genericized verb→card. Tests for the
   cat facet + cardStamp/colorClass in `verbs-core.test.ts`.
1. **Design-polish pass — motion (4/4).** Short easing-out entrance animations:
   the card reveal (`answerIn`), card-to-card advance (`cardIn`, re-applied in
   `showCard`), modal+overlay (`modalPop`/`overlayIn`), tab switch (`panelIn`),
   staggered Stats cards (`riseIn`) + bar grows (`growX` box histogram, `growY`
   forecast bars), and button/chip press feedback. **The `prefers-reduced-motion`
   rule now kills `animation` too (not just `transition`)** — so all of these are
   ENTRANCES only; content must be fully visible/usable with animations disabled.
   Don't add an animation that hides content in its resting/`from` state.
1. **Design-polish pass — chip + picker refresh (3/4).** Active chips are now a
   quiet tinted wash + colored border + bold (`color-mix`), not a solid-ink block —
   a picker full of defaults no longer reads as a wall of black rectangles; class
   chips (g/i) tint with their functional color. The secondary picker rows (Input,
   Audio, Type, Transitivity, Topic, Level&rank, Presets, Order) now live behind a
   `<details class="more-filters">` disclosure, so the study setup leads with
   Study-type + Test-direction + Start; the `#deckSummary` recap stays visible so
   collapsed filters are legible. Chip wiring/roving/topic-region are blind to the
   wrapper (verified: Godan filter 100→58, topic toggle, recap all work collapsed).
1. **Design-polish pass — readability/contrast (2/4).** `--muted` darkened
   (#7a7164 → #675f52, ≈4.0:1 → ≈5.3:1 on paper) so the many small labels pass AA.
   `.chart-title` is no longer force-uppercased (long descriptive sentences read
   poorly in spaced caps) — short labels stay uppercase. `.filter-label` /
   `.statbox .l` bumped 10→11px. Design contract: uppercase-mono for SHORT labels
   only; sentence case for longer titles/helper text.
1. **Design-polish pass — responsive + bug fixes (1/4).** Mobile toolbar now
   wraps (`flex-wrap`) instead of overflowing 390px; `.modal-x` is pinned absolute
   (was `float:right`, overlapped the detail-modal stamp) with the detail card-top
   reserving right padding; ending a session with zero grades returns to the picker
   instead of showing an empty "SESSION COMPLETE" card; mobile tap targets ≥40px.
1. **Free-study-advances-due setting + headline + header-overlay fix.** New
   `freeReviewDue` setting (default on): in free study, grading an already-due card
   advances its SRS schedule (not-due cards still never move). Headline → "Everyday
   Japanese that sticks" / 日常の日本語. Fixed the inline SVG sprite hiding (inline
   style, not attributes) so the global chart `svg{width:100%}` rule can't turn it
   into a header-blocking overlay in Firefox/Safari.
1. **De-verb-ify groundwork.** Renamed to 日常日本語 / "Japanese Trainer" (kicker,
   title, headline, README), neutralized "verb"→"word/card" copy, and defaulted
   `cat:'verb'` onto every card (`attachLevels` + `saveVerb`) as the model-level
   start of broadening past verbs. Verb-conjugation UI stays verb-shaped for now.
1. **SRS vs free study + stats split + forecast slot rework.** New "Study type"
   picker toggle (`cfg.kind`): free study never changes review dates, SRS review
   serves due cards only and reschedules; `grade` gates `scheduleCard` on
   `kind==='srs' && isDue`. Sessions are tagged with `kind` (local + durable
   `details.kind`); Stats gained SRS-reviews / Free-study-reviews boxes. Forecast
   now draws every time slot (24/7/28–31/12) with date-aware labels.
1. **Romaji typed input + visual SRS box indicator + upcoming-review forecast.**
   Typed-reading mode now accepts romaji (`romajiToKana` greedy Hepburn/wāpuro
   converter feeds the `normKana` compare; kana/IME still works unchanged). The
   Browse detail modal's "Box N · next review" text became a visual 5-segment
   Leitner track + due chip (`detailMemoryLine`, shared `BOX_COLORS`). New study-panel
   "Upcoming reviews" card (`reviewForecast`/`renderForecast`, `#forecast`) with a
   24h/Week/Month/Year horizon toggle. Tests for `romajiToKana` + `reviewForecast`.
1. **Browse detail modal + DB-backed settings + grading keys + durable session log.**
   Browse cards open a modal (collapsible sections; level-filtered examples) instead of
   expanding. New Settings page (toolbar gear → `#settingsModal`): default example
   level, furigana, default input/audio — synced as app `settings`; furigana flips a
   `<html>` attribute. Reveal grading: Space/Enter/2 = correct, X/1 = wrong. Every
   finished session is appended to a new server `study_sessions` table via
   `POST /v1/sessions` so history is never lost (server: schema + `insertSession`/
   `countSessions` + route + tests).
1. **leveled example sentences.** New `examples.js` (`EXAMPLES`, 5 JLPT tiers/verb,
   model-generated + validated); answer-side N5–N1 selector (`renderExample`,
   `exampleForLevel`/`availableTiers`, pref `jpverbs_exlevel`) + Browse leveled list
   (`exampleListHtml`). Served as a new static asset; tests in `verbs-core.test.ts`.
1. **split into index.html + styles.css + verbs.js + app.js.** Classic scripts (not
   modules) so `file://` still works; server serves the three new assets statically.
   `verbs-core.test.ts` now concatenates verbs.js + app.js.
1. **Google TTS (server + web).** `GET /v1/tts` proxies `googleTts` (cached); the app
   plays it via `<audio>` when served over http, falling back to Web Speech otherwise.
1. **cloud-sync custom verbs.** Second synced blob under app `custom-verbs`
   (`scheduleCustomSync`/`pushCustomCloud`/`pullCustomCloud`); add/edit/delete all
   propagate. Server enum widened to `['verbs','custom-verbs']`.
1. **rate-limit auth (server — touches `src/`, not `index.html`).** Per-IP in-memory
   limiter on `/v1/auth/{login,register}`; see [../src/lib/rateLimit.ts](../src/lib/rateLimit.ts).
1. **pure-core test suite (`web/verbs-core.test.ts`).** Extracts the inline script,
   runs it under a DOM stub, tests passes/scheduleCard/isDue/rollingAcc/isLeech/
   normKana/filterSummary/facets. Guards the core through a future file split.
1. **add/edit/delete custom verbs.** "Add verb" modal in Browse; `jpverbs_custom`
   merged into `DATA` via `rebuildData()`; CUSTOM badge + Edit/Delete; MAXRANK
   extends the rank filter past 100. (Cloud sync added later — see above.)
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
