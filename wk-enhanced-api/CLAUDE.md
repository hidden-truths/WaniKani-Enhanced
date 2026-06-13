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

That's it for dev. **No Postgres, no MinIO** — Bun has built-in SQLite (`bun:sqlite`) and S3 (`Bun.S3Client`); dev uses SQLite + the local filesystem, prod swaps to an S3-compatible bucket via `STORAGE_DRIVER=s3`. The "Postgres + MinIO" story in the original SERVER_DESIGN.md was the original plan; we dropped both.

Docker IS used in prod (as of the Dockerize commit) — single-container deploy via [Dockerfile](Dockerfile) + [compose.yaml](compose.yaml), brought up by a thin systemd wrapper. **Dev does not need Docker** — `bun dev` is still the fastest iteration loop. The Compose stack is opt-in if you want to verify the prod-equivalent container behavior locally (`docker compose up --build`); deploy walkthrough lives in [deploy/README.md](deploy/README.md).

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
| `COOKIE_SECURE` | `false` | `true` | Session cookie `Secure` flag. MUST be false on `http://localhost` (browser drops Secure cookies on http → login silently fails); true in prod where Cloudflare fronts HTTPS. |
| `COOKIE_DOMAIN` | blank (host-only) | `.wkenhanced.dev` | Session-cookie `Domain`. Blank = host-only (correct for dev + any same-origin deploy). Prod sets the dotted apex so the cookie set by `api.` also reaches the apex study-app origin. `lib/auth.ts` set + delete both honor it. |
| `STUDY_APP_ORIGINS` | `http://localhost:5173` (the Vite default) | `https://wkenhanced.dev` | Comma-sep cross-origin allowlist for the study-app routes' credentialed CORS (`config.studyApp.allowedOrigins`). Only these origins get the echoed-origin + `Allow-Credentials` branch. |
| `MINNA_OWNER_EMAILS` | usually blank (any signed-in user) | owner email(s) | Comma-sep allowlist gating the みんなの日本語 dashboard + audio (`/v1/minna/*`). Empty = any signed-in account; set to your email in prod to keep the copyrighted Minna content private. |
| `SESSION_TTL_DAYS` | `30` | `30` | Login session lifetime (cookie maxAge + DB `expires_at`). |
| Study-app serving | own `vite dev` process on `http://localhost:5173` | own **nginx container** (`web:` service); apex `https://wkenhanced.dev` → `127.0.0.1:8080` | SEPARATE container now — this API serves NO study-app assets (`/`, `/study`, `/app.js`, … are gone; `/` returns service-info JSON). Apex Tunnel ingress → `:8080`, `api.` → `:3000`. See deploy/README.md "two-container cut-over". |
| `WK_API_TOKEN` | usually blank (skip `scope:all` warms) | required for monthly bulk warm | Personal token from your WK settings. |
| Env file location | `wk-enhanced-api/.env` | `/etc/wk-enhanced-api/env` (chmod 600 root) | Prod uses Compose `env_file:`; Bun's `.env` auto-load is for dev only. |
| Process supervisor | `bun dev` (your terminal) | `systemctl ... wk-enhanced-api.service` → `docker compose up -d` | Container runs the bun process inside; systemd just brings the stack up on boot. Unit + compose.yaml live in `deploy/` and the repo root respectively. |
| Userscript base URL | `http://localhost:3000` (set in WKOF settings) | `https://api.wkenhanced.dev` (DEFAULTS.apiServerUrl + @connect) | Single source of truth: `PROD_API_BASE` + `DEV_API_BASE` constants at the top of the userscript IIFE. |
| Bun binary location | Wherever you installed it on the host | Inside the `oven/bun:1.3.8` container image only | Pinned to the same point release as dev — bump both in lock-step. Host no longer needs Bun installed for prod (the migration steps in deploy/README.md leave `/usr/local/bin/bun` orphaned but harmless). |
| Runtime user/uid | Whatever runs `bun dev` (your user) | Container `bun` user, uid 1000 | Host `/var/lib/wk-enhanced-api` MUST be owned by 1000:1000 so the bind mount is writable from inside the container; the deploy README has the `chown` step. |
| Container image | n/a | Built from `Dockerfile` via `compose.yaml`; multi-stage `oven/bun:1.3.8` → production node_modules + src/ + data/ + the two `deploy/*.ts` backup scripts | First `systemctl start` builds locally; subsequent `restart` is near-instant. CI publishing to GHCR is a follow-up — see [NEW_FEATURES.md](../NEW_FEATURES.md) "Dockerize the server". |

If you're adding something that doesn't fit a row above — a new external service, a new auth token, a new on-disk path — the test for "does it belong here" is: *would forgetting to update the prod side cause a runtime failure?* If yes, add a row.

## Architecture

