# SERVER_DESIGN.md

Design doc for the backing API that fronts ImmersionKit + DuckDuckGo + Google TTS for [wkenhanced.user.js](wkenhanced.user.js).

**Status: deployed at `https://api.wkenhanced.dev`; userscript v2.0.0 is server-only.** The code lives at [wk-enhanced-api/](wk-enhanced-api/) (source path renamed from `wk-vocab-api/` to match the deployment on 2026-05-25). This doc is the original *design rationale* — read [wk-enhanced-api/README.md](wk-enhanced-api/README.md) and [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) for the current state of the implementation.

## Implementation deviations from this doc

A handful of decisions changed during the build (logged here so the rest of the doc still makes sense as a record of the original thinking):

- **SQLite via `bun:sqlite`, not Postgres.** Zero install for local dev (no Docker, no managed DB). Data model is K-V with JSON payloads — Postgres was overkill. Will revisit if/when concurrent writes or backups become a real issue.
- **Local filesystem driver as the dev default**, with an S3-compatible driver (Bun's built-in `Bun.S3Client`) for prod (Spaces, MinIO, R2, AWS). The original "Docker-compose with MinIO" story was dropped because Docker wasn't installed locally; this is cleaner anyway — `bun install && bun dev` Just Works with no infrastructure.
- **Per-word example cap of 50** (down from "up to 500" in the original spec). Trades picker depth for ~10–20× smaller payloads. Easy to lift if it bites.
- **`@hono/zod-openapi` for routes + auto-generated OpenAPI spec + Scalar docs UI at `/docs`.** The original doc didn't specify a docs story; this slotted in cleanly as a FastAPI-equivalent.
- **`ETag` + `If-None-Match` on `GET /v1/vocab/{word}`**, **`POST /v1/vocab/batch`** for prefetching, **`?nowarm=true`** query for cache-probing, **`GET /v1/admin/jobs`** for warm-history audit. Refinements added during the API-shape pass.
- **Error-code taxonomy** (`validation_error`, `unauthorized`, `not_found`, `upstream_failure`, `service_unavailable`, `internal_error`) on every non-2xx response — clients switch on `code`, not the human-readable `error` string.
- **IK rate limit dropped from 500ms → 50ms** (~2 req/sec → ~20 req/sec). The original 500ms made interactive lazy-fills feel sluggish: a cold word triggers ~15 IK calls (1 search + per-example media), and a 500ms floor between every call adds 7–8s of pure throttle wait on top of actual network round-trips. Bulk warm is still bounded primarily by IK's own response latency, not our throttle. Revisit upward if IK pushes back.
- **DDG fetch deferred to background.** The original pipeline ran the DDG fallback-pool fetch (1 vqd token request + 10 image downloads) synchronously before responding, adding ~1.5s to cold lazy-fill latency. Now `warmWord` returns immediately after IK media is done with `incomplete: true` in the payload and `fallbackImages: []` (or the prior fallbacks on re-warm); a fire-and-forget background task fetches DDG and re-upserts with the full pool + `incomplete: false`. The userscript honors `incomplete: true` by applying a 60s local TTL instead of 7d so the next request picks up the completed payload. Module-scoped `ddgInFlight: Set<string>` dedupes overlapping background tasks for the same word.
- **Structured per-request + per-warm logging.** Beyond the per-request `http` line, the server now emits `vocab.serve` / `vocab.batch` events with a `cacheStatus` enum (`hit` / `not_modified` / `cold_warm` / `nowarm_miss` / `empty` / `error` / `batch`) and per-warm media stats (`audio{ik,tts,none}`, `audioStorage{cache,fetched,...}`, same for image, plus DDG counts) aggregated into `warm.word.done`. Operator can answer "is this request hitting cache or upstream?" and "did this warm reuse storage or do fresh fetches?" from one log line each. Full table in [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md).
- **Phase 1 → Phase 2 → Phase 3 all shipped** in the userscript (the consolidated record is in [ROADMAP.html](ROADMAP.html)). v1.0.0-rc1 introduced the API path opt-in via a `useApiServer` setting; v1.1.0/v1.1.1 flipped it default-on (Phase 2); v2.0.0 deleted the direct path entirely (Phase 3), renamed the userscript to `wkenhanced.user.js`, and preserved the v1.1.1 direct-path snapshot at `legacy/` (later removed in the 2026-06 cleanup).
- **Server deployed to production** (2026-05-25). Lives at `https://api.wkenhanced.dev` on a DO SFO3 droplet ($7/mo Premium AMD) + DO Spaces ($5/mo, S3 driver, path-style) behind a Cloudflare Tunnel. The deploy turned up six DO Spaces / Bun / IK idiosyncrasies that aren't in any docs; see [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) DEAD-END WARNINGS for the recoverable ones and [wk-enhanced-api/deploy/README.md](wk-enhanced-api/deploy/README.md) for the canonical install recipe. Headline deltas vs this doc's original deploy story:
  - **Storage driver**: `local` was viable for dev, but prod uses `s3` (Spaces) — the local FS on a droplet loses everything if the droplet is destroyed, and re-warming costs ~6–10 hours.
  - **Spaces key**: must be **Full Access**, not Limited. Limited Access doesn't grant `s3:PutObjectAcl`, and DO Spaces doesn't expose `PutBucketPolicy` as a workaround. Single-tenant droplet makes Full Access acceptable.
  - **`S3_FORCE_PATH_STYLE=true`** is required (Bun + DO together break with virtual-hosted style).
  - **`MIN_GAP_MS` in `services/ik.ts`** raised back from 50ms → 500ms after a 429 lockout. The rc2 push to 50ms was a userscript-lazy-fill optimization that didn't survive contact with bulk-warm traffic patterns.
  - **Warm pipeline** now throws on `ikSearch` failure (was silently caching empty rows). Without this, the 429 storm poisoned the entire DB.
  - **Cloudflare Tunnel** chosen over A-record + Caddy for "least manual setup" — no firewall ports opened, no origin cert, automatic end-to-end TLS.
- **Docker IS used in prod** — reversing step 5 of the deploy plan below ("No Docker in prod"). Prod now runs **two containers** (`api` on :3000 + an nginx `web` container on :8080 serving the study app) from [wk-enhanced-api/compose.yaml](wk-enhanced-api/compose.yaml), brought up by a thin systemd wrapper. Dev still needs no Docker (`bun dev`). The step-5 prose below is preserved as a record of the original thinking; the live recipe is [wk-enhanced-api/deploy/README.md](wk-enhanced-api/deploy/README.md). (Note `wk-enhanced-api` has no `build` script — that part of step 5 never existed.)
- **The study app was born here and moved out.** Not in the original design at all: a standalone Vite study app ([study-app/](study-app/)) now serves the apex `wkenhanced.dev` cross-origin, backed by accounts + per-user progress sync on this server. See [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) "Accounts + study app".

The rest of this doc — endpoints, schemas, storage layout, deploy story — is still accurate in shape, with the database/dev-storage swap above being the main delta.

Working name (during this doc's authorship): **wk-vocab-api**. Renamed to **wk-enhanced-api** at deploy time and propagated through the source tree on 2026-05-25. The userscript prior to v2.0.0 called IK / DDG / Google directly from every client; this server moves all of that to one place so it's pre-computed, cached, and not re-done per-user.

## Goals

- **One domain to call.** Userscript hits `api.wkenhanced.dev/...`, gets everything it needs per vocab card in a single response.
- **Pre-warm the whole WK vocab corpus monthly.** First-time-encounter latency disappears; IK/DDG/Google see one server instead of N clients.
- **Self-host the media.** IK audio + IK images + Google TTS MP3s + DDG-sourced images all stored in DO Spaces. The userscript loads from our CDN-fronted bucket, not from third-party origins. Removes the IK `Referer`-spoofing dance and the Google TTS rate-limit risk for end users.
- **Free to users, no accounts, no keys.** All cost falls on the maintainer; design has to stay inside the budget below.

## Non-goals (v1)

- No user accounts, no per-user data, no PII.
- No keyed services (DeepL, OpenAI, Forvo, jpdb, pitch APIs). The userscript today doesn't use any; the server won't either until/unless they're added later. When they are, the keys live on the client and the server proxies without caching the response under any key the user can't reach.
- No real-time / push features. Reviews are a polling workload from the client; there's nothing to push.
- No analytics on what users review. We log request counts per word for capacity planning, not who looked at what.

## Audience & scale assumptions

- Private project today (not published anywhere). The original design assumed it might one day be shared publicly; if so, a realistic active-user ceiling is low thousands, peaking a few times a day in local-evening review windows.
- WK has ~6500 vocab subjects. The pre-warmed corpus is fixed-size, not user-driven.
- Per-vocab response payload (compressed): typically 30–80KB JSON, occasionally up to ~150KB for very common words with hundreds of sentences. Audio + image fetches are separate HTTP requests against signed Spaces URLs.

## Architecture

```
                         ┌────────────────────────────┐
   userscript ─────────► │  Cloudflare (free tier)    │  TLS, edge cache, IP rate-limit
                         └────────────┬───────────────┘
                                      │
                         ┌────────────▼───────────────┐
                         │  DO Droplet ($6/mo basic)  │  Bun + Hono (or Express)
                         │  - GET /v1/vocab/:word      │  reads Postgres only on cache miss
                         │  - GET /v1/index_meta       │  
                         │  - Admin: cron triggers     │
                         └────────────┬───────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
        ┌──────────┐          ┌───────────────┐        ┌────────────┐
        │ Postgres │          │  DO Spaces    │        │ Cron job   │
        │ (managed │          │  (S3-compat)  │        │ (monthly + │
        │  $15/mo) │          │  audio+image  │        │  on-miss)  │
        └──────────┘          │  $5/mo/250GB  │        └─────┬──────┘
                              └───────────────┘              │
                                                             ▼
                                              fans out to IK / DDG / Google TTS
```

### Why this shape

- **Cloudflare in front** is free and handles two things we'd otherwise have to build: TLS, and absorbing a traffic spike if the service is ever linked publicly. Their edge cache can fully serve `GET /v1/vocab/:word` responses with a long `Cache-Control: public, max-age=86400, stale-while-revalidate=2592000`. Under such a spike, the origin sees maybe one request per word per day.
- **Single droplet** is enough. Workload is bounded by the WK vocab corpus, not user growth. Vertical scale to a $12 or $24 droplet if needed.
- **Managed Postgres**: $15/mo isn't free but is much cheaper than 4 hours of debugging a self-managed Postgres at 2am after a kernel update. Skip if budget pressure later forces it; the droplet has enough headroom to run Postgres locally.
- **Spaces for media**: $5/mo gets 250GB storage + 1TB egress. We expect ~30GB at rest and ~100–300GB/mo egress. Comfortable margin. Spaces is S3-API-compatible so MinIO can stand in for local dev.

## API surface

All endpoints return `application/json` unless noted. Versioned under `/v1/` so we can ship breaking changes by minting `/v2/` and letting old userscript versions keep working until they update.

### `GET /v1/vocab/:word`

The primary endpoint. Returns everything the userscript needs to render a card and populate the picker for one vocab word. Mirrors the current client-side `cached.raw` shape so the userscript change is minimal.

```jsonc
{
  "word": "食べる",
  "fetchedAt": 1748102400000,
  "examples": [
    {
      "id": "anime_kill_la_kill_42",       // stable per IK example
      "sentence": "今日は外で食べる予定です。",
      "sentenceFurigana": "今日[きょう]は外[そと]で食[た]べる予定[よてい]です。",
      "translation": "We're planning to eat outside today.",
      "wordList": ["今日", "は", "外", "で", "食べる", "予定", "です"],
      "source": {
        "title": "Kill la Kill",            // resolved through index_meta
        "category": "anime",
        "encodedTitle": "kill_la_kill"      // for debugging
      },
      "jlptMax": 4,                          // 0=unknown, 1=N1 hardest, 5=N5 easiest
      "hasOriginalAudio": true,
      "audioUrl": "https://cdn.wkenhanced.dev/.../audio/anime/kill_la_kill/42.mp3",
      "imageUrl": "https://cdn.wkenhanced.dev/.../image/anime/kill_la_kill/42.jpg"
    },
    // ... up to ~500 examples
  ],
  "fallbackImages": [
    "https://cdn.wkenhanced.dev/.../ddg/食べる/0.jpg",
    "https://cdn.wkenhanced.dev/.../ddg/食べる/1.jpg",
    // ... up to 10
  ]
}
```

Notes:
- `audioUrl` is the **Google TTS** fallback if `hasOriginalAudio` is false. Pre-rendered and stored alongside IK audio so the userscript treats them identically. The current client-side TTS-on-demand path goes away.
- `imageUrl` is null when IK has no `image` field for the example. Client falls back to `fallbackImages` (same as today).
- All URLs are **direct CDN paths**, not signed — buckets are public-read. We're not protecting media (it's just rehosted free content); signing would only add latency and cache-busting headaches.

### `GET /v1/index_meta`

Returns the canonical IK encoded-title → `{title, category}` map. Same shape as IK's `/index_meta` today; provided here so the userscript's existing `indexMeta` path keeps working as a side channel (the `:word` endpoint already pre-resolves titles, but exposing the map lets the userscript handle responses from older cache entries gracefully). Probably can be dropped later.

```jsonc
{
  "fetchedAt": 1748102400000,
  "decks": {
    "kill_la_kill": { "title": "Kill la Kill", "category": "anime" },
    "kanon__2006_": { "title": "Kanon (2006)", "category": "anime" }
    // ...
  }
}
```

### `GET /v1/health`

Liveness probe. Returns `{ "status": "ok", "version": "X.Y.Z", "warmedWords": 6432, "lastWarmRunAt": 1748102400000 }`. Used by the cron job dashboard and by Cloudflare's origin health checks.

### `POST /v1/admin/warm` (auth-required)

Manually trigger the warm pipeline (full or single-word). Protected by a long random bearer token in the `Authorization` header, set as a server env var. Only the maintainer calls this.

```http
POST /v1/admin/warm
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{ "scope": "all" }                 // or { "scope": "word", "word": "食べる", "force": true }
```

Returns 202 with a job id; progress observable via logs.

### What's deliberately NOT in the API

- No "give me one sentence" endpoint. The client already wants the full pool for the picker; making the server pre-pick removes flexibility (different settings would force different responses) for negligible payload savings.
- No filter/sort query params. The client owns `jlptCeiling`, `jlptPreferred`, `sentencePreference`, `requireAudio` — those are user preferences that change per-card. Server returning all examples + their `jlptMax` lets the client filter without re-fetching.
- No POST for client-supplied vocab. Only WK-corpus words are warmed; anything else 404s. Prevents drive-by traffic from spinning up the IK pipeline for nonsense queries.

## Data model

Postgres. Three tables.

### `vocab_examples`

Stores the pre-warmed `examples` array per word. One row per word.

```sql
CREATE TABLE vocab_examples (
    word              TEXT PRIMARY KEY,         -- dictionary form, normalized (NFC)
    payload           JSONB NOT NULL,           -- the full `examples` array (see above)
    fallback_images   JSONB NOT NULL DEFAULT '[]',
    example_count     INT  NOT NULL,
    fetched_at        TIMESTAMPTZ NOT NULL,
    last_served_at    TIMESTAMPTZ,              -- for cold-warmer prioritization
    serve_count       BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX vocab_examples_fetched_at_idx ON vocab_examples (fetched_at);
```

`payload` is JSONB rather than relational because:
- We never query inside it. The client gets the whole array and filters locally.
- IK can add fields and we shouldn't have to migrate.
- A single read is a single row lookup.

### `index_meta`

Singleton-ish: one row, refreshed weekly.

```sql
CREATE TABLE index_meta (
    id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    decks             JSONB NOT NULL,
    fetched_at        TIMESTAMPTZ NOT NULL
);
```

### `warm_jobs`

Audit + idempotency log for the cron pipeline.

```sql
CREATE TABLE warm_jobs (
    id                BIGSERIAL PRIMARY KEY,
    scope             TEXT NOT NULL,            -- 'all' | 'word'
    target            TEXT,                     -- word if scope='word', else null
    started_at        TIMESTAMPTZ NOT NULL,
    finished_at       TIMESTAMPTZ,
    words_processed   INT NOT NULL DEFAULT 0,
    words_failed      INT NOT NULL DEFAULT 0,
    error             TEXT
);
```

That's it. Notably *not* storing:
- Audio/image binary content — that's Spaces' job.
- JLPT_VOCAB — bundled as a JSON file in the server repo, same as the userscript today.
- Per-user state of any kind.

## Storage layout (Spaces)

Bucket `wk-enhanced-api-media`. Public-read, no listing.

```
audio/
  <category>/<encodedTitle>/<exampleId>.mp3       # IK proxy result, or Google TTS if no IK audio
image/
  <category>/<encodedTitle>/<exampleId>.jpg       # IK screenshot
ddg/
  <urlEncodedWord>/0.jpg, 1.jpg, ... 9.jpg        # DDG fallback pool, top 10 results
```

Object key choices:
- `encodedTitle` (e.g., `kill_la_kill`) goes in the path, not the pretty title. Stable, lowercase, ASCII-safe.
- `exampleId` comes from IK's example `id` (or a deterministic hash if `id` ever turns out to be unstable).
- `.jpg` extension regardless of source format. Content-Type comes from object metadata on upload, not the filename.
- TTS audio uses the same path as IK audio — there's only ever one audio per example, so no collision.

Lifecycle: no auto-deletion. Refreshed in place by the monthly warm.

## Pre-warm pipeline

The single most important code path. Runs once a month via systemd timer on the droplet (or DO's hosted cron, same idea). Also triggerable via `POST /v1/admin/warm`. Also runs **on-demand for any word that's served and not yet warmed** (lazy fill).

### Pipeline steps

For each word in the WK vocab corpus (~6500):

1. **Skip if fresh** — if `fetched_at > now - 30 days` and no `force=true`, skip. Lets a partial run resume cheaply.
2. **Fetch IK** — `GET https://apiv2.immersionkit.com/search?q=<word>&exactMatch=true&limit=1000`. On HTTP error, log and continue (don't fail the whole run for one word).
3. **Resolve titles + categories** — look up each example's `title` in our cached `index_meta`. Fall back to the heuristic (`ikTitleToFolder`) on misses, identical logic to the userscript.
4. **JLPT-score each example** — `scoreJlpt(example, word)` using the same bundled `JLPT_VOCAB` dict and same fail-open rules. Attach as `jlptMax`.
5. **For each example with `sound`**:
   - Build the IK download_media proxy URL.
   - Fetch with `Referer: https://www.immersionkit.com/`.
   - If body < 1KB: treat as miss, fall through to step 6.
   - Otherwise: upload to `audio/<category>/<encodedTitle>/<exampleId>.mp3` in Spaces.
6. **If no IK audio (or it failed)**:
   - Build the Google TTS URL for the sentence text.
   - Fetch with `Referer: https://translate.google.com/`.
   - Upload to the same Spaces path. Set a flag `hasOriginalAudio: false` on the example payload.
7. **For each example with `image`**: same shape as audio (steps 5-6 minus the TTS branch — no image fallback per-example, only the DDG pool).
8. **Fetch DDG pool for the word** — two-step (`vqd` then `i.js`), grab top 10 URLs, download each, upload to `ddg/<urlEncodedWord>/N.jpg`.
9. **Compose the payload** — assemble the `examples` array with the final `audioUrl` / `imageUrl` pointing at our Spaces CDN paths. Compose `fallback_images` from the DDG uploads.
10. **Upsert** into `vocab_examples`.

### Concurrency & politeness

- Process words sequentially in the outer loop; inside one word, fetch the per-example media in parallel batches of 5.
- Rate-limit IK to ~2 req/sec total to be polite to their free service. At ~6500 words + ~50 examples each (most words have far fewer; cap), we're looking at a multi-hour run. That's fine — it's monthly.
- Backoff on 429 / 5xx with exponential delay.
- Per-word work is wrapped in a try/catch; one bad word doesn't fail the run. Failures are written to `warm_jobs.error` with the word that broke.

### Caps & limits

- **Max 50 examples per word** kept in the payload. The userscript today fetches up to 1000 but in practice surfaces maybe 25 in the picker before the user gives up scrolling. The full 1000 inflates payload size 20x for marginal UX gain. Keep the first 50 after applying `requireAudio`-soft-prefer + JLPT-quality sort, dropping the tail. (Reassess if users complain.)
- **Max 10 DDG fallback images per word.** Matches userscript today.
- **No max on per-word audio/image media count beyond the 50-example cap** — bounded by that.

### WK vocab corpus enumeration

We need a list of all WK vocab to warm. Three options:

1. **Use the WK API** with the maintainer's personal API token (free, public): `GET /v2/subjects?types=vocabulary` returns all 6500 vocab with `characters` we can use as the `word` field. Paginated, ~30 pages. Run once on cron and cache the result for the month.
2. **Use a community-maintained vocab list** (e.g., from the WaniKani-API GitHub repos). Less coupled but goes stale.
3. **Lazy-only** — never enumerate; warm each word the first time a client requests it. Simpler but every WK level-1 student pays the cold-start cost on their first day.

Going with (1) + (3) together: cron does pre-warm, lazy fills any gaps (new vocab WK adds mid-month). WK API token in env var; no per-user keys.

## Local dev setup

Goal: run the whole stack on the maintainer's laptop with one command. The first iteration is "local-only, no DO" so we can build and test before paying for anything.

```yaml
# docker-compose.dev.yml (sketch — actual file written when we build)
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: wkvocab
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    ports: ["5432:5432"]

  minio:                                # S3-compatible local Spaces stand-in
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: dev
      MINIO_ROOT_PASSWORD: devdevdev
```

Then `bun dev` runs the server, points at those two containers via env vars. The userscript can be pointed at `http://localhost:3000` via a settings field for testing before flipping to production.

Userscript `@connect` directive in dev: add `localhost`. In prod: just our public domain.

## Userscript changes

Once the server exists, the userscript drops nearly all of its current data layer:

- **Deleted**: `buildIkUrl`, `buildIkAudioUrl`, `buildIkImageUrl`, `buildTtsUrl`, `resolveIkFolderAndCategory`, `ikTitleToFolder`, `prettifyTitle`, `fetchIkAudioBlobUrl`, `fetchAndCacheTts`, `fetchDdgImages`/`fetchDdgImagesCached`, all the GM_xmlhttpRequest plumbing, the `Referer` spoofing, the negative-cache logic, the index_meta fetch.
- **Deleted `@connect`**: `apiv2.immersionkit.com`, `duckduckgo.com`, `translate.googleapis.com`. Replaced with just our domain.
- **`@grant`**: probably can drop `GM_xmlhttpRequest` entirely — plain `fetch()` works against our own CORS-allowing API. Stays in the sandbox path only if we end up needing some niche thing.
- **Kept**: settings, render layer, picker UI, JLPT filtering/sorting (still client-side — settings vary per user), selections persistence, hotkey, autoplay logic.
- **New**: a single `fetchVocab(word)` that calls `GET /v1/vocab/:word` and returns the JSON. Cache locally for a day per word to avoid repeated fetches across review sessions.

`JLPT_VOCAB` and `scoreJlpt` move to the server. The client still needs `jlptMax` to filter/sort but the server hands it back per-example.

Net effect: the userscript shrinks substantially and stops needing Tampermonkey-specific powers. Long-term this opens the door to a vanilla browser extension.

## Deployment story

First milestone is local: run with docker-compose, point a local copy of the userscript at it, verify a few words work end-to-end.

Production milestone:

1. Provision DO Droplet ($6/mo, Ubuntu LTS, Singapore or NYC region).
2. Provision DO Managed Postgres ($15/mo, smallest tier).
3. Provision DO Spaces ($5/mo) — get the CDN endpoint URL, that's what we put in `audioUrl` / `imageUrl`.
4. Point a domain (subdomain of something the maintainer owns) at the droplet via Cloudflare.
5. Deploy via a single shell script that pulls latest from git, runs `bun install && bun run build`, restarts the systemd unit. No Docker in prod (overhead not worth it on a single droplet).
6. Run `POST /v1/admin/warm { scope: "all" }` manually for the first warm. ~few hours. Subsequent runs are cron-scheduled.
7. Publish updated userscript to greasyfork pointing at the production URL.

Environment variables (all on the droplet, none in the repo):

```
DATABASE_URL=postgres://...
SPACES_ENDPOINT=https://sgp1.digitaloceanspaces.com
SPACES_BUCKET=wk-enhanced-api-media
SPACES_CDN_ROOT=https://wk-enhanced-api-media.sgp1.cdn.digitaloceanspaces.com
SPACES_ACCESS_KEY_ID=...
SPACES_SECRET_KEY=...
WK_API_TOKEN=...              # the maintainer's personal token, for vocab list
ADMIN_TOKEN=...               # for /v1/admin/warm
PORT=3000
```

## Cost projection

Monthly steady-state:

| Item | Cost |
|---|---|
| DO Droplet (basic) | $6 |
| DO Managed Postgres (smallest) | $15 |
| DO Spaces (250GB + 1TB egress) | $5 |
| Cloudflare (free tier) | $0 |
| Domain | ~$1/mo amortized |
| **Total** | **~$27/mo** |

Optional reductions:
- Self-hosted Postgres on the droplet: -$15. Trade is occasional ops pain.
- Drop Cloudflare and serve TLS directly: $0 saved (already free); -1 layer of cache, +1 hour to debug DDoS if it ever happens. Not worth it.

Egress is the main variable cost. If the audience ever grows large enough to blow through 1TB/mo, Spaces overage is $0.01/GB after 1TB. A 5TB month is +$40 — that's the surge ceiling worth knowing about.

## Rate limiting & abuse

Without accounts we lean on Cloudflare:

- **Rate Limiting Rule (free tier allows 1 rule)**: 100 requests per minute per IP across all `/v1/*` paths. Sufficient for any legit review pace; blocks scraping or someone curl-looping our endpoint.
- **Bot Fight Mode**: on. Catches the cheap stuff.
- **Cache Rule**: `Cache-Control: public, max-age=86400, stale-while-revalidate=2592000` on `/v1/vocab/:word`. Edge serves the bulk of traffic; origin barely moves.
- **`/v1/admin/*`**: blocked at Cloudflare except from the maintainer's IP. Bearer token auth is the inner defense.

Application-layer (server itself):

- Reject any `:word` that's not in the WK vocab corpus with a fast 404 (no IK call, no DB lookup beyond a small in-memory set). Stops the "warm-by-lookup" abuse pattern.
- Per-IP request budget enforced by a simple in-memory token bucket as a backstop in case Cloudflare's misconfigured. Resets on restart, that's fine.

## Observability

- **Logs**: structured JSON to stdout, journaled by systemd. Fields: `ts`, `level`, `event`, `word`, `ms`, `status`. Tail via `journalctl -fu wk-enhanced-api`. Rotated by journald.
- **Metrics**: bare minimum — `/v1/health` exposes `{warmedWords, lastWarmRunAt, serveCountLast24h}`. We do not need Prometheus / Grafana for this scale.
- **Cost-watching**: DO billing dashboard + weekly self-emailed digest of Spaces egress (one-line cron script that calls the DO API).
- **Errors**: log to stdout. If pain becomes real, add Sentry's free tier later. Not v1.

## Migration / rollout plan

1. Build the server locally. Iterate against `localhost:3000` with a dev copy of the userscript that has a "use local server" setting.
2. Deploy to DO. Pre-warm runs to completion.
3. Ship a userscript version where the IK/DDG/Google paths still exist but the new server is the primary, with the old paths as fallback on server error. This lets early adopters test before we burn bridges with the old code.
4. After a couple weeks of stable traffic, ship a version that removes the old paths entirely. Userscript shrinks by ~half.
5. Update CLAUDE.md to reflect the new architecture; the "dead-end warnings" section about IK encoding becomes a server concern, not a client one.

## Open questions / deferred

- **What if IK goes down or changes their API?** The cached payloads in Postgres + media in Spaces keep serving stale-but-functional content forever. We'd lose new-vocab warming until we fixed the IK integration. Acceptable.
- **What if a user wants to share a sentence selection?** Not in v1. Could later add `GET /v1/vocab/:word?at=<exampleId>` that returns a single example, and the userscript could deep-link to it.
- **What if the bundled JLPT_VOCAB is wrong for a specific word?** Same story as today — fail-open. If a community member submits a better source, swap the bundled JSON.
- **Should we offer an opt-in telemetry channel?** Users sometimes want to share that they've reviewed N cards. Could add `POST /v1/telemetry/anonymous` with rate-limited counters. Punted to a "we'll see if anyone asks" bucket.
- **What about TLS for direct droplet access (no Cloudflare)?** Caddy auto-TLS in front of the Bun process. Standard setup. Doc when we actually deploy.
- **DDG scraping fragility**: DDG occasionally rotates the `vqd` HTML structure. When it breaks, the warm pipeline logs an error per word but the existing fallback_images stay served. Fix detection: weekly assertion in the warm run that DDG returned at least N results for a sentinel word like `犬`.

---

**Next concrete step when we start building**: scaffold the Bun + Hono project locally with the docker-compose dev environment, implement `GET /v1/vocab/:word` end-to-end for a single hardcoded word (skip the pre-warm pipeline), verify the userscript can render against it. Everything else slots in after that proof-of-life.
