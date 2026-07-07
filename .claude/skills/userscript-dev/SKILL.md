---
name: userscript-dev
description: Edit, extend, or debug the WKEnhanced Tampermonkey userscript (wkenhanced.user.js): version pairing, @grant/@connect metadata, WKOF sandbox rules, reveal logic, fetch/cache semantics, console diagnostics. Use for ANY change to wkenhanced.user.js, any WaniKani review-page feature (example sentences, audio autoplay, images, furigana reveal, sentence picker, prefetch), or when a review card misbehaves or renders empty. Read BEFORE touching the file — its invariants are cheap to violate.
---

# Userscript development — wkenhanced.user.js

You are changing the Tampermonkey userscript that injects example sentences, audio, and
images into WaniKani vocab reviews. It is one hand-maintained file with no build step, no
tests, and no way for you to run it — so correctness comes from procedure: version pairing,
syntax check, and respecting a set of hard-won invariants documented here and in the root
`CLAUDE.md`. This skill is the procedure.

## Before you start

- The whole surface is ONE file at repo root: `wkenhanced.user.js` (~3.8k lines as of
  2026-07). No package.json, no test suite. The in-file comments are maintained as real
  documentation — read the section you're about to touch, and treat its comments as claims
  you must keep true.
- Root `CLAUDE.md` (auto-loaded) is the authoritative doc for this surface. Its
  **"Things that look like bugs but aren't"** section is required reading before touching
  reveal/DOM/positioning code — every entry there cost hours to learn.
- Check what version is current before bumping (2.0.5 as of 2026-07):

  ```sh
  grep -n "@version\|SCRIPT_VERSION = " wkenhanced.user.js
  ```

  This prints exactly two lines; they must carry the same version string.
- Recent history orients fast: `git log --oneline -10 -- wkenhanced.user.js`.

## The edit checklist (do these in order, every time)

1. **Read the target section + its comments.** Plan the change against the traps below.
2. **Make the edit.** Fix any comments your change makes stale in the same edit (maintainer
   expectation — stale comments are treated as bugs; mention the fixes in your summary).
3. **Bump BOTH version markers together**: the `// @version` line in the metadata block AND
   the `SCRIPT_VERSION` constant. They must match — the boot log prints `SCRIPT_VERSION`,
   and that log line is the only reliable way to know which version is actually running in
   the user's browser. Re-run the grep from "Before you start" to confirm both moved.
   Sizing follows repo practice: features and fixes alike get patch bumps (v2.0.1–v2.0.5
   were all patches, including new features); reserve minor/major for architectural shifts
   like the v2.0.0 server migration.
4. **Syntax-check**: `node --check wkenhanced.user.js` — silent exit means pass. This is
   the entire automated safety net; never skip it.
5. **Update root `CLAUDE.md`** if your change alters anything it documents (reveal
   semantics, cache keys, settings, external services, diagnostics, dead-ends). Same commit.
6. **Commit** — one feature = one commit, without waiting to be asked. House style (see
   `git log`): `userscript: <what changed> (vX.Y.Z)`. Full commit discipline lives in the
   `land-a-change` skill.
7. **Tell the user to re-import**: Tampermonkey does NOT reload the file from disk. The
   user pastes the new contents into the Tampermonkey editor themselves. Ask them to
   confirm the console shows `[wkenhanced] booting v<X.Y.Z>` with your new version.

## You cannot test this in a browser — do not try

The script only runs inside WaniKani review sessions under Tampermonkey, on the user's
logged-in account. Never attempt to load it in a browser yourself. What you CAN do:

- `node --check` (syntax), careful code reading, and tracing state by hand.
- Ask the user to run the console helpers and paste output. All three are exposed on the
  page window at boot:
  - `debugWkEnhanced()` — DOM/reveal-state dump (5 sections: reveal selectors, quiz-input
    subtree, bg-color chain, quiz-queue Stimulus roots, character-header tree).
  - `debugWkEnhancedApi('食べる')` — settings + resolved base URL, `/v1/health` probe, raw
    `GET /v1/vocab/<word>`, local payload-cache snapshot. First stop for data problems.
  - `openWkEnhancedSettings()` — opens the settings dialog directly.
- Probe the server yourself with plain read-only curl:
  `curl https://api.wkenhanced.dev/v1/health` (allowed; anything beyond GETs is not).

If a card renders empty, don't guess — follow root `CLAUDE.md` "When a card renders empty"
(boot log → `debugWkEnhancedApi` branches → single-word re-warm), and see the
`troubleshoot` skill for the cross-surface playbooks.

## Sandbox rules (why your console global "doesn't exist")

`@grant unsafeWindow` puts the script in Tampermonkey's sandbox, but WKOF is installed by a
*different* userscript on the page's own window. The bridge is at the top of the IIFE:

```js
const PAGE_WIN = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
const wkof = PAGE_WIN.wkof;
```