```
src/
├── index.ts                  # OpenAPIHono app, CORS + request log, /docs, /openapi.json, static /media route, boot
├── config.ts                 # env-var loading; everything goes through here, no process.env scattered
├── schemas.ts                # Zod schemas → single source of truth for runtime validation + OpenAPI generation
├── db/
│   ├── schema.sql            # SQLite tables: vocab/warm + accounts/progress + the sentence store (sentence, translation, sentence_link, sentence_tag, sentence_annotation + public_sentence VIEW)
│   └── client.ts             # repo functions; no SQL escapes this file
├── lib/
│   ├── jlpt.ts               # scoreJlpt() — direct port of userscript logic; bundled JLPT_VOCAB at data/jlpt-vocab.json
│   ├── ikTitles.ts           # the lossy-title-encoding workaround (heuristic fallback when /index_meta misses)
│   ├── log.ts                # structured-JSON logger; one line per event
│   ├── zodHook.ts            # shared defaultHook → reformats Zod failures into our ErrorSchema shape
│   ├── auth.ts              # password hashing (Bun.password), session cookie + currentUser() helpers
│   └── sleep.ts
                             # (The study app used to live here as web/ and be served at /.
                             #  It's now its OWN Vite project + nginx container — ../study-app/ —
                             #  served at the apex wkenhanced.dev, talking to this API CROSS-origin.
                             #  This API no longer serves any static study-app assets. See
                             #  ../study-app/CLAUDE.md + the cross-origin CORS in index.ts.)
├── routes/                   # one file per route group; each is an OpenAPIHono sub-router
│   ├── health.ts
│   ├── vocab.ts              # GET /v1/vocab/{word} + POST /v1/vocab/batch
│   ├── indexMeta.ts
│   ├── admin.ts              # POST /v1/admin/warm + GET /v1/admin/jobs (bearer-gated)
│   ├── auth.ts              # POST /v1/auth/{register,login,logout} + GET /v1/auth/me (cookie session)
│   └── progress.ts          # GET/PUT /v1/progress/{app} — per-user study progress (cookie-gated)
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

SQLite tables (schema in [src/db/schema.sql](src/db/schema.sql)) — the vocab/warm + accounts/progress set below, plus the **sentence store** (last entry):

- `vocab_examples` — pre-warmed payload per word. One row per word. `payload` is JSONB-style TEXT (the entire response body). `serve_count` + `last_served_at` track usage (for LRU eviction later if needed).
- `index_meta` — singleton row (`id=1`) caching IK's `/index_meta` deck map (~96 entries, ~12KB).
- `warm_jobs` — append-only audit log. One row per `warmSingle` or `warmAll` invocation. Exposed via `GET /v1/admin/jobs`.
- `users` — one row per account. `email` (lowercased, UNIQUE) + `password_hash` (`Bun.password`, argon2id). Added for the study-app accounts feature.
- `sessions` — opaque session tokens (256-bit hex) → user, with `expires_at`. One row per active login; the token is the `wk_session` httpOnly cookie. Pruned lazily on expired-token access + hourly via `deleteExpiredSessions()`. `ON DELETE CASCADE` from `users`.
- `user_progress` — per-user, per-app JSON progress blob (PK `(user_id, app)`; `app` ∈ {`verbs`, `custom-verbs`, `settings`, `minna`} — the progress store, the custom-verb definitions, the Settings-page preferences, and the みんなの日本語 dashboard's per-lesson notes each sync as a separate row). The cloud-synced replacement for the study app's localStorage. The blob is opaque to the server. `ON DELETE CASCADE` from `users`.
- `study_sessions` — append-only, never-pruned log of completed study sessions (one row per finished session: `right_count`/`total_count`/`mode`/optional `details` JSON). The durable history record: the client also keeps a capped copy inside the `verbs` blob for charts, but this table is the source of truth so session history is never lost. Written by `POST /v1/sessions`. `ON DELETE CASCADE` from `users`.
- `minna_recordings` — metadata index for the みんなの日本語 record-and-compare feature (Phase 2). One row per saved voice take (`lesson`/`item_key`/`storage_key`/`content_type`/`duration_ms`). The audio bytes are **private** storage objects (`acl:'private'`, never a public URL); served only through the owner-scoped `GET /v1/audio/recordings/{id}` (legacy alias `/v1/minna/recordings/{id}`). Old takes are pruned per `(user, lesson, item_key)` to the user's keep-N (default 3, ≤ 20) so the table + bucket stay bounded. `ON DELETE CASCADE` from `users` (the route drops the storage objects).
- `audio_variants` — manifest of pre-generated **tagged** voice clips (audio-unify work). One row per `(text_hash, provider, gender)` we've rendered into the `audio/<provider>/<gender|'default'>/<hash>.<ext>` keys, so `GET /v1/audio/variants?text=` lists which specific voices exist for a text in one indexed query. Only SPECIFIC voices are recorded (Siri male/female today); `google` (lazy gtx) + the legacy `default` tts voice are implicit. Populated by `scripts/generate-tts.ts --variant`. `text_hash` matches `services/tts.ts` `ttsTextHash()`. No FK (text-addressed, not per-user).
- **Sentence store** (unified-sentence rearchitecture; backs 独り言 Self-Talk **and** built-in vocab example sentences). One canonical row per sentence that surfaces REFERENCE by id instead of embedding text — the foundation for cross-surface reuse / de-dup / later NLP. Phase 1 = Self-Talk; **Phase 2 = built-in vocab examples** (`source='example'`, public rows linked to cards). Minna + NLP are later phases.
  - `sentence` — `{ext_id, hash, text, furigana(JSON [{t,r?}]), source('selftalk'|'example'|…), public, visibility, created_by, created_at}`. `text` = `plainText(jp)` byte-for-byte; `hash` = `ttsTextHash(text)` computed server-side (the audio-layer key). `public=1, visibility='public', created_by=NULL` = curator (seeded); `public=0, visibility='private', created_by=<user>` = user-authored. Partial unique index `(hash) WHERE public=1 AND visibility='public'` — only the export/anon slice is unique-by-hash (private rows may share a hash; no global UNIQUE). Example `ext_id` = `ex-<hash>` (identity-by-hash) so two cards/tiers sharing identical text reuse ONE row. `ON DELETE CASCADE` from `users`.
  - `translation` / `sentence_tag` — `{sentence_id, lang, text, ordinal}` and `{sentence_id, kind('scene'|'grammar'|…), value}` child rows.
  - `sentence_link` — polymorphic ownership `{owner_type('card'|'grammar_point'|'conversation'|'lesson'|'selftalk'), owner_id?, tier?, role?, ordinal, clip_*}`. Self-Talk uses `owner_type='selftalk'`; **card examples use `owner_type='card'`, `owner_id=<rank>`, `tier='N5'..'N1'`** — TIER LIVES ON THE LINK, so a sentence reused by several cards/tiers is ONE row + one link per (card, tier). Grammar/conversation owners get wired in later phases (schema supports them now).
  - `sentence_annotation` — GiNZA tokens/bunsetsu, 1:1 by `sentence_id` (**Phase 4 — NLP enrichment**). Populated by an OFFLINE batch ([../sentence-nlp/](../sentence-nlp/), `ja_ginza_electra`) → committed `data/annotations.json` → `scripts/seed-annotations.ts`; the **server only ever READS** it (no Python on the droplet). Token `start/end` are **UTF-16 offsets** into `text` (see the offset-contract dead-end). Write = `db.upsertAnnotation` (re-asserts the offset contract, throws on mismatch); read = `db.getAnnotation({extId, viewer})`, which shares the **exact same `VIEWER_VISIBLE` privacy predicate** as `getSentences` (pinned in `client.test.ts`). **Grammar tags** detected by the same batch (a curated ~37-point N5/N4 catalog in `sentence-nlp/patterns.py`) land in `sentence_tag(kind='grammar')` via `db.setGrammarTags` — written for `source='example'` rows only (Self-Talk keeps its hand-authored tags), reusing the study-app's `SELFTALK_GRAMMAR` ids so detected + curated grammar search through one vocabulary. Serving annotations + grammar on `/v1/sentences` is a later commit.
  - `public_sentence` VIEW — `SELECT * FROM sentence WHERE public=1 AND visibility='public'`. Anon/export read ONLY this view; it can't see private or gated rows.
  - **Privacy choke-point:** every read goes through `db.getSentences({ownerType, ownerId?, viewer})` which ALWAYS ANDs `(public=1 OR created_by=:viewer)`, fail-closed (null viewer → public only), and returns **one entry PER LINK** (a reused sentence reports every owner_id/tier; `ownerId` narrows to one). Pinned breach-prevention tests live in `db/client.test.ts` — keep them green. Writes (`createSentence`/`updateUserSentence`/`deleteUserSentence`) enforce ownership in SQL; `upsertPublicSentence` is the idempotent Self-Talk seed path; `seedExampleSentence` (reuse-by-hash via `getPublicSentenceByHash` + card-link replace) is the idempotent example seed path. Served by `routes/sentences.ts` (`?ownerType=selftalk|card[&ownerId=]`); `/v1/sentences` is in the `STUDY_ROUTE` credentialed-CORS allowlist.

These account tables are **backed up alongside the rest of the DB** by the existing daily `deploy/backup.ts` snapshot — no separate handling. They carry real user data (hashed passwords + study progress + session history), so the backup is load-bearing, not just a convenience.

Media binaries live in **either** the local filesystem (`STORAGE_DRIVER=local`, dev) **or** S3-compatible storage (`STORAGE_DRIVER=s3`, prod). Object key conventions:

- `audio/<category>/<encodedTitle>/<exampleId>.mp3` — IK voice-actor recording, OR Google TTS fallback (same key, the `hasOriginalAudio` flag on the payload distinguishes).
- `image/<category>/<encodedTitle>/<exampleId>.jpg` — IK screenshot.
- `ddg/<word>/N.jpg` — DuckDuckGo illustration fallback pool, up to 10 per word.
- `recording/<userId>/<lesson>/<sanitizedItemKey>/<uuid>.webm` — a user's voice take (Minna Phase 2). **Private** object (`acl:'private'`) — served only via the gated `/v1/audio/recordings/{id}` route (legacy alias `/v1/minna/recordings/{id}`), never its public URL. The authoritative key lives in the `minna_recordings` row.
- `tts/<sha256(text)>.{m4a,mp3}` — the **default**-voice synth clip (`.m4a` pre-generated Apple voice preferred, `.mp3` the persisted Google fallback). The ~960 pre-generated clips + legacy `/v1/tts` live here.
- `audio/<provider>/<gender|'default'>/<sha256(text)>.<ext>` — a **tagged** voice variant (audio-unify): a specific voice (e.g. `audio/siri/female/<hash>.m4a`) so multiple voices for the same text coexist. Discoverable via the `audio_variants` manifest; written by `generate-tts.ts --variant`. Additive — the `tts/` keys above are untouched.

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
| GET | `/` , `/_info` | — | Service-info JSON (`app: https://wkenhanced.dev`). The study app is its own container now — this API serves no static study-app assets. |
| GET | `/v1/audio/variants?text=` | — | Catalog: which SYNTH voices exist for a text (manifest rows + always-available `google`). Native + user-take variants are folded in client-side, not here. `no-store`. |
| GET | `/v1/audio/tts?text=&voice=` | — | Serve a tagged synth clip via `resolveTts`. `voice` (e.g. `siri:female`) prefers its pre-generated `.m4a` then falls through to the default 3-tier; omitted/`google` = default voice. `Cache-Control: immutable`. |
| GET | `/v1/audio/native?src=` | Cookie | Native-audio MP3 (gated). Same handler as the legacy `/v1/minna/audio`. |
| POST/GET/DELETE | `/v1/audio/recordings[?…/{id}]` | Cookie | Per-user voice takes (gated). Same handlers as the legacy `/v1/minna/recordings*`. |
| GET | `/v1/tts?text=` | — | **Legacy alias** of `/v1/audio/tts` with the default voice. Three-tier cache (in-process → storage `tts/<sha256(text)>.{m4a,mp3}` → Google) now in `resolveTts`. Kept for existing clients. 400 missing/over-200-char, 502 upstream. |
| POST | `/v1/auth/register` | — | Create account; sets `wk_session` httpOnly cookie. 409 if email taken. Rate-limited (8/hr/IP). |
| POST | `/v1/auth/login` | — | Log in; sets cookie. 401 on bad creds (constant-time, no email enumeration). Rate-limited (20/15min/IP). |
| POST | `/v1/auth/logout` | Cookie | Clear session (idempotent). |
| GET | `/v1/auth/me` | — | `{user}` or `{user:null}`. `Cache-Control: no-store`. |
| GET | `/v1/progress/{app}` | Cookie | Fetch the user's progress blob (`app` ∈ {`verbs`, `custom-verbs`, `settings`}). 401 if logged out. |
| PUT | `/v1/progress/{app}` | Cookie | Replace the progress blob (≤1 MB). |
| POST | `/v1/sessions` | Cookie | Append a completed study session to the durable log; returns `{ok,id,count}`. 401 if logged out. |
| GET | `/v1/minna/lessons` | Cookie | List lessons with curated みんなの日本語 content. Signed-in only; optionally narrowed to the `MINNA_OWNER_EMAILS` allowlist. |
| GET | `/v1/minna/lessons/{n}` | Cookie | Curated Minna lesson JSON (`data/minna/lesson-<n>.json`). Same gate; 404 if absent. |
| GET | `/v1/minna/audio?src=` | Cookie | **Legacy alias** of `/v1/audio/native` — native-audio MP3 proxied from vnjpclub + cached (strict `/Audio/…mp3` SSRF guard). Same handler + gate. |
| `*` | `/v1/minna/recordings*` | Cookie | **Legacy aliases** of `/v1/audio/recordings*` (POST save / GET list / GET `{id}` bytes / DELETE). Same handlers + gate. |
| GET | `/v1/minna/practice` | Cookie | Per-lesson practice history (`recordingSummary`): one row per lesson recorded in, with distinct-item + take counts and the last-practiced time. Own path so the `/recordings/{id}` param route can't shadow it. Same gate. |
| GET | `/v1/sentences?ownerType=` | Cookie* | Unified sentence store (Phase 1: `ownerType=selftalk`). Returns public rows + the caller's own private rows through the privacy choke-point (`db.getSentences`). *Anon-readable (public rows only); still in `STUDY_ROUTE` because the study app's call is credentialed. `no-store`. |
| POST | `/v1/sentences` | Cookie | Create a PRIVATE user sentence (body carries the client `ext_id`). Idempotent re-POST of your own id → existing row; another account's id → 409; furigana mismatch → 400. |
| PUT/DELETE | `/v1/sentences/{id}` | Cookie | Replace / delete one of YOUR sentences (ownership enforced in SQL → 404 if not yours). |
| GET | `/docs` | — | Scalar UI. |
| GET | `/openapi.json` | — | Auto-generated OpenAPI 3.1 spec. |
| GET | `/_info` | — | Service-info JSON (the old `/` payload, relocated now that `/` serves the app). |

