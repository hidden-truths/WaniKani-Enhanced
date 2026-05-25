# CLIENT_MIGRATION.md

Plan for migrating [wk-vocab-review-ik.user.js](wk-vocab-review-ik.user.js) (the Tampermonkey userscript) to call [wk-vocab-api/](wk-vocab-api/) (the server we just built) instead of hitting ImmersionKit / DuckDuckGo / Google TTS directly. **Status: Phase 1 implemented** (userscript v1.0.0-rc1; coexistence toggle, default off; server not yet deployed). Phases 2 and 3 not started.

This is the **biggest planned single change** to the userscript since v0.1 — it deletes roughly half the data-layer code and rebuilds it as a thin client of our API. Worth doing in clear phases with a fallback toggle so we can verify before fully cutting over.

For server architecture see [wk-vocab-api/CLAUDE.md](wk-vocab-api/CLAUDE.md). For the original server design (and what changed from plan to build) see [SERVER_DESIGN.md](SERVER_DESIGN.md).

## Goals

- **Userscript stops calling IK / DDG / Google directly.** Every external request goes to our domain.
- **Userscript shrinks substantially** — roughly half the current ~3700 lines goes away (all the IK fetch, DDG scrape, TTS proxy, title-decoding, half the cache layers).
- **End-user behavior is unchanged** in steady state. Same card, same picker, same hotkeys, same settings. The only user-visible difference should be **faster cold loads** (our server has already warmed the data) and **lower error rate** (we own the proxy chain).
- **Coexistence during rollout.** A setting toggles between "use API server" and "direct" so we can ship the new path opt-in first, validate against real reviews, then flip the default, then remove the old path.

## Non-goals

- No UI / UX changes in this migration. New surfaces (more endpoints, batch prefetch, new settings) come in follow-ups, not the migration itself.
- No changes to the picker, settings dialog, render layer, JLPT filtering/sorting, selection persistence, or hotkey handling. All of those are client-side and stay.
- No accounts, no per-user keys on the server side. Inherits the design constraints from SERVER_DESIGN.md.
- No deletion of the old code path until Phase 3, after the new path has been stable for at least a couple weeks of real review sessions.

## Prerequisites (must happen before the userscript can flip)

The migration assumes the server is **deployed somewhere the userscript can reach**. Today the server only runs locally. Order of operations:

1. **Deploy the server to DigitalOcean.** A `$6/mo` droplet, SQLite + local FS or Spaces (see SERVER_DESIGN.md for cost shape).
2. **Set up TLS** — Cloudflare in front, or Caddy on the droplet. The userscript runs on `https://www.wanikani.com`, so the server must be HTTPS or browsers will block it for mixed content.
3. **Pick a domain.** Working name `wk-vocab-api.example.com`. Set up DNS pointing at the droplet (via Cloudflare proxy ideally).
4. **Run a full warm pass once** (`POST /v1/admin/warm {"scope":"all"}`) so the first wave of users gets cached responses, not lazy fills. Needs the `WK_API_TOKEN` env var; takes hours.
5. **Cron the monthly re-warm.** systemd timer or DO scheduled task.
6. **Smoke-test the deployed server** with `curl` from the same machine you'll run Tampermonkey on, including CORS preflight.

Only after all six does it make sense to ship a userscript version that points at it.

## What changes in the userscript

### Deleted (~1500 lines net)

Everything that talks to an external service or transforms its data:

