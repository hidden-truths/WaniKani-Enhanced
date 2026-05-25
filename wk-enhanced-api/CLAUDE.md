# wk-enhanced-api

## What this is

Backing API server for the [WKEnhanced](../wkenhanced.user.js) userscript. Coalesces three external services (ImmersionKit, DuckDuckGo, Google Translate TTS) behind one pre-warmed endpoint so every userscript user doesn't hit those services individually.

**Status**: deployed to production at `https://api.wkenhanced.dev` (DO droplet in SFO3 + DO Spaces, Cloudflare Tunnel for TLS/edge). Userscript v2.0.0 is server-only — every vocab lookup goes through this server. The v1.1.1 direct-path snapshot lives at [../legacy/wk-vocab-review-ik-direct.user.js](../legacy/wk-vocab-review-ik-direct.user.js) as a frozen fallback for users who need an option when the API server is unreachable. See [../CLIENT_MIGRATION.md](../CLIENT_MIGRATION.md) for the migration history.

Source directory was renamed from `wk-vocab-api/` → `wk-enhanced-api/` on 2026-05-25 to match the deployment. Production droplets predating that rename need a one-time `mv` step; see [deploy/README.md](deploy/README.md) "Updating a pre-rename droplet."

For the broader design rationale (cost model, why this exists, deploy story), see [../SERVER_DESIGN.md](../SERVER_DESIGN.md). The "Implementation deviations" section at the top of that doc is the most important part — it lists what changed during the build.

## How to work on it

```bash
cd wk-enhanced-api
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

## Dev ↔ prod parity

Single scannable reference for every knob that differs between local dev and the deployed droplet. Update this table whenever you add a config var or a service that varies by environment — keeps drift bugs visible at review time instead of letting them ship.

| Surface | Dev (`STORAGE_DRIVER=local`) | Prod (`STORAGE_DRIVER=s3`) | Notes |
|---|---|---|---|
| Bind host / port | `http://localhost:3000` | `http://127.0.0.1:3000` behind Cloudflare Tunnel → `https://api.wkenhanced.dev` | Bun listens locally either way; prod has cloudflared between the world and us. |
| `STORAGE_DRIVER` | `local` | `s3` | Validated at boot in [config.ts](src/config.ts) — `s3` requires the four S3_* vars below. |
| `LOCAL_MEDIA_DIR` | `./dev-data/media` | unused | Served via the `/media/*` static route in `index.ts`. |
| `MEDIA_PUBLIC_BASE` | `http://localhost:3000/media` | `https://wk-enhanced-api-media.sfo3.cdn.digitaloceanspaces.com` | Goes into payload `audioUrl` / `imageUrl` / `fallbackImages` verbatim. Always no trailing slash (config strips). |
| Media Cache-Control | `public, max-age=31536000, immutable` set on the `/media/*` route | Same string written as S3 object metadata on upload; DO Spaces CDN returns it as the response header | Single source of truth: `MEDIA_CACHE_CONTROL` const in `services/storage.ts`. Object keys are content-addressed so `immutable` is correct — the bytes for any URL never change after first write. |
| `DATABASE_FILE` | `./dev-data/wk-enhanced-api.sqlite` | `/var/lib/wk-enhanced-api/wk-enhanced-api.sqlite` | Prod path is under `/var/lib` so it survives `git pull` in `/opt/wk-enhanced-api`. |
| `S3_*` vars | unused / blank | required (endpoint, region, bucket, full-access key + secret) | See `deploy/env.production.template`. Full-access key, not Limited — see ACL dead-end below. |
| `S3_FORCE_PATH_STYLE` | n/a | `true` | Mandatory for DO Spaces + `Bun.S3Client`; see dead-end below. |
| `ADMIN_TOKEN` | `dev-admin-token` | `openssl rand -hex 32` value | Used by `/v1/admin/*` bearer auth. |
| `WK_API_TOKEN` | usually blank (skip `scope:all` warms) | required for monthly bulk warm | Personal token from your WK settings. |
| Env file location | `wk-enhanced-api/.env` | `/etc/wk-enhanced-api/env` (chmod 600 root) | Prod uses systemd `EnvironmentFile=`; Bun's `.env` auto-load is for dev only. |
| Process supervisor | `bun dev` (your terminal) | `systemctl ... wk-enhanced-api.service` | Service unit lives in `deploy/`. |
| Userscript base URL | `http://localhost:3000` (set in WKOF settings) | `https://api.wkenhanced.dev` (DEFAULTS.apiServerUrl + @connect) | Single source of truth: `PROD_API_BASE` + `DEV_API_BASE` constants at the top of the userscript IIFE. |
| Bun binary location | Wherever you installed it | `/usr/local/bin/bun` | systemd's `ProtectHome=true` blocks `/root/.bun/bin/bun`; see dead-end. |