**Error response contract** — every non-2xx response is `{ code, error, detail? }`. Switch on `code` (stable enum), never on `error` (human-readable, may change). The enum: `validation_error`, `unauthorized`, `not_found`, `conflict`, `upstream_failure`, `service_unavailable`, `internal_error`. (`conflict` is currently only used by `POST /v1/admin/warm {"scope":"all"}` when a warmAll is already in flight — returns 409.)

**Conditional GETs** — `GET /v1/vocab/{word}` returns a strong `ETag` derived from the payload's `fetchedAt`. Clients should cache the ETag and send `If-None-Match` on revisits; we 304 No-Content until the next warm refresh.

## Things that look like bugs but aren't (DEAD-END WARNINGS)

These have been investigated; don't re-explore.

- **`sentence_annotation` token offsets are UTF-16 code-unit offsets, NOT codepoint offsets — do not "simplify" the parser to emit `token.idx`.** The client maps a tapped span back to a token by slicing `sentence.text` in JS, which is UTF-16-indexed; spaCy/GiNZA's `token.idx` is a Unicode *codepoint* offset. They're equal for every BMP character (all kana, kana punctuation, 常用漢字) — so a BMP-only spot check looks fine — but they diverge by +1 per non-BMP codepoint (rare CJK-Ext-B kanji like 𠮟 U+20B9F, a surrogate pair in JS). `sentence-nlp/parse.py` therefore converts to UTF-16 offsets and self-checks every token before writing the artifact, and `db.upsertAnnotation` re-asserts `text.slice(start,end)===surface` against V8 on every write (throws on mismatch). Both layers are pinned by a non-BMP test in `client.test.ts` that asserts the codepoint offsets a naive parser *would* emit are REJECTED. If you swap the model or rewrite the parser, keep emitting UTF-16 offsets — codepoint offsets pass a kana/常用漢字 test and silently corrupt tap targets only on rare kanji.

