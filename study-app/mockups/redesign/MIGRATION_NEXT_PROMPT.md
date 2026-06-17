# Kickoff prompt — Phase 8: realize the mock LAYOUTS

> Paste the block below to start the next session. It assumes the `redesign-migration` branch is
> checked out (Phases 0–7 + the speaking-mode lift shipped, not pushed). Earlier sessions applied the
> Day/Night **skin**; this phase builds the mocks' **layouts**.

---

You are building **Phase 8 of the "Day / Night" redesign** of the production 日常日本語 / Japanese
Trainer study app (`study-app/`) — a Vite, no-framework, ES-modules app on the **`redesign-migration`**
branch (checked out, not pushed). This is real production code: work in **small, shippable, reversible
steps, one surface at a time, and verify every change in the browser yourself.**

## Why this phase exists (read this — it changes the rules)
Phases 0–7 applied the redesign as **reskin-in-place**: CSS-only, on the existing markup. That shipped
the *skin* (palette, both themes, all-sans type, atmosphere, lifted cards) and it's solid and verified.
**But it did NOT build the mocks' editorial *layouts*** — so today the app looks like a warm-themed
version of the old compact app, not like `screens/*.png`. The maintainer reviewed it and wants the app
to actually **match the mocks**. So Phase 8 **relaxes reskin-in-place: you MAY now change markup + JS**
(and add per-surface CSS) to build the editorial compositions. The foundation (tokens, themes, component
skin) stays — you're adding the carpentry on top of the paint.

## Read first, in this order (before any code)
1. `study-app/mockups/redesign/MIGRATION_PROGRESS.md` — **start here.** "Status", **"The gap"**
   (the per-surface mock-vs-shipped table = your worklist), "Key decisions" (esp. **Decision 5**), the
   CSS architecture + the two cascade rules, and the signed-in proxy-harness verify recipe.
2. `study-app/CLAUDE.md` — the **"Design system"** section (incl. the **"⚠ Skin ≠ layout"** note) and
   the **"Things that look like bugs but aren't"** dead-ends. The dead-ends are the CONTRACTS you must
   not break even while changing structure (see Hard constraints).
3. `study-app/mockups/redesign/system.css` — the visual source of truth (tokens, both themes, and the
   mock components: `.bignum`, `.hanko`, `.spine`, `.card/.panel`, `.grade`, the `.turn`/`.turn.is-b`
   conversation bubbles, etc.). **Translate these onto the app; don't ship system.css verbatim.**
4. The mock you're working on, next to BOTH its screenshots, e.g. `hybrid-day-night.html` +
   `screens/hybrid-day-night.png` (+ `hybrid-dark.png`). One pair per surface in `screens/`.

## The work — one surface at a time, against its mock
The worklist is the **"The gap" table** in MIGRATION_PROGRESS.md. Suggested order:
1. **Re-compare Browse + Stats first** (they got the closest reskin). Screenshot each in both themes,
   diff against `hybrid-browse*.png` / `hybrid-stats*.png`, and close the small deltas. This calibrates
   "how close is close enough" cheaply before the big rebuilds.
2. **Then rebuild the editorial compositions** (these need markup/JS, not just CSS):
   - **Study home** — promote the small banner count to the giant standalone `bignum` review hero with
     the 今日の復習 kicker + the forecast as a side card (`hybrid-day-night`).
   - **Flashcard** — the wide **2-column editorial card with the rotated hanko seal**, accent pill,
     reading/trap note-cards, example, big jade/vermilion grade bar (`hybrid-day-night` /
     `hybrid-prompt`).
   - **みんなの日本語** — the hero **hanko lesson-number tile**, the **3-up grammar card grid**, and the
     **two-colour speaker bubbles** (`hybrid-minna`; the mock keys speaker colour off `.turn.is-b`, so
     add a speaker marker in `renderConversation`).
   - **歌 Songs** — the stylised **play-card hero** (cover ring + coverage) (`hybrid-songs`).
   - **独り言 Self-Talk** — the big **"NOW SPEAKING" card** (prompt + scaffold + the spacious record rig
     + waveforms) over the quiet prompt rail (`hybrid-selftalk`).

