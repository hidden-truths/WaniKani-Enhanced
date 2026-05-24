# NEW_FEATURES.md

Backlog of features discussed in conversation but not yet shipped. Track the design decisions and rough complexity here so future-you (or a future agent) can pick one up and ship it without re-doing the planning conversation.

Loosely ordered by value within each section. Anything urgent should move to a real issue / commit branch — this is the parking lot.

See also [CLAUDE.md](CLAUDE.md) for architecture notes and dead-ends already explored, and [README.md](README.md) for the user-facing description of what's shipped today.

---

## Learning features

### Click-to-lookup on sentence words
**What**: clicking a word in the IK sentence opens jisho.org (or similar) in a new tab.

**Why**: when an example sentence uses vocab above your level, you currently have to copy-paste the kanji into another tab. Removing that friction makes the IK example much more useful as a "vocab discovery" surface — especially now that the picker exposes 100s of sentences instead of the original 10.

**How**:
- IK already returns `e.word_list` — a pre-segmented array of tokens for the sentence. No client-side tokenizer needed.
- Wrap each `word_list` token in a `<span>` inside `renderSentence` / `renderSentencePlain`. Click handler opens `https://jisho.org/search/<encodeURIComponent(word)>` in a new tab.
- Skip wrapping the target vocab word (already highlighted by the `<mark>`).
- Filter out single-particles (は, の, が, etc.) — clicking those isn't useful. Threshold: kanji-containing OR length ≥ 2.
- Apply the same treatment to picker rows so users can preview vocab without committing to a sentence.

**Considerations**: `e.word_list` segmentation quality varies. For sentences where it's clearly wrong, the spans still work, just with weird boundaries. Acceptable degradation.

### Show JLPT badge on the review card itself
**What**: the picker rows display a small colored JLPT chip per sentence (N5 green → N1 purple, "?" grey for unknown). Show the same chip on the actual review card next to the sentence.

**Why**: lets the user see the difficulty rating of the currently-shown sentence without opening the picker. Useful feedback that the preferred-level filter is doing the right thing.

**How**:
- The `formatExample` shape returned by `pickExample` doesn't currently carry `_jlptMax` — extend it to include the level number.
- Add a small `<span class="wk-ik-card-badge lvl-nX">` next to the sentence text in `renderCard`. Reuse the picker badge CSS for color consistency.
- Position: inline-end of the sentence row, vertically centered with the play / refresh / furigana controls. Or stacked above the play button.

**Considerations**: minor visual real estate change in the already-tight 280px header. Test that it doesn't push the controls onto a second line at narrow viewports.

### Pitch accent for the target word
**What**: show pitch-accent notation (e.g. `せいしゅん⓪` or a contour line) under the highlighted target word.

**Why**: pitch accent is one of WK's known gaps — they cover meaning and reading but not pitch. N2+ listening / production needs it.

**How**: requires an external data source. Options in order of effort:
- Bundle a static pitch-accent JSON for common N5–N3 vocab (~3000 entries, ~200KB). Kanjium-pitch data is CC-licensed.
- Query an online API (kanjium-pitch, jpdb.io, etc.) — adds a network dependency.
- Use a WKOF community pitch-accent script if one already exists; integrate via its API.

**Considerations**: heaviest feature in the backlog. Punt until the simpler ones are done. Licensing on bundled pitch data needs checking.

---

## Picker / UX polish

### Filter input inside the picker
**What**: a text input at the top of the picker that narrows the visible rows to matching sentences/translations as the user types.

**Why**: with the picker now showing up to ~500 sentences for common words, pagination alone gets tedious for "find a sentence that mentions X." A find-as-you-type filter cuts that to a few keystrokes.

**How**:
- Add `<input type="text" placeholder="Filter…">` in the picker header. Bind `input` event.
- Filter applies on top of the current sort: `sortedPool.filter(e => sentence.includes(query) || translation.includes(query))`.
- Reset pagination to page 0 on each query change.
- Hint: case-insensitive English match (`.toLowerCase()`), exact-substring for Japanese.

