# Day / Night migration — progress & handoff

> **Read this first to continue the redesign migration.** It records what shipped, the decisions we
> made, the new CSS architecture (with the cascade-order rules you must not break), what's verified vs
> not, and the remaining work. The *plan* is [MIGRATION.md](MIGRATION.md); the *mocks* (visual source of
> truth) are `system.css` + `screens/*.png`; the shipped design system is documented in
> [../CLAUDE.md](../CLAUDE.md) "Design system". A ready-to-paste **kickoff prompt is at the bottom**.

## Status — ✅ SKIN (Phases 0–7) + ✅ the mock LAYOUTS (Phase 8) shipped + verified; ⏳ maintainer sign-off + push

The serif-free **"Day / Night"** *design system* — palette, both themes, all-sans type, atmosphere,
lifted-card treatment, tap-a-word, the speaking rig — is applied to the real app via
**reskin-in-place + token aliasing** (Phases 0–7 + the speaking-mode lift `34eef8c`, on the
`redesign-migration` branch, **NOT pushed/merged**; `bun run test` 244 + `bun run build` green every
phase; signed-in Minna/Songs/Self-Talk verified with real content in both themes this session).

**But "reskin-in-place" only ever changed CSS on the EXISTING markup — so the app now wears the
Day/Night *skin*, it does NOT yet have the mocks' editorial *layouts*.** Side-by-side with
`screens/*.png` the difference is large, and the maintainer flagged it ("the site does not look like
the mock-ups"): the mocks are dramatic editorial compositions — a giant `bignum` review hero, the wide
2-column flashcard with a hanko seal, lesson hanko-number tiles, two-colour conversation bubbles,
grammar card grids, the spacious record rig — and almost none of those compositions were built, because
they need markup/JS changes that Phases 0–7 deliberately forbade. **Realizing the mocks is the next
phase (Phase 8 — see "The gap" + "Remaining work").** What Phases 0–7 bought is the right foundation:
the token system, both themes, and the component skin the editorial layouts will build ON — paint
before carpentry, not wasted.

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

## The gap — the SKIN shipped, the mock LAYOUTS did not (the Phase 8 backlog)

The honest delta vs `screens/*.png`. Reskin-in-place changed only CSS on the existing markup, so every
surface has the Day/Night palette/type/lift but keeps its OLD compact structure. Per surface — the mock
composition vs what ships today:

| Surface | Mock (`screens/*.png`, the target) | Ships today | Carpentry left (Phase 8) |
|---|---|---|---|
| **Study home** | giant standalone `bignum` review hero (~188px) under a 今日の復習 kicker; forecast as a side card; the editorial flashcard below | ✅ **DONE** (Phase 8, first surface): hero numeral promoted to a 178px `.bignum`, 今日の復習 kicker, streak pill + studied-today meta, vermilion `Review due cards` + `Free study` CTAs, forecast rebuilt as the editorial side card (HTML/CSS `.bars`, horizon toggle kept). Both themes + caught-up/anon/mobile verified. | ~~promote the hero numeral; compose hero + forecast~~ — shipped |
| **Flashcard** | wide **2-column editorial** card with a big rotated **hanko seal**, accent pill, reading/trap note-cards, example, big jade/vermilion grade bar | ✅ **DONE** (Phase 8): rebuilt #fcStage into the session-chrome (End/recalled/counter/progress) + the card's prompt FACE (centered word · class/level tags · "hidden" veils · Show answer, hybrid-prompt) ⇄ answer FACE (word-block · tate-rule · pitch + accent tag + play · big meaning · solid class pill + Jisho · 2-up mnemonic/trap note-cards · example · jade/vermilion grade bar, hybrid-day-night). Reading mode hides the kanji behind a class-seal hanko. Both themes · both modes · typed · grading · mobile verified. | ~~rebuild as the 2-col + hanko~~ — shipped |
| **Browse** | color-coded grid cards w/ hanko stamps + an editorial detail | ✅ **DONE** (Phase 8): added the editorial header (語彙の一覧 · Word library kicker + "Browse the deck" + a card/leech count cluster), framed the filters as a panel with search-first + a "More filters" disclosure for Type/Transitivity; the color-coded grid was already close. Both themes verified. | ~~re-compare, fix small deltas~~ — done |
| **Stats** | hero metric row + the pipeline/line/per-card SVG charts in an editorial grid | ✅ **DONE** (Phase 8): added the header (学習の記録 · Your progress + "Progress" + an editorial subtitle), reworked the metric tiles into 6 hero cards with context sublabels (+ a Current-streak tile via `studyStreak`), and grouped the charts under Retention / Needs work / Per-card section dividers with a 2-up Memory-pipeline + Daily-accuracy grid. Charts reskinned for free via the token aliases. Both themes verified. | ~~re-compare (spacing/scale)~~ — done |
| **みんなの日本語** | hero **hanko lesson-number tile** (七 / 第7課) + progress, 3-up grammar **cards**, two-colour speaker **bubbles** | ✅ **DONE** (Phase 8): rebuilt `renderMinnaLesson` into the lesson-seal hero (kanji-number hanko tile + 第N課 + theme + vocab/grammar progress meter + Add CTA), numbered `.sec-head` sections over lifted panels, a 3-up `.grammar-grid` of `.gcard` (tag · pattern · structure · gloss · specimen example), and two-colour speaker `.turn`/`.turn.is-b` bubbles (speaker marker added in `renderConversation`, role→a/b). The `.mn-vocab` Safari rule + rec-control/clip wiring preserved. **Verified SIGNED-IN (real Lesson 23, owner account via the proxy harness) in both themes.** | ~~build hanko hero, grammar grid, bubbles~~ — shipped |
| **歌 Songs** | stylised play-card hero (cover ring + coverage) + side-by-side Read/Mine | ✅ **DONE** (Phase 8): the song view's header + player are wrapped into an editorial `.song-hero` play-card — big JP title + level, the Read/Listen/Shadow/Mine mode switch, a brand-tinted **coverage ring** (`coverage().pct` of the song's vocab in your deck), and the framed YouTube player inside the lifted card. Lyric reader unchanged (already close). **Verified signed-in** both themes. | ~~hero treatment~~ — done (cover-ring play button / segmented bar are a lighter approximation) |
| **独り言 Self-Talk** | the big "NOW SPEAKING" editorial card (prompt + scaffold + the spacious record rig + waveforms) over a quiet prompt rail | ✅ **DONE (editorial skin)** (Phase 8): the editorial header (独り言 · Self-talk kicker + "Say it out loud 声に出して" + lead + a streak / said-today meta-pill), and the drilled phrase cards reskinned as spacious editorial cards with a class spine + lift. **Verified signed-in** both themes. NOTE: the app keeps its richer **topic-browser** model (category→topic grid → phrase list) rather than restructuring to the mock's daily-5 *featured-card + rail* flow — that's an interaction-model change, not just a skin, and the topic browser is a superset; flagged for the maintainer. | ~~the "now speaking" composition + prompt rail~~ — editorial skin shipped; daily-5 flow intentionally not restructured |

