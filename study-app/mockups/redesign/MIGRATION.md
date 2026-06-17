# Day / Night redesign → production migration plan

> **For the session that ports the redesign into the real app.** This is the authoritative
> bridge from the *mocks* (`mockups/redesign/`) to the *shipping* app (`index.html` +
> `src/styles.css`). Read this first, then [HANDOFF.md](HANDOFF.md) (mock status), then
> [system.css](system.css) (the visual source of truth), then [../CLAUDE.md](../CLAUDE.md)
> "Design system" + the dead-end warnings. A ready-to-run kickoff prompt is
> [MIGRATION_PROMPT.md](MIGRATION_PROMPT.md).

---

## TL;DR

- **What's done:** a complete visual redesign — the **"Day / Night" system** — exists as
  self-contained HTML mocks. **11 surfaces, both themes, mobile-passed (≤640px), twice-critiqued,
  ~9.3/10.** Nothing production has changed yet.
- **What's next (the next session):** apply that look to the **real** app. The recommended path is a
  **reskin-in-place**: keep the production markup, class names, and JS contracts; rewrite
  `src/styles.css` (plus a small `index.html` head/atmosphere change) to adopt the mocks' look.
- **The linchpin technique:** **token aliasing.** Define the redesign's token palette, then map the
  production token *names the code already uses* (`--godan`, `--paper`, `--ink`, …) onto the new
  values. The hand-rolled SVG charts and every `var(--godan)`-style reference then re-skin for free.
- **Do NOT** rename classes, change `data-*`, or restructure markup wholesale — the feature JS is
  wired to them (see "Load-bearing constraints"). The mocks' class names are a *visual* reference, not
  a target to copy verbatim.

---

## 1. What we built (the mock phase, 3 sessions)

The redesign lives in [study-app/mockups/redesign/](.) — `system.css` + `system.js` + one
`hybrid-*.html` per surface + an `index.html` gallery + `screens/*.png` (light + dark, plus four
`*-mobile.png`). **Mocks only; no production code was touched.** The journey:

1. **Analysis** of the live app: coherent but austere — reads like a CLI/tax-form (tiny mono
   everywhere, flat hairline surfaces, empty desktop, Georgia-serif chrome, no Latin display face).
   Good bones to keep: functional color, the hanko, pitch-accent, the comfortable mobile card.
2. **Three directions** (A Sumi & Vermilion · B Neo/Transit · C Yoru/Quiet-Luxe) → the maintainer
   chose a **Hybrid: warm editorial by day + atmospheric warm dark by night.**
3. **Serif removed** (maintainer: "serif doesn't look good on web") → an **all-sans** stack, extracted
   into a shared `system.css` + `system.js`.
4. **Main surfaces** built on the system: Flashcards, Browse, Songs, Stats, みんなの日本語, 独り言.
5. **Secondary surfaces** added: Settings / sign-in / add-card **modals** (on a new shared
   modal/overlay/form kit in `system.css`), the in-session **flashcard prompt** (pre-reveal), and a
   **banners & empty-states** sheet.
6. **Mobile / responsive pass** (≤640px): a shared mobile layer (grid topbar + horizontally-scrollable
   tab strip, type down-scaling, full-width modals with stacked rows) + per-surface grid stacking.
7. **Two critique sweeps** (per-surface design critics, both themes). Both rounds' universal finding:
   *light didn't lift off the page like dark.* Fixed cross-cuttingly (see Decisions). Now ~9.3.

The 11 surfaces and their screenshots are catalogued in [HANDOFF.md](HANDOFF.md) ("Current state —
done") and [README.md](README.md). The gallery `index.html` renders them all.

## 2. Key decisions (and why) — carry these into production

- **One system, two themes.** Light = warm washi paper + sumi ink + raised sheets. Dark = "candle-lit
  washi at night" — warm-charcoal + coral/amber glow + frosted glass (deliberately *not* cold-blue
  tech). Only **surface / atmosphere / glow** swap between themes; **layout, type, and motifs are
  shared.**
