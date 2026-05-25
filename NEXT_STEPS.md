# NEXT_STEPS.md

Living document for the WKEnhanced project. Use this as the entry point for any new working session — it points at the doc-of-record for each ongoing thread and lists the concrete next actions in priority order.

Owns the *what-to-do-next* state of the project. Architecture, design rationale, and dead-end warnings live in [CLAUDE.md](CLAUDE.md), [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md), [SERVER_DESIGN.md](SERVER_DESIGN.md), and [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md). The feature backlog (everything that isn't time-critical) is in [NEW_FEATURES.md](NEW_FEATURES.md).

**Last updated**: 2026-05-25, evening — Phase 3 shipped (rename + slim main userscript to server-only + legacy/ snapshot).

---

## Current state of the world

- **Userscript**: [wkenhanced.user.js](wkenhanced.user.js) **v2.0.0**. Server-only — every vocab lookup goes through `https://api.wkenhanced.dev`. The IK / DDG / Google TTS direct path is gone from this file; the v1.1.1 snapshot lives at [legacy/wk-vocab-review-ik-direct.user.js](legacy/wk-vocab-review-ik-direct.user.js) as a frozen fallback for "API server is down for an extended period." Source tree only — no build pipeline.
- **Server**: [wk-enhanced-api/](wk-enhanced-api/) in production at `https://api.wkenhanced.dev` (DO droplet in SFO3, Spaces bucket, Cloudflare Tunnel). Renamed in source from `wk-vocab-api/` on 2026-05-25 to match the deployment. Nine cumulative deploy-period fixes are in the codebase (five on initial deploy day, four on Phase 2 smoke-test day — see [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md) Phase 2 section + DEAD-END WARNINGS in [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md)).
- **Bulk warm coverage (post-Phase-2-flip)**: ~4859 / ~6500 words populated (~75%). 552 of those are legitimately empty (obscure WK vocab IK doesn't index). ~1641 words have no row at all — the warm's IK calls 429ed without retry. **Not a Phase 2 blocker**: the idleTimeout fix means cold-fill on a missing word now succeeds (~15-30s) and populates the row organically as users encounter them. Fixing this properly requires implementing 429-with-backoff in `services/ik.ts:fetchJson` (see backlog item).

---

## Next session's runway (priority order)

Phase 3 is shipped end-to-end; nothing on the critical path is gated. This list is a menu, not a checklist — pick what matches the time you have.

### 1. Forum-post announcement of v2.0.0 (1–2 hours of drafting)

Highest priority because the rename + server-only switch is the kind of change WK forum users will want to know about before their next Tampermonkey paste. Draft separately; nothing to do in the codebase.

Cover points:
- What changed: v1.x → v2.0.0, rename to WKEnhanced, all data flows through `api.wkenhanced.dev`.
- Why: no third-party CORS/sandbox friction, faster cold loads, server owns the title-decoding lossy-encoding workaround.
- Install: paste [wkenhanced.user.js](wkenhanced.user.js) — bumps `@version`, Tampermonkey re-prompts for `@connect api.wkenhanced.dev`.
- For users who don't want a server dependency: install [legacy/wk-vocab-review-ik-direct.user.js](legacy/wk-vocab-review-ik-direct.user.js) instead. Different `@name` so they can coexist.

### 2. Cloudflare rate-limit + cache rules (~10 min UI work)

Still pending from the post-deploy runway. In the Cloudflare dashboard:
- **Rules → Rate-limiting rules → Create rule**: 100 req/min per IP across `/v1/*` paths. (Free tier allows 1 rule, which is exactly this.)
- **Rules → Cache rules → Create rule**: on `/v1/vocab/*` paths, "Respect origin Cache-Control headers." Our server already sets long-cache headers on the payload + `Cache-Control: no-store` on `/v1/health`. **Verify** by hitting the same word twice in quick succession — second hit should show `cf-cache-status: HIT`. As of 2026-05-25 it shows `DYNAMIC`, meaning Cloudflare isn't caching at all; the userscript's `cache: 'no-cache'` + the server's weak-ETag-tolerant `If-None-Match` comparison together ensure correctness even with a CDN cache between us.

### 3. Re-warm the 1641 missing words at a slower rate (~30 min + waiting)

Not user-visible — cold-fill handles missing words organically since the idleTimeout fix. But useful before any forum-post-driven traffic spike (avoids users on dial-up paying for 30s warms that we could have done in advance). Two viable paths:
- **Pragmatic**: bump `MIN_GAP_MS` in [services/ik.ts](wk-enhanced-api/src/services/ik.ts) to 2000ms, re-run `POST /v1/admin/warm {"scope":"all"}` — non-fresh words get retried. Restore 500ms after.
- **Proper**: implement 429-with-exponential-backoff in `services/ik.ts:fetchJson` first (see backlog item below), then re-warm at the current 500ms rate.

### 4. SQLite backup script (~30 min)

Cheap insurance. Per the "SQLite backup story" entry in [NEW_FEATURES.md](NEW_FEATURES.md):

```sh
# Daily systemd timer fires this:
sqlite3 /var/lib/wk-enhanced-api/wk-enhanced-api.sqlite \
    ".backup /tmp/wk-vocab-snapshot.sqlite"
s3cmd put /tmp/wk-vocab-snapshot.sqlite \
    s3://wk-enhanced-api-media/backups/wk-vocab-$(date -u +%Y%m%d).sqlite
rm /tmp/wk-vocab-snapshot.sqlite
```

Wrap in a shell script at `/opt/wk-enhanced-api/wk-enhanced-api/deploy/backup.sh`, add a systemd `backup.service` + `backup.timer` (daily at 03:00 UTC). Retention: keep last 7 daily + 4 weekly + 12 monthly snapshots. ~$0.005/mo on Spaces.

---

## Bigger projects (queue, not urgent)

Pick from these once Phase 3 is stable. All have full design notes in [NEW_FEATURES.md](NEW_FEATURES.md):

- **IK 429-backoff in `services/ik.ts:fetchJson`** (couple of hours) — the bulk warm's ~25% miss rate is directly attributable to this. Backoff first so retries actually help, then optionally lower `MIN_GAP_MS` below 500ms. Closes the loop on the 1641-missing-words gap properly.
- **Dockerize the server** (~half day) — collapses future re-deploys from ~30 min to ~5 min. Best done before any other architectural work.
- **Two-phase lazy-fill** — cold-fill latency 1-3s → 500ms-1s. Only worth it if forum users complain.
- **Morphological analysis for JLPT scoring** — bundle kuromoji, lemmatize conjugated verbs before JLPT lookup. Closes the "fail-open on conjugated forms" gap.
- **Click-to-lookup on sentence words** — jisho.org popups. Pure userscript change, high QoL.
- **JLPT badge on the card itself** — small UI addition next to the sentence.

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