- **IK title encoding is lossy and there is no clean heuristic recovery.** Multiple original titles collapse to the same encoded form (`"Kanon (2006)"`, `"Kanon  2006-"` → `"kanon__2006_"`). The regex heuristic in [src/lib/ikTitles.ts](src/lib/ikTitles.ts) is fallback-only and provably wrong for `durarara__` → "Durarara" (real: "Durarara!!") and similar. The fix is **always** the `/index_meta` map, not a smarter heuristic. The dead-end cases are pinned as tests in [src/lib/ikTitles.test.ts](src/lib/ikTitles.test.ts) — if anyone tries to "fix" the heuristic they'll see the tests intentionally pinning wrong output with a pointer to the right answer (use the map).

- **IK's direct media bucket (`us-southeast-1.linodeobjects.com/immersionkit/...`) is offline since Aug 2025.** Returns 403 even with spoofed headers. The working path is the `apiv2.immersionkit.com/download_media?path=...` proxy. **Do not try the linode URLs.**

- **JLPT scoring is fail-open by design — that's not a bug.** IK's `word_list` returns surface forms (`食べた`, `見て`); our bundled `JLPT_VOCAB` only has dictionary forms (`食べる`, `見る`). So unknown-token rates are high. We deliberately treat unknown tokens as a skip rather than as "above N1" — including them would over-filter (almost any sentence with a conjugated verb would score above ceiling) and the fail-open default would kick in constantly. **Do not add stem-mapping or suffix-stripping heuristics** unless you have a real morphological analyzer (kuromoji/MeCab); brittle suffix tricks create more false matches than they solve. Sentences with entire-unknown `word_list` score 0 (sentinel); `pickExample` treats 0 as fail-open (always passes the ceiling test).

