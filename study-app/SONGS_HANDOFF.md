# 歌 / Songs — session handoff (2026-06-16, end of "modes + timing + curation" session)

**This is the cold-start doc.** Read it first, top to bottom — it's written to be the whole context a
fresh session needs to keep building. The living **design** source of truth is [SONGS.md](SONGS.md)
(four modes, data model, reuse map, Phase checklist); the architecture/invariants live in the three
`CLAUDE.md` files. This doc = current state + what's left + the gotchas a fresh context must NOT
re-derive. When the next batch of features ships, update this in place.

---

## TL;DR — what works right now

The 歌/Songs tab (the study app's 6th surface) is **feature-complete for v1**: a curated library you
read, listen to, shadow, and mine, with real synced timing.

- **All four practice modes are LIVE:** **Read** (lyric viewer) · **Listen** (dictation) · **Shadow**
  (record & compare) · **Mine** (vocab + grammar). Library + Add (paste→analyze→save) also shipped.
- **12-song curated J-pop library, ALL TIMED.** Every song has full per-line analysis
  (furigana · English · grammar · per-word JLPT) **and** forced-alignment timing, so synced highlight,
  per-line replay, Listen-by-slice, and Shadow's "▶ original" work across the whole library.
- **Adding a curated song is now ONE command** — `scripts/curate-song.ts` (analyze → write seed →
  time → seed). See "Adding a song" below.
- **What's left:** ship to prod (re-seed + redeploy — it's all local right now); a few MED validation
  findings; and in-app **tap-to-sync** for user-added (BYO) songs. (The `songs` synced **progress
  blob** ⭐ — shadowed-line tracking + stars + the library ring — SHIPPED 2026-06-16; see below.) Full
  slate in "What's left" + [ROADMAP.html](../ROADMAP.html) "歌/Songs".

⚠️ **Everything this session is committed to local `main` but NOT pushed and NOT deployed.** The prod
DB has the OLD (untimed) library and the prod study-app container predates Listen/Shadow.

---

## This session's commits (8, newest first) — on top of `d745d72`

| Commit | What |
|---|---|
| `53e4824` | **One-command curation** (`scripts/curate-song.ts` + test) + formalize the process |
| `38fb09a` | gitignore the `song-align/` venv + `__pycache__` |
| `3cd542b` | **Time the full library** — 12 forced-alignment sidecars (all songs `N/N` timed, local) |
| `06ea2c7` | song-align: solve YouTube's **player JS challenge** (`yt-dlp-ejs` + `--js-runtimes node`) |
| `85f7429` | song-align: pass **browser cookies** to yt-dlp (clear the bot check) |
| `6cca52d` | Listen: hide the "Slower" cue on untimed lines (synth has no slow-down) |
| `4b9b730` | **Shadow** mode — reuse the record-compare engine for song lines |
| `8a92e14` | **Listen** mode — cloze ⇄ full-line dictation, advisory grading, timed-slice audio |

---

## What the feature is (one paragraph)

A song = a `song` metadata row (title/artist/youtube_id) + one **sentence-store row per lyric line**
(`owner_type='song'`), so lines reuse the furigana / tap-a-word / grammar / translation machinery and
the privacy gate. **Public** starter songs (`created_by=NULL`, anon-readable) are the curated 12;
**private** BYO songs come from the in-app Add flow. Audio is **always** the embedded YouTube player —
never re-hosted; the only stored audio is the user's own Shadow takes (private) + cached TTS of line
text. Full design: [SONGS.md](SONGS.md). Server: [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md)
(Songs entries). Client: [CLAUDE.md](CLAUDE.md) (the 歌/Songs dead-end).

---

## The four modes — current state + where the code lives

All four render into the stable `#sgContent` wrapper inside `#sgBody`; the YouTube player is mounted
once per song view (outside `#sgContent`) so partial re-renders don't reload the iframe. Entry points
are in [src/features/songs.js](src/features/songs.js); pure logic in [src/core/songs.js](src/core/songs.js).

- **Read** (`readHtml`) — the lyric viewer: furigana flip, reveal-on-tap English, tap-a-word
  (`overlayTokens`+`wireWordTaps`), grammar chips → reference panel, stanza section headings, **synced
  highlight** (`highlightAt`) + per-line replay (`replayLine` → `playSlice` slice, else synth).
