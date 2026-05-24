# NEW_FEATURES.md

Backlog of features discussed in conversation but not yet shipped. Track the design decisions and rough complexity here so future-you (or a future agent) can pick one up and ship it without re-doing the planning conversation.

Loosely ordered by value within each section. Anything urgent should move to a real issue / commit branch — this is the parking lot.

See also [CLAUDE.md](CLAUDE.md) for architecture notes and dead-ends already explored, and [README.md](README.md) for the user-facing description of what's shipped today.

---

## Learning features

### Playback rate slider
**What**: 0.5x / 0.75x / 1x / 1.25x speed control for the IK sentence audio.

**Why**: native voice-actor audio is often too fast for N3-level listening. Slowing to 0.75x lets you parse the morphology before rebuilding to full speed.

**How**:
- New setting `playbackRate` (default 1.0, dropdown 0.5 / 0.75 / 1.0 / 1.25).
- Apply `audio.playbackRate = settings().playbackRate` after `audio.src` is set in `renderCard`'s audio block.
- The `<audio>` element supports this natively; no re-decode needed.

**Considerations**: Google TTS fallback audio sounds bad at <1x — could either accept that or skip the rate for TTS specifically. A per-card slider (in addition to the global setting) would be nice polish but not needed for v1.

### Click-to-lookup on sentence words
**What**: clicking a word in the IK sentence opens jisho.org (or similar) in a new tab.

**Why**: when an example sentence uses vocab above your level, you currently have to copy-paste the kanji into another tab. Removing that friction makes the IK example much more useful as a "vocab discovery" surface.

**How**:
- IK already returns `e.word_list` — a pre-segmented array of tokens for the sentence. No client-side tokenizer needed.
- Wrap each `word_list` token in a `<span>` inside `renderSentence` / `renderSentencePlain`. Click handler opens `https://jisho.org/search/<encodeURIComponent(word)>` in a new tab.
- Skip wrapping the target vocab word (already highlighted by the `<mark>`).
- Filter out single-particles (は, の, が, etc.) — clicking those isn't useful. Threshold: kanji-containing OR length ≥ 2.

**Considerations**: `e.word_list` segmentation quality varies. For sentences where it's clearly wrong, the spans still work, just with weird boundaries. Acceptable degradation.

### Pitch accent for the target word
**What**: show pitch-accent notation (e.g. `せいしゅん⓪` or a contour line) under the highlighted target word.

**Why**: pitch accent is one of WK's known gaps — they cover meaning and reading but not pitch. N2+ listening / production needs it.

**How**: requires an external data source. Options in order of effort:
- Bundle a static pitch-accent JSON for common N5–N3 vocab (~3000 entries, ~200KB). Kanjium-pitch data is CC-licensed.
- Query an online API (kanjium-pitch, jpdb.io, etc.) — adds a network dependency.
- Use a WKOF community pitch-accent script if one already exists; integrate via its API.

**Considerations**: heaviest feature in the backlog. Punt until the simpler ones are done. Licensing on bundled pitch data needs checking.

### JLPT-level filter for sentences
**What**: prefer (or hard-filter to) IK sentences whose vocabulary stays at-or-below a chosen JLPT level.

**Why**: a sentence about 青春 from Death Note that uses N1 grammar in surrounding clauses is less useful as a comprehension exercise than one from Doraemon that stays in N3 territory.

**How**:
- Need a JLPT vocab list (tanos.co.uk or jlpt-vocab-api). Bundle as a JSON map `{ word → minLevel }`.
- For each cached IK example, compute `maxJlptLevel(e.word_list)` once at cache-write time. Persist on the cached entry.
- New setting `jlptCeiling` (N5 / N4 / N3 / N2 / N1 / Any). In `pickExample`, filter pool to entries with max level ≤ ceiling. Fall back to unfiltered when empty (better to show *some* sentence than none).

**Considerations**: another external data dependency. Big payoff for N3 study though.

---

## UX polish

### Loading spinner during IK fetch
**What**: subtle CSS spinner / placeholder while the IK API call is in flight.

**Why**: between subject-change and the IK response (~100–500ms), the card area is empty header space. Mild but noticeable jank.

**How**:
- Render a placeholder card immediately on subject change (alongside `applyHostStyling()` in the `isNewSubject` branch).
- Replace with the real card in `getExamples(...).then(...)`.
- CSS-only spinner; no image / asset.

