# WKEnhanced

A [Tampermonkey](https://www.tampermonkey.net/) userscript that augments WaniKani vocab reviews with a real example sentence, voice-actor audio, and a scene image — inlaid directly into the big purple character header so you read, hear, and see the word in context the moment you finish answering.

This repo contains three surfaces:

- **The userscript** ([`wkenhanced.user.js`](wkenhanced.user.js)) — what you install in Tampermonkey. This README covers it.
- **A backing API server** ([`wk-enhanced-api/`](wk-enhanced-api/)) — Bun + Hono + SQLite, deployed at `https://api.wkenhanced.dev`. Pre-warms ImmersionKit, Google TTS, and DuckDuckGo data so every userscript user doesn't have to hit those services individually. The userscript talks to this server exclusively as of v2.0.0. See [wk-enhanced-api/README.md](wk-enhanced-api/README.md) and [SERVER_DESIGN.md](SERVER_DESIGN.md).
- **A standalone study app** ([`study-app/`](study-app/)) — the 日常日本語 Japanese trainer (Vite SPA + nginx) at `https://wkenhanced.dev`, with email/password accounts + per-user sync, backed by the same API. Its own docs: [study-app/README.md](study-app/README.md).

A frozen direct-path snapshot of the v1.1.1 userscript (which talked to ImmersionKit, DuckDuckGo, and Google Translate TTS straight from the browser) was kept at `legacy/` as an outage fallback; it was **removed in the 2026-06 cleanup** now that the API path is stable, and is recoverable from git history.

## What it does

During every vocabulary review, the big purple character header is augmented in place:

- **Japanese example sentence** from [ImmersionKit](https://immersionkit.com) appears on the **left** of the vocab character — drawn from anime, drama, games, literature, and news, with the target word highlighted.
- **▶ Play button** for the sentence audio (see [How content is sourced](#how-content-is-sourced) for the full chain).
- **ふ furigana toggle** next to the play button — small kana above kanji. Hidden until you answer the reading; layout space is reserved from the start so revealing doesn't bump the sentence line.
- **Scene screenshot or illustration** appears on the **right** of the vocab character (revealed on meaning submit). Hover to grow it; click to open fullscreen.
- **English translation** of the sentence below the controls (also revealed on meaning submit).
- **Source attribution** (e.g. `— Fate Zero`, `— Skyrim`) under the controls.

### Behavior per question type

WaniKani asks meaning and reading as two separate questions per vocab. Each supplementary element is gated on the specific question that would spoil it:

- **Reading submit** → uncovers furigana on the sentence (the reading IS what's being tested). Autoplays the sentence audio, queued *after* WaniKani's own vocab pronunciation so they don't overlap.
- **Meaning submit** → uncovers translation + image (English-side spoilers — they don't expose the reading). Autoplays the sentence audio if you've turned that setting on.
- Order doesn't matter. Whichever you answer second, the previously-revealed elements stay visible.

The reveal trigger is the input bar turning green or red — there's nothing to click, just answer.

### Refresh buttons

- **⟳ next to the sentence** — pick a different IK example for this word. Also resets the image to the new sentence's IK screenshot.
  - **Right-click or long-press the ⟳** to open the sentence picker: a modal listing every IK candidate for this word (commonly tens to hundreds), paginated 25 per page. A sort dropdown lets you order by sentence length (short→long or long→short), JLPT level (easy→hard or hard→easy), or source name. Each row shows the Japanese sentence, English translation, a colored JLPT badge, and the source title. Sentences above your JLPT ceiling are faded but still clickable.
- **⟳ overlaid on the image** — cycle through the combined pool `[IK screenshot, ...DuckDuckGo illustrations]`. Useful when an anime grab is too dark, too cluttered, or unhelpful — swap it for a clean illustration.

Your per-word selections persist in IndexedDB and survive page refreshes.

### JLPT difficulty ceiling + preferred level

Two independent JLPT settings let you tune sentence selection:

- **JLPT difficulty ceiling** — *hard filter.* Sentences whose hardest known surrounding word is above this level are removed from selection entirely. Falls back to showing some sentence when no candidate qualifies, so you're never stuck staring at an empty card.
- **Preferred JLPT level** — *soft preference.* Within whatever the ceiling allows, sentences at this exact level come first in the ⟳ cycle and the sentence picker opens with "Preferred JLPT (NX) first" as the initial sort. Set ceiling=Any and preferred=N3 to see anything but default to N3.

Scoring is computed server-side and arrives with every example payload. Conjugated verbs and proper nouns are treated as unknown rather than blocking (fail-open), which means the filter is strict on identifiable nouns/adjectives and permissive on inflected verbs.

## Requirements

- A [WaniKani](https://www.wanikani.com/) account.
- [Tampermonkey](https://www.tampermonkey.net/) (or a compatible userscript manager).
- [WaniKani Open Framework (WKOF)](https://greasyfork.org/en/scripts/38582-wanikani-open-framework) — installed separately, must load before this script.

## Installation

1. Install Tampermonkey in your browser.
2. Install [WKOF](https://greasyfork.org/en/scripts/38582-wanikani-open-framework) from greasyfork.
3. In Tampermonkey → Dashboard → Utilities → Create a new script. Paste the contents of [wkenhanced.user.js](wkenhanced.user.js), save (⌘S / Ctrl+S).
4. Make sure WKOF is listed **above** this script in the Tampermonkey dashboard (drag to reorder; first-listed runs first).
5. When prompted, approve the cross-origin connection to `api.wkenhanced.dev` (and `localhost` if you're running the server locally for dev).
6. Reload any open WaniKani tab. Sanity check: DevTools console should show `[wkenhanced] booting v2.0.0 on /...`.

## Settings

Open your WaniKani avatar dropdown (top right) → **Scripts** → **Settings** → **WKEnhanced**.

| Setting | Default | What it does |
| --- | --- | --- |
| Auto-play audio on meaning reveal | off | When you submit a meaning answer, auto-play the sentence audio. Reading submits always auto-play (queued after WaniKani's own vocab pronunciation), independent of this setting. |
| Show image for the vocab word | on | Toggle the right-side image (IK screenshot or DDG illustration). |
| Show furigana on the example sentence | on | When on, the example sentence is rendered with furigana DOM from the start (layout-reserved, characters invisible) and the kana characters become visible after you submit the reading. The per-card ふ button toggles visibility without changing this default. |
| Hotkey to replay audio | `p` | Single key (no modifiers) to replay the example-sentence audio. Skipped while you're typing your answer; works after submit even with the input focused. Leave blank to disable. |
| Audio playback speed | 1x | Dropdown 0.5x / 0.75x / 1x / 1.25x. Applies to all audio sources; takes effect on the next card render. |
| Which example to pick | Shortest | Sort order for the first sentence shown. ⟳ cycles through candidates regardless; the picker has its own sort dropdown. |
| Prefer examples from spoken media (anime/drama/games) | on | When on, examples that came with original voice-actor audio are preferred over text-only literature lines (which would need TTS fallback). |
| JLPT difficulty ceiling | Any | Hard filter — sentences whose hardest known surrounding word is above this level are removed from selection entirely. The sentence picker still shows above-ceiling candidates (faded) so you can override per card. |
| Preferred JLPT level | No preference | Soft preference — within whatever the ceiling allows, sentences at this exact level come first in the ⟳ cycle, and the picker opens with "Preferred JLPT (NX) first" as the initial sort. Independent of the ceiling: you can set ceiling=Any and still default to N3 sentences. |
| API server URL | `https://api.wkenhanced.dev` | Base URL of the wk-enhanced-api server. For local dev, set to `http://localhost:3000`. Leave blank only if you want cards to render empty (e.g. you're testing the UI shell without server data). |
| Prefetch upcoming subjects | 10 | On review-session entry, batch-fetch this many upcoming subjects via `POST /v1/vocab/batch` so subsequent cards render instantly from local cache. Capped at 50. |
| Cache contents | — | Live read-only view of what's currently cached (API-server payloads + per-word selections). Refreshes after Clear cache. |
| Clear cache | — | Wipes the local payload cache, per-word selections, and any leftover entries from v1.x (the `wk-ik-examples.*` and `wk-vocab-cache.*` prefixes from the pre-rename era). |

If you don't see the script under the Scripts menu, paste `openWkEnhancedSettings()` into the browser console — it opens the settings dialog directly.

Two extra console helpers exist for diagnostics: `debugWkEnhanced()` (general DOM + reveal-state dump) and `debugWkEnhancedApi('<word>')` (probes the configured API server's `/v1/health`, runs a sample fetch, dumps the local cache for that word). Both are no-ops until the page has fully booted; see the console for `boot OK` first.

## How content is sourced

The userscript talks only to `api.wkenhanced.dev`. The server does all the upstream coordination — these are the sources it draws from:

- **Sentences and translations**: [ImmersionKit v2 API](https://apiv2.immersionkit.com) `/search` — real lines from anime, drama, games, literature, and news.
- **Audio (primary)**: ImmersionKit's `/download_media` proxy — the actual voice-actor recording from the source media. Available when the sentence's IK example has a `sound` field (i.e., came from anime/drama/games rather than text-only literature).
- **Audio (fallback)**: [Google Translate TTS](https://translate.googleapis.com/translate_tts) when IK has no audio for the sentence or the proxy fetch fails. If the resolved CDN URL still fails to play in your browser, the userscript falls back to your browser's built-in Japanese voice (Kyoko on macOS Chrome).
- **Image (primary)**: ImmersionKit's `/download_media` proxy for the scene screenshot — same URL shape as audio, different file extension.
- **Image (fallback)**: DuckDuckGo image search for `<word> イラスト` (illustration) when IK has no screenshot. The image-refresh button cycles through DDG results even when an IK screenshot exists, so you can swap a bad anime grab for a clean illustration.

All of this is fetched, cached, and served by the API server. The userscript receives pre-resolved CDN URLs and renders them directly — no third-party network calls happen from your browser. See [wk-enhanced-api/README.md](wk-enhanced-api/README.md) for the server architecture.

## Privacy

- No API keys, no accounts.
- No analytics, no telemetry.
- The userscript talks only to `api.wkenhanced.dev` (declared in the `@connect` directive) and your WKOF-managed IndexedDB.
- The API server logs structured request events (word, cache status, latency) but doesn't tie them to user identity.

## Known limitations

- **Sentence coverage**: ImmersionKit doesn't have sentences for every vocab word. For uncommon ones, "No example found" stays in the bottom-left corner of the header until you move to the next subject. (~85% coverage of the WK corpus as of the last bulk warm.)
- **Image quality varies**: DuckDuckGo image search is good for concrete nouns and verbs, hit-or-miss for abstract concepts. The IK screenshot is usually better for concrete scenes but can be cluttered. Cycle with ⟳ to taste.
- **Cold-fill latency**: A word the server hasn't seen before triggers a server-side warm (typically 1–3 seconds with the DDG fallback deferred to a background task). Most words will already be cached from the monthly bulk warm.

## Troubleshooting

- **No card appears on reviews** → Check the DevTools console for `[wkenhanced] ...` lines. The most useful is the `boot OK` line — if it's missing, the boot chain failed somewhere upstream (most often WKOF isn't loaded). Make sure WKOF is enabled and listed before this script in the Tampermonkey dashboard.
- **Cards render empty for every word** → Most likely the API server is unreachable. Run `debugWkEnhancedApi()` in the console; it probes `/v1/health` and dumps the resolved URL. If `api.wkenhanced.dev` is genuinely down, the cards stay empty until it's back (there's no longer a browser-direct fallback).
- **Translation/image doesn't reveal on answer submit** → Look for `reveal triggered by:` in the console. The expected match is `bg:red(...)` or `bg:green(...)` — meaning the script saw WaniKani paint the input bar. If you only see `…visible(fallback)`, the bg-color check missed and we fell through to the Item-Info-coupled fallback; run `debugWkEnhanced()` right after submitting and paste the output into an issue.
- **Card looks misaligned (vocab character not centered, content overlapping, etc.)** → Run `debugWkEnhanced()` and paste the `--- .character-header DOM tree ---` section. That output is what lets us identify positioning-context traps inside WaniKani's CSS.
- **Audio plays twice or overlaps WaniKani's pronunciation** → On a reading submit, the script waits for any non-its-own `<audio>` element to finish before playing. If WaniKani is using Web Audio API (no DOM `<audio>`), the script falls back to a fixed 2.5s delay; in rare cases that delay might be too short for a long pronunciation.
- **Duplicate cards or stale behavior after editing the script** → You may have two copies installed in Tampermonkey. The boot log shows the version; if you see two boot lines, delete one copy.

## Development

The userscript is a single file with no build step or test suite. The whole script is in [wkenhanced.user.js](wkenhanced.user.js); edit the file, bump both the `@version` line and the `SCRIPT_VERSION` constant, run `node --check wkenhanced.user.js`, then paste the contents into the Tampermonkey editor to test. Hard-refresh the WaniKani review page after each save.

The API server is a separate Bun + Hono + SQLite codebase in [wk-enhanced-api/](wk-enhanced-api/) with its own README + tests + typecheck. See [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) for architecture notes.

See [CLAUDE.md](CLAUDE.md) for project-wide architecture notes and dead-end warnings if you're using an AI coding agent on this project.

## Credits

- [acwool](https://community.wanikani.com/u/acwool) — WaniKani Open Framework (WKOF).
- [awoo](https://greasyfork.org/en/users/awoo) — [JPDB Immersion Kit Examples](https://greasyfork.org/en/scripts/507408-jpdb-immersion-kit-examples) script, whose URL-construction approach informed earlier iterations.
- [ImmersionKit](https://immersionkit.com) — sentence corpus and the `download_media` proxy that makes all of this possible.
- [jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) — JLPT vocabulary word lists (MIT) bundled into the API server.
