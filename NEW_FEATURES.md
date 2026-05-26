# NEW_FEATURES.md

Backlog of features discussed in conversation but not yet shipped. Track the design decisions and rough complexity here so future-you (or a future agent) can pick one up and ship it without re-doing the planning conversation.

Loosely ordered by value within each section. Anything urgent should move to a real issue / commit branch — this is the parking lot.

See also [CLAUDE.md](CLAUDE.md) for architecture notes and dead-ends already explored, [README.md](README.md) for the user-facing description of what's shipped today, [SERVER_DESIGN.md](SERVER_DESIGN.md) and [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) for the server, and [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md) for the plan to wire the userscript up to the server.

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

## Server-side improvements

These are ideas for the [wk-enhanced-api](wk-enhanced-api/) server. Most exist *because* there's a server now — they're things the userscript can't do well or at all on its own (heavy preprocessing, large datasets, cross-user pooling of data fetches). See [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) for the current architecture.

### ~~Deploy the server publicly~~ — DONE (2026-05-25)

The first production deploy landed at `https://api.wkenhanced.dev` on DO (SFO3, $7/mo Premium AMD droplet + Spaces) with Cloudflare Tunnel in front. See [wk-enhanced-api/deploy/README.md](wk-enhanced-api/deploy/README.md) for the install recipe (updated post-deploy to capture every workaround). Phase 2 (default-on) shipped as userscript v1.1.1; Phase 3 (server-only + legacy snapshot + rename) shipped as v2.0.0 (see [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md)).

### Dockerize the server — **active (post-2026-05-25 session)**

This is the project the maintainer is starting now. Pulled out of the backlog into [NEXT_STEPS.md](NEXT_STEPS.md) "Active project" so the spec below stays in one place but it's clear it's no longer queued.

**What**: ship a `Dockerfile` + `docker-compose.yml` so the server runs as a container on the droplet, not as a host-installed Bun binary. Optionally publish images to GitHub Container Registry on every commit.

**Why**: today's deploy chains together a half-dozen host-level concerns (Bun installer, `useradd wkenhanced`, `chown`, systemd unit, `chmod 600` on env file, copy bun to `/usr/local`). A container collapses all of that to "pull image + docker compose up." Future deploys to a new droplet drop from ~30 minutes to ~5 minutes. Also gives us:
- **Reproducibility**: Bun version pinned in the image instead of "whatever the installer pulled."
- **Rollback**: `docker compose down && docker pull <previous> && docker compose up` beats `git checkout && bun install`.
- **Dev/prod parity**: contributors run an identical container locally.
- **Cleaner secret handling**: Docker secrets / Compose env files instead of `/etc/wk-enhanced-api/env`.

**How**:
- `Dockerfile`: `FROM oven/bun:1.3` (official image), `COPY package.json bun.lockb ./`, `bun install --production`, `COPY src/ src/`, `COPY data/ data/`, `CMD ["bun", "run", "start"]`. Multi-stage build to drop dev deps from the final image.
- `docker-compose.yml`: one service, mount `/var/lib/wk-enhanced-api` (SQLite + media-if-local) and `/etc/wk-enhanced-api/env` (env), expose `3000` to localhost only (Cloudflare Tunnel reaches it the same as today).
- CI: GitHub Actions builds + publishes on tag, droplet pulls latest. Optional but tightens the loop.

**Considerations**: SQLite needs a writable bind-mount; that's straightforward but worth testing under WAL concurrency. `Bun.S3Client` is bundled in Bun; no separate AWS SDK to install. The systemd unit becomes a thin wrapper that runs `docker compose up`. Cloudflare Tunnel stays host-side (no need to containerize it). **Don't migrate to DO App Platform** — its filesystem is ephemeral, which would force a Postgres switch (= +$15/mo). The point of containerizing is operational hygiene, not platform migration.

**Effort**: half a day, including the Compose file + deploy README rewrite + verifying the SQLite + Spaces paths still work under the bind-mount.

