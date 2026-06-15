# 歌 / Songs — UX mockups

Annotated, click-through mockups for the proposed **Songs (歌)** tab — a song & lyric
analysis surface for the study-app. Rendered in the real app design language (the tokens +
component looks from [`../../src/styles.css`](../../src/styles.css)).

**This is a design artifact, not shipped code.** Architecture is a separate conversation;
these screens capture the agreed UX + featureset only. Decisions are also recorded in the
project memory `song-lyric-tab-design`.

## How to view

- **Interactive browser:** open [`index.html`](index.html) in any browser — a sidebar lists
  every screen, with a **Light / Dark** theme toggle.
- **Flat images:** `screens/*.png` — one annotated PNG per screen (retina 2×). Hero screens
  also have `*-dark.png` variants.

Each screen carries numbered callouts (①②③…) keyed to a **Design notes** legend at the
bottom that ties every choice back to an existing app mechanism it reuses.

## Screens

| # | Screen | What it shows |
|---|--------|---------------|
| 1 | Library | Hybrid landing grid: your songs + a CC/public-domain starter set, word-coverage, progress rings, source badges |
| 2 | Add — Paste | BYO entry: paste lyrics + a YouTube link |
| 3 | Add — Review | Full-auto analysis (furigana + per-line English + grammar + JLPT) with confidence flags, ready to skim & save |
| 4 | Song — Read | The lyric viewer: synced highlight, furigana toggle, reveal-on-tap translation, tap-a-word lookup, grammar chips |
| 5 | Listen — Cloze | Dictation, easier: blanks in the visible sheet |
| 6 | Listen — Full line | Dictation, harder: lyrics hidden, transcribe the line |
| 7 | Song — Shadow | Record & compare per line; reference = TTS / YouTube-slice / upload (the iframe-decode caveat) |
| 8 | Line timing | Optional tap-to-sync pass that unlocks synced playback/dictation/shadowing |
| 9 | Mine — Vocab & grammar | Words by JLPT (known vs new) + bulk-add to SRS; grammar points with counts |
| 10 | Grammar point | Reference + cross-links + "save line as a shadow phrase" (no new SRS card type) |
| 11 | Read — Mobile | The same surfaces, responsive (~390px) |

## Decisions captured here

- **Hybrid library** — BYO songs (private rows) + a small CC/public-domain/Vocaloid starter set.
- **YouTube embed** for audio + **optional** tap-to-sync line timing.
- **Full-auto analysis** on add (the one genuinely new capability), with a proofread/save step.
- **Four modes** — Read · Listen (cloze ⇄ full-line) · Shadow (TTS full-rig default; YouTube by-ear) · Mine.
- **Mining** — vocab → SRS under `Source:〈song〉`; grammar → reference + cross-links **and** save-line-as-shadow-phrase.

## Regenerating the PNGs

```sh
./shoot.sh                 # all screens, light theme
./shoot.sh 04-read         # one screen
```

Captures with headless Chrome (auto-sizes the window to each page's height). Light theme by
default; the gallery toggles dark live, and `screens/*-dark.png` were captured with
`?theme=dark`.