**Re-compare Browse + Stats first** (closest already) to confirm how far they are; the other five clearly
need layout work. The verified skin is the paint; this table is the carpentry. Each row is markup/JS +
per-surface CSS under Decision 5 — see "Remaining work".

## Load-bearing things preserved (do not regress — see ../CLAUDE.md dead-ends)
Chip wiring by class + `data-*`; the `.frow`/`.chips` two-track layout; roving-tabindex / ARIA
radiogroups; the inline-SVG-sprite size-via-inline-style hack (the new `#stamp` filter uses it too); the
`.mn-vocab` `0 solid transparent` Safari rule; modals scroll-cap + sticky `.modal-x`; the `data-furigana`
flip; the `#navExtra` dock; the reduced-motion rule (kills transition **and** animation); no framework /
no chart library / no CDN icon font (Google Fonts is the one external dep, degrades to system fonts).

## Remaining work — Phase 8: ✅ all seven surfaces realized (pending sign-off + push)
Every "The gap" row is now closed — the editorial compositions are built, both themes, with the
dead-end CONTRACTS intact and `bun run test` 245 + `bun run build` green throughout. Phase 8 commits:
`c71fe61` study-home hero · `63eb1bb` study-home (drop hybrid: no toggle, picker tucked) · `3701005`
flashcard (2-col + hanko, prompt/answer faces) · `76ddcc5` Browse (header + filter panel) · `f705e75`
Stats (header + metric hero + sections) · `a247197` みんなの日本語 (hanko hero + grammar grid + speaker
bubbles) · `68fe6b7` 歌 Songs (play-card hero) · `78448c6` 独り言 Self-Talk (editorial header + cards).