- **All-sans type.** **Bricolage Grotesque** (display / big numerals / the revealed meaning) ·
  **Hanken Grotesk** (body/UI) · **Spline Sans Mono** (micro-labels, sparingly) · **Zen Kaku Gothic
  New** (all Japanese — gothic, no mincho). This *replaces* the production Georgia-serif body + SF-Mono
  labels + Noto-Serif/mincho chrome.
- **Functional color is preserved** (it's pedagogically meaningful, not decorative): godan =
  vermilion/coral, ichidan = indigo, irregular = gold/stone, leech = plum, "got it right" = jade/green.
  The non-verb categories keep their accents (adjective/noun/adverb/phrase). **Keep the mapping; only
  the hexes change** to the warmer redesign palette.
- **Motifs preserved:** the round **hanko seal**, the **pitch-accent overline** notation, **furigana**
  ruby. These already exist in production (`colorClass`/`cardStamp`, `pitchHtml`/`splitMora`,
  `data-furigana` flip) — restyle them, don't rebuild them.
- **Charts stay hand-rolled inline SVG** (no chart library — a hard repo rule). They read
  `var(--godan)` etc., so token aliasing reskins them automatically.
- **Light-theme depth is SHADOW-driven, not luminance-driven.** Two critique rounds said light "felt
  flat." The fix is warm, deepened `--lift-*` shadows + a slightly brighter `--raised` (cards as raised
  paper), **not** whiter cards — there's almost no luminance headroom over the washi `--paper`.
  `--gold` was darkened to `#8C6C1C` so the mono labels pass AA on paper. Don't undo these.
- **A reusable modal/overlay/form kit** was added to `system.css` (`.overlay`, `.modal`,
  `.modal-head/-body/-foot/-x`, `.field`, `.input/.textarea/.select`, `.switch`, `.set-row`). Production
  already has modals (Settings, add-card, detail, auth) wired to *its own* classes — restyle those to
  match this kit's look.
- **The mobile topbar is a CSS grid**, not flex-wrap (deterministic placement of brand + actions over
  a scrollable tab strip). And **headless Chrome clamps to a ~500px min width**, so mobile shots verify
  the ≤640 layer at ~500px (the ≤430 fine-tuning is reasoned). Both are documented in HANDOFF dead-ends.
- **`show_widget`/Imagine is the wrong tool** for these mocks (flat, claude.ai-themed). Standalone HTML
  + headless-Chrome screenshots is the path; verify by `Read`-ing the PNGs.

## 3. The design system (what to port) — `system.css` is authoritative

- **Tokens** (`:root` = LIGHT default; `[data-theme="dark"]` overrides): surfaces
  `--paper --raised --deeper --base`; ink `--ink --muted --faint --line`; functional
  `--brand(-deep/-soft/-on)` (godan), `--reading(...)` (ichidan), `--good(...)`, `--gold` (irregular),
  `--leech`; surface/shadow/atmosphere knobs `--surf-card/--surf-inset/--surf-nav`,
  `--lift-sm/md/lg --card-shadow --cta-shadow --inner-hi`, `--grain-opacity/--grain-blend`; fonts
  `--display --body --mono --jp`.
- **Atmosphere:** `.grain` (paper-grain SVG; multiply by day, whisper by night) + `.atmos` (warm
  radial blooms; candle glow + vertical wash in dark), both `position:fixed` behind content.
- **Components:** topbar/brand/nav + theme toggle/avatar; `.wrap` (max 1180); `.kicker`; `.bignum`;
  `.card/.panel/.glass`; `.btn/.btn-primary(breathe)/.btn-ghost/.btn-sm`; `.pill`; `.chip(.active)`;
  `.segmented`; `.hanko` (+ `#stamp` SVG filter); `.pitch`/`.pa(.hi/.drop)`/`.pitch-tag`;
  `.play-btn/.tool-btn`; `.grade.wrong/.right`; ruby `rt`; `.spine`+`.is-godan/-ichidan/-irregular/
  -leech`; `.reveal`(+`.d1..d8`); the overlay/modal/form kit; the responsive layer.

