# Blend port — progress

Porting the locked **blend** system (`mockups/sleek/`) into the live app, surface by surface,
both themes, without breaking wiring. Precedent: [../redesign/MIGRATION_PROGRESS.md](../redesign/MIGRATION_PROGRESS.md).
Plan approved 2026-06-18.

Mock token blocks are **identical across all 7 mocks** — one canonical palette. The mock's
vocabulary (`--shu`/`--ink-2`/`--sink`, `data-theme="day"/"night"`) is mapped onto the app's
existing role tokens (`--brand`/`--reading`/`--gold`/`--raised` + production aliases) so the
feature code + hand-rolled SVG charts reskin for free. Theme attr stays the app's `light`/`dark`.

## Phase status

| # | Phase | Files | Status |
|---|---|---|---|
| 0 | Plan + this doc | — | ✅ done |
| 1 | Tokens | `styles/tokens.css`, `index.html` (fonts) | ✅ done (verified both themes, :5191) |
| 2 | Frame (chrome) | `styles/chrome.css`, `index.html`, `features/chrome.js` | ✅ done (verified both themes; ふ toggle works) |
| 3 | Shared kit | `styles/base.css`, `styles.css` | ✅ done (grid/glow, ruby→indigo, line-bullet, btn gradient; 283 tests green) |
| 4 | Flashcards | `styles/flashcards.css`, `features/flashcard.js`, `deck.js`, `index.html` | ✅ done (nphead bar, red-pen meaning, subway pipeline; both themes; 283 tests) |
| 5 | Browse | `styles/browse.css`, `browse.js`, `core/facets.js`, `index.html` | ✅ done (line-bullet cards, NN/06 marker, lighter filter; both themes) |
| 6 | Stats | `styles/stats.css`, `stats.js`, `index.html` | ✅ done (glossy histogram, leech line-bullets, 03/06 marker; both themes; seeded to verify) |
| 7 | Minna / Self-talk / Songs | render headers + `index.html` | ✅ done (already blend-aligned via Phase 1 + prior redesign; unified NN/06 markers across all 6 surfaces, incl. Flashcards retrofit) |
| 8 | Modals | (verified — no changes) | ✅ done (already blend-aligned via shared modal kit + Phase 1; Settings both themes + scroll contract + Sign-in verified) |
| 9 | Fidelity audit | all surfaces, both themes | ✅ done — **PORT COMPLETE** |
| 10 | Signed-in audit + finish | Minna/Browse/Stats real data; line-bullets; cleanups | ✅ done — **FULLY VERIFIED** |

**Audit results (2026-06-18):** `bun run build` compiles (102 modules, CSS 143 kB); no
`*/`-in-comment landmines in any touched CSS; `bun run test` 283/283 green; all 6 tabs cycle
with zero console errors; both themes verified per-surface (tokens resolve + aliases hold,
chrome single-row + ふ toggle, manuscript grid/gold glow, nameplate + subway pipeline, line-
bullet browse cards, glossy histogram + leech bullets, NN/06 markers on all 6 surfaces,
modal scroll contract). Minna signed-in marker verified via the minna-render test (couldn't
sign in on the :5191 design port — CORS allowlist is :5173). The signed-in data-rich pass +
Minna vocab line-bullets were deferred here (need a :5173 sign-in) — **both DONE**; see below.

### Signed-in audit + finish (2026-06-18, on `main`)

The three data-rich surfaces CORS blocked on :5191 were verified **signed in on :5173** with the
maintainer's real data, both themes (screenshots in the session):

- **教科書 Minna** — lesson hero/seal, vocab grid, grammar cards, model conversation, the
  speaking-bar/record-compare dock + per-row rec-controls, the `04/06` marker: all faithful.
  **The vocab line-bullet (the one deferred nicety) SHIPPED** (`b764fb4`): each `.vrow` leads with
  the shared `.line-bullet` (五/一/不/名/副 via `colorClass`/`classKanji`), exactly like Browse/Stats.
  ⚠️ **Dead-end correction:** the Minna vocab is NO LONGER a `border-collapse` table — the redesign
  rebuilt it as a CSS **grid** (`.vrow{display:grid}`), so the `.mn-vocab` Safari border trap does
  NOT apply to this render (verified via computed 6-col grid + both themes). The `.mn-vocab` rules
  are gone; only the practice-history `.mn-ph` table is still border-collapse (untouched).
