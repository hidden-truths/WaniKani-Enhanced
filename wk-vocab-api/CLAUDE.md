# wk-vocab-api

## What this is

Backing API server for the [WK Vocab Review — ImmersionKit Examples](../wk-vocab-review-ik.user.js) userscript. Coalesces three external services (ImmersionKit, DuckDuckGo, Google Translate TTS) behind one pre-warmed endpoint so every userscript user doesn't hit those services individually.

**Status**: first-pass implementation done. Boots, warms, serves end-to-end against live IK / DDG / Google. Not yet deployed; userscript not yet migrated to call it. The userscript still calls the external services directly — the migration is the next planned chunk of work.

For the broader design rationale (cost model, why this exists, deploy story), see [../SERVER_DESIGN.md](../SERVER_DESIGN.md). The "Implementation deviations" section at the top of that doc is the most important part — it lists what changed during the build.

## How to work on it

```bash
cd wk-vocab-api
bun install               # one-time setup
cp .env.example .env      # one-time setup
bun dev                   # hot-reload via --watch
bun test                  # bun:test runner; ~50 tests, ~30ms
bun run typecheck         # tsc --noEmit
```

That's it. **No Docker, no Postgres, no MinIO** — Bun has built-in SQLite (`bun:sqlite`) and S3 (`Bun.S3Client`); dev uses SQLite + the local filesystem, prod swaps to an S3-compatible bucket via `STORAGE_DRIVER=s3`. The "Docker + Postgres + MinIO" story in the original SERVER_DESIGN.md was the original plan; we dropped it.

When you change code:

1. `bun dev`'s watch mode hot-reloads on save — no manual restart.
2. **Run `bun test` and `bun run typecheck`** before committing. Both are fast.
3. **Add a test** for any new pure function. Service-layer / route changes can defer testing until they stabilize, but pure logic (URL builders, JLPT scoring, title decoding) should always have tests — these are the things future refactors break silently.
4. **One commit per logical change.** Same convention as the userscript repo. Don't batch unrelated work.

## Architecture

```
src/
├── index.ts                  # OpenAPIHono app, CORS + request log, /docs, /openapi.json, static /media route, boot
├── config.ts                 # env-var loading; everything goes through here, no process.env scattered
├── schemas.ts                # Zod schemas → single source of truth for runtime validation + OpenAPI generation
├── db/
│   ├── schema.sql            # SQLite tables (3): vocab_examples, index_meta, warm_jobs
│   └── client.ts             # repo functions; no SQL escapes this file
├── lib/
│   ├── jlpt.ts               # scoreJlpt() — direct port of userscript logic; bundled JLPT_VOCAB at data/jlpt-vocab.json
│   ├── ikTitles.ts           # the lossy-title-encoding workaround (heuristic fallback when /index_meta misses)
│   ├── log.ts                # structured-JSON logger; one line per event
│   ├── zodHook.ts            # shared defaultHook → reformats Zod failures into our ErrorSchema shape
│   └── sleep.ts
├── routes/                   # one file per route group; each is an OpenAPIHono sub-router
│   ├── health.ts
│   ├── vocab.ts              # GET /v1/vocab/{word} + POST /v1/vocab/batch
│   ├── indexMeta.ts
│   └── admin.ts              # POST /v1/admin/warm + GET /v1/admin/jobs (bearer-gated)
├── services/
│   ├── ik.ts                 # /search, /index_meta, /download_media — built-in 500ms rate limit
│   ├── ddg.ts                # two-step vqd HTML scrape → i.js JSON
│   ├── tts.ts                # Google Translate TTS (client=gtx, Referer spoof)
│   ├── wk.ts                 # WK v2 API for vocab corpus enumeration; needs WK_API_TOKEN
│   └── storage.ts            # storage abstraction: LocalStorage + S3Storage drivers behind one interface
└── warm/
    └── pipeline.ts           # warmWord (single) + warmAll (corpus); see "Warm pipeline" below
data/
└── jlpt-vocab.json           # 7604-entry JLPT word list, extracted from the userscript. Bundled (~93KB).
```

### Dependencies (kept minimal)

- **`hono`** — HTTP framework. Tiny, fast, runs natively on Bun.
- **`@hono/zod-openapi`** — wraps Hono routes with Zod schemas. Single source of truth for validation + OpenAPI docs.
- **`zod`** (v4) — schemas.
- **`@scalar/hono-api-reference`** — FastAPI-style docs UI at `/docs`.
- **Bun built-ins** for SQLite (`bun:sqlite`) and S3 (`Bun.S3Client`) — no external DB driver, no AWS SDK.

That's the entire `dependencies` block. Resist adding more without a clear win.

## Cache keys / data on disk

Three SQLite tables (schema in [src/db/schema.sql](src/db/schema.sql)):

