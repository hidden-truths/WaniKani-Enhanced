# Redesign — handoff & progress log

> **For the next session.** This is the authoritative status of the 日常日本語 study-app
> visual redesign. Read this first, then [README.md](README.md) (the catalog) and
> [system.css](system.css) (the source of truth for tokens/components).

## TL;DR
- **What:** a full visual redesign of the study app as **self-contained HTML mocks** — *no
  production code changed*. A single **"Day / Night" design system**, all-sans, applied across
  every main surface in both a warm-paper **light** theme and a candle-lit warm **dark** theme.
- **Where:** [study-app/mockups/redesign/](.) — `system.css` + `system.js` + one `hybrid-*.html`
  per surface + an `index.html` gallery + retina-ish screenshots in `screens/`.
- **State:** all **6 main surfaces done in both themes, critiqued, polished (~9/10), 2 layout
  bugs fixed.** Not yet translated into the real app.
- **Next:** secondary surfaces · a mobile/responsive pass · another critique sweep · (later)
  port `system.css` into the real `index.html` + `src/styles.css`.
- **Commits:** `51d566d` (build) → `8dc71b6` (polish) → `66b7f69` (bug fixes), all on `main`.

## What this is (and is NOT)
- It IS a design exploration in throwaway-but-committed mocks. Each surface is an `.html` file
  that `<link>`s the shared `system.css` and `<script>`s `system.js` (theme toggle + entrance).
- It is NOT wired to the app's data, state, or API. It is NOT in `index.html`/`src/styles.css`.
- The production app still ships the **old** "washi / editorial-technical" design (mono labels,
  Georgia serif chrome, flat hairline surfaces). This redesign is the *proposed replacement*.

## How we got here (the journey)
1. **Analysis.** Ran the live app (all 6 tabs + modals, light/dark, mobile). Verdict: coherent
   but austere — reads like a CLI/tax-form. Tiny mono everywhere, flat surfaces, empty desktop,
   no distinctive Latin typeface. Good bones worth keeping: functional color, hanko, pitch-accent.
2. **Three directions** (kept as reference): **A — Sumi & Vermilion** (warm editorial), **B —
   Neo/Transit** (bold Tokyo signage), **C — Yoru/Quiet Luxe** (dark, modern-premium).
   → Maintainer chose a **Hybrid** (A's warm editorial by day + C's atmospheric depth by night).
3. **Serif removed** (maintainer feedback: "serif doesn't look good on web"). Moved to an
   **all-sans** stack and extracted a shared `system.css` + `system.js`.
4. **Full site** built on the shared system: Flashcards, Browse, Songs, Stats, みんなの日本語,
   独り言 — all in both themes.
5. **Critique:** six independent design-critic subagents (one per surface), judging pure LOOK/FEEL
   in both themes. Avg ~7.9/10. Universal finding: *dark carried the design; light felt flat.*
6. **Polish pass:** one cross-cutting `system.css` fix (light-theme depth) + six per-surface
   refinements. Now ~9/10.
7. **Bug fixes:** the hero "100" alignment + the Songs line-number/playhead overlap (see Dead-ends).

## Key decisions (and why)
- **One system, two themes.** Light = warm washi paper + sumi ink. Dark = "candle-lit washi at
  night" — warm-charcoal + coral/amber glow + frosted glass, deliberately *not* cold blue tech.
  Only surface/atmosphere/glow swap; layout, type, and motifs are shared.
- **All-sans type** (serif removed): **Bricolage Grotesque** (display, big numerals, the revealed
  meaning) · **Hanken Grotesk** (body/UI) · **Spline Sans Mono** (micro-labels, sparingly) ·
  **Zen Kaku Gothic New** (all Japanese — gothic, no mincho). Loaded via Google Fonts in `system.css`.
- **Shared `system.css` + `system.js`.** So a font/token change is a one-file edit and every
  surface stays consistent. Surfaces add only surface-specific CSS in a small `<style>` block.