## 4. The gap: mocks vs production (why it's not a file copy)

| | Mocks (`system.css` / `hybrid-*.html`) | Production (`src/styles.css` / `index.html`) |
|---|---|---|
| **Token names** | `--brand --reading --gold --raised --display --body --mono --jp` … | `--godan --ichidan --irregular --paper-2 --jp-font`; body = `Georgia,serif`, labels = `"SF Mono"` |
| **Class names** | `.topbar .nav .card .chip .segmented .grade .overlay .modal .field .switch` … | `.navbar .tab .frow .chips .filter-label .chip(.g)(.primary) .jlptseg .topic-toggle .search .more-filters #navExtra .mn-vocab` … |
| **Theme** | `data-theme` on `<html>`; `?theme=` param (mocks only) | `data-theme` on `<html>` + a `prefers-color-scheme` fallback + a localStorage toggle ([chrome.js](../src/features/chrome.js)) |
| **Fonts** | Bricolage + Hanken + Spline Mono + Zen Kaku Gothic New (`@import` in system.css) | Noto Sans/Serif JP + Zen Maru Gothic + Kaisei Decol + Yuji Syuku (the JP **font switcher**) |
| **JS wiring** | none (static) | feature modules wired to the classes + `data-*` above (load-bearing) |

So: **the mocks define the LOOK; production re-expresses that look against its own classes + token
names + JS contracts.** `system.css` is the spec you translate, not the file you ship.

## 5. Migration strategy — reskin-in-place + token aliasing

**Recommended approach (lowest risk, preserves every JS contract):**

1. **Token layer (the linchpin).** In `src/styles.css`, replace the `:root` / `[data-theme="dark"]` /
   `prefers-color-scheme` blocks with the redesign's full palette **and alias the existing names onto
   it**, e.g.:
   ```css
   :root, :root[data-theme="light"]{
     /* redesign palette */
     --paper:#F3ECDD; --raised:#FFFDF6; --deeper:#E4D7BE; --base:#EDE4D2;
     --ink:#1C1714; --muted:#6B6052; --faint:#897C6B; --line:#CEBE9F;
     --brand:#CD4327; --reading:#2A4A6E; --gold:#8C6C1C; --leech:#7E3F9C; --good:#3F7A4E;
     /* … shadows / atmosphere / fonts from system.css … */
     /* aliases so existing code + SVG charts reskin for free */
     --godan:var(--brand); --ichidan:var(--reading); --irregular:var(--gold);
     --paper-2:var(--raised);
     --jp-font:"Zen Kaku Gothic New","Noto Sans JP",sans-serif;  /* new default */
   }
   :root[data-theme="dark"]{ /* the dark hexes + same aliases */ }
   @media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){ /* dark hexes + aliases */ } }
   ```
   Audit `styles.css` for every `var(--…)` the code/charts depend on (grep `--godan|--ichidan|
   --irregular|--paper|--paper-2|--ink|--muted|--line|--leech|--good|--adjective|--noun|--adverb|
   --phrase|--jp-font`) and make sure each still resolves.
2. **Fonts.** Add Bricolage Grotesque + Hanken Grotesk + Spline Sans Mono + Zen Kaku Gothic New to the
   `index.html` Google-Fonts `<link>` (keep graceful-degradation). Switch `body` → `--body` (Hanken),
   display headings → `--display` (Bricolage), the mono labels (`"SF Mono"` usages) → `--mono` (Spline
   Sans Mono). **Keep the JP font switcher** ([chrome.js](../src/features/chrome.js) `initFontSwitch`)
   but make **Zen Kaku Gothic New the default option** (`--jp-font`); the existing faces stay as user
   choices.
