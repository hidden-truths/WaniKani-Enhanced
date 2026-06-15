# wk-enhanced-api

Backing API for the [WKEnhanced](../wkenhanced.user.js) userscript. Coalesces ImmersionKit, DuckDuckGo, and Google Translate TTS behind a single pre-warmed endpoint so every client doesn't have to hit three external services individually.

Deployed at `https://api.wkenhanced.dev` (DigitalOcean droplet in SFO3 + Spaces bucket, Cloudflare Tunnel for TLS/edge). The userscript talks to this server exclusively as of v2.0.0; see [../CLIENT_MIGRATION.md](../CLIENT_MIGRATION.md) for the migration history.

Doc map:

- **This README** — how to run, configure, and deploy.
- **[CLAUDE.md](CLAUDE.md)** — architecture, dead-end warnings, and conventions for agents/contributors working on the server.
- **[../SERVER_DESIGN.md](../SERVER_DESIGN.md)** — original design rationale (with implementation deviations noted at top).

## Quick start (local dev)

```bash
cd wk-enhanced-api
bun install
cp .env.example .env
bun dev
```

That's it for dev. No Docker, no Postgres, no MinIO. SQLite + local filesystem. (Docker is the prod deploy path — see [deploy/README.md](deploy/README.md) — but `bun dev` stays the fastest local iteration loop. The Compose stack is opt-in if you want to verify the prod-equivalent container behavior locally.)

Then in another terminal — or open **http://localhost:3000/docs** in a browser for the interactive Scalar docs UI:

```bash
# Warm a single word (synchronous, ~1-3s for cold word — DDG runs in
# the background after this returns)
curl -X POST http://localhost:3000/v1/admin/warm \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"scope":"word","word":"食べる"}'

# Read the warmed payload (DB hit, <10ms)
curl http://localhost:3000/v1/vocab/食べる

# Listen to a sentence (the audioUrl from the response above)
curl -o sample.mp3 http://localhost:3000/media/audio/anime/...
```

Tail `bun dev`'s output to watch the warm pipeline + per-request `cacheStatus` in real time.

## Requirements

