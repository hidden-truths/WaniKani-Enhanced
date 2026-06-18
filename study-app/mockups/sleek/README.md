# sleek/ — 2026-06 "make it modern" redesign exploration

A fresh visual-design pass on the study app, one redesign generation past the shipped
"Day / Night" hybrid. Goal: keep the soul (functional line-colour, hanko seals, pitch
overlines, big editorial type, JP-first) but make it read **modern & sleek**, not
sepia-safe. Full critique: [../DESIGN_AUDIT_2026-06.md](../DESIGN_AUDIT_2026-06.md).

Each file is a **self-contained HTML mock** (Google Fonts + inline CSS, no build). Serve
with the `sleek-mocks` launch config (python http.server on :5192) and use the **Day / Night
toggle** bottom-right.

## Three directions explored

| File | Direction | One line |
|---|---|---|
| `genko.html` | **原稿 GENKŌ** | Rice-paper + sumi ink + vermilion **red-pen**; 原稿 manuscript grid + 縦書き rails. Editorial & structured. |
| `yoru.html` | **夜 YORU** | Black lacquer 漆 + maki-e **gold** 金, glass, serif-italic meaning, glow. Premium & cinematic (dark-first). |
| `kaisatsu.html` | **改札 KAISATSU** | Metro **line-colour = verb class**; the card is a **station nameplate**; SRS pipeline = a subway line. Bold & confident. |

## The chosen system — the BLEND (`index.html`)

The shipped one to develop. Merges all three:

- **Base = GENKŌ** — bright rice-paper, sumi ink, high contrast, vermilion red-pen accent,
  manuscript grid, 縦書き rails, numbered `NN / 06` section markers (= the tab index).
- **+ KAISATSU** — the **line-colour = word-class** system everywhere (godan vermilion ·
  ichidan indigo · irregular gold · adjective viridian · noun ochre · …), the **station-
  nameplate card** (furigana / glyph / red-pen meaning, with ← prev / next → adjacent cards),
  metro **line-bullets** on Browse cards, and the **SRS pipeline drawn as a subway line**.
- **+ YORU** — the **Night theme** is black lacquer + maki-e gold (seals, edges, numerals,
  glow). Vermilion/coral stays the **brand signal** (CTA + red-pen); gold is the lacquer
  *material*.

### Surfaces mocked in the blend (all surfaces, both themes)
- `index.html` — Flashcards (home + nameplate card + subway-line SRS pipeline)
- `browse.html` — Browse (lighter filter bar + line-bullet vocab grid, ruby furigana)
- `stats.html` — Progress dashboard (stat cards, gradient Leitner histogram, daily-accuracy line, leeches with line-bullets)
- `minna.html` — 教科書 / みんなの日本語 (chapter picker, vocab list, grammar, model conversation, notes; owner-gated)
- `selftalk.html` — 独り言 / Self-talk (streak, featured record-prompt, daily-five rail, topic browser)
- `songs.html` — 歌 / Songs (the two-column study stage: hero play-card, lyric viewer with glowing playhead, mined-vocab rail)
- `modals.html` — overlays showcase (Settings · Add card · Sign in) over a dimmed scrim

Shared across all: the **ふ furigana toggle** (ruby over kanji, toggle-able), the **line-colour
= word-class** bullets, numbered `NN / 06` section markers, the Day/Night `.themer`.

### Next: port into the app
Port the locked system into the app (`src/styles/tokens.css` palette + `chrome` + each
per-surface CSS) to match these mocks, verifying in the live app in both themes.
