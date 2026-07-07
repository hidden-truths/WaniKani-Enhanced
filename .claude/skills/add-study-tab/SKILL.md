---
name: add-study-tab
description: Adds a new top-level tab/panel to the 日常日本語 study app (study-app/) via the established 8-tab pattern — index.html shell + tab button, .marker renumbering, features/<name>/ directory-module, main.js + chrome.js wiring, styles/<name>.css, state hub field, optional synced blob, Vitest tests, doc + ROADMAP updates. Use for ANY new study surface (reading, listening, kanji, drill tab) or when promoting a feature to its own panel. The JLPT tab is the worked reference.
---

# Add a study-app tab

You are adding a ninth tab (or another major panel surface) to `study-app/`. The app has
grown a tab roughly the same way eight times; this skill is the distilled procedure, with
the 合格 JLPT tab (the newest, shipped 2026-07-01) as the reference implementation at
every step. Follow the order — several steps (marker renumbering, chrome dispatch, boot
order) silently break other tabs when skipped.

**The single best orientation move:** `git show 96c825c --stat` — the commit that added
the JLPT tab. Its file footprint IS this checklist. (Foundation pieces — the pure core
module and the lazy data chunk — landed separately in `702bdbc` and `31164ad`; shipping a
tab in layers like that is fine.)

## Before you start

1. Read `study-app/CLAUDE.md` "Architecture (module map)" — especially the opening
   "Markup" paragraph (panel list + the marker rule) and the `src/features/` bullet.
   It is auto-authoritative for anything this skill compresses.
2. **Decide whether the surface needs a tab at all.** The grammar system deliberately has
   NO tab — it surfaces through the JLPT tab's lens, the flashcard cloze branch, and
   Browse detail (`src/features/grammar/`). A tab costs permanent horizontal space in the
   nav strip on mobile; a lens inside an existing tab is often better. Scope the decision
   as a ROADMAP record first (see the `roadmap` skill).
3. Skim the reference implementation: `study-app/src/features/jlpt/` (five files,
   ~780 lines total as of 2026-07), `study-app/src/features/jlpt.js` (3-line re-export),
   and `study-app/test/jlpt-render.test.js`.
4. Dev loop: `./dev.sh` from the repo root starts API (:3000) + app (:5173) wired
   cross-origin, or `bun run dev` inside `study-app/`. Tests: `bun run test` in
   `study-app/`. Visual verification uses the preview configs in `.claude/launch.json`
   (`study-app` on :5173). For the general study-app working knowledge this skill
   assumes (module map, sync architecture, dev-account login), see the `study-app-dev`
   skill.

## The build checklist

Steps are ordered so the app keeps booting after each one. `<name>` below is your tab's
short lowercase id (e.g. `reading`) — it becomes the `data-tab` value, the panel id
suffix, the feature directory, the CSS file, and the test filenames.

### 1. Markup: panel shell + tab button + marker renumbering

In `study-app/index.html`:

- **Tab button** in the `.topbar` nav strip, in tab order:
  `<button class="tab" data-tab="<name>" title="読解 · Reading"><span class="min">読解</span></button>`.
  Japanese-named tabs wrap the label in `<span class="min">` (the editorial JP face) with
  an English `title`; English-labeled tabs (Flashcards/Browse/Stats/JLPT) are plain text.
  Keep the `.tab` class + `data-tab` — `initTabs()` wiring depends on exactly those.
- **Panel shell**, near-empty, after the existing panels:

  ```html
  <div class="panel" id="panel-<name>">
    <div id="<x>Head" class="<x>-head"></div>
    <div id="<x>Body" class="<x>-body"></div>
  </div>
  ```

  where `<x>` is a 2-letter prefix (`jl`, `wk`, `sg`, `st`, `mn` are taken). The
  head/body split is the convention every runtime-rendered tab uses (`#jlptHead` +
  `#jlptBody`, `#wkHead` + `#wkBody`). Add an HTML comment above the shell describing
  what fills it and from where — every existing panel has one.