- `buildIkUrl` — URL builder for IK `/search`.
- `buildIkAudioUrl` / `buildIkImageUrl` — IK `/download_media` proxy URL builders.
- `fetchAndCache` — IK `/search` fetch + normalize + JLPT-score per example.
- `fetchIkAudioBlobUrl` / its negative-cache handling — IK media proxy with `Referer` spoofing.
- `fetchAndCacheTts` / `fetchTtsBlobUrl` — Google TTS direct call.
- `fetchDdgImages` / `fetchDdgImagesCached` — DDG two-step vqd scraping.
- `loadIndexMeta` / `fetchAndCacheIndexMeta` — IK `/index_meta` fetch + cache.
- `ikTitleToFolder` / `decodeIkTitle` / `prettifyTitle` / `resolveIkFolderAndCategory` — the lossy-title-encoding workaround.
- `scoreJlpt` and the bundled `JLPT_VOCAB` const (~93KB inline) — moves entirely to the server side.
- The `wkof.file_cache` schemas for `wk-ik-examples.ik.*` (raw IK responses), `wk-ik-examples.ik-audio.*` (IK MP3s), `wk-ik-examples.audio.*` (TTS MP3s), `wk-ik-examples.img.*` (DDG URL lists), and `wk-ik-examples.index_meta`. Replaced with one new cache (see Added below).
- `maybeUpgradeCache` and `CACHE_SCHEMA_VERSION` — replaced with a much simpler version pin (or removed; the new cache is a thin local mirror that can be cleared safely).
- The IK-related entries in `debugWkIkTitle` and `buildCacheSummary`. Settings dialog's "Cache" section shrinks accordingly.

### Modified

