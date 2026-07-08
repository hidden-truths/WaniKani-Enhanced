# study-app test suite

Vitest + happy-dom (see `package.json`; no vitest.config — defaults). Run with
`bun run test` from `study-app/` (`bun run test:watch` to iterate). Every file imports the
REAL `src/` modules — there are no snapshot fixtures of app code, so a broken export/import
or module cycle fails loudly at collect time. Three tiers:

1. **Pure-core tests** — DOM-free logic through the real module graph.
   [core.test.ts](core.test.ts) is the original suite (SRS/facets/kana/forecast/streak/
   charts/text + the built-in-dataset invariants: 5 well-formed example tiers + a numeric
   accent per built-in; it also covers `core/songs.js`). Per-subsystem siblings:
   [jlpt-core.test.js](jlpt-core.test.js), [grammar-core.test.js](grammar-core.test.js)
   (includes catalog invariants over the REAL generated `data/grammar-n3.js`, so a bad
   content regen fails here), [wanikani-core.test.js](wanikani-core.test.js),
   [record-compare-core.test.js](record-compare-core.test.js),
   [conjugation-core.test.js](conjugation-core.test.js) (the drill paradigms + their encoded
   exceptions, swept over the REAL 100-verb dataset — a mistyped `type` fails here).
2. **Render/glue tests** (`*-render.test.js` for each tab + [custom-cards.test.js](custom-cards.test.js),
   [speaking-bar.test.js](speaking-bar.test.js)) — the layer pure tests can't reach and
   `bun run build` can't catch: render dispatch, delegated ACTIONS tables, store round-trips,
   wire-once guards. They drive the REAL feature modules over a happy-dom DOM.
3. **Infrastructure tests** — the sync stack in isolation:
   [transport.test.js](transport.test.js), [sync-queue.test.js](sync-queue.test.js),
   [synced-blob.test.js](synced-blob.test.js), [sync-orchestrator.test.js](sync-orchestrator.test.js),
   [cache.test.js](cache.test.js), [resource.test.js](resource.test.js),
   [cloud-migrations.test.js](cloud-migrations.test.js).

## Conventions (follow these when adding a test)

- **Hermetic `vi.mock` stubs for cross-cutting collaborators only.** Render tests stub the
  modules that would drag in the whole app or the network — typically `synced-blob.js`
  (inert `{schedule,push,pull}`), `deck.js` / `browse.js` / `custom-cards.js` (jump/repaint
  entry points as `vi.fn()`), and `cloud-core.js` (`api` resolving `{}`, `account: null`).
  Everything else under test is real. Don't mock `src/core/*` — the point is exercising it.
- **localStorage is a Map-backed `vi.stubGlobal` stub** (happy-dom's own storage leaks
  between files). Clear the bag in `beforeEach`.
- **Reset wire-once guards per test.** Delegated handlers attach once behind a
  `dataset.*Wired` flag on the panel; tests rebuild the DOM per test, so clear the flag
  (e.g. `panel.dataset.jlWired = ''`) or the fresh DOM never gets handlers.
- **Reset the `state` hub fields you touch in `beforeEach`** (`state.store`, `state.DATA`,
  the per-feature stores) — the hub is module-global and persists across tests in a file.
- **Real lazy chunks are fine.** The generated `data/jlpt.js` / `data/grammar-n3.js`
  dynamic imports are local files — render tests await `ensureJlptMap()` etc. for real
  rather than stubbing them, which keeps the generated artifacts under test.
- **No network, ever.** Anything that would fetch goes through a stubbed `api` /
  read-through resource; tests must pass offline.

When you add a feature: pure logic gets a case in its `*-core` file (create one per the
pattern above if the subsystem is new); new glue (an ACTIONS entry, a store round-trip, a
navigation epoch) gets a case in the tab's `*-render` file; a new synced blob gets covered
by [synced-blob.test.js](synced-blob.test.js) semantics for free but its merge fn needs a
case in [core.test.ts](core.test.ts) (or its subsystem core file) and its registry entry is
exercised by [sync-orchestrator.test.js](sync-orchestrator.test.js)'s integration block.
