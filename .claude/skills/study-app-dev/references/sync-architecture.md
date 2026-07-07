# study-app sync architecture

How per-user data moves between localStorage and the server, and how conflicts and
offline periods are survived. Read this before touching anything under `study-app/src/net/`,
`features/cloud.js`, `features/synced-blob.js`, or any blob's store module. To ADD a new
synced data type, don't improvise from this file — follow the `add-synced-blob` skill
(this file is the map; that skill is the procedure).

## The moving parts

```
feature save*()                    (e.g. saveSettings, saveJlpt)
   │
   ├─ bus-keyed blobs:  sync.<busKey>()          src/sync-bus.js (no-op until cloud registers)
   └─ off-bus blobs:    <x>Blob.schedule()        called directly by the owner's save fn
   │
   ▼
createSyncedBlob                                  src/features/synced-blob.js
   schedule() → debounce (1200ms) → push()
   push(): PUT /v1/progress/{appKey}  body = { data, baseUpdatedAt? }
     ├─ 2xx  → record updatedAt, drop any queued copy
     ├─ 409  → reconcile(): merge() union + one re-push, else server-wins
     └─ fail → enqueue { key:'progress:<appKey>' } in the offline queue
   │
   ▼
net/sync-queue.js     durable localStorage FIFO (jpverbs_sync_queue)
net/sync-orchestrator.js   pullAll / flushAll / wireBus over the registry
features/cloud.js     declares the registry ONCE + owns bootAuth/pullCloud/flushQueue
```

`api()` itself (`src/net/transport.js`) adds the transport tier: API_BASE rebase,
`credentials:'include'`, per-attempt timeout, idempotency-aware retry with backoff
(GET/PUT/DELETE retry by default; POST only with `{retry:true}`), and — crucially for
409s — it attaches the parsed JSON body to the thrown error as `.body`, which is how
`reconcile()` reads the server's current `{ data, updatedAt }` without a second
round-trip.

## The SyncedBlob contract

`createSyncedBlob({ appKey, read, apply, afterPull, shouldSeed, onOffline, merge, debounceMs })`
(`src/features/synced-blob.js`) — every synced blob is one of these. The parts:

- `read()` — the local document to PUT (e.g. `() => state.store`).
- `apply(data)` — server-wins write of local state, NO re-push. Must guard null/empty
  itself; return `true` if usable (records `lastUpdatedAt`, runs `afterPull`), `false`
  to fall through to the fresh-account seed (push local up).
- `afterPull(data, opt)` — side-effects after apply (`rebuildData`, repaints,
  migrations). `opt.reconcile === true` when called from a 409.
- `shouldSeed()` — when the server has nothing: seed the cloud from local? Default yes;
  `wanikani` seeds only once a token exists, `jlpt` only once the user touched the tab
  (defaults are never materialized, so seeding an untouched blob would push noise).
- `merge(local, server)` — optional 409 reconciler; see below.
- Push status surfaces through `setSyncStatus` (`'saving…'` / `'✓ synced'` /
  `'⚠ offline'`) — the `#syncStatus` pill.

## The registry (the ONE place blobs are declared)

`features/cloud.js` declares the ordered registry the orchestrator derives everything
from — pull order, the flush queueKey→blob map, and the bus wiring can therefore never
drift (they used to be three hand-maintained lists; a drift where a blob flushes but
never pulls causes permanent false 409s on that device). Two properties matter:

- **It is a THUNK** (`blobRegistry()` returns the array) — evaluated at call time, not
  captured, because `minnaBlob` rides the cloud⇄minna import cycle and isn't bound at
  `cloud.js` eval time. Keep it a function.
