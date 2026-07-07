---
name: study-app-dev
description: Develop on the 日常日本語 study app (study-app/ — Vite, no framework): dev loop, module map (features/core/net/state), sync/persistence rules, Vitest suite, browser verification. Use for ANY change under study-app/src or study-app/test, any study-app bug or feature, or when a tab (Study, Browse, Stats, 合格 JLPT, 教科書 Minna, 独り言 Self-Talk, 歌 Songs, 鰐蟹 WaniKani) misbehaves. Consult BEFORE writing study-app code — it routes to design, sync, and dead-end docs.
---

# study-app development

You are changing the 日常日本語 Japanese trainer at `study-app/` — a standalone Vite
project (vanilla ES modules, no framework) served at `https://wkenhanced.dev`, talking
cross-origin to the API at `api.wkenhanced.dev`. This skill gives you the working map:
where code goes, the rules that keep the codebase maintainable, how to test, and the
traps that have already cost hours. It compresses `study-app/CLAUDE.md` — that file is
the authority; this is the fast path through it.

## Before you start

- `study-app/CLAUDE.md` is the app's own doc — read the sections your change touches
  (module map, the "Persisted store" block, the dead-end list). Root `CLAUDE.md` covers
  cross-surface rules and is already in your context.
- Any visual/CSS/layout change → load the `design-system` skill first (tokens, component
  contracts, both-themes verification). A structurally-correct change that's wrong in
  dark mode is not done.
- A new top-level tab/panel → the `add-study-tab` skill. New per-user synced data →
  the `add-synced-blob` skill. API-side changes → the `api-dev` skill (the app and
  server ship together; a payload-shape change touches both).
- Debugging something already broken (login, sync, audio, blank panels)? Start with the
  `troubleshoot` skill and the CLAUDE.md dead-end list — most "impossible" behavior in
  this app is documented deliberate behavior.
- **Refactor doctrine** (maintainer decision): the codebase is already heavily
  SOLID-refactored — the module splits, the sync orchestrator, the read-through
  resources are all *shipped* workstreams. Check `ROADMAP.html`'s refactor records
  (surface `refactor`, e.g. `refactor-workstreams`) before proposing structural work;
  target NEW churn, don't re-split or re-architect shipped modules.
- **Server-required by decision** (2026-06-14): the app assumes a reachable server.
  Prefer cleaner server-required designs over offline-safe-but-complex ones. Anon +
  offline *degradation* (localStorage read-through caches) stays, but it is a courtesy,
  not a design driver. Legacy "offline-first" wording in older docs/comments is stale.

## Dev loop

```sh
./dev.sh                 # from repo root — API :3000 + app :5173, wired cross-origin (preferred)
./dev.sh -a 3001 -s 5174 # explicit ports; --find-free auto-skips busy ones
```

`dev.sh` sets `STUDY_APP_ORIGINS` / `VITE_API_BASE` / `MEDIA_PUBLIC_BASE` so credentialed
CORS works exactly like prod — this is why it beats starting the two servers by hand.
Manual alternative: `bun run dev` in `study-app/` + `bun dev` in `wk-enhanced-api/`.
First run auto-installs deps (`bun install` if `node_modules` is missing).

- **Sign in as the dev account**: password in `dev_account_password.txt` at the repo
  root; the email is the `VITE_DEV_EMAILS` default in `study-app/src/features/cloud.js`
  (`dylan_j_kelly@icloud.com` as of 2026-07). Don't paste the password into code or
  docs, and never invent new secret files.
- **Tests**: `bun run test` from `study-app/` — Vitest + happy-dom (21 files / 417
  tests, ~2s, as of 2026-07). Must be green before commit.
- **Preview tooling**: `.claude/launch.json` has configs — `study-app` (:5173),
  `wk-enhanced-api` (:3000, note it runs `bun start`, not hot-reload `bun dev`),
  `study-app-design` (:5191), mock galleries `redesign-mocks` (:5190) /
  `sleek-mocks` (:5192), `roadmap` (:5188).
- Dev-only extras: Vite serves the repo-root `ROADMAP.html` + `study-app/mockups/`
  galleries on :5173 via a `configureServer` middleware; a dev-account-gated navbar
  Roadmap link opens it. None of this ships in `bun run build`.

## Module map (where things live)