3. **Atmosphere.** Add `<div class="grain"></div><div class="atmos"></div>` to `index.html` body and
   port the `.grain`/`.atmos` rules + the `#stamp` SVG filter.
4. **Components, one cluster at a time.** Restyle the production classes to the redesign treatment —
   `.navbar`→frosted topbar, `.tab`→underline-active nav, `.chip`→tinted-wash active, cards/panels→
   raised-paper-by-day / frosted-glass-by-night, buttons→`.btn-primary` look, the hanko stamp, the
   pitch `.pa`, furigana `rt`, the spine, modals→the overlay/modal/field/switch kit. Map class-by-class
   using `system.css` as the reference for values.
5. **Theme + responsive.** Keep the `data-theme` + `prefers-color-scheme` + toggle mechanism exactly
   (it already matches the mocks' attribute). Port the mobile (≤640px) layer onto `.navbar`/`.tab`/etc.

**Alternative (NOT recommended):** adopt `system.css` wholesale and rename every production class to
match. This touches every feature module and every dead-end — high risk for no visual gain. Only
consider it if a clean-room rewrite is explicitly wanted.

## 6. Phased plan (each phase shippable + reversible, one commit each)

> Run **Phase 0 first and confirm the look** before the per-surface phases — it carries ~70% of the
> visual change with near-zero structural risk, and de-risks the rest.

- **Phase 0 — Foundation.** Token layer (alias map) + fonts + atmosphere + base type (body/headings/
  labels). Expect: every surface immediately reads warmer/all-sans with lifted cards; nothing
  structurally moved. Verify all 6 tabs both themes — this is the "does it feel right" gate.
- **Phase 1 — Chrome.** `.navbar` (frosted topbar + brand), `.tab` strip (underline active), the
  nav buttons (theme/settings icon-only, account chip), the `#syncStatus` pill, `#navExtra` dock.
- **Phase 2 — Flashcards.** Study home (the due banner, the forecast SVG, the big numeral) + the
  flashcard (spine + hanko, the prompt word, the pitch reading row + play button, the revealed meaning,
  the mnemonic/trap notes, the example block + tools, the grade buttons). Also the **pre-reveal**
  state.
- **Phase 3 — Browse.** The filter bar (`.frow/.chips`, `.jlptseg`, `.more-filters`, `.topic-toggle`,
  `.search`), the color-coded grid cards, and the detail modal (memory pips, leveled examples).
- **Phase 4 — Stats.** Hero metric cards + the hand-rolled SVG charts (they reskin via the token
  aliases — mostly verify) + the leech list + per-card bars.
- **Phase 5 — Textbook / Self-talk / Songs.** The みんなの日本語 vocab table (mind the `.mn-vocab`
  Safari border trap), grammar/dialogue/notes; the 独り言 record rig; the 歌 lyric reader + vocab rail.
- **Phase 6 — Modals & forms.** Settings, auth/sign-in, add-card → the overlay/modal/field/switch kit
  (the production modals already scroll-cap with a sticky ×; preserve that).
- **Phase 7 — Mobile + cross-browser + a11y + final QA.** The ≤640 layer on real classes; **verify in
  Safari** (the `border:0 solid transparent` table trap); reduced-motion; tab + chip keyboard nav
  intact; screenshot every tab in both themes at desktop + ~390/500px and compare to the mocks.

## 7. Load-bearing constraints — preserve through the reskin (see [../CLAUDE.md](../CLAUDE.md))

- **Chips are wired by class + `data-*`** (`makeMultiSelect`, `wireFacets`, `TOKEN_FACET`). Don't
  rename `.chip`/`.deck`/`.bf`/`.jlpt`/… or change `data-deck`/`data-filter`. Active state is a
  tinted wash, **not** a solid-ink fill (the redesign agrees — keep it).
- **`.frow` + `.chips`** two-track layout (fixed `.filter-label` column + flex chips) is what keeps
  filter rows aligned AND is the roving-tabindex group boundary. Keep the structure.
- **Roving tabindex + ARIA radiogroups** (`setupRoving`): multi-select rows are `role=group`; single-
  select rows opt into `role="radiogroup"` in markup. Don't break the contract.
- **The inline SVG icon sprite hides its size via INLINE STYLE, not width/height attributes** (the
  global `svg{width:100%}` chart rule would otherwise turn it into a full-width invisible overlay in
  Firefox/Safari). Keep it inline + offline-first (no CDN icon font).
- **The `.mn-vocab` table "no-border" edges must be `0 solid transparent`, not `none`/`hidden`** —
  Safari paints `none`/`hidden` edges anyway. Verify table changes in Safari.
- **Modals scroll, they don't overflow** (`max-height:calc(100vh-40px)` + `overflow-y:auto`, sticky
  `.modal-x`). The redesign kit matches this — preserve it.