- **`busKey` set vs `null`**: bus-keyed blobs (`progress`, `custom`, `settings`,
  `selftalk`, `songs`) are scheduled by persistence modules through `src/sync-bus.js`
  (persistence can't import cloud — the bus is the seam). `busKey:null` blobs
  (`minna`, `wanikani`, `jlpt`) live in feature store modules whose own `saveX()`
  calls `blob.schedule()` directly. Either pattern is fine for a new blob; pick the
  one matching where the save entry point lives.

## The eight blobs (as of 2026-07)

| app key | localStorage key | blob defined in | busKey | on 409 | contents |
|---|---|---|---|---|---|
| `verbs` | `jpverbs_v3` | `features/cloud.js` (progressBlob) | `progress` | `mergeProgress` | SRS progress: `cards{rank:{attempts,right,wrong,box,due,last?}}`, `sessions` (cap 1000), `daily` |
| `custom-verbs` | `jpverbs_custom` | `features/cloud.js` (customBlob) | `custom` | `mergeCustomVerbs` | user-authored card definitions + the monotonic `seq` counter |
| `settings` | `jpverbs_settings` | `features/cloud.js` (settingsBlob) | `settings` | **none → server-wins** | preferences (`src/settings-store.js`) |
| `minna` | `jpverbs_minna` | `features/minna/store.js` (key in `minna/state.js`) | `null` (saveMinna) | `mergeMinna` | lesson notes + built-in dedup overlays + conversation clips |
| `selftalk` | `jpverbs_selftalk` | `features/cloud.js` (selftalkBlob; key in `persistence/selftalk.js`) | `selftalk` | `mergeSelftalkPractice` | practice/streak signal ONLY (phrases are sentence-store rows) |
| `songs` | `jpverbs_songs` | `features/cloud.js` (songsBlob; key in `persistence/songs.js`) | `songs` | `mergeSongs` | per-song progress: starred/shadowed lines, last mode |
| `wanikani` | `jpverbs_wanikani` | `features/wanikani/store.js` | `null` (saveWanikani) | none (server-wins) | the WK API token ONLY — the 9.4k-subject dataset is device-local IndexedDB |
| `jlpt` | `jpverbs_jlpt` | `features/jlpt/store.js` | `null` (saveJlpt) | `mergeJlpt` (in `core/jlpt.js`) | level + examDate + optional pacing targets + rolling day records |

Merge fns live in `src/core/merge.js` except `mergeJlpt` (`src/core/jlpt.js`). Verify
the live registry with: `grep -n "busKey" study-app/src/features/cloud.js`.

## 409 optimistic concurrency

Each blob tracks the server's `updatedAt` from its last sync and sends it as
`baseUpdatedAt` on every PUT (omitted on the very first write). The server 409s when
another device wrote since that base. `reconcile()` then:

1. If the blob registered `merge()`: union `merge(read(), serverData)`, `apply` it, run
   `afterPull` in `{reconcile:true}` mode, and re-push — **guarded to a single merge
   round** (`mergingReconcile`), so a device writing on every beat can't loop; a second
   409 inside the re-push falls through to server-wins.
2. No `merge()` (settings, wanikani): adopt the server copy — the other device's change
   is preserved rather than clobbered. Correct for last-writer-wins data.

Merge design rules (all reconcilers follow them — keep them for new ones):

- **No data loss**: every key/card/session on either side survives.
- **No inflation**: values that could double-count across REPEATED reconciles (lifetime
  counts, daily tallies) take `max()`, not sum — a 409 can recur, and summing would run
  away. Slight under-count on a genuine split is the safe direction.
- On a true per-key edit conflict, **local wins** (the actively-syncing device carries
  the user's latest intent).
- Pure, DOM-free, null-tolerant — they're direct-imported by the core test tier.

**The explicit-field trap**: `mergeProgress` reconstructs each card from a hard-coded
field list (`attempts/right/wrong/box/due` + `last`). A NEW per-card stat field must be
added to that list or every 409 silently drops it on one side. Same principle applies
to any merge fn that rebuilds objects field-by-field.

## The offline write queue

`src/net/sync-queue.js`, persisted at `jpverbs_sync_queue`:

- A push that still fails after the transport's retries enqueues
  `{ key, path, method, body, accountId }`. Blob writes queue as `progress:<appKey>`
  and **dedup by key** — a newer write replaces the older (full-replace PUTs make
  last-wins correct). The durable session log queues as `session:<uuid>` (unique keys;
  distinct sessions never collapse; the server dedups replays by idempotency key).
- Queued replays are sent **unconditionally** (no `baseUpdatedAt`) — durability over
  concurrency for the offline path.
- Everything queued must be SAFE TO REPLAY. The multi-MB recording upload is
  idempotency-keyed but deliberately NOT queued (blobs don't belong in localStorage).
- Entries are account-tagged; `flushAll` replays only the current account's and bumps
  each owning blob's `lastUpdatedAt` from the replay response (via the registry-derived
  queueKey→blob map) so the next live push doesn't false-conflict. Sign-out drops the
  queue.
- Replay triggers: `window 'online'`, boot with an existing session (before the boot
  pull), and after a fresh sign-in.

## Boot / sign-in sequence

`bootAuth()` is the LAST call in `src/main.js` (fire-and-forget — it touches every
feature, so all must be initialized first). With a live session it runs
`flushQueue()` then `pullCloud()`. `pullCloud()` = `orchestrator.pullAll()` — each
blob pulled in registry order, **isolated in its own try/catch** so one blob's failure
(network drop, throwing side-effect) can't abort the rest — then the cross-blob
finalizers, in order: `migrateMinnaDupes()`, `rebuildData()`,
`await migrateCardExamples()`, `refreshAllViews()`. If you add a cross-blob
post-pull step, it goes in that finalizer block, not inside a blob's `afterPull`.

## Read-through resources (the OTHER caching layer — don't confuse the two)

Synced blobs move USER-owned data across devices. `createReadThroughResource`
(`src/persistence/resource.js`) caches SERVER-owned content per device (example
sentences, Self-Talk phrases + templates, the Songs library, grammar annotations).
Contract:

- `warm()` — synchronously paint the last good fetch (first frame isn't blank).
- `refresh({force})` — fetch → adapt → apply + cache-write; **single-flight** (concurrent
  callers share one in-flight fetch — this fixed a real double-fetch race); resolves
  `true`/`false`, never rejects; on failure degrades to the cache only when the live
  value is still empty.
- `adoptEmpty:false` — a successful-but-empty fetch is ignored so a server mid-warm
  can't clobber good cached data (the example-sentences path needs this).

Consumers to copy from: `features/examples.js` (shares its cache instance with
`state.js`'s synchronous boot hydration via the `cache` option),
`features/songs/library.js`, `features/grammar/data.js`, `features/selftalk/store.js`.
The deliberate exception to this pattern is the WaniKani dataset (IndexedDB,
incremental cursors — see the dead-end in `study-app/CLAUDE.md`).

## Ground truth (as of 2026-07)

- `src/features/synced-blob.js`, `src/features/cloud.js` (registry + pullCloud/bootAuth),
  `src/net/sync-orchestrator.js`, `src/net/sync-queue.js`, `src/net/transport.js`,
  `src/sync-bus.js` — the top-of-file comments are kept accurate and explain the whys.
- `src/core/merge.js` + `mergeJlpt` in `src/core/jlpt.js` — the reconcilers.
- `study-app/CLAUDE.md` "Persisted store" block + the Cloud bullet — shapes + inventory.
- Server side of `/v1/progress/{app}`: `wk-enhanced-api/CLAUDE.md` "Accounts + study app"
  (the `app` enum must include any new appKey — see `add-synced-blob`).
- Tests pinning all of this: `test/synced-blob.test.js`, `test/sync-orchestrator.test.js`,
  `test/sync-queue.test.js`, `test/transport.test.js`, `test/resource.test.js`.
