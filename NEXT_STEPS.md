# NEXT_STEPS.md

Living document for the WK Vocab Review project. Use this as the entry point for any new working session — it points at the doc-of-record for each ongoing thread and lists the concrete next actions in priority order.

Owns the *what-to-do-next* state of the project. Architecture, design rationale, and dead-end warnings live in [CLAUDE.md](CLAUDE.md), [wk-vocab-api/CLAUDE.md](wk-vocab-api/CLAUDE.md), [SERVER_DESIGN.md](SERVER_DESIGN.md), and [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md). The feature backlog (everything that isn't time-critical) is in [NEW_FEATURES.md](NEW_FEATURES.md).

**Last updated**: 2026-05-25, evening — Phase 2 fully shipped including the four deploy-day smoke-test fixes.

---

## Current state of the world

- **Userscript**: `wk-vocab-review-ik.user.js` **v1.1.1**. Phase 2 default-on shipped (`useApiServer: true`, `apiServerUrl: 'https://api.wkenhanced.dev'` by default; existing users with explicit toggles keep their preference). Source tree only — no build pipeline.
- **Server**: `wk-vocab-api/` in production at `https://api.wkenhanced.dev` (DO droplet in SFO3, Spaces bucket, Cloudflare Tunnel). Initial deploy + first bulk warm + Phase 2 cutover all complete. Nine cumulative deploy-period fixes are now in the codebase (five on initial deploy day, four on Phase 2 smoke-test day — see [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md) Phase 2 section and the DEAD-END WARNINGS in [wk-vocab-api/CLAUDE.md](wk-vocab-api/CLAUDE.md)).
- **Bulk warm coverage (post-Phase-2-flip)**: ~4859 / ~6500 words populated (~75%). 552 of those are legitimately empty (obscure WK vocab IK doesn't index). ~1641 words have no row at all — the warm's IK calls 429ed without retry. **Not a Phase 2 blocker**: the idleTimeout fix means cold-fill on a missing word now succeeds (~15-30s) and populates the row organically as users encounter them. Fixing this properly requires implementing 429-with-backoff in `services/ik.ts:fetchJson` (see backlog item).
- **Phase 3 (legacy snapshot + slim main userscript v2.0.0)**: deferred per maintainer pivot. Won't delete the direct-path code — preserve it in `legacy/` as a fallback for "API server is down" scenarios. Target: 2+ weeks of real Phase 2 review sessions before kicking off.

---

## Next session's runway (priority order)

Phase 2 is shipped end-to-end; nothing on the critical path is gated. This list is a menu, not a checklist — pick what matches the time you have.

### 1. Cloudflare rate-limit + cache rules (~10 min UI work)

Highest priority because a forum-post traffic spike is the next likely event. In the Cloudflare dashboard:
- **Rules → Rate-limiting rules → Create rule**: 100 req/min per IP across `/v1/*` paths. (Free tier allows 1 rule, which is exactly this.)
- **Rules → Cache rules → Create rule**: on `/v1/vocab/*` paths, "Respect origin Cache-Control headers." Our server already sets long-cache headers on the payload + `Cache-Control: no-store` on `/v1/health`. **Verify** by hitting the same word twice in quick succession — second hit should show `cf-cache-status: HIT`. As of 2026-05-25 it shows `DYNAMIC`, meaning Cloudflare isn't caching at all; the userscript's `cache: 'no-cache'` + the server's weak-ETag-tolerant `If-None-Match` comparison together ensure correctness even with a CDN cache between us.

### 2. Re-warm the 1641 missing words at a slower rate (~30 min + waiting)

Not user-visible — cold-fill handles missing words organically since the idleTimeout fix. But useful before any forum-post-driven traffic spike (avoids users on dial-up paying for 30s warms that we could have done in advance). Two viable paths:
- **Pragmatic**: bump `MIN_GAP_MS` in [services/ik.ts](wk-vocab-api/src/services/ik.ts) to 2000ms, re-run `POST /v1/admin/warm {"scope":"all"}` — non-fresh words get retried. Restore 500ms after.
- **Proper**: implement 429-with-exponential-backoff in `services/ik.ts:fetchJson` first (see backlog item below), then re-warm at the current 500ms rate.

### 3. SQLite backup script (~30 min)

Cheap insurance. Per the "SQLite backup story" entry in [NEW_FEATURES.md](NEW_FEATURES.md):

```sh
# Daily systemd timer fires this:
sqlite3 /var/lib/wk-enhanced-api/wk-enhanced-api.sqlite \
    ".backup /tmp/wk-vocab-snapshot.sqlite"
s3cmd put /tmp/wk-vocab-snapshot.sqlite \
    s3://wk-enhanced-api-media/backups/wk-vocab-$(date -u +%Y%m%d).sqlite
rm /tmp/wk-vocab-snapshot.sqlite
```

Wrap in a shell script at `/opt/wk-enhanced-api/wk-vocab-api/deploy/backup.sh`, add a systemd `backup.service` + `backup.timer` (daily at 03:00 UTC). Retention: keep last 7 daily + 4 weekly + 12 monthly snapshots. ~$0.005/mo on Spaces.

---

## Bigger projects (queue, not urgent)

Pick from these once Phase 2 is stable. All have full design notes in [NEW_FEATURES.md](NEW_FEATURES.md):

- **IK 429-backoff in `services/ik.ts:fetchJson`** (couple of hours) — the bulk warm's ~25% miss rate is directly attributable to this. Backoff first so retries actually help, then optionally lower `MIN_GAP_MS` below 500ms. Closes the loop on the 1641-missing-words gap properly.
- **Dockerize the server** (~half day) — collapses future re-deploys from ~30 min to ~5 min. Best done before any other architectural work.
- **Two-phase lazy-fill** — cold-fill latency 1-3s → 500ms-1s. Only worth it if forum users complain.
- **Morphological analysis for JLPT scoring** — bundle kuromoji, lemmatize conjugated verbs before JLPT lookup. Closes the "fail-open on conjugated forms" gap.
- **Click-to-lookup on sentence words** — jisho.org popups. Pure userscript change, high QoL.
- **JLPT badge on the card itself** — small UI addition next to the sentence.

---

## Phase 3 — legacy snapshot (2+ weeks after Phase 2 ship date, i.e. earliest ~2026-06-08)

**Don't start this until Phase 2 has soaked for 2 weeks of real review sessions.**

The maintainer pivoted from "delete the direct path" to "preserve as a snapshot":

```
legacy/
├── README.md                              — what this is, when to install, trade-offs
└── wk-vocab-review-ik-direct.user.js      — frozen v1.1.1 with useApiServer hardcoded false (or a frozen rc2 — decide at Phase 3 kickoff)
```

Then the live userscript becomes server-only and drops ~half its current ~3700 lines:
- IK fetch + `JLPT_VOCAB` (~93KB inline) + DDG scrape + Google TTS + lossy-title workaround
- Related cache prefixes
- `GM_xmlhttpRequest` plumbing where only needed for the direct path

Bump live userscript to v2.0.0. Decisions to surface when this session starts:
- Should `legacy/.../wk-vocab-review-ik-direct.user.js` have its own `@updateURL` (frozen, never auto-updates) or no `@updateURL`?
- What goes in `legacy/README.md`? Minimum: "this version doesn't use the API server; uses more bandwidth from your browser; install only if the API server is unreachable for an extended period."
- Should v2.0.0's settings dialog include a "Server unreachable? Try the legacy version: [link]" link, or just let people find it in the repo?

---

## Troubleshooting: warm completion / cold-fill failures

Reference for the monthly cron warm (or any ad-hoc re-warm). The most likely culprits + fixes:

**`empty` ratio > 30%**: re-check that the IK rate-limit didn't kick back in. `journalctl -u wk-enhanced-api --no-pager --since "12 hours ago" | grep -c 'warm.ik_search_failed'` — if this is > 100, we hit another 429 wave. Force re-warm the empty words: write a quick `sqlite3 ... 'SELECT word FROM vocab_examples WHERE example_count = 0;'` loop calling `POST /v1/admin/warm {"scope":"word","word":"X","force":true}` with a 1-second sleep.

**Common words like 食べる have `example_count = 0`**: this is the warm-pipeline-empty bug we thought we fixed. Reproduce locally with `curl -s 'https://apiv2.immersionkit.com/search?q=食べる&exactMatch=true&limit=10' | head -c 200`; if IK has real data and our server stored empty, look at `journalctl -u wk-enhanced-api | grep -F '食べる'` for the warm event sequence.

**`debugWkIkApi('food')` returns CORS error**: re-verify the CORS middleware in `src/index.ts` is allowing `wanikani.com`. The header should be `Access-Control-Allow-Origin: *` on every response. Check with `curl -i https://api.wkenhanced.dev/v1/health -H "Origin: https://www.wanikani.com" | grep -i 'access-control'`.

**`debugWkIkApi` returns 502**: the server crashed or cloudflared lost the upstream. `systemctl status wk-enhanced-api` to check; `journalctl -u wk-enhanced-api --no-pager -n 50` for crash traces; `systemctl restart wk-enhanced-api` to bring it back.

---

## What's NOT in scope without a separate conversation

- Adding accounts / user data of any kind
- Keyed external services (DeepL, OpenAI, Forvo, jpdb) — see SERVER_DESIGN.md "Non-goals"
- Migrating from SQLite to Postgres (the SQLite story is deliberate; see wk-vocab-api/CLAUDE.md DEAD-END WARNINGS)
- Migrating to DOKS or any Kubernetes setup (see "DOKS / Kubernetes — explicitly rejected" in NEW_FEATURES.md)
- Per-user analytics / telemetry