- `vocab_examples` — pre-warmed payload per word. One row per word. `payload` is JSONB-style TEXT (the entire response body). `serve_count` + `last_served_at` track usage (for LRU eviction later if needed).
- `index_meta` — singleton row (`id=1`) caching IK's `/index_meta` deck map (~96 entries, ~12KB).
- `warm_jobs` — append-only audit log. One row per `warmSingle` or `warmAll` invocation. Exposed via `GET /v1/admin/jobs`.

Media binaries live in **either** the local filesystem (`STORAGE_DRIVER=local`, dev) **or** S3-compatible storage (`STORAGE_DRIVER=s3`, prod). Object key conventions:

- `audio/<category>/<encodedTitle>/<exampleId>.mp3` — IK voice-actor recording, OR Google TTS fallback (same key, the `hasOriginalAudio` flag on the payload distinguishes).
- `image/<category>/<encodedTitle>/<exampleId>.jpg` — IK screenshot.
- `ddg/<word>/N.jpg` — DuckDuckGo illustration fallback pool, up to 10 per word.

The encoded title stays UTF-8 / IK-snake-case in the key; the storage layer owns URL encoding (don't pre-encode in `keys.*` helpers — that was a wart in v0.x and is fixed). DDG keys preserve raw Japanese characters in the path (filesystems handle UTF-8 fine, and the URL gets percent-encoded once on serve).

## Warm pipeline (the heart)

Per word, in order:

1. **Fetch IK examples** via `/search?q=<word>&exactMatch=true&limit=1000`. We *request* 1000; IK serves up to ~500. We then **cap at 50** in the payload — more than enough for the picker, ~10–20× smaller payloads than the unbounded version. Sorted to prefer entries with `sound` (voice-actor audio) first.
2. **JLPT-score** each example via `scoreJlpt(word_list, targetWord)` — same fail-open semantics as the userscript: unknown tokens silently skipped, 0 returned when the entire `word_list` is unknown. See [src/lib/jlpt.ts](src/lib/jlpt.ts) + [src/lib/jlpt.test.ts](src/lib/jlpt.test.ts).
3. **Resolve title + category** from cached `/index_meta`. Falls back to the regex heuristic in [src/lib/ikTitles.ts](src/lib/ikTitles.ts) on misses — same dead-ends as the userscript (see warnings below).
4. **Per example, in parallel batches of 4**: try IK `/download_media` proxy for audio (`Referer: immersionkit.com` spoof, treat <1KB body as miss). On miss, fall back to Google TTS (`client=gtx`, `Referer: translate.google.com` spoof, 200-char truncation). Upload to storage at the audio key. Same shape for image (no TTS fallback — image misses just leave `imageUrl: null` and clients fall back to the DDG pool).
5. **Fetch DDG fallback pool** for the word — two-step (HTML page for `vqd` token, then JSON `/i.js`). Up to 10 images per word, uploaded to `ddg/<word>/N.jpg`. Best-effort: if DDG breaks, the word still serves, just without fallback illustrations.
6. **Compose payload + upsert** to `vocab_examples`. `serve_count` is **preserved** across re-warms (so usage stats survive monthly refresh).

Idempotency: re-running the warm overwrites in place. Object keys are stable across runs (based on `exampleId` from IK or a content hash if IK gives us no id). Skipped if `fetched_at` is within `WARM_REFRESH_DAYS` (default 30) unless `force: true`.

Concurrency model: per-word work runs sequentially in `warmAll`. Per-example media downloads inside one word run in parallel (4-wide). IK has a global 500ms rate limit (`lastIkCallAt` shared module state in `services/ik.ts`) — so bulk warming is multi-hour. Acceptable for monthly cron, not interactive.

Lazy fill (`GET /v1/vocab/{word}` on a cold word) calls `warmWord()` synchronously. The client blocks for 10–30s but every subsequent client hits the cached payload instantly. Use `?nowarm=true` to skip this for prefetch flows.

## External services

- **`apiv2.immersionkit.com/search`** — sentence + translation source. Built-in 500ms rate limit. Normalizes `examples` shape across IK API versions.
- **`apiv2.immersionkit.com/index_meta`** — canonical encoded-title → `{title, category}` map. Cached 7d. **This is the only reliable way to map IK's lossy encoding** (e.g. `kanon__2006_` → `"Kanon (2006)"`); the heuristic is fallback-only.
- **`apiv2.immersionkit.com/download_media`** — proxy for audio + image binaries. Requires `Referer: https://www.immersionkit.com/`. Bodies <1KB are treated as miss (proxy returns near-empty for missing files).
- **`translate.googleapis.com/translate_tts`** — Google TTS fallback when IK has no `sound`. Spoofed `Referer: https://translate.google.com/`, `client=gtx`. Truncates input to 200 chars.
- **`duckduckgo.com`** — two-step image search (`vqd` token, then `i.js`). Fallback image pool for cycling.
- **`api.wanikani.com/v2/subjects?types=vocabulary`** — used **only** by `warmAll` to enumerate the WK vocab corpus. Requires `WK_API_TOKEN` (maintainer's personal token, not per-user). 60 req/min limit; we sleep 1.1s between pages.

## API surface

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/health` | — | Liveness + `lastWarm`. `Cache-Control: no-store`. |
| GET | `/v1/vocab/{word}` | — | Main client endpoint. Returns `ETag` for conditional GETs. `?nowarm=true` skips lazy fill. |
| POST | `/v1/vocab/batch` | — | Bulk fetch up to 50 words. Returns `{found, missing}`. Never warms — clients fire individual GETs for misses. |
| GET | `/v1/index_meta` | — | Cached IK deck map. |
| POST | `/v1/admin/warm` | Bearer | Three scopes: `word` (sync), `all` (async), `index_meta`. |
| GET | `/v1/admin/jobs` | Bearer | Recent warm-job audit records, newest-first. |
| GET | `/media/*` | — | Static media (LocalStorage driver only). |
| GET | `/docs` | — | Scalar UI. |
| GET | `/openapi.json` | — | Auto-generated OpenAPI 3.1 spec. |

**Error response contract** — every non-2xx response is `{ code, error, detail? }`. Switch on `code` (stable enum), never on `error` (human-readable, may change). The enum: `validation_error`, `unauthorized`, `not_found`, `upstream_failure`, `service_unavailable`, `internal_error`.

**Conditional GETs** — `GET /v1/vocab/{word}` returns a strong `ETag` derived from the payload's `fetchedAt`. Clients should cache the ETag and send `If-None-Match` on revisits; we 304 No-Content until the next warm refresh.

## Things that look like bugs but aren't (DEAD-END WARNINGS)

These have been investigated; don't re-explore.

- **IK title encoding is lossy and there is no clean heuristic recovery.** Multiple original titles collapse to the same encoded form (`"Kanon (2006)"`, `"Kanon  2006-"` → `"kanon__2006_"`). The regex heuristic in [src/lib/ikTitles.ts](src/lib/ikTitles.ts) is fallback-only and provably wrong for `durarara__` → "Durarara" (real: "Durarara!!") and similar. The fix is **always** the `/index_meta` map, not a smarter heuristic. The dead-end cases are pinned as tests in [src/lib/ikTitles.test.ts](src/lib/ikTitles.test.ts) — if anyone tries to "fix" the heuristic they'll see the tests intentionally pinning wrong output with a pointer to the right answer (use the map).

- **IK's direct media bucket (`us-southeast-1.linodeobjects.com/immersionkit/...`) is offline since Aug 2025.** Returns 403 even with spoofed headers. The working path is the `apiv2.immersionkit.com/download_media?path=...` proxy. **Do not try the linode URLs.**

- **JLPT scoring is fail-open by design — that's not a bug.** IK's `word_list` returns surface forms (`食べた`, `見て`); our bundled `JLPT_VOCAB` only has dictionary forms (`食べる`, `見る`). So unknown-token rates are high. We deliberately treat unknown tokens as a skip rather than as "above N1" — including them would over-filter (almost any sentence with a conjugated verb would score above ceiling) and the fail-open default would kick in constantly. **Do not add stem-mapping or suffix-stripping heuristics** unless you have a real morphological analyzer (kuromoji/MeCab); brittle suffix tricks create more false matches than they solve. Sentences with entire-unknown `word_list` score 0 (sentinel); `pickExample` treats 0 as fail-open (always passes the ceiling test).

- **SQLite is the DB even in production.** The original SERVER_DESIGN.md said Postgres; we deviated. The data model is K-V with JSON payloads, the corpus is bounded (~6500 rows), and a single droplet doesn't need a network DB. The repo functions in [src/db/client.ts](src/db/client.ts) hide all the SQL so migrating to Postgres later is mechanical if scale demands it. **Don't pre-emptively add Postgres** "to be safe" — the SQLite story is deliberate.

- **Bulk warm is multi-hour and that's fine.** ~6500 words × ~50 examples × per-example media downloads × 500ms IK rate limit = several hours. It's a monthly cron job; nobody is waiting on it. **Don't add aggressive concurrency to "speed it up"** — IK is a free, community-supported service; we want to be a polite client.

- **Storage `keys.ddg` does NOT pre-encode the word.** Earlier versions did, which caused double-encoding (`%25E9` in URLs). The storage layer (`LocalStorage.publicUrl` / `S3Storage.publicUrl`) owns all URL encoding. The on-disk filename for `食べる`'s DDG pool is literally `dev-data/media/ddg/食べる/0.jpg` (UTF-8 on disk), which serves as `/media/ddg/%E9%A3%9F%E3%81%B9%E3%82%8B/0.jpg`. Don't add encoding to the keys layer.

- **`/openapi.json` is auto-generated from Zod schemas; do not hand-write it.** Earlier we had a `src/openapi.ts` that was a hand-rolled spec; it's deleted. Add/change endpoints via `createRoute(...)` + a Zod schema in [src/schemas.ts](src/schemas.ts). The spec at `/openapi.json` and the docs at `/docs` update automatically.

- **`defaultHook` is per-`OpenAPIHono` instance, NOT inherited from the root app.** Every sub-router constructor must pass `{ defaultHook: zodHook }`. Easy to forget when adding a new route file — if validation failures suddenly return `{success, error}` instead of `{code, error, detail}`, that's the cause.

## Diagnostic helpers / local-dev playbook

**Boot & smoke-test:**

```bash
bun dev
# in another terminal:
curl http://localhost:3000/v1/health
curl -X POST http://localhost:3000/v1/admin/warm \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"scope":"word","word":"食べる"}'
curl http://localhost:3000/v1/vocab/食べる
```

Cold warm of one word against live IK takes ~15–30s. Subsequent reads are <10ms (SQLite + JSON in-memory parse).

**Docs UI:** open http://localhost:3000/docs in a browser. Lists every endpoint with schemas + "Try it" buttons that hit your running server. Set the bearer token once in the auth panel for the admin endpoints.

**When warm fails for a specific word:**

1. Check the log for `warm.ik_search_failed` (IK reachability) vs `warm.ik_audio_miss` (specific media file missing on IK).
2. If audio misses but TTS succeeds, that's normal for text-only literature sources.
3. If IK examples are returned but all media misses, suspect the **title encoding problem** — check `resolveIkFolderAndCategory()` against the live IK URL by hand-building one. The fix is usually that the word's deck isn't in our cached `/index_meta` map (refresh via `POST /v1/admin/warm {"scope":"index_meta"}`).

**When you change the schema:**

1. Update or add a Zod schema in [src/schemas.ts](src/schemas.ts).
2. If the change affects a stored payload shape, **bump `CACHE_SCHEMA_VERSION` equivalents** — currently there's no schema version pin on the server (the userscript has one); add one if mismatched cached data would be actively wrong rather than just stale.
3. The OpenAPI spec at `/docs` updates on next page-load — no separate spec-generation step.

**Test fixtures for JLPT scoring** — known levels from the bundled dict:

| Word | Level |
|---|---|
| `私`, `食べる`, `本`, `時間`, `お母さん` | 5 (N5 easiest) |
| `経済` | 4 (N4) |
| `一方` | 3 (N3) |
| `一定` | 2 (N2) |
| `一切`, `あくどい` | 1 (N1 hardest) |

Use these when writing new tests; they're verified in [src/lib/jlpt.test.ts](src/lib/jlpt.test.ts).

## Test conventions

- Test files live next to source as `*.test.ts`. Bun's runner picks them up automatically.
- **Pure functions get unit tests; integration tests are deferred.** We don't mock IK/DDG/Google in the test suite — those are flaky, slow, rate-limited. Integration verification is via manual `curl` against a running server.
- **DB tests use `openDb(':memory:')` + `_useDbForTesting(mem)`** in `beforeEach` for isolation. See [src/db/client.test.ts](src/db/client.test.ts). The `_useDbForTesting` export is test-only — don't call it from app code.
- **Dead-end cases are pinned to the wrong output**, not skipped. Example: `ikTitleToFolder('durarara__', null)` is asserted to be `'Durarara'` (intentionally wrong; the comment explains why). If a future agent tries to "fix" the heuristic they'll trip the test and find the pointer to the real solution (use the map).

## Cost & deploy (not yet built)

Target: DO Droplet ($6/mo) + DO Spaces ($5/mo) + Cloudflare in front (free) ≈ **$11/mo** steady state. SQLite means no managed-DB cost. Deploy story sketched in [../SERVER_DESIGN.md](../SERVER_DESIGN.md); not exercised yet.

## What's deliberately NOT in v1

- No accounts, no auth (except the admin bearer token).
- No keyed external services (DeepL, OpenAI, Forvo, jpdb). If we add them later, keys live on the client and we proxy without caching under keys the user can't reach.
- No analytics on what users review (only aggregate serve counts).
- No real-time / push features.
- No metrics endpoint beyond `/v1/health`. Structured JSON logs are the metrics surface.
- No tests for the route handlers themselves — pure-function coverage + manual curl is the contract. Route tests become valuable when the API shape stabilizes after the userscript migration.
