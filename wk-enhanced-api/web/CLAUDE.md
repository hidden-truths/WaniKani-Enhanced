# web/ — Japanese Verb Trainer study app

## What this is

The **verb-trainer study app**: five no-build static files —
[index.html](index.html) (markup) + [styles.css](styles.css) + [verbs.js](verbs.js)
(the `VERBS` dataset) + [examples.js](examples.js) (`EXAMPLES` — five JLPT-leveled
example sentences per verb) + [app.js](app.js) (all logic). Loaded as classic
`<link>`/`<script src>` (NOT ES modules), so opening `index.html` over `file://`
still works. Served at the apex of the backing API server (`/`, `/study`, plus
`/styles.css` `/verbs.js` `/app.js`). Originally one self-contained HTML file
(derived from [../../japanese-study/japanese-verbs.html](../../japanese-study/japanese-verbs.html));
split once it passed ~2300 lines. User-facing overview: [README.md](README.md).
What to do next: [NEXT_STEPS.md](NEXT_STEPS.md).

This is a **separate surface** from the WaniKani userscript flow — it just shares
the droplet. Backend (auth, progress storage, cookie model) is the server's:
[../CLAUDE.md](../CLAUDE.md) "Accounts + study app", [../deploy/README.md](../deploy/README.md).

**The single best source of truth is the top-of-file block comment** in
`index.html` (architecture map, HISTORY of the split, data model, key design
decisions, mnemonic policy, OUTSTANDING WORK). Read it first. This file adds the
*contributor* layer: how-to-work-on-it, the design-system contracts, and the
dead-end warnings.

## How to work on it

1. **No build, no deps.** Edit the files directly — styles in `styles.css`, the
   dataset in `verbs.js`, logic in `app.js`, markup in `index.html`. Served by the
   API server: `cd .. && bun dev`, then reload **http://localhost:3000/**. (Pure
   offline: open `index.html` via `file://` — works because the assets load as
   classic `<link>`/`<script src>`, not modules; accounts/sync/TTS need the server.)
2. **Verify visually.** This is a UI; screenshot the change. Drive it with the
   browser-preview tooling (`.claude/launch.json` has a `wk-enhanced-api` config).
   See the preview caveat in the dead-ends below. **Run `bun test` too** — the pure
   core is covered by `verbs-core.test.ts` (it concatenates verbs.js + app.js).
3. **Commit conventions** (same as the rest of the repo): one logical change → one
   commit; commit at the end of a feature without being asked; fix stale nearby
   comments in the same commit.
4. **No-build + offline-capable is still the contract.** Do **not** add a CDN icon
   font, a chart library, a framework, a bundler, or ES modules. Keep the assets as
   classic scripts so `file://` keeps working. New icons go in the inline SVG
   sprite; new charts are hand-rolled SVG like `lineChart`/`barChart`. `verbs.js`
   and `app.js` share one global scope (classic scripts) — `app.js` relies on
   `verbs.js`'s global `VERBS`, so load order (verbs before app) matters.
