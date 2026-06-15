# WKEnhanced

## What this project is

A **three-surface** project augmenting WaniKani vocab reviews (+ a standalone study app):

1. **Tampermonkey userscript** at [wkenhanced.user.js](wkenhanced.user.js) — runs in-browser on WaniKani, injects example sentences, audio, and images into the vocab-review header. As of v2.0.0 the userscript only talks to our backing API server; all upstream coordination (ImmersionKit / DuckDuckGo / Google TTS) happens server-side.
2. **Backing API server** at [wk-enhanced-api/](wk-enhanced-api/) — Bun + Hono + SQLite. Coalesces IK / DDG / Google TTS behind a single pre-warmed endpoint so every client doesn't hit three external services individually. Has its own [CLAUDE.md](wk-enhanced-api/CLAUDE.md) and [README.md](wk-enhanced-api/README.md) — treat those as authoritative for anything inside `wk-enhanced-api/`.

As of mid-2026 there's also a **third surface**: a **日常日本語 Japanese-trainer study app** — its OWN standalone **Vite** project + nginx container at [study-app/](study-app/), served at the apex `https://wkenhanced.dev/`, with email/password accounts + per-user progress sync. It talks to the API at `api.wkenhanced.dev` **cross-origin** (two containers, one droplet). It was extracted into [study-app/](study-app/) from an earlier in-API `web/` directory once it outgrew it. Its own docs: [study-app/README.md](study-app/README.md) + [study-app/CLAUDE.md](study-app/CLAUDE.md); the server side (auth/progress routes + the cross-origin CORS) is in [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) "Accounts + study app"; the cut-over runbook in [wk-enhanced-api/deploy/README.md](wk-enhanced-api/deploy/README.md).

A **frozen v1.1.1 snapshot** of the userscript's pre-server direct path (it called IK / DDG / Google TTS straight from the browser) was kept at `legacy/` as an "API server down for an extended period" fallback. It was **removed in the 2026-06 cleanup** now that the v2.0.0 server path has proven stable; recover it from git history if ever needed.

The server is deployed in production at `https://api.wkenhanced.dev` (DO droplet in SFO3 + Spaces, Cloudflare Tunnel for TLS/edge). Userscript v2.0.0 routes every vocab lookup through it; existing v1.x users on the direct path upgrade by pasting the new file.

This file covers the userscript. For server work, jump to [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md). For the migration plan + Phase 1/2/3 deviations + the deploy-day lessons, see [CLIENT_MIGRATION.md](docs/history/CLIENT_MIGRATION.md) and [wk-enhanced-api/deploy/README.md](wk-enhanced-api/deploy/README.md).

**Reading order for a cold start:**
1. [NEXT_STEPS.md](NEXT_STEPS.md) — *what to do next*, in priority order. Read this first if you're picking up a session in progress; everything else is reference material.
2. This file — userscript architecture + dead-ends.
3. [SERVER_DESIGN.md](SERVER_DESIGN.md) — design rationale for the server (with implementation deviations noted at the top).
4. [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) — server architecture + dead-ends.
5. [CLIENT_MIGRATION.md](docs/history/CLIENT_MIGRATION.md) — migration plan (all three phases shipped).
6. [NEW_FEATURES.md](NEW_FEATURES.md) — backlog of features discussed but not yet shipped (now includes a Server-side improvements section).

**The userscript is a single file.** No build step, no tests, no package manager — read the whole file to see everything. The server is a separate codebase that happens to live in the same git repo (`package.json`, test suite, type-check, the works).

## Why it exists

WaniKani's review UI is reading-recognition only. This script adds listening + visual + contextual reinforcement to support the maintainer's JLPT N3 study goals.

Reveal behavior is *per question type* (WK asks meaning and reading as two separate questions per vocab) — each supplementary element is gated on the specific question that it would spoil:
- **Meaning submit** uncovers the English translation + image (English-side spoilers). Autoplays audio if `autoPlayAudio` is on.
- **Reading submit** uncovers the furigana on the sentence (Japanese-side spoiler — the reading is literally the answer being tested). Always autoplays the sentence audio (queued after WK's own vocab pronunciation so they don't overlap).
- Order doesn't matter: each reveal is independent. After both questions are answered all three (translation, image, furigana) are visible.