If you're adding something that doesn't fit a row above — a new external service, a new auth token, a new on-disk path — the test for "does it belong here" is: *would forgetting to update the prod side cause a runtime failure?* If yes, add a row.

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
5. **Compose payload + upsert** with `incomplete: true` and `fallbackImages: []` (or the prior payload's fallbacks if this is a re-warm). Return to caller. `serve_count` is **preserved** across re-warms (so usage stats survive monthly refresh).
6. **Background: DDG fallback pool.** Fire-and-forget — `completeDdgInBackground(word)` runs after `warmWord` returns. Two-step DDG fetch (HTML page for `vqd` token, then JSON `/i.js`), up to 10 images uploaded to `ddg/<word>/N.jpg`. On completion (or failure — best-effort), re-upserts the row with the full `fallbackImages` and drops the `incomplete` flag. A `ddgInFlight: Set<string>` dedupes overlapping background tasks per word.

Why DDG is deferred: it accounts for ~1.5s of cold lazy-fill latency (1 vqd + 10 image fetches at 3-wide concurrency) and is the lowest-stakes work in the pipeline — most examples already have an IK image, and the userscript shows "no image" gracefully when `fallbackImages` is empty. Userscript handles the `incomplete: true` signal by using a short (60s) local cache TTL instead of the usual 7-day TTL, so the next visit picks up the fully-populated payload via ETag round-trip.

Idempotency: re-running the warm overwrites in place. Object keys are stable across runs (based on `exampleId` from IK or a content hash if IK gives us no id). Skipped if `fetched_at` is within `WARM_REFRESH_DAYS` (default 30) unless `force: true`. Background DDG completion re-reads the latest row before its final upsert so a concurrent re-warm doesn't get clobbered.

Concurrency model: per-word work runs sequentially in `warmAll`. Per-example media downloads inside one word run in parallel (4-wide). IK has a global **500ms** rate limit (`lastIkCallAt` shared module state in `services/ik.ts`). This makes a single cold lazy-fill (~15 IK calls) take ~7–8s of pure throttle wait, which is the price of staying a polite client; the userscript hides this behind `?nowarm=true` prefetch. **Do not lower below 500ms** — the rc2 deploy briefly tried 50ms and triggered a global 429 lockout across the droplet for ~30 min (see dead-end warning below). Lowering safely requires implementing 429-with-exponential-backoff in `services/ik.ts:fetchJson` first.

Lazy fill (`GET /v1/vocab/{word}` on a cold word) calls `warmWord()` synchronously. With DDG deferred, the client typically blocks for 1–3s on a fresh-everything cold word and gets `incomplete: true` in the payload; the next visit (typically the userscript's next render or prefetch ~seconds later) hits the now-complete cached row. Use `?nowarm=true` to skip lazy fill entirely for prefetch flows.

## External services

- **`apiv2.immersionkit.com/search`** — sentence + translation source. Built-in 500ms rate limit (see concurrency notes above; don't lower without 429-backoff). Normalizes `examples` shape across IK API versions.
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

- **SQLite is the DB even in production.** The original SERVER_DESIGN.md said Postgres; we deviated. The data model is K-V with JSON payloads, the corpus is bounded (~6500 rows), and a single droplet doesn't need a network DB. The repo functions in [src/db/client.ts](src/db/client.ts) hide all the SQL so migrating to Postgres later is mechanical if scale demands it. **Don't pre-emptively add Postgres** "to be safe" — the SQLite story is deliberate. The deploy-shape companion question (k8s vs droplet) is recorded in [docs/decisions/ADR-001-no-kubernetes.md](docs/decisions/ADR-001-no-kubernetes.md).

- **Bulk warm takes 6–10 hours at the current 500ms rate limit, not "1+ hour" as earlier versions of this doc said.** ~6500 words × ~50 examples × per-example media downloads (~100 IK calls/word) at 500ms gate ÷ 4-wide concurrency = ~10–25 sec/word. It's a monthly cron job; nobody is waiting on it. **Don't add aggressive concurrency to "speed it up"** beyond the existing per-word 4-wide media batching — IK is a free, community-supported service and we want to stay a polite client. If IK ever 429s us further, the right knob is `MIN_GAP_MS` in `services/ik.ts` (currently 500ms; was briefly 50ms in rc2 and that triggered a global lockout — see the IK rate-limit warning below), not more parallelism.

- **IK rate-limit floor must stay ≥500ms — `50ms` triggered a global 429 lockout in production.** The rc2 drop to 50ms (~20 req/sec) on the first prod bulk warm caused IK to 429 every subsequent call across the droplet for ~30 minutes, even for unrelated sub-second curls from the same IP. Recovery requires waiting it out. Lowering `MIN_GAP_MS` below 500ms is not safe without first implementing proper 429-with-exponential-backoff in `services/ik.ts:fetchJson`. See commit dcfde04 and the comment block above `MIN_GAP_MS` for the full history.

- **Warm pipeline MUST throw (not silently return empty) on `ikSearch` failure.** Pre-fix behavior caught the exception, left `rawExamples = []`, and upserted an empty payload with `fetched_at = now` — which made the next warm see `fresh` and skip indefinitely. During the first prod warm, that bug + the 429 storm = 6186/6186 rows empty. Fix at `warm/pipeline.ts:140-144`: re-throw from the catch so `warmAll`'s try/catch counts the word as failed *without writing to vocab_examples*, and the next warm retries. A successful ikSearch returning `[]` (genuine "no examples") is still upserted as a 0-example payload — that's factual, not a failure. See commit e7f8224.

- **Bun's default `serve()` `idleTimeout` is 10s — way too short for cold-fill `GET /v1/vocab/{word}` responses.** During lazy-fill of an uncached word, `warmWord` runs synchronously for 10–30s (one IK search + ~100 media downloads at the 500ms IK rate-limit floor). The handler doesn't write any bytes during that wait, so Bun considers the connection idle and resets it — the server-side warm still finishes and populates the row, but the client sees a connection drop with no HTTP status (curl reports `http=000`). Discovered during Phase 2 smoke-test on 2026-05-25 when cold-fills of 本/日本 took 18s server-side but returned `000` to the client at exactly 12s. Fix: `idleTimeout: 60` on the export in [src/index.ts](src/index.ts) — covers our worst observed cold warm and stays under Cloudflare's 100s free-tier edge timeout. See commit 9be345c. **If you ever raise `WARM_REFRESH_DAYS` or add a slow new step to the warm pipeline that pushes per-word latency past 60s, raise `idleTimeout` to match.**

- **Cross-origin `fetch()` cannot read the `ETag` header unless we explicitly expose it.** ETag is not on the CORS-safelisted response header list, so without `Access-Control-Expose-Headers: ETag` on every response, the userscript's `res.headers.get('ETag')` returns null even though the server sends the header on the wire. Discovered during Phase 2 smoke-test: server logs showed strong ETags being emitted (`"mpli0kwq"`), direct curl confirmed the header was present, but `debugWkIkApi` in the browser showed `etag: null` (the diagnostic helper was renamed to `debugWkEnhancedApi` in v2.0.0). Without a client-side etag, the userscript can't send `If-None-Match` on revisits, so every cached row re-downloads the full ~40KB payload — functionally correct but bandwidth-wasteful, and especially bad under traffic spikes. Fix: `c.header('Access-Control-Expose-Headers', 'ETag')` in the CORS middleware at [src/index.ts](src/index.ts). See commit bf3e153. **If you ever add another response header that the userscript needs to read in JS, append it to this comma-separated list — every new header is invisible-by-default cross-origin.**

- **Cloudflare downgrades strong ETags to weak (`W/"<tag>"`) on every compressed response, so `If-None-Match` comparison MUST tolerate the `W/` prefix.** RFC 7232 §2.3.2 says `If-None-Match` uses weak comparison anyway (same opaque tag, ignoring `W/`), but a naive strict-equality check (`ifNoneMatch === etag`) misses every Cloudflare-mediated revalidation. Discovered during Phase 2 smoke-test: origin emitted `ETag: "mpli0kwq"`, Cloudflare re-emitted `ETag: W/"mpli0kwq"`, userscript stored and re-sent the weak form, origin compared by string equality, mismatch, returned full 200 every time → no 304s ever in production. Fix at [src/routes/vocab.ts](src/routes/vocab.ts): new `normalizeEtag` helper strips an optional leading `W/` from the client-supplied If-None-Match before comparison. Origin still emits a strong ETag (Cloudflare adds the weakening on its way out); same-origin direct curls still 304 cleanly. See commit 7539a26. **Don't try to suppress Cloudflare's weakening upstream** — it's tied to compression and turning that off costs more bandwidth than the wart costs.

- **DO Spaces "Limited Access" keys don't grant `s3:PutObjectAcl`.** Even with Read/Write/Delete scope, uploads with `acl: 'public-read'` return AccessDenied. We tried two workarounds (set-acl after upload via `s3cmd setacl`; bucket-level public-read via `s3cmd setpolicy`) — the latter doesn't work either because DO Spaces appears to NOT expose `PutBucketPolicy` through their S3 API (returns 403 even with Full Access keys). Conclusion: **use a Full Access Spaces key in prod.** On a single-tenant droplet (one bucket, one app, key never leaves `/etc/wk-enhanced-api/env`) the risk delta vs Limited Access is marginal. See the inline comment in `services/storage.ts:put` and commit 94aa16d.

- **`S3_FORCE_PATH_STYLE=true` is mandatory for DO Spaces + Bun.S3Client.** With `false` (= `virtualHostedStyle: true`), Bun constructs PutObject requests that DO interprets as `CreateBucket` and returns "The bucket already exists" — uploads silently fail to deliver objects (file.write does NOT throw; only the absence in subsequent `exists()` reveals the bug). Path-style addresses (`https://endpoint/bucket/key`) are Bun's default for non-AWS endpoints and what DO expects. The `MEDIA_PUBLIC_BASE` env var, which puts the bucket in the hostname for CDN reads, is independent of upload addressing. See commit 1732275.

- **Bun must live outside `/root` — the systemd unit's `ProtectHome=true` blocks it otherwise.** Bun's official installer drops `bun` in `/root/.bun/bin/bun` when run as root, but our service runs as the unprivileged `wkenhanced` user with `ProtectHome=true` (which masks `/root` regardless of perms). Copy the binary to `/usr/local/bin/bun` after install. See commit 5e4f863 + the `deploy/wk-enhanced-api.service` `ExecStart` comment.

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

**Reading the logs (structured JSON; one line per event):**

Per request, the `http` middleware emits a single line that route handlers can enrich via `c.set('logCtx', { ... })`. Common keys to look for:

| Event | Fields | When |
|---|---|---|
| `http` | method, path, status, ms, +logCtx fields | Every request, post-hoc. |
| `vocab.serve` | word, cacheStatus, etag, examples, ageMs, serveCount, warmMs? | Per `GET /v1/vocab/{word}`. |
| `vocab.batch` | requested, deduped, found, missing, ms | Per `POST /v1/vocab/batch`. |
| `vocab.cold_miss` | word | Cold-word lazy-warm trigger. |
| `vocab.lazy_warm_failed` | word, warmMs, err | Lazy warm threw. |
| `warm.word.start` / `warm.word.done` | word, examples, audio{ik,tts,none}, audioStorage{cache,fetched,failed,skipped}, image{ik_present,ik_missing}, imageStorage{...}, ddg{deferred:true,priorFallbackImages}, ms | Per-word warm; the `*.done` line is the operator dashboard for "what did this warm actually do." High `audioStorage.cache` = re-warm fast, no external calls; high `audioStorage.fetched` = lots of fresh IK / TTS work. **DDG is deferred** — see the next line for the actual DDG result. |
| `warm.ddg.background.done` | word, ms, urls, fetched, failed, fallbackImages | Background DDG fetch completed and re-upserted the row (now `incomplete: false`). Latency-decoupled from the lazy-fill response; usually fires 1–2s after `warm.word.done`. |
| `warm.ddg.background.skip_inflight` | word | Suppressed log (debug level): a duplicate background-DDG task tried to start while one was already running for the same word. |
| `warm.all.start` / `warm.all.done` / `warm.all.word_failed` | count, processed, failed, jobId | Bulk warm progress. |

The `cacheStatus` enum on `vocab.serve` and on the http log line:

| Status | Meaning |
|---|---|
| `hit` | DB row served directly. No upstream calls. Sub-10ms. |
| `not_modified` | ETag matched client's `If-None-Match`; returned 304. Even cheaper than `hit`. |
| `cold_warm` | DB row was missing; we ran `warmWord` synchronously and then served. `warmMs` shows how long the warm took (typically 10–30s for a cold word). |
| `empty` | Warm succeeded but IK had no examples for this word — returned an empty payload (200, not 404, so the client renders a "no example" card). |
| `nowarm_miss` | Client passed `?nowarm=true` and the row was missing; returned 404 without warming. Expected for prefetch flows. |
| `error` | Lazy warm threw; returned 502. |
| `batch` | `POST /v1/vocab/batch` (always serves whatever's cached, never warms). |

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

## Cost & deploy

DO Droplet ($6/mo, SFO3) + DO Spaces ($5/mo) + Cloudflare Tunnel (free) ≈ **$11/mo** steady state. SQLite means no managed-DB cost. Deploy units live in [deploy/](deploy/) — systemd service, cloudflared config, deploy notes in [deploy/README.md](deploy/README.md). Original design rationale: [../SERVER_DESIGN.md](../SERVER_DESIGN.md); see its "Implementation deviations" header for what changed during the build.

## What's deliberately NOT in v1

- No accounts, no auth (except the admin bearer token).
- No keyed external services (DeepL, OpenAI, Forvo, jpdb). If we add them later, keys live on the client and we proxy without caching under keys the user can't reach.
- No analytics on what users review (only aggregate serve counts).
- No real-time / push features.
- No metrics endpoint beyond `/v1/health`. Structured JSON logs are the metrics surface.
- No tests for the route handlers themselves — pure-function coverage + manual curl is the contract. Route tests become valuable when the API shape stabilizes after the userscript migration.
