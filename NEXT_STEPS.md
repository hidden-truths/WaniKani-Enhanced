# NEXT_STEPS.md

Living document for the WKEnhanced project. Use this as the entry point for any new working session — it points at the doc-of-record for each ongoing thread and lists the concrete next actions in priority order.

Owns the *what-to-do-next* state of the project. Architecture, design rationale, and dead-end warnings live in [CLAUDE.md](CLAUDE.md), [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md), [SERVER_DESIGN.md](SERVER_DESIGN.md), and [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md). The feature backlog (everything that isn't time-critical) is in [NEW_FEATURES.md](NEW_FEATURES.md).

**Last updated**: 2026-05-25, late evening — Phase 3 shipped (rename + slim main userscript to server-only + legacy/ snapshot) and smoke-tested in the browser. Seven follow-up server-side commits landed in the same session (see "Shipped this session" below — the last is the Dockerize artifacts). Dockerize is code-complete; the production cut-over is the next maintainer action. Nothing public has been announced yet.

---

## Current state of the world

- **Userscript**: [wkenhanced.user.js](wkenhanced.user.js) **v2.0.0**. Server-only — every vocab lookup goes through `https://api.wkenhanced.dev`. The IK / DDG / Google TTS direct path is gone from this file; the v1.1.1 snapshot lives at [legacy/wk-vocab-review-ik-direct.user.js](legacy/wk-vocab-review-ik-direct.user.js) as a frozen fallback for "API server is down for an extended period." Source tree only — no build pipeline. **Manually verified working** by the maintainer pasting into Tampermonkey post-ship; cards render, audio plays, picker + refresh + image cycle all behave correctly.
- **Server**: [wk-enhanced-api/](wk-enhanced-api/) in production at `https://api.wkenhanced.dev` (DO droplet in SFO3, Spaces bucket, Cloudflare Tunnel). Renamed in source from `wk-vocab-api/` on 2026-05-25 to match the deployment. Nine cumulative deploy-period fixes are in the codebase (five on initial deploy day, four on Phase 2 smoke-test day — see [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md) Phase 2 section + DEAD-END WARNINGS in [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md)).
- **Bulk warm coverage (post-Phase-2-flip)**: ~4859 / ~6500 words populated (~75%). 552 of those are legitimately empty (obscure WK vocab IK doesn't index). ~1641 words have no row at all — the warm's IK calls 429ed without retry. **Code fix landed this session** (429-with-exponential-backoff in `services/ik.ts`); the actual re-warm to populate those rows hasn't been triggered yet (see runway item below). Until it runs, missing words still cold-fill organically on first request (~15-30s per word, idleTimeout fix keeps the connection alive).

---

## Active project: Dockerize the server — code-complete, deploy pending

Code-side work landed in the same session. New artifacts:
- [`wk-enhanced-api/Dockerfile`](wk-enhanced-api/Dockerfile) — multi-stage build off `oven/bun:1.3.8` (pinned to match dev), `deps` stage installs `--frozen-lockfile --production`, `runtime` stage assembles a minimal image (production node_modules + src/ + data/ + `deploy/{backup,retention}.ts`). Runs as the official `bun` user (uid 1000). HEALTHCHECK uses `bun --eval` against `/v1/health` so the image needs no curl dep.
- [`wk-enhanced-api/compose.yaml`](wk-enhanced-api/compose.yaml) — single `api` service, binds `127.0.0.1:3000` (Cloudflare Tunnel reaches it the same way), mounts `/var/lib/wk-enhanced-api` with the same path inside and outside (so the env file's `DATABASE_FILE` works unchanged across pre- and post-Docker droplets), loads env via `env_file: /etc/wk-enhanced-api/env`, caps log rotation at 30MB.
- [`wk-enhanced-api/.dockerignore`](wk-enhanced-api/.dockerignore) — excludes node_modules / dev-data / test files / systemd templates / `.env`.
- Rewritten systemd units in [`wk-enhanced-api/deploy/`](wk-enhanced-api/deploy/): `wk-enhanced-api.service` is now a `Type=oneshot` wrapper that runs `docker compose up -d --remove-orphans` on boot and `docker compose down` on stop; `wk-enhanced-api-backup.service` calls `docker exec wk-enhanced-api bun run /app/deploy/backup.ts`; `wk-enhanced-api-warm.service` is unchanged (curl from the host to 127.0.0.1:3000 reaches the container the same way it reached the bare-metal process).
- [`wk-enhanced-api/deploy/README.md`](wk-enhanced-api/deploy/README.md) rewritten end-to-end — fresh-install walkthrough (Docker install → chown /var/lib to 1000:1000 → systemd units → first build takes a couple of minutes) and a "Migrating from a pre-Docker droplet" section with the one-shot conversion recipe. [`wk-enhanced-api/CLAUDE.md`](wk-enhanced-api/CLAUDE.md) Dev↔prod parity table gained Docker rows; the obsolete "Bun must live outside `/root`" dead-end is annotated as superseded (kept for archeology).

**What's NOT done yet:** the actual deployment. The maintainer needs to (a) review the artifacts, (b) follow the migration recipe in deploy/README.md against the live droplet, (c) verify `curl https://api.wkenhanced.dev/v1/health` still works post-cut-over. Local Docker wasn't available in the working environment so the build itself hasn't been smoke-tested — verification will happen on the droplet (or any Docker-having machine via `docker compose up --build`). The Dockerfile's HEALTHCHECK command WAS verified end-to-end against a live `bun dev` server: the same `bun --eval` fetch returned exit 0 on success and exit 1 on the failure path.

**Public announcement (forum post) stays deferred** until this deploy lands and the Cloudflare rules item below is done.

---

## Next session's runway (priority order, after Dockerize)

Phase 3 is shipped end-to-end; nothing on the critical path is gated. This list is a menu, not a checklist — pick what matches the time you have.

### 1. Cloudflare rate-limit + cache rules (~10 min UI work)

Still pending from the post-deploy runway. In the Cloudflare dashboard:
- **Rules → Rate-limiting rules → Create rule**: 100 req/min per IP across `/v1/*` paths. (Free tier allows 1 rule, which is exactly this.)
- **Rules → Cache rules → Create rule**: on `/v1/vocab/*` paths, "Respect origin Cache-Control headers." Our server already sets long-cache headers on the payload + `Cache-Control: no-store` on `/v1/health`. **Verify** by hitting the same word twice in quick succession — second hit should show `cf-cache-status: HIT`. As of 2026-05-25 it shows `DYNAMIC`, meaning Cloudflare isn't caching at all; the userscript's `cache: 'no-cache'` + the server's weak-ETag-tolerant `If-None-Match` comparison together ensure correctness even with a CDN cache between us.

### 2. Re-warm the 1641 missing words at the current 500ms rate (~30 min + waiting)

Not user-visible — cold-fill handles missing words organically since the idleTimeout fix. But useful before any traffic spike (avoids users on dial-up paying for 30s warms that we could have done in advance). The 429-with-exponential-backoff in `services/ik.ts` shipped this session, so the "proper" path is unblocked: keep `MIN_GAP_MS=500`, run `POST /v1/admin/warm {"scope":"all","force":false}`, watch `journalctl -fu wk-enhanced-api` for `ik.fetch.429_backoff` log lines (proves backoff is engaging when needed). The `force:false` flag means only words missing from `vocab_examples` get re-warmed — fresh rows are skipped. The `warm-all` endpoint now refuses a second concurrent run with 409 (shipped `dc2629c`), so an accidental double-trigger is safe.

### 3. Forum-post announcement — **deferred until we go public**

Not posted yet; the maintainer is keeping the project quiet until the Dockerize work + Cloudflare rules are in place. When the announcement is wanted, the v2.0.0 / WKEnhanced rebrand is the cover story (rename, server-only switch, faster cold loads, IK title-decoding fix, legacy fallback). Rough cover points:
- What changed: v1.x → v2.0.0, rename to WKEnhanced, all data flows through `api.wkenhanced.dev`.
- Why: no third-party CORS/sandbox friction, faster cold loads, server owns the title-decoding lossy-encoding workaround.
- Install: paste [wkenhanced.user.js](wkenhanced.user.js) — bumps `@version`, Tampermonkey re-prompts for `@connect api.wkenhanced.dev`.
- For users who don't want a server dependency: install [legacy/wk-vocab-review-ik-direct.user.js](legacy/wk-vocab-review-ik-direct.user.js) instead. Different `@name` so they can coexist.

---

## Shipped this session (2026-05-25, server-side follow-ups)

In order:

1. **`983dcb7` — 429-with-exponential-backoff in `services/ik.ts:fetchJson`.** Retries 429s with base-1s × 2^attempt backoff (cap 30s, 3 retries), honors `Retry-After` (seconds or HTTP-date), 5xx deliberately not retried. Test-only `_ikFetchConfig` knob lets the suite shrink wait times. 76 → 90 tests.
2. **`c882dae` — daily SQLite backup → DO Spaces, with GFS retention.** `deploy/backup.ts` does `VACUUM INTO` (readonly source DB → PrivateTmp snapshot) then uploads to `s3://<bucket>/backups/YYYY-MM-DD.sqlite` (private) then prunes per `deploy/retention.ts`. Default policy: 7 daily + 4 weekly + 12 monthly (tunable via `BACKUP_RETAIN_*`). Scheduled `*-*-* 03:00:00 UTC` via `wk-enhanced-api-backup.timer`. **Install steps in [deploy/README.md](wk-enhanced-api/deploy/README.md) — not yet deployed.** No new host-package deps (Bun's `bun:sqlite` provides `VACUUM INTO`, `Bun.S3Client` handles put/list/delete). 90 → 105 tests.
3. **`942175c` — extended 429-backoff to `ikDownloadMedia`.** Most IK traffic in a bulk warm is `/download_media`, so this is where the retry budget pays off most. Extracted a shared `fetchWithRetry` helper; `fetchJson` is now a thin wrapper that throws on `!ok`, `ikDownloadMedia` keeps its result-object shape (and correctly skips retry on small-body proxy-misses, which are structural failures, not transient). 105 → 109 tests.
4. **`7e713b3` — ETag + conditional GET on `/v1/index_meta`.** Same pattern as `/v1/vocab/{word}` (strong ETag from `fetchedAt`, weak-prefix tolerance for Cloudflare-downgraded validators, 304 path mirrors 200's `Cache-Control` + `ETag`). Helper pair moved out of `routes/vocab.ts` into shared `src/lib/etag.ts`; unit tests followed. 109 → 113 tests.
5. **`0da5169` — ADR-001 records the no-Kubernetes deploy-shape decision.** Captures the cost analysis ($24/mo DOKS minimum vs $11/mo current all-in), workload-shape mismatch (one service, bounded traffic, stateful filesystem), and operational complexity. Linked from `wk-enhanced-api/CLAUDE.md` next to the SQLite-not-Postgres dead-end. Includes a "when to revisit this" section.
6. **`dc2629c` — `POST /v1/admin/warm {"scope":"all"}` refuses overlap with 409.** Module-scoped `warmAllInFlight` flag prevents the monthly timer + a manual re-warm (or any two concurrent triggers) from doubling IK call volume and racing over `vocab_examples` rows. New `conflict` error code in the enum. Test-only `_setWarmAllInFlightForTesting` setter mirrors the `_useDbForTesting` pattern. 113 → 115 tests.
7. **Dockerize the server (commit follows this doc).** Dockerfile (multi-stage off `oven/bun:1.3.8`), compose.yaml (single service, 127.0.0.1:3000 bind, /var/lib bind-mount, env_file), .dockerignore, and rewritten systemd units. deploy/README.md gets a fresh-install walkthrough + a pre-Docker droplet migration recipe. Build itself not smoke-tested (no local Docker); HEALTHCHECK command validated end-to-end against `bun dev`. The actual prod cut-over is the maintainer's next step.

All commits are local; branch is ahead of `origin/main` (the session's earlier push brought up `983dcb7`; the rest still need to be pushed). `bun run typecheck` clean throughout, `bun test` ends at **115 pass / 0 fail**.

---

## Phase 3 wrap-up notes (shipped 2026-05-25)

These were decisions made when pulling Phase 3 forward; recorded here for future reference:

- **Direct path preserved, not deleted.** Per the maintainer's pivot, `legacy/wk-vocab-review-ik-direct.user.js` is a frozen snapshot of v1.1.1 with `serverPathEnabled()` hardcoded to `false`. No `@updateURL` — it never auto-updates. Different `@name` so it can coexist with the main script in Tampermonkey.
- **`useApiServer` setting removed entirely.** The setting becomes a no-op in v2.0.0; any stored value is silently ignored. Users who had it explicitly toggled off get the API path now (the legacy/ snapshot is the escape hatch for hard offline).
- **Old `wk-ik-examples.*` and `wk-vocab-cache.*` cache prefixes orphan in IndexedDB.** No automatic wipe on first v2.0.0 boot — the Clear cache button in settings cleans them up on user demand. Acceptable disk leak (~5–10MB per heavy user) for simpler upgrade-path code.
- **CSS class prefix kept at `wk-ik`.** ~140 hardcoded references in `injectStyles`; rename was zero user benefit (CSS classes are implementation detail). Documented in [CLAUDE.md](CLAUDE.md).
- **Settings: `apiServerUrl` and `prefetchCount` remain in the dialog.** Both are genuinely useful tuning knobs; only `useApiServer` was actively misleading post-Phase-3.

---

## Troubleshooting: warm completion / cold-fill failures

Reference for the monthly cron warm (or any ad-hoc re-warm). The most likely culprits + fixes:

**`empty` ratio > 30%**: re-check that the IK rate-limit didn't kick back in. `journalctl -u wk-enhanced-api --no-pager --since "12 hours ago" | grep -c 'warm.ik_search_failed'` — if this is > 100, we hit another 429 wave. Force re-warm the empty words: write a quick `sqlite3 ... 'SELECT word FROM vocab_examples WHERE example_count = 0;'` loop calling `POST /v1/admin/warm {"scope":"word","word":"X","force":true}` with a 1-second sleep.

**Common words like 食べる have `example_count = 0`**: this is the warm-pipeline-empty bug we thought we fixed. Reproduce locally with `curl -s 'https://apiv2.immersionkit.com/search?q=食べる&exactMatch=true&limit=10' | head -c 200`; if IK has real data and our server stored empty, look at `journalctl -u wk-enhanced-api | grep -F '食べる'` for the warm event sequence.

**`debugWkEnhancedApi('food')` returns CORS error**: re-verify the CORS middleware in `src/index.ts` is allowing `wanikani.com`. The header should be `Access-Control-Allow-Origin: *` on every response. Check with `curl -i https://api.wkenhanced.dev/v1/health -H "Origin: https://www.wanikani.com" | grep -i 'access-control'`.

**`debugWkEnhancedApi` returns 502**: the server crashed or cloudflared lost the upstream. `systemctl status wk-enhanced-api` to check; `journalctl -u wk-enhanced-api --no-pager -n 50` for crash traces; `systemctl restart wk-enhanced-api` to bring it back.

---

## What's NOT in scope without a separate conversation

- Adding accounts / user data of any kind
- Keyed external services (DeepL, OpenAI, Forvo, jpdb) — see SERVER_DESIGN.md "Non-goals"
- Migrating from SQLite to Postgres (the SQLite story is deliberate; see wk-enhanced-api/CLAUDE.md DEAD-END WARNINGS)
- Migrating to DOKS or any Kubernetes setup (see "DOKS / Kubernetes — explicitly rejected" in NEW_FEATURES.md)
- Per-user analytics / telemetry
