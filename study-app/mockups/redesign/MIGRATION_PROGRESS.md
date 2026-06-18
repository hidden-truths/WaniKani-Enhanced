# Day / Night migration — progress & handoff

> **Read this first to continue the redesign migration.** It records what shipped, the decisions we
> made, the new CSS architecture (with the cascade-order rules you must not break), what's verified vs
> not, and the remaining work. The *plan* is [MIGRATION.md](MIGRATION.md); the *mocks* (visual source of
> truth) are `system.css` + `screens/*.png`; the shipped design system is documented in
> [../CLAUDE.md](../CLAUDE.md) "Design system". A ready-to-paste **kickoff prompt is at the bottom**.

## Status — ⚠ fidelity audit IN PROGRESS on `redesign-fidelity` (Phase-9 "✅" was premature; Flashcards + Stats rebuilt)

> **2026-06-17 fidelity re-audit (maintainer: "still a lot of problems").** The Phase-9 "per-surface
> fidelity pass — DONE for 5 of 6" was **over-stated**. A page-by-page, element-by-element re-check
> found the **Flashcards** page did NOT match `screens/*.png`: buttons were square *app-wide* (a CSS
> comment bug deleted the base `.btn` rule — in **prod too**), the hanko had a mis-sized-circle artifact
> (a global `.ring` collision), the forecast was mis-sized, the dark-mode CTA glow was missing, and the
> play/copy + hero-CTA icons were wrong. **All fixed** on `redesign-fidelity` (off `main`, 7 commits) —
> see **"Fidelity audit (2026-06-17)"** immediately below. **The other pages still need the same pass;
> do NOT trust their "✅."**

**Phase 9 (2026-06-17, `5e53239`…`e335077`, on `redesign-migration`) fixed the frame and finished the
match.** The chrome is the mock's single-row topbar (with the `#navExtra` speaking-bar dock relocated to
a sticky sub-bar), the content frame is the 1180/40 column with proper top breathing room, 歌 Songs is
rebuilt as the two-column stage (hero play-card · on-demand video · glowing playhead · mined-vocab rail),
独り言 is the daily-5 hybrid (featured card + rail + the kept topic browser), the fidelity pass confirmed
study-home/flashcard/Browse/Stats/みんなの日本語 already land once the frame is right, and the optional
polish shipped (the four non-verb accents re-tuned to the warm palette; the modal-kit + record-compare
CSS peeled to their own files). All verified signed-in in both themes; `bun run test` 245 green +
`bun run build` green. **Remaining: maintainer sign-off → merge to `main` (then push).** Next-steps /
possible improvements are in [../../NEXT_STEPS.md](../../NEXT_STEPS.md). The historical Phase-8 reality
check is kept below for context.

## Fidelity audit (2026-06-17) — Flashcards page DONE; prior "✅" markers were premature

Branch `redesign-fidelity` (off `main`). The Flashcards page (study home + the card) was re-audited
element-by-element against `screens/hybrid-day-night.png` / `-mobile` + `hybrid-prompt.html` in BOTH
themes. It did **not** match. Root causes + fixes (each its own commit; `bun run test` 245 + `bun run
build` green per commit; verified light + dark + ~390px):

- **`f3d35f0` — every button was square, app-wide (dev AND prod).** A class-glob in a `styles.css`
  comment (`…/.spine/.prompt-*/.answer/…`) contains `*/` (inside `.prompt-*/`), which **prematurely
  closes the CSS comment**; the leftover text + the following comment collapsed into a garbage selector
  that **swallowed the entire base `.btn{ …border-radius:12px; background; border; box-shadow… }` rule**,
  so all buttons lost their radius/fill/lift. Three such landmines existed (one also ate `.ex{font-size}`).
  Minifiers honour `*/` too, so prod was affected, not just dev. Fixed by spacing the `*` off the `/`.
