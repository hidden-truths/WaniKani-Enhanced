# NEXT_STEPS.md

Living document for the WKEnhanced project. Use this as the entry point for any new working session — it points at the doc-of-record for each ongoing thread and lists the concrete next actions in priority order.

Owns the *what-to-do-next* state of the project. Architecture, design rationale, and dead-end warnings live in [CLAUDE.md](CLAUDE.md), [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md), [SERVER_DESIGN.md](SERVER_DESIGN.md), and [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md). The feature backlog (everything that isn't time-critical) is in [NEW_FEATURES.md](NEW_FEATURES.md).

**Last updated**: 2026-06-14 — sentence-store work is the active thread and several pieces just landed on `main`: **Self-Talk slot-swap TEMPLATES Slices 1 + 2** (generator structure in the `sentence_template` table served by `GET /v1/templates`; combos lazily materialized as `sentence` rows via `POST /v1/templates/{id}/realize`), **Phase 2.5** (custom-card examples → private store rows), **custom-card completeness** (UI-authored pitch `accent` + leveled `levels`), and **Self-Talk TTS pre-gen** (phrases + every template combo). **Sentence-store Phase 4 (NLP enrichment) is also merged** (offline GiNZA parser → `?annotate=1` serving + the study-app tap-a-word lookup + Browse grammar filter). **The ⭐ next rework is tokenization granularity** — GiNZA morphemes fragment する-verbs + conjugations, so a tapped span doesn't match a word (§1). **Deploy residual:** the new seed steps (`seed-sentences.ts` Pass 3 + `seed-annotations.ts`) haven't run on the droplet, so prod doesn't yet serve templates/annotations (§1 / "Deploy"). The site is private — no public-launch work on the runway.

---

## Current state of the world

Three surfaces now, not two. The userscript + API are stable; most active development is in the **study app**.

- **Userscript**: [wkenhanced.user.js](wkenhanced.user.js) **v2.0.0**. Server-only — every vocab lookup goes through `https://api.wkenhanced.dev`. The IK / DDG / Google TTS direct path is gone; a v1.1.1 snapshot was kept at `legacy/` as a frozen "API down" fallback but was **removed in the 2026-06 cleanup** (recoverable from git history). Source tree only — no build pipeline. Manually verified working in Tampermonkey.
- **Server**: [wk-enhanced-api/](wk-enhanced-api/) in production at `https://api.wkenhanced.dev` (DO droplet in SFO3, Spaces bucket, Cloudflare Tunnel). **Dockerized** — single Compose service via `wk-enhanced-api.service`; backup via `docker exec`. Two systemd timers: monthly bulk warm + daily backup (03:00 UTC). It now ALSO backs the study app: accounts (cookie sessions), per-user progress/settings/custom-cards/minna sync, the durable `study_sessions` log, the みんなの日本語 routes, the unified `/v1/audio/*` surface (tagged voice variants + manifest), and the **unified sentence store** (Self-Talk + built-in examples). Deploy-day fixes: [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) DEAD-END WARNINGS.
- **Study app**: [study-app/](study-app/) — its OWN Vite project + nginx container at the apex `https://wkenhanced.dev`, cross-origin to `api.`. The big stuff has shipped: the two-container split, the `app.js` → `features/*` module refactor, accounts + sync, SRS-vs-free study, the みんなの日本語 dashboard (incl. Phase 2 record-and-compare), 独り言 Self-Talk, the **audio-unify epic (Phases 1–3 + follow-ups ①–⑦, complete)**, and the sentence store (Self-Talk + examples + custom-card Phase 2.5 + slot-swap templates + Phase 4 NLP enrichment). Its own priority list: [study-app/NEXT_STEPS.md](study-app/NEXT_STEPS.md).
- **Bulk warm coverage**: ~6717 / ~6717 rows populated (real data + legitimately-IK-empty). DB ~115 MB.
- **SQLite backups**: daily 03:00 UTC → `s3://…/backups/YYYY-MM-DD.sqlite` (private), GFS retention via [`deploy/retention.ts`](wk-enhanced-api/deploy/retention.ts). Covers all the user-data tables (accounts/progress/sessions/sentences) — load-bearing now, not just convenience.

---

## Next session's runway (priority order)

This list is a menu, not a checklist — pick what matches the time you have. Nothing is on a critical path; everything shipped so far is healthy in prod. App-specific feature work has its own priority list in [study-app/NEXT_STEPS.md](study-app/NEXT_STEPS.md); this section owns the cross-cutting / userscript-server / ops items.

> **The project is private.** The study app + userscript are not published or announced anywhere, so there is no public-launch / announcement work — the runway is feature + infra polish only.

### 1. Sentence-store NLP — Phase 4 MERGED to `main`; the ⭐ next rework is tokenization granularity

**Phase 4 (NLP enrichment) is merged to `main`** (commits 1–3: offline GiNZA parser + `sentence_annotation` load path, N5/N4 grammar-tag catalog, then commit 3 = `?annotate=1` serving + the study-app **tap-a-word lookup** (lemma/POS → card-or-Jisho) + the Browse **grammar filter**). Tests + build green; browser-verified. **Prod deploy is the residual** — a both-container rebuild + **`seed-annotations.ts` run on prod after `seed-sentences.ts`** (skip it and the tap UI silently shows plain ruby in prod). Plans: **[SENTENCE_STORE_PHASE4.md](SENTENCE_STORE_PHASE4.md)** (as-built + the §8.0 rework) + [SENTENCE_STORE_NLP.md](SENTENCE_STORE_NLP.md).

> **⭐ The active next rework — tokenization granularity.** The tap units are GiNZA's raw morphemes (split mode C), which fragment する-verbs (勉強 + する) and conjugations (食べ+させ+られ+た), so a tapped span doesn't match "a word." The fix is a post-tokenization **merge pass** in `sentence-nlp/parse.py` (content word + trailing function morphemes → one token; the already-emitted but unconsumed `bunsetsu` spans are a natural basis), then a full re-parse + re-seed. The offset contract survives a merge automatically. Detail: [SENTENCE_STORE_PHASE4.md](SENTENCE_STORE_PHASE4.md) §8.0 + [sentence-nlp/README.md](sentence-nlp/README.md).

### 2. Cloudflare rate-limit + cache rules (~10 min UI work)

Still pending from the original post-deploy runway. In the Cloudflare dashboard:

- **Rules → Rate-limiting rules → Create rule**: 100 req/min per IP across `/v1/*` paths. (Free tier allows 1 rule, which is exactly this.)
- **Rules → Cache rules → Create rule**: on `/v1/vocab/*` paths, "Respect origin Cache-Control headers." Our server already sets long-cache headers on the payload + `Cache-Control: no-store` on `/v1/health`. **Verify** by hitting the same word twice in quick succession — second hit should show `cf-cache-status: HIT`. As of 2026-05-25 it showed `DYNAMIC`, meaning Cloudflare isn't caching at all; the userscript's `cache: 'no-cache'` + the server's weak-ETag-tolerant `If-None-Match` comparison together ensure correctness even with a CDN cache between us.

A sensible hardening step regardless of traffic.

### 3. GHCR image publishing on tag (~1 hour of GitHub Actions)

The Dockerize follow-up. Today's deploys are `docker compose build --pull && systemctl restart` on the droplet — each push triggers a fresh local build (~1–2 min). With a CI pipeline that publishes the image to GHCR on tag, the droplet flow drops to `docker compose pull && systemctl restart` (seconds). See [NEW_FEATURES.md](NEW_FEATURES.md) "Dockerize the server" → follow-ups. Skip until the local-build flow becomes annoying.

### 4. From the wider backlog (NEW_FEATURES.md)

Lower priority and not currently blocking anything; jump to [NEW_FEATURES.md](NEW_FEATURES.md) for full design notes.

- **Schema version pin for cached payloads** — defensive infrastructure for future payload shape changes. Add a `payload_schema_version` column, bump constant, force re-warm on mismatch. ~30 min.
- **Two-phase lazy-fill** — cold-fill latency 1–3s → 500ms–1s. Only worth it if cold-load latency becomes a real complaint.
- **Morphological JLPT scoring** — bundle kuromoji, lemmatize conjugated verbs. Closes the "fail-open on conjugations" gap. Discuss bundling story first (kuromoji's ~50MB dict).
- **Click-to-lookup on sentence words** — userscript change, high QoL.
- **JLPT badge on the card itself** — small userscript UI addition.
- **Health metrics expansion** (24h serve counts, cache hit rate, storage size) — useful for capacity planning as usage grows.

### 5. Study-app feature next-stages

The active product surface (beyond the sentence-store NLP phase in item 1). Full priority list + design notes in [study-app/NEXT_STEPS.md](study-app/NEXT_STEPS.md); the headline threads:

- **Other sentence-store phases.** Beyond NLP (item 1): **Self-Talk TEMPLATES Slice 2** (lazy combo materialization, [SENTENCE_STORE_TEMPLATES.md](SENTENCE_STORE_TEMPLATES.md)) and **Phase 2.5** (custom-card `ex`+`levels` → private store rows, render-from-store) have **shipped**; **Phase 3** = Minna sentences → store (`public=0`) remains deferred. See [SENTENCE_STORE_NLP.md](SENTENCE_STORE_NLP.md) "Remaining phases".
- **Content proofread passes (model-generated → human-verified).** Several datasets shipped model-generated and want a real human pass: the leveled example sentences (`data/examples.js` → re-run `seed-sentences.ts` after edits), the 47 generated Minna words' examples/mnemonics, pitch accents (`ACCENTS` + Minna), and the Apple/Siri-voice readings (a real-ear listen — note the local male clips were just pushed to prod; spot-check they actually sound male). None are blocking; they're quality polish.
- ~~**Custom-card completeness gap.**~~ **Shipped** (study-app branch `custom-card-completeness`) — the "Add card" modal's new "Pitch accent & leveled examples" disclosure authors `accent` (live `pitchHtml` preview) + the five `levels` tiers, validated by the pure `parseAccent`/`buildLevels`/`isCleanRuby`, so a UI-authored card reaches built-in parity. An optional "AI-generate" button to draft the content server-side remains a possible future add.
- **Self-Talk pre-gen.** The 独り言 phrases aren't in the `generate-tts.ts`/`collectTtsTexts.ts` corpus yet, so their Siri reference is Google-synthed-on-first-play instead of a pre-generated `.m4a`. Add them to `collectTtsTexts()` and re-run the generate + push + seed flow.

---

## Shipped this session (2026-05-25 → 2026-05-26)

Code (in order):

1. **`983dcb7` — 429-with-exponential-backoff in `services/ik.ts:fetchJson`.** Retries 429s with base-1s × 2^attempt backoff (cap 30s, 3 retries), honors `Retry-After` (seconds or HTTP-date), 5xx deliberately not retried. Test-only `_ikFetchConfig` knob lets the suite shrink wait times. 76 → 90 tests.
2. **`c882dae` — daily SQLite backup → DO Spaces, with GFS retention.** `deploy/backup.ts` does `VACUUM INTO` (readonly source DB → PrivateTmp snapshot) then uploads to `s3://<bucket>/backups/YYYY-MM-DD.sqlite` (private) then prunes per `deploy/retention.ts`. Default policy: 7 daily + 4 weekly + 12 monthly (tunable via `BACKUP_RETAIN_*`). Scheduled `*-*-* 03:00:00 UTC` via `wk-enhanced-api-backup.timer`. No new host-package deps (Bun's `bun:sqlite` provides `VACUUM INTO`, `Bun.S3Client` handles put/list/delete). 90 → 105 tests.
3. **`942175c` — extended 429-backoff to `ikDownloadMedia`.** Most IK traffic in a bulk warm is `/download_media`, so this is where the retry budget pays off most. Extracted a shared `fetchWithRetry` helper; `fetchJson` is now a thin wrapper that throws on `!ok`, `ikDownloadMedia` keeps its result-object shape (and correctly skips retry on small-body proxy-misses, which are structural failures, not transient). 105 → 109 tests.
4. **`7e713b3` — ETag + conditional GET on `/v1/index_meta`.** Same pattern as `/v1/vocab/{word}` (strong ETag from `fetchedAt`, weak-prefix tolerance for Cloudflare-downgraded validators, 304 path mirrors 200's `Cache-Control` + `ETag`). Helper pair moved out of `routes/vocab.ts` into shared `src/lib/etag.ts`; unit tests followed. 109 → 113 tests.
5. **`0da5169` — ADR-001 records the no-Kubernetes deploy-shape decision.** Captures the cost analysis ($24/mo DOKS minimum vs $11/mo current all-in), workload-shape mismatch (one service, bounded traffic, stateful filesystem), and operational complexity. Linked from `wk-enhanced-api/CLAUDE.md` next to the SQLite-not-Postgres dead-end. Includes a "when to revisit this" section.
6. **`dc2629c` — `POST /v1/admin/warm {"scope":"all"}` refuses overlap with 409.** Module-scoped `warmAllInFlight` flag prevents the monthly timer + a manual re-warm (or any two concurrent triggers) from doubling IK call volume and racing over `vocab_examples` rows. New `conflict` error code in the enum. Test-only `_setWarmAllInFlightForTesting` setter mirrors the `_useDbForTesting` pattern. 113 → 115 tests.
7. **`4e6f912` — Dockerize the server.** Dockerfile (multi-stage off `oven/bun:1.3.8`), compose.yaml (single service, 127.0.0.1:3000 bind, /var/lib bind-mount, env_file), .dockerignore, and rewritten systemd units. [deploy/README.md](wk-enhanced-api/deploy/README.md) gets a fresh-install walkthrough + a pre-Docker droplet migration recipe.
8. **`6e4ee34` — compose.yaml `env_file` defaults to `./.env` (prod overrides via `ENV_FILE`).** Unblocks local `docker compose up` without needing `/etc/wk-enhanced-api/env` to exist on dev boxes.
9. **`2c2980e` — compose.yaml `DATA_DIR` override makes local bring-up work end-to-end.** Parameterizes the bind-mount source + hard-codes container-internal `DATABASE_FILE` / `LOCAL_MEDIA_DIR` to paths inside the bind mount, so the dev `.env`'s relative paths (correct for `bun dev`) don't have to be edited to bring up the container. `.compose-data/` gitignored.

Operations (2026-05-26):

- **Droplet migration from bare-metal Bun → Docker Compose.** Followed the "Migrating from a pre-Docker droplet" recipe in deploy/README.md. Stop bare-metal → install Docker → `chown -R 1000:1000 /var/lib/wk-enhanced-api` (DB preserved through chown, not touched by data-content) → install new systemd units → `systemctl start wk-enhanced-api` (first build ~1–2 min). Phase 4 verification confirmed `warmedWords` carried through the migration cleanly. No downtime beyond the brief restart.
- **First daily backup verified end-to-end.** Manually triggered via `systemctl start wk-enhanced-api-backup`. 114.6 MB DB → VACUUM-INTO snapshot → Spaces upload → retention decision (1 kept, 0 removed) → done in 1.6s. Daily timer now active at 03:00 UTC.
- **Bulk re-warm of the May-25 missing-words gap.** Triggered `POST /v1/admin/warm {"scope":"all","force":false}`. Pre-rewarm: 4859 rows total (4307 populated, 552 empty, ~1858 missing). Post-rewarm: **6717 rows total (5910 populated, 807 empty, ~0 genuinely missing).** Of the ~1858 newly-added rows, ~1603 had real IK data and ~255 were IK-empty — proves the 429-backoff caught transient rate-limits and recovered cleanly.

All commits pushed to `origin/main`. `bun run typecheck` clean throughout, `bun test` ends at **115 pass / 0 fail**.

---

## Phase 3 wrap-up notes (shipped 2026-05-25)

These were decisions made when pulling Phase 3 forward; recorded here for future reference:

- **Direct path preserved as a frozen snapshot (later removed).** Phase 3 kept a v1.1.1 snapshot at `legacy/` (`serverPathEnabled()` hardcoded `false`, no `@updateURL`, distinct `@name`) as an offline escape hatch; it was **removed in the 2026-06 cleanup** once the server path proved stable (recoverable from git history).
- **`useApiServer` setting removed entirely.** The setting becomes a no-op in v2.0.0; any stored value is silently ignored. Users who had it explicitly toggled off get the API path now.
- **Old `wk-ik-examples.*` and `wk-vocab-cache.*` cache prefixes orphan in IndexedDB.** No automatic wipe on first v2.0.0 boot — the Clear cache button in settings cleans them up on user demand. Acceptable disk leak (~5–10MB per heavy user) for simpler upgrade-path code.
- **CSS class prefix kept at `wk-ik`.** ~140 hardcoded references in `injectStyles`; rename was zero user benefit (CSS classes are implementation detail). Documented in [CLAUDE.md](CLAUDE.md).
- **Settings: `apiServerUrl` and `prefetchCount` remain in the dialog.** Both are genuinely useful tuning knobs; only `useApiServer` was actively misleading post-Phase-3.

---

## Troubleshooting: warm completion / cold-fill failures

Reference for the monthly cron warm (or any ad-hoc re-warm). On the **Dockerized prod droplet** (post-2026-05-26), the structured-JSON event stream is at `docker compose -f /opt/wk-enhanced-api/wk-enhanced-api/compose.yaml logs api`; `journalctl -u wk-enhanced-api` only shows the unit-level start/stop events of the Compose wrapper.

**Failure count post-warm**: check the audit log first. `GET /v1/admin/jobs?limit=10` returns recent warm jobs with `wordsProcessed` + `wordsFailed`. The most recent `scope:"all"` row is the bulk run; `wordsFailed` should be small (single digits is fine). If it's >50, look for `warm.all.word_failed` events: `docker compose -f /opt/wk-enhanced-api/wk-enhanced-api/compose.yaml logs api | grep '"event":"warm.all.word_failed"'`.

**`empty` ratio is high but no failures**: that's correct behavior. Empty rows = IK genuinely has no data for those words. Spot-check by querying IK directly: `curl -s 'https://apiv2.immersionkit.com/search?q=<WORD>&exactMatch=true&limit=10' | head -c 400`. If `examples: []`, IK is the source of the empty; nothing to fix.

**Common words like 食べる have `example_count = 0`**: distinct from the above — this would be the warm-pipeline-empty bug. Reproduce against IK with the curl above; if IK has real data and our server stored empty, look at `docker compose ... logs api | grep -F '食べる'` for the warm event sequence and find where it diverged.

**Lots of `ik.fetch.429_backoff` events**: backoff IS doing its job, no action needed — that's the success case. Worth monitoring if the count is exploding (suggests sustained IK rate-limiting, in which case look at lowering load or raising `MIN_GAP_MS` rather than the other way around). The post-2026-05-26 baseline is a small handful per bulk re-warm.

**`debugWkEnhancedApi('food')` returns CORS error**: re-verify the CORS middleware in `src/index.ts` is allowing `wanikani.com`. The header should be `Access-Control-Allow-Origin: *` on every response. Check with `curl -i https://api.wkenhanced.dev/v1/health -H "Origin: https://www.wanikani.com" | grep -i 'access-control'`.

**`debugWkEnhancedApi` returns 502**: the container crashed or cloudflared lost the upstream. `systemctl status wk-enhanced-api` shows the unit (it's a `Type=oneshot` so "active (exited)" is healthy); `docker compose ps` from `/opt/wk-enhanced-api/wk-enhanced-api/` shows the container; `docker compose logs api --tail 100` shows recent activity. `systemctl restart wk-enhanced-api` brings the stack back.

---

## What's NOT in scope without a separate conversation

- Keyed external services (DeepL, OpenAI, Forvo, jpdb) — see SERVER_DESIGN.md "Non-goals". (Note: accounts + per-user data are NO LONGER out of scope — they shipped for the study app. The remaining account gaps are password reset / email verification, deferred for lack of an email provider; see [study-app/NEXT_STEPS.md](study-app/NEXT_STEPS.md) "Deferred".)
- Migrating from SQLite to Postgres (the SQLite story is deliberate; see wk-enhanced-api/CLAUDE.md DEAD-END WARNINGS)
- Migrating to DOKS or any Kubernetes setup (see "DOKS / Kubernetes — explicitly rejected" in NEW_FEATURES.md)
- Per-user analytics / telemetry
