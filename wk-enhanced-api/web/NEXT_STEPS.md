# NEXT_STEPS — Japanese Verb Trainer (web study app)

What to do next, priority-ordered. Builds on the `OUTSTANDING WORK` block at the
top of [index.html](index.html); this file supersedes it where they disagree.
Architecture + dead-ends: [CLAUDE.md](CLAUDE.md). User overview: [README.md](README.md).

As of the mid-2026 push, **the entire original backlog has shipped** plus the file
split, custom-verb sync, and Google TTS — what's left is one genuinely-deferred item
(needs email infra). Add new ideas to "Ideas / not yet scoped" as they come up.

## Done (most recent first)
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
- **Conjugation drills.** The dataset has `type` (godan/ichidan/irregular) — enough
  to quiz て-form / past / negative / potential. A natural next study mode.
- **Custom-verb sync conflict handling.** Today it's last-write-wins + server-wins on
  login (fine for one user); two devices adding verbs offline could collide on a
  `seq`-assigned rank. A UUID-per-verb id would remove the collision if it matters.
- **ARIA radiogroup semantics** for the single-select chip rows (mode/input/audio/
  order) — currently toolbar semantics (arrows move focus, Space/Enter selects).

## Verification notes
- Browse + Stats were verified at desktop width (1280) and mobile (390): label
  alignment, search-icon field, dimmed N2/N1, leech list, enhanced charts, and the
  ≤640px label-stacking all confirmed via screenshot. The earlier "capture real wide
  screenshots" debt is closed.
- Preview tooling reloads the tab on capture (resets in-memory state) — verify
  transient state (open modal, applied filters, seeded stats) via DOM `eval`, not a
  follow-up screenshot. See the dead-end note in [CLAUDE.md](CLAUDE.md).