- **Functional pedagogy preserved.** godan=vermilion/coral · ichidan=indigo · irregular=stone/gold ·
  leech=plum · "got it right"=green→jade. Plus the round **hanko seal**, the **pitch-accent**
  overline notation, and **furigana** ruby. These are pedagogically meaningful — keep them.
- **Charts are hand-rolled inline SVG** (the app forbids chart libraries — honor that).
- **`show_widget`/Imagine is the WRONG tool** for these mocks (it's flat + themed to claude.ai).
  Standalone HTML + headless-Chrome screenshots is the right path (matches `mockups/songs/`).
- **Screenshots committed at 1× (~1280px wide)** to keep the repo lean (~22MB vs ~54MB retina);
  they're regenerable anytime. Downscale with `sips` before committing.

## The design system (quick reference — `system.css` is authoritative)
- **Tokens:** `:root` = LIGHT (default); `[data-theme="dark"]` overrides. Role tokens carry the
  functional palette so it survives both themes: `--paper --raised --deeper --base --ink --muted
  --faint --line --brand(-deep/-soft/-on) --reading(...) --good(...) --gold --leech` + surface
  (`--surf-card/--surf-inset/--surf-nav/--chip-bg`), shadow (`--lift-sm/md/lg --card-shadow
  --cta-shadow --inner-hi`), atmosphere (`--grain-opacity/--grain-blend`), and fonts
  (`--display --body --mono --jp`).
- **Atmosphere:** `.grain` (paper-grain SVG, multiply by day / whisper by night) + `.atmos`
  (warm radial blooms; candle glow + a vertical wash in dark), both `position:fixed` behind content.
- **Components:** `.topbar/.brand/.nav/.nav a.active/#themeToggle/.avatar`, `.wrap` (max 1180),
  `.kicker`, `.bignum`, `.card/.panel/.glass` (light=raised paper + warm shadow; dark=frosted
  glass + glow), `.btn/.btn-primary(breathe)/.btn-ghost`, `.pill`, `.chip(.active)`, `.segmented`,
  `.hanko` (+`#stamp` SVG filter, defined per file), `.pitch`(`.pa/.pa.hi/.pa.drop`),
  `.play-btn/.tool-btn`, `.grade.wrong/.grade.right`, ruby `rt`, `.spine`+`.is-godan/.is-ichidan/
  .is-irregular/.is-leech`, `.reveal`(+`.d1..d8` stagger; reduced-motion safe).
- **`system.js`:** sets `data-theme` on `<html>` from `?theme=` (else light) before paint, wires
  `#themeToggle` (☼ by day / ☾ by night), adds press feedback + `.reveal` stagger.

## Current state — done
| Surface | File | Notes |
|---|---|---|
| Flashcards hero | `hybrid-day-night.html` | study home + revealed flashcard (払う) |
| Browse | `hybrid-browse.html` | filter bar (secondary rows in a disclosure) + color-coded grid + inline detail |
| Songs · Read | `hybrid-songs.html` | lyric reader; the atmospheric dark showcase |
| Stats | `hybrid-stats.html` | hero metrics + hand-rolled SVG charts (pipeline, line, per-card) |
| みんなの日本語 | `hybrid-minna.html` | Lesson 7 dashboard (vocab, grammar, dialogue, notes) |
| 独り言 Self-talk | `hybrid-selftalk.html` | output practice + record-and-compare rig |
| Gallery | `index.html` | contact sheet of directions + applied surfaces |

Each has light + dark screenshots in `screens/` (`<name>.png` light, `<name>-dark.png` dark;
hero's dark is `hybrid-dark.png`). The A/B/C exploration mocks are kept as-is (still serif — historical).

## Known issues / not yet addressed
- **Secondary surfaces missing:** Settings modal, the auth/sign-in modal, the add-card modal, the
  **in-session flashcard PROMPT side** (pre-reveal), the due-cards banner / SRS entry, empty states.
- **Desktop-only.** Everything is designed at 1280px. No mobile/responsive pass yet (the topbar
  nav, the Browse filter bar, the Stats grids, the Songs two-column, and the Self-talk rig all
  need narrow-width treatments).
- **Lower-priority critique items** intentionally deferred in the polish pass (e.g. Songs
  light-hero could go further; Stats spacing scale could be even tighter; some agents flagged
  minor per-surface nits). Re-running the critique on the *polished* set will surface the next tier.
- **Duplication:** each surface re-declares its own surface-specific CSS; shared stuff is in
  `system.css`. Fine for mocks; a real port would consolidate.

## What's next (the options the maintainer is choosing among)
1. **Secondary surfaces** — Settings, auth modal, add-card modal, the pre-reveal flashcard prompt, banners/empty states.
2. **Mobile / responsive pass** — narrow-width treatments for every surface.
3. **Another critique sweep** — re-run the per-surface design critics on the *polished* mocks to find the next tier of improvements.
4. **(Later, a CODE session) Production translation** — port `system.css` into the real
   `index.html` + `src/styles.css`, wired to live data. Big, separate effort.

## Runbook — how to work on it
- **Serve:** the mocks are static files. Use the running Vite dev server (`bun run dev` →
  `http://localhost:5173`) — the files are served at `/mockups/redesign/<file>.html`. (Or the
  preview tool; note it may grab a different port if 5173 is busy.)
- **View a theme:** open any mock and click **☼/☾**, or append `?theme=dark` / `?theme=light`.
- **Screenshot (retina, headless Chrome — same recipe as `mockups/songs/shoot.sh`):**
  ```
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --virtual-time-budget=4800 --window-size=1280,<H> \
    --screenshot="screens/<name>.png" \
    "http://localhost:5173/mockups/redesign/<file>.html?theme=<light|dark>"
  ```
  Approx full-page heights: hero 1850 · browse 2620 · songs 2400 · stats 2700 · minna 2980 ·
  selftalk 2240 · gallery (index.html) 3100. (Bump if content clips; trim if lots of bottom blank.)
- **Verify visually** by `Read`-ing the PNG (vision). For a new surface, shoot BOTH themes.
- **Slim before committing:** `for f in screens/*.png; do sips --resampleWidth 1280 "$f"; done`
- **Commit conventions** (repo-wide): one logical change → one commit; commit to `main`; stage
  explicit paths (`git add study-app/mockups/redesign`), never `git add -A`; leave `.claude/
  launch.json` out; end the message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Update [index.html](index.html) + [README.md](README.md)** when you add a surface (gallery
  card + table row), and refresh `screens/_gallery.png`.

## Dead-ends / gotchas (don't re-discover these)
- **Inline-level line-box trap.** `.kicker` is `display:inline-flex` and `.bignum` is
  `display:inline-block` — both inline-level. With no block between them they share a line box, so
  a short kicker baseline-aligns to a giant numeral and shoves it sideways. Fix: make the parent a
  flex column (`hybrid-day-night.html` `.hero-left`). Watch for this whenever an inline-block sits
  beside an inline-level sibling.
- **Songs now-playing gutter.** The line number (`.ll .num`, `left:0`) and the thick glowing
  playhead bar (`.ll.current::before`, 6px) both live in the left gutter and collided. Fix: extra
  `padding-left` on `.ll.current` + push `.num` past the bar.
- **`SendUserFile` was unavailable** late in the session (it worked early, then got disabled) —
  you may not be able to push images into chat. Rely on the `index.html` gallery (it renders in the
  Launch preview panel) + `Read`-ing the PNGs yourself.
- **`.claude/launch.json`** picked up two preview entries (`study-app-design`, `redesign-mocks`).
  Harmless; remove if you like. It had pre-existing local modifications — don't blindly revert it.
- **Don't reach for `show_widget`/Imagine** for the mocks — flat + claude.ai-themed, wrong vehicle.
