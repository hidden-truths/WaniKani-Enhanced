---
name: troubleshoot
description: >-
  Debug WKEnhanced problems by symptom across all three surfaces + prod: empty review cards,
  study-app login that won't stick, missing/401 audio, blank tabs, sync loss, API 502s /
  cold-fill timeouts / CORS-null-ETag, and prod incidents (Cloudflare tunnel, containers,
  missing seeds, Spaces 404s). Use WHENEVER something is broken — renders empty, won't play,
  won't save, errors, or diverges between local and prod — before diving into code. Routes each
  symptom to the exact log surface, diagnostic command, and fix, and steers you past the
  known dead-ends so you don't re-debug "impossible" behavior.
---

# Troubleshoot WKEnhanced by symptom

You arrive with a symptom; you leave with a diagnosis path. This skill is a router: it maps a
symptom to the right log surface, the right diagnostic command, and the reference file that
walks the fix. It does **not** re-teach architecture — when a fix means changing code, hand off
to the surface skill (`userscript-dev`, `api-dev`, `study-app-dev`) or `deploy-prod`.

The three surfaces (see the `orient` skill for the full map): the Tampermonkey **userscript**
`wkenhanced.user.js`; the **API** `wk-enhanced-api/` (Bun+Hono+SQLite, prod
`https://api.wkenhanced.dev`); the **study app** `study-app/` (Vite→nginx, prod apex
`https://wkenhanced.dev`). Prod is two Docker containers on one DO droplet behind a Cloudflare
Tunnel.

## Golden rules (apply before every investigation)

1. **Reproduce first, and pin the boundary.** Local vs prod? Signed-in vs anon? One word/tab or
   all? Userscript, app, or server? Most "bugs" are an environment boundary (a dev-only config,
   a missing prod seed, a cross-origin cookie) — narrowing the boundary usually *is* the
   diagnosis. A prod-only failure that works locally is almost always config/seed drift, not a
   code bug.
2. **Read the right log surface — don't guess from the UI.**
   - API: structured JSON, one event per line. Local: the `bun dev` terminal. Prod:
     `docker compose logs -f api` on the droplet (NOT `journalctl` — that shows only unit
     start/stop). See `references/api.md` for the event + `cacheStatus` tables.
   - Userscript: the browser devtools console — the `[wkenhanced] booting v<X.Y.Z>` line, then
     `debugWkEnhanced()` / `debugWkEnhancedApi('<word>')` output (ask the user to paste it; you
     cannot drive their browser).
   - Study app: devtools console + Network tab (look for the cross-origin `api()` calls to
     `api.wkenhanced.dev`) + `bun run test` for logic regressions.
3. **Search the dead-end lists before debugging "impossible" behavior.** Every surface has a
   "Things that look like bugs but aren't" section that pins hard-won traps (root `CLAUDE.md`,
   `wk-enhanced-api/CLAUDE.md`, `study-app/CLAUDE.md`). If a symptom smells like one, grep the
   symptom words there first — the reference files below name the highest-frequency traps, but
   the CLAUDE.md sections are exhaustive and auto-loaded in every session anyway.