- **SQLite is the DB even in production.** The original SERVER_DESIGN.md said Postgres; we deviated. The data model is K-V with JSON payloads, the corpus is bounded (~6500 rows), and a single droplet doesn't need a network DB. The repo functions in [src/db/client.ts](src/db/client.ts) hide all the SQL so migrating to Postgres later is mechanical if scale demands it. **Don't pre-emptively add Postgres** "to be safe" — the SQLite story is deliberate. The deploy-shape companion question (k8s vs droplet) is recorded in [docs/decisions/ADR-001-no-kubernetes.md](docs/decisions/ADR-001-no-kubernetes.md).

- **Bulk warm of a fully-cold corpus takes 6–10 hours at the current 500ms rate limit.** ~6700 words × ~50 examples × per-example media downloads (~100 IK calls/word) at 500ms gate ÷ 4-wide concurrency = ~10–25 sec/word. **Re-warms with `force:false` are much faster** — the freshness check in `warmWord` short-circuits already-warmed-and-fresh rows (~1ms DB lookup, no IK call), so only missing/stale rows hit IK. The 2026-05-26 closing-the-gap re-warm finished in ~30 min because only ~1858 of the ~6700 corpus rows were actually missing. **Don't add aggressive concurrency to "speed it up"** beyond the existing per-word 4-wide media batching — IK is a free, community-supported service and we want to stay a polite client. If IK 429s under load, the right response is to investigate `MIN_GAP_MS` (carefully — see next entry), not more parallelism. The `warm.all.word_failed` event count is the right operational signal for "is the rate limit holding"; post-backoff this should be near-zero on a polite warm.

- **IK rate-limit floor must stay ≥500ms — `50ms` triggered a global 429 lockout in production.** The rc2 drop to 50ms (~20 req/sec) on the first prod bulk warm caused IK to 429 every subsequent call across the droplet for ~30 minutes, even for unrelated sub-second curls from the same IP. Recovery required waiting it out. **429-with-exponential-backoff is now in place** (commits `983dcb7` + `942175c` — both `fetchJson` and `ikDownloadMedia` retry 429s with base-1s × 2^attempt waits up to 30s, honor `Retry-After`, 3 retries before giving up). That backoff *did its job* during the 2026-05-26 bulk re-warm — caught transient 429s and recovered cleanly. **But the rc2 lockout suggested IK has a per-IP soft ceiling that backoff alone doesn't address** — sustained high-rate traffic can still trip a ban that takes ~30 min to clear, during which backoff just delays the inevitable. Conclusion: lowering `MIN_GAP_MS` below 500ms remains a careful-small-scope-verification-required operation, not a casual flip. The "Per-endpoint IK rate limits" entry in NEW_FEATURES.md outlines a safer staged-lowering recipe if we ever want to revisit. See commits `dcfde04` (initial floor restoration), `983dcb7`/`942175c` (backoff), and the comment block above `MIN_GAP_MS` in `services/ik.ts` for the full history.

- **Warm pipeline MUST throw (not silently return empty) on `ikSearch` failure.** Pre-fix behavior caught the exception, left `rawExamples = []`, and upserted an empty payload with `fetched_at = now` — which made the next warm see `fresh` and skip indefinitely. During the first prod warm, that bug + the 429 storm = 6186/6186 rows empty. Fix at `warm/pipeline.ts:140-144`: re-throw from the catch so `warmAll`'s try/catch counts the word as failed *without writing to vocab_examples*, and the next warm retries. A successful ikSearch returning `[]` (genuine "no examples") is still upserted as a 0-example payload — that's factual, not a failure. See commit e7f8224.

- **Bun's default `serve()` `idleTimeout` is 10s — way too short for cold-fill `GET /v1/vocab/{word}` responses.** During lazy-fill of an uncached word, `warmWord` runs synchronously for 10–30s (one IK search + ~100 media downloads at the 500ms IK rate-limit floor). The handler doesn't write any bytes during that wait, so Bun considers the connection idle and resets it — the server-side warm still finishes and populates the row, but the client sees a connection drop with no HTTP status (curl reports `http=000`). Discovered during Phase 2 smoke-test on 2026-05-25 when cold-fills of 本/日本 took 18s server-side but returned `000` to the client at exactly 12s. Fix: `idleTimeout: 60` on the export in [src/index.ts](src/index.ts) — covers our worst observed cold warm and stays under Cloudflare's 100s free-tier edge timeout. See commit 9be345c. **If you ever raise `WARM_REFRESH_DAYS` or add a slow new step to the warm pipeline that pushes per-word latency past 60s, raise `idleTimeout` to match.**

- **Cross-origin `fetch()` cannot read the `ETag` header unless we explicitly expose it.** ETag is not on the CORS-safelisted response header list, so without `Access-Control-Expose-Headers: ETag` on every response, the userscript's `res.headers.get('ETag')` returns null even though the server sends the header on the wire. Discovered during Phase 2 smoke-test: server logs showed strong ETags being emitted (`"mpli0kwq"`), direct curl confirmed the header was present, but `debugWkIkApi` in the browser showed `etag: null` (the diagnostic helper was renamed to `debugWkEnhancedApi` in v2.0.0). Without a client-side etag, the userscript can't send `If-None-Match` on revisits, so every cached row re-downloads the full ~40KB payload — functionally correct but bandwidth-wasteful, and especially bad under traffic spikes. Fix: `c.header('Access-Control-Expose-Headers', 'ETag')` in the CORS middleware at [src/index.ts](src/index.ts). See commit bf3e153. **If you ever add another response header that the userscript needs to read in JS, append it to this comma-separated list — every new header is invisible-by-default cross-origin.**

