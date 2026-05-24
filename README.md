# WK Vocab Review — ImmersionKit Examples

A [Tampermonkey](https://www.tampermonkey.net/) userscript that augments WaniKani vocab reviews with a real example sentence, voice-actor audio, and a scene image — inlaid directly into the big purple character header so you read, hear, and see the word in context the moment you finish answering.

## What it does

During every vocabulary review, the big purple character header is augmented in place:

- **Japanese example sentence** from [ImmersionKit](https://immersionkit.com) appears on the **left** of the vocab character — drawn from anime, drama, games, literature, and news, with the target word highlighted.
- **▶ Play button** for the sentence audio (see [How content is sourced](#how-content-is-sourced) for the full chain).
- **Scene screenshot or illustration** appears on the **right** of the vocab character (revealed on meaning submit).
- **English translation** of the sentence below the play button (also revealed on meaning submit).
- **Source attribution** (e.g. `— Fate Zero`, `— Skyrim`) under the controls.

### Behavior per question type

WaniKani asks meaning and reading as two separate questions per vocab. The card reacts differently to each:

- **Reading submit** → autoplays the sentence audio, queued *after* WaniKani's own vocab pronunciation so they don't overlap. Translation and image stay hidden so the meaning isn't spoiled.
- **Meaning submit** → reveals the translation + image. Sentence audio autoplays if you've turned that setting on. If you got meaning before reading this subject, the translation/image stay visible through the reading question that follows.

The reveal trigger is the input bar turning green or red — there's nothing to click, just answer.

### Refresh buttons

- **⟳ next to the sentence** — pick a different IK example for this word (cycles through up to 10). Also resets the image to the new sentence's IK screenshot.
- **⟳ overlaid on the image** — cycle through the combined pool `[IK screenshot, ...DuckDuckGo illustrations]`. Useful when an anime grab is too dark, too cluttered, or unhelpful — swap it for a clean illustration.

Your per-word selections persist in IndexedDB and survive page refreshes.

## Requirements

- A [WaniKani](https://www.wanikani.com/) account.
- [Tampermonkey](https://www.tampermonkey.net/) (or a compatible userscript manager that supports `@grant GM_xmlhttpRequest`).
- [WaniKani Open Framework (WKOF)](https://greasyfork.org/en/scripts/38582-wanikani-open-framework) — installed separately, must load before this script.

## Installation

1. Install Tampermonkey in your browser.
2. Install [WKOF](https://greasyfork.org/en/scripts/38582-wanikani-open-framework) from greasyfork.
3. In Tampermonkey → Dashboard → Utilities → Create a new script. Paste the contents of [wk-vocab-review-ik.user.js](wk-vocab-review-ik.user.js), save (⌘S / Ctrl+S).
4. Make sure WKOF is listed **above** this script in the Tampermonkey dashboard (drag to reorder; first-listed runs first).
5. When prompted, approve cross-origin connections to `apiv2.immersionkit.com`, `translate.googleapis.com`, and `duckduckgo.com`.
6. Reload any open WaniKani tab. Sanity check: DevTools console should show `[wk-ik-examples] booting v0.12.x on /...`.

## Settings

Open your WaniKani avatar dropdown (top right) → **Scripts** → **Settings** → **WK Vocab Review — ImmersionKit**.

| Setting | Default | What it does |
| --- | --- | --- |
| Auto-play audio on meaning reveal | off | When you submit a meaning answer, auto-play the sentence audio. Reading submits always auto-play (queued after WaniKani's own vocab pronunciation), independent of this setting. |
| Show image for the vocab word | on | Toggle the right-side image (IK screenshot or DDG illustration). |
| Which example to pick | Shortest | Sort order for the first sentence shown. Refresh button cycles through all candidates regardless. |
| Prefer examples from spoken media (anime/drama/games) | on | When on, IK examples that came with original audio are preferred over text-only literature lines (which would need TTS fallback). |
| Clear cache | — | Wipes locally cached examples, images, audio, and per-word selections. |

If you don't see the script under the Scripts menu, paste `openWkIkSettings()` into the browser console — it opens the settings dialog directly.

## How content is sourced

Four pipelines, with primary → fallback layering for audio and image:

- **Sentences and translations**: [ImmersionKit v2 API](https://apiv2.immersionkit.com) `/search` — real lines from anime, drama, games, literature, and news.
- **Audio (primary)**: ImmersionKit's `/download_media` proxy — the actual voice-actor recording from the source media. Available when the sentence's IK example has a `sound` field (i.e., came from anime/drama/games rather than text-only literature).
- **Audio (fallback)**: [Google Translate TTS](https://translate.googleapis.com/translate_tts) when IK has no audio for the sentence or the proxy fetch fails. If even TTS fails, the script falls back to your browser's built-in Japanese voice (Kyoko on macOS Chrome).
- **Image (primary)**: ImmersionKit's `/download_media` proxy for the scene screenshot — same URL shape as audio, different file extension.
- **Image (fallback)**: DuckDuckGo image search for `<word> イラスト` (illustration) when IK has no screenshot. The image-refresh button cycles through DDG results even when an IK screenshot exists, so you can swap a bad anime grab for a clean illustration.

## Privacy

- No API keys, no accounts.
- No analytics, no telemetry.
- All caching is local (IndexedDB via WKOF's `file_cache`).
- The script makes requests on your behalf to `apiv2.immersionkit.com`, `translate.googleapis.com`, and `duckduckgo.com`. These are declared in the `@connect` directives in the script header.

## Known limitations

- **Sentence coverage**: ImmersionKit doesn't have sentences for every vocab word. For uncommon ones, "No example found" stays in the bottom-left corner of the header until you move to the next subject.
- **Image quality varies**: DuckDuckGo image search is good for concrete nouns and verbs, hit-or-miss for abstract concepts. The IK screenshot is usually better for concrete scenes but can be cluttered. Cycle with ⟳ to taste.
- **Google TTS rate limits**: Heavy review pace can trigger a temporary block. The script falls back to browser TTS automatically.
- **TTS sentence length**: Google's endpoint caps inputs at ~200 characters; the script truncates longer sentences. Almost no IK sentence is close to this limit.

## Troubleshooting

- **No card appears on reviews** → Check the DevTools console for `[wk-ik-examples] ...` lines. The most useful is the `boot OK` line — if it's missing, the boot chain failed somewhere upstream (most often WKOF isn't loaded). Make sure WKOF is enabled and listed before this script in the Tampermonkey dashboard.
- **Translation/image doesn't reveal on answer submit** → Look for `reveal triggered by:` in the console. The expected match is `bg:red(...)` or `bg:green(...)` — meaning the script saw WaniKani paint the input bar. If you only see `…visible(fallback)`, the bg-color check missed and we fell through to the Item-Info-coupled fallback; run `debugWkIk()` right after submitting and paste the output into an issue.
- **Card looks misaligned (vocab character not centered, content overlapping, etc.)** → Run `debugWkIk()` and paste the `--- .character-header DOM tree ---` section. That output is what lets us identify positioning-context traps inside WaniKani's CSS.
- **Audio plays twice or overlaps WaniKani's pronunciation** → On a reading submit, the script waits for any non-its-own `<audio>` element to finish before playing. If WaniKani is using Web Audio API (no DOM `<audio>`), the script falls back to a fixed 2.5s delay; in rare cases that delay might be too short for a long pronunciation.
- **Duplicate cards or stale behavior after editing the script** → You may have two copies installed in Tampermonkey. The boot log shows the version; if you see two boot lines, delete one copy.

## Development

This is a single-file project. The whole script is in [wk-vocab-review-ik.user.js](wk-vocab-review-ik.user.js); there's no build step or test suite. Edit the file, bump both the `@version` line and the `SCRIPT_VERSION` constant, run `node --check wk-vocab-review-ik.user.js`, then paste the contents into the Tampermonkey editor to test. Hard-refresh the WaniKani review page after each save.

See [CLAUDE.md](CLAUDE.md) for architecture notes and dead-end warnings if you're using an AI coding agent on this project.

## Credits

- [acwool](https://community.wanikani.com/u/acwool) — WaniKani Open Framework (WKOF).
- [awoo](https://greasyfork.org/en/users/awoo) — [JPDB Immersion Kit Examples](https://greasyfork.org/en/scripts/507408-jpdb-immersion-kit-examples) script, whose URL-construction approach informed earlier iterations of this script.
- [ImmersionKit](https://immersionkit.com) — sentence corpus and the `download_media` proxy that makes all of this possible.
