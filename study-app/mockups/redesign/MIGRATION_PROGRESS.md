# Day / Night migration — progress & handoff

> **Read this first to continue the redesign migration.** It records what shipped, the decisions we
> made, the new CSS architecture (with the cascade-order rules you must not break), what's verified vs
> not, and the remaining work. The *plan* is [MIGRATION.md](MIGRATION.md); the *mocks* (visual source of
> truth) are `system.css` + `screens/*.png`; the shipped design system is documented in
> [../CLAUDE.md](../CLAUDE.md) "Design system". A ready-to-paste **kickoff prompt is at the bottom**.

## Status — ✅ Phases 0–7 shipped, finishing touches left

The serif-free **"Day / Night"** redesign is applied to the real app via **reskin-in-place + token
aliasing**. Markup, class names, `data-*`, and every JS contract are unchanged — only CSS + the
`index.html` head/atmosphere changed. **8 commits on the `redesign-migration` branch (NOT pushed/merged).**
`bun run test` (244 passing) + `bun run build` were green every phase.

| Phase | Commit | What landed |
|---|---|---|
| 0 Foundation | `af20cd1` | the token layer + aliasing, Google Fonts (Bricolage/Hanken/Spline/Zen Kaku), `.grain`/`.atmos` atmosphere + `#stamp` filter, all-sans base type (serif removed) |
| 1 Chrome | `2615b68` | frosted sticky navbar + Zen Kaku brand, body-font underline-active tabs |
| 2 Flashcards | `1d479aa` | study home (due banner/forecast/big count) + the flashcard (spine/pitch/meaning/notes/example/grades) + the shared `.btn`/`.chip`/`.speak-btn`/inputs/segmented reskin |
| 3 Browse | `8386c19` | color-coded grid cards (spine + hanko stamp) + the detail-modal memory pips; furigana `rt` → brand-tinted |
| 4 Stats | `0d038a1` | lifted metric cards + chart panels + leech list (the hand-rolled SVG charts reskinned **for free** via the aliases) |
| 5 Textbook/Self-talk/Songs | `8eb35ba` | the three big surfaces lifted + rounded |
| 6 Modals & forms | `b20486e` | the overlay/modal/field kit (Settings, auth, add-card) |
| 7 Mobile + QA + docs | `96fb893` | ≤640px pass, navbar tightening, the CLAUDE.md "Design system" rewrite |

## The new CSS architecture (don't break this)

The 953-line `src/styles.css` was split. `src/main.js` imports them **in this exact cascade order**:

```js
import './styles/tokens.css';     // 1. palette: :root + [data-theme=dark] + prefers-color-scheme fallback, + the aliases
import './styles/base.css';       // 2. reset, body, .jp, .wrap, .grain/.atmos atmosphere
import './styles/chrome.css';     // 3. navbar + tab strip            ← BEFORE styles.css (see rule A)
import './styles.css';            // 4. THE SHARED CORE (see below)
import './styles/flashcards.css'; // 5. study panel                  ┐
import './styles/browse.css';     // 6. grid + detail memory          │ surface files, each
import './styles/stats.css';      // 7. metric cards + charts + leech │ self-contained incl. its
import './styles/minna.css';      // 8. みんなの日本語 dashboard         │ OWN mobile @media,
import './styles/selftalk.css';   // 9. 独り言                         │ AFTER styles.css (rule B)
import './styles/songs.css';      // 10. 歌                           ┘
```

**`src/styles.css` (464 lines) is the SHARED CORE** — not a surface. It holds: `.btn`/`.chip` systems,
the filter kit (`.frow`/`.chips`/`.jlptseg`/`.more-filters`/`.topic-toggle`/`.search`/`.filter-summary`),
`.speak-btn`, the **overlay/modal/form kit**, the **record-compare + speaking-bar** kit, the **tap-a-word
`.word-pop`** + `.ex-grammar`, the global utils (`.ic`, `svg{}` chart rule, `:focus-visible`,
`data-furigana` flip, the motion keyframes + reduced-motion), and the shared badges
(`.speak-btn.playing`, `.minna-badge`, `.custom-badge`). The **chrome mobile `@media` overrides** also
live here.

**Two cascade rules that make the order work — keep them:**
- **Rule A — `chrome.css` is imported BEFORE `styles.css`** because the navbar/tab mobile `@media`
  overrides (`.nav-inner{flex-wrap}`, `.tab{min-height}`, `.nav-title .nav-sub{display:none}`, …) live in
  `styles.css`; they must come *after* chrome's desktop rules to win at ≤640px.
- **Rule B — each surface file is imported AFTER `styles.css` and is SELF-CONTAINED**: it carries its own
  `@media (max-width:…)` block. So a surface's desktop rules (later) never get clobbered by a stale
  mobile remnant in `styles.css`, and the surface cleanly overrides the shared core. **When you add a
  surface rule, put its mobile override in the surface file, not in `styles.css`.**

## Key decisions

**The four open decisions (confirmed with the maintainer up front):**
1. **Reskin-in-place** (not class-rename) — keep production markup/classes/`data-*`/JS. ✅
2. **Keep the JP font switcher**, Zen Kaku Gothic New as the new default option. ✅
3. **Split per-surface** CSS (the maintainer chose this OVER the recommended single-file). ✅ — done
   incrementally ("during the migration"), peeling each surface as its phase reskinned it.
4. **Phase 0 then a look-check, then continue phase-by-phase.** ✅ — paused after Phase 0 for approval,
   then ran 1–7 (maintainer said "commit, continue", no push).