The visual layout is inlaid into WaniKani's existing purple character header: sentence + play button on the left of the vocab character, screenshot/illustration on the right. The header is expanded to 280px min-height to make room; the vocab character itself stays vertically centered via absolute positioning.

## How to work on it

When you edit the file:

1. Always bump **both** the `@version` line in the metadata block AND the `SCRIPT_VERSION` constant together. They must match — the in-code constant is what shows up in the boot log.
2. Run `node --check wkenhanced.user.js` to syntax-check.
3. **Do not attempt to test in a browser yourself** — the user must manually re-import in Tampermonkey (the file is local; Tampermonkey doesn't auto-reload). They handle this.
4. Changing external services? Update **both** `@grant` and `@connect` directives in the metadata block; Tampermonkey will re-prompt the user for permissions. As of v2.0.0 the only external service the userscript talks to is `api.wkenhanced.dev` (plus `localhost` for dev).
5. **Always commit at the end of a feature/fix** — don't wait for the user to ask. Once a logical unit of work is done (syntax-check passes, docs updated, version bumped), create the commit. Don't batch unrelated work into one commit; one feature → one commit. The user will tell you if they want to defer or amend.

## Dependencies (loaded by Tampermonkey, not by us)

- **WaniKani Open Framework (WKOF)** — must be installed and ordered first in Tampermonkey. Reference docs at `~/Downloads/README.md`. Modules used: `Menu`, `Settings`, `file_cache`, `load_script`.
- **WKOF Turbo Events library** — loaded at runtime via `wkof.load_script` from greasyfork (script id 501980). Provides review-page lifecycle hooks for WK's Turbo/Stimulus navigation. Falls back to `DOMContentLoaded` if absent.

## External services

The userscript talks to exactly one external service:

- **`api.wkenhanced.dev`** — our backing API. The server handles upstream coordination with ImmersionKit, DuckDuckGo, and Google Translate TTS; the userscript just consumes pre-resolved JSON payloads + pre-built CDN URLs. CORS is permissive (`Access-Control-Allow-Origin: *`) so we use plain `fetch()` — no `GM_xmlhttpRequest` needed.

Two endpoints in use:
- **`GET /v1/vocab/{word}`** — per-card payload. Includes ETag for conditional revalidation; the userscript caches the ETag locally and sends `If-None-Match` on revisits for cheap 304 round-trips.
- **`POST /v1/vocab/batch`** — prefetch up to 50 upcoming subjects on review-session entry (configurable via the `prefetchCount` setting).

All cache-warming, title decoding, media proxying, and JLPT scoring happens server-side. See [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) for the upstream story.

## Sandbox awareness

We use `@grant unsafeWindow`, which puts the script in Tampermonkey's sandbox. WKOF is installed by another userscript on the **page's** window, so we reach it via `const PAGE_WIN = unsafeWindow || window` (see top of IIFE). Any global you want reachable from devtools console (debug helpers, etc.) must be set on `PAGE_WIN`, not `window`.

`GM_xmlhttpRequest` was dropped in v2.0.0 — with no third-party fetches happening directly from the userscript, plain `fetch()` against our CORS-permissive server suffices.

## Things that look like bugs but aren't (DEAD-END WARNINGS)

These have been investigated extensively. Don't re-explore them.

- **WK clones our card during the reveal animation.** `dedupeCards()` (called on every DOM mutation) removes the duplicate by comparing against `state.cardEl`. Logs `dedupe: removed N stale card clone(s)` when it fires.
- **Reveal detection: WK signals "answer graded" via computed background-color, NOT via class/attribute changes.** Confirmed by `debugWkEnhanced()` in late 2025: the `.quiz-input` subtree's classList and `data-*` attributes are byte-identical before and after submitting an answer. The only observable change is `input#user-response.quiz-input__input`'s computed `background-color` flipping from default to `rgb(255, 0, 51)` (incorrect / red) or `rgb(136, 204, 0)` (correct / green). The CSS rule hangs off the HTML5 form-validation pseudo-class (`:valid` / `:invalid` via `input.setCustomValidity(...)`), which is invisible to `className`/`getAttribute`. `answerHasBeenSubmitted()` therefore walks up to 10 ancestors from `#user-response` looking for a strong red/green bg (matches on the input itself in current WK; the ancestor walk is bounded resilience for a future WK that might move the color to a wrapper). The `.subject-info` panel-visible check is kept as a last-resort fallback (logged as `…visible(fallback)`) — in current WK it's coupled to the Item Info button, useful only as a safety net, never as primary. Note: WK uses CSS `display:none` not the HTML `hidden` attribute, so `[hidden]`/`:not([hidden])` selectors don't detect visibility — use `offsetParent !== null`. The MutationObserver runs with `attributes: true` (no `attributeFilter`) because the bg-color check needs to fire on whatever attribute change WK happens to make — even setCustomValidity-driven CSS recomputation is preceded by some DOM-observable change (form/button state, exception container, etc.).
- **`.character-header__characters` is positioned relative to `.character-header__content`, NOT `.character-header`.** WK nests the vocab character inside a `__content` wrapper that ships its own `position:relative` and is ~82px tall regardless of how tall we make the outer host. Naive `position:absolute; top:50%; transform:translate(-50%,-50%)` on the character only centers within those 82px, leaving the glyph stuck at the top of our 280px expanded host. The fix (in `injectStyles`) is to also set `.character-header.wk-ik-host .character-header__content { position: static !important }` so the character's absolute positioning looks up past `__content` to our `wk-ik-host`. The character itself uses `inset: 0 + display:flex + align-items:center + justify-content:center` to fill the host and center the glyph inside, which is robust to whatever font-size WK ships at any given viewport. Confirmed by `debugWkEnhanced()` DOM tree dump (`--- .character-header DOM tree ---`) on the live page — call it again if `.character-header` positioning misbehaves.
- **Reveal behavior is gated per-feature on the specific question that would spoil it, not on subject completion.** WK asks two questions per vocab subject (meaning + reading) but doesn't expose a "subject complete" callback — we don't need one anymore since reveals are independent. `state.meaningAnswered` / `state.readingAnswered` are convenience mirrors of the *current* subject's entry in `state.subjectProgress`, an in-memory `{ subjectId → { meaningAnswered, readingAnswered } }` map populated for the duration of the session. The per-subject map is critical because WK can interleave other subjects between the two questions of one subject (shuffled-mode reviews): you may answer meaning for A, then see B/C/D, then come back to A for reading — without the map the comeback would re-render with `meaningAnswered=false` and re-hide the image/translation the user already uncovered. Flags flip true on the respective submission (right or wrong — submission, not correctness) and stay sticky for the rest of the session. **Translation + image** reveal on meaning-answer alone (they don't spoil reading — neither shows the Japanese kana reading); **furigana** reveals on reading-answer alone (it IS the reading). `renderCard` reads `state.meaningAnswered` to set the initial `fig.hidden` / `translation.hidden` so a shuffle-mode revisit renders in the correct already-revealed state. `state.currentQuestionType` (driven by the `[data-question-type]` attribute on `.quiz-input__question-type-container`, values: `meaning`/`reading`) controls per-submission behavior: reading submission unlocks the ふ furigana toggle and ALWAYS triggers sentence-audio autoplay via `autoplayAfterWkAudio()`, which yields to WK's own vocab-pronunciation `<audio>` element so they don't overlap (detect-then-listen for `ended` with a fixed-delay fallback for the Web-Audio-API case). The `autoPlayAudio` setting only governs meaning-submit audio; reading-submit audio is unconditional. `handleDomChange` resets `state.answered = false` when `currentQuestionType()` changes mid-subject so the same card re-arms for the second question — but it does NOT reset `meaningAnswered`/`readingAnswered`, which only reset on new subject.
- **Tampermonkey doesn't auto-reload from disk.** After every edit, the user must paste the file contents into the Tampermonkey editor. The boot log line (`booting v<X.Y.Z>`) is the source of truth for which version is running.
- **Server-path fetches MUST pass `cache: 'no-cache'` — without it, Chrome's HTTP cache silently serves stale empty payloads for 24 hours.** Discovered during the v1.1.0 → v1.1.1 smoke-test: the server emits `Cache-Control: public, max-age=86400, stale-while-revalidate=2592000` (good for CDN caching), and a bare `fetch(url)` from the userscript honors that as a browser-cache directive too. If the userscript hits a word DURING a bulk warm (response = empty payload), Chrome caches the empty body for the full `max-age` window, and subsequent userscript reads from THAT same browser keep serving the empty cached copy even after the warm completes server-side. The local `wkof.file_cache` ETag dance does not save us: `wkof.file_cache` is checked before the fetch but populated FROM the fetch's response — if the response itself is a browser-cache replay, `wkof.file_cache` learns the stale value. The fix in [wkenhanced.user.js](wkenhanced.user.js) is `cache: 'no-cache'` on `fetchVocab` and `debugWkEnhancedApi`'s probes — this forces conditional revalidation (`If-None-Match` round-trip → 304 on unchanged, 200 on changed), keeping ETag-driven bandwidth savings without ever letting the browser silently hold stale data. `POST /v1/vocab/batch` is unaffected (browsers don't cache POST responses by default). **Never remove this option** without first replacing the server's `max-age=86400` with something tiny like `max-age=60, must-revalidate`.
- **CSS class prefix is intentionally still `wk-ik`.** The DOM classes (`wk-ik-card`, `wk-ik-host`, `wk-ik-left`, etc.) keep the old prefix even after the v2.0.0 rebrand. Renaming would touch ~140 hardcoded CSS rule strings in `injectStyles` for zero user-facing benefit (CSS classes are implementation detail). The user-facing rebrand is via `@name`, `SCRIPT_TITLE`, log lines, and console helpers.
- **Old `wk-ik-examples.*` and `wk-vocab-cache.*` cache prefixes orphan in IndexedDB after a v1.x → v2.0.0 upgrade.** No automatic wipe on first v2.0.0 boot — the Clear cache button in the settings dialog cleans them up on user demand. Acceptable disk leak (~5–10MB per heavy user from v1.x audio/image blobs) for simpler upgrade-path code. Don't add a "wipe-on-first-boot" hook later without a real reason — the user's settings record was also dropped (SCRIPT_ID changed), so they're already reconfiguring once.

