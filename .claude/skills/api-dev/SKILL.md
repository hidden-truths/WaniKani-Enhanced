---
name: api-dev
description: Develop on wk-enhanced-api, the Bun + Hono + SQLite server (wk-enhanced-api/) — add or change endpoints, Zod schemas, DB repos, warm-pipeline work, tests, and structured-log debugging. Use for ANY change under wk-enhanced-api/, whether vocab payloads, auth/login, progress sync, sentences, templates, songs, TTS/audio, or admin warm, and for investigating API behavior, server test failures, or server logs. Read it BEFORE writing server code; the route/repo/test pattern and traps here save hours.
---

# API server development (wk-enhanced-api)

You are changing the backing API server. It serves two very different clients — the Tampermonkey userscript (anonymous, cacheable vocab payloads) and the 日常日本語 study app (cookie-credentialed, cross-origin, per-user data) — from one Bun + Hono + SQLite codebase. This skill gives you the dev loop, the add-an-endpoint pattern, the test conventions, and the handful of constraints that have real war stories behind them.

## Before you start

- `wk-enhanced-api/CLAUDE.md` is the authoritative doc: full API-surface table, dev↔prod parity table, the complete dead-end list, and the full log-event tables. This skill is the distilled working procedure; when the two disagree, CLAUDE.md wins (and this skill should be fixed).
- All commands below run from `wk-enhanced-api/` unless noted.
- Know which client your change touches, because different rules apply:
  - **Userscript routes** (`/v1/vocab`, `/v1/index_meta`, `/v1/health`, `/v1/tts`, `/media/*`) — anonymous, blanket CORS `*`, edge-cacheable.
  - **Study-app routes** (`/v1/auth`, `/v1/progress`, `/v1/sessions`, `/v1/minna`, `/v1/audio`, `/v1/sentences`, `/v1/templates`, `/v1/songs`) — session-cookie credentialed, origin-allowlisted CORS (see step 8 below).
- Changing a payload the userscript consumes? Coordinate the client side via the `userscript-dev` skill. Changing something the study app calls? See `study-app-dev` for the client contract. Adding a new per-user synced data type? That's the `add-synced-blob` skill (it includes the server enum step).
- Anything that adds an env var, a seed step, or changes prod behavior needs the `deploy-prod` skill before it's really "done" — dev and prod deliberately differ (storage driver, cookie flags, origins).

## Dev loop

```bash
cd wk-enhanced-api
bun install               # one-time
cp .env.example .env      # one-time; dev defaults work as-is (ADMIN_TOKEN=dev-admin-token)
bun dev                   # hot reload via --watch, http://localhost:3000
bun test                  # in-memory DB, no network; 376 tests across 38 files in <1s as of 2026-07
bun run typecheck         # tsc --noEmit
```

- **`bun test` AND `bun run typecheck` must both pass before every commit.** They're fast; there is no excuse. (Commit discipline itself: see the `land-a-change` skill.)
- Dev needs **no Docker, no Postgres, no MinIO**: Bun has built-in SQLite (`bun:sqlite`) and S3 (`Bun.S3Client`). Dev runs `STORAGE_DRIVER=local` (SQLite + media files under `./dev-data/`); prod flips one env var to S3. Don't add a database or storage dependency.
- Working on study-app-facing routes? Run `./dev.sh` from the **repo root** instead — it starts the API (:3000) and the study app (:5173) wired cross-origin exactly like prod (sets `STUDY_APP_ORIGINS` and `VITE_API_BASE` for you).
- Docs UI: http://localhost:3000/docs (Scalar, with "Try it" buttons). It renders `/openapi.json`, which is **auto-generated from the Zod schemas**. Never hand-write OpenAPI — a hand-rolled `src/openapi.ts` existed once and was deleted precisely because it drifted.

## Add or change an endpoint (the core procedure)

A worked, end-to-end example with real code skeletons (schema + repo + route + both test tiers) is in [references/patterns.md](references/patterns.md) — read it the first time you do this.