- **Furigana is a global CSS flip** (`<html data-furigana>` → `rt{display:none}`). Keep `rt` styling
  driven by that attribute.
- **`#navExtra` is the navbar context-dock** (the speaking/compare bar mounts/unmounts there). Keep it.
- **No framework, no chart library, no CDN icon font.** Charts stay hand-rolled SVG; icons stay the
  inline sprite; Google Fonts is the only external dep and degrades gracefully.

## 8. Verification protocol

- **Tests:** `bun run test` (Vitest + happy-dom against the real module graph) must stay green. Styling
  alone won't break it, but any markup/JS touch can — run it each phase.
- **Build:** `bun run build` must stay green.
- **Visual:** screenshot **every tab in both themes** (and at ~390/500px for the mobile phase) and
  compare to the corresponding `screens/*.png` mock. Drive the **already-running** preview/dev server.
- **⚠️ Do NOT take down `:5173` (study-app dev) or `:3000` (API).** The maintainer keeps live test
  tabs against them (see [../NEXT_STEPS.md](../NEXT_STEPS.md) top). Only restart a server if it's
  actually down.
- **Both themes every time.** The whole point of the system is parity — a fix that only works in one
  theme isn't done.

## 9. Open decisions to confirm with the maintainer (ask before Phase 0)

1. **Reskin-in-place vs class-rename** — recommend reskin-in-place (§5). Confirm.
2. **JP font switcher** — keep it (default Zen Kaku Gothic New) vs standardize on one JP face and drop
   the switcher. Recommend keep.
3. **`src/styles.css` shape** — keep it one file (like `system.css`) vs split per-surface. Recommend
   keep one file for now.
4. **Scope of this session** — Phase 0 + confirm, then continue, vs the whole migration in one go.
   Recommend: land Phase 0, get a look-check, then proceed phase-by-phase.

## 10. Reference index

- **Visual source of truth:** [system.css](system.css) + [system.js](system.js).
- **Mock status + dead-ends + screenshot runbook:** [HANDOFF.md](HANDOFF.md).
- **Per-surface mocks:** `hybrid-day-night.html` (Flashcards + prompt via `hybrid-prompt.html`),
  `hybrid-browse.html`, `hybrid-stats.html`, `hybrid-minna.html`, `hybrid-selftalk.html`,
  `hybrid-songs.html`, `hybrid-settings.html`, `hybrid-auth.html`, `hybrid-addcard.html`,
  `hybrid-states.html`; screenshots in `screens/` (`<name>.png` light, `<name>-dark.png` dark,
  `<name>-mobile.png` ≈500px; the Flashcards hero's dark is `screens/hybrid-dark.png`).
- **Production architecture + the full dead-end list:** [../CLAUDE.md](../CLAUDE.md).
- **What-to-do-next + the running-server warning:** [../NEXT_STEPS.md](../NEXT_STEPS.md).
- **Kickoff prompt for the migration session:** [MIGRATION_PROMPT.md](MIGRATION_PROMPT.md).
