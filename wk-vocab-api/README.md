# wk-vocab-api

Backing API for the [WK Vocab Review — ImmersionKit Examples](../wk-vocab-review-ik.user.js) userscript. Coalesces ImmersionKit, DuckDuckGo, and Google Translate TTS behind a single pre-warmed endpoint so every client doesn't have to hit three external services individually.

Doc map:

- **This README** — how to run, configure, and deploy.
- **[CLAUDE.md](CLAUDE.md)** — architecture, dead-end warnings, and conventions for agents/contributors working on the server.
- **[../SERVER_DESIGN.md](../SERVER_DESIGN.md)** — original design rationale (with implementation deviations noted at top).

## Quick start (local dev)

```bash
cd wk-vocab-api
bun install
cp .env.example .env
bun dev
```

That's it. No Docker, no Postgres, no MinIO. SQLite + local filesystem.

Then in another terminal — or open **http://localhost:3000/docs** in a browser for the interactive Scalar docs UI:

```bash
# Warm a single word (synchronous, ~15-30s for cold word)
curl -X POST http://localhost:3000/v1/admin/warm \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"scope":"word","word":"食べる"}'

# Read the warmed payload (instant)
curl http://localhost:3000/v1/vocab/食べる

# Listen to a sentence (the audioUrl from the response above)
curl -o sample.mp3 http://localhost:3000/media/audio/anime/...
```

## Requirements

- [Bun](https://bun.sh) 1.1.6+ (uses `bun:sqlite` and the built-in S3 client for prod). Install: `curl -fsSL https://bun.sh/install | bash`.
- Nothing else for local dev. For prod: a server, an S3-compatible bucket, optionally a managed Postgres (deferred — currently SQLite is the only DB).

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

### Error response contract

All non-2xx responses share the shape:

```jsonc
{
  "code": "validation_error",   // enum — see below; switch on this programmatically
  "error": "invalid request",   // human-readable summary, may change between versions
  "detail": "words: Too small: expected array to have >=1 items"  // optional context
}
```

The `code` enum is stable: `validation_error`, `unauthorized`, `not_found`, `upstream_failure`, `service_unavailable`, `internal_error`. Client code should branch on `code`, not `error`.

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
  ]
}
```

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
wk-vocab-api/
├── data/
│   └── jlpt-vocab.json       # bundled JLPT dict (~93KB), used by JLPT scoring
├── src/
│   ├── index.ts              # OpenAPIHono app, static media route, /docs + /openapi.json, boot
│   ├── config.ts             # env-var loading, typed config
│   ├── schemas.ts            # Zod schemas — single source of truth for runtime validation + OpenAPI docs
│   ├── db/
│   │   ├── schema.sql        # SQLite schema
│   │   └── client.ts         # repo functions (no SQL leaks out)
│   ├── lib/
│   │   ├── ikTitles.ts       # the lossy-title-encoding workaround
│   │   ├── jlpt.ts           # scoreJlpt — port of userscript logic
│   │   ├── log.ts            # structured-JSON logger
│   │   ├── zodHook.ts        # custom validation-failure response shape
│   │   └── sleep.ts
│   ├── routes/
│   │   ├── health.ts
│   │   ├── vocab.ts          # GET /v1/vocab/:word — lazy-fill on miss
│   │   ├── indexMeta.ts
│   │   └── admin.ts          # POST /v1/admin/warm — bearer auth
│   ├── services/
│   │   ├── ik.ts             # ImmersionKit /search, /index_meta, /download_media
│   │   ├── ddg.ts            # DuckDuckGo two-step vqd image scrape
│   │   ├── tts.ts            # Google Translate TTS fallback
│   │   ├── wk.ts             # WK v2 API — vocab corpus enumeration
│   │   └── storage.ts        # local + S3 driver abstraction
│   └── warm/
│       └── pipeline.ts       # warmWord, warmAll — the heart
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

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

## Going to production (DigitalOcean, future)

Not built yet, but the shape:

1. DO Droplet ($6/mo basic). Install Bun, clone repo, `bun install --production`.
2. DO Managed Postgres ($15/mo) — *deferred*. The SQLite file works in a single-droplet setup; only migrate when concurrent writes or backups become a real issue.
3. DO Spaces ($5/mo) for media. Set `STORAGE_DRIVER=s3`, fill the `S3_*` vars, set `MEDIA_PUBLIC_BASE` to the Spaces CDN endpoint.
4. systemd unit: `bun run src/index.ts` with env vars from `/etc/wk-vocab-api/env`.
5. Cloudflare in front for TLS + rate limiting + edge caching of `/v1/vocab/:word`.
6. Cron the monthly warm: `0 4 1 * * curl -X POST .../v1/admin/warm -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"scope":"all"}'`.

See [SERVER_DESIGN.md](../SERVER_DESIGN.md) for the full plan.

## Known limitations / open questions

- **IK title encoding is best-effort on misses.** When `/index_meta` doesn't have a deck, the heuristic in `src/lib/ikTitles.ts` produces a likely-wrong folder name. Concrete consequence: IK's media proxy returns an empty body, our `<1KB` check trips, we fall through to Google TTS for audio (no fallback for images). Same dead-end as the userscript — don't try to make the heuristic smarter.
- **Bulk warming is sequential and slow.** With per-word IK rate-limiting at 500ms gaps and ~50 examples per word each needing audio + image, the full ~6500-word warm is multi-hour. Acceptable for monthly cron; not interactive.
- **No content negotiation.** All endpoints return JSON only. No HTML or Accept-header branching planned.
- **No tests.** Manual smoke testing via curl. Worth adding `bun test` coverage for `scoreJlpt` and `ikTitleToFolder` since those are pure functions with edge cases.
