---
name: design-system
description: Styles study-app UI to the Day/Night design system — role tokens in tokens.css, cascade import order, typography rules, component contracts (.frow/.chips, modals, sticky chrome), both-themes + mobile verification, and the frame-first mock-matching workflow. Use for ANY visual/CSS/layout change under study-app/ — restyles, dark-mode fixes, new panels or components, matching the mockups/sleek or mockups/redesign galleries — before writing or editing any CSS there.
---

# Study-app UI: the Day/Night design system

You are changing how the 日常日本語 study app looks. The app has a deliberate, finished
design system (the 2026-06 "blend" port — GENKŌ rice-paper + KAISATSU line-colour +
YORU lacquer night — is PORTED AND FINISHED on `main`; do not re-port it). Ad-hoc CSS
that ignores the tokens, the cascade order, or the component contracts reads as broken
in one of the two themes and gets rejected. This skill is the contract: how to color,
where to put CSS, which class structures must survive, and what "done" means.

## Before you start

1. Read the "Design system" section of `study-app/CLAUDE.md` — the authoritative,
   longer version of everything here. This skill compresses it; when this skill and
   that doc disagree, the doc wins, and when the doc and the CSS disagree, the CSS
   wins — fix the stale layer in the same change.
2. Skim `study-app/src/styles/tokens.css` (137 lines as of 2026-07) — the entire
   palette, both themes, all token names. It is short; read it before inventing a color.
3. Identify the owning CSS file (see "Where CSS lives" below) — never bolt surface
   styles onto an unrelated file.
4. For general study-app work (module map, dev loop, tests) see the `study-app-dev`
   skill; for a whole new tab see `add-study-tab`; for finishing/committing see
   `land-a-change`.

## The system in one paragraph

All-sans type: `--display` (Bricolage Grotesque — display sizes, numerals),
`--body` (Hanken Grotesk — UI/prose), `--mono` (Spline Sans Mono — short labels, the
signature), `--jp` (Japanese; resolves via `--jp-font`, default Zen Kaku Gothic New),
plus `--jp-min` (Zen Old Mincho) for *editorial* Japanese accents (rails, kickers,
the `.marker` section titles). Light theme is warm washi paper + sumi ink + vermilion 朱
red-pen brand; dark theme is black-lacquer charcoal + maki-e gold material accents.
Depth is shadow-driven (`--lift-*`) in BOTH themes, not luminance-driven. All theming
flows through CSS custom properties in `study-app/src/styles/tokens.css`;
light/dark is one `data-theme` attribute flip on `<html>` (values `"light"`/`"dark"`,
set by `initTheme` in `study-app/src/features/chrome.js`, persisted as
`jpverbs_theme`) with a `prefers-color-scheme` fallback when the user never toggled.

## Token discipline (the only way to color anything)

- **Use role tokens, never fresh hex, for anything theme-dependent.** Surfaces
  `--paper/--raised/--deeper/--base` + `--surf-card/--surf-inset/--surf-nav/--chip-bg`;
  ink `--ink/--ink-2/--muted/--faint`; hairlines `--line/--line-2/--grid`; accents
  `--brand(-deep/-soft/-on)`, `--reading(...)`, `--good(...)`, `--gold(-soft)`,
  `--leech(-soft)`; shadows `--lift-sm/md/lg`, `--card-shadow`, `--cta-shadow(-hover)`,
  `--inner-hi`; radius `--r`. A token-only rule reskins for free in light, dark, AND
  the system-preference fallback — a hardcoded hex breaks in at least one of the three.
- **Colors are functional, not decorative.** Verb classes: godan=vermilion
  (`--brand`), ichidan=indigo (`--reading`), irregular=gold (`--gold`). Non-verb
  category accents: `--adjective` (viridian), `--noun` (ochre), `--adverb` (wine-rose),
  `--phrase` (taupe), `--grammar` (deep-water teal). Status: `--leech` (plum),
  `--good` (jade, "got it right"). WaniKani subject/SRS colors: the `--wk-*` family.
  `colorClass(v)` in `study-app/src/core/facets.js` maps a card to its accent class —
  don't repurpose a functional color as decoration (a viridian button would read as
  "adjective" to the user).
- **Legacy aliases exist so old code reskins for free:** `--godan→--brand`,
  `--ichidan→--reading`, `--irregular→--gold`, `--paper-2→--raised`. Fine to read;
  write new CSS against the role names.