### IK-specific dead-ends (now server-side)

These are about the upstream data flow that historically the userscript handled. The userscript no longer cares — but the server does, so these warnings still matter, just in a different file. Don't re-explore them based on this list; jump to the linked file when relevant:

- **IK's *direct* media bucket (`us-southeast-1.linodeobjects.com/immersionkit/...`) is offline since Aug 2025** → handled server-side via `apiv2.immersionkit.com/download_media?path=...` proxy. See [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md).
- **IK's `title` field is lossy** → server resolves via cached `/index_meta` map; heuristic fallback in [wk-enhanced-api/src/lib/ikTitles.ts](wk-enhanced-api/src/lib/ikTitles.ts). (The frozen v1.x heuristic is in git history, in the removed `legacy/` snapshot.)
- **JLPT scoring fails open on conjugated verbs** → still true; server computes `jlptMax` per example using the same fail-open semantics. See [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) JLPT section.

## Diagnostic helpers (callable from browser console)

Exposed on `PAGE_WIN` at boot, so reachable directly from devtools:

- `openWkEnhancedSettings()` — open the settings dialog directly. Useful if the WKOF menu link isn't visible in WK's avatar dropdown.
- `debugWkEnhanced()` — dump five sections, top-to-bottom:
  1. Known reveal-panel selectors with their classList / hidden / computed display / `offsetParent` / `data-state` / `data-quiz-input-quiz-state-value`.
  2. `--- .quiz-input subtree (classes + data-*) ---` — every descendant of `.quiz-input` with non-empty class or `data-*` attrs. Used to identify graded-state markers if the bg-color reveal detection ever stops working.
  3. `--- bg-color chain from input → body ---` — computed `backgroundColor` of every ancestor from `#user-response` up to body. Used to see which element actually carries the green/red color if a future WK moves it from the input itself.
  4. `--- quiz-queue Stimulus roots (for prefetch tuning) ---` — every `[data-controller~="quiz-queue"]` element with its `data-*` attribute list. Used to find where WK exposes the upcoming-items list so `prefetchUpcomingExamples` / `getUpcomingCharacters` can read it (if the array entries use a field other than `characters`, add it to the `tryAdd` probe list).
  5. `--- .character-header DOM tree (bbox in viewport coords) ---` — full recursive dump of `.character-header` and descendants with bounding box, computed `position`, computed `display`, and `font-size`. Used to diagnose vocab-character positioning issues (this is what surfaced the `.character-header__content` positioning trap).
