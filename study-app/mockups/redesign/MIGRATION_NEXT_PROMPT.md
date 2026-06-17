# Kickoff prompt — finish the Day/Night redesign migration

> Paste the block below to resume in a fresh session. It assumes the
> `redesign-migration` branch is checked out (8 commits, Phases 0–7 shipped).

---

You are continuing the **"Day / Night" visual redesign migration** of the production
日常日本語 / Japanese Trainer study app (`study-app/`). Phases 0–7 already shipped as 8 commits on the
**`redesign-migration` branch** (currently checked out, not yet pushed). This session finishes the
remaining work: a **signed-in verification pass** on the account/server-gated surfaces, **polish** on the
shared speaking-mode UI, a **Safari check**, and then prep to push. This is real production code — work
in shippable, reversible steps and verify as you go.

## Read first, in this order (before any code)
1. `study-app/mockups/redesign/MIGRATION_PROGRESS.md` — what shipped, the decisions, the new per-surface
   CSS architecture **and the two cascade-order rules you must not break**, and what's verified vs not.
   This is your map.
2. `study-app/CLAUDE.md` — the "Design system" section (the shipped system) + the "Things that look like
   bugs but aren't" dead-ends. These are load-bearing.
3. `study-app/mockups/redesign/system.css` — the visual source of truth (tokens, both themes, component
   treatments). You translate it onto the existing classes; you do NOT ship it verbatim.
4. The mocks for the surfaces you're verifying, next to their screenshots: `hybrid-minna.html` +
   `screens/hybrid-minna{,-dark}.png`, `hybrid-songs.html` + `screens/hybrid-songs{,-dark}.png`,
   `hybrid-selftalk.html` + `screens/hybrid-selftalk{,-dark}.png`.

## The work (priority order)
1. **Signed-in verification pass.** Sign in (the dev API must run: `bun dev` in `wk-enhanced-api`, with
   `MINNA_OWNER_EMAILS` including the account) and walk these in **both themes**, comparing to the mocks:
   - **みんなの日本語** lesson content — vocab table (mind the `.mn-vocab` Safari border trap), grammar
     cards, conversation, notes, practice history.
   - **歌 Songs** full UI — Library cards, the Add flow, the Read lyric reader, Listen dictation, Shadow,
     Mine vocab/grammar, the grammar reference.
   - **独り言 Self-Talk** — drill into a topic to see the phrase list + the slot-swap templates.
   Fix anything that reads flat, unlifted, or mis-colored. Surface-specific CSS lives in
   `src/styles/{minna,selftalk,songs}.css`.
2. **Polish the shared speaking-mode UI** (still token-warmed, not fully lifted, in `src/styles.css`): the
   record-compare controls (`.rec-*`/`.cmp-*`/waveforms), the navbar speaking bar (`.speaking-bar`), and
   the tap-a-word popover (`.word-pop`). Lift/round them to match the rest.
3. **Safari check** — open the app in Safari; verify the `.mn-vocab` border-collapse table has no phantom
   lines (the trap rule is preserved verbatim) and the modal/navbar `backdrop-filter`s render.
4. **Optional polish** — re-tune the four non-verb category accents (`--adjective/--noun/--adverb/
   --phrase` in `styles/tokens.css`) to the warm palette if they look off against the redesign.
5. When the maintainer is satisfied, **push the branch / open a PR** (ask first — they asked not to push
   in the prior session).

## Hard constraints (do not violate)
- **Reskin-in-place.** Do NOT change markup, class names, `data-*`, or JS. Only CSS (+ tiny `index.html`
  head/atmosphere if truly needed). Preserve every CLAUDE.md dead-end: chip wiring, `.frow`/`.chips`,
  roving-tabindex/ARIA radiogroups, the inline-SVG-sprite size hack, the `.mn-vocab` `0 solid transparent`
  rule, modals scroll-cap + sticky ×, the `data-furigana` flip, the `#navExtra` dock.
- **Respect the CSS cascade order** (MIGRATION_PROGRESS.md): `chrome.css` before `styles.css`; the surface
  files after `styles.css`, each self-contained with its own mobile `@media`. Put a surface's mobile rules
  in the surface file.
- **Both themes, every change.** Keep the `data-theme` + `prefers-color-scheme` fallback + the chrome.js
  toggle. Functional color meaning stays (godan=vermilion/coral, ichidan=indigo, irregular=gold,
  leech=plum, good=jade) — only hexes/treatment change.
- **Token aliasing is the linchpin** — keep `--godan→--brand` etc. resolving; charts read those.
- No framework, no chart library, no CDN icon font. Google Fonts is the only external dep; degrade
  gracefully offline.
- **⚠️ Do NOT stop/restart the dev servers on `:5173` (study-app) or `:3000` (API)** — the maintainer has
  live tabs. Drive the already-running preview, or spin a SEPARATE design preview, for your own checks.
  Only restart a server if it's actually down (`curl -s localhost:5173` / `localhost:3000/v1/health`).

## Verify each change (don't ask the maintainer to check manually)
- `bun run test` (244 should stay green) + `bun run build` green.
- Screenshot the touched surface in **both themes** via the running preview and compare to the matching
  `study-app/mockups/redesign/screens/*.png`. `Read` the PNGs yourself. Force a theme with
  `document.documentElement.setAttribute('data-theme', 'light'|'dark')` (the preview's system pref is
  dark). Seed stats via `localStorage['jpverbs_v3']` + reload if needed.
- Report what changed in prose; commit one logical change per commit on `redesign-migration`; stage
  explicit paths (never `git add -A`); end each message with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Definition of done
Every account/server-gated surface (Minna content, Songs full UI, Self-Talk phrase lists) matches the
mocks in both themes; the shared speaking-mode UI is lifted to match; Safari is clean (no `.mn-vocab`
phantom lines); tests + build green; no dead-end regressed; CLAUDE.md "Design system" + the migration docs
stay accurate. Keep the mocks in `mockups/redesign/` as the reference — don't delete them.

Start by reading the four docs above, then give me a short written plan for the verification pass before
editing.