**Considerations**: keep it subtle — purple background, small / single-element. Don't compete with the vocab character for attention.

### Sentence picker (see all candidates)
**What**: a way to see all 10 cached IK sentences at once instead of cycling through them blindly with ⟳.

**Why**: refreshing past a bad sentence and not finding a better one is frustrating; seeing them at-a-glance lets you pick the best.

**How**:
- Long-press or right-click the ⟳ button → small overlay panel listing each sentence's preview text + source.
- Click an entry sets `state.sentenceIdx` directly (instead of incrementing).
- `persistCurrentSelection()` already handles persistence — no new storage code needed.

**Considerations**: pocket-sized overlay fits within the 280px header, or pop out below. Beware z-index against WK's own UI.

### Visible position counter on refresh buttons
**What**: visible "1/10" badge inline next to the ⟳ icons (currently only in the hover tooltip).

**Why**: the tooltip-only counter requires hovering to see; visible counter tells you at a glance whether you've cycled through everything yet.

**How**: small text badge ("1/10") rendered below or next to the ⟳, ~0.65em font.

**Considerations**: cramped real estate next to play / ふ / refresh-sentence in the left-controls row. Trade visibility for noise.

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

### Prefetch next-subjects in background
**What**: peek at WK's review queue and prefetch IK examples (+ images) for the next 1–2 subjects.

**Why**: every new subject currently has a visible empty-card moment while we fetch. Prefetching eliminates that for common cases.

**How**:
- `wkof.ItemData.get_items({ ... })` exposes the user's review queue.
- After current card renders, fire `getExamples(nextSlug)` for the next 1–2 slugs in the queue.
- Don't prefetch audio — too much bandwidth for marginal benefit.

**Considerations**: WK shuffles the queue, so "next" isn't guaranteed. Prefetch the next ~5 to cover shuffle uncertainty. Cache pressure isn't an issue — entries are small.

### Persist sentence selection by content hash, not index
**What**: when the user refreshes to sentence #3 for word X, persist by sentence-text hash instead of index.

**Why**: if IK adds/removes sentences for a word between sessions, index #3 might point to a different sentence than the one the user picked. Hash-based pinning survives.

**How**:
- `state.selections[<word>]` becomes `{ sentenceHash: '<hash>', imageIdx: N }`.
- On load, search `cached.raw` for an entry whose `sentence` hashes to the saved value; fall back to index 0 if none found.

**Considerations**: existing selections are index-based and would need migration. Bump `CACHE_SCHEMA_VERSION` so old selections wipe — accept that as a one-time UX cost.

### IK outage circuit-breaker
**What**: when `/index_meta` or `/search` has failed N times recently, stop calling them for a cooldown and serve fallbacks immediately.

**Why**: when IK is down, every new subject hits a long timeout before falling back to TTS / DDG. Bad UX during outages.

**How**:
- Track `{ count, lastFailedAt }` in module state.
- On each failed request, increment count and timestamp.
- If count > 3 within the last 5 minutes, skip the IK call for the next 10 minutes — go straight to fallback.
- Auto-recover by resetting count after the cooldown window.

**Considerations**: should be invisible — no user-visible setting. Log to console on circuit-break activation so we can see it during debugging.

---

## Speculative / parking lot

Stuff that came up but isn't a clear win yet. Don't pick these up without first deciding whether the problem they solve is actually annoying enough.

- **Multiple sentences per card** — show 2 alongside instead of 1. Real estate is tight in the 280px header band.
- **Translation-language switcher** — IK returns German / French / Spanish translations alongside English. Useful for non-English natives but the maintainer is English-native.
- **Source-attribution blocklist** — skip examples from specific anime / categories. Easy if you ever hit a deck you really dislike; otherwise low-value.
- **Per-card image-source label** — "From The Girl Who Leapt Through Time" overlay on the IK screenshot. Helps you decide whether to refresh.
- **Sentence-listened-to tracking** — heatmap-style record of which sentences you've encountered, to bias picks toward novel ones.
- **Export starred sentences to Anki** — `.apkg` builder. Would need a sentence-starring UI first.
- **Dark-mode adaptation** — if WK ever ships a true dark theme, our white-on-purple shadow tuning won't translate. Punt until WK changes.
- **Configurable hotkey for "next sentence"** — like `P` for play, but for ⟳. Add only if the user actually wants it.