- **Renumber ALL `.marker` ordinal chips.** Each tab renders a
  `<div class="marker"><div class="idx">04<span class="slash"> / 08</span></div>…</div>`
  chip — visible UI showing "tab N of M". Adding a tab changes the denominator on all
  of them, and inserting mid-order (the JLPT tab went in at position 4, pushing
  minna/selftalk/songs/wanikani from 04–07 to 05–08) changes indices too. Find every one:

  ```bash
  grep -rn 'class="marker"' study-app/index.html study-app/src
  ```

  As of 2026-07 that returns 8 hits: three live in `index.html` markup (study, browse,
  stats) and five render at runtime (`jlpt/view.js`, `minna/view.js`,
  `selftalk/view.js`, `songs/library.js`, `wanikani/view.js`). Marker order must match
  tab-strip order. Your new tab's own marker goes in its `headHtml` (step 5).

### 2. Feature directory-module + thin re-export

Create `study-app/src/features/<name>/` behind an `index.js` barrel, plus a thin
`study-app/src/features/<name>.js` containing only
`export * from './<name>/index.js';`. The re-export exists so `main.js` and `cloud.js`
import every feature by the same flat path shape — don't skip it.

Typical files (mirror `features/jlpt/`; not every tab needs every file):

- `index.js` — lifecycle + public-API barrel. Exports `init<X>()` (called once at boot:
  load the store, wire delegated events, kick lazy loads) and `show<X>()` (called on
  every tab activation: render what's in memory, then freshen async sources and
  re-render if the panel is still active). Copy `jlpt/index.js`'s `panelActive()` guard
  — async re-renders must check `document.getElementById('panel-<name>')` still has
  `.active`, or a slow fetch repaints a tab the user already left.
- `state.js` — only if several modules in the directory share mutable view-state: an
  exported plain object `S`, mutated in place (the songs/wanikani/minna/selftalk
  convention). The JLPT tab skips it because its only state is the synced store on the
  `src/state.js` hub.
- `store.js` — persistence (see step 7).
- `view.js` — render + delegated wiring (see step 5).
- `data.js` — only if the tab needs a large dataset: the lazy-chunk pattern
  (`jlpt/data.js`): a module-local singleton + `ensure<X>()` returning a memoized
  dynamic `import('../../data/<file>.js')` promise, plus a sync fail-soft lookup. Keeps
  big data out of the main bundle as its own Vite chunk.
- `activate.js` — only if the tab pushes content into the SRS deck. Follow
  `jlpt/activate.js`: dedup by headword skip against `deckWordSet(state.DATA)`, append
  to `loadCustom()` on monotonic `seq` ranks, `saveCustom` + `rebuildData()` +
  `refreshAfterVerbChange()`. Tag cards with a source flag so the deck's Source facet
  can slice them — and check the token name against existing chip wiring first (the
  gap-fill token is `jlptfill` because `jlpt` was already the level facet; see the
  dead-end in `study-app/CLAUDE.md`).

**Import cycles:** runtime-only cycles between feature modules are fine (ES live
bindings — every call fires at event time), but nothing may read `state.DATA` /
`state.MAXRANK` at module-eval time, and would-be eval-time cycles are broken with the
`register*()` callback seams in `main.js`. See "Module wiring" in `study-app/CLAUDE.md`.

### 3. Pure logic in core

Anything derivable without the DOM goes in `study-app/src/core/<name>.js`, DOM-free,
with app state **parameterized in** (pass the map/deck/cards as arguments — never import
DOM or read globals; `core/jlpt.js` takes injected `nowMs`/`dayKey` for anything
time-dependent). Add `export * from './<name>.js';` to `study-app/src/core/index.js` —
features import named exports from that barrel. This split is what makes the cheap,
fast pure-tier tests possible (step 8), so be aggressive about pushing logic down.

### 4. Boot wiring: main.js + chrome.js

Three edits in `study-app/src/main.js`:

1. `import { init<X>, show<X> } from './features/<name>.js';`
2. Add `<name>: () => show<X>()` to the `initTabs({...})` handler object. If the tab
   holds resources needing teardown on navigate-away (a mic stream, a playing video),
   also add a `leave<Name>` handler — minna/selftalk/songs do this.
3. Call `init<X>();` in the boot sequence. **Order matters**: `initJlpt()` deliberately
   runs after `initWanikani()` because it subscribes to WK data arrivals. Read the
   boot-order comments in `main.js` and place yours accordingly; when your tab consumes
   another feature's signals, init after that feature.

One edit in `study-app/src/features/chrome.js` — `initTabs` dispatches handlers
explicitly, one line per tab:

```js
if (next === '<name>') handlers.<name> && handlers.<name>();
```

(and a `leave` line near the top of the click handler if you added teardown). Chrome
stays a leaf module — it receives render fns as handlers rather than importing features.

If your tab renders synced/progress-derived data, also add an if-active re-render line
to `refreshAllViews()` in `study-app/src/features/cloud.js` (the post-cloud-pull and
post-import refresh set) — the JLPT line there is the template.

### 5. Render pattern: ACTIONS table + attach-once wiring

`view.js` owns everything painted into the panel. The convention (songs → wanikani →
jlpt, each copying the last):

- `render<X>()` rebuilds `#<x>Head` / `#<x>Body` via `innerHTML` from the current
  stores. Cheap full re-render on every state change; no diffing.
- A module-level `const ACTIONS = { 'action-name': (el) => { … }, … }` click table.
  Every interactive element renders with `data-<x>-act="action-name"` (JLPT uses
  `data-jl-act`); handlers mutate the store, `save…()`, and call `render<X>()` again.
- `wire<X>()` attaches ONE delegated click listener on the panel, guarded by a
  `panel.dataset.<x>Wired` flag so repeated init can't double-attach:

  ```js
  export function wireJlpt() {
    const panel = document.getElementById('panel-jlpt');
    if (!panel || panel.dataset.jlWired) return;
    panel.dataset.jlWired = '1';
    panel.addEventListener('click', (e) => {
      const el = e.target.closest('[data-jl-act]');
      if (!el || el.disabled) return;
      const fn = ACTIONS[el.dataset.jlAct];
      if (fn) fn(el, e);
    });
    // + a delegated 'change' listener for inputs, same shape
  }
  ```

- Cross-tab jumps go through the tab strip so all activation side-effects fire:
  `document.querySelector('.tab[data-tab="study"]').click()` (jlpt/view.js `goTab`).
- Icons: `<svg class="ic" aria-hidden="true"><use href="#i-NAME"/></svg>` against the
  inline sprite in `index.html`. Escape user/content strings with `escapeHtml` before
  interpolating into `innerHTML`.

### 6. CSS: one surface file, imported last

Create `study-app/src/styles/<name>.css` and append its import at the END of the style
block at the top of `study-app/src/main.js` (tail as of 2026-07: `…songs.css` →
`wanikani.css` → `jlpt.css` → yours). Cascade order is load-bearing: per-surface sheets
override the shared core (`styles.css`/`modals.css`) by coming later.

Style with the role tokens from `styles/tokens.css` (`--paper/--raised/--ink/--muted/
--line/--brand…`), never hardcoded hex — one `data-theme` flip on `<html>` is the whole
theming mechanism, and hardcoded colors break one of the two themes. Prefix your classes
(`.jl-*`, `.wk-*`, `.sg-*` are the precedents) so nothing leaks across surfaces. No new
background orbs, per-element neon halos, or backdrop-filters (the 2026-06 glow cutback).
For component contracts (`.chips`/`.frow`, chip active state, modals, sticky chrome) and
the both-themes verification bar, follow the `design-system` skill before calling any UI
done.

### 7. State + persistence

