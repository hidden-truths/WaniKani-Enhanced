# REFACTOR_FOLLOWUPS.md

Implementation plan for the SOLID / quality workstreams that follow the **`db/client.ts`
God-Object split** (shipped to `main`, commit `c78cc63`). That refactor decomposed the
1,396-line server repo module into `db/connection.ts` + `db/repos/*` behind a re-export
barrel, with per-repo tests. This doc covers the remaining three workstreams from the same
review, in **recommended execution order**:

- **D** — `schemas.ts` → per-domain modules (LOW risk, mechanical — same playbook as `db/client`). Do first as a warm-up.
- **B** — study-app sync: DRY collapse + resilient transport + offline queue + optimistic concurrency (MEDIUM risk, the high-value one).
- **C** — `record-compare.js` decomposition (HIGH risk, lower leverage — its pure logic is already extracted). Do last / optional.

Each section is self-contained: problem → target design → concrete steps → files → tests →
dead-ends to respect → verification. Architecture/rationale lives in the two `CLAUDE.md`s;
this doc owns the *how-to-execute*.

| Workstream | Win | Risk | Effort | Order |
|---|---|---|---|---|
| **D** schemas split | SRP/ISP; co-locate schemas by domain | LOW (barrel + typecheck-guarded, zero behavior change) | ~1–2h | 1st |
| **B** sync DRY + resilience + concurrency | DRY + DIP + disconnection/concurrency resilience + new tests | MED (hot path; backward-compat progress contract) | ~1–2 days | 2nd |
| **C** record-compare decomp | SRP on the DOM/audio glue | HIGH (no feature tests, stateful audio, many dead-ends) | ~1–2 days | 3rd / optional |

> **Golden rule for all three:** zero behavior change unless explicitly designed (B's
> concurrency + queue). Keep the existing test suites green at every step, add tests for new
> code, and respect every DEAD-END WARNING in [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md)
> and [study-app/CLAUDE.md](study-app/CLAUDE.md). One logical change → one commit.

---

## Workstream D — `schemas.ts` → per-domain modules

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

## Cross-cutting

- **Test commands.** Server: `cd wk-enhanced-api && bun run typecheck && bun test`. Study-app: `cd study-app && bun run test && bun run build`. Dev pair: `bun dev` (API :3000) + `bun run dev` (Vite :5173); browser preview via `.claude/launch.json`.
- **Commit discipline.** One logical change → one commit; D = 1 commit; B = 4 (B1–B4); C = several small browser-verified commits. Update the relevant `CLAUDE.md`/`NEXT_STEPS.md` in the same commit when structure changes.
- **The barrel pattern is now established** (`db/client.ts`). Reuse it verbatim for D, and for any future module that grows past ~one responsibility.
- This doc is the doc-of-record for these three; mark items done / move to `docs/history/` when shipped.