- `debugWkEnhancedApi('<word>')` — API-server diagnostic (defaults to `食べる`). Reports current settings + resolved base URL, probes `/v1/health`, runs a sample `GET /v1/vocab/<word>`, and inspects the local payload cache. Use when a card renders empty / wrong — first stop is usually "is the server reachable" (health probe) vs "is the payload shape what we expect" (sample GET output).

## When a card renders empty (playbook)

The most likely cause is something between the userscript and the API server. Walk it in order:

1. **Check the boot log.** Open devtools, look for `[wkenhanced] booting v2.0.0 on /...`. If absent, WKOF probably failed to load — ensure it's installed and ordered first in Tampermonkey.
2. **Run `debugWkEnhancedApi('食べる')`.** Three branches:
   - **`/v1/health` returns 200**: server is reachable. Look at the sample GET response — if it returns `{examples: [], ...}`, that word genuinely has no IK examples (most common for very rare vocab). If it returns 502, server is up but the lazy-warm threw — check server logs.
   - **`/v1/health` returns CORS / network error**: connectivity issue. Either the user's settings have an empty `apiServerUrl`, the prod server is down (try `curl https://api.wkenhanced.dev/v1/health`), or there's a Cloudflare Tunnel hiccup (check `systemctl status wk-enhanced-api` on the droplet).
   - **`/v1/health` hangs**: server is up but cloudflared lost the upstream. `systemctl restart wk-enhanced-api` on the droplet.