**Considerations**: small new state field (`pickerState.filter`). Don't auto-focus the input — focus would steal keyboard navigation from WK's answer input if the picker were ever opened mid-review with input still focused. Manual focus only.

### Persist picker sort across opens
**What**: remember which sort the user last selected (per-session in memory, optionally per-user via settings).

**Why**: a user who always sorts by "source A→Z" has to re-select it every time. Trivial QoL.

**How**:
- Module-level `state.lastPickerSort = null`.
- `applySort()` writes to it; `renderSentencePickerOverlay()` reads it as the initial sort, falling back to `'preferred'` (if jlptPreferred is set) or `'default'`.
- No persistence to disk — session-scoped is enough.

**Considerations**: when jlptPreferred changes mid-session, the saved sort might no longer be valid (e.g., user picked `preferred` last time, then unset jlptPreferred). Detect and fall back to `default`.

### Long-press the sentence text to open the picker
**What**: an additional picker trigger — long-press on the sentence text itself, not just the ⟳ button.

**Why**: more discoverable than the small ⟳ button. The sentence is the largest UI element on the card; long-press feels natural.

**How**:
- Mirror the existing long-press handler from `sentenceRefreshBtn` onto `sentenceEl`. Reuse the same `lastLongPressAt` debounce mechanism scoped per-card.
- Note: contextmenu on the sentence text might fight with browser text-selection menus. Skip the contextmenu trigger here; keep just long-press.

**Considerations**: feature-flag-worthy — could surprise users who expect to long-press for text selection. Maybe pair with the click-to-lookup feature so single-tap = lookup, long-press = picker, and there's a consistent gesture language.

### Settings dialog tabs
**What**: split the settings form across multiple WKOF tabs (Behavior / Selection / Cache) instead of one long scrolling form.

**Why**: as the settings list grows, scrolling within a dialog feels clunky. WKOF supports `tabs: {…}` natively.

**How**:
- Restructure the `content:` object in `openSettings()` from one `page` to a top-level `tabs: { behavior: {…}, selection: {…}, cache: {…} }`.
- Move dropdowns/checkboxes into their respective tabs.

**Considerations**: the existing scroll-cap CSS becomes mostly redundant once tabs split the height — but leave it as defense-in-depth (some tabs may still be tall).

---

## Coverage expansion

### Kanji-review support
**What**: when you encounter a single-kanji subject (not a vocab), show example vocab words that contain it.

**Why**: roughly half of WK's reviews are kanji-only. They're currently no-ops for this script.

**How**:
- Detect kanji subjects in `getCurrentSubject()` / `isVocab()` — already classified, just take the kanji branch.
- Query IK with the kanji as `q` (works — returns sentences containing that kanji).
- Card layout differs: more useful to show a *list* of compound vocab using the kanji than one sentence. Maybe pull from WKOF item data instead of IK.

**Considerations**: kanji header uses the same `.character-header` host, so styling integration is similar. Content semantics differ — different card layout component needed.

### Lesson-page support
**What**: same IK card shown during WK lessons (`/subjects/lesson/...`), not just reviews.

**Why**: lessons are where you first learn the meaning + reading. Seeing the example sentence at *this* stage is more pedagogically valuable than at review time.

**How**:
- Extend `@match` directive and `registerListeners` to fire on lesson URLs.
- Lessons don't have the "answer graded" reveal trigger — content is just shown directly. May want a different reveal strategy (e.g., reveal everything immediately, since there's no testing context to spoil).

**Considerations**: WK's lesson DOM is structurally different from reviews. Probably needs its own `handleLessonChange` analogue. Investigate selectors first.

### Extra-study + self-study modes
**What**: support WK's Extra Study URL (`/subjects/extra_study/...`) and/or a standalone "drill these vocab" panel.

**Why**: lets users drill specific vocab outside the SRS queue.

**How**: similar to lesson support — extend match patterns and DOM detection. Self-study panel would need its own UI surface.