### DOKS / Kubernetes — **ADR shipped 2026-05-25**

Written up as [wk-enhanced-api/docs/decisions/ADR-001-no-kubernetes.md](wk-enhanced-api/docs/decisions/ADR-001-no-kubernetes.md) — captures the cost analysis ($24/mo control plane + node vs our current $11/mo all-in), the workload-shape mismatch (one service, bounded traffic, stateful filesystem), the pod-eviction hazard for stateful services, and the operational complexity (~10 manifest types vs five files of systemd). Linked from `wk-enhanced-api/CLAUDE.md` next to the SQLite-not-Postgres dead-end so the two coupled decisions read together. Includes a "when to revisit this" section pinning the trip-wires (more than one service, zero-downtime requirement, multi-region, past vertical-scaling headroom).

### Per-endpoint IK rate limits (separate gates for /search vs /download_media)

**What**: split the global `MIN_GAP_MS=500` rate limit in `services/ik.ts` into per-endpoint floors. `/search` stays conservative (500ms+); `/download_media` can be more permissive (~100ms) since it's serving cached media off a different IK infrastructure layer.

**Why**: bulk warm spends ~100 calls per word on `/download_media` for ~one `/search`. Tightening just the media gate could cut bulk warm time from ~6-10 hours to ~2-3 hours. The IK 429 storm from rc2's 50ms global rate limit appeared to be triggered by sustained `/search` traffic specifically — single curls to `/search` while we were locked out also failed, but `/download_media` URLs we'd built may still have worked. (Untested; verify before lowering.)

**How**:
- Add `MIN_GAP_SEARCH_MS` and `MIN_GAP_MEDIA_MS` constants in `services/ik.ts`, defaulting to 500ms and 100ms respectively.
- Keep two separate `lastCallAt` timestamps + two gate functions.
- `ikSearch` calls the search gate; `ikDownloadMedia` calls the media gate.
- Update the comment block above the gates to reflect the rationale.

**Considerations**: this is purely speed-vs-politeness tuning. **429-backoff prerequisite shipped 2026-05-25** (see entry below). The remaining gates are: (a) verify the hypothesis that `/download_media` specifically wasn't part of the rc2 lockout — single curls from the same droplet during a small-scope warm would prove or disprove this, and (b) run a ~100-word scope-`word` re-warm with a temporary `MIN_GAP_MEDIA_MS=100` (rolled back if any 429 fires) before flipping it globally. The `ik.fetch.429_backoff` log lines added in `983dcb7` make this observable.

### 429 retry-with-exponential-backoff in IK service — **shipped 2026-05-25**

Landed across two commits:
- **`983dcb7`** — `fetchJson` (covers `ikSearch` + `ikIndexMeta`). Base 1s × 2^attempt backoff, cap 30s, 3 retries (4 total attempts). Honors `Retry-After` (delta-seconds and HTTP-date forms; numeric-input short-circuit so Bun's lax `Date.parse("-5")` doesn't accidentally produce a valid timestamp). Logs `ik.fetch.429_backoff` per retry. **5xx deliberately not retried** — different failure mode (server bug, not rate limit); easy to add later if needed.
- **`942175c`** — same retry budget applied to `ikDownloadMedia` via a shared `fetchWithRetry` helper. Most IK traffic in a bulk warm is `/download_media`, so this is where the retry budget pays off most. Small-body proxy-misses (`<1KB` response) are *not* retried — those are structural "file missing on IK" signals, not transient.

`lastIkCallAt` is intentionally not reset during backoff — the next `rateLimit()` call re-applies the `MIN_GAP_MS` gate naturally, and the backoff sleep is almost always longer than the gate so we don't pay double. Test-only `_ikFetchConfig` knob lets the suite shrink wait times; mirrors the `_useDbForTesting` pattern in `db/client.ts`. The 15s `AbortSignal.timeout` in `ikDownloadMedia` stays as a hard ceiling for the whole call (retries cut into the same budget) — acceptable because media failures leave `audioUrl`/`imageUrl` null and the warm completes anyway via the incomplete-payload signal.