| Layer | Path | What belongs there |
|---|---|---|
| Boot | `study-app/src/main.js` | `initX()` calls in order + CSS cascade imports. **No feature logic.** The header comment explains the ordering constraints — read it before inserting a boot step. |
| Features | `src/features/<x>` | DOM/render/glue, one module per surface. Big tabs are **directory modules**: `features/<x>/{state,store,view,...}.js` behind an `index.js` barrel, plus a thin `<x>.js` `export *` re-export so `main.js`/`cloud.js` import paths never change. Runtime-only import cycles (calls at event time) are fine; eval-time cycles are not — `main.js` breaks those with `register*()` callback seams. |
| Pure core | `src/core/<x>.js` | DOM-free, unit-tested logic behind the `core/index.js` barrel. Reads app state via parameters or the `state` hub — **never imports DOM or feature modules**. |
| Shared state | `src/state.js` | The ONE mutable hub: `state.store` (progress), `state.DATA` (live deck), per-feature stores, `attachLevels()`. An object whose *properties* mutate (not `export let` — tests reassign `state.store`). |
| Network | `src/net/` | `transport.js` = `api()`, the single fetch choke-point (API_BASE rebase, `credentials:'include'`, timeout + idempotency-aware retry). `sync-queue.js` = durable offline write FIFO. `sync-orchestrator.js` = pull/flush/bus-wire over the blob registry. |
| Persistence | `src/persistence/` + `src/settings-store.js` + `src/sync-bus.js` | localStorage modules; `cache.js`/`resource.js` (read-through); the sync-bus seam where persistence `save*()`s schedule cloud pushes without importing cloud. |
| Data | `src/data/` | Datasets. Several are **generated** (`jlpt.js`, `jlpt-words/*`, `grammar-n3.js`, `grammar.json`) — never hand-edit those; regenerate via their tools. |
| Styles | `src/styles/` | tokens → base → chrome → shared → per-surface CSS, imported in cascade order by `main.js`. New surface = new file, imported last. See `design-system`. |

**Where new code goes — decision rules:**

- Pure derivation/parsing/scoring → `src/core/` (+ export via `core/index.js`, + a case
  in the matching `test/*-core` file). If you're tempted to touch the DOM there, you're
  in the wrong layer.
- Rendering, event wiring, store round-trips → the owning feature module. Multi-file
  features follow the directory-module pattern above; view modules own a render
  dispatch + a declarative `ACTIONS` click table (one delegated listener, `data-action`
  attrs — see `features/songs/index.js` or `features/jlpt/view.js` for the convention).
- A server-backed list cached in localStorage → `createReadThroughResource`
  (`src/persistence/resource.js`). **Never hand-roll `try{fetch}catch{readCache}`** —
  the resource owns single-flight coalescing (concurrent refreshes share one fetch) and
  the `adoptEmpty:false` clobber-guard (a transient empty fetch can't overwrite good
  cached data). Existing consumers to copy: `features/examples.js`,
  `features/songs/library.js`, `features/grammar/data.js`, `features/selftalk/store.js`.
  (One deliberate exception: the WaniKani dataset uses IndexedDB — see Traps.)
- Per-user data that must survive across devices → a synced blob. Do NOT inline that
  procedure; follow the `add-synced-blob` skill. Overview + per-blob table:
  [references/sync-architecture.md](references/sync-architecture.md).

## Architecture rules (and why)

1. **No framework, no CDN, no chart library.** Icons are an inline SVG `<symbol>`
   sprite (add new glyphs as symbols); charts are hand-rolled SVG built by pure
   `core/charts.js` functions. The one blessed canvas is the record-compare waveform.
   Google Fonts is the only external dependency and degrades gracefully — don't add
   another hard one.
2. **Every API call goes through `API_BASE`** (`import.meta.env.VITE_API_BASE`, read in
   `src/config.js`) — never a relative `/v1` path. The app is its own nginx container
   in prod; a relative path would hit the app origin and 404. `api()` in
   `net/transport.js` does the rebase and sends `credentials:'include'`; use it for all
   server calls (it also owns timeout/retry/backoff and 409 body capture). The one
   sanctioned bypass is the WaniKani tab (third-party API — see Traps).