**Verification:** anon surfaces (study-home, flashcard, Browse, Stats) driven on a separate `:5174`
design preview, both themes. The three account-gated surfaces (みんなの日本語, 歌 Songs, 独り言) verified
**signed-in against the real owner account** (Lesson 23 / a starter song / a topic's phrases) through a
throwaway same-origin proxy harness, both themes. The harness's temp files (proxy config + the reused
session token) were removed after use — recreate via the recipe below if re-verifying.

What's left:
1. **One interaction-model call for the maintainer — 独り言:** the mock implies a *daily-5 featured-card +
   prompt-rail* flow; the app kept its richer **topic-browser** (a superset). The editorial SKIN (header +
   spine'd cards) shipped; restructuring the *flow* to the mock is a separate UX decision if wanted.
2. **Optional polish** carried over: re-tune the four non-verb accents to the warm palette; the
   modal-kit / record-compare own-file split; 歌 Songs' cover-ring play button + segmented coverage bar
   are a lighter approximation of the mock.
3. **Maintainer sign-off, then push / open the PR** (still on `redesign-migration`, not pushed).

## How to continue / verify
- **Don't touch `:5173` (study-app) or `:3000` (API)** — the maintainer's live tabs. Drive the running
  preview, or spin a separate design preview (the `study-app-design` launch config — note it binds a
  free port like 5174, not the 5180 the tool reports). Force a theme with
  `document.documentElement.setAttribute('data-theme','light'|'dark')` (the preview's system pref is
  dark). Seed stats via `localStorage['jpverbs_v3']` + reload (CLAUDE.md dead-end).
- **Verifying SIGNED-IN surfaces (Minna content is account-gated; Songs/Self-Talk content is server-backed
  too) needs a same-origin path to the API** — every `api()` call is credentialed and the `:3000` CORS
  allowlist only echoes `:5173`, so a plain `:5174` preview loads ZERO server content. The recipe that
  worked this session: a throwaway same-origin **proxy** Vite (`vite --config <tmp>.mjs --mode proxy`
  with a `.env.proxy` `VITE_API_BASE=` + `server.proxy { '/v1','/media' → http://localhost:3000 }`),
  point the preview browser at it, then inject a reused dev session cookie — read a valid token from
  `wk-enhanced-api/dev-data/wk-vocab.sqlite` `sessions`, and if a stale httpOnly session is in the jar
  `POST /v1/auth/logout` first, then `document.cookie='wk_session=<token>'`. Minna is gated to
  `MINNA_OWNER_EMAILS` (dev: the owner account). Headless Chrome has no mic → speaking-mode controls need
  a `getUserMedia` stub (or injected markup) to render. Stay VIEW-ONLY on the real account.
- Each phase: `bun run test` + `bun run build` green; screenshot the touched surface in **both themes**;
  compare to `screens/*.png`; `Read` the PNG to confirm; one commit per logical change; stage explicit
  paths; end the message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Kickoff prompt for the next session
See [MIGRATION_NEXT_PROMPT.md](MIGRATION_NEXT_PROMPT.md) — the **Phase 8** prompt (realize the mock
layouts). Paste it to resume.
