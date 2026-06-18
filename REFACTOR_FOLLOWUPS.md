# REFACTOR_FOLLOWUPS.md

Implementation plan for the SOLID / quality workstreams that follow the **`db/client.ts`
God-Object split** (shipped to `main`, commit `c78cc63`). That refactor decomposed the
1,396-line server repo module into `db/connection.ts` + `db/repos/*` behind a re-export
barrel, with per-repo tests. This doc covers the remaining three workstreams from the same
review, in **recommended execution order**:

- **D** — `schemas.ts` → per-domain modules (LOW risk, mechanical — same playbook as `db/client`). Do first as a warm-up. **✅ SHIPPED.**
- **B** — study-app sync: DRY collapse + resilient transport + offline queue + optimistic concurrency (MEDIUM risk, the high-value one). **✅ SHIPPED.**
- **C** — `record-compare.js` decomposition (HIGH risk, lower leverage). **✅ SHIPPED** — C0 (pure-helper test-net) + C1+ (full glue split into `features/record-compare/{state,capture,takes,playback,waveform,view}.js` behind a thin re-export).

Each section is self-contained: problem → target design → concrete steps → files → tests →
dead-ends to respect → verification. Architecture/rationale lives in the two `CLAUDE.md`s;
this doc owns the *how-to-execute*.

| Workstream | Win | Risk | Effort | Order |
|---|---|---|---|---|
| **D** schemas split ✅ | SRP/ISP; co-locate schemas by domain | LOW (barrel + typecheck-guarded, zero behavior change) | ~1–2h | 1st — **SHIPPED** |
| **B** sync DRY + resilience + concurrency ✅ | DRY + DIP + disconnection/concurrency resilience + new tests | MED (hot path; backward-compat progress contract) | ~1–2 days | 2nd — **SHIPPED** |
| **C** record-compare decomp ✅ | SRP on the DOM/audio glue | HIGH (no feature tests, stateful audio, many dead-ends) | ~1–2 days | 3rd — **SHIPPED (C0 + C1+)** |
| **S** songs.js decomp ✅ | SRP on the 歌 tab's DOM/mode glue | HIGH (live mic + YouTube + shared mutable view-state; browser-verify each step) | ~1–2 days | after C — **SHIPPED** (C0 + C1.0 + C1.1+ peels); needs a live browser pass |

> **Golden rule for all three:** zero behavior change unless explicitly designed (B's
> concurrency + queue). Keep the existing test suites green at every step, add tests for new
> code, and respect every DEAD-END WARNING in [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md)
> and [study-app/CLAUDE.md](study-app/CLAUDE.md). One logical change → one commit.

---

## Workstream D — `schemas.ts` → per-domain modules

> **✅ SHIPPED.** The 733-line / 66-schema module is now `src/schemas/{common,vocab,warm,accounts,progress,minna,audio,sentences,templates}.ts` behind the `src/schemas.ts` re-export barrel. Every schema moved **byte-identical** (verified); all 11 route consumers unchanged; typecheck clean, 237 tests pass, `/openapi.json` identical (55 components, 25 paths). One deviation from the target below: `templates` got its **own** module (a 9th file) rather than folding into `sentences.ts`, mirroring `db/repos/templates.ts` + `routes/templates.ts` (the template schemas are self-contained). The grouping/steps below are kept as the as-built record.

### Problem
[wk-enhanced-api/src/schemas.ts](wk-enhanced-api/src/schemas.ts) is **733 lines / 66 exported
Zod schemas** in one module — the single source of truth for validation + OpenAPI generation,
imported by every route. It already has clean `// ----------` section banners, so it's a textbook
candidate for the *same* split the `db/client` God-Object got: cohesive per-domain modules behind
a barrel, zero consumer churn.

### Target design
```
src/
  schemas/
    common.ts      # shared/base: ErrorCodeSchema, ErrorSchema, FuriganaSegSchema, SentenceLinkSchema,
                   #   AnnotationToken/Bunsetsu/SentenceAnnotation — anything imported by 2+ domains
    vocab.ts       # ExampleSchema, VocabPayloadSchema, IndexMetaSchema, HealthSchema,
                   #   VocabParams/Query, BatchRequest/Response
    warm.ts        # WarmRequest, WarmWord/All/IndexMetaResponse, WarmJobSchema, JobsQuery/Response
    accounts.ts    # CredentialsSchema, PublicUserSchema, AuthResponseSchema, LogoutResponseSchema
    progress.ts    # ProgressGet/Put*, SessionPost* (study-app per-user data)
    minna.ts       # MinnaLessons*, MinnaLesson*, MinnaAudioQuery, MinnaRecording* (Phase 2), MinnaPractice*
    audio.ts       # AudioVariantsQuery, AudioVariantSchema, AudioVariantsResponse, AudioTtsQuery
    sentences.ts   # Sentence*, SentenceList*, SentenceCreate/Update*, CardExample*, Card*, Sentence*Response
  schemas.ts       # BARREL: export * from './schemas/<each>.ts'  (consumers unchanged)
```
The exact grouping mirrors the existing banners (`// ---------- Components / Request bodies /
Path params / Batch / Warm-job / Accounts / Progress / みんなの日本語 / record-and-compare / audio /
sentence store`). Collapse the tiny request/param/response banners into their domain file.

