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
| 6 | Stats | `styles/stats.css` | ☐ |
| 7 | Minna / Self-talk / Songs | `styles/minna.css` `selftalk.css` `songs.css` | ☐ |
| 8 | Modals | `styles/modals.css`, `index.html` | ☐ |
| 9 | Fidelity audit | all surfaces, both themes | ☐ |

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
