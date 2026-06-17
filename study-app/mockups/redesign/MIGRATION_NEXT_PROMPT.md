# Kickoff prompt — Phase 9: fix the FRAME, then make every surface mock-faithful

> Paste the block below to start the next session. The `redesign-migration` branch is checked out
> (Phases 0–8 committed, **not pushed**). Phase 8 built the per-surface *compositions* but the app
> **still does not look like the mocks** — the global frame (navbar + margins) is wrong on every screen,
> 歌 Songs is a half-measure, and the panels need a pixel-fidelity pass. This phase fixes that.

---

You are building **Phase 9 of the "Day / Night" redesign** of the production 日常日本語 / Japanese
Trainer study app (`study-app/`) — a Vite, no-framework, ES-modules app on the **`redesign-migration`**
branch (checked out, not pushed). This is real production code: work in **small, shippable, reversible
steps and verify every change in the browser yourself.**

## WHY THIS PHASE EXISTS — read this, it sets the priority
Phase 8 rebuilt each panel's editorial *composition* (the bignum study-home hero, the 2-col + hanko
flashcard, the Browse/Stats headers, the みんなの日本語 hanko hero + grammar grid + speaker bubbles, a
Songs play-card, the Self-Talk header). The maintainer reviewed it and **it still does not read as
`screens/*.png`.** Their words: *"the site currently does not look like our design mock-ups at all"* —
specifically the **navbar is completely wrong**, the **margins don't match**, **Songs is a rejected
half-measure**, and **many mocks don't quite match**. The Phase-8 panels are scaffolding sitting inside
a wrong, cramped frame. Your job is to make it ACTUALLY match the mocks, frame first.

## READ FIRST, IN THIS ORDER (before any code)
1. `study-app/mockups/redesign/MIGRATION_PROGRESS.md` — start here. The **"⚠ The honest gap
   (post-Phase-8 review)"** section and **"Remaining work — Phase 9"** are your priority-ordered
   worklist. Also: the CSS-architecture cascade rules, the "Load-bearing things preserved" list, and the
   **signed-in proxy-harness recipe** ("How to continue / verify").
2. `study-app/CLAUDE.md` — the "Design system" section (the "⚠ Skin ≠ layout" note now describes this
   exact gap) and the **"Things that look like bugs but aren't" dead-ends** — those are the CONTRACTS
   you must not break even while restructuring chrome. Especially: the **`#navExtra` speaking-bar dock**,
   the tab JS (`data-tab`/`initTabs`/the `leaveMinna` hook), roving-tabindex/ARIA, the `.mn-vocab` Safari
   rule, record-compare keying.
3. `study-app/mockups/redesign/system.css` — the visual source of truth. For this phase the
   **`.topbar` / `.brand` / `.nav` / `.top-actions` / `.icon-btn` / `.avatar` block + its `@media`
   topbar grid**, and **`.wrap`** (`max-width:1180px; padding:0 40px 96px`), are what you're matching.
4. The mock you're working on, next to BOTH its screenshots (`screens/<name>.png` + `-dark.png`), e.g.
   `hybrid-songs.html` + `screens/hybrid-songs.png`. Translate onto the app; don't ship system.css verbatim.