4. **On prod, diagnose before you restart.** Restarting a container or the tunnel is
   USER-VISIBLE (it's a live single-user service). Confirm the fault with a read-only probe
   first, and — unless it's already clearly down — confirm the restart with the user. Never run
   destructive ops (`docker compose down -v`, volume/DB `rm`) as a diagnostic.

## Symptom → playbook routing table

| Symptom | Surface | First move | Depth |
|---|---|---|---|
| Review card renders empty / no sentence | userscript ↔ API | devtools boot log, then `debugWkEnhancedApi('食べる')` | `references/userscript.md` → empty-card playbook |
| Card renders but audio/image missing | userscript ↔ API | Network tab: is the CDN URL 404? | `references/userscript.md` + `references/api.md` (media 404) |
| Furigana/translation reveal misfires | userscript | ask user to run `debugWkEnhanced()` | `references/userscript.md` → reveal detection |
| Script features gone after an edit | userscript | check console for `booting v<X.Y.Z>` — did they re-import? | `references/userscript.md` → version mismatch |
| Study-app login won't stick | study-app ↔ API | is `COOKIE_SECURE=false` in dev? origin allowlisted? | `references/study-app.md` → login (the #1) |
| Minna/native audio 401s | study-app ↔ API | `<audio crossOrigin='use-credentials'>` set? | `references/study-app.md` → audio 401 |
| A tab renders blank | study-app | console error at boot; init order; `showX` dispatch | `references/study-app.md` → blank panel |
| Progress/sync loss on sign-in | study-app ↔ API | 409 merge semantics; `mergeProgress` field list | `references/study-app.md` → sync loss |
| Server list stale / empty after update | study-app | read-through cache + adoptEmpty guard | `references/study-app.md` → stale lists |
| Vitest failure I don't understand | study-app | which tier? (core / render / infra) | `references/study-app.md` → reading tests |
| API returns 502 on a cold word | API | log `cacheStatus:error` + `vocab.lazy_warm_failed` | `references/api.md` → 502 / lazy warm |
| `curl` cold-fill returns `http=000` | API | idleTimeout vs slow warm | `references/api.md` → idleTimeout |
| Warm produces empty rows for a word | API | `warm.ik_search_failed` vs `warm.ik_audio_miss` | `references/api.md` → warm failures |
| Browser never 304s (but curl does) | API | Cloudflare weak-ETag + Expose-Headers | `references/api.md` → ETag/CORS |
| 429 `rate_limited` on login/register | API | per-IP auth limiter | `references/api.md` → rate limits |
| Prod down / apex NXDOMAIN / api hangs | prod | `curl .../v1/health` → ssh → containers → tunnel | `references/prod.md` → triage ladder |
| Prod media 404 (works locally) | prod | Spaces upload half-failed → force re-warm | `references/prod.md` → media 404 |
| A prod tab/library is empty (local OK) | prod | a seed step never ran | `references/prod.md` → missing seeds |

## The universal fast probes

Run these before opening a reference file — they classify most incidents in one command:

```bash
# Is prod's API alive + how warm is the corpus? (public, safe, no creds)
curl -s https://api.wkenhanced.dev/v1/health
# → {"status":"ok","warmedWords":<N>,"lastWarm":{…,"wordsProcessed":…,"wordsFailed":…}}

# Is prod's content in sync with what's authored locally? (read-only, anon GETs only)
cd wk-enhanced-api && bun scripts/verify-prod.ts     # exits non-zero on any drift
```

A green `verify-prod.ts` means songs/selftalk/examples/annotations/templates/sampled-voices
all match local — so if a surface is empty on prod despite green, the gap is elsewhere (gated
content, or the study-app `web` container's own bundle). See `references/prod.md`.

## Reference files (open the one the table points to)

- `references/userscript.md` — empty review card, missing media, reveal-detection issues,
  post-edit version mismatch. The userscript talks only to the API, so most "empty card" faults
  are really API/connectivity faults.
- `references/study-app.md` — login won't stick (the #1), audio 401, blank panel, sync loss,
  stale server lists, and how to read the three-tier Vitest suite. Cross-origin cookie behavior
  is the through-line.
- `references/api.md` — the structured-log event table + `cacheStatus` enum, warm failures, 502
  lazy-warm, the `idleTimeout` cold-fill trap, ETag/CORS (why curl 304s but the browser
  doesn't), and auth rate limits.
- `references/prod.md` — droplet topology, the triage ladder (health → ssh → containers →
  tunnel), media 404s, missing seeds, and the restart-safety discipline. Every command here is
  lifted from `wk-enhanced-api/deploy/README.md` — re-verify against it, don't invent.

## Ground truth (re-verify when updating this skill)

Compressed from, and authoritative over, these sources — read them if a claim here looks stale
(all as of 2026-07):

- Root `CLAUDE.md` — "When a card renders empty (playbook)", "Diagnostic helpers", and the
  userscript dead-end list (bg-color reveal, dedupeCards, `no-cache`).
- `wk-enhanced-api/CLAUDE.md` — "Diagnostic helpers / local-dev playbook", "Reading the logs"
  (event + `cacheStatus` tables), the DEAD-END WARNINGS (idleTimeout, ETag weakening,
  Expose-Headers, rate-limit floor, warm-throws-on-failure).
- `study-app/CLAUDE.md` — "How to work on it" (dev/test loop) + the DEAD-END WARNINGS section
  (cross-origin `API_BASE`, the `no-state.store` rename, credentialed audio, AUTO/MANUAL
  checklist).
- `wk-enhanced-api/deploy/README.md` — the ONLY source for prod commands (compose invocations,
  seed steps, the ENV_FILE/DATA_DIR gotcha). Verified against it 2026-07; the userscript was at
  v2.0.5 and prod `/v1/health` reported ~6.7k warmed words at authoring time.
