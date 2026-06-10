# NEXT_STEPS — Japanese Verb Trainer (web study app)

What to do next, priority-ordered. Builds on the `OUTSTANDING WORK` block at the
top of [index.html](index.html); this file supersedes it where they disagree.
Architecture + dead-ends: [CLAUDE.md](CLAUDE.md). User overview: [README.md](README.md).

As of the mid-2026 push, **the entire original backlog has shipped** — what's left
is genuinely-deferred work (needs infra) and the eventual file split. Add new ideas
to the "Ideas / not yet scoped" section as they come up.

## Done (most recent first)
- ~~Add / edit / delete custom verbs (in-file #3)~~ — **shipped.** "Add verb" in
  Browse opens a modal; custom verbs persist in `jpverbs_custom` and merge into
  `DATA` (rebuildData) so they join the deck/filters/stats; CUSTOM badge + Edit/
  Delete on each. MAXRANK extends the rank filter past 100. Local-only (not synced).
- ~~A test suite for the pure core (in-file #8)~~ — **shipped.** `web/verbs-core.test.ts`
  extracts the inline `<script>` and runs it under a DOM stub (bun:test); covers
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
- **The split point (in-file #7).** Once `VERBS[]` / the feature set outgrows one
  file (now ~2200 lines), separate into `verbs.json` + `app.js` + `styles.css` and
  serve statically. The section banners make this mechanical. **Still not yet** —
  the single-file constraint (open anywhere, zero setup) is still paying for itself,
  and `web/verbs-core.test.ts` now guards the core through any future extraction.

## Ideas / not yet scoped
- **Conjugation drills.** The dataset has `type` (godan/ichidan/irregular) — enough
  to quiz て-form / past / negative / potential. A natural next study mode.
- **Romaji input** for typed-reading mode (currently kana only; `normKana` is
  deliberately not romaji-aware). Would need a romaji→kana table.
- **Export/import custom verbs** separately from progress (they're local-only today).
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
