# NEXT_STEPS.md

Living document for the WK Vocab Review project. Use this as the entry point for any new working session — it points at the doc-of-record for each ongoing thread and lists the concrete next actions in priority order.

Owns the *what-to-do-next* state of the project. Architecture, design rationale, and dead-end warnings live in [CLAUDE.md](CLAUDE.md), [wk-vocab-api/CLAUDE.md](wk-vocab-api/CLAUDE.md), [SERVER_DESIGN.md](SERVER_DESIGN.md), and [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md). The feature backlog (everything that isn't time-critical) is in [NEW_FEATURES.md](NEW_FEATURES.md).

**Last updated**: 2026-05-25, mid-second-bulk-warm.

---

## Current state of the world

- **Userscript**: `wk-vocab-review-ik.user.js` v1.0.0-rc2. Phase 1 (coexistence toggle, `useApiServer` default OFF) shipped. Source tree only — no build pipeline.
- **Server**: `wk-vocab-api/` deployed to production at `https://api.wkenhanced.dev` (DO droplet in SFO3, Spaces bucket, Cloudflare Tunnel for TLS/edge). Five code fixes shipped on deploy day (rate limit 50→500ms, throw-on-ikSearch-failure, restore inline ACL after bucket-policy detour, S3_FORCE_PATH_STYLE=true, systemd ExecStart path).
- **Bulk warm**: second run in progress as of 2026-05-25. Healthy: ~17 words/min, ~10–12% empty rate (legitimate obscure WK vocab). Expected to complete ~6-7 hours from kickoff. Once done, `lastWarm.finishedAt` flips non-null and we can verify before Phase B.
- **Phase B (userscript v1.1.0, default-on flip)**: queued. ~10 minutes of edits + smoke test. Gated only on the bulk warm completing.
- **Phase C (legacy snapshot + slim main userscript v2.0.0)**: deferred per maintainer pivot. Won't delete the direct-path code — preserve it in `legacy/` as a fallback for "API server is down" scenarios. Target: 2+ weeks after Phase B ships.

---

## Tomorrow morning's runway (priority order)

### 1. Verify the bulk warm completed cleanly (~5 min)

```sh
DB=/var/lib/wk-enhanced-api/wk-enhanced-api.sqlite
ssh root@209.38.71.210

# 1a. lastWarm.finishedAt should be non-null
curl -s http://127.0.0.1:3000/v1/health | head -c 500

# 1b. empty-vs-populated ratio
sqlite3 "$DB" -header -column \
    'SELECT count(*) AS total, sum(CASE WHEN example_count = 0 THEN 1 ELSE 0 END) AS empty FROM vocab_examples;'

# 1c. spot-check common WK vocab
sqlite3 "$DB" "SELECT word, example_count FROM vocab_examples
  WHERE word IN ('食べる','水','本','人','大きい','行く','学生','日本','学校','友達');"
```

**Pass criteria**:
- `finishedAt`: non-null integer (ms timestamp)
- `empty / total` ratio: ≤ 20% (legitimate obscure WK vocab is 10-15%)
- All 10 common words have `example_count ≥ 5`

If any of those fail, see "Troubleshooting on warm completion" at the bottom.

### 2. Browser smoke test through the deployed server (~5 min)

In a WK browser tab, DevTools console:
```js
debugWkIkApi('食べる')
```

Want to see:
- `useApiServer: true`, `apiServerUrl: 'https://api.wkenhanced.dev'`
- `/v1/health` returns 200 with the post-warm `warmedWords` count (~6500)
- Sample GET returns `exampleCount: 50` and populated `audioUrl` / `imageUrl` / `fallbackImages`
- DevTools Network tab shows requests going to `api.wkenhanced.dev` (not IK / DDG / Google directly)

Do 5-10 actual WK reviews. Sentences + audio + image should all work.

### 3. Phase B — userscript v1.1.0 (~15 min)

Three edits in `wk-vocab-review-ik.user.js`:

| Line / field | Before | After |
|---|---|---|
| `DEFAULTS.useApiServer` | `false` | `true` |
| `DEFAULTS.apiServerUrl` | `''` | `'https://api.wkenhanced.dev'` |
| Metadata block | (no entry for our domain) | `// @connect      api.wkenhanced.dev` |
| `@version` (metadata) | `1.0.0-rc2` | `1.1.0` |
| `SCRIPT_VERSION` constant | `'1.0.0-rc2'` | `'1.1.0'` |

Keep `@connect localhost` so dev still works. Keep the direct-path code untouched (Phase C territory).

```sh
node --check wk-vocab-review-ik.user.js
```

Paste into Tampermonkey, hard-refresh a WK review page, confirm the boot log shows `booting v1.1.0`, do 10 reviews to validate. Commit as a single `Userscript v1.1.0: API server default-on (Phase 2)` commit.

Update [CLIENT_MIGRATION.md](CLIENT_MIGRATION.md) Phase 2 section to "implemented" with the date.

---

## After Phase B ships — short-term work (not blocking)

### 4. Cloudflare rate-limit + cache rules (~10 min UI work)

Before any forum-post traffic spike. In the Cloudflare dashboard:
- **Rules → Rate-limiting rules → Create rule**: 100 req/min per IP across `/v1/*` paths. (Free tier allows 1 rule, which is exactly this.)
- **Rules → Cache rules → Create rule**: on `/v1/vocab/*` paths, "Respect origin Cache-Control headers." Our server already sets long-cache headers on the payload + `Cache-Control: no-store` on `/v1/health`.

Verify by hitting the same word twice in quick succession; second hit should show `cf-cache-status: HIT` in the response headers.

### 5. SQLite backup script (~30 min)

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

Pick from these once Phase B is stable. All have full design notes in [NEW_FEATURES.md](NEW_FEATURES.md):

- **Dockerize the server** (~half day) — collapses future re-deploys from ~30 min to ~5 min. Best done before any other architectural work.
- **IK 429-backoff + per-endpoint rate limits** (couple of hours, coupled changes) — could halve bulk-warm time. Backoff first, then lower floors. Only worth it if monthly warms get annoying.
- **Two-phase lazy-fill** — cold-fill latency 1-3s → 500ms-1s. Only worth it if forum users complain.
- **Morphological analysis for JLPT scoring** — bundle kuromoji, lemmatize conjugated verbs before JLPT lookup. Closes the "fail-open on conjugated forms" gap.
- **Click-to-lookup on sentence words** — jisho.org popups. Pure userscript change, high QoL.
- **JLPT badge on the card itself** — small UI addition next to the sentence.

---

## Phase C — legacy snapshot (2+ weeks after Phase B)

**Don't start this until Phase B has soaked for 2 weeks of real review sessions.**

The maintainer pivoted from "delete the direct path" to "preserve as a snapshot":

```
legacy/
├── README.md                              — what this is, when to install, trade-offs
└── wk-vocab-review-ik-direct.user.js      — frozen v1.0.0-rc2, useApiServer hardcoded false
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

## Troubleshooting on warm completion

If verification step 1 fails, the most likely culprits + fixes:

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
