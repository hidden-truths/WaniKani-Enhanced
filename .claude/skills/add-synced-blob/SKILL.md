---
name: add-synced-blob
description: Add a new cloud-synced per-user data blob to the study app (createSyncedBlob + the cloud.js blob registry + PUT /v1/progress/{app}) — client store module, registry entry, 409 merge reconciler, server app-enum widen, tests, prod rollout ordering. Use whenever a feature needs per-user state that survives across devices/sign-ins (progress, prefs, tokens, day records, plans), when changing sync/merge/progress-blob code, or when a progress PUT unexpectedly 400s or 409s.
---

# Add a synced blob (per-user cloud-synced data)

You are giving a study-app feature per-user state that follows the user across devices and
sign-ins. This is a fully paved road: eight blobs already ride one abstraction
(`createSyncedBlob`), one registry, one server route. A new blob touches exactly five places —
client store module, registry entry, merge reconciler, server enum, docs — plus tests and one
deploy-ordering rule. Do NOT invent a parallel sync path; every shortcut here (hand-rolled
fetch, skipping the registry, skipping the merge) recreates a bug this architecture was built
to kill.

## Before you start

- Read the "Cloud" bullet in `study-app/CLAUDE.md` (the "EIGHT debounced synced blobs"
  paragraph) — it is the architecture summary this skill operationalizes.
- Read `study-app/src/features/synced-blob.js` top-of-file comment — the `createSyncedBlob`
  option contract (`read`/`apply`/`afterPull`/`shouldSeed`/`onOffline`/`merge`/`debounceMs`)
  is documented there and this skill assumes it.
- Pick the closest precedent from the table below. The newest and cleanest to copy is
  `study-app/src/features/jlpt/store.js` (compact, shows every piece).
- Confirm the data actually belongs in a synced blob (Step 1). Device-local prefs (theme,
  font, mic deviceId) stay plain localStorage; server-authoritative content (sentences,
  songs, lessons) lives in the sentence store, not a blob.

## The eight existing blobs (as of 2026-07 — pick a precedent)

| appKey | blob defined in | localStorage key | busKey | 409 merge | carries |
|---|---|---|---|---|---|
| `verbs` | `features/cloud.js` | `jpverbs_v3` | `progress` | `mergeProgress` | SRS progress: cards/sessions/daily |
| `custom-verbs` | `features/cloud.js` | `jpverbs_custom` | `custom` | `mergeCustomVerbs` | custom-card definitions |
| `settings` | `features/cloud.js` | `jpverbs_settings` | `settings` | none → server-wins | preferences (last-writer is fine) |
| `minna` | `features/minna/store.js` | `jpverbs_minna` | `null` | `mergeMinna` | lesson notes + dedup overlays + clips |
| `selftalk` | `features/cloud.js` | `jpverbs_selftalk` | `selftalk` | `mergeSelftalkPractice` | practice/streak signal ONLY |
| `songs` | `features/cloud.js` | `jpverbs_songs` | `songs` | `mergeSongs` | per-song starred/shadowed/lastMode |
| `wanikani` | `features/wanikani/store.js` | `jpverbs_wanikani` | `null` | none → server-wins | the WK API token, nothing else |
| `jlpt` | `features/jlpt/store.js` | `jpverbs_jlpt` | `null` | `mergeJlpt` (in `core/jlpt.js`) | level + examDate + targets + day record + mock-test log |

Paths are under `study-app/src/`. Re-derive the live list any time from the registry:
`grep -n "busKey" study-app/src/features/cloud.js` (the `blobRegistry()` function is the
single source of truth; its order is the pull order).

## Procedure

### 1. Shape the blob (decide before coding)

- **Small.** The server enforces ≤1 MB per blob (`MAX_BLOB_BYTES` in
  `wk-enhanced-api/src/routes/progress.ts`), and every debounced save re-PUTs the WHOLE
  blob — so the shape must be growth-bounded. Precedents: `normalizeJlpt` prunes the day
  record to the last 60 days; the `verbs` blob caps `sessions` at 1000.
- **Opaque to the server.** The server stores `z.any()`; the client owns schema and
  versioning via its own normalize function. No server-side migration is ever needed.
- **Big datasets stay OUT.** The `wanikani` precedent: the blob carries only the WK API
  token; the 9.4k-subject dataset lives in device-local IndexedDB, re-syncable from
  api.wanikani.com. The `songs`/`selftalk` precedent: the blob carries only progress;
  content is server-authoritative sentence-store rows. Sync the credential/progress, not
  the corpus.
- **Sync semantics.** Most blobs get a merge reconciler (Step 4). Skip merge ONLY when
  last-writer-wins is genuinely correct (a token, a preferences object) — then a 409 adopts
  the server copy.
