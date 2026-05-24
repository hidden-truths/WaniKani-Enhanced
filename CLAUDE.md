# WK Vocab Review — ImmersionKit Examples

## What this project is

A single-file Tampermonkey userscript at [wk-vocab-review-ik.user.js](wk-vocab-review-ik.user.js) that augments WaniKani vocab reviews with example sentences (ImmersionKit), audio (IK `download_media` proxy → Google Translate TTS fallback), and images (IK source screenshot → DuckDuckGo illustration fallback).

**The codebase is one file.** No build step, no tests, no package manager. Read the whole file to see everything — there is no other source.

## Why it exists

WaniKani's review UI is reading-recognition only. This script adds listening + visual + contextual reinforcement to support the maintainer's JLPT N3 study goals.

Reveal behavior is *per question type* (WK asks meaning and reading as two separate questions per vocab):
- **Meaning submit** uncovers the English translation + image (the spoilers), and autoplays audio if the `autoPlayAudio` setting is on.
- **Reading submit** always autoplays the sentence audio (queued after WK's own vocab pronunciation so they don't overlap) but does NOT uncover translation/image.

The visual layout is inlaid into WaniKani's existing purple character header: sentence + play button on the left of the vocab character, screenshot/illustration on the right. The header is expanded to 280px min-height to make room; the vocab character itself stays vertically centered via absolute positioning.

## How to work on it

When you edit the file:

1. Always bump **both** the `@version` line in the metadata block AND the `SCRIPT_VERSION` constant together. They must match — the in-code constant is what shows up in the boot log.
2. Run `node --check wk-vocab-review-ik.user.js` to syntax-check.
3. **Do not attempt to test in a browser yourself** — the user must manually re-import in Tampermonkey (the file is local; Tampermonkey doesn't auto-reload). They handle this.
4. Changing external services? Update **both** `@grant` and `@connect` directives in the metadata block; Tampermonkey will re-prompt the user for permissions.

## Dependencies (loaded by Tampermonkey, not by us)

- **WaniKani Open Framework (WKOF)** — must be installed and ordered first in Tampermonkey. Reference docs at `~/Downloads/README.md`. Modules used: `Menu`, `Settings`, `file_cache`, `load_script`.
- **WKOF Turbo Events library** — loaded at runtime via `wkof.load_script` from greasyfork (script id 501980). Provides review-page lifecycle hooks for WK's Turbo/Stimulus navigation. Falls back to `DOMContentLoaded` if absent.

## External services

- `apiv2.immersionkit.com/search` — sentences + translations. Works via plain `fetch()` (CORS-allows wanikani.com).
- `apiv2.immersionkit.com/download_media?path=...` — **primary** audio source AND **primary** image source. Same URL shape for both: `media/<category>/<folder>/media/<file>`, where `<category>` is the first underscore-token of `id` (`anime`, `games`, …), `<folder>` is `title` with `_`→space + lone `x` token→`×` + word capitalization (`hunter_x_hunter` → `Hunter × Hunter`), and `<file>` is the `sound` field (audio) or `image` field (screenshot) verbatim. Each path segment is `encodeURIComponent`'d separately; slashes stay literal.
  - **Audio** fetched via `GM_xmlhttpRequest` with `Referer: https://www.immersionkit.com/`; bodies < 1KB are treated as a miss (proxy returns near-empty body when the file is absent). Failures are negative-cached for 7 days.
  - **Images** set directly on `<img src>` (no GM_xmlhttpRequest needed — `<img>` doesn't require CORS for display). On `<img>.onerror` we silently advance to the next pool slot (DDG fallback) — bounded retry so a fully-broken pool just removes the figure.
- `translate.googleapis.com/translate_tts` — **fallback** audio. Used when IK has no `sound` field (text-only literature) or the proxy fetch fails. **Must** use `GM_xmlhttpRequest` with spoofed `Referer: https://translate.google.com/` because direct `<audio src>` from wanikani.com gets 403. Falls back to browser Web Speech (Kyoko on macOS) if even TTS fails.
- `duckduckgo.com` — **fallback** image search (and the image-refresh button cycles through these even when an IK screenshot is available — so the user can replace a bad anime grab with a clean illustration). Two-step: scrape the search HTML for the `vqd` token, then call `i.js` JSON endpoint. Requires `GM_xmlhttpRequest`. The pool for a given (word, sentence) is `[ikImageUrl?, ...ddgUrls]` and the per-word `imageIdx` indexes into that combined list.

## Sandbox awareness

We use `@grant GM_xmlhttpRequest`, which puts the script in Tampermonkey's sandbox. WKOF is installed by another userscript on the **page's** window, so we reach it via `const PAGE_WIN = unsafeWindow || window` (see top of IIFE). Any global you want reachable from devtools console (debug helpers, etc.) must be set on `PAGE_WIN`, not `window`.

## Things that look like bugs but aren't (DEAD-END WARNINGS)

These have been investigated extensively. Don't re-explore them.

- **IK's *direct* media bucket is offline (since Aug 2025).** Every URL under `us-southeast-1.linodeobjects.com/immersionkit/media/...` returns 403 — even with `GM_xmlhttpRequest` and spoofed referers. **Do not try to load those URLs.** The working path is the API's own `apiv2.immersionkit.com/download_media?path=...` proxy (see External services above); we build proxy URLs from `id`/`title`/`sound` and use that as primary audio, with Google TTS as fallback. Images still use DDG (the IK proxy serves images too, but DDG gives us multiple illustrations to cycle through).
- **WK clones our card during the reveal animation.** `dedupeCards()` (called on every DOM mutation) removes the duplicate by comparing against `state.cardEl`. Logs `dedupe: removed N stale card clone(s)` when it fires.
- **Reveal detection: WK signals "answer graded" via computed background-color, NOT via class/attribute changes.** Confirmed by `debugWkIk()` in late 2025: the `.quiz-input` subtree's classList and `data-*` attributes are byte-identical before and after submitting an answer. The only observable change is `input#user-response.quiz-input__input`'s computed `background-color` flipping from default to `rgb(255, 0, 51)` (incorrect / red) or `rgb(136, 204, 0)` (correct / green). The CSS rule hangs off the HTML5 form-validation pseudo-class (`:valid` / `:invalid` via `input.setCustomValidity(...)`), which is invisible to `className`/`getAttribute`. `answerHasBeenSubmitted()` therefore walks up to 10 ancestors from `#user-response` looking for a strong red/green bg (matches on the input itself in current WK; the ancestor walk is bounded resilience for a future WK that might move the color to a wrapper). The `.subject-info` panel-visible check is kept as a last-resort fallback (logged as `…visible(fallback)`) — in current WK it's coupled to the Item Info button, useful only as a safety net, never as primary. Note: WK uses CSS `display:none` not the HTML `hidden` attribute, so `[hidden]`/`:not([hidden])` selectors don't detect visibility — use `offsetParent !== null`. The MutationObserver runs with `attributes: true` (no `attributeFilter`) because the bg-color check needs to fire on whatever attribute change WK happens to make — even setCustomValidity-driven CSS recomputation is preceded by some DOM-observable change (form/button state, exception container, etc.).
- **`.character-header__characters` is positioned relative to `.character-header__content`, NOT `.character-header`.** WK nests the vocab character inside a `__content` wrapper that ships its own `position:relative` and is ~82px tall regardless of how tall we make the outer host. Naive `position:absolute; top:50%; transform:translate(-50%,-50%)` on the character only centers within those 82px, leaving the glyph stuck at the top of our 280px expanded host. The fix (in `injectStyles`) is to also set `.character-header.wk-ik-host .character-header__content { position: static !important }` so the character's absolute positioning looks up past `__content` to our `wk-ik-host`. The character itself uses `inset: 0 + display:flex + align-items:center + justify-content:center` to fill the host and center the glyph inside, which is robust to whatever font-size WK ships at any given viewport. Confirmed by `debugWkIk()` DOM tree dump (`--- .character-header DOM tree ---`) on the live page — call it again if `.character-header` positioning misbehaves.
- **Reveal behavior is per-question-type, not just "answer submitted".** WK asks two questions per vocab subject (meaning + reading) — we track which is current via the `[data-question-type]` attribute on `.quiz-input__question-type-container` (values: `meaning`, `reading`). `state.currentQuestionType` and `state.translationRevealed` live on the state object. Meaning submit uncovers translation + image and flips `translationRevealed=true` (sticky for the subject — reading-after-meaning doesn't re-hide). Reading submit ALWAYS triggers sentence-audio autoplay via `autoplayAfterWkAudio()`, which yields to WK's own vocab-pronunciation `<audio>` element so they don't overlap (detect-then-listen for `ended` with a fixed-delay fallback for the Web-Audio-API case). The `autoPlayAudio` setting now only governs meaning-submit audio; reading-submit audio is unconditional. `handleDomChange` resets `state.answered = false` when `currentQuestionType()` changes mid-subject so the same card re-arms for the second question.
- **Tampermonkey doesn't auto-reload from disk.** After every edit, the user must paste the file contents into the Tampermonkey editor. The boot log line (`booting v<X.Y.Z>`) is the source of truth for which version is running.

## Diagnostic helpers (callable from browser console)

Exposed on `PAGE_WIN` at boot, so reachable directly from devtools:

- `openWkIkSettings()` — open the settings dialog directly. Useful if the WKOF menu link isn't visible in WK's avatar dropdown.
- `debugWkIk()` — dump four sections, top-to-bottom:
  1. Known reveal-panel selectors with their classList / hidden / computed display / `offsetParent` / `data-state` / `data-quiz-input-quiz-state-value`.
  2. `--- .quiz-input subtree (classes + data-*) ---` — every descendant of `.quiz-input` with non-empty class or `data-*` attrs. Used to identify graded-state markers if the bg-color reveal detection ever stops working.
  3. `--- bg-color chain from input → body ---` — computed `backgroundColor` of every ancestor from `#user-response` up to body. Used to see which element actually carries the green/red color if a future WK moves it from the input itself.
  4. `--- .character-header DOM tree (bbox in viewport coords) ---` — full recursive dump of `.character-header` and descendants with bounding box, computed `position`, computed `display`, and `font-size`. Used to diagnose vocab-character positioning issues (this is what surfaced the `.character-header__content` positioning trap).

## Cache keys (all in `wkof.file_cache`, IndexedDB-backed)

- `wk-ik-examples.ik.<word>` — full IK API response (30d TTL, 7d negative cache).
- `wk-ik-examples.img.<word>` — array of up to 10 DDG image URLs (30d TTL).
- `wk-ik-examples.ik-audio.<encoded-url>` — IK proxy MP3 as `{ buffer, type }` ArrayBuffer, or `{ failedAt }` for negative cache. Positive: no TTL. Negative: 7d.
- `wk-ik-examples.audio.<sentence>` — Google TTS MP3 as `{ buffer, type }` ArrayBuffer (not Blob — dodges wkof serialization quirks). No TTL.
- `wk-ik-examples.selections` — `{<word>: {s, i}}` map of last-used refresh-button indices. `s` = sentenceIdx, `i` = imageIdx (indexes into the combined IK+DDG pool). Refreshing a sentence resets `i` to 0 so the new sentence's IK screenshot becomes the default; refreshing an image only bumps `i`. No TTL.
- `wk-ik-examples.schema-version` — `{ version: <int> }`. Compared on boot against `CACHE_SCHEMA_VERSION`; on mismatch, all four data prefixes above are wiped (selections preserved) and the version key is updated. Bump `CACHE_SCHEMA_VERSION` whenever stale cache entries would be actively wrong (not just suboptimal) — e.g. v0.10.0 bumped it to 2 because old caches still mapped imageIdx into a DDG-only pool and would mis-resolve under the new IK+DDG pool semantics.

Settings dialog has a "Clear cache" button that wipes all five data prefixes (everything except the schema-version pin).