- **Cloudflare downgrades strong ETags to weak (`W/"<tag>"`) on every compressed response, so `If-None-Match` comparison MUST tolerate the `W/` prefix.** RFC 7232 §2.3.2 says `If-None-Match` uses weak comparison anyway (same opaque tag, ignoring `W/`), but a naive strict-equality check (`ifNoneMatch === etag`) misses every Cloudflare-mediated revalidation. Discovered during Phase 2 smoke-test: origin emitted `ETag: "mpli0kwq"`, Cloudflare re-emitted `ETag: W/"mpli0kwq"`, userscript stored and re-sent the weak form, origin compared by string equality, mismatch, returned full 200 every time → no 304s ever in production. Fix at [src/routes/vocab.ts](src/routes/vocab.ts): new `normalizeEtag` helper strips an optional leading `W/` from the client-supplied If-None-Match before comparison. Origin still emits a strong ETag (Cloudflare adds the weakening on its way out); same-origin direct curls still 304 cleanly. See commit 7539a26. **Don't try to suppress Cloudflare's weakening upstream** — it's tied to compression and turning that off costs more bandwidth than the wart costs.

- **DO Spaces "Limited Access" keys don't grant `s3:PutObjectAcl`.** Even with Read/Write/Delete scope, uploads with `acl: 'public-read'` return AccessDenied. We tried two workarounds (set-acl after upload via `s3cmd setacl`; bucket-level public-read via `s3cmd setpolicy`) — the latter doesn't work either because DO Spaces appears to NOT expose `PutBucketPolicy` through their S3 API (returns 403 even with Full Access keys). Conclusion: **use a Full Access Spaces key in prod.** On a single-tenant droplet (one bucket, one app, key never leaves `/etc/wk-enhanced-api/env`) the risk delta vs Limited Access is marginal. See the inline comment in `services/storage.ts:put` and commit 94aa16d.

- **`S3_FORCE_PATH_STYLE=true` is mandatory for DO Spaces + Bun.S3Client.** With `false` (= `virtualHostedStyle: true`), Bun constructs PutObject requests that DO interprets as `CreateBucket` and returns "The bucket already exists" — uploads silently fail to deliver objects (file.write does NOT throw; only the absence in subsequent `exists()` reveals the bug). Path-style addresses (`https://endpoint/bucket/key`) are Bun's default for non-AWS endpoints and what DO expects. The `MEDIA_PUBLIC_BASE` env var, which puts the bucket in the hostname for CDN reads, is independent of upload addressing. See commit 1732275.

- **~~Bun must live outside `/root`~~ — obsolete post-Dockerize.** The bare-metal systemd unit used to be hardened with `ProtectHome=true`, which masked `/root/.bun/bin/bun` even from a root-owned ExecStart. Workaround was to `install -m 755 /root/.bun/bin/bun /usr/local/bin/bun` after the official Bun installer ran. **Now superseded**: the production deploy runs Bun inside the `oven/bun:1.3.8` container image, so the host doesn't need any Bun binary at all. The migration recipe in deploy/README.md leaves `/usr/local/bin/bun` orphaned (harmless; remove manually if you want). Original context preserved here in case a future contributor reads commit `5e4f863` and wonders why that bridge step disappeared.

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

## Accounts + study app (added post-v1)

The server now also hosts the **Japanese verb-trainer study app** at `/` (static files in `web/`) and backs it with **email/password accounts + per-user sync**, a **Google TTS proxy** (`/v1/tts`), and **per-IP rate limiting** on the auth endpoints. This is a distinct surface from the vocab/warm API the userscript uses — it has its own auth model and its own routes.

> **DONE — the two-container split shipped.** The study app is now a **separate application
> in its own Docker container** ([../study-app/](../study-app), Vite→nginx) served at the apex
> `wkenhanced.dev`; this API is a *separate* container at `api.wkenhanced.dev` (two services in
> [compose.yaml](compose.yaml)). They're same-site but **cross-origin**, so the cookie uses
> `Domain=.wkenhanced.dev` + an origin-scoped credentialed-CORS branch (see [index.ts](src/index.ts)
> `STUDY_ROUTE` + `lib/auth.ts`). The bullets below are updated to that arrangement. Cut-over
> runbook: [deploy/README.md](deploy/README.md) "Serving the study app at wkenhanced.dev".

> **The study-app frontend has its own docs** in [../study-app/](../study-app): README (overview/run),
> CLAUDE.md (module map + design-system contracts + dead-ends), NEXT_STEPS, CARDS, MINNA. This
> section below covers only the **server side** of that app (auth/progress routes + tables).