- localStorage key: `jpverbs_<x>` (the app-wide prefix; the full inventory is in
  `study-app/CLAUDE.md`'s "Persisted store" block).

### 2. Client store module

For a feature that has a directory module (the modern pattern), create
`study-app/src/features/<x>/store.js` and re-export through the feature's `index.js` barrel
(cloud.js imports blobs via the thin `features/<x>.js` re-export — e.g.
`import { jlptBlob } from './jlpt.js'`). Copy `features/jlpt/store.js`; it has all six pieces:

- `empty<X>()` — the default shape.
- `normalize<X>(o, ...)` — pure, tolerates junk/null/legacy input, always returns a
  well-formed store. This is your schema-versioning seam.
- `load<X>()` — hydrate `state.<x>Store` from localStorage. Call once at boot, before any
  reader (the jlpt pattern calls it first thing in `initJlpt()`; `main.js` calls the initX
  fns in order).
- `save<X>Local()` — localStorage mirror only, NO push. Used by `apply` during pulls.
- `save<X>()` — `save<X>Local()` + `<x>Blob.schedule()`. **This is the one write entry
  point for feature code.** For a `busKey:null` blob, this `schedule()` call IS the sync —
  forget it and the blob silently never pushes.
- `export const <x>Blob = createSyncedBlob({...})` with:
  - `appKey: '<x>'` — must match the server enum (Step 5).
  - `read: () => state.<x>Store` — the document each debounced PUT sends.
  - `apply: (data) => {...}` — server-wins hydration. MUST guard null/empty itself (it is
    called even when the server has nothing); on usable data, normalize → write state →
    `save<X>Local()` (mirror WITHOUT re-pushing) → `return true`. Return `false` on
    unusable data so the fresh-account seed path runs.
  - `shouldSeed: () => ...` — return true only when local state holds real user data. Why:
    when the server has nothing and `shouldSeed()` passes, pull() pushes local up to seed a
    fresh account; a brand-new browser must not park an empty/default blob in the cloud
    (jlpt checks for a non-default level/date, any day record, any target, or any logged mock).
  - `merge: merge<X>` — Step 4 (omit only for deliberate server-wins).
  - `afterPull` (optional) — side-effects after a successful apply, e.g. re-render the tab
    if it's the active panel (`songsBlob`), or kick a gate open (`wanikaniBlob`'s
    `onWanikaniTokenPulled`).

What you get for free from `createSyncedBlob`: the 1200 ms debounce, `saving…/✓ synced/⚠
offline` status, the durable offline queue fallback (`net/sync-queue.js`, dedup key
`progress:<appKey>`, replay on reconnect/boot/sign-in), the `baseUpdatedAt` optimistic
concurrency, and the single-round 409 reconcile.

### 3. Register in the blob registry — exactly ONE place

Add one line to the ordered `blobRegistry()` function in `study-app/src/features/cloud.js`:

```js
{ blob: <x>Blob, busKey: null },   // off-bus: save<X> schedules <x>Blob directly
```

- **busKey decision.** `busKey: null` = the owner module schedules pushes itself via
  `save<X>()` — the minna/wanikani/jlpt pattern, and the right default for a new
  feature-owned store. A string busKey (`'progress'`, `'custom'`, `'settings'`,
  `'selftalk'`, `'songs'`) instead wires the blob's `schedule` onto that slot of
  `src/sync-bus.js`, so a persistence-layer `save*()` can trigger the push without
  importing cloud — only needed when the writer lives in `src/persistence/*` rather than a
  feature module; adding one means also adding the no-op slot to `sync-bus.js`.
- **Why the registry exists:** pull-all, flush-all, and bus-wiring are all derived from it
  by `net/sync-orchestrator.js`. Before it, cloud.js kept three hand-maintained copies of
  the blob list, and a drift (a blob flushed but never pulled, so its `lastUpdatedAt` never
  bumps) false-409'd that device forever. One registry line = registered everywhere.
- **Keep it a function.** `blobRegistry()` is a thunk, not a const array, because
  `minnaBlob` rides the cloud⇄minna runtime import cycle and isn't bound at cloud.js eval
  time. Don't "simplify" it to an array — that's an eval-time crash.
- Registry order is the pull order at sign-in; append at the end unless you have a real
  ordering dependency.

### 4. Write the 409 merge reconciler

When two devices race (both edited since the same `baseUpdatedAt`), the PUT 409s and
`createSyncedBlob` calls your `merge(local, server)` to UNION the copies so neither device's
offline work is lost — then re-pushes the union (guarded to a single round; a second 409
falls through to server-wins).

- **Where:** the shared home is `study-app/src/core/merge.js` (mergeProgress,
  mergeCustomVerbs, mergeMinna, mergeSelftalkPractice, mergeSongs). A blob with its own core
  module can keep it there instead — `mergeJlpt` lives in `core/jlpt.js`. Either way it's
  exported through the `core/index.js` barrel, pure and DOM-free.
