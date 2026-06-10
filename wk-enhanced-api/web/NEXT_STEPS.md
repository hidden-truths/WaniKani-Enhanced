# NEXT_STEPS — Japanese Verb Trainer (web study app)

What to do next, priority-ordered. Builds on the `OUTSTANDING WORK` block at the
top of [index.html](index.html); this file supersedes it where they disagree.
Architecture + dead-ends: [CLAUDE.md](CLAUDE.md). User overview: [README.md](README.md).

## Done since the in-file list was written
- ~~"localStorage only / no cloud sync" (in-file OUTSTANDING #6)~~ — **shipped.**
  Email/password accounts + debounced cross-device sync exist (`CLOUD ACCOUNTS +
  SYNC` section; `/v1/auth/*` + `/v1/progress/verbs`). The in-file comment was
  updated to match.
- ~~Filter "wall of text"~~ — regrouped into Type / Transitivity / Topic
  (collapsible) / Level & rank tiers; segmented JLPT; Leeches pulled out.
- ~~Misaligned filter rows~~ — fixed via the `.frow`/`.chips` label-column layout.
- ~~No icons~~ — inline SVG sprite applied site-wide.
- ~~Endless per-card bar wall~~ — capped to worst-20 with a show-all toggle.
- ~~Blocking first-visit modal~~ — now a dismissible inline sign-up banner.
- ~~Typed-reading mode + TTS (in-file #1)~~ — **shipped.** Flashcard "Input" toggle
  (Self-graded / Type the reading) auto-grades typed kana via `normKana` +
  `submitTyped`; advisory verdict with 1/2 typo-override. "Audio" toggle +
  `.speak-btn` (flashcard + every Browse card) play the reading via
  `speechSynthesis` (`speak`/`playReading`, ja-JP voice). Prefs persist
  (`jpverbs_input` / `jpverbs_audio`); Audio controls hide when no speechSynthesis.

## Verification debt (do first — cheap, closes a known gap)
- **Capture real desktop screenshots of Browse + Stats.** The preview tooling kept
  reloading to the default tab on capture, so those two panels at desktop width
  were verified by DOM measurement + parity with the Study panel, not a fresh
  wide screenshot. Open locally at a wide viewport and eyeball: Browse label
  alignment + search-icon field; Stats leech-list cards + the worst-20 toggle.
  Mobile (≤640px) stacks filter labels — sanity-check that too.

## High value
1. **Keyboard navigation for chip groups** (accessibility, in-file #4). Now that
   chips live in discrete `.frow > .chips` tracks, a roving-tabindex per group is
   much more tractable than before. Also: class is still partly conveyed by color
   (mitigated by the text stamp, not eliminated).
2. **Category vs Semantic as separate AND'd facets** (in-file #2). The most common
   point of confusion. Needs a second selection set + a small `passes()` change;
   the tiered UI rows already exist, so the visual work is done.

## Medium
3. **A test suite for the pure core** (in-file #8). `passes()`, `scheduleCard()`,
   `isDue()`, `rollingAcc()`, `isLeech()`, `filterSummary()`, and the new `normKana()`
   are pure and easy to test. This is the logic future refactors break silently.
   Would need a tiny extraction or a headless harness (keep it dependency-light).
4. **Add / edit verbs** (in-file #3). Verbs are baked into `VERBS[]`; a form that
   writes user verbs to localStorage and merges them with `DATA` at load makes
   this a living deck.
5. **Auth niceties (server-side).** No password reset / email verification yet — a
   forgotten password currently means a new account. No origin-side rate limiting
   on `/v1/auth/*`. Tracked in [../CLAUDE.md](../CLAUDE.md) "What's deliberately
   NOT in v1."

## Polish / smaller
- **Stats line charts** are intentionally basic (hand-rolled SVG); axis labels /
  legends / hover readouts would help. Keep them dependency-free.
- **Sign-up banner copy / timing** — currently shows on first visit for empty
  stores; consider deferring to *after* the first session instead.
- **JLPT N2/N1 filters are near-empty** (in-file #5) — the 100 most frequent verbs
  are almost all N5–N4. Cosmetic; maybe disable/annotate the empty levels.

## The split point (when the file outgrows one document)
In-file #7: once `VERBS[]` or the feature set grows past comfort (~1700 lines and
climbing), separate into `verbs.json` + `app.js` + `styles.css` and serve them
statically. The in-file section banners are drawn to make this mechanical. Not
yet — the single-file constraint is still paying for itself.

## Housekeeping
- **`.claude/launch.json`** (repo root) is currently untracked. It defines the
  `wk-enhanced-api` preview/run config used to drive the browser during this work.
  Commit it if you want `/run` + the preview panel to pick the server up
  automatically; otherwise leave it local.