- **独り言 Self-talk / 歌 Songs** — featured/now-speaking card, phrase cards, prompt rail, slot-swap
  templates (Self-talk, verified in the Minecraft topic); hero play-card + glowing disc, lyrics +
  tap-to-reveal, mined-vocab rail (Songs, opened a real starter song): all faithful, both themes.
  Structural deltas from the mocks — Minna jumps to the last lesson (no 皆の日本語 directory hero) with
  a left hanko seal vs the mock's right 課 circle; Songs shows a difficulty/coverage panel vs an
  inline YouTube thumb (on-demand video); Self-talk uses a side-rail daily-5 vs the mock's horizontal
  row — are the prior **redesign composition**, kept per the re-skin-not-rewrite scope, NOT regressions.
- **Browse / Stats / modals** — verified with real progress (147 cards incl. 47 activated Minna,
  Box-N memory tracks in the detail modal, real glossy histogram). Settings / Add-card / Browse-detail
  modals: blend kit, scroll + sticky × hold. (Browse's per-row line-bullets shipped in phase 5.)

**Minor cleanups (`39af8ad`):** removed the orphaned flashcard `.tate-rule` divider (absent from the
mock — `.word-block`'s own gap keeps the glyph↔reading spacing) and the dead `.hero-kicker` CSS. Both
maintainer-confirmed before removal. Throughout: `bun run test` 283/283, `bun run build` clean.

### Glow-cut verification (2026-06-19, on `main`) — no regressions

The ~90% decorative-glow cut (`20101fc`) was verified **signed in on :5173, both themes** with the
maintainer's real data. The cut's own commit had covered home/songs/stats/flashcards; this pass closed
the loop on the five remaining surfaces — **教科書 Minna (lesson seal), 独り言 Self-talk, Browse, the
Flashcard reveal face (hanko), and the modals** — and found **nothing too flat and nothing still too
glowy** (no fixes needed). What was checked, and why each still reads with depth despite losing its
neon halo:
- **Seals** (`.lesson-seal`, `.hanko` godan + ichidan) keep their 2px inset accent-glow + 3px colored
  border + inner `.ring` + `filter:url(#stamp)` — verified at near-1:1; they read as intentional ink
  stamps, not flat discs.
- **CTAs/avatar** keep the static `--cta-shadow` (a real drop, not a 360° halo); cards keep
  `--card-shadow`; the play button keeps its indigo radial fill + border + `--inner-hi`.
- **`.word-pop` is still opaque** — its `background:var(--surf-card)` is a *gradient* in dark
  (`linear-gradient(168deg,#221B14,#1B1610)`, both stops opaque), so `background-color` reads
  `transparent` but `background-image` paints solid. Removing its (no-op) `backdrop-filter` did NOT
  make it see-through; confirmed via `elementFromPoint` over the MNEMONIC card behind it.
- **Modals** stay opaque (`--surf-card`) with `--card-shadow`; only the `.modal-overlay` frost
  (`blur(7px)`) remains — the one backdrop-filter that frosts real content.

`bun run test` 290/290 green; `bun run build` clean (CSS 137.6 kB, unchanged from the cut).

## Token map (mock → app role token; theme attr = light/dark)

| App token (name kept) | ← mock | Day | Night |
|---|---|---|---|
| `--paper` | --paper | `#F4F1E8` | `#100D09` |
| `--raised` (=`--paper-2`) | --paper-2 | `#FBFAF4` | `#1B1610` |
| `--deeper` | --sink | `#ECE7D9` | `#171209` |
| `--base` | derive | `#EFEADD` | `#0D0A07` |
| `--ink` | --ink | `#15130D` | `#F1E9D8` |
| `--ink-2` (NEW) | --ink-2 | `#4B4536` | `#C0B49C` |
| `--muted` | --muted | `#857C66` | `#857A64` |
| `--faint` | derive | `#9A8F78` | `#6E6353` |
| `--line` | --line | `#16130B1C` | `#FFF0D815` |
| `--line-2` (NEW) | --line-2 | `#16130B12` | `#FFF0D80A` |
| `--grid` (NEW) | --grid | `#1D160814` | `#FFF0D808` |
| `--brand` (=`--godan`) | --shu | `#DC3A22` | `#FF6B4A` |
| `--brand-deep` | --shu-deep | `#B12C16` | `#E8512F` |
| `--brand-soft` | --shu-wash | `rgba(220,58,34,.07)` | `rgba(255,107,74,.08)` |
| `--brand-on` | keep | `#FCEFE9` | `#1F0C06` |
| `--reading` (=`--ichidan`) | --ichidan | `#234C86` | `#8FA0EE` |
| `--gold` (=`--irregular`) | --gold | `#9A6B0F` | `#E7BC6B` |
| `--gold-soft` (NEW) | --gold-soft | `rgba(154,107,15,.08)` | `rgba(231,188,107,.10)` |
| `--good` (deep `#1F6440`) | --good | `#2C7A4F` | `#56D29A` |
| `--leech` | --leech | `#7C3A95` | `#C792EA` |
| `--adjective` | --adjective | `#2C7D6B` | `#5CC0A6` |
| `--noun` | --noun | `#A06A1E` | `#D8A24E` |
| `--adverb` | --adverb | `#A14258` | `#D6818F` |
| `--phrase` | --phrase | `#736353` | `#AB9A85` |
| `--card-edge` (NEW) | --card-edge | `transparent` | `linear-gradient(150deg,#e7bc6b66,transparent 38%)` |
| `--surf-nav` | chrome bg | `rgba(244,241,232,.82)` | `rgba(16,13,9,.72)` |

Shadows: `--lift-md` = mock `--shadow`, `--lift-lg`/`--card-shadow` = mock `--shadow-lg`,
`--cta-shadow` = mock `--cta-shadow`; `--lift-sm` derived lighter. Sub-tokens
(`-deep/-soft/-line`, `--surf-card/-inset`, `--chip-bg`, `--spine`, `--inner-hi`) re-derived
from the primaries. Fonts: add **Zen Old Mincho** → `--jp-min` (fixed, editorial); keep
`--display`/`--body`/`--mono`/`--jp` (`--jp` = swappable `--jp-font`).

## Scope decisions (locked)
1. Flashcards `.adj` row = re-skin only (no new prev/next deck nav).
2. Subway pipeline + memory-pipeline = new viz of EXISTING box-distribution data.
3. Numbered `NN / 06` markers adopted on every surface (tab order 01–06); per-panel markup.
4. `ふ` toggle = small `chrome.js` wiring → `settings.furigana` + `applyFurigana()` + `saveSettings()`.
5. Line-bullet = shared component (colour circle + class kanji); class/colour from `cardStamp`/`colorClass`.

## Dead-ends honored (per phase)
- Never let `*/` appear inside a CSS comment (silently eats the next rule; build won't warn).
- `.chip.active` = tinted wash + border, NOT solid fill. `.frow`+`.chips` two-track filter layout.
- `.mn-vocab` border-collapse: a "no-border" edge = `0 solid transparent`, never `none`/`hidden` (Safari).
- `.ring` scoped to `.sc-ring .ring`. Icons = inline SVG sprite. Charts = hand-rolled SVG.
- Modals scroll (cap `calc(100vh - 40px)` + `overflow-y:auto`); `.modal-x` sticky+float.
- Keep all `data-*`/classes the JS keys off; keep token aliases + 3 token blocks in sync.