---

## Robustness & perf

### Persist sentence selection by content hash, not index
**What**: when the user picks sentence #37 for word X via the picker, persist by sentence-text hash instead of index.

**Why**: **more pressing than it was.** With the v0.24.0 bump from 10 → 1000 sentences cached per word, the pool is much larger and the sort changed (preferred-first compound). An `s: 37` saved from one version can point to a completely different sentence after a settings change or schema bump. Hash-based pinning survives all of that.

**How**:
- `state.selections[<word>]` becomes `{ sentenceHash: '<hash>', imageIdx: N, b: bool }`.
- On load, search `cached.raw` for an entry whose `sentence` hashes to the saved value; fall back to index 0 if none found.
- `applySavedSelection` also needs to convert hash → index against the current pool so the rest of the code (which uses `state.sentenceIdx`) doesn't need to change.

**Considerations**: existing selections are index-based and would need migration. Bump `CACHE_SCHEMA_VERSION` so old selections wipe — accept that as a one-time UX cost. Alternative: write both fields during a transition window, prefer hash on read.

### IK outage circuit-breaker
**What**: when `/index_meta` or `/search` has failed N times recently, stop calling them for a cooldown and serve fallbacks immediately.

**Why**: when IK is down, every new subject hits a long timeout before falling back to TTS / DDG. Bad UX during outages.

**How**:
- Track `{ count, lastFailedAt }` in module state.
- On each failed request, increment count and timestamp.
- If count > 3 within the last 5 minutes, skip the IK call for the next 10 minutes — go straight to fallback.
- Auto-recover by resetting count after the cooldown window.

**Considerations**: should be invisible — no user-visible setting. Log to console on circuit-break activation so we can see it during debugging.

### Storage cap / LRU eviction for the sentence cache
**What**: cap total sentence-cache size (e.g. 50MB) and evict least-recently-used entries when over.

**Why**: with 1000 sentences cached per word and ~500 sentences for common words, a heavy user could accumulate 100MB+. IndexedDB doesn't have hard limits but browser quotas (and patience) do.

**How**:
- Track `lastAccessedAt` on each `wk-ik-examples.ik.<word>` entry (write-through on every read).
- Periodically (on settings open, or on every Nth review) run a sweep: if `measureCacheSizes().examples > THRESHOLD`, delete the LRU entries until under threshold.
- Surface in the settings cache section: "Auto-evicted N entries at limit Y MB."

**Considerations**: only matters for prolific users. The "Clear cache" button is already there for the nuclear option. Defer until someone complains.

---

## Speculative / parking lot

Stuff that came up but isn't a clear win yet. Don't pick these up without first deciding whether the problem they solve is actually annoying enough.

- **Multiple sentences per card** — show 2 alongside instead of 1. Real estate is tight in the 280px header band.
- **Translation-language switcher** — IK returns German / French / Spanish translations alongside English. Useful for non-English natives but the maintainer is English-native.
- **Source-attribution blocklist** — skip examples from specific anime / categories. Easy if you ever hit a deck you really dislike; otherwise low-value.
- **Per-card image-source label on the card itself** — "From The Girl Who Leapt Through Time" overlay on the IK screenshot. Picker already shows it; the card doesn't.
- **Sentence-listened-to tracking** — heatmap-style record of which sentences you've encountered, to bias picks toward novel ones. More valuable now that the per-word pool is huge.
- **Export starred sentences to Anki** — `.apkg` builder. Would need a sentence-starring UI first.
- **Dark-mode adaptation** — if WK ever ships a true dark theme, our white-on-purple shadow tuning won't translate. Punt until WK changes.
- **Configurable hotkey for "next sentence"** — like `P` for play, but for ⟳. Add only if the user actually wants it.
- **Per-card JLPT-ceiling override toggle on the card** — a small button next to the source attribution that flips `bypassCeilingForCurrentSubject` without opening the picker. Could be useful for "I want to see harder sentences for this one word" without committing through the picker.