- **Auth model:** opaque session token in an `httpOnly`, `SameSite=Lax`, `Secure`(prod) cookie named `wk_session`. No JWT, no bearer token, no new dependency — `Bun.password` (argon2id) hashes passwords, `hono/cookie` sets the cookie, `bun:sqlite` stores sessions. See [src/lib/auth.ts](src/lib/auth.ts).
- **Cross-origin, credentialed:** the app (wkenhanced.dev) and this API (api.wkenhanced.dev) are same-site but different ORIGINS, so the blanket `Access-Control-Allow-Origin: *` is illegal for these cookie-bearing requests. The CORS middleware in [index.ts](src/index.ts) has a second branch: for the study-app routes (`STUDY_ROUTE` = `/v1/(auth|progress|sessions|minna|audio)`) from an allowlisted origin (`config.studyApp.allowedOrigins`, env `STUDY_APP_ORIGINS`) it echoes the **exact** origin + `Access-Control-Allow-Credentials: true` + `Vary: Origin` + `PUT`; everything else keeps blanket `*`. The cookie reaches both subdomains via `Domain=.wkenhanced.dev` (env `COOKIE_DOMAIN`, set in `lib/auth.ts`). A non-allowlisted origin falls to `*`, which the browser refuses to use with credentials — so cross-site cookie auth is locked to the study app. Native audio + voice recordings (`/v1/audio/native`, `/v1/audio/recordings*`, and their legacy `/v1/minna/*` aliases) are fetched by an `<audio crossOrigin="use-credentials">`, which is why `audio` is in `STUDY_ROUTE` (its public `tts`/`variants` sub-paths tolerate the echoed-origin branch — the study app is the only, allowlisted, caller).
- **Progress is opaque + multi-app:** `PUT /v1/progress/{app}` stores whatever the client serializes. The server validates size (≤1 MB) and the `app` enum (`verbs` = the progress `store`; `custom-verbs` = custom verb definitions; `settings` = the Settings-page preferences), nothing else. The client owns its own schema/versioning. Adding an app key is a one-line enum widen in [src/routes/progress.ts](src/routes/progress.ts) — the DB/schema are already per-`(user,app)` and opaque.
- **Durable session history:** `POST /v1/sessions` ([src/routes/sessions.ts](src/routes/sessions.ts)) appends every completed session to the never-pruned `study_sessions` table — independent of the capped `store.sessions` the charts use, so no history is lost even past the cap. The study app fires it from `endSession` (signed-in only, fire-and-forget). A `GET` to list/aggregate is a future add (the data is already being captured).
- **TTS (storage-backed, Apple-voice-preferred, voice-tagged):** the three-tier resolver lives in `resolveTts(text, voice?)` ([src/services/tts.ts](src/services/tts.ts)), shared by `GET /v1/audio/tts?voice=` (new) and `GET /v1/tts` (legacy default-voice alias). Cheapest first: in-process map (keyed by voice+text) → our **storage layer** → `googleTts` (`tl=ja`, 200-char cap, persisted as `.mp3` on first hit so restarts skip it). A **tagged voice** (e.g. `siri:female`) prefers its own pre-generated `audio/<provider>/<gender>/<hash>.m4a`, then falls through to the default `tts/<hash>.m4a` → `.mp3` → Google. `GET /v1/audio/variants?text=` lists which tagged voices exist (the `audio_variants` manifest) + an always-available `google`. `Cache-Control: immutable`. The study app falls back to speechSynthesis only over `file://` or on failure.
- **Local TTS pre-generation (macOS) + Minna-audio prefetch (`scripts/`):** operator scripts feed the surfaces above, all run locally and seed our storage (point them at the prod `S3_*` env to seed prod):
  - `generate-tts.ts` — enumerates the text the study app voices (every built-in + Minna card reading via `ttsText`, every leveled/lesson example sentence via `plainText`), renders each clip, and uploads it to `ttsKey(text,'m4a')` (the default voice). Idempotent (skips clips already in storage). **`--variant <provider:gender>`** instead writes to the tagged `ttsVariantKey()` + records an `audio_variants` row, so the clip becomes a selectable voice in `/v1/audio/variants`. `--variant` only sets the output tag — `say` always uses the System Voice, so BOTH Siri genders = two passes flipping the System Voice between them (set it to a Siri MALE voice → `--variant siri:male`; flip to FEMALE → `--variant siri:female`). For prod, also point `DATABASE_FILE` at the prod sqlite so the manifest rows land where `/v1/audio/variants` reads them. Two renderers via `--engine`:
    - **`say` (default)** — macOS `say` with the **system voice**. This is the ONLY way to reach a **Siri voice** (the highest quality): set System Settings → Accessibility → Spoken Content → System Voice to a Japanese Siri voice, then bare `say` (no `-v`) uses it. AVSpeechSynthesizer's voice list does NOT expose Siri voices (confirmed: 182 voices, none Siri/premium), so this is the quality path. Depends on the current system voice (not reproducible across machines).
    - **`jp-tts`** — `jp-tts.swift`, a macOS Swift CLI (`AVSpeechSynthesizer` → AAC `.m4a` via `afconvert`) using a SPECIFIC installed voice (Kyoko/Otoya **Enhanced** is the accessible ceiling — no premium ja voices exist via this API). Deterministic + system-voice-independent. Build: `swiftc -O scripts/jp-tts.swift -o scripts/jp-tts` (binary gitignored); `--list` shows installed ja voices + quality.
  - `push-tts-variants.ts` — copies ALREADY-RENDERED tagged voice clips (`audio/<provider>/<gender>/<hash>.m4a`, default provider `siri`) from the local media dir straight to a target bucket **without re-running `say`** — the companion to `generate-tts.ts` for seeding/fixing prod without rendering twice. Since rendering a Siri voice needs a Mac with the right System Voice, but the bytes are identical everywhere, this just ships the local `.m4a`s you already made. Run on the Mac with `STORAGE_DRIVER=s3 S3_*` pointed at prod; `--dry-run` first, then `--force` to OVERWRITE (required to **re-voice** clips seeded with the wrong System Voice — without it, existing keys are skipped). It pushes BYTES only — the `audio_variants` manifest rows live in the env's sqlite (a Mac push can't reach the droplet's), so seeding the catalog is `seed-audio-variants.ts`'s job (next). Scoped to provider dirs + `.m4a` so it can never sweep up the IK voice-actor `.mp3` media that shares the `audio/` namespace.
  - `seed-audio-variants.ts` — the MANIFEST half of seeding a voice: writes the `audio_variants` rows that `GET /v1/audio/variants` reads (the study app's Settings voice picker). Without it the picker shows a voice as "not generated" even when its bytes ARE in the bucket — `buildSynthVariants` reads the manifest only, never storage. **Run on the droplet** (where `DATABASE_FILE` is the prod sqlite AND `S3_*` points at the bucket holding the clips), via the same `docker compose run -v /opt/wk-enhanced-api:/repo` pattern as `seed-sentences.ts` (see deploy/README.md). It needs nothing from your Mac: re-derives the exact text set via the shared `collectTtsTexts()` (the same enumeration `generate-tts.ts` renders from — kept in one place so renders + manifest can't drift) and records a row only when `storage.exists(ttsVariantKey(…))` confirms the clip is actually present. Self-correcting + idempotent (`insertAudioVariant` upsert). Flags: `--provider` (default `siri`), `--genders` (default `male,female`), `--limit`.
  - `prefetch-minna-audio.ts` — downloads every native-audio MP3 the curated lessons reference (vocab + conversation) into storage up front, mirroring the `/v1/minna/audio` route's caching, so we never lazy-round-trip to vnjpclub.
  - (`apply-furigana.ts` is a sibling content tool — validates + applies model-generated furigana ruby onto the lesson JSON sentence fields, enforcing that stripping the ruby reproduces the original byte-for-byte.)
  - `seed-sentences.ts` — seeds the built-in curator sentences into the **sentence store** as public rows: Pass 1 = 独り言 Self-Talk phrases (`data/selftalk.js` → `db.upsertPublicSentence`); Pass 2 = built-in vocab example sentences (`data/examples.js` → `db.seedExampleSentence`, linked to cards by rank+tier, identical text reused not duplicated). Both idempotent. The git-tracked bundles stay the curator authoring source; this is the seed→DB step. **Must run as a deploy step** (point `DATABASE_FILE` at the prod sqlite / run on the droplet, same pattern as `generate-tts.ts`) or the prod 独り言 tab AND the flashcard/Browse example sentences render empty.
  - `seed-annotations.ts` — the NLP-phase (Phase 4) seed: loads the committed `data/annotations.json` (produced OFFLINE by [../sentence-nlp/](../sentence-nlp/) `parse.py`, since the droplet has no Python) into `sentence_annotation` via `db.upsertAnnotation`. Resolves each annotation to its sentence by **content `hash`** (`getPublicSentenceByHash`) — environment-independent, so a Mac-parsed artifact seeds prod correctly — and the upsert re-asserts the UTF-16 offset contract, so a malformed artifact **aborts** the seed (and deploy) rather than landing bad offsets. Also writes the artifact's detected **grammar ids** to `sentence_tag(kind='grammar')` (via `db.setGrammarTags`) for `source='example'` rows. Idempotent. **Run as a deploy step AFTER `seed-sentences.ts`** (the sentence rows must exist first), same `DATABASE_FILE`/droplet pattern.