- **`--jp-font` is a live token** — the Settings font switcher rewrites it at runtime
  via `style.setProperty` (`initFontSwitch` in `features/chrome.js`, persisted as
  `jpverbs_font`), and `--jp` derives from it. Never inline a Japanese font-family;
  use `var(--jp)` so the switcher keeps working.
- **tokens.css holds THREE blocks that must stay in sync:** light (`:root`), dark
  (`[data-theme="dark"]`), and the fallback
  (`@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) … }`).
  Adding or changing a token means editing **all three** — the file header says so and
  it is the #1 way dark-only bugs are born.
- Literal hex is acceptable only inside an explicitly theme-scoped component rule
  where no token fits (existing precedent: `[data-theme="dark"] .chip.active` uses
  `#FF8A6E`) — but prefer reusing/adding a token, and remember the fallback caveat in
  Traps below.

## Where CSS lives + cascade order

CSS is split per surface plus a shared kit; `study-app/src/main.js` imports the sheets
in cascade order (verify live: `grep -n "import './styles" study-app/src/main.js`):

```
tokens → base → chrome → styles.css → modals → record-compare
       → flashcards → browse → stats → minna → selftalk → songs → wanikani → jlpt
```

- `styles/tokens.css` palette · `styles/base.css` reset/body/`.wrap`/atmosphere
  (`.grain` + `.atmos` fixed layers) · `styles/chrome.css` topbar/tabs/`#navExtra`/
  `.marker` · `src/styles.css` shared core (buttons, chips, `.frow`, filters,
  `.page-head`, global `@media` overrides, motion keyframes) · `styles/modals.css` +
  `styles/record-compare.css` shared kits · then one file per surface.
- **"Rule A"** in code comments = the cascade's source-order rule: at equal
  specificity, the later-imported sheet wins. The import order above IS load-bearing —
  per-surface files intentionally override the shared core, and `record-compare.css`'s
  `#navExtra` trims intentionally out-cascade `chrome.css`.
- **New surface ⇒ new `src/styles/<surface>.css`, imported at the correct point**
  (usually last) in `main.js` — never appended to `styles.css`. Tweaks to an existing
  surface go in that surface's file; shared primitives go in the shared core, BEFORE
  the per-surface sheets that may override them.
- Markup lives in `study-app/index.html` (`#panel-*` sections). Section headers use
  the `.marker` pattern (`.idx` display-numeral / `.ttl` in `--jp-min` / `.en`
  uppercase-mono); per-surface editorial headers use `.page-head`/`.page-kicker`/
  `.page-title`. Reuse these instead of inventing new header stacks — that is what
  "looks native" means here.

## Typography rules

- **Type-label rule:** uppercase-mono (`--mono` + `letter-spacing` + `text-transform:
  uppercase`) is for SHORT labels only — filter/stat/section labels, kickers. Longer
  descriptive strings (chart titles, helper text) stay sentence-case mono. Never add
  `text-transform:uppercase` to a multi-word sentence — it stops being scannable.
- The nav tabs are deliberately body-font sentence-case with an underline-active bar
  (`.nav .tab` in `chrome.css`) — the redesign moved them OFF uppercase-mono; don't
  move them back.
- Japanese text gets `var(--jp)`; editorial Japanese accents (marker titles) get
  `var(--jp-min)`.

## Component contracts (must survive any restyle)

- **`.frow` + `.chips` is the filter-row layout:** a fixed 124px `.filter-label`
  column + a flex `.chips` track, so every group's chips start at the same x and
  wrapped chips align under the first chip. Stacks label-over-chips at ≤640px. Don't
  revert to a bare `.row` with the label as a chip-sibling — that's the misaligned
  layout the `.frow` fixed.
- **`.chips` is also the accessibility group boundary:** `setupRoving`
  (`src/features/a11y.js`) makes each `.chips`/`.topic-inner` a roving-tabindex group
  and reads its aria-label from the adjacent `.filter-label`. Keep one logical facet
  per `.chips` track; don't merge two facets into one track.
- **Chips are wired by class + `data-*`, not DOM position:** the JS uses flat
  `querySelectorAll` (`makeMultiSelect('.chip.jlpt', …)`, `wireFacets('.chip.bf', …)`,
  `.chip.deck`, `.chip.bjlpt`, `.chip.mode`, `.chip.ord` — see
  `src/features/deck.js`/`browse.js`). You may regroup/wrap/collapse chip markup
  freely (the study picker wraps secondary rows in `<details class="more-filters">`)
  **as long as each chip keeps its classes + `data-*`**.