**Stage it: rebuild ONE surface fully (both themes, matching the mock), then STOP and show the maintainer
before mass-rebuilding the rest** — editorial layout is a matter of taste, and a look-check after the
first surface (suggest the **study-home hero** or the **flashcard** — the most-seen) prevents a large
wrong-direction effort. This mirrors the Phase-0 pause.

## Hard constraints (do not violate)
- **Markup/JS changes are allowed now (Decision 5) — but the CONTRACTS hold.** Don't break any CLAUDE.md
  dead-end: chip wiring by class + `data-*`; `.frow`/`.chips`; roving-tabindex / ARIA radiogroups; the
  inline-SVG-sprite size-via-inline-style hack; the **`.mn-vocab` `0 solid transparent` Safari rule**;
  modals scroll-cap + sticky `.modal-x`; the `data-furigana` flip; the **`#navExtra` speaking-bar dock**;
  record-compare keying (scopes/itemKeys); the sentence-store / `normalizeLine` seams; `state.js`
  single-writer singletons. Change STRUCTURE to hit the mock; keep the wiring the dead-ends protect.
  If a layout needs new markup, add it without disturbing those hooks.
- **Both themes, every change.** Keep `data-theme` + the `prefers-color-scheme` fallback + the chrome.js
  toggle. Functional color stays (godan=vermilion/coral · ichidan=indigo · irregular=gold · leech=plum ·
  good=jade); only treatment/layout changes.
- **Token aliasing is the linchpin** — keep `--godan→--brand` / `--ichidan→--reading` /
  `--irregular→--gold` / `--paper-2→--raised` resolving; the hand-rolled SVG charts read those.
- **Respect the CSS cascade order**: `chrome.css` before `styles.css`; surface files after `styles.css`,
  each self-contained with its own mobile `@media`. New surface rules + their mobile overrides go in the
  surface file.
- **Keep core pure + DOM-free** (`src/core/*` is unit-tested under happy-dom); feature glue in
  `src/features/*`, shared mutable state in `src/state.js`.
- No framework, no chart library, no CDN icon font — icons stay the inline `<symbol>` sprite, charts
  stay hand-rolled SVG. Google Fonts is the only external dep; degrade gracefully offline.
- **⚠️ Do NOT stop/restart the dev servers on `:5173` (study-app) or `:3000` (API)** — the maintainer has
  live tabs. Drive a SEPARATE design preview / proxy harness for your checks. Only restart a server if
  it's actually down (`curl -s localhost:5173` / `localhost:3000/v1/health`).

## Verify each change yourself (don't ask the maintainer to check)
- `bun run test` (244 must stay green — a broken `core/*` export fails it) + `bun run build` green.
- **Screenshot the touched surface in BOTH themes and `Read` the PNGs, comparing to the matching
  `screens/*.png`.** Force a theme with `document.documentElement.setAttribute('data-theme','light'|'dark')`
  (the preview's system pref is dark). Seed the home/stats via `localStorage['jpverbs_v3']` + reload.
- **Minna content + Songs/Self-Talk content are server-backed and need a signed-in same-origin preview**
  — a plain `:5174` preview loads ZERO server content (credentialed CORS only echoes `:5173`). Use the
  **proxy-harness + reused-session-cookie recipe in MIGRATION_PROGRESS.md "How to continue / verify"**.
  Stay VIEW-ONLY on the real account (no activating vocab / recording / authoring).
- Report what changed in prose. **One logical change per commit** on `redesign-migration`; stage explicit
  paths (never `git add -A`; leave `.claude/launch.json` and any temp harness files out); end each commit
  with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Update the docs as you go**: tick the surface off "The gap" + "Remaining work" in
  MIGRATION_PROGRESS.md; keep CLAUDE.md "Design system" accurate.

## Definition of done (per surface, then overall)
A surface is done when its live render (both themes, signed-in where gated) **matches its
`screens/*.png` mock** — the editorial composition, not just the palette — with tests + build green and
no dead-end/contract regressed. Phase 8 is done when every "The gap" row is closed, the docs reflect it,
and the maintainer signs off. Keep the mocks in `mockups/redesign/` as the reference — don't delete them.
**Push / open the PR only when the maintainer says so.**

Start by reading the four docs above and skimming the mocks, then give me a **short written plan** —
which surface you'll rebuild first and how you'll structure it — **before editing any code.**
