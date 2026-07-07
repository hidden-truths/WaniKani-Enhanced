# Troubleshoot: study app (日常日本語)

The study app (`study-app/`, Vite→nginx) is **cross-origin** from the API: it lives at
`wkenhanced.dev`, the API at `api.wkenhanced.dev`. That one fact drives most of its bugs. Every
API call goes through `api()` in `study-app/src/net/transport.js`, which fetches `API_BASE + path`
(from `src/config.js`, env `VITE_API_BASE`) with `credentials:'include'` — never a relative
`/v1`. The session cookie rides only because the two are same-*site* (`Domain=.wkenhanced.dev`,
`SameSite=Lax`). Debug with devtools console + the Network tab (watch the calls to
`api.wkenhanced.dev`) + `bun run test`.

## Login won't stick (THE #1 — check this first)

Symptom: sign-in appears to succeed but the account chip stays logged-out, or every reload logs
you out, with no error.

- **Dev: `COOKIE_SECURE` must be `false`.** A `Secure` cookie is silently dropped by the browser
  over plain `http://localhost` — login "doesn't stick" with zero errors. This is the single most
  common local failure. `dev.sh` and `.env.example` already set it; confirm nothing overrode it.
  (Prod is `true`, correct behind Cloudflare HTTPS.)
- **Origin not allowlisted.** The API only echoes the credentialed-CORS headers
  (`Access-Control-Allow-Origin: <exact origin>` + `Allow-Credentials: true`) for origins in
  `config.studyApp.allowedOrigins` (env `STUDY_APP_ORIGINS`, dev default
  `http://localhost:5173`, prod `https://wkenhanced.dev`). A non-allowlisted origin falls back to
  `Access-Control-Allow-Origin: *`, which the browser **refuses** to use with credentials → the
  cookie never sets. If you run the app on a non-default port, add that origin. The server branch
  is `STUDY_ROUTE` in `wk-enhanced-api/src/index.ts` (regex over
  `/v1/(auth|progress|sessions|minna|audio|sentences|templates|songs)`).
- **`COOKIE_DOMAIN` on prod.** The cookie spans apex + `api.` via `Domain=.wkenhanced.dev`. If
  only prod login breaks, verify that env var (see the parity table in `wk-enhanced-api/CLAUDE.md`
  and `references/prod.md`).

To change any of this, use `study-app-dev` / `api-dev`. Full write-up: the cross-origin dead-end
in `study-app/CLAUDE.md` + "Accounts + study app" in `wk-enhanced-api/CLAUDE.md`.

## Native / Minna audio 401s (but TTS plays)

Native みんなの日本語 audio and user voice-takes are **cookie-gated**; public TTS is not. The gated
`<audio>` must set `crossOrigin='use-credentials'` or the cookie isn't sent and the request 401s.
This is wired in `features/audio.js` (`playItem` → credentialed `<audio>` for `/v1/audio/native`
and `/v1/audio/recordings`, plain `<audio>` for `/v1/audio/tts`). If native audio 401s: confirm
the element is the credentialed path, and that the server answers `/v1/audio/native` with an
origin-scoped `Allow-Credentials` (never `*`) — same allowlist as login above. If it's a *prod*
401, the clip may simply not be seeded (`references/prod.md`).

## A tab renders blank

The eight tabs (`#panel-study/browse/stats/jlpt/minna/selftalk/songs/wanikani`) are filled at
runtime by their feature module's `renderX`/`showX`. A blank panel is almost always one of:

1. **A JS error at boot or on tab-show** — check the console first. The `store`→`state.store`
   module-split once rewrote the string `cache:'no-store'` → `'no-state.store'` (the hyphen is a
   word boundary), making every `api()` fetch throw an invalid-`RequestCache` TypeError that
   surfaced *only when signed-in*. Cautionary tale: a blank/broken panel that only reproduces
   signed-in points at the credentialed transport path, and a search-and-replace can silently
   corrupt a string literal. (The current `transport.js` correctly uses `cache: 'no-store'`.)