1. **Schema first.** Add Zod request/response schemas to the right domain file under `src/schemas/` (`common` · `vocab` · `warm` · `accounts` · `progress` · `minna` · `audio` · `sentences` · `templates` · `songs`). Register each with `.openapi('Name')` so it lands in the spec. Never add schemas to the barrel `src/schemas.ts` — it only re-exports domain files (add a new domain file plus one export line there if none fits). Layering is one-way, no cycles: `common ← sentences`; `vocab ← warm`.
2. **Route.** Define `createRoute({ method, path, tags, summary, request, responses })` and wire it with `router.openapi(route, handler)` in the matching `src/routes/*.ts`. One file per route group; each exports an `OpenAPIHono` sub-router.
3. **`{ defaultHook: zodHook }` on every new sub-router.** `new OpenAPIHono({ defaultHook: zodHook })` — the hook is per-instance, NOT inherited from the root app. Forget it and validation failures return Zod's raw `{success, error}` instead of the documented `{code, error, detail}` contract. This is the single easiest mistake to make in this codebase.
4. **Mount new groups in `src/index.ts`**: `app.route('/v1/<group>', <group>Router)`. Adding to an existing group needs no index.ts change.
5. **SQL lives ONLY in `src/db/repos/*`.** Routes and services do `import * as db from '../db/client.ts'` (the barrel) and call repo functions — no inline SQL anywhere else. A new aggregate = new `src/db/repos/<name>.ts` + one export line in `src/db/client.ts`. This is why "swap to Postgres later" stays mechanical; don't break the seal.
6. **Error contract.** Every non-2xx body is `{ code, error, detail? }`. `code` is the stable enum clients switch on: `validation_error`, `unauthorized`, `not_found`, `conflict`, `rate_limited`, `upstream_failure`, `service_unavailable`, `internal_error`. Never make clients match on `error` (human text, may change). For cookie-gated routes use the shared helpers in `src/lib/httpErrors.ts` (`unauthorized(c, detail)`, `notFound(c, detail)`) so shape and status can't drift.
7. **Auth.** Cookie-gated handlers call `currentUser(c)` (from `src/lib/auth.ts`; the session cookie is `wk_session`) and return `unauthorized(...)` when null. Admin endpoints use `Authorization: Bearer <ADMIN_TOKEN>`. Per-IP rate limits already exist on `/v1/auth/*`. Don't invent a third auth model.
8. **CORS, the step everyone forgets.** If the study app calls your route with credentials (its `api()` helper ALWAYS sends `credentials: 'include'`, even for anon-readable GETs), the path must match the `STUDY_ROUTE` regex in `src/index.ts` — as of 2026-07: `/^\/v1\/(auth|progress|sessions|minna|audio|sentences|templates|songs)\b/` (grep `STUDY_ROUTE` for the live list). A new top-level credentialed group must be added to that alternation, because browsers reject wildcard-`*` CORS on credentialed requests — the symptom is the study app failing in the browser while curl works fine. Userscript-facing routes stay on the blanket-`*` branch; also set per-user responses to `Cache-Control: no-store`.
9. **Tests beside the source** as `*.test.ts` (conventions below; skeletons in [references/patterns.md](references/patterns.md)).
10. **Log context.** Enrich the per-request `http` log line from the handler via `c.set('logCtx', { ... })` — cache status, timings, counts — so one line tells the request's whole story.
11. **Docs.** `/openapi.json` + `/docs` update automatically on reload. But hand-maintained docs don't: a new endpoint gets a row in the API-surface table in `wk-enhanced-api/CLAUDE.md`; a new env var gets a row in its dev↔prod parity table.

## Test conventions

- **Pure functions always get tests** (URL builders, scoring, title decoding, pipeline helpers). Route/service tests can wait until a surface stabilizes — stabilized ones already have them.
- **DB/repo tests** use an isolated in-memory DB via the test seam in `src/db/connection.ts`: `openDb(':memory:')` + `_useDbForTesting(mem)` in `beforeEach`; `_useDbForTesting(null)` + `mem.close()` in `afterEach`. One `*.test.ts` per repo, beside it. `_useDbForTesting` is test-only — never call it from app code.
- **Route tests run in-process** — build an `OpenAPIHono({ defaultHook: zodHook })`, mount the router(s), and drive `app.fetch(new Request('http://test.local/...'))`. No port binding, no server. See `src/routes/integration.test.ts` for the canonical setup, including the sign-in idiom for cookie-gated routes (`db.createUser` + `db.createSession` + a `Cookie: wk_session=<token>` header).
- **External services (IK / DDG / Google TTS / Claude) are NEVER hit or fetch-mocked in the suite** — flaky, slow, rate-limited. Integration with real upstreams is verified by manual curl against a running server. Where a service needs testing anyway, inject the client via a factory seam — `_setAnalysisClientForTesting` in `src/services/songAnalyze.ts` is the pattern.
- **Some tests pin intentionally WRONG output.** Dead-end cases are locked to the known-bad answer with a comment explaining the real fix (e.g. `src/lib/ikTitles.test.ts` asserts `ikTitleToFolder('durarara__', null) === 'Durarara'` — the true title is "Durarara!!", and the fix is the `/index_meta` map, not a smarter heuristic). If a test seems to assert a bug, **read its comment before "fixing" it** — it's a landmine marker.

