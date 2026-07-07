# Troubleshoot: API server (wk-enhanced-api)

The API is Bun + Hono + SQLite. Its debugging surface is **structured JSON logs — one event per
line**. Local: the `bun dev` terminal. Prod: `docker compose logs -f api` on the droplet (NOT
`journalctl`, which shows only unit start/stop — see `references/prod.md`). Every request emits an
`http` line post-hoc; route handlers enrich it via `c.set('logCtx', {...})`. The error contract on
every non-2xx is `{ code, error, detail? }` — switch on the stable `code`, never the human `error`.

## Reading the logs — event table

| Event | Key fields | When |
|---|---|---|
| `http` | method, path, status, ms, +logCtx | every request |
| `vocab.serve` | word, cacheStatus, etag, examples, ageMs, warmMs? | per `GET /v1/vocab/{word}` |
| `vocab.batch` | requested, deduped, found, missing, ms | per `POST /v1/vocab/batch` |
| `vocab.cold_miss` | word | cold-word lazy-warm trigger |
| `vocab.lazy_warm_failed` | word, warmMs, err | lazy warm threw |
| `warm.word.start` / `warm.word.done` | word, examples, audio{ik,tts,none}, audioStorage{cache,fetched,failed}, image{ik_present,ik_missing}, ddg{deferred}, ms | per-word warm; `*.done` = "what did this warm do" |
| `warm.ddg.background.done` | word, urls, fetched, failed, fallbackImages | background DDG finished, re-upserted (`incomplete:false`) |
| `warm.all.start` / `warm.all.done` / `warm.all.word_failed` | count, processed, failed, jobId | bulk warm |

## `cacheStatus` enum (on `vocab.serve` + the http line)

| Status | Meaning |
|---|---|
| `hit` | DB row served directly, no upstream calls, sub-10ms |
| `not_modified` | client `If-None-Match` matched → 304 (cheaper than `hit`) |
| `cold_warm` | row missing → ran `warmWord` synchronously then served; `warmMs` = how long (10–30s cold) |
| `empty` | warm succeeded but IK had no examples → empty payload at **200** (client renders a "no example" card, NOT 404) |
| `nowarm_miss` | client sent `?nowarm=true` and row missing → 404 without warming (expected for prefetch) |
| `error` | lazy warm threw → **502** |
| `batch` | `POST /v1/vocab/batch` (serves cached only, never warms) |

A card renders "no example" and it's genuinely correct → look for `cacheStatus: empty`. A card is
broken with a 502 → `cacheStatus: error` + a `vocab.lazy_warm_failed` line with the `err`.

## 502 on a cold word / lazy warm threw

`GET /v1/vocab/{word}` on a cold word runs `warmWord()` synchronously. If it throws you get a
`vocab.lazy_warm_failed` line and a 502 (`cacheStatus: error`). Common causes, in order: IK
unreachable or rate-limited (see warm failures below), or an unexpected upstream shape. **By
design, the warm pipeline THROWS on `ikSearch` failure rather than upserting an empty payload** —
so the next warm retries instead of caching a false "fresh, 0 examples" row indefinitely. Do not
"fix" that back to a silent catch (it caused 6186 empty rows on the first prod warm). A successful
IK search that genuinely returns `[]` is upserted as a 0-example payload — that's factual, not a
failure. Re-warm one word with `force:true` (see the admin-warm curl in `references/userscript.md`).

## `curl` cold-fill returns `http=000` (no HTTP status)

Bun's default `serve()` `idleTimeout` is 10s, but a cold `warmWord` runs 10–30s writing no bytes,
so Bun would reset the connection as idle and the client sees `http=000`. The fix already ships:
`idleTimeout: 60` on the export in `wk-enhanced-api/src/index.ts` (under Cloudflare's 100s
free-tier edge timeout). **If you add a slow step to the warm pipeline or raise `WARM_REFRESH_DAYS`
so per-word latency can exceed 60s, raise `idleTimeout` to match** — otherwise cold-fills silently
drop again. Don't chase this in the client; it's a server socket-timeout.

## Warm produces empty/broken media for a word

Read the per-word log, then distinguish:

- **`warm.ik_search_failed`** → IK reachability (network / rate limit). Not per-file; the whole
  search failed.
- **`warm.ik_audio_miss`** → a specific media file is missing on IK. Normal for text-only
  literature sources; the pipeline falls back to Google TTS for audio (image misses just leave
  `imageUrl:null` and clients use the DDG pool).
- **IK examples return but ALL media miss** → suspect the **title-encoding** problem. IK's `title`
  field is lossy; the fix is the cached `/index_meta` map, never a smarter heuristic (the
  `ikTitles.ts` heuristic is fallback-only and provably wrong for cases like `durarara__`). Refresh
  the map: `POST /v1/admin/warm {"scope":"index_meta"}` (bearer). Do NOT try the offline linode
  bucket (`us-southeast-1.linodeobjects.com/...`, dead since Aug 2025) — the working path is the
  `apiv2.immersionkit.com/download_media` proxy.

**IK rate-limit floor is ≥500ms and MUST NOT be lowered casually.** A 50ms drop once triggered a
global 429 lockout across the droplet for ~30 min. 429-with-exponential-backoff is now in
`services/ik.ts`, but a sustained high rate can still trip a per-IP soft ban. The
`warm.all.word_failed` count is the operational signal for "is the rate limit holding" — near-zero
on a polite warm. If IK 429s under load, investigate `MIN_GAP_MS` carefully, not more concurrency.

## Browser never gets a 304 (but `curl` 304s fine)

Two cross-origin/edge traps, both already fixed — verify they're intact if 304s regress:

1. **`Access-Control-Expose-Headers: ETag` must be on every response.** ETag isn't
   CORS-safelisted, so without it a cross-origin `fetch()`'s `res.headers.get('ETag')` returns
   `null` even though the header is on the wire — the client then can't send `If-None-Match` and
   re-downloads the full payload every time. Set in the CORS middleware in `src/index.ts`.
2. **Cloudflare downgrades strong ETags to weak (`W/"..."`) on compressed responses.** A naive
   strict-equality `If-None-Match` check misses every Cloudflare-mediated revalidation. The
   `normalizeEtag` helper in `src/routes/vocab.ts` strips a leading `W/` before comparing. Don't
   try to suppress Cloudflare's weakening upstream (it's tied to compression). This is exactly why
   a same-origin `curl` 304s but the browser-via-Cloudflare didn't.

## 429 `rate_limited` on login / register

The auth endpoints have a per-IP in-memory fixed-window limiter (`src/lib/rateLimit.ts`):
`/v1/auth/login` = 20 per 15 min, `/v1/auth/register` = 8 per hour, returning
`429 {code:'rate_limited'}` + `Retry-After`. State is process-local and resets on restart. If a
legit user is throttled during testing, wait out `Retry-After` or restart the dev server; don't
raise the limits to work around a test loop. (`conflict`/409 is separate — it's a warmAll already
in flight, or a sentence/song ext_id owned by another account.)

## Local smoke-test

```bash
bun dev
# in another terminal:
curl http://localhost:3000/v1/health
curl -X POST http://localhost:3000/v1/admin/warm \
  -H "Authorization: Bearer dev-admin-token" -H "Content-Type: application/json" \
  -d '{"scope":"word","word":"食べる"}'
curl http://localhost:3000/v1/vocab/食べる         # cold warm ~15–30s; subsequent reads <10ms
```

`/docs` (Scalar UI) at `http://localhost:3000/docs` lists every endpoint with "Try it" buttons.
For code changes use the `api-dev` skill.

## Ground truth (as of 2026-07)

Tables + traps lifted verbatim from `wk-enhanced-api/CLAUDE.md` "Reading the logs", the
`cacheStatus` enum, the diagnostic playbook, and the DEAD-END WARNINGS (idleTimeout commit 9be345c;
Expose-Headers bf3e153; weak-ETag `normalizeEtag` 7539a26; rate-limit floor / 50ms lockout; warm
must throw, e7f8224). Prod `/v1/health` reported ~6.7k warmed words at authoring time. Prod
incident response (restart / tunnel / seeds): `references/prod.md`.