- Add a default field for your store to the `state` object literal in
  `study-app/src/state.js` (the precedent:
  `jlptStore: { level: 'N3', examDate: '', days: {} }`) with a comment saying who
  replaces it at boot. Features and core read the hub; your `store.js` `load<X>()`
  hydrates it from localStorage at `init<X>()` time.
- **Device-local UI pref** (font-size, last-open sublist): its own `jpverbs_<thing>`
  localStorage key, never synced. **Per-user data that must survive across devices**
  (progress, records, settings): a synced blob — follow the `add-synced-blob` skill
  end-to-end (client `createSyncedBlob` + `cloud.js` registry entry + `core/merge.js`
  reconciler + server enum widen). Don't inline that procedure from memory; it has its
  own traps. `jlpt/store.js` is the newest worked example: localStorage key
  `jpverbs_jlpt`, `save<X>Local()` (persist only, used when applying a cloud pull) vs
  `save<X>()` (persist + `blob.schedule()`), a `normalize<X>()` pure validator applied
  on every load/apply.
- **Server-backed content lists** (fetched from the API, cached for offline/anon):
  MUST go through `createReadThroughResource` (`study-app/src/persistence/resource.js`)
  — it owns fetch → adapt → cache-write → offline-degrade, single-flight coalescing,
  and the `adoptEmpty` clobber-guard. Four consumers exist as of 2026-07 (examples,
  selftalk, songs, grammar — `grep -rn createReadThroughResource study-app/src/features`
  lists them); don't hand-roll a fifth `try{fetch}catch{readCache}`.
- The app is **server-required by decision (2026-06-14)** — design for the signed-in
  server path first; anon/localStorage degradation is a bonus, not a driver.

### 8. Tests

Two files, mirroring the JLPT pair (conventions: `study-app/test/CLAUDE.md`):

- `study-app/test/<name>-core.test.js` — imports the REAL `src/core/<name>.js`, pure
  in/out cases, injected clock where relevant.
- `study-app/test/<name>-render.test.js` — drives the REAL feature glue over happy-dom.
  Copy the top of `test/jlpt-render.test.js` verbatim-ish: `vi.mock` ONLY the
  cross-cutting collaborators (`synced-blob.js` → inert `{schedule,push,pull}`,
  `deck.js`/`browse.js`/`custom-cards.js` → `vi.fn()` entry points, `cloud-core.js` →
  stub `api`/`setSyncStatus`), Map-backed `localStorage` via `vi.stubGlobal`, rebuild
  the panel DOM + **clear the wire-once guard** (`panel.dataset.<x>Wired = ''`) + reset
  the `state` hub fields you touch in `beforeEach`. Real lazy chunks (local dynamic
  imports) are loaded for real, not stubbed. No network, ever.
  Cover: render from empty stores, an ACTIONS click round-trip that persists, and the
  store hydrate/save round-trip.