Any global that must be reachable from devtools (debug helpers, settings opener) must be
assigned on `PAGE_WIN`, not `window` — sandbox-`window` globals are invisible to the page
console. WKOF modules used: `Menu`, `Settings`, `file_cache`, `load_script` (minimum WKOF
version `1.0.52`, enforced at boot). The Turbo Events library (review-page lifecycle hooks)
is loaded at runtime via `wkof.load_script` from greasyfork script id 501980, with a
`DOMContentLoaded` fallback if absent.

## Network rules

The userscript talks to exactly ONE network target: the WKEnhanced API
(`https://api.wkenhanced.dev` prod, `http://localhost:3000` dev — constants
`PROD_API_BASE` / `DEV_API_BASE`, user-overridable via the `apiServerUrl` setting). Plain
`fetch()` suffices because the server's CORS is permissive; `GM_xmlhttpRequest` was dropped
in v2.0.0.

- **Changing external services means updating BOTH `@connect` and `@grant` metadata
  directives** — Tampermonkey re-prompts the user for permissions when metadata changes, so
  flag it in your summary. Current `@connect` entries: `api.wkenhanced.dev`, `localhost`.
- Exception that needs no directive: the click-to-lookup feature (`clickToLookup` setting)
  opens jisho.org via plain `<a target="_blank">` links (built by `linkifyWords`) — browser
  navigation, not a fetch.
- Two endpoints in use: `GET /v1/vocab/{word}` (per-card payload, ETag/If-None-Match
  revalidation, 30s timeout — must absorb a server-side cold lazy-warm, worst observed
  ~25s) and `POST /v1/vocab/batch` (prefetch, chunks of `SERVER_BATCH_MAX` = 50, 10s
  timeout, never throws). If you change the payload shape expectations, the server side
  must change too — schema at `wk-enhanced-api/src/schemas/vocab.ts`
  (`VocabPayloadSchema`), client adapter `serverPayloadToCacheEntry`; see the `api-dev`
  skill.

### `cache: 'no-cache'` is load-bearing — never remove it

`GET_FETCH_OPTS` (spread into every GET, including `debugWkEnhancedApi`'s probes) carries
`cache: 'no-cache'`. The server advertises `Cache-Control: max-age=86400` for CDN benefit;
without `no-cache`, Chrome honors that as a browser-cache directive — a word fetched
mid-bulk-warm returns an empty payload, Chrome caches it for 24h, and the userscript keeps
re-reading that stale empty body even after the server row is populated (this shipped as a
real incident; the fix is v1.1.1's). `no-cache` forces conditional revalidation: with
`If-None-Match` it collapses to a cheap 304, so ETag bandwidth savings survive. The batch
POST doesn't need it (browsers don't cache POSTs). Full write-up: root `CLAUDE.md`
dead-ends + the comment block above `GET_FETCH_OPTS`.

## Cache keys (wkof.file_cache, IndexedDB-backed)

| Key | Value shape | Writers | TTL |
|---|---|---|---|
| `wkenhanced.payload.<word>` | `{ payload, etag, savedAt }` | `saveServerPayload` (called by `fetchVocab` on 200 and 304-refresh, and by `fetchVocabBatch` — batch entries land etag-less; the next direct GET backfills the etag) | 7 days; 60s when `payload.incomplete === true` (server still DDG-warming in background) — enforced by `isServerCacheFresh` |
| `wkenhanced.selections` | `{ selections: {<word>: {s, i, b}}, savedAt }` | `saveSelections` via `persistCurrentSelection` | none |

Selections semantics: `s` = sentence index, `i` = image index, `b` = JLPT-ceiling bypass
flag (user picked an above-ceiling sentence via the picker; restored so it still renders).
`refreshSentence()` bumps `s` and RESETS `i` to 0 (the new sentence's own screenshot
becomes default); `refreshImage()` only bumps `i`. Keep the keys' shapes in sync with the
"Cache keys" section of root `CLAUDE.md` if you change them. The settings dialog's "Clear
cache" button wipes both prefixes plus leftover v1.x prefixes (`wk-ik-examples.*`,
`wk-vocab-cache.*`) — those orphans are a known, accepted disk leak; don't add wipe-on-boot
logic.

Settings themselves live separately in `wkof.Settings` under id `wkenhanced` — defaults in
the `DEFAULTS` constant (`autoPlayAudio`, `showImage`, `showFurigana`, `clickToLookup`,
`playHotkey`, `playbackRate`, `sentencePreference`, `requireAudio`, `jlptCeiling`,
`jlptPreferred`, `apiServerUrl`, `prefetchCount`).

## Reveal architecture (read before touching reveal/DOM code)