5. **Accounts need `COOKIE_SECURE=false` in dev** — a `Secure` cookie is dropped
   over `http://localhost` and login silently fails. (#1 thing to check if local
   login won't stick. Defaults false.)

## Architecture (map to the in-file section banners)

Markup: `#panel-study` (flashcard setup → card stage → done), `#panel-browse`
(filter grid), `#panel-stats` (charts + leeches), plus the header/toolbar, tabs,
and the auth modal + sign-up banner.

`verbs.js` holds the `VERBS` dataset. `app.js` sections (top to bottom): `STORAGE`
(localStorage + SRS scheduling + leech logic) → `SETTINGS` (DB-synced prefs) →
`FONT/THEME` → `TAB NAV` → `EXPORT/IMPORT` → `DECK BUILDING` (`passes()` +
`wireFacets`) → `FLASHCARD` (session lifecycle + TTS) → `BROWSE` (+ detail modal) →
`STATS+CHARTS` → `CUSTOM VERBS` (modal CRUD) → `CLOUD ACCOUNTS + SYNC` →
`SETTINGS PAGE`. Key functions by area:

- **SRS/leech (pure, the core logic):** `cardStat`, `scheduleCard`, `isDue`,
  `dueCards`, `rollingAcc`, `isLeech`, `leeches`. Leitner boxes, not SM-2.
- **Study type (`cfg.kind` ∈ `free`/`srs`):** the picker's "Study type" toggle.
  `buildDeck` restricts an SRS deck to due cards; `grade` only calls `scheduleCard`
  when `session.kind==='srs' && isDue(rank)`. Free study records attempts/accuracy
  but NEVER touches the box/due. Session kind is captured at `startSession` into
  `session.kind`, tagged onto `store.sessions[*].kind` + the durable log's
  `details.kind`, and split out in `renderStats` (the SRS vs Free-study boxes).
- **Filtering (AND'd facets):** `passes(v,c)` intersects four token facets
  (`type`/`trans`/`topic`/`status`) + JLPT + rank. `facetMatch` = OR-within-one,
  `facetAll` = no-constraint test, `oneGroup` = does a verb match one token.
  `wireFacets(selector,c,onChange)` wires the `.deck`/`.bf` chips, deriving each
  chip's facet from its token via `TOKEN_FACET` (topic is the default); the lone
  "all" chip clears every facet. `makeMultiSelect` still wires the JLPT segs.
  `cfg` (flashcard deck) and `bcfg` (browse grid) are independent configs.
  `annotateJlptChips` disables empty JLPT levels.
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
- **Leveled examples:** `attachLevels()` sets `v.levels = EXAMPLES[rank]`
  (built-in only) after each rebuild. `availableTiers(v)` + `exampleForLevel(v,
  level)` (pure, fallback: exact tier → nearest → `ex` → null) drive the answer-side
  selector (`renderExample`, default tier = `settings.exampleLevel`) and the Browse
  detail modal's level filter. `JLPT_TIERS` is the easy→hard order.
- **Settings (DB-synced):** `settings` ({exampleLevel, furigana, input, audio}) in
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
- **Cloud:** `api`, `bootAuth`, `updateAccountChip`, `openAuth`. Same-origin,
  httpOnly cookie. THREE debounced synced blobs: progress (app `verbs`), custom
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
  stop, ←/→/↑/↓ + Home/End to move, `role=group` + aria-label). Wired over every
  `.chips` + `.topic-inner`; collapsed topic chips leave the tab order.

Persisted store (`localStorage["jpverbs_v3"]`, synced as app `verbs`):
`{ cards:{<rank>:{attempts:[1|0…],right,wrong,box:0..5,due:<epochMs>}}, sessions:[{t,right,tot}…] (cap 1000, for charts), daily:{"YYYY-MM-DD":{right,tot}} }`.
The capped `sessions` is just for the charts — the durable record is the server's
`study_sessions` table (`POST /v1/sessions` on every session end).
Custom verbs (`localStorage["jpverbs_custom"]`, synced as app `custom-verbs`):
`{ seq:<monotonic rank counter>, verbs:[<verb + {rank, custom:true}>…] }`.
Settings (`localStorage["jpverbs_settings"]`, synced as app `settings`):
`{ exampleLevel, furigana, input, audio }` (the Settings page; migrated from the
old jpverbs_exlevel/input/audio keys).
Leveled examples (`examples.js`, NOT in localStorage — static data):
`EXAMPLES[rank] = { N5:[jp,en], …, N1:[jp,en] }`.

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
  arrows fall through to native behavior), so they stay normal tab stops. It's
  TOOLBAR semantics (arrows move focus; Space/Enter selects via the existing click
  handler) — NOT an ARIA radiogroup, so don't expect `aria-checked`. Collapsed
  `.topic-inner` chips are forced to tabindex -1 via a MutationObserver on the
  region's `open` class; if you change how the topic disclosure toggles (e.g. to
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
- **TTS prefers the server's Google proxy, falls back to Web Speech.** `speak()`
  plays `/v1/tts?text=<reading>` via a reused `<audio>` when served over http(s)
  (`HTTP_SERVED`); over `file://` or on play/network failure it falls back to
  `speakSynth` (Web Speech, `SPEECH_OK`). `TTS_OK = HTTP_SERVED || SPEECH_OK` gates
  whether the Audio UI shows — so audio is on by default when served, even on
  browsers with poor/no speechSynthesis voices. The reading is the answer in both
  directions, so the speaker button lives inside the revealed `.answer` panel (and
  on Browse cards where the reading is already shown) — never on the flashcard
  prompt. The server endpoint caches text→audio (so don't worry about replays); see
  the server's `/v1/tts` (uses the existing `googleTts` service).
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
  but not human-proofread end to end — if you spot an error, just fix that
  `EXAMPLES[rank][tier]` entry (it's plain data). The headword should appear in every
  sentence and tiers should escalate N5→N1; keep that if you regenerate. The example
  shows on the ANSWER side only (the sentence reveals the reading via furigana, so
  it would spoil the reading-recall question if shown on the prompt).
- **The app is mid-transition away from "verbs only" — prefer "word"/"card" in new
  copy.** It was born a verb trainer (the dataset global is still `VERBS`, the data
  file is `verbs.js`, and all 100 built-ins ARE verbs), and renaming those internals
  would be churn for no gain. But the user-facing identity is now generic
  (日常日本語 / "Japanese Trainer", "The words you keep getting wrong") and every card
  carries `cat:'verb'` (defaulted in `attachLevels`, set on custom verbs in
  `saveVerb`) so non-verb content can be added later keyed off `cat`. Don't
  reintroduce verb-only framing in headers/empty-states. The verb-conjugation bits
  that ARE genuinely verb-specific (the `type` field, the Godan/Ichidan/… Type
  filter, the "Add verb" modal) are intentionally still verb-shaped — generalizing
  those is the actual (not-yet-done) transition work, tracked in NEXT_STEPS.
- **Free study deliberately does NOT change the SRS schedule, and reviewing a card
  early never promotes it.** Two study kinds (`cfg.kind`): *SRS review* serves only
  due cards (`buildDeck` intersects `isDue`) and reschedules them; *free study* is
  practice over any deck and leaves box/due untouched. The gate lives in `grade`:
  `if(session.kind==='srs' && isDue(v.rank)) scheduleCard(...)`. The `isDue` guard is
  belt-and-suspenders — an SRS deck is already due-only, but it guarantees that even
  a non-due card can't be bumped up. Both kinds still append to `attempts`/`right`/
  `wrong` (so accuracy + leech detection cover free study too) — only the schedule
  is conditional. Don't "simplify" `grade` back to an unconditional `scheduleCard`;
  that's the exact behavior the two-kind split was added to fix. Legacy sessions
  saved before the split have no `kind` and are counted as SRS in the stats (the old
  behavior always rescheduled). The "Review due cards" banner is just a shortcut that
  sets `cfg.kind='srs'` + `status:['due']`.
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

## Change log — UX/design pass (this is the conversation record)

Commits, newest first (all on `main`; touch the split web/ files + `src/` where noted):

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