Run `bun run test` from `study-app/` — the whole suite, not just your files (marker
renumbering and shared-module edits can break other tabs' render tests, which is
exactly what they're for).

### 9. JLPT-tab integration (if your surface produces study signals)

The 合格 tab's daily checklist auto-rows read live app signals and write through to the
synced day record. If your tab generates a trainable daily signal (e.g. "read one
passage today"), consider a checklist row — but read the AUTO/MANUAL contract dead-end
in `study-app/CLAUDE.md` first: AUTO rows need a real, re-readable per-day signal (like
the `added` day-stamp on gap-fill cards); rows without one stay MANUAL. Do NOT invent a
new streak semantic — the app deliberately has exactly two (review + speaking).

### 10. Docs + record + commit

- `study-app/CLAUDE.md`: the "Markup" paragraph counts and lists the panels in tab
  order ("the eight `#panel-*` shells… 01–08 / 08" as of 2026-07) — update the count,
  the list, and the marker range; add your feature bullet to the `src/features/`
  module-map bullet list; add any new localStorage key to the persisted-store inventory.
- `study-app/README.md`: add a row to the "What it does" table.
- Big feature? Give it its own SONGS.md-style doc in `study-app/` and link it from
  CLAUDE.md/README. Do NOT create status/progress/handoff files — shipped-work records
  live in `ROADMAP.html` only.
- Add/complete the ROADMAP record (the `jlpt-tab-v1` record is the quality bar — it
  preserves the decisions, not just the task); see the `roadmap` skill.
- Commit per the house style (`study-app: <what>`) — the `land-a-change` skill has the
  full definition of done (stale-comment sweep, explicit-path staging, prose summary).

## Verify

From `study-app/` unless noted:

```bash
bun run test                                  # whole Vitest suite green
grep -rn 'class="marker"' index.html src      # N+1 hits, consistent "NN / 0N" numbering
grep -n 'panel-<name>' index.html             # the shell exists
grep -n "'<name>'" src/features/chrome.js     # the dispatch line exists
```

(Don't grep chrome.js for `panel-<name>` — it builds panel ids as `'panel-' + next`,
so a literal search finds nothing even when correctly wired.) If the tab renders
synced data, also confirm the `refreshAllViews()` line in `src/features/cloud.js`.

Then run it (`./dev.sh` from repo root, or the `study-app` launch.json config) and
click through: tab activates and paints, other tabs' markers show the new denominator,
your ACTIONS round-trip works, and — for any UI — screenshot BOTH themes (flip
`data-theme` on `<html>` or use the topbar toggle). Preview-tooling caveat: capture
reloads the page and resets the active tab to Flashcards, so set up transient state and
assert via DOM eval rather than a follow-up screenshot (dead-end in
`study-app/CLAUDE.md`).

## What NOT to do

- **No framework, CDN font/icon kit, or chart library.** Icons come from the inline SVG
  sprite; charts are hand-rolled SVG strings (`core/charts.js` precedent).
- **No new IndexedDB store.** `features/wanikani/idb.js` is deliberately the app's ONE
  — its 9.4k-subject dataset (~10–15 MB) exceeds the localStorage quota and needs
  incremental cursors. Your dataset almost certainly fits localStorage or a lazy chunk.
- **No hand-rolled fetch/cache for server lists** — `createReadThroughResource` (step 7).
- **Never call the API with a relative `/v1` path** — always through `net/transport`'s
  `api()` (which rebases onto `API_BASE`); the app is its own container in prod, so
  relative paths 404. Credentialed `<audio>` needs `crossOrigin='use-credentials'`.
- **Don't reuse an existing facet/chip token name** for a new source/filter tag —
  grep `TOKEN_FACET` + `makeMultiSelect` wiring first (the `jlptfill`-not-`jlpt` story).
- **Don't ship data in the main bundle** when it's big — use the `data.js` dynamic-import
  chunk pattern.
- **Don't add a marker with the old denominator** or leave the other eight stale — the
  grep in Verify is the check.

## Ground truth (as of 2026-07)

This skill compresses, in authority order:

- `study-app/CLAUDE.md` — "Architecture (module map)" (the Markup paragraph owns the
  marker rule; the features bullet owns the directory-module pattern), "How to work on
  it", "Design system", and the dead-end warnings cited above.
- The JLPT reference implementation: `study-app/src/features/jlpt/`,
  `study-app/src/features/jlpt.js`, `study-app/src/core/jlpt.js`,
  `study-app/src/styles/jlpt.css`, `study-app/test/jlpt-{core,render}.test.js`, and
  commit `96c825c` (plus foundation commits `702bdbc`, `31164ad`).
- `study-app/src/main.js` (boot order + CSS cascade), `study-app/src/features/chrome.js`
  (`initTabs` dispatch), `study-app/src/features/cloud.js` (blob registry +
  `refreshAllViews`), `study-app/src/state.js` (hub), `study-app/index.html` (shells).
- `study-app/test/CLAUDE.md` — test tiers + conventions.
- `ROADMAP.html` record `jlpt-tab-v1` — the shipped-record quality bar.

Counts, orders, and the `/ 08` denominators are live facts — re-derive them with the
greps above rather than trusting this file after the ninth tab lands.