### Two-phase lazy-fill (warm example[0] sync, defer the rest)

**What**: on cold lazy-fill, warm only the *first* IK example's media synchronously and return immediately with a partial payload (`incomplete: true`); kick off a background task to warm the remaining 40+ examples + DDG. Drops cold lazy-fill from ~1–3s to ~500ms–1s.

**Why**: the current pipeline (post-rc2) defers only DDG to the background, which gets us most of the way there. The per-example IK-media work for ~40 examples still runs synchronously and accounts for ~1–2s of remaining latency. If forum users complain about cold latency once deployed, this is the next lever.

**How**:
- Split `warmWord` into `warmWordPriority(word)` and `warmWordComplete(word)`.
- Priority: fetch IK `/search`, warm only `examples[0]` (or first with `sound` — matches userscript's default `requireAudio=true`), upsert with `incomplete: true` and other examples having `audioUrl: null` / `imageUrl: null`, return.
- Complete: warm remaining examples + DDG, re-upsert with full payload + `incomplete: false`. The existing `ddgInFlight` Set generalizes to a `warmInFlight` Set keyed by word.
- Userscript: handle null `audioUrl` / `imageUrl` on later examples gracefully (audio button disabled, no image). Already handles `incomplete: true` for short local TTL — the same flag covers both cases.

**Considerations**: meaningful added complexity vs. the post-rc2 baseline. Don't do this until you're sure 1–3s isn't good enough. The big difference vs. the DDG-only deferral: now the user can cycle to a sentence whose media isn't warmed yet, and they see "no audio/image" until the background completes. With DDG-only deferral, cycling stays fully functional because all per-example IK media is already warmed.

### Per-example media-warm endpoint

**What**: a route like `POST /v1/vocab/{word}/warm-example` that warms a specific example's media on demand. Useful if "Two-phase lazy-fill" above ships and the user cycles to an un-warmed example — the userscript could call this endpoint, get back a fresh `audioUrl`/`imageUrl`, and re-render.

**Why**: paired with two-phase lazy-fill, this gives "instant first card, on-demand cycle" UX. Without it, cycling into an un-warmed example degrades silently.

**How**: takes `{ exampleId }` in the body, looks up the IK example from the cached payload, runs the per-example warm path, updates the DB row, returns the warmed example. Idempotent (storage.exists short-circuits if already warmed).

**Considerations**: only worth building if we ship two-phase lazy-fill and the silent-cycling-degradation actually annoys users.

### Morphological analysis for JLPT scoring

**What**: integrate a real Japanese morphological analyzer (kuromoji.js or MeCab via a Bun-friendly binding) into the warm pipeline so JLPT scoring lemmatizes conjugated verbs / adjectives before dictionary lookup.

**Why**: the current `scoreJlpt` is fail-open on conjugated forms — IK gives us `食べた`, our dict has `食べる`, the token gets skipped, and sentences whose entire word_list is conjugated verbs score 0 (= "unknown, don't filter"). Result: the JLPT ceiling filter is strict on identifiable nouns/adjectives and permissive on verb-heavy sentences. Real morphological analysis closes that gap and makes the ceiling do what users expect.

**How**:
- Add `kuromoji` as a dep (~50MB dictionary; bundle as a separate downloadable + cache at first warm, or vendor into Docker image / DO Spaces).
- In the warm pipeline: for each example, run `word_list` (or the raw sentence) through kuromoji → get dictionary forms → look those up in `JLPT_VOCAB`.
- Score the same hardest-wins way. Drop the fail-open sentinel if known-token rate goes high enough that fail-open becomes a no-op.
- Bump cache schema version (everything re-warms).

**Considerations**: payload size unchanged (only `jlptMax` changes per-example); pipeline gets slower by maybe 5-10ms per example. Bundled dict is the size concern — eats most of the storage budget on a basic droplet unless we host it on Spaces. Alternative: a smaller stem-mapping table built from the JLPT dict + common conjugation suffixes; less accurate but no new dep.

### Better DDG image search alternative

**What**: replace DuckDuckGo image scraping with a more stable image source.

**Why**: DDG's image endpoint rotates its HTML format every few months. Each break means broken fallback images until the regex gets updated. The current scrape works but is fragile.

**How**: options ranked by stability vs effort:
1. **Bing Image Search API** — paid but stable, has a free tier. Requires API key (env var, not per-user).
2. **Open-source image dataset** — bundle a hand-curated set of "concept illustrations" mapped to common JLPT words. ~100MB on Spaces. Highest stability, lowest coverage.
3. **Multiple-source fallback** — try DDG first, then Google Images (also scrape-fragile), then Bing. Smear the breakage risk.

**Considerations**: keep DDG as one of the sources even if we add another; redundancy beats single-source. The image-refresh button on the card already cycles through the pool, so users can self-heal a bad image.

### LRU eviction for media storage

**What**: cap total media storage (e.g. 50GB on Spaces) and evict least-recently-served entries when over.

**Why**: even with a 50-example cap per word, a forum-bump-driven traffic spike could pull in cold corners of the WK vocab list that don't get re-served. Storage cost on DO Spaces is $0.02/GB over the 250GB base; with no cap, that grows unbounded if we don't refresh-and-purge.

**How**:
- The `last_served_at` and `serve_count` columns on `vocab_examples` are already populated — they exist for exactly this.
- Periodic sweep (cron, or every Nth `/v1/admin/warm` call): if `measureMediaSize() > THRESHOLD`, find words with the lowest `last_served_at + N * log(serve_count)` (LRU-ish with mild popularity weighting), delete their media objects, and reset their `payload.audioUrl` / `imageUrl` to null. The next request lazy-warms them.
- Track evicted-bytes in `/v1/health` so we can see when it's firing.

**Considerations**: don't evict the DB row, only the media. The example metadata is tiny; keeping it means the next serve gets a faster lazy-warm (skip IK search, just re-fetch media). The "Clear cache" button on the userscript should NOT trigger server-side eviction — that's an account-action and we have no accounts.

### Schema version pin for cached payloads

**What**: add a `payload_schema_version` column to `vocab_examples` and bump it whenever the response shape changes. On boot, scan for rows with mismatched version and trigger re-warm (or wipe + lazy-fill).

**Why**: the userscript has `CACHE_SCHEMA_VERSION` for exactly this; the server doesn't. Today, a payload shape change (e.g. renaming `hasOriginalAudio` to `audioSource`) would mean stale rows serve broken data to clients until they happen to be re-warmed. With a version pin, mismatched rows get cleared on boot or refreshed on next serve.

**How**:
- Add `payload_schema_version INTEGER NOT NULL DEFAULT 1` to the schema.
- `PAYLOAD_SCHEMA_VERSION = 2` constant in code; bump on shape changes.
- `upsertVocab` writes the current version; `getVocab` returns null (or triggers re-warm) on mismatch.
- Migration: on boot, count rows with stale version; log + optionally background-refresh.

**Considerations**: SQLite `ALTER TABLE ADD COLUMN` is the boring migration. Couple bumps with userscript schema bumps — keep the two version numbers in sync where they share concerns (e.g. if we add `pitchAccent` to examples).

### Circuit-breaker for IK outages

**What**: when IK requests have failed N times in the last M minutes, stop calling IK for a cooldown window and serve fallbacks immediately (TTS for audio, no image, DDG-only for image pool).

**Why**: during an IK outage every cold warm hits the IK 15s timeout before falling back. UX gets terrible for any user encountering a cold word during an outage. With a breaker, we recognize "IK is down" after ~3 failed requests and skip the doomed calls entirely.

**How**:
- Module-state counter + last-failed-at timestamp in `services/ik.ts`.
- On request failure, increment + timestamp.
- If count > 3 within last 5 minutes, return a stub failure for the next 10 minutes; the warm pipeline already handles "no examples" gracefully (lazy fill returns an empty payload, 200).
- Auto-recover by zeroing the counter after the cooldown.
- Log circuit-break entry/exit so we can see it from journalctl.

**Considerations**: tune thresholds against real outage data once we have any. Should NOT trip during normal "deck has no audio" misses — those return a body, just a small one; only count actual transport-layer failures (timeout, 5xx, network error).

### Manual override map for IK title decoding

**What**: a small static map (file or DB table) of `encoded_title → {title, category}` that we maintain by hand, layered on top of IK's `/index_meta`. Used when IK's own data is wrong or missing.

**Why**: the dead-end warnings in [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) describe cases where IK's `/index_meta` doesn't have an entry, and the heuristic fallback is wrong (`durarara__` → "Durarara" instead of "Durarara!!"). For high-volume titles where this matters, a hand-maintained override is the cleanest fix.

**How**:
- New file `src/data/title-overrides.json`: `{ "durarara__": { "title": "Durarara!!", "category": "anime" } }`.
- `resolveIkFolderAndCategory` checks overrides first, then IK index_meta, then heuristic.
- Bundle in the repo; ten entries is plenty for the worst offenders.

**Considerations**: invest in this only after we see real "audio missing for word X" reports tracing to title mis-resolution. Probably less than a dozen titles matter.

### ETag on /v1/index_meta — **shipped 2026-05-25**

`/v1/index_meta` now supports `If-None-Match`. Same conditional-GET pattern as `/v1/vocab/{word}`: strong ETag derived from `row.fetchedAt`, weak-prefix tolerance for Cloudflare-downgraded validators, 304 path that echoes the same `Cache-Control` + `ETag` headers as 200. The helper pair (`etagFor`, `normalizeEtag`) moved out of `routes/vocab.ts` into `src/lib/etag.ts` so both routes share one definition; unit tests followed the helpers to `src/lib/etag.test.ts`, and four new integration tests cover the round-trip (200 → 304, weak-prefix tolerance, stale-tag 200 path).

`/v1/admin/jobs` is still not ETag-gated — it changes on every warm and only the maintainer hits it, so the win doesn't materialize. Leave alone unless an operator-facing dashboard ever polls it heavily.

### Bulk endpoint with opt-in warming

**What**: add a `?warm=true` mode to `POST /v1/vocab/batch` that lazy-warms missing words instead of returning them in the `missing` array.

**Why**: clients that *want* warming for everything they request would prefer one slow batch call to a fast batch + N individual GETs. Current shape is right for prefetching (fast + composable), but workflows like "force-warm these 10 words" are more natural as one call.

**How**:
- Add `warm: boolean` field to `BatchRequestSchema`.
- When `true`: still return `{found, missing: []}`, but kick off `warmWord` for each miss with concurrency 4, wait for all to finish, then return the full found map.
- Cap warming-mode at smaller batch sizes (~10) since the wall-clock cost is N × cold-warm time.

**Considerations**: only worth it if we end up needing it. The prefetch flow (batch → individual GETs for misses) is fine for the userscript's actual use case.

### Translation-language switcher

**What**: serve translations in user-chosen language (German / French / Spanish) from IK's multi-language data, instead of hardcoded English.

**Why**: IK's `/search` returns multiple translation fields per example. Currently we throw away everything but English. For non-English-native users (a noticeable slice of WK users), German or Spanish would be more useful.

**How**:
- IK's response shape varies but typically includes `translation_de`, `translation_es`, etc. on each example.
- Server stores all available translations in the payload (small bytes).
- Client picks one based on a setting (or its browser language).
- New optional `?lang=de` query on `/v1/vocab/{word}` could let the server pre-select to save bytes, but full-payload-all-langs is simpler and lets the userscript switch on the fly.

**Considerations**: low priority while the maintainer is English-native. Bundle into a larger "internationalization" pass when there's demand.

### Pitch accent for the target word

**What**: include pitch-accent data in the response payload so the userscript can render it next to the highlighted target word.

**Why**: pitch accent is a known WK gap. The CLAUDE.md mentions it as N2+ listening/production gap. Server-side is the right place to host the data — bundle once, every client gets it.

**How**:
- Source: [kanjium pitch-accent data](https://github.com/mifunetoshiro/kanjium) (CC-licensed). ~3000 entries for common N5-N3 vocab; ~200KB.
- Bundle in `src/data/pitch-accent.json` or fetch from a community-hosted JSON.
- `warmWord` attaches a `pitchAccent` field to the payload (e.g. `{ pattern: "atamadaka", drop_at: 1 }` or just the contour string `"⓪"`).
- Bump payload schema version.

**Considerations**: licensing check on the source. Coverage is sparse for less-common vocab. Could be a no-op for many words (field is `null`) — that's fine.

### Health metrics expansion

**What**: add 24h serve counts, cache hit rate, and storage byte totals to `/v1/health`.

**Why**: capacity planning + cost monitoring without Prometheus. Once deployed, the maintainer wants to know "are we at 50GB?" and "did the forum-bump traffic die down?" without SSHing in.

**How**:
- `serve_count` column already tracks per-word; aggregate over `last_served_at > now - 24h`.
- Cache hit rate = `(total /v1/vocab/{word} requests - cold misses) / total`; need to record the denominator (add a `vocab_requests` counter row in a new `metrics` table, or just parse logs offline).
- Storage size: walk the storage driver's files (cheap on filesystem; one S3 `ListObjects` call in prod). Cache for 5 minutes to avoid hammering Spaces on health checks.

**Considerations**: don't turn health into a slow endpoint — keep the heavy lifting (storage size) cached. Add a separate `/v1/admin/stats` endpoint if it grows.

### SQLite backup story — **shipped 2026-05-25**

Implemented under [wk-enhanced-api/deploy/](wk-enhanced-api/deploy/): `backup.ts` uses `bun:sqlite`'s `VACUUM INTO` for a WAL-safe atomic snapshot, then uploads to `s3://<bucket>/backups/YYYY-MM-DD.sqlite` (private) via `Bun.S3Client`, then prunes older backups per a GFS retention policy (default 7 daily + 4 weekly + 12 monthly, tunable via `BACKUP_RETAIN_{DAILY,WEEKLY,MONTHLY}`). The retention selection is a pure helper in `retention.ts` with 15 unit tests. Wired into systemd as `wk-enhanced-api-backup.service` + `wk-enhanced-api-backup.timer` (daily at 03:00 UTC, `Persistent=true` for missed-trigger replay).

Deviations from the original design: no `sqlite3` or `s3cmd` host binaries needed — Bun's built-in primitives cover both the snapshot and the S3 operations. GFS retention is implemented in TypeScript with pure-function tests rather than as ad-hoc bash. See [wk-enhanced-api/deploy/README.md](wk-enhanced-api/deploy/README.md) for install + tunables.

### Keyed external services (DeepL, OpenAI, Forvo, jpdb)

**What**: support user-provided API keys for services that gate behind authentication.

**Why**: enrichment features (better translations via DeepL, grammar notes via OpenAI, native pronunciation via Forvo, definition fallbacks via jpdb) all want API keys. We've committed to "no maintainer-paid keys for users" — but a user with their own DeepL key should be able to opt in.

**How**:
- New endpoints: `POST /v1/translate` (passes through to DeepL with the user's key), `POST /v1/grammar/{word}` (OpenAI), etc.
- Auth: `X-DeepL-Key: <key>` header (or whatever per-service header is natural). Server treats the key as opaque, never logs it, never persists.
- Server CAN cache the *response* (the translation of "私は学生です" doesn't depend on whose key paid for it) — but keyed by hash of (key, request) so we don't accidentally serve user A's response to user B without their key.

**Considerations**: the "never cache under a key the requester can't reach" rule is load-bearing — that's what keeps us on the right side of "don't data-mine user accounts." Get a security review (even informal) before shipping any keyed endpoint.

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
