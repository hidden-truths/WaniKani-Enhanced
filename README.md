# WK Vocab Review — ImmersionKit Examples

A [Tampermonkey](https://www.tampermonkey.net/) userscript that augments WaniKani vocab reviews with a real example sentence, voice-actor audio, and a scene image — inlaid directly into the big purple character header so you read, hear, and see the word in context the moment you finish answering.

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

- **⟳ next to the sentence** — pick a different IK example for this word. Shows a visible `N/M` counter so you can see how far you are through the pool. Also resets the image to the new sentence's IK screenshot.
  - **Right-click or long-press the ⟳** to open the sentence picker: a modal overlay listing every IK candidate (up to 10) with its source title. Click any row to jump to it directly instead of cycling blindly. Sentences above your JLPT ceiling are faded but still clickable.
- **⟳ overlaid on the image** — cycle through the combined pool `[IK screenshot, ...DuckDuckGo illustrations]`, with its own `N/M` counter. Useful when an anime grab is too dark, too cluttered, or unhelpful — swap it for a clean illustration.

Your per-word selections persist in IndexedDB and survive page refreshes.

### JLPT difficulty ceiling

You can constrain example sentences to a chosen JLPT level (Settings → "JLPT difficulty ceiling"). When set, the script prefers sentences whose hardest known surrounding word stays at or below your ceiling — useful for keeping comprehension exercises within range while studying for a specific level. Falls back to showing some sentence when no candidate qualifies, so you're never stuck staring at an empty card. Scoring uses a bundled JLPT vocab list (~7600 words from N5 to N1); conjugated verbs and proper nouns are treated as unknown rather than blocking (fail-open), which means the filter is strict on identifiable nouns/adjectives and permissive on inflected verbs.

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
6. Reload any open WaniKani tab. Sanity check: DevTools console should show `[wk-ik-examples] booting v0.22.x on /...`.

## Settings

Open your WaniKani avatar dropdown (top right) → **Scripts** → **Settings** → **WK Vocab Review — ImmersionKit**.

| Setting | Default | What it does |
| --- | --- | --- |
| Auto-play audio on meaning reveal | off | When you submit a meaning answer, auto-play the sentence audio. Reading submits always auto-play (queued after WaniKani's own vocab pronunciation), independent of this setting. |
| Show image for the vocab word | on | Toggle the right-side image (IK screenshot or DDG illustration). |
| Show furigana on the example sentence | on | When on, the example sentence is rendered with furigana DOM from the start (layout-reserved, characters invisible) and the kana characters become visible after you submit the reading. The per-card ふ button toggles visibility without changing this default. |
| Hotkey to replay audio | `p` | Single key (no modifiers) to replay the example-sentence audio. Skipped while you're typing your answer; works after submit even with the input focused. Leave blank to disable. |
| Audio playback speed | 1x | Dropdown 0.5x / 0.75x / 1x / 1.25x. Applies to all audio sources; takes effect on the next card render. |
| Which example to pick | Shortest | Sort order for the first sentence shown. Refresh button cycles through all candidates regardless. |
| Prefer examples from spoken media (anime/drama/games) | on | When on, IK examples that came with original audio are preferred over text-only literature lines (which would need TTS fallback). |
| JLPT difficulty ceiling | Any | Filter sentences to those whose hardest known surrounding word is at or below the chosen level (N5–N1). The sentence picker still shows above-ceiling candidates (faded) so you can override per card. |
| Cache contents | — | Live read-only view of what's currently cached (examples, image URL lists, audio clips, per-word selections, the IK index_meta map). Refreshes after Clear cache. |
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
- [jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) — JLPT vocabulary word lists (MIT) bundled into the script for the JLPT difficulty ceiling.