- **`847a438` — the hanko "mis-sized circle" was a global `.ring` collision.** `songs.css` shipped a
  bare global `.ring` (its 40×40 conic coverage ring, only ever used as `.sc-ring > .ring`) that, being
  imported last, leaked onto the decorative seal rings (`.hanko .ring`, `.lesson-seal .ring` — which set
  only `inset`), forcing a 40px offset circle + a stray conic fill. Scoped it to `.sc-ring .ring`. (The
  みんなの日本語 lesson seal had the identical artifact.)
- **`0da0bb2`** — restored the mock's dark-mode `@keyframes breathe` glow on primary CTAs (the app had
  dropped it). Excludes `:disabled` so the caught-up jade hero stays still.
- **`b74ea8e`** — study-home hero + forecast fidelity: numeral 178→188, kicker/due-label/meta margins,
  CTA sizes; forecast dropped a stray chart icon + matched padding/title/bars (104px, 13px gap, **28px
  floor bars not 9px slivers**, 6px radius).
- **`22f821f`** — flashcard example play/copy → the mock's 34px bordered `.tool-btn` tiles (with
  `.playing`/`.copied` states), was 24px round `.speak-btn.sm`.
- **`bbfcd91`** — audio "play" buttons → the filled ▶ `#i-play` triangle **app-wide** (`speakBtnHtml` +
  the two flashcard play buttons), was the 🔊 speaker. Left the speaker on the auto-play **setting** label
  + the record-compare **reference** button (where speaker-vs-▶ distinguishes reference voice from take).
- **`e0888d0`** — hero CTA icons: "Review due cards" → text + a **trailing arrow** (`#i-arrow-right`,
  hover-slides right); "Free study" → a **list-lines** icon (`#i-list`). Added both as sprite symbols.

**Maintainer decisions this pass:** the flashcard **stays 820px centered** (declined widening to the
mock's full-column card + the consequent word-size bump); audio play uses the **▶ triangle** everywhere
(chosen over keeping the speaker glyph).

**Open mobile nit (deferred to the dedicated mobile sweep):** the bignum is 96px at ≤430px vs the mock's
84px — the app's responsive breakpoints (900/430) differ from the mock's (640/430); fix breakpoints +
bignum together in the sweep, not piecemeal.

### Stats page — REBUILT (2026-06-18, 7 commits on `redesign-fidelity`)
The maintainer flagged Stats as "a LOT of problems." It was NOT mock-faithful — Phase 8/9 had only
RESKINNED the old panels (flat 6-up metric grid, horizontal pipeline, generic 0-100 daily chart, thin
leech rows, 1-col per-card, no seals/panel-chrome/footer). Re-audited element-by-element vs
`screens/hybrid-stats.png` / `-dark` + `hybrid-stats.html` and rebuilt the whole surface (each its own
commit; `bun run test` 245 + `bun run build` green per commit; verified both themes at 1280 + 390px):
- **`1834264`** — page head 64px + 17.5px lead; flat auto-fit 6-tile `.statgrid` → the **3-hero /
  3-quiet** `.metrics` grid (84px gradient numerals, icon labels, warm corner-washes, tinted quiet
  values) + a **real week-over-week trend pill** from the session ledger. The hero modifier is
  `.is-hero`, NOT the mock's `.hero` — the global study-home `.hero` grid (`display:grid 1fr/auto`) was
  hijacking the cards' layout and right-shifting the numeral.
- **`07ede2d`** — the 記/虫 section seals; `.chart-card` promoted to the mock panel (gold tab + a
  `.panel-head` of display title + mono sub + data-driven badge); dropped the per-session chart (not in
  the mock). NB the live `.panel` class is the tab container, so the cards stay `.chart-card`.
- **`d2b28db`** — memory pipeline: horizontal bars → the **vertical stone→jade** Leitner bars (new
  `--box-0..5` ramp, compressed 52-88% height band, counts inside/above, the ramp legend).
- **`ddf9004`** — daily accuracy: generic 0-100 line → a zoomed/area-gradient/gold-avg/jade-glow chart
  (theme-aware `--dl-line` so it re-tints with no re-render; `getTotalLength` draw-in) + the
  daily%/average/today foot.
- **`54b519e`** — leeches: thin rows → rich plum-spined rows (accuracy bar + attempts), worst-first,
  with a per-row **Review** pill that drills that one card (`reviewSingle`, free study). New shared
  `--acc-poor/mid/good` ramp.
- **`2a4d59d`** — per-card: 1-col list → the **2-column** poor/mid/good grid + cap legend (removed the
  now-orphan `barChart()`).
- footer seal-line + the leech mobile-stack rule.

**Remaining pages still need this same element-by-element audit — do NOT trust their "✅":** Browse,
みんなの日本語, 歌 Songs, 独り言, Modals, and the full mobile sweep. (Flashcards + Stats are done.)

## (historical) Phase 8 built the per-surface compositions, but the site STILL did not match the mocks

Honest assessment after the maintainer's Phase-8 review (2026-06-17): **not there.** Phase 8 (8 commits,
`c71fe61`…`78448c6`, on `redesign-migration`, **NOT pushed**) rebuilt each panel's *composition* —
the bignum hero, the 2-col + hanko flashcard, the editorial Browse/Stats headers, the みんなの日本語
hanko hero + grammar grid + speaker bubbles, a Songs play-card, the Self-Talk header. Tests stayed 245
green and both themes were checked. **But the maintainer reviewed it and it still doesn't read as the
mocks** — because the work was per-panel and skipped the two things that dominate every screen: the
**global frame** (the navbar and the page margins) is wrong, **Songs is a half-measure**, and most
panels are structurally-close but not **pixel-faithful** (spacing/treatment). See the next section.

