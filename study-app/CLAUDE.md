# study-app — 日常日本語 Japanese Trainer

## What this is

The **日常日本語 study app**: a standalone **Vite** project (ES modules, no framework).
[index.html](index.html) loads one entry — [src/main.js](src/main.js), a thin boot file
that owns NO feature logic: it builds the initial deck and calls each module's `initX()` in
order. The actual DOM/render/feature glue is split into **`src/features/*`** modules:

- **`src/features/`** — one module per surface/concern: `chrome` (tabs/font/theme), `io`
  (export/import), `deck` (filter model + picker + forecast + due banner; owns `cfg`),
  `flashcard` (session lifecycle; owns `session`), `browse` (grid + detail modal + topic
  groups; owns `bcfg`), `stats` (charts), `custom-cards` (rebuildData + #verbModal CRUD),
  `settings-page`, `minna` (the みんなの日本語 dashboard — now a **directory**
  `minna/{state,store,activate,clips,speaking,view}.js` behind `minna/index.js` (the lifecycle +
  public-API barrel), with `minna.js` a thin `export *` re-export so main.js + cloud.js import
  unchanged; `state.js` = the shared mutable `S` (lessons list + lesson cache), the store/sync +
  clip ranges in `store.js`, the vocab→deck glue over the pure core planner in `activate.js`, the
  conversation clip marker in `clips.js`, the nav speaking dock in `speaking.js`; runtime-only import
  cycles like the others — see [MINNA.md](MINNA.md)), `selftalk` (the 独り言 Self-Talk
  output/speaking-practice tab — now a **directory** `selftalk/{state,store,view,practice,authoring,
  speaking}.js` behind `selftalk/index.js` (the lifecycle + delegated-events orchestrator), with
  `selftalk.js` a thin `export *` re-export so main.js + cloud.js import unchanged; `state.js` = the
  shared mutable `S` view-state, the modules form runtime-only import cycles like songs — see
  [SELFTALK.md](SELFTALK.md)), `songs` + `songs-youtube` (the
  歌/Songs song & lyric analysis tab — Library/Add/Read/Listen/Shadow/Mine; now a **directory**
  `songs/{state,library,add,edit,read,listen,shadow,mine,progress}.js` behind `songs/index.js` (the
  render-dispatch + song-view shell + the declarative `ACTIONS` click table + navigation (with the
  `S.nav` epoch that drops stale async opens) + lifecycle orchestrator), with `songs.js` a
  thin `export *` re-export so main.js + cloud.js import unchanged. `state.js` = the shared mutable
  `S` view-state (mutated in place); the modules form runtime-only import cycles (`render`/
  `showLibrary`/`refreshLibrary` re-imported by add/progress/edit), like record-compare. Transient
  status pills go through cloud-core's `setSyncStatus` (the one `#syncStatus` writer — the old local
  `flash()` copy is gone). Render/navigation glue tested in `test/songs-render.test.js`. See
  [SONGS.md](SONGS.md)), `wanikani` (the 鰐蟹 WaniKani companion tab — a **directory**
  `wanikani/{state,store,api,idb,sync,view,dashboard,leeches,browse,detail,bits,activate}.js` behind
  `wanikani/index.js` (lifecycle: `initWanikani`/`showWanikani` + the connect/sync orchestration),
  with `wanikani.js` a thin `export *` re-export. Token gate → dashboard / 苦手 leeches +
  same-kanji confusion groups / corpus browser + a subject detail modal; `activate.js` is the
  wk-leech-to-deck glue (a leech / confusion family / any vocab subject → tagged Source:鰐蟹
  custom cards via the pure `buildWkCard`, drilled by the app's OWN Leitner — WK is never
  written back; dedup = wkId + deck-headword skip, the songs-style path, NOT Minna overlays); `view.js` owns the
  render dispatch + a songs-style declarative `ACTIONS` click table on the panel. `api.js` talks
  to **api.wanikani.com DIRECTLY** (CORS; deliberately NOT net/transport's `api()` — no cookies,
  no API_BASE) and `idb.js` is the app's ONE IndexedDB cache (see the dead-end below). Pure
  derivations (leech scoring, clustering, forecasts, slimmers) live in `core/wanikani.js`;
  render glue tested in `test/wanikani-render.test.js`),
  `jlpt` (the 合格 JLPT tab — exam MISSION CONTROL: countdown hero + the PACING-COACH strip +
  the daily-training checklist + the vocabulary-readiness lens with the N3 GAP-FILL flow +
  the GRAMMAR lens + the four-papers guidance; a **directory**
  `jlpt/{data,store,view,activate}.js` behind `jlpt/index.js` (lifecycle: `initJlpt`/`showJlpt`),
  with `jlpt.js` a thin `export *` re-export. `data.js` owns the LAZY word-list singleton —
  `ensureJlptMap()` dynamic-imports the generated `data/jlpt.js` (7.6k JLPT words N5–N1,
  its own Vite chunk, kicked at boot) and exposes the sync fail-soft `jlptOf(jp, read)`
  every surface shares (wanikani badges/activation stamping), plus the one-time
  `backfillWkJlpt` patch for pre-lens 鰐蟹 cards, plus `ensureJlptWords(level)`/`jlptWords` —
  a LITERAL per-level loader map over the generated `data/jlpt-words/<level>.js` chunks
  (JMdict-enriched `[jp,read,mean,cat,type,trans]` tuples, frequency-ordered = the gap-fill
  selection order; regenerate with `wk-enhanced-api/scripts/generate-jlpt-words.ts` + a
  locally-downloaded JMdict_e); `activate.js` = the gap-fill glue (`addJlptWords` —
  headword-skip dedup, `jlptfill` source flag + `added` day-stamp; the wanikani/activate.js
  mirror); `store.js` = the `jlpt` synced blob (level + examDate + optional pacing `targets` +
  rolling per-day checklist record + the optional mock-test log `mocks[]`, 409-MERGED via
  `mergeJlpt`); `view.js` renders + the
  ACTIONS click table (auto tasks track live app signals — deck due / gap-fill adds /
  leeches / grammar-card grades / selftalk practice / WK reviews via `ensureWkData`/`onWkData`
  — and write THROUGH to the day record; manual tasks toggle it). Pure derivations (map/
  lookup/countdown/coverage/gap/batch-tiering/pace/plan/heat/merge) live in `core/jlpt.js`;
  tests in `test/jlpt-core.test.js` + `test/jlpt-render.test.js`),
  `grammar` (the N3 GRAMMAR SYSTEM — no tab of its own: it surfaces through the JLPT tab's
  lens, the flashcard's CLOZE branch, and Browse detail; a **directory**
  `grammar/{data,activate,index}.js`. `data.js` owns the lazy catalog singleton —
  `ensureGrammarPoints()` dynamic-imports the generated `data/grammar-n3.js` (81 N3 points ×
  explanation/formation/3–5 ruby'd cloze examples, its own chunk) + the sync fail-soft
  `grammarPointOf(id)`, plus the GiNZA-token read-through resource (`jpverbs_grammar_cache`,
  `GET /v1/sentences?ownerType=grammar_point&annotate=1`, keyed `<pointId>:<ordinal ?? 0>`);
  `activate.js` = grammarId-dedup'd activation into ORDINARY custom cards (cat:'grammar' —
  the sixth category; the card is a display snapshot, content renders BY grammarId lookup so
  a content fix reaches existing cards without re-activation). The catalog is REGENERATED by
  `tools/grammar-n3/build.mjs` from the vetted `points.json` id registry + per-point content
  JSON (see tools/grammar-n3/CONTENT_GUIDE.md) — never hand-edit the module, never rename a
  shipped id (wave-2 MCQ banks key on them). Pure logic in `core/grammar.js`; tests in
  `test/grammar-core.test.js` incl. catalog invariants over the real generated module),
  `record-compare` (the generic
  record-and-compare engine — fed by Minna AND Self-Talk; now a **directory**
  `record-compare/{state,capture,takes,playback,waveform,view}.js` behind a 13-export barrel
  `record-compare/index.js`, with `record-compare.js` a thin `export *` re-export so the two
  consumers' import path is unchanged. `state.js` = the shared mutable `S` singletons + the one
  `audioCtx()`; the modules form runtime-only import cycles, like cloud⇄minna), `a11y` (roving tabindex + chip
  annotations), `tts`, `audio` (the shared `playItem(item,context)` player — resolves an item to a
  tagged voice variant + routes public-vs-credentialed `<audio>` by `gated`), `render-helpers`
  (shared `jishoUrl`/`provenanceBadge`/`speakBtnHtml`, plus `copyBtnHtml`/`copyText` — the
  copy-sentence button beside each example's ▶ play on the flashcard answer, Browse detail,
  and Minna example rows), and the cloud
  pair `cloud-core` (`account`/`setSyncStatus`; re-exports `api`) + `cloud` (the SyncedBlob registry + auth + bootAuth).