### Steps
1. Read [schemas.ts](wk-enhanced-api/src/schemas.ts) end to end; note inter-schema references (responses that embed component schemas like `ExampleSchema`, `PublicUserSchema`, `FuriganaSegSchema`). Anything referenced by 2+ domains → `schemas/common.ts`.
2. Create `src/schemas/common.ts` first; move the shared/base schemas verbatim. Then create each domain file, moving its schemas verbatim and importing shared ones from `./common.ts` (use `import` not `import type` — Zod schemas are runtime values).
3. Replace `src/schemas.ts` body with `export * from './schemas/<each>.ts'` (one line per module). Keep a header comment explaining the barrel, mirroring `db/client.ts`.
4. **Verify no export-name collisions** before relying on `export *`: `grep -hoE "^export const [A-Za-z]+Schema" src/schemas/*.ts | sort | uniq -d` must be empty (same check used for the db split).
5. `bun run typecheck` (catches missed imports / cycles / verbatimModuleSyntax issues — note `verbatimModuleSyntax: true`, so type-only imports need `import type`).
6. `bun test` — the existing [routes/integration.test.ts](wk-enhanced-api/src/routes/integration.test.ts) + the zodHook exercise the schemas end-to-end; all must stay green.

### Files
`wk-enhanced-api/src/schemas.ts` (→ barrel) + new `wk-enhanced-api/src/schemas/*.ts`. **No route
files change** — they keep `import { XSchema } from '../schemas.ts'`. Optionally update the
`schemas.ts` line in the [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) architecture tree.

### Dead-ends / gotchas
- **`/openapi.json` is auto-generated from these Zod schemas** — do not hand-write a spec. The split must not change any schema *shape*, only its file home (verify `/docs` still renders + `bun test` green).
- `defaultHook` is per-`OpenAPIHono` instance — unrelated to this split, but don't touch the route constructors.
- Watch for an import **cycle** if two domain files reference each other's schemas — push the shared one down into `common.ts` (acyclic by construction, like `sentenceCore.ts`).

### Verification
`bun run typecheck` clean · `bun test` green · `bun dev` then open `/docs` and confirm every
endpoint still renders its schema · `git grep "from '../schemas.ts'"` confirms consumers unchanged.

---

## Workstream B — study-app sync: DRY + resilient transport + offline queue + optimistic concurrency