2. **Init/dispatch order** — `initX()` runs in `src/main.js` boot order; the tab click is
   dispatched in `features/chrome.js`. If a new tab is blank, mirror how `showJlpt` is wired.
3. **Server-backed data never arrived** — if the panel depends on a fetched list, jump to "stale
   lists" below and check the Network tab for the underlying `api()` call.

## Progress / sync loss on sign-in

Signing in mirrors the local blobs to the server; on conflict the server returns **409** and the
client runs a per-blob **merge reconciler** in `study-app/src/core/merge.js`. Two traps:

- **`mergeProgress`'s field list is EXPLICIT.** A per-card stat field that isn't in that list is
  silently dropped on a 409 merge. If a stat resets after signing in on a second device, check
  whether its field is enumerated in `mergeProgress`. (Adding a synced field is the `add-synced-blob`
  skill's job — it covers the merge + server enum together.)
- **Settings is the server-wins exception.** Most blobs merge (e.g. `mergeJlpt` unions day
  records); the `settings` blob is server-wins on 409 by design — a local Settings change made
  offline can be overwritten on sign-in. That's intended, not a bug.

The offline sync queue replays pending PUTs on reconnect, so a transient 4xx (e.g. the server
`app`-enum not yet widened for a new blob on prod) tolerates a short gap — but don't leave that
gap open (`references/prod.md` + `add-synced-blob`).

## Server list is stale or empty after a content update

Server-backed lists (examples, songs, selftalk, grammar) go through
`createReadThroughResource` (`study-app/src/persistence/resource.js`) — NOT hand-rolled
fetch/catch/cache. It single-flights concurrent reads and has an **adoptEmpty clobber-guard** so a
transient empty server response doesn't overwrite a good local cache. If a list looks stale:

1. Confirm the server actually has the data — hit the endpoint directly
   (`curl https://api.wkenhanced.dev/v1/songs`, `?ownerType=selftalk`, etc.). Empty there → it's a
   **seed** problem, not a client cache problem (`references/prod.md` missing seeds).
2. If the server has it but the app doesn't, it's a cache-adoption issue — read the resource
   module and the read-through dead-ends in `study-app/CLAUDE.md`. Do **not** bypass the resource
   with a raw fetch to "force" it. (Exception: the 鰐蟹 WaniKani tab deliberately uses IndexedDB +
   a plain `fetch` to `api.wanikani.com` — that dataset is too big for the read-through shape and
   never touches our server; don't "fix" it onto `API_BASE`.)

## Reading a Vitest failure

`bun run test` (Vitest + happy-dom, ~21 files as of 2026-07). Three tiers — knowing which failed
tells you what broke:

- **core** (`test/core.test.ts` + `*-core` files) — import the real `src/core/*` pure modules. A
  failure here is a genuine logic or a broken export/import (fails loudly).
- **render** (`*-render` files) — drive a tab's REAL feature glue over a happy-dom DOM with
  network/persistence/audio **mocked**. A failure here is usually a DOM-wiring or render
  regression, or a changed collaborator contract.
- **infra** — pin transport / sync-queue / synced-blob / orchestrator / resource behavior. A
  failure here is a sync/persistence contract break.

Run it and paste the failing block; the tier + the assertion message localize the fault. Test
conventions: `study-app/test/CLAUDE.md`.

## Ground truth (as of 2026-07)

Verified against `study-app/CLAUDE.md` (DEAD-END WARNINGS + "How to work on it") and
`wk-enhanced-api/CLAUDE.md` ("Accounts + study app", parity table): `transport.js` uses
`API_BASE + path` with `credentials:'include'` and `cache:'no-store'`; `STUDY_ROUTE` regex + the
allowlisted-origin CORS branch live in `wk-enhanced-api/src/index.ts`; `createReadThroughResource`
is `study-app/src/persistence/resource.js`; reconcilers are `study-app/src/core/merge.js`; the
`COOKIE_SECURE=false`-in-dev rule is the documented #1 login failure.