- **`src/net/`** — the network layer: `transport` owns `api()`, the resilient fetch choke-point
  (timeout via `AbortController` + idempotency-aware retry/backoff + `Retry-After`); GET/PUT/DELETE
  retry by default, POST only with `{retry:true}`. `sync-queue` is the durable offline write-queue
  (localStorage FIFO, dedup by key, replay on reconnect). `sync-orchestrator` is the pure, DI'd group
  layer over the **blob registry** — `createSyncOrchestrator({registry,queue,sync,getAccount})` exposing
  `pullAll` / `flushAll` / `wireBus`; cloud.js declares the ordered `[{blob,busKey}]` registry ONCE and
  delegates, so adding a synced blob no longer means editing pullCloud + flushQueue + initCloud in
  lockstep (Open/Closed). `pullAll` isolates each blob (one failure can't abort the rest). DOM-free →
  unit-tested in `test/sync-orchestrator.test.js`. `cloud-core` re-exports `api` so callers are unchanged.
- **`src/core/`** — the PURE, unit-tested core (DOM-free): `srs`, `forecast`, `facets`,
  `examples`, `kana`, `pitch`, `text`, `minna`, `audio` (the per-context voice-priority
  `resolveVariant`), `recordings` (record-and-compare math — `findTrimBounds`/`waveformPeaks`/
  `normGains`/`clampSpeed` + the C0 additions `chooseMime`/`encodeWav`/`biasNative`/`biasTake`),
  `refs` (the record-compare reference-voice selection + audio-URL shapes — `base`/`httpServed`/
  `prefs` injected so `features/record-compare.js` keeps owning `API_BASE`/`HTTP_SERVED`/`settings`),
  `songs` (the 歌/Songs pure helpers — coverage / JLPT bucketing / known-vs-new vocab split /
  `parseYouTubeId` / `clozeBlanks`+`clozeLineParts` / the Listen grade `readingMatch`+`lineReading` /
  the activation `buildSongCard`+`songCardKey` / `songLineKey`+`parseSongLineKey`),
  `selftalk` (rotation / topic-grid grouping / streak / `realizeTemplate` /
  `sentenceToPhrase`), `wanikani` (leech scoring / same-kanji confusion clustering /
  forecasts / `slimSubject` / `buildWkCard`), `jlpt` (map/lookup / countdown / coverage /
  gap / batch-tiering / pace / plan / heat / the mock-log math — `normalizeMocks` /
  `mockVerdict` / `mockTrend` / `MOCK_PASS`), `grammar` (`buildGrammarCard` /
  `pickGrammarExample` / `grammarBlank` / `clozePartsToHtml` / coverage), `conjugation`
  (the drill paradigms — `conjugate` → `{kana,display}`-or-null / `conjugableForms` /
  `isConjugable` / `pickConjForm` / `CONJ_FORMS`), `merge` (the
  per-blob 409 reconcilers — `mergeProgress`/`mergeCustomVerbs`/`mergeMinna`/
  `mergeSelftalkPractice`/`mergeSongs`/`mergeJlpt`), `sentence` (shared sentence-store
  wire decoders — `sentenceGrammar`/`sentenceTokens`/`sentenceEn`), `annotate`
  (`overlayTokens` — the ruby⇄token reconciler), and `charts` (the Stats SVG/HTML
  builders), behind a barrel `core/index.js`.
- **`src/state.js`** — the ONE shared mutable hub: `state.store` (progress), `state.DATA`
  (the live deck), `state.minnaStore`, `state.MAXRANK`, `state.BUILTIN_RANK_BY_JP`, plus
  `attachLevels()`. An object whose **properties are mutated** (not `export let` — importers
  can't reassign those, and the test does `state.store = {...}`).
- **`src/persistence/`** (localStorage: `store`/`custom`; plus `cache.js`'s
  `createReadThroughCache` and `resource.js`'s `createReadThroughResource` — see below),
  **`src/settings-store.js`**
  (synced prefs + `setSettings`), **`src/config.js`** (`API_BASE`/`localDay`), and
  **`src/sync-bus.js`** — the seam where persistence schedules cloud pushes (`sync.progress`/
  `custom`/`settings`) that `cloud.js` registers, replacing the old `typeof` forward-refs.
  **Any server-backed list cached in localStorage (the deck examples, Self-Talk phrases +
  templates, the Songs library) MUST go through `createReadThroughResource`** — it owns the
  fetch→adapt→cache-write→offline-degrade flow plus single-flight coalescing (concurrent
  refreshes share one fetch) and the `adoptEmpty` clobber-guard, so each consumer declares
  only its endpoint/adapter/landing-spot. Don't hand-roll a fifth `try{fetch}catch{readCache}`
  copy; that duplication (with no concurrency guard) is exactly what it replaced.
- **`src/data/`** — `verbs.js` (`export const VERBS`/`ACCENTS`) + `examples.js`
  (`export const EXAMPLES` — now the SEED SOURCE for the sentence store, not read at runtime;
  the deck fetches examples from the server store).

**Module wiring.** Cross-feature calls use direct imports (live bindings — safe even when
circular, e.g. cloud⇄minna, because every call fires at event/runtime, not module-eval). A
few callback seams in `main.js` break would-be eval-time cycles: `registerStartSession`
(deck→flashcard), `registerCardActions` (browse→custom-cards), `registerSessionHooks`
(flashcard←cloud's logSession/maybeShowSignup). Single-writer mutable singletons are plain
`export let`/`const` in their owner module (`cfg`/`bcfg`/`session`/`account`); `settings` is
the one two-writer case, reassigned via `setSettings()`.

Built + content-hashed by Vite, served by its **own nginx container** at the apex
`https://wkenhanced.dev` — **separate** from the API container at `api.wkenhanced.dev`
(two containers, one droplet). The app talks to the API over HTTP **cross-origin**
(same-site): every `/v1/*` call is rebased onto `API_BASE` (`import.meta.env.VITE_API_BASE`).
Originally one self-contained HTML file (the since-removed
`japanese-study/japanese-verbs.html`); grew into
classic-script files served by the API, then extracted here as its own Vite project.

User-facing overview: [README.md](README.md). What to do next: [ROADMAP.html](../ROADMAP.html) (the consolidated cross-surface backlog).
**Card data model + authoring: [CARDS.md](CARDS.md).** みんなの日本語: [MINNA.md](MINNA.md).
Backend (auth, progress, cookie, the cross-origin CORS) is the server's:
[../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md) "Accounts + study app",
[../wk-enhanced-api/deploy/README.md](../wk-enhanced-api/deploy/README.md). This file adds the
*contributor* layer: how-to-work-on-it, the design-system contracts, and the dead-end warnings.

## How to work on it

1. **Vite.** `bun install` once, then `bun run dev` (→ http://localhost:5173) with
   `bun dev` in `../wk-enhanced-api` (→ :3000) for accounts/TTS/Minna. `bun run build`
   → `dist/`; `bun run preview` serves the built bundle. Edit modules under `src/`:
   pure logic in `src/core/*`, shared state in `src/state.js`, DOM/feature glue in
   `src/features/*` (boot order in `src/main.js`), markup in `index.html`, styles in
   `src/styles/*.css` (the Day/Night design system — `tokens`/`base`/`chrome`/per-surface)
   plus the shared core `src/styles.css`, all imported in cascade order by `main.js`. See
   "Design system" below. **Dev-only:** [vite.config.js](vite.config.js) adds a `configureServer`
   middleware that serves the repo-root [ROADMAP.html](../ROADMAP.html) (the consolidated backlog) + the
   `mockups/` galleries on `:5173`, reached via a dev-account-only navbar link (the chrome contract +
   `cloud.js` `updateDevRoadmapLink`); none of it ships in `bun run build`.
2. **Verify visually.** This is a UI; screenshot the change. Drive it with the
   browser-preview tooling (`.claude/launch.json` has both `study-app` and
   `wk-enhanced-api` configs). See the preview caveat in the dead-ends below. **Run
   `bun run test` too** — a ~21-file Vitest + happy-dom suite (layout + conventions:
   [test/CLAUDE.md](test/CLAUDE.md)). Three tiers: `core.test.ts` + the per-subsystem
   `*-core` tests import the real `src/core/*` modules (a broken export/import fails
   loudly); the `*-render` tests drive each tab's REAL feature glue over a happy-dom DOM
   with the side-effecting collaborators (network/persistence/audio) mocked; and the infra
   tests pin transport / sync-queue / synced-blob / orchestrator / resource behavior.
3. **Commit conventions** (same as the rest of the repo): one logical change → one
   commit; commit at the end of a feature without being asked; fix stale nearby
   comments in the same commit.
4. **The no-framework / offline-friendly ethos still holds — but modules + a bundler
   are now IN** (that's the whole point of the extraction). Do **not** add a framework,
   a CDN icon font, or a chart library: icons stay an inline SVG `<symbol>` sprite, charts
   stay hand-rolled SVG (the pure `core/charts.js` builders — `dailyAccuracySvg`,
   `pipelineHtml`). Keep `src/core/*` **DOM-free** (the test
   imports them under happy-dom) and **parameterize** anything that reads app state via the
   `state` object — don't make core import DOM. The old `file://` double-click is gone by
   decision (server-only); runtime offline-degradation against localStorage stays.
5. **Cross-origin auth (dev mirrors prod).** Vite :5173 → API :3000 is cross-origin +
   same-site. Keep `COOKIE_SECURE=false` (a `Secure` cookie is dropped over
   `http://localhost`) and the API's `STUDY_APP_ORIGINS` allowlisting the Vite origin
   (defaults to `http://localhost:5173`). #1 thing to check if local login won't stick.
   See the cross-origin dead-end below + [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md).

## Architecture (module map)

Markup — the eight `#panel-*` shells, in TAB ORDER: `#panel-study` (flashcard setup → card
stage → done), `#panel-browse` (filter grid), `#panel-stats` (charts + leeches),
`#panel-jlpt` (合格 JLPT — `#jlptHead`/`#jlptBody` filled by `renderJlpt`), `#panel-minna`
(the みんなの日本語 lesson dashboard, tab-labeled **教科書** — near-empty in markup, filled
at runtime by `renderMinna`), `#panel-selftalk` (独り言), `#panel-songs` (歌 — `#sgBody`
filled by `renderSongs`), `#panel-wanikani` (鰐蟹 — `#wkHead`/`#wkBody` filled by
`renderWanikani`; `#wkModal` is its subject-detail overlay), plus the header/toolbar, tabs,
and the auth modal + sign-up banner. The per-tab `.marker` indices run 01–08 / 08
(study/browse/stats markers sit in the markup; the jlpt/minna/selftalk/songs/wanikani
panels render theirs at runtime) — renumber ALL of them when adding a tab.

`data/verbs.js` holds the `VERBS` dataset. The old single-file `app.js` sections are now
one module each under `src/features/*` (the section names map 1:1 to filenames): persistence
(`persistence/store`+`custom`) + SRS (`core/srs`) → `settings-store` → `chrome`
(font/theme/tabs) → `io` (export/import) → `deck` (`passes()` + `wireFacets`, owns `cfg`) →
`flashcard` (session lifecycle, owns `session`) → `browse` (+ detail modal, owns `bcfg`) →
`stats` → `custom-cards` (modal CRUD + `rebuildData`) → `cloud-core`+`cloud` → `settings-page`
→ `minna`. `main.js` calls their `initX()` in that order. Key functions by area:

- **SRS/leech (pure, the core logic):** `cardStat`, `scheduleCard`, `isDue`,
  `dueCards`, `rollingAcc`, `isLeech`, `leeches`. Leitner boxes, not SM-2.
- **Study type (`cfg.kind` ∈ `free`/`srs`):** the picker's "Study type" toggle.
  `buildDeck` restricts an SRS deck to due cards; `grade` only calls `scheduleCard`
  when `session.kind==='srs' && isDue(rank)`. Free study records attempts/accuracy
  but NEVER touches the box/due. Session kind is captured at `startSession` into
  `session.kind`, tagged onto `store.sessions[*].kind` + the durable log's
  `details.kind`, and split out in `renderStats` (the SRS vs Free-study boxes).
- **Test direction (`cfg.mode` ∈ `meaning`/`reading`/`conjugation`):** the picker's "Test
  direction" toggle — which side of the card is the prompt. `conjugation` is the odd one out:
  a PRODUCTION drill (dictionary form → an inflected form) whose paradigms come from the pure
  `core/conjugation.js`, gated by its own `cfg.forms` chip row and narrowing the deck to
  inflectable cards (`isConjugable`, applied in BOTH `buildDeck` and `updateDeckCount`).
  Grading/SRS are unchanged — a conjugation miss records against the same card. See the
  fail-closed dead-end below.
- **Filtering (AND'd facets):** `passes(v,c)` intersects six token facets
  (`cat`/`type`/`trans`/`topic`/`status`/`source`) + JLPT + rank. `facetMatch` =
  OR-within-one, `facetAll` = no-constraint test, `oneGroup` = does a card match one
  token. `wireFacets(selector,c,onChange)` wires the `.deck`/`.bf` chips, deriving each
  chip's facet from its token via `TOKEN_FACET` (topic is the default; `mnn-l<n>` →
  `source` via a regex); the lone "all" chip clears every facet. `makeMultiSelect` still
  wires the JLPT segs. `cfg` (flashcard deck) and `bcfg` (browse grid) are independent
  configs. The `source` facet (みんなの日本語 / iTalki / per-lesson) is the Minna-provenance
  filter — see [MINNA.md](MINNA.md) "The Source filter facet".
  `annotateJlptChips`/`annotateCatChips`/`annotateSourceChips` disable empty JLPT levels /
  categories / sources (the Source row also hides entirely until the deck has Minna cards).
  `syncVerbRows` hides the verb-only Type+Transitivity rows when the `cat` facet
  excludes verbs (and clears any stranded type/trans tokens).
- **Categories (`cat` facet):** `CATS` = `verb/adjective/noun/adverb/phrase`; all
  100 built-ins are `verb`, the rest are user-added. `cardStamp(v)` + `colorClass(v)`
  pick the hanko-stamp label/CSS class — the word-class subtype (`GODAN`, `い-ADJ`)
  when present, else the bare category (`NOUN`). The add-card modal's `syncVerbFields`
  shows Type for verbs+adjectives (repopulating `#vfType` via `VF_TYPE_OPTS`) and
  Transitivity for verbs alone; `saveVerb` stores `''` for the hidden fields.
- **Data + custom verbs:** `DATA` is a `let` = baked `VERBS` + `loadCustom().verbs`,
  rebuilt by `rebuildData()`; `attachLevels()` also defaults `v.cat='verb'` on every
  card (transition groundwork — see the de-verb-ify dead-end); `MAXRANK` tracks the top rank (rank filter extends
  past 100). `openVerbModal`/`saveVerb`/`deleteVerb` are the #verbModal CRUD;
  custom verbs persist in `jpverbs_custom` and SYNC to the cloud — `saveCustom`
  writes localStorage + schedules a push; `saveCustomLocal` is the no-push variant
  for hydration. The modal also authors the two **completeness** fields — `accent`
  (with a live `pitchHtml` preview, `updateAccentPreview`) and the five `levels` tiers —
  behind a "Pitch accent & leveled examples" `<details id="vfMore">`; `saveVerb` validates
  them with the pure `parseAccent`/`buildLevels`/`isCleanRuby` (each tier's JP must be
  CLEAN RUBY since `renderExample`/Browse-detail `innerHTML` it as `exampleForLevel(v)[0]`)
  and stores them ON the card object (the `custom-verbs` blob). **Phase 2.5: the example text is
  also DUAL-WRITTEN to the sentence store as PRIVATE rows when signed in** — `pushCardExamples`
  (saveVerb) / `deleteCardExamples` (deleteVerb) → `PUT /v1/sentences/card/{rank}`, plus a one-time
  `migrateCardExamples` backfill on sign-in (cloud.js) — so a signed-in card renders its examples
  FROM the store like a built-in (`attachLevels` prefers `state.exampleLevels[rank]`, now populated
  for custom ranks too; the blob's `v.levels` is the offline/anon + pre-write fallback). `accent`
  stays a blob field (`accent`-wins in `attachLevels`). So a UI-authored card reaches built-in
  parity in completeness AND storage — see [CARDS.md](CARDS.md) Recipe C + the leveled-examples
  bullet below.
- **TTS:** `speak(text)` plays the server's Google TTS (`/v1/tts`) via a reused
  `<audio>` when served over http(s) (`HTTP_SERVED`), falling back to
  `speakSynth` (Web Speech) over `file://` or on failure. `TTS_OK` = either path
  available (gates the Audio UI). See the TTS dead-end.
- **Leveled examples:** `attachLevels()` sets `v.levels = state.exampleLevels[rank]` (built-ins;
  custom cards too when signed in — Phase 2.5) after each rebuild, falling back to the card's own
  embedded `v.levels` when the store has no entry (offline/anon/built-in-less-deploy).
  `state.exampleLevels` is the `{[rank]:{N5:[jp,en],…}}`
  model **fetched from the server sentence store** (Phase 2 built-in examples + Phase 2.5 the viewer's
  own private custom-card rows — `GET /v1/sentences?ownerType=card`
  via `features/examples.js` `initExamples()`), cache-hydrated from `jpverbs_examples_cache` at
  boot and rebuilt from the fetch by the pure `sentencesToLevels` adapter (`core/examples.js`);
  degrades to the cache offline. `data/examples.js` is the **seed source** for
  `seed-sentences.ts`, no longer read at runtime (it tree-shakes out of the app bundle).
  `availableTiers(v)` + `exampleForLevel(v, level)` (pure, fallback: exact tier → nearest → `ex`
  → null) drive the answer-side selector (`renderExample`, default tier = `settings.exampleLevel`)
  and the Browse detail modal's level filter. `JLPT_TIERS` is the easy→hard order.
- **Settings (DB-synced):** `settings` ({exampleLevel, furigana, input, audio,
  freeReviewDue}) in
  `jpverbs_settings`, synced as app `settings`. `loadSettings` (migrates old per-key
  prefs), `saveSettings` (persist + `applyFurigana` + push), `renderSettings`
  (Settings-modal controls), `paintPrefChips` (mirror onto the setup chips).
  `applyFurigana` flips `<html data-furigana>` (CSS hides `<rt>` when off).
- **Render:** `showCard`/`reveal`/`grade`/`endSession` (session, `endSession` also
  POSTs to the durable session log), `renderBrowse` (summary cards) +
  `openVerbDetail`/`renderDetailExample` (the detail modal), `renderStats` +
  `renderCardBars`; the chart builders are the pure `core/charts.js`
  (`accuracyMix`/`weekOverWeekDelta`/`boxCounts`/`dailyAccuracySvg`/`pipelineHtml` —
  SVG/HTML strings, no chart library).
- **SRS forecast (study panel):** `reviewForecast(h)` (pure) buckets every
  scheduled card (`box>0`) into time slots for the chosen window (`forecastHorizon`
  ∈ `24h`/`week`/`month`/`year`); overdue folds into slot 0, beyond-window drops.
  `renderForecast` draws the hand-rolled vertical-bar SVG into `#forecastChart` and
  is called from `updateDueBanner` (so it tracks the schedule). The `#fcHorizons`
  toggle is view-only state, not synced. Tests in `test/core.test.ts`.
- **Per-card SRS indicator:** `detailMemoryLine(v)` (Browse detail modal) renders a
  5-segment Leitner track (filled up to the card's box, each lit pip in its
  `BOX_COLORS` tone) + box number + a "next review" chip that flips red ("due now")
  once due. `BOX_COLORS` (index 0=New…5) is shared with the Stats box histogram.
- **Typed mode + audio:** `revealAnswer` (shared show-answer + autoplay) feeds both
  `reveal` (self-graded) and `submitTyped` (typed: `normKana`-compares the kana, sets
  an advisory verdict + `session.suggested`). `bindSingle` wires the Input/Audio
  single-select chips. Prefs persist as `jpverbs_input` / `jpverbs_audio`. (Audio
  playback itself is the TTS bullet above.)
- **Cloud:** `api`, `bootAuth`, `updateAccountChip`, `openAuth`. **Cross-origin**
  (`api()` rebases every path onto `API_BASE` + sends `credentials:'include'`), the
  session lives in a `.wkenhanced.dev` httpOnly cookie. **EIGHT debounced synced blobs** —
  progress (`verbs`), custom verbs (`custom-verbs`), settings (`settings`), Minna (`minna`),
  Self-Talk (`selftalk`), Songs (`songs`), WaniKani (`wanikani`, the WK API token only),
  JLPT (`jlpt`, level + exam date + the daily-checklist record) — all
  built from ONE `createSyncedBlob` abstraction
  ([features/synced-blob.js](src/features/synced-blob.js)): debounced `schedule` →
  `push` (PUT `/v1/progress/{appKey}`) → `pull` (server-wins-on-login, fresh-account
  seed). Each blob supplies only its `read`/`apply` + unique side-effects (custom→`rebuildData`,
  settings→`applyFurigana`+`paintPrefChips`+`renderSettings`, selftalk→phrase-migration+repaint,
  minna→overlay merge, songs→library re-render, wanikani→connect-through-the-gate on a pulled
  token). All eight are declared ONCE in `cloud.js`'s ordered
  **blob registry** (`[{blob,busKey}]` — `busKey:null` for minna/wanikani/jlpt, whose owner
  modules schedule pushes directly via their own save fns instead of the sync-bus; the
  registry is a FUNCTION so the cloud⇄minna import cycle resolves by call time);
  `pullCloud`/`flushQueue`/`initCloud` delegate to the DI'd
  **sync-orchestrator** ([net/sync-orchestrator.js](src/net/sync-orchestrator.js)) so the pull / flush /
  bus-wire sets can never drift. `pullCloud` runs `orchestrator.pullAll()` (each blob isolated — one
  failure can't abort the rest) then the cross-blob finalizers
  (`migrateMinnaDupes`/`rebuildData`/`migrateCardExamples`/`refreshAllViews`). A push that fails
  after the transport's retries enqueues to the **durable offline write-queue**
  ([net/sync-queue.js](src/net/sync-queue.js), dedup by `progress:<appKey>`); `flushQueue`
  (`orchestrator.flushAll()`) replays it on `window 'online'`, on boot (before `pullCloud`), and after
  sign-in, bumping each blob's `lastUpdatedAt` from the replay response; `doLogout` drops it
  (per-account). Each blob tracks the server `updatedAt` and sends it as `baseUpdatedAt` for **409
  optimistic concurrency** (per-blob **merge** reconcile — E1, via core/merge.js; settings stays
  server-wins). Plus `logSession` → `POST /v1/sessions` (durable append-only history, signed-in only;
  idempotency-keyed (E2) → retried + offline-queued, the server dedups by key).
  `maybeShowSignup` (from `endSession`) shows the sign-up nudge after the first
  session, not on first paint.
- **UX helpers (added in the polish pass):** `filterSummary`/`paintSummary`
  (active-filter recap), `setupTopicGroups` (topic disclosure + badge),
  `escapeHtml`, `jishoUrl(jp)` (Jisho.org dictionary deep-link, shown on the
  flashcard answer side + the Browse detail modal; `target=_blank`).
- **A11y:** `setupRoving(container)` gives a chip group a roving tabindex (one tab
  stop, ←/→/↑/↓ + Home/End to move, aria-label from the row's `.filter-label`).
  Wired over every `.chips` + `.topic-inner`; collapsed topic chips leave the tab
  order. Multi-select rows are `role=group` (arrows move focus); single-select rows
  that declare `role="radiogroup"` in the markup become real radio groups (chips
  `role=radio` + synced `aria-checked`, arrows move the selection). See the roving
  dead-end for the radiogroup contract.

Persisted store (`localStorage["jpverbs_v3"]`, synced as app `verbs`):
`{ cards:{<rank>:{attempts:[1|0…],right,wrong,box:0..5,due:<epochMs>}}, sessions:[{t,right,tot}…] (cap 1000, for charts), daily:{"YYYY-MM-DD":{right,tot}} }`.
The capped `sessions` is just for the charts — the durable record is the server's
`study_sessions` table (`POST /v1/sessions` on every session end).
Custom verbs (`localStorage["jpverbs_custom"]`, synced as app `custom-verbs`):
`{ seq:<monotonic rank counter>, verbs:[<verb + {rank, custom:true}>…] }`.
Settings (`localStorage["jpverbs_settings"]`, synced as app `settings`):
`{ exampleLevel, furigana, input, audio, freeReviewDue, recordingsKeep, trimSilence, compareSpeed,
audioPrefs:{<context>:[<token>…]} }` (the Settings page; migrated from the old
jpverbs_exlevel/input/audio keys; `freeReviewDue` defaults on). `audioPrefs` is the audio-unify
per-context voice priority — keyed by the five `AUDIO_CONTEXTS`
(`reviews`/`browse`/`minna`/`selftalk`/`songs`), each an ordered list of tokens
(a specific voice `siri:female` or a kind `kind:native`/`kind:tts`/`kind:user`); a missing/empty
context falls back to `core/audio.js` `DEFAULT_AUDIO_PREFS`. Unknown tokens are pruned on load +
cloud-pull (`settings-store.js` `normalizeSettings` → `core/audio.js` `pruneAudioPrefs`) so a stale
synced blob can't carry a foreign token into the editor/resolver.
Minna state (`localStorage["jpverbs_minna"]`, synced as app `minna`):
`{ notes:{<lesson>:string}, lastLesson:<n>, overlays:{<builtinRank>:{tags,italki,minnaLesson,minnaKey,accent?,tts?}} }`
— the みんなの日本語 dashboard's per-lesson scratchpad PLUS the dedup overlays (Minna words
that map onto a built-in verb). Activated *new* Minna vocab is NOT here — it lives in
`jpverbs_custom` as tagged cards; only built-in-overlap words live here (see the
みんなの日本語 dead-end).
Self-Talk state (`localStorage["jpverbs_selftalk"]`, synced as app `selftalk`):
`{ practice:{lastDay,streak,doneToday} }` — the practice/streak signal ONLY (output reps, not SRS).
**Phrases moved to the server sentence store** (Phase 1 of the unified store): built-ins are public
rows, user-authored phrases are private rows, fetched from `GET /v1/sentences?ownerType=selftalk`
and cached in `localStorage["jpverbs_selftalk_cache"]` (read-through). `data/selftalk.js` is the
seed source, not read at runtime. A pre-store blob's `phrases` are migrated into the store once on
sign-in. See [SELFTALK.md](SELFTALK.md).
Leveled examples (server sentence store; `localStorage["jpverbs_examples_cache"]` read-through):
the `{[rank]:{N5:[jp,en],…}}` model in `state.exampleLevels`, fetched from
`GET /v1/sentences?ownerType=card` on boot and cached. `data/examples.js`
(`EXAMPLES[rank]={N5:[jp,en],…}`) is the **seed source** only — not read at runtime.
Pitch accents (`verbs.js`, static): `ACCENTS[rank] = <Tokyo accent number>` — backfilled
onto built-in cards' `v.accent` by `attachLevels` (Minna cards carry their own).
鰐蟹 WaniKani token (`localStorage["jpverbs_wanikani"]`, synced as app `wanikani`):
`{ token }` — the user's WK personal access token, nothing else. **The WK DATASET is NOT
in this blob** — 9.4k slimmed subjects + assignments + review stats live in the
device-local IndexedDB DB `jpverbs_wanikani` (features/wanikani/idb.js), re-syncable
from api.wanikani.com at any time (full first sync ≈ 30 requests, then incremental via
per-collection `updated_after` cursors kept in the IDB `meta` store).
合格 JLPT state (`localStorage["jpverbs_jlpt"]`, synced as app `jlpt`):
`{ level:'N5'..'N1', examDate:'YYYY-MM-DD', targets?:{wordsPerDay?,grammarPerWeek?},
days:{'YYYY-MM-DD':{<taskId>:1}}, mocks?:[{id,date,level,scores:{vocab,grammarReading,listening},total,notes?}] }`
— the target level, the exam date (default 2026-12-06),
the OPTIONAL pacing targets (defaults `DEFAULT_TARGETS` = 12 words/day + 5 grammar/week
applied at READ via `jlptTargets`, never materialized into the blob so `shouldSeed` stays
honest; clamped 1..99 by `normalizeJlpt`; per-field union with local wins on 409), the
rolling daily-checklist record (pruned to the last 60 days by `normalizeJlpt` — note it
FOLDS day values to 1, so per-day COUNTS can never live in `days{}`; the gap-fill quota
signal is the `added` day-stamp on the cards instead), and the OPTIONAL **mock-test log**
(`mocks[]`, id = `<date>-<level>`, capped at `JLPT_MOCKS_KEEP` = 50, newest first, `total`
always recomputed from the sections — a stored total is a cache. Like `targets` the key is
omitted when empty, and it is **EXEMPT from the 60-day `days{}` pruning**: an old sitting is
the most informative point the readiness view has). 409s MERGE via `mergeJlpt`
(day-record union, mocks union by id with local winning, local scalars win). The JLPT WORD LIST is NOT in this blob or
localStorage — it's the generated `src/data/jlpt.js` module, dynamic-imported once per
session (its own chunk); the JMdict-enriched per-level entries (`data/jlpt-words/<level>.js`)
and the N3 grammar catalog (`data/grammar-n3.js`) are further lazy chunks of the same
pattern. Related card/stat fields: `store.cards[rank].last` = epoch ms of the most recent
grade (stamped in `grade()`, merged with MAX — the 法 row's auto-signal; mergeProgress's
field list is explicit, so a new stat field MUST be added there or 409s silently drop it);
gap-fill cards carry `jlptfill:true` + `added:'YYYY-MM-DD'`; grammar cards carry
`grammar:true` + the durable `grammarId`.
Two auxiliary keys round out the localStorage inventory: `jpverbs_sync_queue` (the durable
offline write-queue — per-account entries, dropped on logout) and `jpverbs_cardex_migrated`
(the one-time card-examples→store migration flag). Device-local UI prefs (`jpverbs_font`,
`jpverbs_theme`, `jpverbs_topic_<panel>`, `jpverbs_signup_dismissed`, `jpverbs_micDevice`)
and the read-through caches (`jpverbs_examples_cache`, `jpverbs_selftalk_cache`,
`jpverbs_selftalk_templates_cache`, `jpverbs_songs_cache`, `jpverbs_grammar_cache`) never
sync; `loadSettings` still migrates the legacy `jpverbs_exlevel`/`jpverbs_input`/
`jpverbs_audio` keys on first load.

## Design system

> **The "Day / Night" redesign is COMPLETE — skin AND layout** (Phases 0–9, 2026-06-17, on the
> `redesign-migration` branch, pending push): an all-sans system (Bricolage Grotesque display + Hanken
> Grotesk body + Spline Sans Mono labels + Zen Kaku Gothic New for Japanese; warm washi-paper light +
> candle-lit warm-charcoal dark). Phases 0–7 reskinned in place + token-aliased; Phase 8 rebuilt the
> per-panel compositions; **Phase 9 fixed the FRAME and finished the match** — the chrome is the mock's
> single-row `.topbar` (brand · inline underline-tabs · theme/settings + round `.avatar`), with the
> load-bearing `#navExtra` speaking-bar dock relocated to a sticky sub-bar; `.wrap` is the 1180/40
> column with a uniform top gap; 歌 Songs is rebuilt as the two-column stage (hero play-card · on-demand
> video · glowing playhead · mined-vocab rail); 独り言 is the daily-5 hybrid (featured card + rail +
> the kept topic browser); the non-verb accents are re-tuned to the warm palette. All verified
> signed-in in both themes.
>
> **The CSS is split per surface + shared kit.** `src/styles/tokens.css` (palette — both themes + the
> prefers-color-scheme fallback) + `base.css` (reset/body/`.wrap`/atmosphere) + `chrome.css`; the SHARED
> core stays in `src/styles.css` (buttons, chips, filters, `.speak-btn`, tap-a-word, global utils +
> motion keyframes), with two shared kits peeled to their own files — **`styles/modals.css`** (the
> overlay/sheet/× + form primitives + Settings rows + voice editor + in-modal `<details>`) and
> **`styles/record-compare.css`** (the record/play/compare + speaking-bar engine UI + the `#navExtra`
> dock trims); then the per-surface `flashcards/browse/stats/minna/selftalk/songs/wanikani.css`. `src/main.js`
> imports them in cascade order: **tokens → base → chrome → styles → modals → record-compare →
> flashcards → browse → stats → minna → selftalk → songs → wanikani → jlpt** (modals + record-compare sit in the
> shared-core slot, after styles.css + chrome.css so Rule A holds; the modal entrance keyframes
> overlayIn/modalPop stay in styles.css since modalPop is shared with the tap-a-word `.word-pop`). The
> mocks stay in [mockups/redesign/](mockups/redesign/) as the visual reference; the full Phase-by-phase
> record is [ROADMAP.html](../ROADMAP.html) (completed redesign record).

**Type-label rule:** uppercase-mono (`--mono`, Spline Sans Mono — the signature) is for SHORT labels
only — filter/stat/section labels, kickers. Longer descriptive strings (chart titles, helper/hint
text) are sentence-case mono so they stay scannable; don't add `text-transform:uppercase` to a
multi-word sentence. (The redesign moved the **tabs** off uppercase-mono onto body-font sentence-case
with an underline-active bar — see `styles/chrome.css`.)

All theming flows through CSS custom properties in `styles/tokens.css`. The redesign **role tokens**
are the source of truth: surfaces `--paper/--raised/--deeper/--base` + `--surf-card/--surf-inset/
--surf-nav/--chip-bg`; ink `--ink/--muted/--faint/--line`; functional `--brand(-deep/-soft/-on)`
(godan), `--reading(...)` (ichidan), `--good(...)`, `--gold` (irregular), `--leech`; shadows
`--lift-sm/md/lg --card-shadow --cta-shadow --inner-hi`; fonts `--display/--body/--mono/--jp`. The
PRODUCTION token NAMES the feature code + the hand-rolled SVG charts already reference are **aliased**
onto these so they reskin for free: `--godan→--brand`, `--ichidan→--reading`, `--irregular→--gold`,
`--paper-2→--raised`; `--jp-font` stays the live token the Settings font switcher rewrites (new
default Zen Kaku Gothic New, `--jp` flows from it). Light/dark is one `data-theme` flip on `<html>`
(+ a `prefers-color-scheme` fallback). Colors are **functional, not decorative** — verb classes
(godan=vermilion/coral, ichidan=indigo, irregular=gold) and the non-verb category accents
(adjective=viridian, noun=ochre, adverb=wine-rose, phrase=taupe — Phase 9 re-tuned to the warm washi
palette) paint the card spine + hanko stamp via `colorClass(v)`; leech=plum, "got it right"=jade. Type is **all-sans** (the Georgia serif + SF-Mono
were removed): `--display` (Bricolage — display/numerals/the revealed meaning), `--body` (Hanken —
UI/prose), `--mono` (Spline Sans Mono — short labels), `--jp` (Zen Kaku Gothic New — all Japanese).
The `.grain` + `.atmos` fixed layers (`styles/base.css`, behind content at z-0) carry the
paper-grain + (light) manuscript-grid atmosphere; depth is **shadow-driven** (`--lift-*`/
`--card-shadow`) in BOTH themes. **The decorative glow was cut back hard (2026-06 — performance +
calmer):** the big background radial "orbs", the per-card glow blobs + their `filter:blur()`, the
night-time CTA `breathe` animation, the no-op card `backdrop-filter`s (the cards are opaque
`--surf-card`, so it only cost GPU), and the prominent dark-mode neon halos are all gone — only
small accent glows (pips, the now-playing equalizer, the chart line) + the frosted nav/modal-overlay
remain. Don't reintroduce a background orb layer or per-element neon halos.

Component contracts you must preserve:

- **`.frow` + `.chips`** is the filter-row layout: a fixed-width label column
  (`.filter-label` at 124px) plus a flex `.chips` track. This is what keeps every
  filter group's chips starting at the same x **and** wrapped chips aligned under
  the first chip. Stacks label-over-chips at ≤640px. Do not revert to a bare
  `.row` with the label as a sibling of the chips — that's what looked misaligned.
  `.chips` is ALSO the roving-tabindex group boundary (`setupRoving`) and the
  source of each group's aria-label (read from the row's `.filter-label`), so keep
  one logical facet per `.chips` track.
- **`.chip` is wired by class + `data-*`** (`makeMultiSelect('.chip.deck',…)`,
  `.bf`, `.jlpt`, `.bjlpt`, `.mode`, `.ord`, `.rpreset`). The JS uses flat
  `querySelectorAll` and ignores DOM nesting — so you can regroup/wrap/collapse
  chip markup freely **as long as each chip keeps its classes + `data-*`**. The
  study picker's secondary rows are wrapped in a `<details class="more-filters">`
  for exactly this reason; the wiring is blind to it. **Active state is a tinted
  wash + colored border + bold (`.chip.active` via `color-mix`), NOT a solid-ink
  fill** — don't revert it; the solid fill made a defaults-laden picker a wall of
  black blocks. `.chip.primary` (Start) and `.btn.srs` stay solid — they're CTAs.
- **`.jlptseg`** is the segmented JLPT control (adjacent chips share borders);
  still multi-select.
- **`.topic-region` / `.topic-toggle`** is the collapsible topic disclosure
  (max-height transition; a `· N` badge counts active chips inside).
- **Icons:** `<svg class="ic"><use href="#i-NAME"/></svg>` referencing the inline
  `<symbol>` sprite at the top of `<body>`. `.ic` inherits `currentColor` + `1em`.
- **Modals scroll, they don't overflow the viewport.** `.modal` caps at `calc(100vh - 40px)` with
  `overflow-y:auto` (the overlay's 20px×2 padding); its `.modal-x` close button is `position:sticky`
  + `float:right` so it stays pinned top-right while the body scrolls (don't revert it to plain
  `absolute` — a tall modal like Settings would scroll the × out of reach). Add long modal content
  freely; it just scrolls.
- **Sticky chrome (`.chrome` > `.topbar` + `#navExtra`)** is the anchored top bar (Phase 9 — the mock's
  SINGLE row, was a two-row `.navbar`+`.tabs`). `.chrome` is the sticky wrapper holding the `.topbar`
  (`.brand` left · the tabs INLINE as `.nav .tab` underline-active links, keeping `.tab`+`data-tab` so
  `initTabs` is unchanged · `.top-actions` right = theme/settings `.icon-btn` + the round gradient
  `.avatar` account button) **over** the `#navExtra` speaking-bar dock — a frosted sub-bar that
  `minna.js`/`selftalk`/`songs-shadow` fill via `createSpeakingBar` (`:empty`→hidden), relocated here
  out of the old centered slot but with the SAME id/class so its wiring + the `.nav-extra .speaking-bar`
  trims (now in `record-compare.css`) are unchanged. The account button is `#accountBtn` (id + click
  wiring + `updateAccountChip` kept) — `updateAccountChip` now renders the user's INITIAL (via
  textContent) signed-in / a muted person glyph signed-out, with the email in the `title` (no more
  innerHTML interpolation of the email). Transient sync/feedback is the auto-clearing `#syncStatus`
  pill (`setSyncStatus`). Import/Export live in the Settings modal's "Backup" row. No `<header>`/`<h1>`.
  **DEV-ONLY extra:** `updateDevRoadmapLink()` (cloud.js, called from `updateAccountChip`) injects a
  `#devRoadmapLink` "Roadmap" `.icon-btn` (the `#i-list` glyph) into `.top-actions` (before `#settingsBtn`)
  that opens the repo-root [ROADMAP.html](../ROADMAP.html) (the consolidated backlog hub) in a new tab —
  gated on `import.meta.env.DEV` **and** the signed-in email ∈ `VITE_DEV_EMAILS` (default: the dev account),
  removed on sign-out. It's dead-code-eliminated from the prod bundle (verified: 0 occurrences in `dist`);
  `ROADMAP.html` + the `/study-app/mockups/` galleries are served on `:5173` by a `configureServer`
  middleware in [vite.config.js](vite.config.js). The internal backlog is deliberately NOT served in prod —
  exposing it there would need a real owner-gated route, not just the navbar gate.

## Things that look like bugs but aren't (DEAD-END WARNINGS)

- **The API is CROSS-ORIGIN — every call must go through `API_BASE`, not a relative
  `/v1`.** The app is its own container at `wkenhanced.dev`; the API is at
  `api.wkenhanced.dev`. `const API_BASE = import.meta.env.VITE_API_BASE` (dev
  `http://localhost:3000`, prod `https://api.wkenhanced.dev`, baked by the Dockerfile arg);
  `api()` fetches `API_BASE+path` with `credentials:'include'`, and the TTS + Minna
  `<audio>` srcs prepend it too. The session cookie rides because the two are **same-site**
  (`Domain=.wkenhanced.dev`, `SameSite=Lax`). **Minna native audio is cookie-gated**, so its
  `<audio>` sets `crossOrigin='use-credentials'` — without it the cookie isn't sent and the
  audio 401s; the server answers `/v1/audio/native` with an origin-scoped
  `Allow-Credentials` (never `*`). **Gotcha that bit us once:** the `store`→`state.store`
  module-split rename also rewrote the string `cache:'no-store'` → `'no-state.store'` (the
  hyphen is a word boundary), making every `api()` fetch throw an invalid-`RequestCache`
  TypeError that surfaced only signed-in. Server side of all this: the credentialed-CORS
  branch + cookie `Domain` in [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md).
- **The 合格 JLPT tab's daily checklist mixes AUTO and MANUAL tasks on purpose — don't
  "unify" them.** Auto rows (WK reviews / deck due / gap-fill adds / speak) read a live
  signal each render and can't be un-ticked (the signal owns the truth); when one flips
  done it's written THROUGH to `days[today]` (persistDone) so the 14-day heatmap is plain
  recorded data, not a re-derivation (yesterday's live signals are gone). Manual rows
  (listen/textbook) have no reliable in-app signal — Songs progress has no per-day
  timestamps, and a Shadow take marks the SHARED selftalk practice signal, so "listening
  done" can't be auto-derived without new plumbing. Two wave-1 additions follow the same
  contract: the 語 gap-fill row is AUTO off the `added` day-stamps on the cards (a real,
  re-readable signal), and the 法 grammar row is **CONDITIONALLY auto** (the leech-row
  precedent) — manual with an add-grammar nudge until grammar cards exist, then auto off
  `grammarReviewedToday` (the per-card `last` grade-stamp vs local midnight). The WK row
  renders a Connect affordance (excluded from the ring denominator) when no token; WK
  signals arrive via `ensureWkData()` + `onWkData` (wanikani/index.js) so the tab never
  blocks paint on the WK cache read. There is deliberately NO separate "JLPT streak" —
  the tab surfaces the existing review + speaking streaks; a third streak semantic over 8
  heterogeneous tasks was judged mush.
- **The mock-test log's three sections are the N1–N3 answer sheet, and a mock PASSES only by
  clearing the total AND every sectional minimum.** `MOCK_SECTIONS` (文字・語彙 / 文法・読解 / 聴解,
  60 each, 180 total) is the score report N1/N2/N3 actually issue; **N4/N5 report only TWO sections**
  (言語知識・読解 out of 120 + 聴解 out of 60), which this shape cannot represent — hence `MOCK_LEVELS`
  gates the form to N1–N3 and the card says so. Each mock stores its own `level` and is judged
  against `MOCK_PASS[level]`, so an N4 paper sat on the way to N3 keeps its own verdict in the
  history. The load-bearing rule is the SECTIONAL minimum: 55/60/15 clears N3's 95-point total and
  still fails outright, which is exactly the case the verdict card exists to make visible — don't
  "simplify" `mockVerdict` into a total comparison. The pass marks are transcribed from the official
  JLPT scoring rules, not derived; re-check them against jlpt.jp before trusting a borderline
  verdict. `mocks[]` is EXEMPT from the `days{}` 60-day pruning (see the persisted-store block).
- **The 模試 form's draft is mirrored into a module-global on every keystroke, on purpose.**
  `renderJlpt()` rebuilds `#jlptBody.innerHTML`, and it fires asynchronously (the WK dataset
  landing via `onWkData`, a lazy chunk resolving) — without `S.mockDraft` a re-render mid-entry
  silently ate a half-typed sitting. The draft holds RAW strings (clamping mid-typing fights the
  user; `normalizeMock` clamps once, on save) and is cleared by `closeMockForm()`, which
  `wireJlpt()` also calls so a freshly-wired panel starts closed. Relatedly, the form is
  deliberately absent from the panel's `change` handler — a `change`-triggered re-render would blur
  the field the user is still in. Edit keys on the mock's id (`<date>-<level>`), so re-dating an
  edited sitting MOVES it: `mock-save` drops both the old id and the new one before re-inserting,
  or the edit forks into two rows.
- **The gap-fill source token is `jlptfill`, NOT `jlpt` — the obvious name is TAKEN.**
  `jlpt` is the LEVEL facet (`.chip.jlpt`, `cfg.jlpt`, the segmented N5–N1 control); a
  source chip named `jlpt` would collide with `makeMultiSelect('.chip.jlpt')` wiring and
  `TOKEN_FACET` routing. Per-level slicing tags are `jlpt-n3` etc. (routed → source by
  `tokenFacet`, labeled "N3"), mirroring the `wk-l<n>` pattern.
- **The N3 grammar catalog and `grammar.json` are SEPARATE generated artifacts sharing ONE
  id vocabulary — don't merge them and don't hand-edit either.** `data/grammar.json` is the
  GiNZA *tagger* catalog (38 N5/N4 points, regenerated from `sentence-nlp/patterns.py`);
  `data/grammar-n3.js` is the *curriculum* (81 N3 points + content, regenerated by
  `tools/grammar-n3/build.mjs`). The build cross-checks ids against the tagger catalog —
  an exact collision is an error unless the point genuinely IS the same pattern (then the
  id is deliberately shared); near-collisions (hazu vs hazu-ga-nai) are fine and warned.
  `grammarLabel()` falls back gracefully for ids the tagger doesn't know, so Browse's
  grammar facet and the curriculum coexist on one id space.
- **`compactLink` drops a FALSY `ordinal` from `/v1/sentences` wire links — every consumer
  keying on ordinal must default absent → 0.** The server compacts `ordinal: 0` away
  (established wire convention; Self-Talk/card consumers never read it). The grammar
  annotations adapter keys its token map `<pointId>:<ordinal ?? 0>` for exactly this;
  without the default, every point's FIRST example silently loses its tap-a-word tokens.
- **`saveVerb` rebuilds the card object on edit — machine-set provenance fields must be
  carried through explicitly.** The modal form doesn't edit `minna`/`minnaKey`/`italki`/
  `song`/`wanikani`/`wkId`/`jlptfill`/`added`/`grammar`/`grammarId`/`tts`; the edit path
  copies them from the previous card (custom-cards.js). Dropping one orphans the card from
  its source: dedup re-adds it, the source facet loses it, a grammar card loses its content
  lookup. Add any NEW machine-set card field to that carry-through list.
- **The 鰐蟹 WaniKani tab bypasses BOTH the `api()` transport AND the localStorage cache
  convention — deliberately, don't "fix" either.** (1) `features/wanikani/api.js` fetches
  `api.wanikani.com` with a plain `fetch` + `Authorization: Bearer <user's WK token>`:
  the WK API is CORS-enabled for client-side apps, wants no cookies, and must not be
  rebased onto `API_BASE` — routing it through `net/transport.js` would send
  `credentials:'include'` to a third party and break under the API_BASE rebase. It has
  its own 429/Retry-After handling. Our server NEVER sees WK data; only the token blob
  (`jpverbs_wanikani` localStorage + the `wanikani` progress app key) syncs. (2) The WK
  dataset caches in **IndexedDB** (`features/wanikani/idb.js`, DB `jpverbs_wanikani`) —
  the one exception to "server-backed lists go through `createReadThroughResource`":
  9.4k slimmed subjects ≈ 10-15 MB, which localStorage's ~5 MB quota can't hold, and the
  incremental `updated_after` cursor model doesn't fit the fetch-all read-through shape.
  It's a device-local cache, never the source of truth — "Disconnect" wipes it and a
  reconnect rebuilds it from WK in ~30 requests.
- **Category / Type / Transitivity / Topic / Status / Source chips are SIX AND'd
  facets, not one OR'd pool** (this changed — older docs/commits describing a shared
  pool, or four/five facets, are stale). A chip's facet is derived from its token via
  `TOKEN_FACET` (`tokenFacet`), not from markup, so the chips still carry class
  `.deck`/`.bf` + `data-deck`/`data-filter`. "Godan + Motion" = `godan AND motion`
  (intersection); tokens within one facet OR. `cfg`/`bcfg` hold
  `cat`/`type`/`trans`/`topic`/`status`/`source` arrays (empty = no constraint).
  `source` (provenance) matches the `minna`/`italki`/`song`/`wanikani` card flags and
  the `mnn-l<n>`/`song-<id>`/`wk-l<n>` tags. Don't reintroduce a single shared array — that was the old confusing
  behavior. (`passes` treats a *missing* facet array as no-constraint too, so older test
  cfgs without `source`/`cat` still pass.)
- **The single "All" chip is a master reset** that clears all four facets at once
  (not just its own row), and shows active when every facet is empty. Exactly one
  per panel — keep it that way. `wireFacets` returns a `paint()` fn that deep-links
  (`startDueSession` → status:['due'], `studyLeeches` → status:['leech']) call to
  resync the chips after mutating the config directly.
- **Alignment needs the `.chips` wrapper, not just a fixed label width.** A fixed
  `.filter-label` width alone still lets wrapped chips break to x=0 behind the
  label. The two-track `.frow>.filter-label` + `.frow>.chips` structure is the fix.
- **The topic-disclosure badge is kept current by a MutationObserver** on the
  region's class attributes — not just click handlers — so programmatic selection
  changes (Reset / Study-leeches / due-session) update the `· N` count too.
- **Per-card accuracy bars are deliberately capped** to the worst 20 with a
  show-all toggle (`renderCardBars`, `CARDBARS_CAP`). They're sorted worst-first;
  an uncapped full deck is a ~2600px wall of mostly-mastered bars. Don't "restore"
  the full list as the default.
- **`updateAccountChip` / `updateDueBanner` set `innerHTML`** to embed icons, so
  they no longer use `textContent`. The account email is **`escapeHtml`'d** before
  interpolation — keep that (it's user-controlled → XSS otherwise).
- **The inline SVG sprite must hide its size via INLINE STYLE, not width/height
  attributes.** There's a global `svg{display:block;width:100%;height:auto}` rule for
  the charts. CSS beats presentation attributes, so the old
  `<svg width="0" height="0" style="position:absolute">` sprite got `width:100%`
  applied — and since `height:auto` on a viewBox-less SVG resolves to 0 in Chromium
  but ~150px in Firefox/Safari, the absolutely-positioned sprite became a full-width
  invisible overlay across the top of the page in those browsers, eating clicks and
  text selection on the header (reported as "can't select the buttons/text at the
  top"; invisible in a Chromium preview). Fix: dimensions live in the sprite's inline
  `style="...width:0;height:0;overflow:hidden;pointer-events:none"` (inline style
  outranks the type selector). Keep them there; don't move them back to attributes,
  and don't widen the global `svg{}` rule.
- **A "no border" edge in a `border-collapse` table must be `0`-width + `transparent`
  colour, NOT `border:none`/`hidden` — Safari paints `none`/`hidden` edges anyway.** The
  みんなの日本語 vocab table (`.mn-vocab`, collapsed borders) separates word groups with a
  `border-top` on word rows and zeroes the word↔controls edge. With `border-top:none` (and even
  `hidden`), **WebKit/Safari still painted that edge** using the cell's border *width* +
  *currentColor* (≈ `--ink`, near-white in dark mode) → a phantom white line under every word
  that Chromium never drew (so it's invisible in the Chromium preview — verify table-border
  changes in Safari, or reason from computed `borderTop`). `none`/`hidden` change only the
  *style*, leaving width+colour to paint. The fix: base every cell edge at
  `border:0 solid transparent` and re-add ONLY the real separator (`.mn-vocab td` word-row
  `border-top:1px solid var(--line)`); the first row + `.mn-rec-row` zero their top edge to
  `0 solid transparent`. Don't "tidy" those back to `none`/`hidden`. **Update (Day/Night
  redesign):** the みんなの日本語 vocab list is now the `.vrow` CSS **grid** in
  [styles/minna.css](src/styles/minna.css) — the `.mn-vocab` `<table>` + its border rules were
  removed, so this trap no longer touches the vocab list (a grid can't paint phantom edges). It
  now guards only the remaining `border-collapse` table, practice-history `.mn-ph`, which zeroes
  its no-border edge with `border-top:0` (width 0); the principle stands for any future one.
- **Never let `*/` appear *inside* a CSS comment** — e.g. a class-glob like `.prompt-*/.answer` or
  `.verb-*/.rank` in a `/* … */` "moved to surface X" pointer. The `*/` closes the comment EARLY; the
  leftover text + the following comment collapse into a garbage selector that **silently swallows the
  next real rule**. This deleted the base `.btn{ …border-radius;background;border;box-shadow… }` rule —
  every button went square, dev AND prod (minifiers honour `*/` too) — until the 2026-06 fidelity audit;
  three such landmines existed in [src/styles.css](src/styles.css). Keep a space between the `*` and the
  `/` (`.prompt-* /.answer`). `bun run build` does NOT warn, so after a CSS edit confirm a touched rule
  actually *applies* (computed style), not just that the file parses. See the fidelity-audit section in
  [ROADMAP.html](../ROADMAP.html) (completed redesign record).
- **`songs.css` `.ring` is SCOPED to `.sc-ring .ring` — don't unscope it.** A bare global `.ring` (the
  40×40 conic coverage ring) collides with the decorative seal rings (`.hanko .ring`, `.lesson-seal
  .ring`, which set only `inset` + inherit the 40×40 size/fill), painting a mis-sized, offset circle
  inside the flashcard hanko and the みんなの日本語 lesson seal. The coverage ring is only ever used as
  `.sc-ring > .ring` (library.js), so the scope is safe; the seal rings rely on it staying scoped.
- **The icon sprite is inline + offline-first.** Don't replace it with Tabler/
  Lucide-via-CDN — icons would break offline, defeating the single-file premise.
  Add new glyphs as `<symbol>`s. (`-filled` style names don't exist here; these
  are hand-drawn stroke paths on a 24-grid.)
- **Google Fonts is the only external dependency and degrades gracefully.** Offline
  you get system fonts for the Japanese text; the app still fully works. Don't add
  a hard dependency on it.
- **Custom verbs are keyed by a monotonic rank, never reused.** New custom verbs
  get `rank = ++seq` (seq starts at 100, persisted in `jpverbs_custom`), so deleting
  one never frees its rank for reuse — `store.cards[rank]` progress can't collide
  with a future verb. Editing keeps the rank (and progress); deleting drops the
  orphaned card stat. `DATA` is a `let` (not `const`) so `rebuildData()` can swap it
  in place — don't change it back to `const`, and don't cache `DATA`/`MAXRANK` in a
  closure that won't see the rebuild. Custom verbs sync to the cloud under a SEPARATE
  app key (`custom-verbs`) from the progress blob (`verbs`) — `saveCustom` schedules
  the push (so add/edit/delete all propagate, including removals); `saveCustomLocal`
  is the no-push write used by `pullCustomCloud` to avoid a re-push loop.
- **Empty JLPT levels are disabled, not hidden** (`annotateJlptChips`, run at boot
  and on any DATA change). The 100 frequent verbs are almost all N5–N4, so N2/N1
  start disabled; adding a custom N2 verb re-enables N2. Roving nav recomputes its
  navigable list each keypress so it skips disabled chips — keep that if you touch
  `setupRoving`.
- **Roving tabindex groups by `.chips`/`.topic-inner` container and matches only
  `button.chip`.** `setupRoving` deliberately excludes the Font `<select class="chip">`
  and the rank number inputs (focus on a non-chip returns -1 from `indexOf` →
  arrows fall through to native behavior), so they stay normal tab stops. It has
  **two flavours, chosen by the container's role:**
  - MULTI-select facet rows (Category/Type/Transitivity/Topic/Status/JLPT, topics)
    are `role=group` TOOLBAR semantics — arrows MOVE FOCUS only; Space/Enter toggles
    via the existing click handler. No `aria-checked` here.
  - SINGLE-select rows (Study type, Test direction, Input, Audio, Order) opt into
    `role="radiogroup"` IN THE MARKUP (the `<div class="chips" role="radiogroup">`).
    `setupRoving` then makes each chip `role="radio"`, mirrors `aria-checked` from
    its `.active` class, makes the checked chip the lone tab stop, and arrows MOVE
    THE SELECTION (radio behavior) by calling the chip's own `click()`. To add a
    new single-select row, add `role="radiogroup"` to its `.chips` container — that
    flag is the ONLY switch; the JS keys off it. Don't add it to a multi-select row.
    `aria-checked` is kept in sync SYNCHRONOUSLY via a `click` listener on the
    container (the chip's click bubbles up after its own handler flipped `.active`)
    plus a class MutationObserver for programmatic selection (`paintPrefChips` /
    deep-links). Don't reintroduce a per-chip-only observer — its microtask lag let
    the AT read stale `aria-checked` right after an arrow keypress.

  Collapsed `.topic-inner` chips are forced to tabindex -1 via a MutationObserver on
  the region's `open` class; if you change how the topic disclosure toggles (e.g. to
  `display:none`), re-check that observer still fires.
- **Typed grading is advisory, and only grades a READING.** `submitTyped`
  compares the typed input against `v.read` — or, in conjugation mode, against the INFLECTED
  reading (`session.conj.kana`), which is the answer being tested there — and *suggests* a
  grade (green/red
  verdict + a `.suggested` ring on the matching button), but the user still records
  it via 1/2 or a click — so a typo or an unjudged-meaning recall can be overridden.
  Don't make it auto-advance on match. The compare is
  `normKana(romajiToKana(input)) === normKana(target)`: `romajiToKana` first folds
  any romaji to hiragana (greedy longest-match Hepburn + wāpuro variants:
  si/shi, tu/tsu, hu/fu, zi/ji, sya/sha, double-consonant→っ, n'/nn/trailing-n→ん),
  then `normKana` folds katakana→hiragana, strips spaces/separators, and unifies
  long-vowel marks. **Romaji support is intentional (per request)** — it relaxes the
  old "normKana is deliberately NOT romaji-aware" stance. Anything not in the romaji
  table (including already-kana) passes through `romajiToKana` untouched, so a kana
  IME and a romaji typist share one code path. It feeds only the advisory grade,
  never the SRS schedule, so over-permissiveness is harmless. Tests in
  `test/core.test.ts`.
- **Audio is unified behind one player + a per-context voice picker (audio-unify Phase 2).**
  `speak(text, context)`/`speakWord(v, context)` are thin wrappers over `playItem(item, context, btn)`
  ([features/audio.js](src/features/audio.js)): it builds the item's available variants (synth from
  the text; `native` from a vnjpclub path; `user` from the newest take), resolves which to play via
  `resolveVariant(context, available, settings.audioPrefs)` ([core/audio.js](src/core/audio.js)), and
  plays synth on a PUBLIC `<audio>` (`/v1/audio/tts?voice=`) but native/take on a CREDENTIALED
  `<audio crossOrigin='use-credentials'>` (`/v1/audio/native`, `/v1/audio/recordings`). Contexts (`AUDIO_CONTEXTS`, core/audio.js):
  `reviews` (flashcards), `browse`, `minna`, `selftalk`, `songs`. The user orders voices per context in Settings → Voice
  priority (specific voices or kinds); the server falls through to the default clip when a chosen
  voice isn't pre-generated, so naming `siri:female` is always safe. Errors cascade (gated → synth →
  speechSynthesis). In Minna the vocab word button offers the full native/synth/your-take catalog;
  the conversation button is native-only. The Settings Voice-priority editor's per-row ▶ auditions a
  voice via `previewVoice(voiceId, btn)` (also [features/audio.js](src/features/audio.js)), which
  forces a specific synth voice on the sample word (`PREVIEW_SAMPLE`, 食べる) PAST the resolver. **Per-item
  voice cycle (③):** `playItem` takes an `opts.cycle` flag — an **Alt/Shift-click** (`cycleMod(e)`,
  passed by every play handler) walks that item's `variantOrder(available)` (pure, core/audio.js:
  native → each synth voice → user) via a module-level per-item cursor seeded at the resolver's
  default, so the click steps to the *next* voice and the button `title` names it. Preview + cycle are
  the two places playback bypasses `resolveVariant`'s default pick. The editor also dims synth voices
  the server hasn't pre-generated (④): `fetchAvailableVoices` (features/audio.js) reads
  `/v1/audio/variants` once per modal-open and the picker annotates "· not generated" (fails open). **Phase 3 (not yet done):** generalize the
  record-compare "▶ native" into "▶ reference" against any chosen voice. Follow-ups (preview, per-item
  cycle, availability hinting, Phase 3) are tracked in [ROADMAP.html](../ROADMAP.html) — audio-unify
  shipped; the residual doc-reconcile is a low-priority item there.
- **TTS prefers the server's Google proxy, falls back to Web Speech.** The synth tier of the player
  above: `speak()` ultimately
  plays `/v1/audio/tts?text=<reading>&voice=<chosen>` (legacy `/v1/tts` still works) via a reused
  `<audio>` when served over http(s)
  (`HTTP_SERVED`); over `file://` or on play/network failure it falls back to
  `speakSynth` (Web Speech, `SPEECH_OK`). `TTS_OK = HTTP_SERVED || SPEECH_OK` gates
  whether the Audio UI shows — so audio is on by default when served, even on
  browsers with poor/no speechSynthesis voices. The reading is the answer in both
  directions, so the speaker button lives inside the revealed `.answer` panel (and
  on Browse cards where the reading is already shown) — never on the flashcard
  prompt. The server endpoint caches text→audio (so don't worry about replays); see
  the server's `/v1/tts` (uses the existing `googleTts` service). **What we SEND to TTS
  is `ttsText(v)`, not the raw reading:** Google derives pitch accent from the written
  form, so a bare kana reading is accent-ambiguous for homographs (橋 "bridge" vs 箸
  "chopsticks" are both はし). `ttsText` sends the **kanji headword** (`v.jp`) when it has
  kanji so Google applies the dictionary accent; `v.tts` overrides an ambiguous single
  kanji (e.g. 角→つの). The visible reading is always `v.read`. `speakWord(v)` wraps it.
  **`/v1/tts` is storage-backed + Apple-voice-preferred (server side).** The server now serves
  `/v1/tts` from a three-tier cache (in-process → our storage → Google), persisting the Google
  clip on first hit and preferring a **locally pre-generated `.m4a`** when one exists — so the
  same `speak()` call gets the nicer voice for any text we've pre-generated by
  `wk-enhanced-api/scripts/generate-tts.ts` (default `--engine say` = macOS `say` with a
  Japanese **Siri** system voice, the highest quality; or the `jp-tts` Swift CLI for a specific
  installed voice). **Example
  sentences are now spoken too:** the answer-side example (`#exSpeak` in `flashcard.js`), the
  Browse detail modal (`#dExSpeak` in `browse.js`), and the みんなの日本語 grammar/lesson example rows
  (`ttsSentenceBtn` in `minna.js`) carry a `.speak-btn.sm` that plays `speak(plainText(jp))` —
  `plainText` (core/text.js) strips ruby to the base sentence, the exact string `/v1/tts` keys on,
  so the client request and the pre-gen driver agree.
  **Audio pitch is approximate by design — don't "fix" it by sending kana.** Reading audio sends
  the KANJI headword (`ttsText`), never the kana (verified: a homograph like 橋 sends `橋`, not `はし`).
  But an isolated word still can't realize a 尾高 (odaka) accent — the drop lands on a *following*
  particle that isn't there — and no TTS engine (Siri/Google) can be *told* an accent; it predicts
  one, badly for isolated homographs (橋/箸/端). So the AUDIO accent is approximate and the visual
  `pitchHtml` overline/drop is the source of truth. The lever, if audio accent ever needs to
  improve, is a carrier particle (e.g. speak `橋が`, not `橋`) — a coordinated `ttsText`/driver change
  + full regen, deliberately NOT done. In sentences the accent is already contextually correct.
- **Pitch accent is shown VISUALLY (`pitchHtml`), because the TTS audio can't be pitch-
  controlled.** A card's `accent` number (0=heiban, 1=atamadaka, k=drop after mora k) →
  `pitchHtml(reading, accent)` splits the reading into morae (`splitMora`) and draws an
  overline over the high morae + a step-down at the drop, on the flashcard answer, Browse
  card, and detail modal. No accent → plain reading. This is the source of truth for pitch;
  the kanji-to-TTS trick above only nudges the audio. **Where `accent` comes from:** Minna
  cards carry it from the lesson JSON item / dedup overlay; the 100 built-ins get it from
  the `ACCENTS` map (rank → number) in `verbs.js`, backfilled by `attachLevels`
  (`if(v.accent==null) v.accent=ACCENTS[v.rank]` — a card's own accent wins). Both sets are
  model-generated → proofread; a fix is a one-number edit. Custom verbs have no accent
  unless the user sets one.
- **Flashcard grading keys.** Before reveal: Space/Enter flip the card (typed mode:
  Enter submits instead, bound on the field). After reveal: **Space / Enter / 2 =
  correct; X / 1 = wrong.** The global keydown handler bails when `#answerInput` is
  focused so typing isn't hijacked. (This replaced the old "Enter accepts the
  auto-suggested grade" — Enter now always means correct, per request; the typed-mode
  suggestion ring is still shown, and X/1 overrides it to wrong.)
- **Browse cards are SUMMARY only — clicking opens the detail MODAL** (`openVerbDetail`,
  `#detailModal`), not an inline expand. The old `.detail`/`.open` inline expansion is
  gone (its CSS was removed too). Inside the modal, Mnemonic/
  Trap/Examples are collapsible `<details>` (don't dump everything at once); Examples
  are JLPT-level-filtered via a selector defaulting to `settings.exampleLevel` — that
  filter is a LOCAL view, it does NOT write the global default (study vs. browse).
- **Furigana is a global CSS flip** (`<html data-furigana="off">` → `rt{display:none}`),
  driven by `settings.furigana`/`applyFurigana()`. It affects every `<ruby>` at once
  (examples, browse modal). Don't gate furigana per-element; toggle the attribute.
- **Tap-a-word lookup overlays spans on the ruby from GiNZA token offsets — the offsets index the
  PLAIN text, the render is ruby, so the two are reconciled by a PURE helper, not by parsing HTML.**
  `overlayTokens(furiganaSegments, tokens)` ([core/annotate.js](src/core/annotate.js)) emits a
  `<span class="extok" data-lemma data-pos data-reading>` per (tappable) token, keeping each ruby
  segment WHOLE inside the token covering its start (a reading can't be split) and slicing plain runs
  only at token boundaries (which are valid UTF-16 boundaries per the server's offset contract, so a
  non-BMP kanji 𠮟 is never torn). Tokens arrive via `?annotate=1` on the sentence fetch and ride a
  THIRD element on the example tuple — `state.exampleLevels[rank][tier] = [jp, en, {furigana, tokens,
  grammar}]` (`sentencesToLevels`) — and `phrase.tokens`/`.furigana` for Self-Talk (`sentenceToPhrase`).
  Old code reads `[0]`/`[1]` unchanged; a stale cache lacking `meta`/`tokens` falls back to plain ruby
  (no key bump — Decision 4). The tap is a stateless delegated handler on a STABLE container
  (`wireWordTaps`, [features/word-lookup.js](src/features/word-lookup.js)) reading lemma/POS/reading
  off the span, so per-card/per-render `innerHTML` swaps don't break it; it resolves the LEMMA against
  `state.BUILTIN_RANK_BY_JP` + `state.DATA` → `openVerbDetail`, else `jishoUrl(lemma)`. **`plainText`
  now also strips these spans** so `#exSpeak`/`#exCopy` reading the rendered `innerHTML` still get the
  bare sentence (and the TTS key, derived from span-free curated text, is unchanged). word-lookup
  imports `openVerbDetail` from browse and browse imports `wireWordTaps` — a runtime-only (event-time)
  cycle, fine like cloud⇄minna. Renders on the flashcard answer side, Browse detail, and Self-Talk
  built-ins (user-authored private phrases aren't parsed offline → no tokens → plain ruby).
  **Tap units are now WHOLE WORDS (parser merge pass shipped — don't re-split here):** the tap units
  used to be GiNZA's raw morphemes (勉強 + する; 食べ+させ+られ+た), but a post-tokenization **merge pass**
  in `sentence-nlp/parse.py` (`merge_groups`) now coalesces a content word + its inflectional tail into
  one unit (勉強する; 食べさせられた→食べる; 読んでいる→読む) — see SENTENCE_STORE_PHASE4.md §8.0. The client
  overlay + `resolveCard` needed NO change: they already render/resolve whatever tokens+lemmas they're
  served, and the coarser merged lemmas (dictionary form) resolve to a deck card or Jisho the same way.
  So tapping selects the word a learner looks up. **Local dev is re-seeded; PROD still serves the old
  split-C tokens until the prod re-seed (`seed-annotations.ts`) runs** — tracked in ROADMAP.html. Don't
  add a client-side re-tokenizer; granularity is a parser concern.
- **The grammar-filter labels come from a GENERATED catalog, not a hand-kept list — don't add a
  parallel one.** [src/data/grammar.json](src/data/grammar.json) (`[{id,label,jlpt}]`×38) is dumped by
  `sentence-nlp/patterns.py` (`python3 patterns.py`) — the SAME catalog whose detectors write
  `sentence_tag(kind='grammar')` — so the client labels can't drift from the server tags. Regenerate it
  after any catalog change; never hand-edit grammar.json. [src/data/grammar.js](src/data/grammar.js)
  wraps it (`grammarLabel`/`grammarJlpt`/`orderGrammar`/`GRAMMAR_CATALOG`), and `SELFTALK_GRAMMAR` is now
  the 6 teaching ids deriving labels from it (one vocabulary). The Browse **Grammar** facet is a
  CARD-level filter even though grammar is a sentence property: `cardGrammar(v)` unions a card's
  per-tier `meta.grammar`, `cardMatchesGrammar` ORs the selection, and `renderBrowse` ANDs it with
  `passes(v, bcfg)`. The chip row (`#bGrammarChips`) renders only ids present in the deck (N5-first),
  hides when none, and is NOT a `.bf` facet chip (no `data-filter`) so `wireFacets` ignores it — it has
  its own delegated handler + `bGrammar` state. Note `paintSummary` takes an ARRAY of recap parts (not
  a string) — `filterSummary(bcfg)` returns that array; push extra parts onto it.
- **`store.sessions` is capped (1000) and is JUST for the charts.** The durable,
  never-pruned session history is the server's `study_sessions` table — `endSession`
  POSTs there (signed-in). Don't "fix" the cap by unbounding the synced blob (it'd
  grow the 1 MB `verbs` PUT); the DB log is the answer for lifetime history.
- **The leveled example sentences in `examples.js` are MODEL-GENERATED** (fanned out
  across agents, then format-validated: valid JSON, all 5 tiers, balanced `<ruby>`,
  English present; a sample was hand-reviewed for grammar/furigana). They're solid
  but not human-proofread end to end — if you spot an error, fix that
  `EXAMPLES[rank][tier]` entry (it's plain data). **`examples.js` is now the SEED SOURCE
  for the server sentence store, not read at runtime** — so a fix only reaches the app
  after re-running `wk-enhanced-api/scripts/seed-sentences.ts` (idempotent; re-seed
  refreshes the changed row's furigana/translation in place). The deck fetches examples
  from `GET /v1/sentences?ownerType=card` and caches them (`jpverbs_examples_cache`).
  The headword should appear in every sentence and tiers should escalate N5→N1; keep
  that if you regenerate. The example shows on the ANSWER side only (the sentence reveals
  the reading via furigana, so it would spoil the reading-recall question if shown on the prompt).
- **The app now supports multiple part-of-speech categories — prefer "word"/"card"
  in new copy.** It was born a verb trainer (the dataset global is still `VERBS`, the
  data file is `verbs.js`, and all 100 *built-ins* ARE verbs), and renaming those
  internals would be churn for no gain — keep them. But user-added cards can be any
  `cat` in `CATS` (`verb/adjective/noun/adverb/phrase`), the user-facing identity is
  generic (日常日本語 / "Japanese Trainer"), and the verb-specific UI is now
  conditional: the Type + Transitivity filter rows carry `.verb-only` and hide via
  `syncVerbRows` when the `cat` facet excludes verbs; the add-card modal's Type/
  Transitivity fields show only for the categories that have them (`syncVerbFields`).
  Adjectives reuse the `type` field for the い/な split (`i-adj`/`na-adj`); nouns/
  adverbs/phrases have no subtype. Don't reintroduce verb-only framing in headers/
  empty-states, and don't make Type/Transitivity unconditional again. **Conjugation
  drills SHIPPED** (the third test direction — see the dead-end below). **Still not
  done** (tracked in ROADMAP.html): proofed built-in non-verb
  content (the dataset is still 100 verbs — categories are a model/UI capability that
  users populate).
- **Conjugation mode is a THIRD `cfg.mode`, and it FAILS CLOSED.** `cfg.mode` ∈
  `meaning`/`reading`/`conjugation`; the third is a PRODUCTION drill (dictionary form → an
  inflected form) over the same session machinery, with its own `cfg.forms` chip row
  (session-local, floor of one — deselecting the last form is a no-op, or the deck would
  empty with no way back). The paradigms live in the pure `core/conjugation.js`, which
  returns `{kana, display}` or **null**: an unknown `type`, a headword that isn't a
  dictionary form, or a form that would be grammatical nonsense is simply NOT DRILLED.
  Don't "fix" a null by guessing — teaching an exam learner a wrong 活用 is the failure
  mode the module exists to prevent. Both `buildDeck` AND `updateDeckCount` apply the
  `isConjugable` narrowing (the count must never promise cards the session won't deal),
  and a card with no answerable form falls back to the default meaning face. Encoded
  exceptions, all pinned by `test/conjugation-core.test.js` against the real dataset:
  行く takes って (never いて) and its compounds inherit it; ある's negative is the suppletive
  ない and it has no potential; 来る's display re-attaches 来 (the 2-char drop would eat the
  stem kanji); いい swaps its stem to よ **by suffix**, so かっこいい→かっこよかった; and
  `POTENTIAL_SKIP` drops the potential of verbs that are already potential forms (できる/
  使える/買える/待てる) or whose potential is a different verb (分かる→分かれる "to part").
  **The answer face suppresses pitch marks**: `v.accent` describes the DICTIONARY form and
  inflection moves the drop (たべる[2]→たべて[1]), so painting it on a conjugated reading
  would teach a wrong pitch. Typed mode grades the INFLECTED reading (`session.conj.kana`),
  not `v.read`.
- **Reviewing a card early never promotes it; free study reschedules only ALREADY-DUE
  cards, and only when the setting allows.** Two study kinds (`cfg.kind`): *SRS review*
  serves only due cards (`buildDeck` intersects `isDue`) and reschedules them; *free
  study* is practice over any deck. The gate lives in `grade`:
  `if(isDue(v.rank) && (session.kind==='srs' || settings.freeReviewDue)) scheduleCard(...)`.
  So: a NOT-due card is never rescheduled (the `isDue` guard — reviewing early can't
  bump a card up); a due card is rescheduled in SRS always, and in free study iff the
  `freeReviewDue` setting is on (default on — "Free study advances due cards" in
  Settings). Both kinds always append to `attempts`/`right`/`wrong` (accuracy + leech
  detection cover free study too) — only the schedule is conditional. Don't
  "simplify" `grade` back to an unconditional `scheduleCard`. Legacy sessions saved
  before the kind-split have no `kind` and count as SRS in the stats. The "Review due
  cards" banner just sets `cfg.kind='srs'` + `status:['due']`.
- **The review forecast is front-loaded by design** — Leitner intervals top out at
  16 days (`BOX_DAYS`), so EVERY scheduled card is due within ~16 days. The `month`
  view (the current month's day count, 28–31 slots) therefore captures the whole
  real schedule; the `year` view (12 monthly slots) collapses everything into slot 0
  until the deck grows long intervals it can't reach. That's accurate, not a bug —
  don't "fix" it by faking spread. `24h` (24 hourly slots) is mostly a single "now"
  spike for the same reason (nothing comes due sub-daily). EVERY slot is drawn as a
  faint background box (via `forecastWindow(h,base)`'s fixed `slots` count) so the
  full breakdown is visible even where nothing is due — that's the point of the
  "draw all boxes" pass; don't go back to only emitting bars for non-empty buckets.
  Labels are date-aware (weekday names for week, month names for year). New/unseen
  cards (`box===0`) are excluded — they're not scheduled yet.
- **Browser-preview tooling reloads/recreates the tab on capture**, which resets
  in-memory state (active tab defaults back to Flashcards; `cfg`/`bcfg` filter
  selections are lost — only localStorage persists). To verify a *transient* state
  (a specific tab, applied filters, expanded topics, seeded stats), set it up and
  assert via DOM `eval` rather than relying on a follow-up screenshot. Seed stats
  data by mutating `store` + calling `renderStats()` in an eval.
- **みんなの日本語 tab (`#panel-minna`) is account-gated + fetched at runtime —
  intentionally NOT offline-first.** Unlike the rest of the app, the Minna dashboard
  loads content live from `/v1/minna/*` (signed-in only), so the copyrighted textbook
  material never ships to anonymous visitors. `renderMinna()` (lazy on tab activation)
  shows a sign-in gate when `!account`, else fetches the lesson and renders
  vocab/grammar/examples/conversation + native-audio buttons (`/v1/audio/native`, one
  reused `<audio>` with `crossOrigin='use-credentials'` so the session cookie authorizes
  it cross-origin — see the cross-origin dead-end above). **Tap-to-lookup on Minna sentences
  (Phase 3):** the grammar/example/conversation sentences are ALSO gated `sentence` rows in the
  store (`source='minna'`, public=0), GiNZA-parsed offline; the `/v1/minna/lessons/{n}` route
  attaches each one's `tokens` + structured `furigana` (matched by plainText hash), and `view.js`'s
  `mnSentenceJp` renders `overlayTokens` (tappable words via `wireWordTaps` on `#mnBody`) when they're
  present, else plain `rubyHtml` — so Minna gets the same merge-quality tap-a-word as the flashcards.
  The lesson JSON stays the CONTENT source; the store supplies only the NLP layer (don't move Minna's
  text/structure into the store — only its sentences are rows). **Vocab "activation"
  REUSES the custom-verb system, not a new data path:** each word becomes a tagged
  (`みんなの日本語` + `mnn-l<n>`, plus `iTalki` for words flagged `italki:true` in the lesson
  JSON) DICTIONARY-form custom card via `loadCustom`/`saveCustom` +`seq`, so it joins the
  deck/SRS/Browse/Stats and syncs under `custom-verbs` for free — idempotent via a stable
  `minnaKey` AND self-updating (re-activation patches metadata like the iTalki tag onto an
  existing card without losing its rank — see `minnaActivationStatus`), marked
  `minna:true`/`italki` (Browse shows a みんなの日本語 badge over CUSTOM via `provenanceBadge`;
  iTalki words add a table badge). The `source` filter facet (みんなの日本語 / iTalki /
  per-lesson) studies any of these slices from the normal deck. **A word that already exists
  as a built-in verb is NOT duplicated** — activation writes a provenance *overlay*
  (`minnaStore.overlays`, keyed by built-in rank) that `applyMinnaOverlays` merges onto a
  copy of the built-in (keeping its examples/mnemonic/progress), and `migrateMinnaDupes`
  converts pre-dedup twins on boot. Genuinely-new words become custom cards carrying
  generated `levels`/`mnem`/`tip`/`accent` from the lesson JSON (so they reach parity with
  built-ins — same `renderExample`/`pitchHtml` paths). The only NEW synced blob is
  per-lesson NOTES + the overlays + the Phase-2 conversation **clips** under the `minna` app
  key (its own `createSyncedBlob`, `minnaBlob`, beside its state in minna.js). Content source of truth is the server's
  `data/minna/lesson-<n>.json` (git-tracked, curated from the `scripts/scrape-minna.ts`
  draft). **Phase 2 — record-your-voice + compare to native audio — has SHIPPED (MVP).**
  **Full feature doc (architecture + data model + roadmap): [MINNA.md](MINNA.md).**
- **独り言 Self-Talk (`selftalk.js`) is anon-READABLE but account-gated for AUTHORING, and reuses the
  record-compare engine via a reserved partition.** Reading is open to anon (built-in phrases are
  public rows in the server **sentence store**, fetched via `GET /v1/sentences?ownerType=selftalk`
  with a `jpverbs_selftalk_cache` read-through — NOT shipped in the bundle at runtime; `data/selftalk.js`
  is the seed source). **Authoring requires an account** (your phrases are PRIVATE store rows written
  via `POST/PUT/DELETE /v1/sentences`; the "Add phrase" affordance gates on `account` and anon sees a
  sign-in nudge) — so does *recording*. This is NOT the old Minna copyright gate (reading stays anon);
  don't gate reading. A pre-store `selftalk` blob's `phrases` migrate into the store once on sign-in;
  the blob now carries only `{practice}`. The phrase `id` is the store `ext_id` (`st-*`/`usr-<uuid>`),
  preserved verbatim — it's the record-compare itemKey + practice key.
  Recordings reuse the generic engine with a **reserved `SELFTALK_SCOPE = 90000`** (the engine's
  `scope` → the server's opaque numeric `lesson` param; Minna uses 1–50) + a **synth-only reference**
  (no native clip → ▶ reference is a Siri/Google voice from the phrase text, resolved with the
  `selftalk` audio context). Don't reuse `90000` for a Minna lesson. **`#stBody` is a category→topic
  GRID that drills into ONE topic at a time** (`renderGrid`/`renderTopic`, `stTopic` view state);
  clicking a cell swaps `#stBody` in place so it stays the stable attach-once record-compare
  container — drill-in, NOT a modal or stacked accordions. **The single-render invariant still holds**:
  because only one view (the grid, one topic, or the "Today's focus" cell's rotation) renders at a
  time, a phrase's `.rec-control` never double-renders for the same `(scope,itemKey)` — "Today's
  focus" is therefore a pinned **grid cell** that drills into `todaysSet`, not a toggle stacked over
  the other sections (the old trap). Topic = a `sentence_tag(kind='topic')` (legacy `scene`-tag
  read-fallback); CATEGORY is derived from the `SELFTALK_TAXONOMY` registry, never stored.
  The **speaking-mode singletons + `setOnTakeSaved` hook are shared
  module-global** with Minna: only one tab is active at a time, both leave-hooks call the idempotent
  `exitSpeakingMode`, the `visibilitychange` handler is **guarded on `#panel-selftalk` being active**
  (so it doesn't fight Minna's), and the take-saved hook is **filtered to `SELFTALK_SCOPE`** (so a
  Minna take can't mark Self-Talk practice). Phrases carry **no `accent`** — sentence-level pitch is
  meaningless (`pitchHtml` is per-word); the furigana + synth prosody carry the reading.
  **Slot-swap TEMPLATES: structure is DB-sourced (Slice 1); used combos lazily materialize (Slice 2).**
  The template STRUCTURE (skeleton `jp` with `{slot}` markers + `slots`/`fillers`) lives in the server
  `sentence_template` table, FETCHED via `GET /v1/templates` (read-through cache
  `jpverbs_selftalk_templates_cache`); [data/selftalk-templates.js](src/data/selftalk-templates.js) is
  now the **seed source** (scripts/seed-sentences.ts Pass 3), no longer imported at runtime. A template
  has no single fixed text/hash/furigana, so it's NOT a `sentence` row — hence its own table (with its
  own `public_template` view + a read path mirroring the `getSentences` privacy gate + a pinned breach
  test). `realizeTemplate` (pure) substitutes a picked filler per slot CLIENT-SIDE, then DERIVES
  reading/plainText from the now-fully-ruby string — so a realized template plays via the same synth
  path (`/v1/audio/tts` on plainText, lazily cached) and **record-compares keyed on the SKELETON id /
  template ext_id** (one practiceable item; the reference text tracks the current realization, patched
  onto the control's `data-text` on each swap). **Slice 2 — `maybeMaterialize(id)`** (fired from the
  ▶ play handler + the take-saved hook) POSTs `{picks}` to `POST /v1/templates/{id}/realize` the first
  time a SIGNED-IN user plays/records a combo (deduped per session by `comboKey`, fire-and-forget,
  anon stays on lazy TTS). The server RECONSTRUCTS the realization from the stored skeleton + picks and
  upserts a PUBLIC `sentence` row (`source='template'`, `owner_type='template'` link, idempotent by
  hash) with the template's curated grammar copied on — so de-dup/export/grammar-search/TTS-pre-gen
  cover it. **Materialization does NOT change record-compare's skeleton-keying**, and a realization
  still renders PLAIN ruby (no GiNZA tap-to-lookup) until the **next offline NLP parse** picks up the
  now-public combo rows (no Python on prod → the lag is by design). Full doc: [SELFTALK.md](SELFTALK.md);
  design + the settled open questions: [../ROADMAP.html](../ROADMAP.html) (store: slot-swap templates).
- **歌 / Songs (`features/songs.js`) is anon-readable starters + account-gated BYO, and ASSEMBLES
  existing primitives (sentence store, vocab-activation, tap-a-word, the grammar catalog, the
  YouTube IFrame embed) — don't build parallel machinery. A song's lines are `sentence` rows
  (`owner_type='song'`); the full surface — **Library · Add · Read · Listen · Shadow · Mine** +
  line-timing — is shipped (all four modes; see (7) below). Load-bearing dead-ends: (1) **the Add-flow analysis is a SERVER LLM pass**
  (`POST /v1/songs/analyze`) — the client NEVER analyzes lyrics; it's `ANTHROPIC_API_KEY`-gated, so
  the Add screen shows an "analysis isn't available yet" state (graceful 503) until the key is
  provisioned, and Library/Read/Mine keep working without it. (2) `GET /v1/songs/{id}` returns each
  line as an **AssembledSentence** (grammar in `tags.grammar`, EN in `translations.en`, tokens in
  `annotation.tokens`, timing on `link.clip_start_ms`); `songs.js` `normalizeLine` flattens it into
  `{text,furigana,en,grammar,tokens,clipStartMs,ordinal}` that `core/songs.js` + the render operate
  on — keep that seam (don't read the nested shape in render code). (3) **line ordinal = array index**
  (server returns lines sorted + contiguous; `compactLink` omits a falsy 0). (4) Mining reuses
  vocab-activation: a word → a tagged dictionary-form custom card (`song:true`, tags
  `['歌','song-<extId>']`) under the **Source facet** — `song` + `song-<id>` are routed to `source` in
  `core/facets.js`, and `annotateSourceChips` now shows the row for songs too (hide-until-Minna-OR-
  songs); the `歌` chip is in both pickers. (5) `runAnalyze` must read the lyrics `<textarea>` BEFORE
  `render()` (render rebuilds it from `add.lyrics` — reading after gets the empty rebuilt field). (6)
  the **YouTube IFrame Player API** (`features/songs-youtube.js`) is a NECESSARY external dep
  (embedding is the copyright posture) loaded lazily; it degrades gracefully (Read+Mine work if it
  never loads). **(7) Listen + Shadow are now built** (all four modes ship). Listen is a per-line
  dictation **stepper** (cloze ⇄ full-line, advisory grading via `normKana`/`romajiToKana`, Reveal
  self-check, per-session count); cloze blanking is the pure `clozeBlanks`+`clozeLineParts`
  (`core/songs.js`, offset-slices a blank token sitting mid plain furigana run); mode content renders
  into a stable `#sgContent` so a step re-render never re-mounts the player; the video is **masked**
  in Listen (kept playing for audio) so a lyric-burned MV can't spoil the dictation. Shadow reuses the
  **record-compare engine verbatim** (`SONGS_SCOPE = 80000`, itemKey `songLineKey(extId,ord)`, the
  `'songs'` audio context = synth TTS reference / full rig) + a per-line by-ear **YouTube-slice**
  ("▶ original", timed lines only — iframe audio isn't decodable). **`playSlice` now uses its OWN
  timer** (a slice from a paused player no longer lets the `PLAYING→onTime` poll clobber its stop) and
  takes a `rate` for slow replay. **`setOnTakeSaved` is now MULTI-LISTENER** (Self-Talk + Songs both
  subscribe, each filtering by its scope — registering one can't clobber the other); a saved Shadow
  take marks the shared day-streak (`applyPractice` on `state.selftalkStore.practice`). **(8) The `songs`
  synced progress blob SHIPPED** (2026-06-16, the 6th `createSyncedBlob`, app key `songs`,
  `{progress:{"<extId>":{starred,shadowed,lastMode}}}`, modeled on the Self-Talk blob): `markShadowed`
  is no longer a stub — it records shadowed ordinals, so the library card **ring is shadowed-lines %**
  (`songProgress`, core/songs.js), per-line **stars** live in Read, and reopening a song **restores its
  last mode**. PROGRESS ONLY — line text/furigana/timing stay server-authoritative (same split as
  Self-Talk's `{practice}`); `mergeSongs` unions the starred/shadowed sets on a 409. **Full doc:
  [SONGS.md](SONGS.md).**
- **Record-and-compare (`record-compare.js`, the generic engine; Minna + Self-Talk glue feed it):
  the conversation has ONE whole-dialogue MP3, so
  per-line native compare slices it — it does NOT have per-line audio.** A line's native
  compare plays `[startSec,endSec]` of the cached conversation MP3 via `currentTime` + a
  `timeupdate` stop (Media-Fragments `#t=` is unreliable on `<audio>` — don't switch to it).
  Clips resolve `line.clip` (lesson JSON) ∪ `state.minnaStore.clips[lesson][lineIdx]` (synced,
  set by the in-app marker) — **store wins** (`resolveClip`). A line with no clip still
  records; only its native compare is gated (a hint shows). **The record/compare/clip
  delegated handlers attach ONCE to the persistent `#mnBody`** (`body.dataset.recWired` /
  `clipWired` guards) because `renderMinnaLesson` re-renders `body.innerHTML` on
  activation/clip-save — re-attaching per render would stack listeners and double-fire. The
  handlers read all context (lesson, itemKey, native src, clip) off the rec-control's
  `data-*`, so they need no closure over the lesson. **The per-item rec-controls live in
  `#mnBody`, but the GLOBAL speaking bar (toggle + mic picker + speed + bias) is docked in the
  navbar `#navExtra` slot**, built by the SHARED controller `createSpeakingBar`
  ([features/speaking-bar.js](src/features/speaking-bar.js)) that みんなの日本語, 独り言 Self-Talk and
  歌 Songs ALL drive (one definition, not three copies): `mount()` fills the slot — or clears it when
  the surface's `shouldShow()` is false — and `clearSpeakingBar()` empties it on tab-leave/gate, so
  it floats at the top while you scroll the lesson. Its delegate (`wireSpeakingControls`, speed chips
  + bias slider) attaches once to `#navExtra` — SEPARATE from `wireRecordCompare`'s `#mnBody`
  delegate; don't move the speed/bias handlers back onto `#mnBody` (the controls aren't there
  anymore). The toggle + mic picker are wired per-render by `mount()` (the slot's innerHTML is
  replaced each lesson render); each surface's `renderNavSpeaking`/`songNav` wrapper is now just a
  `createSpeakingBar({…}).mount()` call passing its show-gate, re-render, and reserved take `scope`.
  The browser-tab-hidden mic release is the shared `releaseMicIfHidden(isActive?)` (Self-Talk/Songs
  pass a panel-active guard so they don't fight みんなの日本語's unguarded primary handler). **Recordings are PRIVATE on the server**
  and played via one reused `<audio crossOrigin='use-credentials'>` (gated, cross-origin) —
  the same cookie-gated-audio path as the native-audio button. The **binary upload goes through the
  resilient transport** (`api(path, { rawBody: blob, contentType, retry: true })`, E3) — `rawBody`
  sends the blob verbatim with its `Content-Type` instead of JSON. It carries a client idempotency
  key (`?idem=<uuid>`, E2) so the server dedups a replay, which is what makes the transport's
  retry/backoff safe (a retried upload returns the prior take, never a duplicate). The multi-MB blob
  is deliberately NOT offline-queued (localStorage is the wrong store); list/delete use `api()` too.
  Retention is the `recordingsKeep` setting (default 3, 1–20), sent as `keep` and enforced server-side.
  **The compare player has ▶ you / reference / →you (seq) / both / loop** (audio-unify Phase 3 / ⑤):
  the **reference** generalizes the old native-only target to ANY voice — it resolves via
  `resolveVariant('minna', refAvailable(ctx), prefs)` (per-context priority picks the default), and
  **Alt/Shift-click** the ▶ reference button cycles the item's voices (native → Siri F/M → Google,
  `referenceVariants`/`cycleReference`, persisted on the control's `data-ref`). `refUrl` maps a variant
  to the gated native clip OR the public `/v1/audio/tts?voice=` (both play on the one reused
  credentialed `<audio>` — the public TTS endpoint is under the study-app CORS allowlist); each
  rec-control carries the item's synth `text` (`data-text`) so a clipless line / native-less word can
  still compare against synth. `seq`/`both`/`loop` compare against the selected reference; **both**
  overlays reference + take on the two separate `<audio>` elements with a 2-count barrier (one-shot; loop is
  seq-only). Playback speed is `settings.compareSpeed` (synced, snapped by `clampSpeed` to
  {0.5,0.75,1}) applied via `applySpeed` (`playbackRate` + `preservesPitch`) on every compare
  play; the segmented control lives in the navbar-docked speaking bar. **Volume is normalized** so native + take
  play at ~equal loudness: `levelFor` (RMS over each spoken window) → `normGains` (attenuate-only,
  since `<audio>.volume` can't boost — the louder is brought down to the quieter, floored at 0.3)
  → a `volume` passed through `playRange`. The **▶ both balance slider** (`compareBias`, view-only,
  in the speaking bar) is a `you ⟷ native` crossfader applied ON TOP of the gains, **only** for
  ▶ both (`applyBothVolumes`, live via `bothPlaying`); single playback ignores it. The take-list
  ▶ resets `volume` to 1 (raw listen, not normalized). **A cross-lesson "Practice history"
  overview** (`practiceHistorySection` in `minna.js`, fed by `GET /v1/minna/practice` → DB
  `recordingSummary`) renders a collapsed section in the lesson view: per-lesson distinct-item +
  take counts + last-practiced date, current lesson highlighted, hidden until the first recording.
  It's fetched fresh each lesson render and **fails open** (offline → no section); a take saved
  after render won't show until the next render/switch (an upload only re-renders its own control).
  The route has its **own path** (`/practice`, not under `/recordings/`) so the `/recordings/{id}`
  param route can't shadow it.
- **Every compare playback plays a SPEECH WINDOW, not the whole file — this is what makes ▶ both
  line up.** The native MP3 has built-in lead/tail silence; overlapping it raw on your
  (already-tight) take would start the native speaker late, so ▶ both wouldn't align. `playRange`
  (a generic windowed `<audio>` player: seek to `start`, stop at `end` via a `timeupdate`
  listener — Media-Fragments `#t=` is unreliable) plays `[start,end]` from `windowFor(url, clip)`
  → `speechWindow`, which runs **the same `findTrimBounds`** as the save-time trim over the
  decoded buffer (clip-sliced first for a conversation line) with a **small EQUAL lead pad on
  both sources** (`COMPARE_TRIM`) so the spoken onsets coincide. Windows are computed off the
  decoded buffers (`resolvedBuffers`) and memoized (`windowCache`); before a buffer decodes,
  playback falls back to the clip / whole file. Don't revert native/take playback to raw
  whole-file or raw-clip — the windowing is the alignment. The take-list ▶ (`playTake`) still
  plays the WHOLE take (a quick listen, not a compare) and tears down any windowed `takeStop`
  first.
- **The compare waveforms use a `<canvas>`, the deliberate exception to "charts stay hand-rolled
  SVG".** `paintCompareWaveforms` (per-render hook from `wireMinnaLesson`; also called by
  `resetControl` after save/delete) decodes the newest take + the native audio via
  `fetchAudioBuffer` — a **credentialed** `fetch` (the gated-audio path; plain `fetch` 401s) →
  `decodeAudioData`, promise-cached per URL — then crops each to its `windowFor` SPEECH WINDOW
  (the same region playback uses, so what's drawn is what plays) and `waveformPeaks` (pure) →
  canvas (you=`--godan`, native=`--ichidan`). A per-sample waveform is the wrong shape for SVG
  and the bytes are right there to decode, so canvas is correct here — don't "fix" it to SVG.
  Decode **fails safe**: offline / Safari-can't-decode-opus (a non-trimmed take) / 404 → the
  waveform simply doesn't draw, and the `<audio>`-driven compare buttons keep working. A single
  rAF loop (`tickCursors`) moves an overlay cursor for whichever element is sounding, mapping its
  `currentTime` over the **active play window** (`activeNativeWindow`/`activeTakeWindow`). Canvas
  is sized to fixed `WAVE_W/H` (not `clientWidth`) so it paints correctly even inside a closed
  `<details>`.
- **"Speaking mode" keeps ONE mic stream open; the record controls only render while it's
  on.** Acquiring/releasing the mic per take renegotiates the macOS input each time — that
  hitches (and re-triggers the AirPods HFP switch). So `enterSpeakingMode()` opens one
  persistent `liveStream` and keeps it; `startRecording` spins a `MediaRecorder` on it with
  **no `getUserMedia` per take**; `onstop` does NOT stop the stream. `minna.js` renders the
  vocab/line rec-controls only `if (isSpeakingMode())`; the **toggle button lives in the
  navbar-docked speaking bar** (`#navExtra`, the shared `createSpeakingBar` controller) and
  re-renders the lesson on click (which repaints both the body rec-controls and the navbar bar). Don't revert
  `startRecording` to per-take `getUserMedia`, and don't render controls outside speaking mode.
  `exitSpeakingMode()` stops the recorder + releases the stream. **Navigating out
  of the lesson context auto-exits speaking mode** so the mic doesn't linger: `chrome.js`
  `initTabs` tracks the active tab and fires a `leaveMinna` handler when switching AWAY from the
  みんなの日本語 tab → wired in `main.js` to `minna.js`'s `onMinnaHidden()` → `exitSpeakingMode()`;
  a chapter-chip click also calls `exitSpeakingMode()` before re-rendering. The stale
  speaking-mode DOM is never seen because returning to the tab re-renders fresh via `renderMinna()`.
  Don't move the tab-leave hook into `chrome.js` directly (it'd make chrome import a feature) —
  keep it a `handlers.leaveMinna` callback like the per-tab renders. **Changing the BROWSER tab
  (or minimizing) also exits** via a `document` `visibilitychange` listener (`handleBrowserTabHidden`,
  attached once in `initMinna`) — those in-app hooks don't fire on a browser-tab change. That path
  DOES re-render the lesson itself (`renderMinnaLesson(lastLesson, #mnBody)`), because returning to
  the browser tab — unlike an in-app tab activation — does NOT re-run `renderMinna()`, so without
  the re-render the toggle/controls would show a stale "speaking" state after the mic was released.
- **The mic picker pins a `deviceId` ON PURPOSE — it's the fix for AirPods dropping to
  hands-free.** macOS switches AirPods to low-quality HFP the instant any app opens *their*
  mic; the persistent stream is acquired with an explicit non-AirPods
  `getUserMedia({audio:{deviceId:{exact}}})`, so the AirPods input is never activated. The
  chosen device is **device-local** (`localStorage jpverbs_micDevice`), NOT in the synced
  `settings` blob — a deviceId is per-browser/machine and meaningless on another device; don't
  move it into `settings`. Labels are empty until permission is granted (browser privacy), so
  the picker shows "Microphone N" until the first stream, then re-enumerates. A vanished
  stored id is dropped → system default (one-shot `{audio:true}` retry if `exact` fails).
- **Silence trim is DELIBERATELY forgiving — clipping real speech is worse than leaving a
  little dead air.** `findTrimBounds` (pure/tested) uses four guards: an **adaptive** threshold
  (`max(floor, peakRMS·ratio)`, not a fixed absolute one) so it tracks the speaker's level; a
  **robust peak** (the 95th-percentile window RMS, `peakPct`, NOT the raw max) so one
  impossibly-loud window can't inflate the threshold; a **sustain gate** (`minRunMs`, ~30 ms)
  so an edge only counts as speech when energy stays up for a real syllable's worth, not a
  click; and a **generous asymmetric lead pad** (~160 ms vs ~140 ms tail) so voiceless/aspirated
  onsets — ひ [çi], ふ [ɸɯ], the breathy start of 引きます — survive even though they sit BELOW
  the vowel's RMS (the sustained run starts at the vowel; the lead pad reaches back over the
  consonant). Don't "tighten" it back to a fixed threshold, a raw-max peak, or a symmetric
  pad — the asymmetric pad fixed the bug that ate 引きます's ひ, and the robust-peak + sustain
  gate fixed a **laptop trackpad-click** recording (a mechanical click impulse at the very
  start/end was inflating the threshold AND anchoring the edges, so nothing trimmed and quiet
  onsets clipped). `maybeTrim` mixes to mono and re-encodes 16-bit PCM **WAV** (no in-browser
  opus encoder for an `AudioBuffer`; short clips stay under the 2 MB cap). Gated by
  `trimSilence` (default on) and **fails safe**: decode error / no sustained run above
  threshold / <150 ms result all return the ORIGINAL blob. The server's recording
  content-type allowlist includes `audio/wav` (+ a `.wav` ext mapping).


## Change log

The blow-by-blow per-commit change log that used to end this file was **cut in the 2026-07
doc overhaul** — it had drifted (pre-split filenames like `web/verbs-core.test.ts`, "no test
suite yet" claims) and duplicated two better sources. For the shipped record, read
[ROADMAP.html](../ROADMAP.html) (completed items, filterable, per surface); for the raw
history, `git log --oneline -- study-app/`. The pre-extraction single-file era lives in
`7fea5e3`/`f2bb4d8` and the server docs; the removed log itself is in git history at tag-time
`2f0da20` if you ever need the narrative version.