- [Bun](https://bun.sh) 1.3.x (prod pins `oven/bun:1.3.8`; uses `bun:sqlite` and the built-in S3 client). Install: `curl -fsSL https://bun.sh/install | bash`.
- Nothing else for local dev. For prod: a server, optionally an S3-compatible bucket (otherwise the local filesystem driver works fine on a single droplet). Postgres was in the original design but we stuck with SQLite — see [SERVER_DESIGN.md](../SERVER_DESIGN.md) for the deviation rationale.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/v1/health` | Liveness + warm-job status. `Cache-Control: no-store`. |
| GET | `/v1/vocab/:word` | Main client endpoint. Returns pre-warmed payload, or lazy-warms on miss. Returns `ETag` for conditional GETs; supports `?nowarm=true` to skip lazy-fill and 404 instead. |
| POST | `/v1/vocab/batch` | Bulk fetch up to 50 words. Returns `{found, missing}`. Never warms — clients can fire individual GETs for misses. Designed for prefetching the next several reviews. |
| GET | `/v1/index_meta` | Cached IK encoded-title → `{title, category}` map. |
| POST | `/v1/admin/warm` | Trigger the warm pipeline. Requires `Authorization: Bearer $ADMIN_TOKEN`. |
| GET | `/v1/admin/jobs?limit=20` | List recent warm-job audit records. Bearer auth. |
| GET | `/media/*` | Static media (only when `STORAGE_DRIVER=local`). In prod the CDN serves these. |
| GET | `/docs` | [Scalar](https://github.com/scalar/scalar) docs UI — interactive endpoint browser with "try it" buttons. FastAPI-style. |
| GET | `/openapi.json` | OpenAPI 3.1 spec. Import into Postman / Insomnia / Bruno / Stoplight if you'd rather use those. |

> This table is the **userscript-facing** vocab/warm + media API. The accounts, study-app sync, unified `/v1/audio/*`, sentence store (`/v1/sentences*`), and `/v1/templates*` surfaces are documented in the canonical API-surface table in [CLAUDE.md](CLAUDE.md).

### Error response contract

All non-2xx responses share the shape:

```jsonc
{
  "code": "validation_error",   // enum — see below; switch on this programmatically
  "error": "invalid request",   // human-readable summary, may change between versions
  "detail": "words: Too small: expected array to have >=1 items"  // optional context
}
```

The `code` enum is stable: `validation_error`, `unauthorized`, `not_found`, `conflict`, `rate_limited`, `upstream_failure`, `service_unavailable`, `internal_error`. Client code should branch on `code`, not `error`. (`conflict` covers e.g. a second `POST /v1/admin/warm {"scope":"all"}` while one's already in flight — returns 409 instead of silently double-running.)

### Conditional GETs

`GET /v1/vocab/:word` returns a strong `ETag` derived from the payload's `fetchedAt`. The userscript should cache the ETag locally and send `If-None-Match: <etag>` on revisits — the server responds 304 No-Content with no body until the next warm refresh.

### `GET /v1/vocab/:word` response

```jsonc
{
  "word": "食べる",
  "fetchedAt": 1748102400000,
  "examples": [
    {
      "id": "anime_hunter_x_hunter_000017918",
      "sentence": "...",
      "sentenceFurigana": "...",
      "translation": "...",
      "wordList": ["...", ...],
      "source": { "title": "Hunter × Hunter", "category": "anime", "encodedTitle": "hunter_x_hunter" },
      "jlptMax": 4,                  // 0=unknown, 1=N1 hardest, 5=N5 easiest
      "hasOriginalAudio": true,      // false = Google TTS fallback
      "audioUrl": "...",
      "imageUrl": "..."              // may be null if IK has no screenshot
    }
    // ... up to 50 examples
  ],
  "fallbackImages": [                // DDG illustrations, used when imageUrl is null or by the ⟳ cycle
    "...", "..."                     // up to 10
  ],
  "incomplete": true                 // optional; present only on lazy-fill cold responses where DDG is still warming in the background. Clients should treat the payload as short-TTL (the userscript uses 60s instead of its usual 7d) and re-fetch shortly. Absent or false once the background DDG completes.
}
```

### Logs cheat-sheet

Server emits structured-JSON logs (one event per line). Useful ones when watching `bun dev`:

- `vocab.serve` — every `GET /v1/vocab/{word}`. `cacheStatus` ∈ `hit` / `not_modified` / `cold_warm` / `nowarm_miss` / `empty` / `error`. Includes `examples`, `ageMs`, `serveCount`, optional `warmMs`.
- `vocab.batch` — every batch request. `requested`, `deduped`, `found`, `missing`, `ms`.
- `warm.word.done` — per-warm summary with `audio{ik,tts,none}`, `audioStorage{cache,fetched,...}`, `image{ik_present,ik_missing}`, `imageStorage{...}`, `ddg{deferred:true,...}`, `ms`. The cache-vs-fetched ratios tell you whether a re-warm was cheap or expensive.
- `warm.ddg.background.done` — DDG completion, 1–2s after `warm.word.done` for cold fills.
- The per-request `http` line carries the same `cacheStatus` + `warmMs` fields merged from the route handler, so a single grep on `http` gives you the headline view.

Full table in [CLAUDE.md](CLAUDE.md) under "Reading the logs."

### `POST /v1/admin/warm` payloads

```jsonc
// Single word, synchronous, returns the payload
{ "scope": "word", "word": "食べる" }
{ "scope": "word", "word": "食べる", "force": true }    // re-warm even if fresh

// All WK vocab — fire-and-forget, observable via /v1/health.lastWarm
// Requires WK_API_TOKEN env var (your personal token)
{ "scope": "all" }
{ "scope": "all", "force": true }

// Refresh IK index_meta only (cheap, ~12KB fetch)
{ "scope": "index_meta" }
```

## Environment variables

See [.env.example](.env.example) for the canonical list. The important ones:

- `ADMIN_TOKEN` — bearer token for `/v1/admin/*`. **Change this for any non-local deployment.**
- `WK_API_TOKEN` — your personal WK v2 API token. Required only to enumerate the WK vocab corpus for `scope: "all"` warming. Get one at https://www.wanikani.com/settings/personal_access_tokens. Optional for local dev (lazy + single-word warming works without it).
- `STORAGE_DRIVER` — `local` (writes to `LOCAL_MEDIA_DIR`, served by the `/media/*` route) or `s3` (uploads to any S3-compatible bucket).
- `MEDIA_PUBLIC_BASE` — the URL prefix put into `audioUrl` / `imageUrl` in API responses. In local dev this is `http://localhost:3000/media`; in prod it's your CDN root.

## Data + storage

- **SQLite** (`bun:sqlite`) for vocab payloads + the IK index_meta cache + warm-job audit log. Single file at `DATABASE_FILE`. Schema in [src/db/schema.sql](src/db/schema.sql).
- **Filesystem or S3** for media binaries. Object key conventions:
  - `audio/<category>/<encodedTitle>/<exampleId>.mp3`
  - `image/<category>/<encodedTitle>/<exampleId>.jpg`
  - `ddg/<word>/N.jpg`

Idempotent: re-running the warm pipeline overwrites in place, so the keys are stable across runs.

## Project layout

```
wk-enhanced-api/
├── data/         # bundled JLPT dict, offline NLP annotations, curated Minna lessons
├── src/
│   ├── index.ts  # OpenAPIHono app, CORS + request log, /docs, static media route, boot
│   ├── config.ts # env-var loading, typed config
│   ├── schemas.ts# Zod schemas — single source of truth for validation + OpenAPI docs
│   ├── db/       # schema.sql + client.ts (repo functions; no SQL leaks out)
│   ├── lib/      # jlpt, ikTitles, etag, realize, rateLimit, minnaGate, auth, log, zodHook, sleep
│   ├── routes/   # health, vocab, indexMeta, admin, auth, progress, sessions, minna,
│   │             #   audio, sentences, templates (one OpenAPIHono sub-router each)
│   ├── services/ # ik, ddg, tts, minnaAudio, wk, storage
│   └── warm/     # pipeline.ts (warmWord, warmAll — the heart)
├── scripts/      # operator tools (TTS pre-gen, store/annotation seeding, Minna scrape) — run by hand
├── deploy/       # systemd units, backup/retention scripts, env template, runbook
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

Full annotated module map (every file + the data-on-disk conventions): [CLAUDE.md](CLAUDE.md) → "Architecture".

## Schemas, validation, and docs

Routes are defined with [`@hono/zod-openapi`](https://github.com/honojs/middleware/tree/main/packages/zod-openapi). Each route attaches a Zod schema for its params / body / response — that single declaration:

1. **Validates incoming requests at runtime.** Malformed bodies get a 400 with a structured `{ error, detail }` payload (see `src/lib/zodHook.ts`) before the handler runs.
2. **Generates the OpenAPI 3.1 spec automatically.** No hand-syncing.
3. **Powers the Scalar docs UI** at `/docs`.

To add or change an endpoint:
1. Update or add a Zod schema in `src/schemas.ts` (or inline in the route if it's one-off).
2. Define the route with `createRoute({ method, path, request, responses })`.
3. Register with `router.openapi(route, handler)` — handler is type-safe against the declared schemas.

The docs UI updates on next page-load; no separate spec-generation step.

## Type-checking, tests, dev workflow

```bash
bun run typecheck      # tsc --noEmit
bun test               # run the test suite (Bun's built-in runner)
bun dev                # hot-reload via bun --watch
bun start              # plain run, no watch
```

Test files live next to the source as `*.test.ts`. Current coverage:

- `src/lib/jlpt.test.ts` — `scoreJlpt` fail-open semantics, target-word exclusion, hardest-wins logic
- `src/lib/ikTitles.test.ts` — `ikTitleToFolder` / `prettifyTitle` / `resolveCategory`, including the dead-end cases from CLAUDE.md pinned as executable assertions
- `src/services/ik.test.ts` — `buildDownloadMediaUrl` URL shape + segment-wise encoding
- `src/services/storage.test.ts` — object-key conventions
- `src/db/client.test.ts` — repo CRUD against an in-memory SQLite (use `openDb(':memory:')` + `_useDbForTesting()` for isolated test DBs)

Live external calls (IK / DDG / Google TTS) are deliberately not tested — they're flaky, slow, and rate-limited. Integration verification is via manual curl against a running server.

## Deployment (live)

The server runs in production at `https://api.wkenhanced.dev` — DigitalOcean droplet ($6/mo, SFO3, Ubuntu LTS), DO Spaces bucket for media (`wk-enhanced-api-media`), Cloudflare Tunnel for TLS/edge. Total monthly cost ~$11. The userscript talks to this URL by default since v1.1.1 (Phase 2) and exclusively since v2.0.0 (Phase 3).

> **Paste-ready templates live in [deploy/](deploy/).** The systemd unit, monthly-rewarm timer, and env-file template are the artifacts that target the DO + Spaces + Cloudflare setup described below. [deploy/README.md](deploy/README.md) is the step-by-step playbook for replicating or rebuilding the deployment (and notes the historical `wk-vocab-api` → `wk-enhanced-api` directory rename that happened post-deploy).

### Architecture summary

- **Compute**: one `s-1vcpu-1gb` droplet running the API as a Docker container (`oven/bun:1.3.8` base, image built locally from [Dockerfile](Dockerfile) via [compose.yaml](compose.yaml)). systemd is a thin wrapper that runs `docker compose up -d` on boot. Container logs land in `docker logs`; unit-level start/stop events in journald.
- **Storage**: SQLite file at `/var/lib/wk-enhanced-api/wk-enhanced-api.sqlite` for payloads + warm-job audit + IK index_meta. Bind-mounted into the container using the same path inside and outside (compose.yaml `volumes:`). Media binaries (audio MP3s, screenshot JPGs, DDG illustrations) live in `wk-enhanced-api-media` DO Spaces bucket, served via Spaces' built-in CDN at `https://wk-enhanced-api-media.sfo3.cdn.digitaloceanspaces.com`.
- **Edge**: Cloudflare Tunnel terminates TLS at the edge and forwards to `http://127.0.0.1:3000` on the droplet (cloudflared running as a sibling systemd unit, talking to the container's published port). Free-tier rate-limit rule fronts `/v1/*` for traffic-spike protection.
- **Warm cadence**: monthly bulk re-warm via the `wk-enhanced-api-warm.timer` systemd unit ([deploy/](deploy/)). Daily SQLite backup → DO Spaces via `wk-enhanced-api-backup.timer`.

### Replicating the deployment

If you ever need to rebuild from scratch (DR scenario or moving regions), [deploy/README.md](deploy/README.md) has the full command sequence. The short version:

1. **Provision droplet** (Ubuntu LTS, SFO3 or wherever).
2. **Pick a domain + bucket name.** Update `MEDIA_PUBLIC_BASE` + `S3_BUCKET` accordingly.
3. **Install Docker Engine + Compose v2** (`curl -fsSL https://get.docker.com | sh`).
4. **Clone repo** to `/opt/wk-enhanced-api`. `cd /opt/wk-enhanced-api/wk-enhanced-api`.
5. **Create `/etc/wk-enhanced-api/env`** from `deploy/env.production.template`. Set `ADMIN_TOKEN` (`openssl rand -hex 32`), `WK_API_TOKEN`, all four `S3_*` vars, `MEDIA_PUBLIC_BASE` to the Spaces CDN URL.
6. **Chown the SQLite dir** to uid:gid 1000:1000 (the container's `bun` user): `install -d -o 1000 -g 1000 /var/lib/wk-enhanced-api`.
7. **Install systemd units** from `deploy/`. `systemctl daemon-reload && systemctl enable --now wk-enhanced-api wk-enhanced-api-warm.timer wk-enhanced-api-backup.timer`. First start builds the image (a couple of minutes); subsequent restarts are near-instant.
8. **Set up Cloudflare Tunnel** pointing at `http://localhost:3000`. Configure the public hostname (`api.wkenhanced.dev`) in the Cloudflare dashboard.
9. **Verify**: `curl https://api.wkenhanced.dev/v1/health` returns `{ "status": "ok", ... }`.
10. **Initial bulk warm**: `curl -X POST https://api.wkenhanced.dev/v1/admin/warm -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"scope":"all"}'`. ~6–10 hours; a duplicate trigger while running returns 409.

Pre-Docker droplets follow a one-shot migration path (install Docker, chown /var/lib, replace systemd unit files); the full recipe is in [deploy/README.md](deploy/README.md) under "Migrating from a pre-Docker droplet."

### Operational gotchas (production-confirmed)

- **Container runs as uid:gid 1000:1000** (the official `bun` user). The host `/var/lib/wk-enhanced-api` directory MUST be owned by 1000:1000 or SQLite reads through the bind mount fail with EACCES. Documented in [deploy/README.md](deploy/README.md).
- **Bun's `idleTimeout` must be ≥ longest cold-fill warm.** Currently 60s in `src/index.ts`. Bun's default 10s killed responses mid-flight on the Phase 2 smoke-test. If you ever extend the warm pipeline past 60s per word, raise this.
- **CORS must expose `ETag`.** The userscript's `If-None-Match` round-trip is dead without `Access-Control-Expose-Headers: ETag` because ETag isn't on the CORS-safelisted response list. See dead-end in [CLAUDE.md](CLAUDE.md).
- **Cloudflare weakens strong ETags via `W/` prefix on compressed responses.** `If-None-Match` comparison strips the `W/` prefix per RFC 7232 weak-comparison semantics. See dead-end in [CLAUDE.md](CLAUDE.md).
- **IK rate-limit floor stays at 500ms** for the global `MIN_GAP_MS`. 429-with-exponential-backoff shipped on 2026-05-25 (commits `983dcb7` + `942175c`), making transient 429 storms recoverable, but the per-IP cooldown hypothesis behind the rc2 lockout hasn't been re-tested — lowering below 500ms still requires a small-scope verification warm. See dead-end in [CLAUDE.md](CLAUDE.md).
- **DO Spaces `S3_FORCE_PATH_STYLE=true` is mandatory.** Virtual-host style with Bun's `Bun.S3Client` silently corrupts uploads (PutObject decoded as CreateBucket). See dead-end in [CLAUDE.md](CLAUDE.md).
- **Backups** run daily at 03:00 UTC via `wk-enhanced-api-backup.timer`. The script runs INSIDE the container via `docker exec`, uses `bun:sqlite`'s `VACUUM INTO` for a WAL-safe snapshot, uploads to `s3://<bucket>/backups/YYYY-MM-DD.sqlite` (private), and prunes per the GFS retention policy (default 7 daily + 4 weekly + 12 monthly). Tunable via `BACKUP_RETAIN_{DAILY,WEEKLY,MONTHLY}` and `BACKUP_PREFIX` env vars.

## Known limitations / open questions

- **IK title encoding is best-effort on misses.** When `/index_meta` doesn't have a deck, the heuristic in `src/lib/ikTitles.ts` produces a likely-wrong folder name. Concrete consequence: IK's media proxy returns an empty body, our `<1KB` check trips, we fall through to Google TTS for audio (no fallback for images). Same dead-end as the userscript — don't try to make the heuristic smarter.
- **Bulk warming is multi-hour.** With the per-word IK rate-limit floor at 500ms and ~50 examples per word each needing audio + image, a full ~6700-word cold warm runs ~6–10h (`force:false` re-warms are much faster — they skip already-fresh rows). Acceptable for monthly cron; not interactive.
- **Lazy cold-fill is ~1–3s.** Per-example IK media is warmed synchronously; DDG fallback pool is deferred to a background task (see "DDG deferred" in `warm.word.done` logs and the `incomplete: true` payload flag). If this still feels slow once deployed, the next lever is to defer per-example media too — see [NEW_FEATURES.md](../NEW_FEATURES.md) "Two-phase lazy-fill" entry.
- **No content negotiation.** All endpoints return JSON only. No HTML or Accept-header branching planned.
