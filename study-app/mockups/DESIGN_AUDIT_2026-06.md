# Visual design audit — 日常日本語 study app (2026-06-18)

A focused look at *visual* design (look & feel), not IA or features. Reviewed the live
app (Vite dev server) across Flashcards (home + card + reveal), Browse, Stats, Songs, in
both Day and Night themes, at 1440px.

## What's genuinely good (keep the soul)

1. **Functional colour-coding** — verb class = colour (godan vermilion · ichidan indigo ·
   irregular gold), painted as a card spine + hanko stamp. This is the single best idea in
   the app: it's *useful*, not decorative. Browse is scannable because of it. **Keep.**
2. **Hanko seals as a motif** — the 料 seal on the card, the 記 / 虫 section seals on Stats.
   Charming, authentically Japanese, ownable. **Keep, lean in harder.**
3. **Pitch-accent overlines** on readings — scholarly, high-value, rare. **Keep.**
4. **Editorial big type** — the giant `100`, the big study glyph, Bricolage numerals. Strong
   bones. **Keep the gesture, improve the composition around it.**
5. **Night theme (settled)** — moody, warm, candle-lit, with coral/plum glows. Actually the
   stronger of the two themes. (Note: the app's panel-switch fade-in is nice — my first dark
   screenshots were just catching it mid-transition.)

## What holds it back (the "competent but sleepy/safe" feeling)

1. **Monochromatic beige fatigue (Day theme).** Everything is warm sepia on warm sepia —
   `--paper #F3ECDD`, cards `#FFFDF6`, low chroma everywhere. It reads *vintage / calm /
   washed-out* rather than *modern / sleek*. The Day theme is the weakest surface; it needs
   more **contrast and a cleaner base**, not more beige.
2. **Dead, unstructured space.** The Flashcards home is a giant `100` floating on the left
   with a disconnected "Upcoming reviews" card on the right and a void in the middle. The
   negative space has no *job*. Big type needs architecture (rules, grid, alignment) to read
   as "designed" rather than "empty."
3. **The nav wraps to two lines** at 1440px — `歌·Songs` drops below the row. The bilingual
   double-labels (`みんなの日本語·Textbook`, `独り言·Self-talk`) are too long for a single-row
   tab bar. Frame-level bug; undermines the whole "sleek" impression on every page.
4. **Heavy filter panels bury content.** Browse opens with a tall filter card; you scroll
   past a wall of controls before seeing a single vocab card.
5. **Cards are a bit "samey."** Lots of white rounded rectangles on beige with thin spines.
   Clean, but nothing is *striking* — no single memorable hero moment.
6. **Inconsistent page hierarchy.** Flashcards / Browse / Stats get the kicker + big headline
   treatment; Songs gets a small `歌·songs` label. Looks unfinished by comparison.

## The lineage (why it feels safe)

The repo's own `mockups/redesign/` shows three explored directions:
- **A · Sumi-Vermilion** — warm paper, calm editorial → **this is what shipped** (softened to "hybrid").
- **B · Neo-Transit** — bold yellow/red/black station-departure-board signage, numbered `01/02`
  sections, vertical `五段` class labels → most distinctive, **left on the table**.
- **C · Yoru-Luxe** — glassy jewel-toned dark → its DNA survives in the shipped Night theme.

The team shipped the **safest** of the three (A). That's precisely the gap: the boldness and
systematic confidence of **B** never made it in. The fix isn't to throw out the soul — it's to
bring B's *architecture and contrast* into a fresher, modern, less-loud system.

## Direction proposed: 原稿 "GENKŌ" — manuscript grid + red-pen ink

A high-contrast, architectural system that keeps the soul (functional colour, hanko, pitch
marks, big glyphs, JP-first) but re-grounds the skin:

- **Concept:** the Japanese editorial desk / classroom. Vermilion = the teacher's red
  correction pen (朱筆) — gives the brand accent real *meaning*. The genkō-yōshi (原稿用紙)
  square manuscript grid is the architectural underlay. Tategaki (vertical) type rails carry
  section identity — distinctly Japanese, rarely done well on the web, instantly "designed."
- **Palette:** clean bright rice-paper (not muddy beige) + true sumi near-black ink (high
  contrast) + one hot vermilion + saturated *signal* colours (transit-bullet style) for verb
  class. Day gets crisp & gallery-bright; Night keeps the candle-lit moodiness it already nails.
- **Type:** keep Bricolage (display) + Hanken (body) + Spline Mono (index labels); add **Zen
  Old Mincho** for editorial/brand Japanese (vertical rails, kickers) — calligraphic ink
  contrast against the Gothic study glyph.
- **Structure:** visible architecture — numbered `01 / 02` section markers (quiet, ink — not
  B's loud yellow), hairline rules, a real baseline grid, negative space with a job.

Mock: `mockups/sleek/` (Flashcards home + study card, Day theme first).