- **Design rules** (from the `core/merge.js` header — hold to them):
  - *No data loss:* every key/card/entry present on either side survives (union).
  - *No inflation:* for counts/tallies take `max()`, never sum — a 409 can recur and
    summing double-counts the shared base each round.
  - *Local wins ties:* on a same-key edit conflict with no timestamp, keep local (the
    device actively syncing carries the user's most recent intent). View cursors
    (`lastLesson`, `lastMode`) are always local-wins.
  - Tolerate null/partial input on both sides; always return a well-formed blob.
- **Patterns to copy:** day-record union + local scalars (`mergeJlpt`), monotonic set union
  (`mergeSongs`), per-key max + explicit field list (`mergeProgress`), union-by-rank + max
  seq (`mergeCustomVerbs`).
- **TRAP (encode this in any explicit-field merge you write):** `mergeProgress` rebuilds
  each card from an EXPLICIT field list (`attempts/right/wrong/box/due` + `last`). A new
  per-card stat field MUST be added to that list or every 409 silently drops it on the
  merged copy — this is called out in both the merge source and `study-app/CLAUDE.md`.

### 5. Widen the server enum (one line + one test)

In `wk-enhanced-api/src/routes/progress.ts`, add your key to `AppParamSchema`'s
`z.enum([...])` AND the comment block above it (each key has a one-line meaning there — the
route header comment lists them too). That's the entire server change: `user_progress` is
already per-`(user_id, app)` with an opaque blob, so there is **no DB migration, ever**.

Then pin it: add a `"the <x> app namespace is accepted (enum widen)"` test in
`wk-enhanced-api/src/routes/integration.test.ts` — three literal precedents (songs,
wanikani, jlpt) sit together near the end of the progress describe-block; copy one and PUT a
realistic sample blob.

Run both gates from `wk-enhanced-api/`: `bun test` and `bun run typecheck` (see the
`api-dev` skill for the dev loop).

### 6. Update the docs that enumerate blobs

The blob list is mirrored in prose in several places; stale lists actively mislead the next
session, so fix them in the same commit (repo rule):

- `study-app/CLAUDE.md` — the "**EIGHT debounced synced blobs**" Cloud bullet (count +
  list + per-blob side-effect note) and the "Persisted store" localStorage inventory
  (add the `jpverbs_<x>` line, synced as app `<x>`).
- `wk-enhanced-api/CLAUDE.md` — `grep -n "wanikani" wk-enhanced-api/CLAUDE.md` finds every
  enum mirror: the `user_progress` table bullet, the `/v1/progress/{app}` rows in the API
  surface table, and the "Progress is opaque + multi-app" bullet in the Accounts section.
- The header comment of `wk-enhanced-api/src/routes/progress.ts` (route-level key list).
- Add/complete the ROADMAP record for the feature (see the `roadmap` skill), and finish per
  the `land-a-change` skill.

### 7. Tests (client side)

`study-app/test/CLAUDE.md` states the split for a new blob — follow it:

- **Blob semantics are covered for free**: `test/synced-blob.test.js` tests the
  `createSyncedBlob` factory itself (debounce, push/offline/409, pull/seed, baseUpdatedAt),
  so your blob inherits that coverage.
- **Your merge fn needs its own case** in the subsystem core test (`test/jlpt-core.test.js`
  has the `mergeJlpt` precedents: union both ways, local scalars win, null tolerance) or in
  `test/core.test.ts` beside the shared mergers.
- **The registry entry** is exercised by `test/sync-orchestrator.test.js`'s integration
  block (real SyncedBlobs over the mocked transport).
- Run `bun run test` from `study-app/` (Vitest); it must pass before commit.

### 8. Rollout — the server enum must reach prod BEFORE (or with) the client

Prod is two containers (see the `deploy-prod` skill): the `api` image carries the enum, the
`web` image carries your client code. Ship the API first or together — never the client
alone.

**What the gap window actually does** (verified in code): a client PUT against a
not-yet-widened prod enum gets **400** `validation_error` (not 409). `push()` treats any
non-409 failure as offline → enqueues to the durable queue + shows `⚠ offline`; `flush()`
keeps non-409 failures queued and retries on every reconnect/boot/sign-in; `pull()` fails
silently. So nothing is lost — localStorage stays the local truth and the queue holds the
newest replay — but that blob's sync is dead and the status pill sits on offline until the
API deploys. Tolerable for days, not weeks.

**This is live right now, not hypothetical** (as of 2026-07-06): the `wanikani` + `jlpt`
widens are on main but prod still runs the six-key enum — the pending deploy is the
`infra-prod-deploy-wanikani` ROADMAP record (high prio). Check the live state before
assuming prod matches main, and fold your deploy into that batch if it hasn't shipped:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.wkenhanced.dev/v1/progress/<appKey>
# 401 → enum is live in prod (auth rejected you, not validation)
# 400 → enum NOT deployed (body's detail names the accepted keys)
```

## Verify

1. `cd wk-enhanced-api && bun test && bun run typecheck` — green.
2. `cd study-app && bun run test` — green.
3. Both sides named: `grep -n "<appKey>" study-app/src/features/cloud.js
   wk-enhanced-api/src/routes/progress.ts` hits the registry line and the enum.
4. Manual loop: `./dev.sh` from the repo root (starts API :3000 + app :5173 wired
   cross-origin), sign in with the dev account (creds in `dev_account_password.txt` at repo
   root), exercise the feature, watch the status pill hit `✓ synced`, and confirm a
   `PUT /v1/progress/<appKey>` → 200 in the Network tab. Reload signed-in: the pull should
   restore state without a re-push loop.
5. Merge sanity: in devtools, temporarily set the blob's local copy divergent, push from a
   second browser profile, and confirm the 409 path unions rather than clobbers — or trust
   the merge unit test if the manual dance is overkill for your shape.

## Traps

- **`busKey:null` + no `schedule()` call = a blob that never syncs.** The registry only
  wires bus-keyed blobs; an off-bus blob pushes solely because `save<X>()` calls
  `<x>Blob.schedule()`. Localstorage keeps working, so the miss is silent.
- **`apply` must mirror with `save<X>Local()`, never `save<X>()`** — the push variant
  inside apply re-schedules on every pull → a push loop.
- **`apply` returning true on unusable data kills fresh-account seeding** (pull records it
  as a successful hydration, so local data is never uploaded). The one blob that returns
  true unconditionally — `selftalk` — does it deliberately so its `afterPull` migration
  always runs; copy that only if you also have a must-always-run afterPull.
- **Missing/permissive `shouldSeed`** lets a brand-new browser park an empty default blob
  in the cloud. Seed only on real local data.
- **Unbounded growth**: the blob is full-replace on every save and capped at 1 MB — prune
  in `normalize<X>` (jlpt's 60-day window, verbs' 1000-session cap are the precedents).
- **Per-device values don't belong in a synced blob** — a mic `deviceId` is meaningless on
  another machine; that precedent lives in device-local `jpverbs_micDevice`, not
  `settings`.
- **Don't const-ify `blobRegistry()`** (eval-time import-cycle crash — see Step 3).
- **Explicit-field merges silently drop new fields** (Step 4 trap). When you add a field to
  an existing blob's shape, grep its merger before shipping.
- **Client-before-server deploys 400 in prod** (Step 8). The offline queue masks it as
  `⚠ offline`, which looks like a network bug — check the enum probe first (also in the
  `troubleshoot` skill's sync playbook).

## Ground truth (re-verify here when updating this skill; state as of 2026-07)

- `study-app/src/features/synced-blob.js` — the factory + its full option contract.
- `study-app/src/features/cloud.js` — `blobRegistry()` (8 entries), the five inline blobs,
  `pullCloud`/`flushQueue`/`initCloud` delegation.
- `study-app/src/net/sync-orchestrator.js` + `src/net/sync-queue.js` — group ops + the
  durable queue (flush drops 409s, keeps other failures).
- `study-app/src/features/{jlpt,wanikani,minna}/store.js` — the off-bus store-module
  precedents; `src/sync-bus.js` — the five bus slots.
- `study-app/src/core/merge.js` (+ `mergeJlpt` in `src/core/jlpt.js`) — reconcilers + the
  design rules; tests in `test/core.test.ts` / `test/jlpt-core.test.js`.
- `wk-enhanced-api/src/routes/progress.ts` — the app enum (8 keys), 1 MB cap, 409 contract;
  enum-widen tests in `wk-enhanced-api/src/routes/integration.test.ts`.
- Prose mirrors: `study-app/CLAUDE.md` Cloud bullet + persisted-store inventory;
  `wk-enhanced-api/CLAUDE.md` progress bullets; `study-app/test/CLAUDE.md` closing
  paragraph (what a new blob must test).
- Live prod enum probe: `curl -s https://api.wkenhanced.dev/v1/progress/<key>` (401 = key
  live, 400 = not deployed). Pending-deploy record: `infra-prod-deploy-wanikani` in
  `ROADMAP.html`.

Siblings: `study-app-dev` (module map, dev loop), `api-dev` (server dev loop + route
patterns), `add-study-tab` (routes here for its synced-data step), `deploy-prod` (shipping
the enum), `roadmap` + `land-a-change` (recording + committing), `troubleshoot` (sync
symptom playbooks).