WK asks two questions per vocab subject (meaning, reading). Each supplementary element is
gated on the specific question it would spoil: meaning-submit reveals translation + image
(+ optional autoplay per `autoPlayAudio`); reading-submit reveals furigana and ALWAYS
autoplays sentence audio via `autoplayAfterWkAudio` (queued behind WK's own vocab
pronunciation). Order-independent. Progress lives in `state.subjectProgress`
(`{ subjectId → { meaningAnswered, readingAnswered } }`) because WK interleaves subjects in
shuffled reviews — `state.meaningAnswered`/`state.readingAnswered` are just mirrors of the
current subject's entry, and `renderCard` reads them so a revisit renders already-revealed.

Five dead-ends govern this area — one line each here; the full explanations (and the WHY)
are in root `CLAUDE.md` "Things that look like bugs but aren't". Do not re-investigate
them; re-read them:

1. **WK clones our card during the reveal animation** — `dedupeCards()` removes duplicates
   on every mutation (logs `dedupe: removed N stale card clone(s)`). Don't "fix" the
   double-render some other way.
2. **Answer detection is computed background-color, not classes/attributes** —
   `answerHasBeenSubmitted()` reads `#user-response`'s bg (red `rgb(255, 0, 51)` / green
   `rgb(136, 204, 0)`, set via form-validation pseudo-classes that are invisible to
   classList) and walks up to 10 ancestors. The `.subject-info` visibility check is a
   last-resort fallback only. Visibility checks need `offsetParent !== null`, not
   `[hidden]`.
3. **`.character-header__characters` positions against `__content`, not the header** —
   `injectStyles` forces `__content` to `position: static` so the glyph centers in our
   280px host. Don't re-litigate the centering.
4. **Reveals are per-question, per-subject, submission-not-correctness** — flags flip on
   submit (right or wrong) and stay sticky for the session; `handleDomChange` re-arms
   `state.answered` when `currentQuestionType()` flips mid-subject but never resets the
   per-subject flags.
5. **Tampermonkey doesn't auto-reload from disk** — a "bug that won't reproduce" is
   usually the user running the previous version. Check the boot log version first.

## Verify (definition of done for a userscript change)

1. `node --check wkenhanced.user.js` → exits silently.
2. `grep -n "@version\|SCRIPT_VERSION = " wkenhanced.user.js` → two lines, same new version.
3. Root `CLAUDE.md` still tells the truth about anything you touched.
4. Committed (one feature = one commit), then hand off: ask the user to re-import and
   confirm `[wkenhanced] booting v<new>` plus the `boot OK` line (it lists the three
   console helpers). For data-path changes, also ask for `debugWkEnhancedApi('食べる')`
   output; for reveal/DOM changes, `debugWkEnhanced()` output.
5. Give the user a short prose summary of what changed and why — not just a diff (see
   `land-a-change`).

## Traps beyond the reveal five

- **CSS class prefix stays `wk-ik`** (`wk-ik-card`, `wk-ik-host`, ...) despite the
  WKEnhanced rebrand — renaming would churn ~140 hardcoded rule strings in `injectStyles`
  for zero user-facing benefit. Rebrand surface is `@name`, `SCRIPT_TITLE`, log lines.
- **Don't remove `cache: 'no-cache'`** (section above) unless the server's `max-age` is
  first reduced to something tiny with `must-revalidate`.
- **Log prefix discipline**: every log line starts `[wkenhanced]` (via `SCRIPT_ID`) — keep
  it, the playbooks grep for it.
- **The v1.x browser-direct path is gone** (removed with the `legacy/` snapshot, 2026-06).
  Don't reintroduce direct ImmersionKit/DDG/TTS calls; recover from git history only for a
  prolonged server outage.

## Ground truth (re-verify here when updating this skill)

As of 2026-07 (userscript v2.0.5):

- `wkenhanced.user.js` — the file itself: metadata block (top), constants
  (`SCRIPT_VERSION`, `DEFAULTS`, `GET_FETCH_OPTS`, TTLs), boot chain, and the maintained
  in-file comments. Key symbols: `fetchVocab`, `fetchVocabBatch`, `getExamples`,
  `saveServerPayload`, `isServerCacheFresh`, `dedupeCards`, `answerHasBeenSubmitted`,
  `currentQuestionType`, `handleDomChange`, `renderCard`, `linkifyWords`,
  `autoplayAfterWkAudio`, `debugWkEnhanced`, `debugWkEnhancedApi`.
- Root `CLAUDE.md` — sections "How to work on it", "Things that look like bugs but
  aren't", "Diagnostic helpers", "When a card renders empty", "Cache keys".
- `git log --oneline -- wkenhanced.user.js` — commit style + change history.
- `ROADMAP.html` — userscript backlog under `us-*` ids (17 open as of 2026-07); see the
  `roadmap` skill for how to read/add records.
- Server counterpart: `wk-enhanced-api/CLAUDE.md` + `wk-enhanced-api/src/schemas/vocab.ts`
  — see the `api-dev` skill.
