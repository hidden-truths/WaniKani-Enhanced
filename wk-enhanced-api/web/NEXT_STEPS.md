# NEXT_STEPS — Japanese Verb Trainer (web study app)

What to do next, priority-ordered. Builds on the `OUTSTANDING WORK` block at the
top of [index.html](index.html); this file supersedes it where they disagree.
Architecture + dead-ends: [CLAUDE.md](CLAUDE.md). User overview: [README.md](README.md).

As of the mid-2026 push, **the entire original backlog has shipped** plus the file
split, custom-verb sync, and Google TTS — what's left is one genuinely-deferred item
(needs email infra). Add new ideas to "Ideas / not yet scoped" as they come up.

## Done (most recent first)
- ~~みんなの日本語: iTalki tag + Source filter + lessons 22 & 24~~ — **shipped.** An
  `italki:true` flag in the lesson JSON marks words covered in the maintainer's iTalki
  lessons (all of L23, from `~/Downloads/lesson23_vocab.txt`); activated cards gain an
  `iTalki` tag + flag and a vocab-table badge. A new **`source` filter facet** (a sixth
  AND'd facet: みんなの日本語 / iTalki / per-lesson `L22·L23·L24`) studies any provenance
  slice from the normal deck — hidden until the deck has Minna cards, chips tinted to
  match the badges. Re-activation now PATCHES metadata (the button shows "Update N tags")
  so already-added cards pick up the iTalki tag without a delete/re-add. Browse cards
  decluttered (provenance badge replaces the redundant みんなの日本語/lesson tag chips).
  **Lessons 22 (noun-modifying clauses) and 24 (giving & receiving)** curated from the
  scraper into `data/minna/lesson-<n>.json`. The Minna roadmap (Phase 2, furigana, …)
  still lives in [MINNA.md](MINNA.md). Verified live; 25 web-core tests (4 new).
- ~~みんなの日本語 dashboard (Chapter 23)~~ — **shipped.** A 4th, **account-gated** tab:
  a Minna no Nihongo lesson dashboard (vocab with native audio, grammar, example
  sentences, conversation) fetched at runtime from `/v1/minna/*` (signed-in only — the
  copyrighted content never reaches anon visitors). Vocab "activates" into the SRS deck
  as tagged custom cards (`みんなの日本語` + `mnn-l<n>`, dictionary form); per-lesson notes
  sync under the new `minna` app key. Content is curated in `data/minna/lesson-23.json`
  from the `scripts/scrape-minna.ts` extractor. Verified end-to-end (gated 401s, render,
  audio proxy+cache, deck merge, notes sync) desktop + mobile. See the みんなの日本語
  dead-end in [CLAUDE.md](CLAUDE.md). **Next: Phase 2** (record-and-compare, below).
- ~~Multi-category content (de-verb-ify, the UI half)~~ — **shipped.** A `cat` filter
  facet (`verb/adjective/noun/adverb/phrase`) leads both filter panels as a fifth
  AND'd facet; the Type + Transitivity rows are `.verb-only` and hide (`syncVerbRows`)
  when the category excludes verbs. The add-card modal gained a Category picker —
  `syncVerbFields` shows Type for verbs+adjectives (い/な = `i-adj`/`na-adj`) and
  Transitivity for verbs only. `cardStamp`/`colorClass` paint per-category spine +
  hanko stamp (teal/amber/rose/slate accents); `annotateCatChips` dims empty
  categories. Tests added. **Remaining transition work** (now the only "Ideas" item
  with teeth): conjugation drills, and proofed built-in non-verb *content* — the
  dataset is still 100 verbs; categories are a capability users populate.
- ~~Design-polish pass (4 commits)~~ — **shipped.** (1) Responsive/bug fixes: mobile
  toolbar wrap, modal-× pin, empty-session → picker, ≥40px tap targets. (2) Readability:
  `--muted` darkened to AA, chart titles de-uppercased (uppercase = short labels only),
  bigger small labels. (3) Chip/picker: tinted (not solid-ink) active chips, secondary
  rows collapsed behind a "More filters & options" `<details>`. (4) Motion: reveal /
  card-advance / modal / tab / stats / bar entrance animations + press feedback, all
  gated by `prefers-reduced-motion` (which now kills `animation` too).
- ~~Free study advances due cards (setting)~~ — **shipped.** New `freeReviewDue`
  setting (default on): grading an already-due card in free study advances its SRS
  schedule; not-due cards are still never touched. Gate in `grade`.
- ~~Header click/select bug~~ — **fixed.** The inline SVG sprite was hidden via
  `width="0" height="0"` attributes, which the global `svg{width:100%;height:auto}`
  chart rule overrode → a full-width invisible overlay over the header in
  Firefox/Safari (height:auto → ~150px there). Now hidden via inline style.
- ~~De-verb-ify groundwork~~ — **shipped (partial, by design).** Renamed to
  日常日本語 / "Japanese Trainer", dropped "verbs-only" framing from the headers/
  empty-states, and tagged every card with `cat:'verb'` (`attachLevels` default +
  `saveVerb`). The verb-conjugation UI (Type filter, Add-verb modal, `type` field)
  is still verb-shaped — finishing that is the "multi-category content" idea below.
- ~~Jisho dictionary links~~ — **shipped.** Each card links out to
  `https://jisho.org/word/<headword>` (`jishoUrl`): on the flashcard answer side
  and in the Browse detail modal, opening in a new tab. New `i-external` icon.
- ~~SRS vs free study~~ — **shipped.** "Study type" picker toggle (`cfg.kind`):
  free study practices any deck and never changes review dates; SRS review serves
  only due cards and reschedules them. `grade` only reschedules when
  `kind==='srs' && isDue` (so an early review can't promote a card). Sessions are
  tagged with `kind` (local + the durable `details.kind`); Stats shows separate
  SRS-reviews / Free-study-reviews counts (with per-kind accuracy on hover).
- ~~Romaji typed input~~ — **shipped.** Typed-reading mode now accepts romaji:
  `romajiToKana` (greedy Hepburn + wāpuro variants, sokuon/ん handling) folds the
  input to hiragana before the `normKana` compare. Kana/IME typists are unaffected
  (non-romaji passes through). Tests in `verbs-core.test.ts`.
- ~~Visual SRS box indicator~~ — **shipped.** The Browse detail modal's
  "Box N · next review" text is now a 5-segment Leitner track (lit pips in
  `BOX_COLORS` maturity tones) + box number + a "next review" chip that flips red
  ("due now") when due. `detailMemoryLine`.
- ~~Upcoming-review forecast~~ — **shipped.** Study panel "Upcoming reviews" card:
  a vertical-bar timeline of how many scheduled cards come due, with a
  24h/Week/Month/Year horizon toggle (`reviewForecast`/`renderForecast`,
  refreshed from `updateDueBanner`). Tests for the bucketing.
- ~~Browse detail modal~~ — **shipped.** Clicking a Browse card opens a modal (not an
  inline expand); Mnemonic/Trap/Examples are collapsible, examples JLPT-level-filtered.
- ~~Settings page (DB-backed)~~ — **shipped.** Toolbar gear → modal: default example
  level, furigana show/hide, default answer mode, audio. Stored in `jpverbs_settings`,
  synced as app `settings`. Furigana is a global `<html data-furigana>` CSS flip.
- ~~More grading keys~~ — **shipped.** After reveal: Space/Enter/2 = correct, X/1 = wrong.
- ~~Durable session history~~ — **shipped.** Append-only `study_sessions` table +
  `POST /v1/sessions`; `endSession` logs every session so nothing is lost beyond the
  capped local `store.sessions` (now 1000, charts only). A GET/aggregate view is a
  future add — the data is already captured.
- ~~Leveled example sentences~~ — **shipped.** `examples.js` (`EXAMPLES`) holds five
  JLPT tiers (N5→N1) per built-in verb. Answer-side N5–N1 selector (`renderExample`,
  pref `jpverbs_exlevel`) + Browse leveled list; `exampleForLevel`/`availableTiers`
  with fallback to `ex`; tests in `verbs-core.test.ts`. Sentences are model-generated
  + format-validated (see the dead-end in CLAUDE.md) — worth a human proofread pass.
- ~~The file split (in-file #7)~~ — **shipped.** index.html → index.html + styles.css
  + verbs.js + app.js, classic scripts (not modules) so `file://` still works; the
  server serves the three new assets statically. `verbs-core.test.ts` concatenates
  verbs.js + app.js.
- ~~Google TTS~~ — **shipped.** `GET /v1/tts` proxies Google Translate TTS (cached);
  `speak()` plays it via `<audio>` when served over http, falling back to Web Speech
  over `file://` or on failure. Replaces the uneven browser speechSynthesis voices.
- ~~Cloud-sync custom verbs~~ — **shipped.** Second synced blob (server `app` key
  `custom-verbs`); add/edit/delete propagate (removals too); server wins on login.
- ~~Add / edit / delete custom verbs (in-file #3)~~ — **shipped.** "Add verb" in
  Browse opens a modal; custom verbs persist in `jpverbs_custom` and merge into
  `DATA` (rebuildData) so they join the deck/filters/stats; CUSTOM badge + Edit/
  Delete on each. MAXRANK extends the rank filter past 100.
- ~~A test suite for the pure core (in-file #8)~~ — **shipped.** `web/verbs-core.test.ts`
  concatenates verbs.js + app.js and runs them under a DOM stub (bun:test); covers
  passes/facets/scheduleCard/isDue/rollingAcc/isLeech/normKana/filterSummary.
- ~~Category vs Semantic as separate AND'd facets (in-file #2)~~ — **shipped.** Four
  AND'd facets (type/trans/topic/status) via `wireFacets` + `TOKEN_FACET`; "Godan +
  Motion" now intersects. Single "All" chip clears all facets.
- ~~Stats line charts too basic~~ — **shipped.** Axis caption, dashed average line,
  per-point value labels, area fill, `<title>` hover readouts, theme-aware gridlines.
- ~~Sign-up banner timing~~ — **shipped.** Deferred from first paint to after the
  first completed session (`maybeShowSignup`).
- ~~JLPT N2/N1 near-empty filters (in-file #5)~~ — **shipped.** `annotateJlptChips`
  disables (dims) levels with zero verbs + tooltips counts; roving nav skips them.
- ~~Rate limiting on `/v1/auth/*`~~ — **shipped (server).** Per-IP in-memory limiter
  ([../src/lib/rateLimit.ts](../src/lib/rateLimit.ts)): login 20/15min, register
  8/hr → `429 {code:'rate_limited'}` + Retry-After.
- ~~Typed-reading mode + TTS (in-file #1)~~ — **shipped.** Input toggle auto-grades
  typed kana (`normKana`/`submitTyped`, advisory verdict); Audio toggle + speaker
  buttons play the reading via `speechSynthesis`. Prefs persist.
- ~~Keyboard navigation for chip groups (in-file #4)~~ — **shipped.** `setupRoving`
  roving-tabindex per `.chips`/`.topic-inner`; arrows/Home/End, role=group + labels.
- ~~ARIA radiogroup semantics for single-select chip rows~~ — **shipped.** Study
  type / Test direction / Input / Audio / Order declare `role="radiogroup"` in the
  markup; `setupRoving` makes their chips `role=radio` with synced `aria-checked`
  and arrows move the SELECTION (not just focus). Multi-select facet rows stay
  `role=group` toolbars. See the roving dead-end in [CLAUDE.md](CLAUDE.md).
- ~~Accounts + cloud sync (in-file #6)~~ — **shipped.** Email/password + debounced
  cross-device sync (`/v1/auth/*` + `/v1/progress/verbs`).
- ~~Filter wall / misaligned rows / no icons / endless bar wall / blocking modal~~ —
  all shipped (`.frow`/`.chips` layout, SVG sprite, worst-20 cap, inline banner).

## Deferred (needs infra — intentionally not done)
- **Password reset / email verification (server).** A forgotten password currently
  means a new account. Needs an outbound-email provider + secrets, not worth
  provisioning until the app has real users. Tracked in [../CLAUDE.md](../CLAUDE.md)
  "What's deliberately NOT in v1."

## Ideas / not yet scoped
- **みんなの日本語 (Minna no Nihongo) dashboard.** Its full roadmap — Phase 2
  (record-and-compare), more lessons/sections, a Browse source filter, furigana — lives
  in its own dedicated doc: [MINNA.md](MINNA.md) "Roadmap / next steps".
- **Built-in non-verb content.** The category *capability* shipped (filters, modal,
  per-category stamps/spines), but the 100 baked-in cards are all verbs — users add
  non-verbs themselves. A curated set of common adjectives/nouns/adverbs in `verbs.js`
  (+ leveled examples in `examples.js`) would make the categories useful out of the
  box. Rename the `VERBS`/`verbs.js` internals only if/when it stops being mostly verbs.
- **Conjugation drills.** The dataset has `type` (godan/ichidan/irregular) — enough
  to quiz て-form / past / negative / potential. A natural next study mode.
- **Custom-verb sync conflict handling.** Today it's last-write-wins + server-wins on
  login (fine for one user); two devices adding verbs offline could collide on a
  `seq`-assigned rank. A UUID-per-verb id would remove the collision if it matters.

## Verification notes
- Browse + Stats were verified at desktop width (1280) and mobile (390): label
  alignment, search-icon field, dimmed N2/N1, leech list, enhanced charts, and the
  ≤640px label-stacking all confirmed via screenshot. The earlier "capture real wide
  screenshots" debt is closed.
- Preview tooling reloads the tab on capture (resets in-memory state) — verify
  transient state (open modal, applied filters, seeded stats) via DOM `eval`, not a
  follow-up screenshot. See the dead-end note in [CLAUDE.md](CLAUDE.md).