## Reading the logs (the debugging surface)

There is no metrics endpoint; structured JSON logs (one line per event, via `src/lib/log.ts`) ARE the observability. Start with these events:

| Event | What it tells you |
|---|---|
| `http` | Every request, post-hoc: method, path, status, ms, plus whatever the handler put in `logCtx`. |
| `vocab.serve` | Per `GET /v1/vocab/{word}`: word, `cacheStatus`, etag, examples, `warmMs?`. |
| `warm.word.done` | Per-word warm outcome: examples, `audio{ik,tts,none}`, `audioStorage{cache,fetched,failed,skipped}`, image stats. The operator dashboard for "what did this warm actually do." |
| `warm.ddg.background.done` | Deferred DDG image-pool fetch finished; the row's `incomplete` flag just cleared. |
| `warm.all.start/done/word_failed` | Bulk-warm progress; `word_failed` count is the "is the rate limit holding" signal. |

`cacheStatus` enum (on `vocab.serve` and the `http` line): `hit` · `not_modified` (304) · `cold_warm` (lazy-fill ran synchronously) · `empty` (warm OK, IK had nothing) · `nowarm_miss` (404 under `?nowarm=true`, normal for prefetch) · `error` (lazy warm threw → 502) · `batch`. Full tables: `wk-enhanced-api/CLAUDE.md` "Reading the logs". Symptom-first debugging across surfaces: the `troubleshoot` skill.

## The warm pipeline in five lines — and its two sacred constraints

Per word (`warm/pipeline.ts` `warmWord`): (1) IK `/search` (request 1000, cap payload at 50, prefer entries with voice-actor `sound`); (2) `scoreJlpt` each example — fail-open on unknown tokens, by design; (3) resolve title/category from the cached `/index_meta` map, regex heuristic only as fallback; (4) per example in 4-wide batches, fetch media through `services/mediaCache.ts` single-flight — IK audio with Google-TTS fallback, IK image with no fallback; (5) upsert the payload with `incomplete: true` and let a background DDG task fill `fallbackImages`, then clear the flag.

Two constraints are load-bearing; violating either has already caused a production incident:

- **The IK rate-limit floor stays ≥500ms** (`_ikFetchConfig.minGapMs` in `src/services/ik.ts`). The rc2 deploy tried 50ms and IK 429-locked the droplet's IP for ~30 minutes — every call, even unrelated one-off curls. 429-with-exponential-backoff now exists, but it does not make sustained high rates safe. Lowering this is a careful, staged operation (there's a recipe recorded in `ROADMAP.html`), never a casual flip.
- **`warmWord` must THROW on `ikSearch` failure, never swallow it.** The pre-fix version caught the error, upserted an empty payload with a fresh `fetched_at`, and the freshness check then skipped the word forever — that plus a 429 storm produced 6186/6186 empty rows on the first prod warm. A *successful* search returning `[]` is factual ("no examples") and IS upserted; only thrown exceptions skip the write. Keep the re-throw in the catch block.