- **みんなの日本語 dashboard:** account-gated `/v1/minna/*` ([src/routes/minna.ts](src/routes/minna.ts)) serves curated Minna no Nihongo lessons (`data/minna/lesson-<n>.json`, git-tracked, built from the [scripts/scrape-minna.ts](scripts/scrape-minna.ts) extractor) + proxies/caches native vnjpclub audio ([src/services/minnaAudio.ts](src/services/minnaAudio.ts), strict `/Audio/…mp3` SSRF guard, stored via the storage layer's new `get()`). Gated by `currentUser` + the optional `MINNA_OWNER_EMAILS` allowlist so the copyrighted textbook material never reaches anonymous visitors. Per-lesson notes sync under the `minna` progress key; scraped vocab activates into the study deck as tagged custom cards (client-side). **Phase 2 (record-your-voice + compare to the cached native audio) is now landing:** `POST/GET/DELETE /v1/minna/recordings` store per-user voice takes as **private** storage objects (served only through the owner-scoped GET) in the `minna_recordings` table, pruned per item to the user's keep-N; `GET /v1/minna/practice` (`recordingSummary`) is a per-lesson practice-history aggregate over those rows. See [../study-app/MINNA.md](../study-app/MINNA.md) "Phase 2". Frontend contract: the みんなの日本語 dead-end in [web/CLAUDE.md](web/CLAUDE.md). **Full feature doc (both halves + roadmap): [web/MINNA.md](web/MINNA.md).**
- **Offline-first client:** the app still works with no account (localStorage). Signing in mirrors BOTH the progress store and the custom verbs to the server; on login the server copy wins per app key, and a brand-new account seeds the cloud from local. `save()`/`saveCustom()` → localStorage immediately + a debounced `PUT`.
- **Deploy:** for the apex `wkenhanced.dev` to reach this server, add a Cloudflare Tunnel ingress rule for it → `http://localhost:3000` (the `api.` subdomain already routes here). `COOKIE_SECURE=true` in prod. Full walkthrough in [deploy/README.md](deploy/README.md) "Serving the study app at wkenhanced.dev".
- **DEAD-END / gotcha:** `COOKIE_SECURE=true` over plain `http://localhost` makes the browser silently drop the session cookie — login appears to "not stick" with no error. Dev MUST use `COOKIE_SECURE=false`. This is the #1 thing to check if local login mysteriously fails.

## What's deliberately NOT in v1

- ~~No accounts, no auth (except the admin bearer token).~~ **Superseded** — accounts + cookie sessions now exist for the study app (above). The admin bearer token is still separate and unchanged.
- No password reset / email verification yet. There's no outbound email; a forgotten password currently means a new account. (First real follow-up if the app gets users — deliberately deferred since it needs an email provider + secrets, which aren't worth provisioning until there's demand.)
- ~~No rate limiting on `/v1/auth/*`.~~ **Superseded** — `/login` (20 per 15 min) and `/register` (8 per hour) are now throttled per-IP by an in-memory fixed-window limiter ([src/lib/rateLimit.ts](src/lib/rateLimit.ts)), returning `429 {code:'rate_limited'}` + `Retry-After`. State is process-local (resets on restart, not shared across instances) — fine for the single droplet; would need a shared store if we scale out. Login is still constant-time against email enumeration. Cloudflare's edge remains the first line.
- No keyed external services (DeepL, OpenAI, Forvo, jpdb). If we add them later, keys live on the client and we proxy without caching under keys the user can't reach.
- No analytics on what users review (only aggregate serve counts).
- No real-time / push features.
- No metrics endpoint beyond `/v1/health`. Structured JSON logs are the metrics surface.
- No tests for the route handlers themselves — pure-function coverage + manual curl is the contract. Route tests become valuable when the API shape stabilizes after the userscript migration.