- **Listen** (`listenHtml`, `mode==='listen'`) — a per-line **dictation stepper** ("Line N of M · K
  correct"): a **Cloze ⇄ Full-line** difficulty toggle, Play + (timed-only) Slower cues, Check / Reveal /
  Next. Cloze blanks content words via the pure `clozeBlanks` + `clozeLineParts` (offset-slicing — a
  blank token can sit mid plain-furigana run). **Advisory grading** via the typed-reading path
  (`normKana`/`romajiToKana`); a `done` Set is the per-session correct count (no double-count). The
  video is **masked** in Listen (kept playing for audio) so a lyric-burned MV can't spoil the dictation.
- **Shadow** (`shadowHtml`, `mode==='shadow'`) — per-line speaking practice reusing the **record-compare
  engine verbatim**: navbar speaking bar (`speakingBarHtml`/`wireSpeakingControls`/`initMicSelector` in
  `#navExtra`, shadow+account only) + per-line `recordControlHtml(SONGS_SCOPE, songLineKey(extId,ord),
  '', null, false, plainText(lineJp), 'songs')` (the synth-TTS reference = full rig). Reference tiers:
  **TTS** (full rig) + a per-line by-ear **YouTube-slice** ("▶ original", timed lines only — iframe
  audio isn't decodable). A saved take marks the shared day-streak. Account-gated (recording is private).
- **Mine** (`mineHtml`) — vocab by JLPT (known/added/new) → bulk/per-word activation as `Source:歌`
  custom cards; grammar points + counts → reference panel + save-line-as-Self-Talk-phrase.

---

## New mechanisms shipped this session (load-bearing)

1. **Listen cloze helpers** — `clozeBlanks(line,{max})` (content-POS tokens to blank) + `clozeLineParts(line,blanks)`
   (the ordered render plan; offset-slices a blank that sits inside a plain furigana run, keeps ruby
   segments whole). Pure + unit-tested in [test/core.test.ts](test/core.test.ts). The feature maps the
   parts → gap `<input>`s; grading compares the typed reading to each blank's `reading`.
2. **`playSlice` has its OWN timer + a `rate` arg** ([songs-youtube.js](src/features/songs-youtube.js)).
   A slice started from a paused player used to have its stop clobbered by the synced-highlight poll
   (they shared one timer) → it overran into the next line. Now `sliceTimer` is separate from `endTimer`,
   and `rate` (default 1; `SLOW_RATE=0.6`) drives slow replay via `setPlaybackRate`. Benefits Read too.
3. **`setOnTakeSaved` is now MULTI-LISTENER** ([record-compare/takes.js](src/features/record-compare/takes.js)).
   Was a single global callback (Self-Talk owned it). Now an additive registry — Self-Talk **and** Songs
   both subscribe, each filtering by its reserved scope, so registering one can't clobber the other.
4. **Full library timing + the yt-dlp two-step fix.** `song-align/align.py` gained `--cookies-from-browser`
   / `--cookies` (YouTube bot check) and `--js-runtimes` + `yt-dlp-ejs` (the player JS/signature
   challenge). All 12 sidecars are committed in `wk-enhanced-api/data/song-timing/` and seeded locally.
5. **One-command curation** — [scripts/curate-song.ts](../wk-enhanced-api/scripts/curate-song.ts):
   analyze (`analyzeLyrics`) → pure `analyzedToSeedFile` → write `data/songs/<slug>.json` → shell
   `align.py` → shell `seed-songs.ts`. `main()` is guarded by `import.meta.main` so the test can import
   the pure mapping.

---

## ‼️ Gotchas / dead-ends — do NOT re-derive these

**From this session:**
- **`playSlice` MUST keep its own `sliceTimer`** (gotcha #2 above). Don't "tidy" it back to sharing
  `endTimer` with the highlight poll — a paused-start slice will overrun.
- **`setOnTakeSaved` is additive (multi-listener), not set-and-replace.** A new speaking surface
  registers its own scope-filtered hook; don't revert to a single callback.
- **Listen renders into `#sgContent`; the player is OUTSIDE it.** Step re-renders call `renderListen()`
  (rewrites `#sgContent` only) — calling the full `render()` per step would re-mount + reload the iframe.
  Same pattern for Shadow (`renderShadow`). The video is masked **only** in Listen.
- **Shadow constants are reserved:** `SONGS_SCOPE = 80000` (engine partition → server `lesson` param;
  Minna 1–50, Self-Talk 90000 — never reuse), itemKey = `songLineKey(extId, ordinal)` = `"<extId>:<ord>"`,
  audio context `'songs'` (synth-first). The YouTube-slice reference is **by-ear only** (no waveform/
  overlay) — an iframe's audio can't be decoded.
- **The day-streak is SHARED with Self-Talk.** A saved Shadow take calls `applyPractice` on
  `state.selftalkStore.practice` + `saveSelftalk()` ("one spoke-today signal" per SONGS.md). The song
  itemKey lands in Self-Talk's `doneToday` — harmless (no phrase id collision), by design.
- **The `songs` progress blob SHIPPED (2026-06-16) — `markShadowed()` is no longer a stub.** It records
  shadowed ordinals into the `songs` blob (app key `songs`, the 6th `createSyncedBlob`, modeled on the
  Self-Talk blob). The library **ring is now shadowed-lines %** (`songProgress`), per-line **stars** live
  in Read, and reopening a song **restores its last mode**. PROGRESS ONLY — content stays
  server-authoritative (don't put line text/timing in the blob). `lastLine` was dropped (nothing reads it).
  The day-streak (shared with Self-Talk) is still marked separately in `onSongTakeSaved`.
- **`curate-song.ts` strips token offsets** before writing the seed file — `seed-songs.ts` recomputes
  them via the SAME `offsetTokens`, so they can't drift. Don't write offsets into `data/songs/*.json`.
- **yt-dlp now needs cookies + a JS runtime.** Bot check → `--cookies-from-browser <browser>` (Safari
  needs the terminal to have **Full Disk Access** — TCC protects its cookie store). Player challenge →
  `yt-dlp-ejs` (in `requirements.txt`) + `--js-runtimes node` (align.py passes it by default). Full
  notes: [../song-align/README.md](../song-align/README.md). A sandboxed/non-interactive shell can't
  read Safari cookies (TCC) — timing runs in the maintainer's terminal, or via a `cookies.txt`.

**Carried forward (still true):**
- **The in-app tap-to-sync `PUT /v1/songs/{id}/timing` is OWNER-SCOPED.** The 12 curated songs are
  PUBLIC (`created_by=NULL`) → they're timed via the **offline pipeline** (curate-song / align.py),
  NOT in-app. The in-app editor (unbuilt) is for **private BYO** songs only.
- **Synced highlight + per-line replay are wired** in `songs.js` (`highlightAt`/`playSlice`/`replayLine`).
- **Lyric sourcing boundary:** annotate maintainer-provided text only; never scrape/source/reproduce lyrics.
- **Mine/coverage count only `CONTENT_POS = {NOUN,PROPN,VERB,ADJ,ADV}`** (mirror of the server set).
  PRON tokens (私/僕) are tappable but don't count; some songs tokenized 僕/私 as NOUN to make them count.
- **The seed does NOT catalog-filter grammar ids** (the runtime analyzer does). A non-catalog id seeds a
  broken chip — `curate-song` inherits the analyzer's catalog filter, but a hand-edited seed file won't.
- **Songs are the first RUNTIME writer of `sentence_annotation`** (LLM tokens, `parser='llm:*'`); offsets
  are UTF-16, server-computed. Don't revert to offline-only. (Server CLAUDE.md.)

---

## What's left (prioritized) — the next session's menu

The user wants the next session to focus on **NEW FEATURE development**. Candidates, highest-leverage
first (full backlog incl. broader-app ideas: [ROADMAP.html](../ROADMAP.html)):

1. **Ship to prod** *(not a feature, but it gates everything users see)* — push `main`, rebuild/redeploy
   the **study-app container** (Listen/Shadow are client changes), run `bun scripts/seed-songs.ts`
   against the **prod** DB so the committed timing lands. Droplet pattern:
   [../wk-enhanced-api/deploy/README.md](../wk-enhanced-api/deploy/README.md). Spot-check the
   English-heavy tracks (BANDAGE/CLASSIC/Blinded Eyes/FIESTA) where JA alignment drifts most.
2. ~~**`songs` synced progress blob** ⭐~~ — **SHIPPED 2026-06-16 (completes Shadow).** The 6th
   `createSyncedBlob` trio (app key `songs`, `{progress:{"<extId>":{starred,shadowed,lastMode}}}`,
   modeled on the Self-Talk blob): `markShadowed` records shadowed ordinals → the library **progress
   ring** = shadowed-lines % (`songProgress`); per-line **stars** in Read; **last-mode resume** on
   reopen. Touched the ~6 shared sync files (state.js, sync-bus.js, cloud.js, core/merge.js +
   `mergeSongs`, new persistence/songs.js) + the server `/v1/progress/{app}` enum (added `songs`).
   `lastLine` from the original shape was dropped (no reader).
3. **Edit/delete a song + a real Add title/artist field** *(MED validation findings)* — server has
   `PUT/DELETE /v1/songs/{id}`; the client wires no edit/rename/delete. The Add flow relies on oEmbed
   (returns the channel, not the artist) and saves "Untitled" on a miss with no fix-in-flow.
4. **In-app tap-to-sync editor (BYO songs)** — play the video, tap each line's start →
   `PUT /v1/songs/{id}/timing` (owner-scoped). Generalizes the Minna clip-marker; the only timing path
   for a user's own added song. Largest of the four.
5. **Inline Add-review editor** — edit flagged lines before save (today the flags just guide a re-analyze).

Also open (lower): `analyze` caps at 120 lines but persist allows 400 (silent truncation); the
`goBrowseGrammar` button lands on Browse without applying the grammar filter.

---

## Adding a curated song — the one command

```bash
# from wk-enhanced-api/  (.env supplies ANTHROPIC_API_KEY for analyze + DATABASE_FILE for seed)
bun scripts/curate-song.ts --slug <slug> --title <…> --artist <…> \
    --url <youtube-url> --lyrics <path-to-lyrics.txt> --browser safari
```

Runs analyze → write `data/songs/<slug>.json` → time (`song-align`) → seed. Flagged lines print for a
proofread; `--dry-run` previews, `--force` re-analyzes, `--no-align`/`--no-seed` skip a step. You supply
the lyric TEXT (a file); it only annotates. Then spot-check + commit the two JSON files. Full doc +
the per-browser cookie/JS-runtime setup: [../wk-enhanced-api/data/songs/README.md](../wk-enhanced-api/data/songs/README.md)
"Adding a song — one command" + [../song-align/README.md](../song-align/README.md).

---

## How to verify / build / test / deploy

- **Client (study-app):** `cd study-app && bun run test` (208) + `bun run build`. Pure Songs logic is in
  `core/songs.js` (tested in `test/core.test.ts`).
- **Server (wk-enhanced-api):** `bun test` (299) + `bun run typecheck`. Song repo/routes/analyze +
  `curate-song` mapping are covered; the live Claude/align calls are integration-only.
- **Data integrity:** `bun scripts/seed-songs.ts` re-validates every line's furigana + recomputes token
  offsets and ABORTS on a bad line (names it). The live API (`/v1/songs`) shows per-song line/timed
  counts.
- **Preview caveat:** the maintainer runs Vite on `:5173` + the API on `:3000` — **do NOT restart them**.
  The MCP preview tool can't attach to a foreign server, so to drive a real browser this session ran a
  SEPARATE Vite on `:5199` via a temp `--config` with a `/v1` → `:3000` proxy + empty `VITE_API_BASE`
  (so a non-allowlisted origin clears CORS), then removed the scaffolding. Mic-gated flows (Shadow
  recording) can't be exercised headlessly (`getUserMedia` → `NotAllowedError`).
- **Deploy:** data lives in the DB; the repo holds `data/songs/*.json` + `data/song-timing/*.json`.
  Re-seed prod (`seed-songs.ts` against the prod DB) + redeploy the study-app container.

---

## Cold-start reading order for the next session

1. **This file** — current state, what's left, gotchas.
2. [SONGS.md](SONGS.md) — the design (four modes, data model, reuse map, Phase checklist).
3. [ROADMAP.html](../ROADMAP.html) "歌 / Songs" — the new-feature backlog (for a feature-dev session).
4. [CLAUDE.md](CLAUDE.md) 歌/Songs dead-end + [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md)
   Songs entries — architecture + invariants.
5. Code: `src/features/songs.js` (+ `songs-youtube.js`), `src/core/songs.js`, `src/features/record-compare/*`;
   server `src/db/repos/songs.ts`, `src/services/songAnalyze.ts`, `scripts/{seed,curate}-song*.ts`;
   `song-align/align.py`.