## THE WORK — in STRICT order (the frame is the precondition for everything else)
1. **Global chrome / navbar (FIRST — it's on every screen).** The app ships a WRONG two-row chrome:
   `<nav class="navbar">` (brand + a centered `#navExtra` dock + theme/settings + a **text** "Sign in"
   button) with a **separate `<div class="tabs">`** strip below. Rebuild it as the mock's **single-row
   `.topbar`**: `.brand` (日常日本語 + a "Japanese Trainer" sub) · the tabs **inline** as `.nav`-style
   links with the underline-active bar · `.top-actions` = theme `.icon-btn` + settings `.icon-btn` + a
   **round gradient `.avatar`** (the user's initial; the account/sign-in state lives behind it — keep
   `#accountBtn`'s id + click wiring + `updateAccountChip`). **Reconcile the `#navExtra` speaking-bar
   dock** (a dead-end: みんなの日本語/独り言/歌 mount the record-compare/speaking bar there via
   `createSpeakingBar` — it CANNOT be deleted): give it a home in the single-row world (e.g. a sticky
   sub-bar directly under the topbar, shown only when a surface mounts it). Mobile = the mock's
   `grid-template-areas:"brand actions" / "nav nav"` (brand+actions row, then a horizontally-scrollable
   nav row). Keep `initTabs` + `data-tab` working. Files: `index.html` (~90–116), `src/styles/chrome.css`.
2. **Global margins (SECOND — every screen).** Widen `.wrap` to `max-width:1180px; padding:0 40px 96px`
   (`src/styles/base.css`) and align the topbar/tabs to the same 1180 column + 40px gutter (the mock
   uses `padding-left:max(40px, calc((100vw - 1180px)/2 + 40px))` on the topbar). This is the single
   biggest "now it looks like the mock" change — do it before any per-surface tuning, then re-screenshot
   every surface (the extra width changes grid wrapping).
3. **歌 Songs — rebuild for real** (the Phase-8 hero is a rejected half-measure). Match
   `hybrid-songs.html`: the play-card with a circular **cover-ring play button** (the video plays on
   demand — "Play with video" — not a raw iframe sitting in the hero), a **segmented** coverage bar +
   coverage ring, the lyrics-only toggle, over the editorial lyric reader with the **glowing current
   line**, and the **mined-vocab side panel** beside Read. Keep the YouTube-embed lifecycle, the stable
   `#sgContent` re-render, and the Shadow record-compare seams.
4. **Per-surface FIDELITY pass** over study-home, flashcard, Browse, Stats, みんなの日本語, 独り言: open
   each `screens/*.png` next to a live render in BOTH themes and close the deltas — exact paddings, font
   sizes, gaps, the hero/section rhythm — against `system.css` + each mock's inline `<style>`. This is
   the bulk of the work and only pays off after 1 + 2.
5. **独り言 interaction-model decision (ask the maintainer):** keep the current topic-browser (a
   functional superset) or restructure to the mock's daily-5 *featured-card + prompt-rail* flow. The
   editorial skin already shipped; the flow change is a real UX call.
6. **Optional polish:** re-tune the four non-verb category accents to the warm palette; the modal-kit /
   record-compare own-file split.
7. **Maintainer sign-off → push / open the PR.**

Stage it: do 1 then 2, then **stop and show the maintainer the reframed app in both themes** before the
big per-surface fidelity grind — the frame is what they reacted to, so confirm it before investing in 3+4.

## HARD CONSTRAINTS (do not violate)
- **Keep every CLAUDE.md dead-end / contract intact while restructuring:** the `#navExtra` speaking-bar
  dock (relocate, don't delete), the tab wiring (`data-tab`/`initTabs`/`leaveMinna`/per-tab renders),
  `#accountBtn`/`updateAccountChip`/`#syncStatus`, chip wiring by class + `data-*`, `.frow`/`.chips`,
  roving-tabindex / ARIA radiogroups, the inline-SVG-sprite size hack + `#stamp` filter, the `.mn-vocab`
  `0 solid transparent` Safari rule, modals scroll-cap + sticky `.modal-x`, the `data-furigana` flip,
  record-compare keying (scopes/itemKeys), the sentence-store / `normalizeLine` seams, `state.js`
  single-writer singletons, the reduced-motion rule.
- **Both themes, every change.** `data-theme` + the `prefers-color-scheme` fallback + the chrome.js
  toggle. Functional color stays (godan=vermilion · ichidan=indigo · irregular=gold · leech=plum ·
  good=jade).
- **Token aliasing is the linchpin** — keep `--godan→--brand` / `--ichidan→--reading` /
  `--irregular→--gold` / `--paper-2→--raised` resolving (the hand-rolled SVG charts read those).
- **CSS cascade order:** `chrome.css` before `styles.css`; surface files after `styles.css`, each
  self-contained with its own mobile `@media`. The chrome mobile overrides live in `styles.css` (rule A)
  — when you restructure the navbar, move/keep those overrides consistent with the new markup.
- **No framework, no chart library, no CDN icon font.** Icons stay the inline `<symbol>` sprite; charts
  stay hand-rolled SVG. Google Fonts is the only external dep; degrade gracefully offline.
- Keep `src/core/*` pure + DOM-free (unit-tested under happy-dom); feature glue in `src/features/*`,
  shared mutable state in `src/state.js`.
- **⚠️ Do NOT stop/restart the dev servers on `:5173` (study-app) or `:3000` (API)** — the maintainer
  has live tabs. Drive a SEPARATE design preview / proxy harness. Only restart a server if it's actually
  down (`curl -s localhost:5173` / `localhost:3000/v1/health`).

## VERIFY EVERY CHANGE YOURSELF (don't ask the maintainer to check)
- `bun run test` (≥244 must stay green) + `bun run build` green.
- Screenshot the touched screen in BOTH themes and `Read` the PNGs side-by-side with the matching
  `screens/*.png`. Force a theme with `document.documentElement.setAttribute('data-theme','light'|'dark')`
  (the preview's system pref is dark). Seed home/stats via `localStorage['jpverbs_v3']` + reload.
- **みんなの日本語 / 歌 / 独り言 content is account-gated** — verify SIGNED-IN via the same-origin proxy
  harness in MIGRATION_PROGRESS.md "How to continue / verify": a throwaway `vite --config <tmp>.mjs`
  proxying `/v1` + `/media` → `:3000` with `VITE_API_BASE=` empty, and the owner session cookie injected
  **server-side** in the proxy config (`proxy.on('proxyReq', …setHeader('cookie', …))`) — the preview
  context blocks `document.cookie`. Read a valid token from `wk-enhanced-api/dev-data/wk-vocab.sqlite`
  `sessions` (owner = `MINNA_OWNER_EMAILS`); confirm with `curl <proxy>/v1/auth/me`. Stay VIEW-ONLY on
  the real account. Delete the temp harness files (they hold the token) when done.
- Report what changed in prose. **One logical change per commit** on `redesign-migration`; stage
  explicit paths (**never `git add -A`**; leave `.claude/launch.json` + temp harness files out); end
  each commit with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Update `MIGRATION_PROGRESS.md` as you go (tick the frame rows / ◐ rows as they become mock-faithful).

## DEFINITION OF DONE
A screen is done when its live render (both themes, signed-in where gated) matches its `screens/*.png`
mock — **the frame AND the composition AND the spacing**, not just the palette — with `bun run test` +
`bun run build` green and no dead-end/contract regressed. **Phase 9 is done when the maintainer agrees
the site looks like the mock-ups.** Keep the mocks in `mockups/redesign/` as the reference. Push / open
the PR only when the maintainer says so.

Start by reading the docs above and the `.topbar` + `.wrap` specs, then give me a short written plan for
the navbar rebuild (including how you'll reconcile the `#navExtra` speaking-bar dock) before editing code.