**Token aliasing (the linchpin, `styles/tokens.css`):** the redesign role tokens are the source of
truth (`--brand`/`--reading`/`--gold`/`--raised`/…). The **production token names the code + charts
already reference are aliased onto them** so nothing JS-side had to change:
`--godan→--brand` · `--ichidan→--reading` · `--irregular→--gold` · `--paper-2→--raised`. `--jp-font`
stays the live token the font switcher rewrites (`--jp` flows from it). The 3 blocks (`:root` light,
`[data-theme=dark]`, the `prefers-color-scheme` fallback) repeat the aliases — keep all three in sync.
**This is why the hand-rolled SVG charts reskinned with zero chart-code changes** (validated on Stats).

**Engineering decisions worth knowing:**
- **Surface files imported AFTER `styles.css`** (rule B) so a missed removal during a peel is harmlessly
  overridden, not a regression — made the big peels safe.
- **The modal/form kit was NOT peeled into a `modals.css`** — it's shared UI (like buttons/chips) and
  its rules are scattered, so it was reskinned in place in `styles.css`. (Consistent with keeping
  buttons/chips/filters in the shared core.)
- **Non-verb category accents (`--adjective`/`--noun`/`--adverb`/`--phrase`) were carried forward
  unchanged** — `system.css` doesn't define them and no mock shows them (all 100 built-ins are verbs).
  Re-tune later if wanted; flagged as the one deviation from "only the hexes change".
- **Furigana `rt` is now brand-tinted + `.4em`** (a global change, affects every `<ruby>`). The mock
  spec is `.34em`; we used `.4em` for legibility.
- **`.flashcard` keeps the production's centered structure** (not the mock's wide editorial 2-col layout
  with the big hanko) — reskin-in-place means we restyle the existing centered card, not restructure it.
- **Light depth = shadow-driven (`--lift-*`), dark depth = glow-driven.** Both live on the component
  surfaces, not on luminance — don't try to "lift" cards by whitening them.

## Verified vs not

**Verified in BOTH themes** (drove a separate `:5174` design preview — the maintainer's `:5173`/`:3000`
were never touched): chrome · flashcards home + a revealed card · browse grid + filter bar · stats cards
+ charts (seeded sample data) · self-talk grid · the Minna sign-in gate · Settings (light) + auth (dark)
modals · mobile at ~390px (no horizontal overflow). All compared against `screens/*.png`.

**NOT deeply verified (reskinned from mocks + tokens, but account/server-gated so only the gate/anon
shell rendered):**
- **みんなの日本語 lesson content** — the vocab table, grammar cards, conversation, notes, practice
  history. Only the **sign-in gate** was on screen.
- **歌 Songs full UI** — Library cards, the Add flow, the Read lyric reader, Listen dictation, Mine
  vocab/grammar, the grammar reference. Only the **anon empty shell** rendered.
- **Self-Talk** — the grid + cells were verified; the **drilled-in phrase lists** + slot-swap templates
  need server phrase data.
- **The shared record-compare / speaking-bar / tap-a-word `.word-pop`** — these got a *light* token-warm
  pass (rounded, token colors), NOT the full lifted treatment. Signed-in speaking-mode UI.
- **Safari** — everything was on Chrome (the preview). The `.mn-vocab` border-collapse trap rule is
  preserved **verbatim** in `minna.css`, but a real Safari look is owed (also the `backdrop-filter`s).

## Load-bearing things preserved (do not regress — see ../CLAUDE.md dead-ends)
Chip wiring by class + `data-*`; the `.frow`/`.chips` two-track layout; roving-tabindex / ARIA
radiogroups; the inline-SVG-sprite size-via-inline-style hack (the new `#stamp` filter uses it too); the
`.mn-vocab` `0 solid transparent` Safari rule; modals scroll-cap + sticky `.modal-x`; the `data-furigana`
flip; the `#navExtra` dock; the reduced-motion rule (kills transition **and** animation); no framework /
no chart library / no CDN icon font (Google Fonts is the one external dep, degrades to system fonts).

## Remaining work (priority order)
1. **Signed-in verification pass** on Minna lesson content + the full Songs UI + Self-Talk phrase lists,
   in both themes. Sign in via the dev API (`bun dev` in `../wk-enhanced-api`, `MINNA_OWNER_EMAILS`
   includes the account). Fix anything that reads flat / unlifted / mis-colored.
2. **Polish the shared record-compare + speaking-bar + `.word-pop`** to the full lifted treatment.
3. **Safari check** — the `.mn-vocab` table + the modal/navbar `backdrop-filter`s.
4. **Optional:** re-tune the four non-verb category accents to the warm palette; consider whether the
   modal kit + record-compare deserve their own files (currently shared in `styles.css`).
5. **Push / open the PR** once reviewed.

## How to continue / verify
- **Don't touch `:5173` (study-app) or `:3000` (API)** — the maintainer's live tabs. Drive the running
  preview, or spin a separate design preview (the `study-app-design` launch config — note it binds a
  free port like 5174, not the 5180 the tool reports). Force a theme with
  `document.documentElement.setAttribute('data-theme','light'|'dark')` (the preview's system pref is
  dark). Seed stats via `localStorage['jpverbs_v3']` + reload (CLAUDE.md dead-end).
- Each phase: `bun run test` + `bun run build` green; screenshot the touched surface in **both themes**;
  compare to `screens/*.png`; `Read` the PNG to confirm; one commit per logical change; stage explicit
  paths; end the message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Kickoff prompt for the next session
See [MIGRATION_NEXT_PROMPT.md](MIGRATION_NEXT_PROMPT.md) (also reproduced in the chat that generated this
doc) — paste it to resume.