3. **Cookie-gated audio needs `crossOrigin='use-credentials'`** on the `<audio>`
   element (Minna native clips, recordings). Without it the session cookie isn't sent
   cross-origin and playback 401s. Public TTS audio doesn't need it.
4. **Keep `src/core/*` DOM-free.** The test suite imports core modules under happy-dom
   and would still pass with DOM access — the rule is what keeps the pure tier honest.
5. **Dev mirrors prod's cross-origin split.** If local login won't stick: check
   `COOKIE_SECURE=false` on the API (a `Secure` cookie is dropped over http) and
   `STUDY_APP_ORIGINS` allowlisting the Vite origin. `./dev.sh` sets this up; hand-run
   servers on non-default ports often don't.

## Persistence at a glance

All app localStorage keys are prefixed `jpverbs_*`. The complete inventory with shapes
lives in `study-app/CLAUDE.md`'s "Persisted store" block — read it before touching any
key. The split that matters:

- **Eight cloud-synced blobs** (as of 2026-07): `verbs` (progress), `custom-verbs`,
  `settings`, `minna`, `selftalk`, `songs`, `wanikani` (WK token only), `jlpt`.
  Registry + merge semantics: [references/sync-architecture.md](references/sync-architecture.md).
- **Device-local, never synced**: `jpverbs_font`, `jpverbs_theme`,
  `jpverbs_topic_<panel>`, `jpverbs_signup_dismissed`, `jpverbs_micDevice` (a deviceId
  is meaningless on another machine — don't "helpfully" sync it).
- **Read-through caches** (server content, wiped-safe): `jpverbs_examples_cache`,
  `jpverbs_selftalk_cache`, `jpverbs_selftalk_templates_cache`, `jpverbs_songs_cache`,
  `jpverbs_grammar_cache`. Plus `jpverbs_sync_queue` (offline write queue) and
  `jpverbs_cardex_migrated` (one-time migration flag).

## Settings work (worked area)

Settings changes recur; here's the exact wiring:

- The live object is `settings` in `src/settings-store.js`. Shape (as of 2026-07):
  `DEFAULT_SETTINGS = { exampleLevel, furigana, input, audio, freeReviewDue,
  recordingsKeep, trimSilence, compareSpeed, audioPrefs }`.
- `loadSettings()` merges saved values over defaults (and migrates legacy per-key
  prefs); `saveSettings()` = persist + `applyFurigana()` + `sync.settings()` (schedules
  the cloud push); `setSettings()` is the identity-swap used when a server pull
  replaces the object.
- UI: `src/features/settings-page.js` owns the `#settingsModal` wiring +
  `renderSettings()` (paints active chips from `settings`); `paintPrefChips()` lives in
  `src/features/deck.js` (mirrors prefs onto the study-picker chips).
- Synced as app `settings` — the ONE blob that is **server-wins on 409** (no merge fn;
  last writer wins is correct for preferences, unlike the merged data blobs).
- Adding a setting: default in `DEFAULT_SETTINGS` → control markup in `index.html`'s
  settings modal → wire the control in `initSettingsPage()` (delegated click, call
  `saveSettings()` + `renderSettings()`) → reflect it in `renderSettings()` → apply the
  side-effect where the setting is consumed. Theme/font are NOT settings — they keep
  their own device-local keys via `features/chrome.js`.

## Tests

`study-app/test/CLAUDE.md` is the authority on conventions; the suite has three tiers:

1. **Pure-core** (`core.test.ts` + per-subsystem `*-core.test.js`) — imports the real
   `src/core/*` modules. New pure logic gets a case here.
2. **Render/glue** (`*-render.test.js` per tab, + `custom-cards.test.js`,
   `speaking-bar.test.js`) — drives the REAL feature modules over a happy-dom DOM with
   only the cross-cutting collaborators mocked (`synced-blob.js` as inert stubs,
   `cloud-core.js` with `api` resolving `{}` / `account: null`, jump entry points as
   `vi.fn()`). **Don't mock `src/core/*`** — exercising it is the point.
3. **Infra** — transport / sync-queue / synced-blob / sync-orchestrator / cache /
   resource pinned in isolation.

Conventions that bite: localStorage is a Map-backed `vi.stubGlobal` stub (clear it in
`beforeEach`); delegated handlers attach once behind `dataset.*Wired` flags — tests
that rebuild the DOM must clear the flag or the fresh DOM gets no handlers; reset any
`state` hub fields you touch in `beforeEach` (the hub is module-global across a file's
tests); no network, ever. When a failure stumps you, paste the Vitest output to the
user rather than guessing.

## Verify

1. `cd study-app && bun run test` — expect `Test Files 21 passed` / all tests green
   (counts grow over time; zero failures is the bar).
2. Look at the change in the running app — **both themes** (flip via the theme toggle
   or `document.documentElement.dataset.theme`). The `design-system` skill defines the
   fidelity bar for anything visual.
3. **Preview caveat**: browser-preview capture reloads the tab, resetting in-memory
   state (active tab, `cfg`/`bcfg` filters — only localStorage survives). To verify a
   transient state, set it up and assert via DOM eval in the same session, not a
   follow-up screenshot.
4. Then finish properly — the `land-a-change` skill (stale-comment sweep, doc updates,
   ROADMAP record, commit conventions).

## Traps (the landmine shortlist)

`study-app/CLAUDE.md` "Things that look like bugs but aren't" is ~45 entries of
documented deliberate behavior (as of 2026-07). **Search it before assuming a bug or "cleaning up" odd
code.** The five that bite hardest:

1. **The `'no-state.store'` rename trap.** `api()`'s `cache:'no-store'` is load-bearing
   (stale-cache protection). A mechanical `store`→`state.store` rename once rewrote the
   *string* to `'no-state.store'`, throwing an invalid-`RequestCache` TypeError that
   surfaced only signed-in. Lesson: never blind-rename `store` across `src/`, and grep
   string literals after any rename.
2. **`jlptfill` vs `jlpt` tokens.** The gap-fill source token is `jlptfill`; `jlpt` is
   the LEVEL facet (`.chip.jlpt`, `cfg.jlpt`). Naming a source chip `jlpt` collides
   with `makeMultiSelect` wiring and `TOKEN_FACET` routing. Per-level source tags are
   `jlpt-n3` style.
3. **The JLPT checklist mixes AUTO and MANUAL rows on purpose.** Auto rows read a live
   app signal each render and write THROUGH to the day record; manual rows exist where
   no reliable signal exists. Don't "unify" them, don't add a new streak semantic.
4. **Two grammar artifacts, one id space.** `src/data/grammar.json` (GiNZA tagger
   catalog, generated from `sentence-nlp/patterns.py`) and `src/data/grammar-n3.js`
   (N3 curriculum, generated by `study-app/tools/grammar-n3/build.mjs`) are separate
   generated files sharing one id vocabulary. Never hand-edit either; never rename a
   shipped grammar id (cards and MCQ banks key on them). See `add-grammar-point`.
5. **`compactLink` drops falsy ordinals.** The server omits `ordinal: 0` from
   `/v1/sentences` wire links — every consumer keying on ordinal must default absent
   → 0, or the first example of a set silently loses its data.

Two more worth knowing exist (read their full entries before touching those areas):
`saveVerb` rebuilds the card object on edit, so machine-set provenance fields
(`minna`/`wkId`/`grammarId`/`jlptfill`/...) are carried through an explicit list — a
new machine-set field must be added to it; and the 鰐蟹 WaniKani tab deliberately
bypasses BOTH `api()` (third-party CORS API, no cookies) and the read-through-cache
convention (9.4k subjects live in IndexedDB `jpverbs_wanikani` — the app's ONE
IndexedDB store; don't add a second without a dataset that genuinely exceeds
localStorage).

## Ground truth (as of 2026-07)

This skill compresses, in order of authority:

- `study-app/CLAUDE.md` — module map, persisted-store inventory, design system,
  the full dead-end list.
- `study-app/test/CLAUDE.md` — test layout + conventions.
- `dev.sh` (header comment) — the dev-loop wiring.
- `study-app/src/main.js`, `src/state.js`, `src/net/*` — boot order, state hub, sync
  stack (top-of-file comments are kept accurate).
- Feature depth: `study-app/CARDS.md`, `MINNA.md`, `SONGS.md`, `SELFTALK.md`.
- Backlog + shipped record: `ROADMAP.html` (see the `roadmap` skill).

If a claim here contradicts those files, the files win — and update this skill in the
same commit.