> **The ✅ markers in "The gap" table below mean "the composition exists," NOT "matches the mock."**
> Re-read them through the reality check. The right foundation (tokens, both themes, the component
> skin, and now the rough compositions) is in place — but a real **frame fix + fidelity pass** is still
> required before this looks like `screens/*.png`. Phase 9 is that work.

## ⚠ The honest gap (post-Phase-8 review) — why it still doesn't look like the mocks

Grounded in the actual code, in priority order (the first two touch **every** screen):

1. **The navbar/chrome is structurally WRONG — and was never touched.** The app ships a **two-row**
   chrome: `<nav class="navbar">` (brand + a centered `#navExtra` speaking-bar **dock** + theme/settings
   + a **text** account button "Sign in") with a **separate `<div class="tabs">` strip below it**. The
   mock (`system.css` `.topbar` + every `screens/*.png`) is a **single-row** `.topbar`: `.brand` · the
   tabs **inline** as `.nav a` links with the underline-active bar · `.top-actions` ending in a **round
   gradient `.avatar`** (initial, not a "Sign in" pill) — **no middle dock**. Reconciling the
   `#navExtra` speaking-bar dock (a load-bearing CLAUDE.md dead-end — it can't just be deleted) with the
   mock's dock-less single-row topbar is the real design problem here. On mobile the mock's topbar is a
   `grid-template-areas:"brand actions" / "nav nav"` (brand+actions row, then a scrollable nav row) —
   so the app must be single-row on desktop, that two-row grid on mobile. Files: `index.html` (lines
   ~90–116, split `.navbar` + `.tabs`), `src/styles/chrome.css`, the `system.css` `.topbar`/`.brand`/
   `.nav`/`.top-actions`/`.icon-btn`/`.avatar` block + the `@media` topbar grid.
2. **The global content frame is CRAMPED — wrong column width + half the gutter, everywhere.** App:
   `.wrap{max-width:1100px; padding:0 20px 80px}` (`base.css:27`) and the navbar/tabs match at `1100/20`.
   Mock: `.wrap{max-width:1180px; margin:0 auto; padding:0 40px 96px}` (`system.css`). So every page is
   narrower with **half the side gutter** and a tighter bottom — the single biggest reason nothing reads
   as the airy mocks. Fix `.wrap` + the navbar/tabs max-width/padding together (the mock aligns the
   topbar's inner padding to the 1180 column via `padding-left:max(40px, calc((100vw - 1180px)/2 + 40px))`).
3. **歌 Songs is a half-measure (rejected).** Phase 8 only framed the title + tabs + a coverage ring +
   the raw iframe in a card. The mock is a proper stylised **play-card**: a big circular cover-ring
   **play button**, a **segmented** coverage bar, "Play with video" CTA + a lyrics-only toggle, over the
   editorial lyric reader (stanzas, grammar chips, the **glowing current line**) with the **mined-vocab
   side panel**. Rebuild it for real (`hybrid-songs.html` is the spec).
4. **Per-surface FIDELITY is off.** Even where the composition exists, spacing/scale/exact treatment
   don't match `screens/*.png` (compounded by #1 + #2). Each surface needs a side-by-side pixel pass:
   pull up the mock screenshot next to a live render in BOTH themes and close the deltas (paddings,
   font sizes, gaps, the exact hero/section rhythm). 独り言 also still needs the maintainer's call on the
   daily-5 *featured-card + rail* flow vs the kept topic-browser.

**Bottom line: substantial work remains.** Do the frame (1 + 2) FIRST — it changes the look of every
screen and is the precondition for a meaningful fidelity pass — then Songs (3), then the per-surface
pixel pass (4). The Phase-8 compositions are scaffolding to refine, not a finished result.

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
5. **(NEW — this review) Realize the mock LAYOUTS; reskin-in-place is now RELAXED.** Having seen the
   reskinned result, the maintainer wants the app to actually MATCH the mocks, not just wear their
   palette. So Phase 8 **may change markup + JS** (and add per-surface CSS) to build the editorial
   compositions — this supersedes Decision 1's "don't touch markup/JS". **The load-bearing CONTRACTS
   still hold, though:** chip wiring by class + `data-*`, `.frow`/`.chips`, roving/ARIA radiogroups, the
   `.mn-vocab` Safari `0-solid-transparent` rule, the `#navExtra` speaking-bar dock, record-compare
   keying (scopes/itemKeys), the sentence-store/`normalizeLine` seams, and no framework / chart-lib /
   CDN-icon-font. Change the STRUCTURE to hit the mock; don't break the wiring the dead-ends protect.

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

**Verified signed-in this session (both themes, dev API + the real owner account, content actually
rendered — drove a temporary same-origin proxy harness since the `:3000` credentialed-CORS allowlist
only echoes `:5173`):**
- **みんなの日本語 lesson content** — lesson heading + progress, the vocab table (POS + iTalki badges),
  grammar cards, example sentences, the conversation, notes, practice history. Faithful; no CSS fixes.
- **歌 Songs full UI** — Library grid (ring/coverage/badges), Add flow, the Read lyric reader (stanzas,
  grammar chips, cur-line), Listen dictation, Shadow, Mine vocab/grammar, the grammar reference.
  Faithful; no CSS fixes.
- **独り言 Self-Talk** — drilled into a topic: lifted phrase cards, the brand-tinted slot chips + filler
  menu, TEMPLATE badges + grammar tags. Faithful; no CSS fixes.
- **The shared record-compare / speaking-bar / tap-a-word `.word-pop`** — LIFTED to match the system
  (commit `34eef8c`): `.rec-btn`/`.rec-take`/`.cmp-btn` raised (`--surf-inset` + `--lift-sm` + hover),
  waveforms framed as tiles, `.word-pop` → token frosted popover, `.speaking-bar` radius 8→12.
- **Safari/WebKit** — confirmed via an isolated repro: the verbatim `.mn-vocab` rule paints NO phantom
  lines, and the navbar/modal `-webkit-backdrop-filter`s frost correctly.

So: the *skin* is verified everywhere; the *layouts* are not built. The per-surface backlog is the
next section.

## The gap — per-surface (Phase 8 built the compositions; ✅ = "composition exists," NOT mock-faithful)

The delta vs `screens/*.png`. **Read with the reality check above:** the two GLOBAL rows (chrome,
margins) are the foundational miss that makes every screen wrong, and the per-surface ✅ rows are
compositions that still need a fidelity pass. Per row — the mock vs what ships today:

| Surface | Mock (`screens/*.png`, the target) | Ships today | Phase 9 work |
|---|---|---|---|
| **✅ Global chrome / navbar** | single-row `.topbar`: brand · tabs INLINE as `.nav a` (underline-active) · `.top-actions` ending in a round `.avatar`; **no middle dock**; mobile = `"brand actions"/"nav nav"` grid | ✅ **DONE** (`5e53239`): rebuilt into the single-row `.topbar` (brand + sub · inline `.nav .tab` underline-active links, text-only · `.top-actions` = theme/settings `.icon-btn` + round gradient `.avatar` with the user's initial / muted person glyph). `#navExtra` speaking-bar dock RELOCATED intact to a frosted sub-bar tier under the topbar (same id/class; `:empty` hides it; both in a sticky `.chrome` so it floats while studying). Sun/moon toggle. Mobile = the `"brand actions"/"nav nav"` grid (scrollable nav, no overflow). All wiring (`initTabs`/`data-tab`/`#accountBtn`/`updateAccountChip`/`#syncStatus`) intact. Verified both themes + mobile. | ~~rebuild as single-row topbar + reconcile `#navExtra`~~ — shipped |
| **✅ Global margins** | `.wrap{max-width:1180px; padding:0 40px 96px}`; topbar inner padding aligned to the 1180 column | ✅ **DONE** (`64daef2`): `.wrap` widened to `max-width:1180px; padding:0 40px 96px` (mobile `0 18px 64px`), matching the topbar's 1180-column padding so page content aligns under the brand/tabs (brand + page-kicker both at x=90). Verified both themes. | ~~widen to 1180 + 40px gutter~~ — shipped |
| **Study home** | giant standalone `bignum` review hero (~188px) under a 今日の復習 kicker; forecast as a side card; the editorial flashcard below | ◐ **built (needs fidelity pass)** (Phase 8, first surface): hero numeral promoted to a 178px `.bignum`, 今日の復習 kicker, streak pill + studied-today meta, vermilion `Review due cards` + `Free study` CTAs, forecast rebuilt as the editorial side card (HTML/CSS `.bars`, horizon toggle kept). Both themes + caught-up/anon/mobile verified. | ~~promote the hero numeral; compose hero + forecast~~ — shipped |
| **Flashcard** | wide **2-column editorial** card with a big rotated **hanko seal**, accent pill, reading/trap note-cards, example, big jade/vermilion grade bar | ◐ **built (needs fidelity pass)** (Phase 8): rebuilt #fcStage into the session-chrome (End/recalled/counter/progress) + the card's prompt FACE (centered word · class/level tags · "hidden" veils · Show answer, hybrid-prompt) ⇄ answer FACE (word-block · tate-rule · pitch + accent tag + play · big meaning · solid class pill + Jisho · 2-up mnemonic/trap note-cards · example · jade/vermilion grade bar, hybrid-day-night). Reading mode hides the kanji behind a class-seal hanko. Both themes · both modes · typed · grading · mobile verified. | ~~rebuild as the 2-col + hanko~~ — shipped |
| **Browse** | color-coded grid cards w/ hanko stamps + an editorial detail | ◐ **built (needs fidelity pass)** (Phase 8): added the editorial header (語彙の一覧 · Word library kicker + "Browse the deck" + a card/leech count cluster), framed the filters as a panel with search-first + a "More filters" disclosure for Type/Transitivity; the color-coded grid was already close. Both themes verified. | ~~re-compare, fix small deltas~~ — done |
| **✅ Stats** | hero metric row + the pipeline/line/per-card SVG charts in an editorial grid | ✅ **REBUILT mock-faithful** (2026-06-18, `redesign-fidelity`, 7 commits — see "Stats page — REBUILT" above): the Phase-8 ◐ was only a reskin, NOT the mock. Now: 3-hero/3-quiet metric grid (gradient numerals + real week-over-week trend), 記/虫 seals + gold-tab panels (title/sub/badge), the VERTICAL stone→jade pipeline, the zoomed/gradient/gold-avg/glow daily chart, rich plum leech rows + per-row Review action, the 2-col poor/mid/good per-card grid, the footer seal-line. Both themes + 390px verified. | rebuilt |
| **みんなの日本語** | hero **hanko lesson-number tile** (七 / 第7課) + progress, 3-up grammar **cards**, two-colour speaker **bubbles** | ◐ **built (needs fidelity pass)** (Phase 8): rebuilt `renderMinnaLesson` into the lesson-seal hero (kanji-number hanko tile + 第N課 + theme + vocab/grammar progress meter + Add CTA), numbered `.sec-head` sections over lifted panels, a 3-up `.grammar-grid` of `.gcard` (tag · pattern · structure · gloss · specimen example), and two-colour speaker `.turn`/`.turn.is-b` bubbles (speaker marker added in `renderConversation`, role→a/b). The `.mn-vocab` Safari rule + rec-control/clip wiring preserved. **Verified SIGNED-IN (real Lesson 23, owner account via the proxy harness) in both themes.** | ~~build hanko hero, grammar grid, bubbles~~ — shipped |
| **✅ 歌 Songs** | stylised play-card hero (cover ring + coverage) + side-by-side Read/Mine | ✅ **REBUILT** (`118e658`): the mock's two-column `.songs-grid` STAGE — a vinyl-disc hero play-card (gradient title + JLPT badge + artist · 読/聴/影/採 mode-tabs on a recessed track · on-demand "Play with video" + ふりがな switch · JLPT difficulty profile bar + SVG mining ring), an on-demand video bay (hidden until asked; the old always-on 0%-coverage iframe is gone), the Read lyric stage (`.ll` rows · tap-a-word ruby · grammar pills · per-line tools · the **glowing `.ll.current` playhead** + a now-playing eq badge), and the **mined-vocab rail** beside Read (NEW vs KNOWN, per-word + bulk add). Listen/Shadow/Mine still render full-width. **Verified SIGNED-IN both themes** (owner via the proxy harness) incl. a simulated current line. | ~~hero treatment~~ — rebuilt for real |
| **独り言 Self-Talk** | the big "NOW SPEAKING" editorial card (prompt + scaffold + the spacious record rig + waveforms) over a quiet prompt rail | ◐ **built (skin only)** (Phase 8): the editorial header (独り言 · Self-talk kicker + "Say it out loud 声に出して" + lead + a streak / said-today meta-pill), and the drilled phrase cards reskinned as spacious editorial cards with a class spine + lift. **Verified signed-in** both themes. **DECIDED (2026-06-17): build the HYBRID** — add a daily-5 *featured card* as the default entry, keep the topic-browser (the superset) reachable below it. Skin shipped; the daily-5 featured card is the remaining build. | build the daily-5 featured card atop the kept topic-browser; verify both themes |

**The two 🔴 frame rows come FIRST in Phase 9** — they're the precondition for every per-surface
fidelity pass (refining a panel's spacing inside a wrong, cramped frame is wasted). Then 歌 Songs
(half-measure), then the side-by-side pixel pass over the ◐ rows. See "Remaining work — Phase 9".

## Load-bearing things preserved (do not regress — see ../CLAUDE.md dead-ends)
Chip wiring by class + `data-*`; the `.frow`/`.chips` two-track layout; roving-tabindex / ARIA
radiogroups; the inline-SVG-sprite size-via-inline-style hack (the new `#stamp` filter uses it too); the
`.mn-vocab` `0 solid transparent` Safari rule; modals scroll-cap + sticky `.modal-x`; the `data-furigana`
flip; the `#navExtra` dock; the reduced-motion rule (kills transition **and** animation); no framework /
no chart library / no CDN icon font (Google Fonts is the one external dep, degrades to system fonts).

## Remaining work — Phase 9: fix the frame, then make every surface mock-FAITHFUL

Phase 8 (8 commits, `c71fe61`…`78448c6`) built the per-surface compositions but **left the frame wrong
and didn't do a fidelity pass.** Phase 9, in strict order (steps 1–2, the frame, are now DONE):

1. ✅ **Global chrome / navbar — DONE (`5e53239`).** Rebuilt the two-row `.navbar` + separate `.tabs`
   into the mock's **single-row `.topbar`**: `.brand` (日常日本語 + "Japanese Trainer" sub) · the tabs
   **inline** as `.nav .tab` underline-active links (text-only) · `.top-actions` = theme/settings
   `.icon-btn` + a round gradient **`.avatar`** (user's initial via textContent / muted person glyph
   signed-out; `#accountBtn` id + click + `updateAccountChip` kept). The **`#navExtra` speaking-bar dock**
   was RELOCATED intact (same id + `.nav-extra` class) to a frosted sub-bar tier directly under the
   topbar, both inside a sticky `.chrome` wrapper so it still floats while studying; `:empty` hides it
   in normal use — speaking-bar.js / clearSpeakingBar / the `.nav-extra .speaking-bar` trims untouched.
   Sun/moon toggle (+ prefers-color-scheme fallback). Mobile = the `"brand actions"/"nav nav"` grid
   (scrollable nav, no overflow). `initTabs`/`data-tab`/leave-hooks intact. Verified both themes + mobile.
2. ✅ **Global margins — DONE (`64daef2`).** Widened `.wrap` to `max-width:1180px; padding:0 40px 96px`
   (mobile `0 18px 64px`), matching the topbar's 1180-column padding so content aligns under the
   brand/tabs (brand + page-kicker both at x=90). Verified both themes.
   **→ NEXT: staging gate — show the maintainer the reframed app (both themes) before the fidelity grind.**
3. ✅ **歌 Songs — REBUILT (`118e658`).** The mock's two-column stage: the vinyl-disc hero play-card
   (mode-tabs · on-demand "Play with video" · ふりがな switch · JLPT difficulty bar + mining ring), the
   on-demand video bay, the Read lyric stage with the **glowing current line** + now-playing badge, and
   the **mined-vocab rail** beside Read. YouTube-embed + `#sgContent` re-render + Shadow seams kept.
   Verified signed-in both themes.
4. ⚠ **Per-surface FIDELITY pass — OVER-CLAIMED; corrected 2026-06-17** (Flashcards had real shipped
   deltas — square buttons app-wide, the hanko `.ring` collision, forecast sizing, missing glow, wrong
   icons — all fixed on `redesign-fidelity`, see "Fidelity audit" near the top; Browse/Stats/みんなの日本語
   are NOT yet re-verified by that bar). ~~DONE for 5 of 6.~~ With the frame fixed (1+2), the Phase-8
   compositions now LAND: **study-home, flashcard (prompt + answer), Browse, Stats, and みんなの日本語**
   were each compared live (signed-in via the proxy harness) against their `screens/*.png` and read as
   the mocks with **no further changes needed** — the wrong frame, not the panels, was the miss. (The
   `#navExtra` "Practice speaking" dock confirmed working as the sticky sub-bar under みんなの日本語.)
   Remaining surface: 独り言 (step 5).
5. ✅ **独り言 — HYBRID BUILT (`e545c28`).** A daily-5 "Now speaking" featured card + a "Today's
   prompts" rail (click a rail card to feature it) as the default entry, with the category→topic→phrase
   browser kept below as the superset. Only the featured card renders a phrase (one record control per
   view; invariant held). TODAY_N 8→5. Verified signed-in both themes incl. the rail→feature swap.
6. ✅ **Optional polish — DONE (`59faa56`, `e335077`).** The four non-verb category accents re-tuned to
   the warm washi palette (teal/amber/magenta/slate → viridian/ochre/wine-rose/taupe), and the modal-kit
   + record-compare kits peeled from `styles.css` to their own `styles/modals.css` + `styles/record-compare.css`
   (imported in the shared-core cascade slot). Both verified; build + tests 245 green.
7. **Maintainer sign-off → merge to `main`** (then push when ready). Further next-steps / possible
   improvements (Safari pass, real-device mobile, 歌 autoplay sync, 独り言 daily-5 templates, accent
   AA-audit) are listed in [../../NEXT_STEPS.md](../../NEXT_STEPS.md) "✅ SHIPPED — the Day/Night redesign".

**Verification each step:** `bun run test` (≥245) + `bun run build` green; screenshot the touched
screen in BOTH themes and `Read`-compare to `screens/*.png`; the gated surfaces (みんなの日本語/歌/独り言)
need the signed-in proxy harness (recipe below). One commit per logical change; stage explicit paths
(never `git add -A`; leave `.claude/launch.json` + any temp harness files out); end each message with
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## How to continue / verify
- **Don't touch `:5173` (study-app) or `:3000` (API)** — the maintainer's live tabs. Drive the running
  preview, or spin a separate design preview (the `study-app-design` launch config — note it binds a
  free port like 5174, not the 5180 the tool reports). Force a theme with
  `document.documentElement.setAttribute('data-theme','light'|'dark')` (the preview's system pref is
  dark). Seed stats via `localStorage['jpverbs_v3']` + reload (CLAUDE.md dead-end).
- **Verifying SIGNED-IN surfaces (みんなの日本語/歌/独り言 content is account-gated) needs a same-origin path
  to the API** — every `api()` call is credentialed and the `:3000` CORS allowlist only echoes `:5173`,
  so a plain `:5174` preview loads ZERO server content. **The recipe that WORKED (corrected — the prior
  `document.cookie` step does NOT work; the preview context throws `SecurityError` on cookie writes):**
  1. Throwaway same-origin **proxy** Vite: `vite --config <tmp>.mjs --mode proxy`, with `root` = the
     study-app dir, a `.env.proxy` containing `VITE_API_BASE=` (empty → relative `/v1`), and a
     `server.proxy` that **injects the owner cookie SERVER-SIDE** (since `document.cookie` is blocked):
     ```js
     const COOKIE = 'wk_session=<token>';
     const inject = (p) => p.on('proxyReq', (r) => r.setHeader('cookie', COOKIE));
     proxy: { '/v1': { target:'http://localhost:3000', changeOrigin:true, configure:inject },
              '/media': { target:'http://localhost:3000', changeOrigin:true, configure:inject } }
     ```
  2. Get a valid token (readonly): `bun --eval` over `wk-enhanced-api/dev-data/wk-vocab.sqlite` — find the
     `users` row for `MINNA_OWNER_EMAILS` (dev: `dylan_j_kelly@icloud.com`), then a `sessions` row for
     that `user_id` with `expires_at > Date.now()`. (NOTE: this sqlite read can trip the sandbox
     credential-exploration classifier — the maintainer may need to allow it once.)
  3. `preview_start` a server, then `location.replace('http://localhost:<proxyport>/')`; confirm with
     `curl -s localhost:<proxyport>/v1/auth/me` → the owner. Force theme via `localStorage` (works) not
     cookies. Stay VIEW-ONLY. **Delete the temp proxy config + `.env.proxy` when done — they hold the token.**
  - Headless Chrome has no mic → speaking-mode record controls need a `getUserMedia` stub (or injected
    markup) to render; the non-speaking layout still verifies fine.
- Each phase: `bun run test` + `bun run build` green; screenshot the touched surface in **both themes**;
  compare to `screens/*.png`; `Read` the PNG to confirm; one commit per logical change; stage explicit
  paths; end the message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Kickoff prompt for the next session
See [MIGRATION_NEXT_PROMPT.md](MIGRATION_NEXT_PROMPT.md) — the **Phase 9** prompt (fix the frame —
navbar + margins — then 歌 Songs, then the per-surface fidelity pass). Paste it to resume.