- **Chip active state is a tinted wash, not a solid fill:** `.chip.active` =
  `color-mix(in srgb, var(--brand) 12%, transparent)` + colored border + bold
  (`src/styles.css`). Don't revert to solid ink — a defaults-laden picker becomes a
  wall of black blocks. True CTAs stay solid (`.chip.primary` Start, the solid
  `.grade.right` button).
- **`.jlptseg`** is the segmented multi-select JLPT control (adjacent chips share
  borders); **`.topic-region`/`.topic-toggle`** is the collapsible topic disclosure
  (max-height transition, `has-active` border state).
- **Icons:** `<svg class="ic"><use href="#i-NAME"/></svg>` against the inline
  `<symbol>` sprite at the top of `index.html` `<body>` (41 symbols as of 2026-07;
  list them: `grep -o 'symbol id="i-[a-z-]*"' study-app/index.html`). `.ic` inherits
  `currentColor` + `1em`. No icon fonts, no CDN, no inline path soup in features.
- **Modals scroll, they don't overflow:** `.modal` caps at `calc(100vh - 40px)` with
  `overflow-y:auto`, and `.modal-x` is `position:sticky; float:right` inside the
  overlay (`styles/modals.css`) so the × stays reachable in tall modals. Add long
  modal content freely; never "fix" the × back to plain absolute.
- **Sticky chrome:** `.chrome` (sticky, z-50) wraps the single-row `.topbar` (brand ·
  inline `.nav .tab` underline tabs · `.icon-btn`s + round `.avatar`) over the
  `#navExtra` speaking-bar dock (`:empty`→hidden; filled by minna/selftalk/songs via
  `createSpeakingBar`). The ids `#furiToggle/#themeToggle/#settingsBtn/#accountBtn/
  #syncStatus` + `#navExtra` are wiring contracts — restyle around them, never rename.

## The glow cutback (2026-06 — performance + calm)

The decorative glow was cut back hard and must stay cut: no background radial "orbs",
no per-element neon halos, no per-card `filter:blur()` glow blobs, no CTA `breathe`
animation, no new `backdrop-filter`s (the only survivors are the frosted nav and the
modal overlay — verify: `grep -rn backdrop-filter study-app/src/styles*`). Only small
accent glows remain (pips, now-playing equalizer, chart line). The sleek mocks predate
this and still show night-time `body::before` orb gradients — do NOT port those back.

## Matching a mockup

Two mock generations exist, served read-only (never edit mocks to match the app):

- `study-app/mockups/sleek/` — the CURRENT reference (the blend: `genko.html`,
  `kaisatsu.html`, `yoru.html` + per-surface pages). Launch config `sleek-mocks`,
  port 5192.
- `study-app/mockups/redesign/` — the earlier Day/Night generation (`hybrid-*.html`).
  Launch config `redesign-mocks`, port 5190.
- The running dev app also serves both galleries at
  `http://localhost:5173/study-app/mockups/...` (dev-only Vite middleware).

**Translate mock vocabulary — never copy mock CSS verbatim.** The sleek mocks use
`data-theme="day"/"night"` and their own tokens (`--shu`, `--shu-wash`, `--sink`,
`--paper-2`, `--shadow`); the app uses `data-theme="light"/"dark"` and the role tokens
(`--brand`, `--brand-soft`, `--surf-inset`, `--raised`, `--lift-*`). `tokens.css`
already maps the mock palette onto the role names — your job is to express the mock's
*intent* in role tokens, not to paste its variables (they'd silently resolve to
nothing).

**Frame-first doctrine (maintainer feedback — non-negotiable):** when matching mocks,
fix the global frame FIRST — navbar/chrome, page margins, column width (`.wrap` is the
1180px/40px-pad column in `base.css`) — before polishing components. Do not claim a
surface "done" until it is pixel-faithful in BOTH themes, not merely structurally
close. "Structurally close but off on spacing/weight/color" is a rejection, not a
ship.

The blend port itself is finished (phases 1–9 + signed-in audit, both themes, on
`main`); mocks are reference material for NEW work only — don't start a re-port.

## Verify (the definition of done for any UI change)

1. Run the app: `./dev.sh` from repo root (API :3000 + app :5173, wired cross-origin)
   or the `study-app` config in `.claude/launch.json` via the preview tooling
   (`study-app-design` on :5191 is a spare instance). Account-gated surfaces need the
   API up and a sign-in — dev creds at repo-root `dev_account_password.txt`.