Related: a cold lazy-fill blocks the HTTP response 10–30s, which is why `src/index.ts` exports `idleTimeout: 60` (Bun's 10s default reset those connections mid-warm). If you make the pipeline slower, raise it to match.

## Config discipline

- Every env var goes through `src/config.ts` — typed, defaulted or boot-validated there. No `process.env` reads anywhere else. Boot-time validation is deliberate: a misconfigured prod env should kill the service at startup, not hours later on the first warm.
- Adding an env var, external service, or on-disk path? Apply the test: **would forgetting the prod side cause a runtime failure?** If yes, add a row to the dev↔prod parity table in `wk-enhanced-api/CLAUDE.md`, and remember prod's env file is `/etc/wk-enhanced-api/env` on the droplet — a new required var IS a deploy step (`deploy-prod` skill).

## The sentence store has a privacy choke-point — respect it

Every sentence read goes through `db.getSentences({ownerType, ownerId?, viewer})`, which always ANDs the `VIEWER_VISIBLE` predicate — `(s.public = 1 OR s.created_by = ?)` in `src/db/repos/sentenceCore.ts` — and fails closed (null viewer → public rows only). Templates, annotations, and songs reuse or mirror the exact same gate. **Pinned breach-prevention tests** in `src/db/repos/sentences.test.ts`, `annotations.test.ts`, and `templates.test.ts` must stay green; they exist because private user sentences and copyright-gated Minna rows share tables with public content. Before touching the sentences/templates/annotations/songs repos, read the sentence-store section of `wk-enhanced-api/CLAUDE.md` — it also covers the UTF-16 offset contract and why `source='minna'` rows are deliberately dark. Do not write a query against `sentence` that bypasses the gate.

## Verify

```bash
# 1. The suite + types (both must be green):
bun test                  # expect: "N pass / 0 fail ... Ran N tests across M files"
bun run typecheck         # expect: no output, exit 0

# 2. Live smoke test against your dev server:
bun dev                   # terminal 1
curl http://localhost:3000/v1/health
curl -X POST http://localhost:3000/v1/admin/warm \
  -H "Authorization: Bearer dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"scope":"word","word":"食べる"}'    # cold warm hits live IK: ~15-30s
curl http://localhost:3000/v1/vocab/食べる  # then <10ms
```

- New/changed endpoint: confirm it appears in http://localhost:3000/docs and exercise it with "Try it" or curl.
- Error contract: send an invalid body and confirm the 400 is `{ "code": "validation_error", "error": "invalid request", "detail": "..." }` — if you get a raw Zod shape instead, you forgot `defaultHook` (step 3).
- Study-app-facing change: run `./dev.sh` and exercise it from the app at :5173 — this is the only way to catch a missing `STUDY_ROUTE` entry, because curl has no CORS.
- Prod liveness (read-only, safe anytime): `curl https://api.wkenhanced.dev/v1/health` → `{"status":"ok",...}`.

## Traps

Each has a full write-up in `wk-enhanced-api/CLAUDE.md` "Things that look like bugs but aren't" — one line here so you recognize them:

- **Missing `defaultHook` on a new sub-router** → validation errors break the `{code,error,detail}` contract silently (step 3).
- **New credentialed route group not in `STUDY_ROUTE`** → works in curl, browser-rejected from the study app (step 8).
- **`COOKIE_SECURE` must be `false` in dev** — `true` over `http://localhost` makes the browser silently drop the session cookie; login "doesn't stick" with no error. The #1 local-login failure.
- **Response headers are invisible cross-origin by default** — the userscript can read `ETag` only because the `*`-branch CORS middleware sends `Access-Control-Expose-Headers: ETag`; append any new JS-readable header to that list.
- **Cloudflare weakens ETags (`W/"..."`) on compressed responses** — If-None-Match comparison must stay weak-prefix-tolerant (`normalizeEtag` in `src/lib/etag.ts`, used by the vocab route); don't "simplify" to strict equality or prod 304s vanish while local curl still works.
- **SQLite in prod is deliberate** — bounded corpus, single droplet, repos hide all SQL. Don't add Postgres "to be safe."
- **Don't "fix" fail-open JLPT scoring or the title heuristic** — both are pinned dead-ends with intentionally-wrong test assertions pointing at the real answers.
- **Storage keys are NOT pre-encoded** — the storage layer owns URL encoding; encoding in `keys.*` helpers causes double-encoding (a fixed v0.x wart).
- **`sentence_annotation` offsets are UTF-16 code units, not codepoints** — a naive parser passes every kana test and corrupts rare-kanji tap targets. The non-BMP test in `src/db/repos/annotations.test.ts` guards this.

## Ground truth (as of 2026-07)

This skill compresses, and defers to:

- `wk-enhanced-api/CLAUDE.md` — architecture tree, full API-surface table, dev↔prod parity table, warm pipeline, complete dead-end list, log tables, test conventions. **Re-verify against it when updating this skill.**
- `wk-enhanced-api/src/index.ts` — CORS branches + `STUDY_ROUTE`, log middleware, `idleTimeout`.
- `wk-enhanced-api/src/config.ts` — the env surface.
- `wk-enhanced-api/src/db/connection.ts` — `openDb` / `getDb` / `_useDbForTesting`, pragmas, guarded migrations.
- Living small examples: `src/routes/sessions.ts` + `src/routes/progress.ts` (routes), `src/db/repos/studySessions.ts` (+ its test), `src/routes/integration.test.ts` (route-test harness), `src/schemas/progress.ts` (schema style).
- Live numbers beat this doc: `bun test` for the suite size (376/38 files as of 2026-07); `grep STUDY_ROUTE src/index.ts` for the credentialed route list; the enum in `src/routes/progress.ts` for the progress app keys (8 as of 2026-07).
- Prod state: `curl https://api.wkenhanced.dev/v1/health` (verified live 2026-07: `status:ok`, ~6.7k warmed words).