This is the high-value workstream (it hits the original brief's "resilient to concurrency,
server instability, disconnections" requirement) and fills the study-app's **feature-test gap**.
Split into four sub-parts B1–B4; ship them as separate commits in order.

> **✅ SHIPPED** as four commits: **B1** `net/transport.js` (timeout + idempotency-aware retry/backoff +
> `Retry-After`, re-exported as `api`); **B2** `net/sync-queue.js` (durable localStorage FIFO, dedup-by-key,
> per-account); **B3** `features/synced-blob.js` (`createSyncedBlob` collapses all five trios — incl. minna
> folded in — + wires the queue + flush on `online`/boot/sign-in + clear-on-logout); **B4** server 409
> optimistic concurrency on `PUT /v1/progress` (`baseUpdatedAt` compare-and-set, backward-compatible) with
> the client sending `baseUpdatedAt` + server-wins reconcile. **+33 study-app tests** (transport/queue/
> synced-blob) and **+7 server tests** (CAS repo cases + integration 409). Browser-verified end-to-end:
> sign-in → offline grade → queued write → reconnect `online` → flush → server matches local (`cardsMatch:true`),
> plus the server 409 path confirmed live via curl. Deviations from the design below: the 409 reconcile is
> **server-wins apply, no blind re-push** (per-blob merge noted as the deeper follow-up); queued offline writes
> replay **last-write-wins** (omit `baseUpdatedAt`) so an offline change is delivered, not dropped on a stale base.

### Problem (current state)
- **5× copy-pasted sync trios.** [study-app/src/features/cloud.js](study-app/src/features/cloud.js)
  has four near-identical `schedule*Sync` + `push*Cloud` (+ `pull*Cloud`) sets — `verbs`
  (`scheduleCloudSync`/`pushCloud`), `custom-verbs`, `settings`, `selftalk` — plus four
  `*SyncTimer` vars; **and a fifth** in [study-app/src/features/minna.js](study-app/src/features/minna.js)
  (`scheduleMinnaSync`/`pushMinnaCloud`/`pullMinnaCloud`, deliberately off the bus). A "synced
  blob" is one concept copy-pasted five times → adding a blob means a new trio (Open/Closed violation).
- **No resilient transport.** [study-app/src/features/cloud-core.js](study-app/src/features/cloud-core.js)
  `api()` has **no timeout, no retry, no backoff**. A network failure throws fetch's `TypeError`
  → treated as "unreachable". Every `push*Cloud` does `try { await api(PUT) } catch { setSyncStatus('⚠ offline') }`
  — i.e. **a failed write is silently dropped**; it only reaches the server when the next `save()`
  happens to reschedule a push. A change made while offline can be lost.
- **Fire-and-forget durable log.** `logSession` ([cloud.js](study-app/src/features/cloud.js)) does
  `api('/v1/sessions', POST).catch(()=>{})` — a dropped POST silently loses a session even though
  the `study_sessions` table is supposed to be the *durable* record.
- **Last-write-wins progress.** Server `upsertProgress` ([db/repos/progress.ts](wk-enhanced-api/src/db/repos/progress.ts))
  returns `updatedAt` but nothing checks it; `PUT /v1/progress/{app}` ([routes/progress.ts](wk-enhanced-api/src/routes/progress.ts))
  unconditionally replaces. Two devices syncing concurrently → silent lost update.

### B1 — Resilient transport layer (DIP)
New module **`study-app/src/net/transport.js`** (or extend `cloud-core.js`). The single fetch
choke-point gains, *behind the existing `api()` signature*:
- `withTimeout(ms)` via `AbortController` (default ~10s; study-app calls are all fast).
- `retry(fn, { retries: 3, baseMs: 300, classify })` — exponential backoff **with jitter**; honor `Retry-After` on 429.
- Retry **only** on transient failures: network `TypeError` (no `.status`), 5xx, 429. **Never** retry 4xx (a 401/409/400 is terminal).
- Keep `cache: 'no-store'`, `credentials: 'include'`, and the `API_BASE` rebase **exactly** (see dead-ends).

**Idempotency policy (critical — get this right):**
| Safe to auto-retry (idempotent) | Do NOT auto-retry (non-idempotent) |
|---|---|
| All `GET` (`/v1/auth/me`, `/v1/progress/*`, `/v1/minna/*`, `/v1/audio/variants`) | `POST /v1/sessions` — appends a row → retry = duplicate session |
| `PUT /v1/progress/{app}` (all 5 blobs — full replace) | the binary recording upload ([record-compare.js](study-app/src/features/record-compare.js) ~L664, its own `fetch`) — appends a take |
| `PUT /v1/sentences/{id}`, `PUT /v1/sentences/card/{rank}` (replace) | `POST /v1/auth/{login,register}` — user-facing + rate-limited; surface the error instead |
| `DELETE /v1/sentences/{id}`, `DELETE /v1/audio/recordings/{id}` | |
| `POST /v1/sentences`, `POST /v1/templates/{id}/realize` — server is idempotent (by `ext_id` / by hash) | |
| `POST /v1/auth/logout` (idempotent) | |

Implement retry as **opt-in per call** (`api(path, { ...opts, retry: true })`) or infer from method
(GET/PUT/DELETE retry by default; POST only when the caller passes `retry: true`). The four
non-idempotent POSTs stay un-retried. To make `POST /v1/sessions` retry-safe later, add a
client-generated idempotency key the server dedups on (optional enhancement, note it).

### B2 — Offline write queue (durability)
New module **`study-app/src/net/sync-queue.js`** — a durable (localStorage-backed) FIFO of pending
**idempotent** writes. On a push that fails after retries (offline / persistent 5xx), enqueue
`{ key, path, method, body }`. Flush on: `window.addEventListener('online', …)`, app boot
(`bootAuth`), and after a successful sign-in pull. **Dedup by `key`** (e.g. `progress:verbs`) — a
newer queued write for the same blob *replaces* the older (full-replace PUTs → last-wins is correct
for blobs). Tag entries with the account id and **drop the queue on sign-out** (queued writes are
per-account). This is what makes the app actually "resilient to disconnections."

### B3 — `SyncedBlob` abstraction (DRY / Open-Closed)
New module **`study-app/src/features/synced-blob.js`**:
```js
createSyncedBlob({ appKey, read, apply, afterPull?, debounceMs = 1200 }) → { schedule, push, pull }
```
- `schedule()` — debounced push (replaces the five `schedule*Sync`).
- `push()` — `setSyncStatus('saving…')` → idempotent `PUT /v1/progress/{appKey}` via the B1 transport; on failure → B2 queue + `'⚠ offline'`; on success → `'✓ synced'` and record the server `updatedAt` (for B4).
- `pull()` — server-wins-on-login: GET, if server has data → `apply(data)` + `afterPull?()`; else (fresh account) → `push()` to seed from local. **Preserve every existing pull side-effect** via `apply`/`afterPull`: custom→`rebuildData`, settings→`applyFurigana`+`paintPrefChips`+`renderSettings`, selftalk→migrate-phrases+repaint, minna→overlay merge.

Register all five blobs declaratively in [cloud.js](study-app/src/features/cloud.js) (and move
minna's into the registry). The [sync-bus.js](study-app/src/sync-bus.js) seam stays — `initCloud`
fills `sync.progress/custom/settings/selftalk` from the registry instead of four hand-written
schedulers. Net: ~80 lines of copy-paste → one tested abstraction + five ~3-line registrations.

### B4 — Optimistic concurrency on progress (concurrency safety)
- **Server (backward-compatible):** `PUT /v1/progress/{app}` accepts an optional `baseUpdatedAt`
  (body field) / `If-Unmodified-Since`. `db.upsertProgress` becomes a compare-and-set: if the stored
  `updated_at` ≠ `baseUpdatedAt` → **409** with the current `{ data, updatedAt }`. Omitting
  `baseUpdatedAt` keeps today's last-write-wins (no client is forced to upgrade). Files:
  [routes/progress.ts](wk-enhanced-api/src/routes/progress.ts),
  [db/repos/progress.ts](wk-enhanced-api/src/db/repos/progress.ts) (conditional UPDATE),
  [schemas.ts](wk-enhanced-api/src/schemas.ts) (`ProgressPutRequestSchema` + a 409 response), and
  new cases in [db/repos/progress.test.ts](wk-enhanced-api/src/db/repos/progress.test.ts).
- **Client:** each `SyncedBlob` remembers the last server `updatedAt`, sends it as `baseUpdatedAt`,
  and on **409** reconciles. MVP: pull server copy, re-apply, re-push (conflict *detected*, not
  silently clobbered). Better: per-blob merge (progress: `max(box)` + union sessions/daily). Ship the
  MVP first; note the merge as a deeper enhancement.

### Tests (Vitest + happy-dom — fills the feature-test gap)
- `study-app/test/net.test.js` (or `src/net/*.test.js`): transport — timeout fires; retry-then-succeed; give-up after N; `Retry-After` honored; **4xx never retried**; POST not retried unless opted in.
- queue — enqueue on failure; flush on `online`; dedup by key; survives a reload (localStorage round-trip); dropped on sign-out.
- synced-blob — `schedule` debounces/coalesces; `push` success/failure paths; `pull` server-wins vs fresh-account-seed; **409 → reconcile**.
- Mock `fetch` (happy-dom). Follow the existing pure-core test conventions in [study-app/test/core.test.ts](study-app/test/core.test.ts).
- Server: add `db/repos/progress.test.ts` compare-and-set cases (stale `baseUpdatedAt` → no write; matching → write) and a `routes` 409 path if route tests are added.

### Dead-ends to respect (B)
- **`cache: 'no-store'` on every `api()` fetch is LOAD-BEARING** — keep it; don't let a refactor/rename mangle the string (the `'no-state.store'` incident in [study-app/CLAUDE.md](study-app/CLAUDE.md)).
- **Cross-origin + credentialed:** every call rebases onto `API_BASE` and sends `credentials:'include'`; the cookie rides because the two origins are same-site. Don't switch to relative `/v1`.
- **Don't auto-retry** `POST /v1/sessions` or the binary recording upload without an idempotency key (see the table).
- **Preserve** server-wins-on-login + fresh-account-seeds-from-local, and every per-blob pull side-effect.
- The recording binary upload uses its **own** credentialed `fetch` (not `api()`) — keep `crossOrigin`/credentials if you route it through the new transport.

### Verification
`cd study-app && bun run test` (Vitest) + `bun run build` green. Then **browser-verify** the
resilience behavior (this part *is* observable): with `bun run dev` (:5173) + `bun dev` in
`wk-enhanced-api` (:3000), sign in, make a change **with the server stopped**, confirm `'⚠ offline'`
+ a queued write, restart the server / fire an `online` event, and confirm the queued write flushes
(server `GET /v1/progress/verbs` reflects it). Use `.claude/launch.json` preview configs.

---

## Workstream C — `record-compare.js` decomposition (high-risk, do last / optional)

> **📋 Detailed, executable guide: [docs/RECORD_COMPARE_DECOMP.md](docs/RECORD_COMPARE_DECOMP.md)** —
> the full function→module inventory, the shared-singleton split strategy, the 13-export contract,
> the phased commits (C0 test-net first, then C1+), and the dead-end checklist. The summary below
> is the orientation; do the work from that doc.

> **✅ C SHIPPED (C0 + C1+).** **C0** moved the remaining inline pure helpers to `core/`
> (`core/recordings.js`: `chooseMime`/`RECORD_MIME_CANDIDATES`/`encodeWav`/`biasNative`/`biasTake`;
> new `core/refs.js`: the reference-variant selection + `parseControlCtx` + the `nativeUrl`/`takeUrl`/
> `refUrl`/`refClip` shapes, all `base`/`httpServed`/`prefs`-injected) behind the barrel, with
> **+39 characterization tests** (`record-compare-core.test.js`). **C1+** then split the 854-line glue
> into `features/record-compare/{state,capture,takes,playback,waveform,view}.js` behind `index.js`,
> with `features/record-compare.js` kept as a thin `export *` re-export so **minna.js + selftalk.js
> import byte-for-byte unchanged** (the 13-export contract held). 8 commits total (C0 + C1.0–C1.6),
> each green (`bun run test` 180→182, `bun run build`) + browser-smoked; the live mic-driven flow needs
> a manual pass (headless blocks `getUserMedia`). As-built: see
> [docs/RECORD_COMPARE_DECOMP.md](docs/RECORD_COMPARE_DECOMP.md) Phases C0 + C1+.

### Honest framing
[study-app/src/features/record-compare.js](study-app/src/features/record-compare.js) is 853 lines,
**but its pure logic is already extracted** into [core/recordings.js](study-app/src/core/recordings.js)
(`findTrimBounds`, `waveformPeaks`, `normGains`, `rmsLevel`, `clampSpeed`, `clampKeep`,
`resolveClip`, …) and [core/audio.js](study-app/src/core/audio.js) (`resolveVariant`, `variantOrder`).
So the remaining lines are **irreducible browser-API glue** (MediaRecorder, Web Audio decode,
`<canvas>`, `<audio>`, DOM). The SRP win is real but modest, and there are **no feature tests**
today and several load-bearing dead-ends. **Lowest leverage of the three — do it last, in small
browser-verified commits, only if the file's size is actively slowing work.**

### Steps
1. **Characterization-test net FIRST.** Extract any *remaining* pure helpers still inline
   (`pickMime`, `encodeWav`, `micConstraint`, the URL builders `nativeUrl`/`takeUrl`/`refUrl`, the
   variant helpers `controlCtx`/`refAvailable`/`referenceVariants`) into `core/` and unit-test them.
   This is the safety net before moving stateful glue.
2. **Split by responsibility** into `study-app/src/features/record-compare/` (keep `index.js`
   re-exporting the *same* public names so [minna.js](study-app/src/features/minna.js) +
   [selftalk.js](study-app/src/features/selftalk.js) imports don't change):
   - `capture.js` — speaking mode (`enter/exitSpeakingMode`, `liveStream`), mic pick (`enumerateMics`, `setSelectedMic`, `micConstraint`), `MediaRecorder` lifecycle, WAV encode + `maybeTrim` (calls core `findTrimBounds`).
   - `takes.js` — take store (`loadRecordings`/`takesFor`/`setTakes`/`newestTakeIdForItem`), the credentialed upload + list/delete.
   - `playback.js` — `<audio>` elements, `playRange`/`playTake`/`playReference`, `applySpeed`, volume/`normGains`, the you/reference/seq/both/loop players, cursors.
   - `waveform.js` — `fetchAudioBuffer` (credentialed) + decode cache, `paintCompareWaveforms`/`drawWave`, `windowFor`/`speechWindow`.
   - `view.js` — HTML builders (`recordControlHtml`, `speakingBarHtml`, `bias/speedControlHtml`, `micOptionsHtml`) + the once-attached delegated handlers.
3. Keep the **shared speaking-mode singletons + `setOnTakeSaved` hook** semantics intact (shared module-global with Minna AND Self-Talk; the `SELFTALK_SCOPE` take-saved filter; the `visibilitychange` guard on the active panel).
4. Browser-verify after **each** commit.

### Dead-ends to respect (C) — all in [study-app/CLAUDE.md](study-app/CLAUDE.md)
The AirPods-HFP mic-`deviceId` pin; the windowed-playback alignment (`playRange` + `COMPARE_TRIM`,
**not** Media-Fragments `#t=`); the canvas-waveform decode-fails-safe; the **once-attached**
delegated handlers (re-attaching per render stacks listeners); the navbar-`#navExtra` speaking bar
vs `#mnBody` controls split; speaking-mode keeps ONE mic stream open. Don't "tidy" any of these.

### Verification
`cd study-app && bun run test` + `bun run build`; then a full browser pass: record a take, compare
▶ you / reference / →you / both / loop, waveforms render, speed + bias work, mic picker, and Self-Talk
+ Minna both still drive the engine. This is browser-observable — use the preview workflow, not just tests.

---

## Enhancement follow-ups (post-B)

> **✅ E1 + E2 + E3 ALL SHIPPED** (4 commits). **E1** — `createSyncedBlob` gained an injected
> `merge(local, server)` strategy; on a 409 it UNIONS local+server (no data loss) and re-pushes with
> the server's `updatedAt` as base, guarded to a single round (2nd 409 → server-wins). Pure per-blob
> mergers in [study-app/src/core/merge.js](study-app/src/core/merge.js) — progress (max box/due/counts,
> session dedup-by-`t` cap 1000, daily max), custom-verbs (union by rank, seq=max), minna
> (notes/overlays/clips union, local wins per key), selftalk (max streak/later day); settings stays
> server-wins. **E2** — `idempotency_key` on `study_sessions` + `minna_recordings` via a new guarded
> `ensureColumn`/`migrate` step in [db/connection.ts](wk-enhanced-api/src/db/connection.ts) (SQLite has
> no `ADD COLUMN IF NOT EXISTS`) + a partial unique index; `insertSession`/`insertRecording` dedup on
> the key (race backstop via the index); `POST /v1/sessions` takes `idempotencyKey`, the upload takes
> `?idem=` and early-returns the prior take. Client: `logSession` now retries + offline-queues (key
> `session:<uuid>`); the upload sends `?idem=`. **E3** — the binary upload routes through the resilient
> transport (`api(path, {rawBody, contentType, retry:true})` — new `rawBody` path sends a Blob verbatim,
> JSON callers unchanged); idempotency makes the retry safe; the multi-MB blob is intentionally NOT
> offline-queued. +tests both sides (study-app 198 · server 246 · typecheck/build green). The MVP
> caveats below are now resolved; kept as the as-designed record.

B shipped an MVP with two deliberate simplifications + left two durability gaps. These are the
natural next enhancements — independent, each small, each shippable on its own. Do them **after C**
(or interleaved — they don't depend on C). None are blocking; the app is correct without them.

### E1 — Per-blob merge on 409 (replace the server-wins MVP)
Today a 409 reconcile is **server-wins apply** ([study-app/src/features/synced-blob.js](study-app/src/features/synced-blob.js)
`reconcile()`): the other device's copy is adopted, the local unsynced change is dropped (detected,
not silently clobbered). Better: a per-blob **merge** so neither side loses data.
- Add an optional `merge(localData, serverData) → mergedData` to `createSyncedBlob`; `reconcile`
  calls it, `apply`s the merged result, then **re-pushes** with the server's `updatedAt` as the new
  base (guard recursion: at most one merge-push round; a second 409 falls back to server-wins).
- Per-blob mergers: **progress** — union `cards` by `max(box)` + later `due` + summed `attempts`,
  concat+dedup `sessions`, sum `daily`; **minna** — shallow-merge `notes`/`overlays`/`clips`
  (newest wins per key); **settings** — small enough that server-wins is fine (skip or last-writer);
  **custom-verbs** — union by `rank` (keep the newer per card); **selftalk** — practice `max(streak)`.
- Tests: `synced-blob.test.js` — a 409 with divergent local+server merges (not just adopts) and
  re-pushes the union. Keep the recursion guard pinned.

### E2 — Idempotency keys for the non-idempotent writes (make them durable)
`POST /v1/sessions` (`logSession`) and the binary recording upload are fire-and-forget today
(a dropped POST loses a session / a take) because a blind retry would duplicate a row. Give each a
**client-generated idempotency key** the server dedups on — then they can be retried + queued like
the progress PUTs.
- **Server:** add an `idempotency_key` (TEXT) column/param to `POST /v1/sessions`
  ([wk-enhanced-api/src/routes/sessions.ts](wk-enhanced-api/src/routes/sessions.ts) +
  [db/repos/studySessions.ts](wk-enhanced-api/src/db/repos/studySessions.ts)) and to
  `POST /v1/audio/recordings` ([routes/audio.ts](wk-enhanced-api/src/routes/audio.ts) +
  [db/repos/recordings.ts](wk-enhanced-api/src/db/repos/recordings.ts)); on a replay of a seen key,
  return the existing row instead of inserting. Unique index on `(user_id, idempotency_key)`.
- **Client:** generate a UUID per session/take; allow these POSTs to opt into transport retry
  (`{retry:true}`) and into the offline queue (`net/sync-queue.js`) — extend the queue to carry
  non-`progress:` keys, and `logSession`/`uploadTake` enqueue on failure. Update the idempotency
  table in this doc + the "stays un-queued/un-retried" notes in [study-app/CLAUDE.md](study-app/CLAUDE.md).
- Tests: server dedup (same key → one row, returns existing); client retry/queue for these POSTs.

### E3 — (optional) route the recording upload through the transport
Once E2 makes the upload idempotent, fold its bespoke `fetch` ([record-compare.js](study-app/src/features/record-compare.js)
`uploadTake`) onto the B1 transport (`api`, `{retry:true}`) so it inherits timeout/backoff —
keeping `credentials:'include'` + the binary body + `Content-Type` passthrough.

### Beyond the refactor
Not part of this doc, but the next product threads (see [NEXT_STEPS.md](NEXT_STEPS.md) +
[NEW_FEATURES.md](NEW_FEATURES.md)): the ⭐ **tokenization-granularity** NLP rework
([SENTENCE_STORE_PHASE4.md](SENTENCE_STORE_PHASE4.md) §8.0) and the **prod deploy** of the
templates/annotations seed steps. Separate sessions.

---

## Workstream S — `features/songs.js` decomposition (study-app)

> **C0 SHIPPED** (`b0b1b17`) — the inline pure logic (`readingMatch`, `lineReading`,
> `parseSongLineKey`, `buildSongCard`/`songCardKey`) moved to the unit-tested
> [study-app/src/core/songs.js](../study-app/src/core/songs.js) (+ `parseSongLineKey` hardened
> against the `Number('')===0` footgun). **C1.0 SHIPPED** (`be89442`) — `features/songs.js` became
> the `features/songs/` package (verbatim move to `songs/index.js` + a thin `export *` re-export so
> `main.js`/`cloud.js` are unchanged; built bundle byte-identical). **C1.1+ SHIPPED** (`70412d5`) —
> the 824-line `index.js` split into `state.js` (the shared `S`) + per-mode modules
> (`library`/`add`/`read`/`listen`/`shadow`/`mine`/`progress`) behind the orchestrator `index.js`;
> all view-state routes through `S`, verified by `bun run build` (74 modules resolve) + 214 tests + an
> exhaustive grep audit (every state ref `S.`-prefixed). **The design + steps below are kept as the
> as-built record.** One thing still owed: a **live browser pass** of the mic / YouTube / Listen-stepper
> flows (headless blocks `getUserMedia` + the iframe) — the checklist is in *Verification* below.

### Honest framing (why it's gated on a browser)
[study-app/src/features/songs/index.js](../study-app/src/features/songs/index.js) is ~790 lines of
**irreducible DOM / YouTube / record-compare glue** over a set of mutable module-`let` view-state
singletons (`view`/`openSong`/`mode`/`listen`/`add`/`library`/…). The pure logic is already in
`core/songs.js` (C0). Decomposing the glue REQUIRES centralizing that state into a shared mutated-in-
place object (the record-compare `state.js` pattern) and routing every reference through it — and a
**missed reference is a runtime `ReferenceError` that `bun run build` + the pure-core tests can't
catch** (esbuild treats a bare identifier as a global). So every step must be **browser-smoked** (and
headless blocks `getUserMedia` + the YouTube iframe → it's a manual pass, exactly like record-compare).
This is the lowest-leverage refactor on the board; do it only when the file's size is actively slowing
work, one small commit at a time.

### Target design (mirror `features/record-compare/`)
```
features/songs/
  state.js     # the shared mutable `S` (loaded, library, libFilter, view, openSong, mode, grammarRef,
               #   add, listen, recordingsLoaded) + consts (CACHE_KEY, LV_CLASS, SLOW_RATE,
               #   SONGS_SCOPE) + body(). Mutated IN PLACE (the study-app state.js pattern).
  library.js   # cache + fetch + grid: readCache/writeCache/loadLibrary/normalizeLine/loadSong/known
               #   + libraryHtml/songCardHtml
  add.js       # paste→analyze→review→save: addHtml/runAnalyze/saveSong
  read.js      # Read viewer + player: readHtml/starBtnHtml/toggleFurigana + mountSongPlayer/
               #   highlightAt/replayLine
  listen.js    # dictation stepper: ensureListen/resetListenStep/listenHtml/listenCardHtml/
               #   clozeBodyHtml/fullBodyHtml/listenAnswerHtml/renderListen/captureListenInputs/
               #   gradeListen/playListenLine
  shadow.js    # record-and-compare: shadowHtml/wireShadow/renderShadow/songNav/clearNavSpeaking/
               #   playShadowSlice/onSongTakeSaved
  mine.js      # vocab + grammar: mineHtml/grammarRefHtml/savePhrase/goBrowseGrammar +
               #   activateSongWords/addOneWord/addAllNew
  progress.js  # the `songs` blob: progressFor/songEntry/markShadowed/toggleStar/restoreMode/noteMode
  view.js      # song shell + central dispatch: songHtml + renderSongs/render
  handlers.js  # onClick/onKeydown/openById/flash
  index.js     # barrel: export { initSongs, renderSongs, onSongsHidden } (the 3 names consumers use)
```

### Steps (one commit each, browser-smoke each)
- **C1.1 — `state.js`.** Extract the singletons + consts + `body()` into `songs/state.js` as `S`;
  convert `index.js`'s references to `S.*`. Audit: after, grep `index.js` for the unambiguous names
  (`\b(openSong|libFilter|grammarRef|recordingsLoaded)\b` must be only `S.`-prefixed); the ambiguous
  ones (`view`/`mode`/`add`/`listen`/`library`/`loaded` also occur in strings/identifiers) must be
  read-and-converted by hand, not sed'd. Browser-smoke EVERY mode.
- **C1.2..C1.9 — peel one module per commit** (listen → shadow → mine → library → add → read →
  progress → view+handlers): move its functions to the sibling file, importing `S` + the cross-module
  fns it calls; add its public names to `index.js`. Runtime-only import cycles are fine (the cloud⇄minna
  + record-compare precedent). Browser-smoke the peeled surface after each.

### Dead-ends to respect (study-app CLAUDE.md + SONGS.md)
- The `#sgContent` stable wrapper (Listen/Shadow re-render WITHOUT remounting the YouTube iframe —
  don't route them through `render()`). The `#sgBody._sgWired` **once-attached** delegated
  onClick/keydown + `wireWordTaps` + `setOnTakeSaved(SONGS_SCOPE filter)` + the `visibilitychange`
  guard (re-attaching stacks listeners). The navbar `#navExtra` speaking-bar lifecycle. `S` is mutated
  IN PLACE, never reassigned (ES `let` can't be cross-module-mutated). Don't "tidy" any of these.

### Verification (per commit)
`cd study-app && bun run test && bun run build`, then the manual browser pass: Library filter; Add
(paste→analyze→save — needs the API + an `ANTHROPIC_API_KEY`, else the 503 state); Read (furigana
toggle, tap-a-word, line replay ▶, synced highlight); Listen (cloze⇄full, Check/Reveal/Next, the timed
slice + Slower); Shadow (sign in, Practice-speaking, record a line, ▶you/ref/both/loop, ▶original, the
shared day-streak); Mine (add word / add all, grammar ref, save-as-phrase). Headless blocks
`getUserMedia` + the YouTube iframe, so this is a human pass — same as record-compare's live flow.

---

## Workstream T — cross-feature dedup after the multi-source churn

The Minna-Phase-2 / Self-Talk / Songs surfaces were each built in their own workstream, and each
re-implemented two cross-cutting concerns from scratch — classic "same concept, copy-pasted from
multiple sources" drift. This pass collapses them. Ship as independent commits, low→high risk.

| Sub | Win | Risk | Status |
|---|---|---|---|
| **T1** read-through localStorage cache | DRY — 4 hand-rolled `try/JSON` cache trios → 1 tested helper | LOW (pure storage, full unit cover) | **✅ SHIPPED** |
| **T2** speaking-bar controller | DRY + Open/Closed — 3 copies of the `#navExtra` toggle/mic/visibility lifecycle → 1 | MED (live-mic dead-ends; wiring unit-tested, mic flow needs a browser pass) | **✅ SHIPPED** |
| **T3** `selftalk.js` package decomposition | SRP — the last un-split "speaking surface" (634 lines) → a per-concern package | HIGH (shared-mutable-`S` + runtime cycles + live mic; browser-smoke each peel) | **✅ SHIPPED** |

### T1 — `persistence/cache.js` `createReadThroughCache` (✅ SHIPPED)
The "warm from the last good fetch, degrade to cache on failure" `localStorage` primitive was
open-coded — with subtly varying try/catch — in **four** places: `selftalk.js` phrases AND templates
(twice in one file), `songs/library.js`, and `persistence/examples.js`. Now one
`createReadThroughCache({ key, validate, fallback }) → { read, write }`, adopted at all four sites
(byte-for-byte behavior; `validate`/`fallback` injected so the examples object-map + the array caches
keep their exact shape guards). +8 unit tests (`test/cache.test.js`): round-trip, miss/corrupt/
wrong-shape degrade, fresh-empty-per-call, swallow-all on a throwing get/setItem.

### T2 — `features/speaking-bar.js` `createSpeakingBar` (✅ SHIPPED)
`clearNavSpeaking()` was **byte-identical** in `minna.js`, `selftalk.js` and `songs/shadow.js`, and
each surface's `renderNavSpeaking`/`songNav` re-built the same `#navExtra` bar (toggle → enter/leave
speaking mode + lazy take-cache load + re-render; mic picker) plus its own `visibilitychange`
mic-release. Now one `createSpeakingBar({ shouldShow?, render, scope?, isLoaded?, markLoaded? }) →
{ mount, onToggle }` + a shared `clearSpeakingBar()` + `releaseMicIfHidden(isActive?)`. Each surface
passes only what differs (show-gate, re-render, reserved `scope`); adding a 4th speaking surface is
now a config object, not a copy-paste. Behavior preserved exactly, including みんなの日本語's unguarded
"primary" visibilitychange vs Self-Talk/Songs' panel-active guard. +16 unit tests
(`test/speaking-bar.test.js`, engine mocked). **Mic/record/compare flow needs a manual browser pass**
(headless blocks `getUserMedia`) — checklist mirrors Workstream S's *Verification*.

### T3 — `selftalk.js` → `features/selftalk/` package (✅ SHIPPED)
The 634-line `selftalk.js` was the only record-compare surface never split (record-compare + songs
both got the per-module treatment). Now mirrors `features/songs/`: a shared mutable `S` (state.js) +
per-concern modules behind an `index.js` orchestrator/barrel, with `features/selftalk.js` a thin
`export *` re-export so `main.js`/`cloud.js` import byte-for-byte unchanged (public API:
`initSelftalk`/`showSelftalk`/`onSelftalkHidden`/`refreshPhrases`/`refreshTemplates`/`renderSelftalk`).
As-built modules: **state** (the `S` + consts + el accessors), **store** (caches + refresh + phrase/
template-set accessors + `maybeMaterialize`), **view** (the render entry + head + phrase/template card
builders + grid/topic + slot menus + `toggleGrammar`), **practice** (the streak mark), **authoring**
(the #stPhraseModal CRUD), **speaking** (the `createSpeakingBar` bar + visibilitychange) — the sketch's
"templates" concern folded into store (materialize) + view (slot HTML), like Workstream D's
templates-module deviation. The view⇄speaking import cycle is runtime-only (fine, like cloud⇄minna).
Every state ref is `S.`-prefixed (grep-audited). **Risk mitigation beyond Workstream S:** because a
missed bare identifier is a runtime `ReferenceError` that `bun run build` can't catch (esbuild treats
it as a global) and headless can't run the mic flow, a NEW **render integration test**
(`test/selftalk-render.test.js`, engine/audio/network mocked) imports the package and DRIVES
`renderSelftalk`/`drillTopic`/`toggleGrammar`/`initSelftalk` under happy-dom — so a broken render-path
reference fails a test, not just the browser. 244 study-app tests green; `bun run build` clean
(83 modules). The live mic/record/template-combo flow still wants a manual browser pass (checklist below).

---

## Workstream M — `features/minna.js` decomposition (study-app)

> **✅ SHIPPED** (3 commits). minna.js was the **last large feature module never decomposed** — every
> sibling speaking surface (record-compare/, songs/, selftalk/) had already been split, but the
> 540-line みんなの日本語 dashboard still mixed persistence, cloud sync, vocab-activation domain glue,
> rendering, the clip-marker UI, and lifecycle in one file (7 commits of multi-source churn). Done in
> the established order: **M0** (pure-helper test-net + DRY) → **M-test** (render integration test) →
> **M1** (the package split).

| Sub | Win | Risk | Status |
|---|---|---|---|
| **M0** pure activation planner + helpers → core | DRY/SRP — the preview-count + the apply re-derived the same per-word verdict twice; now one pure `planMinnaActivation` (decision) replayed by a thin apply (effect). +`buildMinnaCard`/`buildMinnaOverlay`/`minnaOverlaySig`/`kanjiNum`/`normalizeMinnaStore` moved to core. +10 unit tests. | LOW (pure, behavior-preserving) | **✅ SHIPPED** (`6490887`) |
| **M-test** render integration test | The decomposition safety net — drives `renderMinna`→every section + the gate/speaking/clip/add-deck/notes paths under happy-dom (engine/audio/net/persistence/cloud mocked), so a missed cross-module reference fails a test, not just the browser. Mirrors `selftalk-render.test.js`. | LOW | **✅ SHIPPED** (`2817692`) |
| **M1** `features/minna/` package | SRP — `state`/`store`/`activate`/`clips`/`speaking`/`view` behind `index.js`; `minna.js` a thin `export *` re-export so main.js + cloud.js import byte-for-byte unchanged (all 8 public names flow through). | HIGH (runtime cycles + many dead-ends; mitigated by M-test) | **✅ SHIPPED** (`25989c0`) |

As-built: every dead-end preserved (credentialed cross-origin clip `<audio>` + `API_BASE` rebase,
attach-once clip wiring, the unguarded "primary" speaking-bar lifecycle, `state.minnaStore` mutated in
place, `loadRecordings` per-lesson-render); runtime-only import cycles (view⇄clips, view⇄speaking,
cloud⇄minna). 283 study-app tests green; `bun run build` clean (102 modules, bundle flat). **The live
mic/record/clip-marker flow still wants a manual browser pass** (headless blocks `getUserMedia` + the
cookie-gated `<audio>`), exactly like Workstreams C/S/T.

---

## Cross-cutting

- **Test commands.** Server: `cd wk-enhanced-api && bun run typecheck && bun test`. Study-app: `cd study-app && bun run test && bun run build`. Dev pair: `bun dev` (API :3000) + `bun run dev` (Vite :5173); browser preview via `.claude/launch.json`.
- **Commit discipline.** One logical change → one commit; D = 1 commit; B = 4 (B1–B4); C = several small browser-verified commits. Update the relevant `CLAUDE.md`/`NEXT_STEPS.md` in the same commit when structure changes.
- **The barrel pattern is now established** (`db/client.ts`). Reuse it verbatim for D, and for any future module that grows past ~one responsibility.
- This doc is the doc-of-record for these three; mark items done / move to `docs/history/` when shipped.