2. **Screenshot BOTH themes.** Flip via the `#themeToggle` button or
   `document.documentElement.setAttribute('data-theme','dark')` in an eval. If your
   change includes any `[data-theme="dark"]` rule or raw hex, also sanity-check the
   third state: remove the attribute (`removeAttribute('data-theme')`) with the
   viewport emulating dark color-scheme — that's the system-fallback path.
3. **Check computed styles, not just pixels:** inspect the changed element and confirm
   colors resolve from tokens (a screenshot can't tell `#DC3A22` from `var(--brand)`;
   the wrong one breaks dark mode). Element-inspection beats eyeballing for color,
   font-family, and spacing claims.
4. **Mobile sanity:** resize to ~375px width; the global breakpoint is ≤640px (`.frow`
   stacks, `.wrap` padding shrinks, chips grow to 40px touch targets). New layouts
   must not overflow horizontally at that width.
5. Verify signed-in where the surface differs signed-in vs out (the port's final audit
   was signed-in, both themes — match that bar).
6. `cd study-app && bun run test` — the render-tier Vitest suite drives real feature
   glue over happy-dom and catches broken class/id contracts that pure CSS eyes miss.
7. Then finish per the `land-a-change` skill (stale comments, prose summary, one
   commit per logical change).

## Traps

- **Preview capture resets the tab.** The browser-preview tooling reloads/recreates
  the page on screenshot, wiping in-memory state (active tab reverts to Flashcards;
  filter selections vanish — only localStorage survives). To verify a transient state,
  set it up AND assert via DOM eval in the same session; don't rely on a follow-up
  screenshot. Seed stats by mutating `store` + calling `renderStats()` in an eval.
- **`[data-theme="dark"]` component rules don't fire in the system-fallback state**
  (no attribute set + OS dark): only tokens flip there. Prefer expressing dark
  differences through tokens. If a structural dark-only rule truly matters unset,
  mirror it under `@media (prefers-color-scheme: dark){ :root:not([data-theme="light"])
  … }` — precedents: `.atmos` in `base.css`, `.wk-radimg` in `wanikani.css`, the
  `#themeToggle` icon in `chrome.css`.
- **The icon sprite's zero-size lives in its inline `style` attribute**
  (`width:0;height:0;overflow:hidden;pointer-events:none` on the sprite `<svg>` in
  `index.html`). Don't move those to attributes or widen the global `svg{}` rule — a
  CSS-sized, viewBox-less sprite renders as an invisible full-width click-eating
  overlay in Firefox/Safari (invisible in a Chromium preview; it shipped once).
- **`border-collapse` tables: a "no border" edge must be `0 solid transparent`, not
  `border:none`/`hidden`** — Safari paints `none`/`hidden` edges using the cell's
  width + currentColor (a phantom near-white line in dark mode, invisible in
  Chromium). Verify collapsed-table border changes in Safari or from computed styles.
- **Don't re-derive the palette from `study-app/CLAUDE.md`'s prose alone** — the
  design-system section's opening callout describes the earlier redesign generation
  (and names `mockups/redesign/` as reference); `tokens.css` + the sleek gallery are
  the palette of record. When in doubt, the CSS file wins.
- **Reduced motion is a global kill switch:** `styles.css` ends transitions/animations
  under `prefers-reduced-motion:reduce` with `*{…!important}`. Don't build a feature
  whose meaning depends on an animation firing.

## Ground truth (re-verify here before updating this skill)

As of 2026-07:

- `study-app/CLAUDE.md` — "Design system" section (system paragraph, token roles,
  type-label rule, component contracts, glow cutback) + the dead-end warnings
  (preview reset, SVG sprite, Safari borders).
- `study-app/src/styles/tokens.css` — all token names, the three theme blocks, the
  alias list, the blend header.
- `study-app/src/main.js` — the style import cascade (top of file).
- `study-app/src/features/chrome.js` — `initTheme` (`data-theme`, `jpverbs_theme`) +
  `initFontSwitch` (`--jp-font`, `jpverbs_font`); `src/features/a11y.js` —
  `setupRoving`; `src/features/deck.js` — `makeMultiSelect`/`wireFacets`.
- `study-app/mockups/{sleek,redesign}/` galleries; ports in `.claude/launch.json`.
- Maintainer doctrine encoded above: frame-first mock fidelity; both themes = part of
  "done"; the blend port is finished — don't re-port.