- `renderCard` and friends still consume `formatExample`-shaped data, but the shape now comes from one fetch instead of being assembled across IK + DDG + index_meta. The render code itself doesn't change.
- `pickExample` / `buildPool` — still client-side (settings vary per user; preserves cacheability). Reads `_jlptMax` exactly like today. Just sourced from server payload instead of local IK fetch.
- `loadImageAt` — reads from `payload.examples[idx].imageUrl` (IK screenshot, or null) and `payload.fallbackImages` (DDG pool); same combined-pool semantics, but the URLs are pre-built by the server.
- Refresh button (image cycle) — same logic, but the pool is `[examples[idx].imageUrl, ...fallbackImages]` straight from the payload.
- `autoplayAfterWkAudio` / `playSentenceAudio` — plays `payload.examples[idx].audioUrl` directly. No more "try IK proxy → fall back to TTS"; the server already resolved which one to serve. `hasOriginalAudio` from the payload tells the userscript whether to show a "(TTS)" indicator if we want one.
- Settings dialog — drop the IK-specific settings (none currently exist that we'd lose), add the new `apiServerUrl` setting (see below). Cache section shrinks.

### Added

- **`fetchVocab(word)`** — single new fetch function. Hits `GET ${apiServerUrl}/v1/vocab/${encodeURIComponent(word)}` with an `If-None-Match` header if we have a cached ETag. Handles 200 (parse + cache + return), 304 (return cached payload), 404 (return null — server says no examples), 5xx (return null with a warning, let the card render "no example found"). Returns the full payload object.
- **`fetchVocabBatch(words)`** — optional, for prefetching. Hits `POST /v1/vocab/batch` with up to 50 words; populates the local cache with everything found. Called from the review-loop hook with the next N upcoming subjects' characters. Worth shipping in Phase 1 if straightforward; can defer to a follow-up if it complicates the migration.
- **New local cache: `wk-vocab-cache.payload.<word>`** — stores `{ payload, etag, fetchedAt }`. Single cache for everything (no separate audio / image / index_meta caches; the URLs in the payload point at our CDN, which the browser caches via `Cache-Control` headers). Lighter than today's setup since we don't store binary blobs locally.
- **Local cache TTL**: 7 days. Shorter than the server's 30 day refresh because the server's `fetchedAt` is the truth; on revisit we send `If-None-Match` and either get a 304 (no work) or a fresh payload. Local TTL is mainly a "if the server has been down for a while, eventually go re-check" safety.
- **New setting `apiServerUrl`**: text field, default `''` (= use direct path). When non-empty, the userscript routes through that URL. For dev, set to `http://localhost:3000`; for prod, set to the deployed domain.
- **New setting `useApiServer`**: checkbox, default `false` initially. Flipped to `true` in Phase 2 once we trust the path.
- **`debugWkIkApi()`** console helper — dumps server health, last-known cache state, and a hand-crafted test fetch. Mirrors `debugWkIk()`.

### Tampermonkey metadata changes

The `@connect` and `@grant` directives in the metadata block change:

```diff
- @connect      apiv2.immersionkit.com
- @connect      duckduckgo.com
- @connect      translate.googleapis.com
+ @connect      <api-server-domain>
+ @connect      localhost                  // for dev — remove for production release
- @grant        GM_xmlhttpRequest
+ @grant        GM_xmlhttpRequest          // still needed for cross-origin to our domain
```

We can probably **drop `@grant GM_xmlhttpRequest` entirely** if our server's CORS headers allow `wanikani.com`. The current server already does (`Access-Control-Allow-Origin: *` blanket). That simplifies sandboxing — no more `unsafeWindow` dance for WKOF access (though we still need it for `wkof` itself, which is page-installed).

@version bumps to (probably) `v1.0.0` — this is a big enough change to warrant a major-version mark.

## Rollout phases

### Phase 1: Coexistence (shipped opt-in) — **IMPLEMENTED in v1.0.0-rc1**

Ship a userscript version where:
- The new `fetchVocab` code path exists but defaults `useApiServer: false`.
- `apiServerUrl` defaults to the production URL.
- A user can flip the setting on, hard-refresh, and start using the API path.
- Both code paths exist; no behavior changes for default users.

**What actually shipped** (deviations / notes):
- `apiServerUrl` defaults to `''` (not a production URL — none chosen yet). User sets `http://localhost:3000` for dev. Once a prod domain exists, bump the default and add a `@connect <prod-domain>` line.
- New settings live under an "API server (experimental)" section in the WKOF dialog: `useApiServer`, `apiServerUrl`, `prefetchCount`.
- Adapter approach used (per the plan): `serverPayloadToCacheEntry` reshapes the server's payload into IK-raw-lookalike entries so `pickExample` / `buildPool` / `formatExample` / `renderCard` / the sentence picker are untouched. Server-provided `audioUrl`/`imageUrl`/`fallbackImages` are stashed as `_serverAudioUrl`/`_serverImageUrl`/`_serverFallbackImages` on each entry; `formatExample` prefers them.
- Audio short-circuit: when the entry came from the server, `resolveAudioBlobUrl` returns the CDN URL directly (no blob conversion, no Referer spoof, no negative-cache layer — relies on the server's `Cache-Control: max-age=31536000, immutable` for repeat-play perf).
- Batch prefetch (originally "Lean toward: defer to v1.2") **was included** in Phase 1. Cache-aware: only batches words missing a fresh local payload; falls through to individual `fetchVocab` (lazy-warm) for batch-misses.
- Console helper: `debugWkIkApi('<word>')` reports settings, hits `/v1/health`, runs a sample GET, inspects local cache.
- New cache prefix `wk-vocab-cache.payload.<word>` with ETag round-trip (`If-None-Match` on revisit; 304 keeps cached payload + refreshes savedAt). 7-day local TTL.
- `@connect localhost` added; existing IK/DDG/Google `@connect` directives kept so the direct path still works with the toggle off.

**What's NOT yet done (next steps):**
- Prerequisites 1–6 above (deploy server, TLS, DNS, full warm, cron, CORS smoke-test).
- After deploy: bump `DEFAULTS.apiServerUrl` to the prod URL + add `@connect <prod-domain>` (and remove `@connect localhost` for the public release if desired).
- Phase 2 default-on flip, forum post, then Phase 3 cleanup.

Test plan for Phase 1:
1. Run server locally; set `apiServerUrl = http://localhost:3000`; flip toggle on.
2. Verify cards render correctly across 50+ reviews (varied vocab, including cold words that trigger lazy-warm).
3. Verify picker shows the right examples sourced from server payload.
4. Verify audio plays for both `hasOriginalAudio: true` and `false` cases.
5. Verify image cycle works through the IK + DDG combined pool.
6. Verify ETag round-trips (DevTools network tab: revisits should be 304).
7. Side-by-side: review the same words with toggle off vs on; render output should be identical except for the source domain of media URLs.

When all green: flip a few trusted users to the API path, gather feedback, watch the server logs.

### Phase 2: Default-on

Flip `useApiServer: true` by default. Existing users with the setting explicitly toggled keep their preference. New installs get the API path.

Bump userscript version (e.g. `v1.1.0`). Forum-post announcing the change with:
- What changed (faster, more reliable, server-side processing unlocks future features).
- How to opt out if it's broken (toggle off in settings).
- Where to report issues.

Watch the server for traffic + error spikes. Stay at Phase 2 for at least 2 weeks of real review sessions before Phase 3.

### Phase 3: Cleanup

Delete the old code path. The `useApiServer` toggle becomes a no-op (or gets removed entirely, with the setting silently ignored for backward compat).

Bump to `v2.0.0` to signal that direct-mode is no longer supported. Documentation update.

This is also when [JLPT_VOCAB] gets deleted from the userscript file — ~93KB savings.

## API consumption patterns

How the userscript will use the API once migrated:

### Per-card render

1. WK navigation event fires (new subject loaded).
2. `getCurrentSubject().characters` gives us the word.
3. Local cache lookup. If fresh, use it; if present-but-stale (>7d), use it AND fire a background `fetchVocab` with `If-None-Match` to refresh.
4. If not cached, `fetchVocab(word)` — typically <100ms warm, 10-30s on the first cold hit per word across the whole server.
5. `formatExample` from the payload using the current `state.sentenceIdx`, `state.imageIdx`.
6. Render the card.

### Prefetch (optional Phase 1, nice-to-have)

When entering review session, peek at the upcoming review queue (WK exposes this via `Stimulus` controller state — `state.controllers.find(c => c.identifier === 'review-queue')`). Take the next ~10 words, batch-fetch them.

```js
const upcoming = getUpcomingReviewWords(10);
const uncached = upcoming.filter(w => !hasFreshLocalCache(w));
if (uncached.length) {
    fetchVocabBatch(uncached).then(({found, missing}) => {
        Object.entries(found).forEach(([word, payload]) => writeLocalCache(word, payload));
        // missing → fire individual `?nowarm=true` checks, or just leave to lazy fill on render
    });
}
```

The win: subsequent card renders during the session hit local cache; the only network is the initial batch.

### Refresh button (sentence cycle)

Unchanged behavior. The cycle still walks `payload.examples` client-side. No new network call.

### Refresh button (image cycle)

Unchanged. Cycles through `[examples[idx].imageUrl, ...payload.fallbackImages]` client-side.

### Sentence picker

Unchanged. Reads `payload.examples` and renders. No new network.

## Client-side caching strategy after migration

**What we drop:**
- All the per-source caches (`ik.*`, `ik-audio.*`, `audio.*`, `img.*`, `index_meta`).
- Binary audio/image storage in IndexedDB — the URLs in the payload point at our CDN, browser cache handles them via `Cache-Control` headers we already set (`max-age=31536000, immutable` for media).

**What we add:**
- One cache prefix: `wk-vocab-cache.payload.<word>` → `{ payload, etag, savedAt }`.
- TTL: 7 days locally (safety net; ETag-based refresh is the primary mechanism).

**Net effect:**
- Local cache shrinks from ~10MB+ for a heavy user (audio blobs dominate) to ~5MB even for hundreds of words (just JSON payloads).
- Faster boot — no IndexedDB reads of large blobs on card render.
- Browser HTTP cache handles media; nothing for us to manage.

**Selections cache stays as-is.** `wk-ik-examples.selections` (per-word refresh-button state) is purely client-side state; the server doesn't know or care which sentence index the user pinned.

**Schema version bump warranted.** When Phase 1 ships, the new cache prefix doesn't conflict with the old ones (different name), but we should add a `wk-vocab-cache.schema-version` pin from day one so future shape changes have an upgrade path.

## What changes server-side

Most of the work is already done. The userscript migration shouldn't require new server endpoints. Possible small server changes during migration:

1. **CORS verification** — confirm `Access-Control-Allow-Origin: *` actually works from `www.wanikani.com` for both GET and the POST batch. Currently we set the header blanket; verify in DevTools that there's no preflight issue.
2. **`@connect` localhost workflow** — for dev, the userscript needs `@connect localhost` AND the server needs to be running on `http://localhost:3000`. Document in [wk-vocab-api/CLAUDE.md](wk-vocab-api/CLAUDE.md) under "Diagnostic helpers".
3. **Production URL hardening** — once deployed, double-check rate limits at the Cloudflare layer (100 req/min per IP across `/v1/*` is the SERVER_DESIGN.md value).
4. **Cache-Control on `/media/*` static route** — already `max-age=31536000, immutable`. Verify.

## Open questions

These are real decisions for migration time — not deferred forever.

- **What's the production server URL?** Needs to be picked + DNS-registered before Phase 1. Working name `wk-vocab-api.<something>`. The userscript hard-defaults to this URL.
- **Should we ship the prefetch (batch) endpoint use in Phase 1, or save it for v1.2?** Argument for: full payoff of the API; first impression matters. Argument against: smaller diff = lower migration risk. **Lean toward: ship without prefetch, add in v1.2 once the basic path is stable.**
- **Should there even be a `useApiServer` toggle, or just hard-cut?** Toggle is safer; users with the old version still work after we deploy the server. But it bloats the codebase with two paths. **Lean toward: keep the toggle through Phase 2, remove in Phase 3.**
- **What's the strategy for users on old userscript versions after Phase 3?** They'll keep working (still hitting IK directly) until something breaks. We can't force-update. Acceptable; document in the forum post.
- **Server-side: should we limit the public `apiServerUrl` to one canonical domain** (no user-pointing the userscript at random servers), or allow any URL (developer-friendly, but enables malicious "use this server" instructions)? **Lean toward: allow any URL — power users can self-host the server, and there's no auth so "malicious server" is no worse than "malicious anything else on the page."**
- **Error fallback: if our server is down, should the userscript fall back to direct IK/DDG/Google calls?** Phase 1: yes (old code path still exists). Phase 3: no (code is gone). Acceptable downtime: if the server goes down for an hour, users see "no example found" cards for that hour — the rest of WK still works. Not great but not catastrophic.
- **Should we add a server-status indicator to the card?** A tiny dot or text near the source attribution showing "via wk-vocab-api" vs "direct fallback" or "server down". Power-user-y; defer unless someone asks.

## Estimated effort

- **Phase 1 (coexistence ship)**: ~half a day of focused work. The new code is small (~300 lines added: fetchVocab, cache layer, settings field, init wiring). The big-net-of-deletion happens at Phase 3.
- **Phase 1 verification**: a couple hours of manual testing across ~50 review words.
- **Phase 2 (default-on)**: 5 minutes of code change (flip default) + write the forum post.
- **Phase 3 (cleanup)**: a few hours to delete the old paths cleanly + bump to v2.0.

Total: 1-2 days of work spread across a few weeks of validation time.

## Suggested first concrete step

When you're ready to start: deploy the server, then write a tiny standalone `fetchVocab.js` snippet you can paste into the WK browser console to test the API path *manually* before touching the userscript. If `fetchVocab('食べる')` returns a sane payload from the production server, the rest of the migration is just code reorganization. If it doesn't, deploy / CORS / DNS need attention before the userscript work begins.