3. **If only one specific word renders empty**, that's almost always a missing IK row for that word. Force a re-warm: `curl -X POST https://api.wkenhanced.dev/v1/admin/warm -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"scope":"word","word":"食べる","force":true}'`. This bypasses the freshness check and re-fetches from IK.
4. **If audio/image specifically fails to load for a word but text renders**, the CDN URL is bad. Check the URL in the network tab — typically a Spaces 404 means the warm pipeline failed mid-upload. Re-warm with `force:true` to re-upload.

Don't re-explore: the IK title-encoding workaround is server-side now; trying to debug it from the userscript is pointless.

## Cache keys (all in `wkof.file_cache`, IndexedDB-backed)

The v2.0.0 userscript writes to just two key prefixes:

- `wkenhanced.payload.<encoded-word>` — server payload cache. `{ payload, etag, savedAt }`. 7-day TTL (60-second TTL when the server marked the payload `incomplete: true` to signal a background-DDG warm is still running). ETag-based revisits: `fetchVocab` sends `If-None-Match` when an etag is cached; on 304 we keep the same payload and refresh `savedAt`. Populated by both `fetchVocab` (single GET) and `fetchVocabBatch` (POST /v1/vocab/batch — batch entries land here etag-less, so the next direct GET on that word will populate the etag). Wiped by the "Clear cache" button.
- `wkenhanced.selections` — `{<word>: {s, i, b}}` map of last-used refresh-button indices. `s` = sentenceIdx, `i` = imageIdx (indexes into `[ikImageUrl?, ...fallbackImages]`), `b` = JLPT-ceiling bypass flag (true when the user previously picked an above-ceiling sentence for this word via the sentence picker — restored on subject load so the same sentence renders even though the current `jlptCeiling` setting would normally filter it out). Refreshing a sentence resets `i` to 0 so the new sentence's IK screenshot becomes the default; refreshing an image only bumps `i`. No TTL.

Settings dialog has a "Clear cache" button that wipes both prefixes above plus best-effort cleanup of leftover v1.x entries (`wk-ik-examples.*` and `wk-vocab-cache.*`) — useful for users who upgrade from v1.x and want to reclaim the ~5–10MB of orphaned IndexedDB space.
