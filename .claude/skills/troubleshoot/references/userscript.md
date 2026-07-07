# Troubleshoot: userscript (WaniKani review page)

The userscript talks to exactly ONE network target: our API (`api.wkenhanced.dev`, or
`localhost:3000` in dev). So almost every "card is broken" symptom is really *userscript ↔ API*
connectivity or a payload issue — not a bug in the review-page code. You cannot drive the user's
browser: your levers are reading the code, `node --check wkenhanced.user.js`, and asking the user
to run a console helper and paste the output. The three helpers are exposed on `PAGE_WIN` at boot:
`openWkEnhancedSettings()`, `debugWkEnhanced()`, `debugWkEnhancedApi('<word>')`.

## Empty review card (the playbook)

Lifted from root `CLAUDE.md` "When a card renders empty" — walk it in order; the most likely
cause is between the userscript and the server.

1. **Check the boot log.** Devtools console should show `[wkenhanced] booting v<X.Y.Z> on /...`.
   Absent → WKOF probably failed to load. Ensure the WaniKani Open Framework is installed and
   **ordered first** in Tampermonkey (the userscript reaches it via `PAGE_WIN = unsafeWindow ||
   window` and falls back to `DOMContentLoaded` if the Turbo Events lib is missing).
2. **Run `debugWkEnhancedApi('食べる')`** (defaults to 食べる). It reports the resolved base URL +
   settings, probes `/v1/health`, runs a sample `GET /v1/vocab/<word>`, and inspects the local
   payload cache. Three branches:
   - **`/v1/health` returns 200** → server reachable. Look at the sample GET: `{examples: [],
     ...}` means that word genuinely has no ImmersionKit examples (common for rare vocab); a 502
     means the server is up but the lazy-warm threw (→ check server logs, `references/api.md`).
   - **CORS / network error** → connectivity. Either the user's `apiServerUrl` setting is empty,
     prod is down (`curl https://api.wkenhanced.dev/v1/health`), or a Cloudflare Tunnel hiccup
     (`references/prod.md`).
   - **Hangs** → server up but cloudflared lost the upstream → restart on the droplet
     (`references/prod.md`).
3. **Only one specific word empty** → almost always a missing IK row for that word. Force a
   re-warm (this is the load-bearing recovery command — bearer + `force:true` bypasses the
   freshness check):
   ```bash
   curl -X POST https://api.wkenhanced.dev/v1/admin/warm \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"scope":"word","word":"食べる","force":true}'
   ```
4. **Audio/image fails but text renders** → the CDN URL is bad. Check it in the Network tab: a
   Spaces 404 means the warm pipeline failed mid-upload → re-warm with `force:true` to re-upload
   (see also `references/prod.md` media 404).

Do NOT try to debug the IK title-encoding workaround from the userscript — it's entirely
server-side now (`references/api.md`, and `wk-enhanced-api/src/lib/ikTitles.ts`).

## Reveal detection misfires (furigana / translation / image)

Reveals are gated **per question type**, not on subject completion (WK asks meaning + reading as
two questions). If a reveal fires at the wrong time, doesn't fire, or re-hides on a shuffle-mode
revisit, ask the user to run **`debugWkEnhanced()`** and paste the dump — it prints five sections
top-to-bottom, and these three are the diagnostic surface:

- **`--- bg-color chain from input → body ---`** — WK signals "answer graded" via computed
  `background-color`, NOT via class/attribute changes. `answerHasBeenSubmitted()` walks up from
  `input#user-response` looking for a strong red (`rgb(255,0,51)`, incorrect) or green
  (`rgb(136,204,0)`, correct) background. If a future WK moves that color off the input onto a
  wrapper, this chain shows which element now carries it.
- **`--- .quiz-input subtree (classes + data-*) ---`** — the graded-state markers. Confirmed (late
  2025): classList and `data-*` are byte-identical before/after submitting. If reveal detection
  ever needs a non-color signal, this is where a new marker would show up.
- **`--- .character-header DOM tree ---`** — for vocab-character *positioning* bugs (glyph stuck at
  top of the expanded header). The trap: `.character-header__characters` is positioned relative to
  `.character-header__content` (~82px tall), not the outer host; the fix (`__content { position:
  static }`) already ships. Re-dump if positioning misbehaves.

The per-subject reveal state lives in `state.subjectProgress` (`{subjectId → {meaningAnswered,
readingAnswered}}`), which survives interleaved subjects in shuffled reviews. Before assuming a
reveal bug, re-read the reveal dead-ends in root `CLAUDE.md` (they're exhaustive and pin exactly
why each behaves as it does) — this is the #1 place to waste time re-exploring a settled design.

## Features vanished after an edit — check the running version

Tampermonkey does **not** auto-reload from disk. After any edit the user must paste the file into
the Tampermonkey editor; until they do, the old version runs. The `[wkenhanced] booting v<X.Y.Z>`
console line is the source of truth for what's actually live. If behavior doesn't match the code
you just changed, first confirm the booted version matches `SCRIPT_VERSION` in the file (as of
2026-07 the file is at v2.0.5 — grep `SCRIPT_VERSION` for the current value; note the prose in
root `CLAUDE.md` still says "v2.0.0" in places and lags the code). A version mismatch is far more
common than a real regression. To change the code safely, use the `userscript-dev` skill (it
covers the `@version`/`SCRIPT_VERSION` pairing and `node --check`).

## Stale-empty-payload trap (don't "simplify" away)

If a word intermittently renders empty right after a bulk warm and then stays empty for ~24h,
that's the browser HTTP cache serving a stale empty body. The fix already ships: `fetchVocab`
sends `cache: 'no-cache'` (in `GET_FETCH_OPTS`) to force conditional revalidation, because the
server's `Cache-Control: max-age=86400` would otherwise let Chrome cache an empty payload for a
full day. **Never remove `cache: 'no-cache'`** without first shrinking the server's `max-age`.
Full incident write-up is in root `CLAUDE.md`.

## Ground truth (as of 2026-07)

- Root `CLAUDE.md`: "When a card renders empty (playbook)", "Diagnostic helpers", the reveal +
  `no-cache` dead-ends. Verified: `wkenhanced.user.js` exposes the three helpers on `PAGE_WIN` at
  boot (`booting v` log line), `GET_FETCH_OPTS = { credentials:'omit', mode:'cors',
  cache:'no-cache' }`, `SCRIPT_VERSION = '2.0.5'`.
- Server-side pieces (media, titles, JLPT): `references/api.md` + `wk-enhanced-api/CLAUDE.md`.
