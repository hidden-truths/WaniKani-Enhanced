# 歌 / Songs — session handoff (2026-06-16)

**Snapshot, not the design doc.** The living design + source of truth is [SONGS.md](SONGS.md); the
architecture/dead-ends live in the three CLAUDE.md files. This doc is the **current state + what's
left + the gotchas a fresh context must not re-derive**, written at the end of a long session so the
next session can start cold. When Listen/Shadow ship, fold the still-relevant parts into SONGS.md and
archive this.

---

## TL;DR

The 歌/Songs tab now has a **real curated library** (12 J-pop songs) with full per-line analysis
(furigana · English · grammar tags · per-word JLPT), **stanza structure**, and a working **offline
line-timing pipeline** (forced alignment) that unlocks the synced highlight + per-line replay.

- **Library:** 12 public starter songs (the placeholder 故郷 was removed). Each has furigana, a per-line
  English gloss, grammar-catalog tags, and per-word JLPT tokens → so **Read + Mine + coverage %** all work.
- **Timing:** an offline forced-alignment pipeline ([`song-align/`](../song-align/)) produces per-line
  `clip_start_ms`; the seed merges it. **Synced highlight + per-line replay light up once a song is
  timed.** (The maintainer has run alignment and confirmed it works.)
- **Still to build (client modes):** **Listen** (dictation) and **Shadow** (record-and-compare) are
  disabled stubs. Plus an in-app **tap-to-sync** editor for private BYO songs, the `songs` progress blob,
  and the inline Add-review editor.

This session added **8 commits** on top of `7b6306d` (the pre-session HEAD); newest first:

| Commit | What |
|---|---|
| `3e96ad2` | **Forced-alignment timing pipeline** (`song-align/`) + seed-timing ingest |
| `767d327` | Drop 故郷 + `deletePublicSong` (curator cleanup) |
| `e168565` | Curate the remaining **11 songs** (full analysis, authored via parallel subagents) |
| `80d3074` | Curate **ドライフラワー** — the pilot song (format + quality reference) |
| `17a8314` | Per-line **stanza sections** (Verse/Chorus/…) → Read viewer spacing |
| `a0b7544` | Wire **FIESTA** to its official JP-audio art-track |
| `42771d7` | Scaffold the 12 songs (oEmbed-verified YouTube ids) |
| `cf63d35` | Seed carries per-word **tokens** → public starters get Mine/coverage |

---

## What the feature is (one paragraph)

The 6th study-app tab. A song = a `song` metadata row (title/artist/youtube_id) + one **sentence-store
row per lyric line** (`owner_type='song'`), so lines reuse the furigana / tap-a-word / grammar /
translation machinery and the privacy gate. **Public** starter songs (`created_by=NULL`, anon-readable)
are the curated set; **private** BYO songs (`created_by=<user>`) come from the in-app Add flow. The audio
is **always** the embedded YouTube player — never re-hosted. Full design: [SONGS.md](SONGS.md). Server
side: [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md). Client side: [CLAUDE.md](CLAUDE.md)
(the 歌/Songs dead-end).

---

## The curated 12 (all public starters)

`wk-enhanced-api/data/songs/<slug>.json` — one file per song. All YouTube ids oEmbed-verified.

| slug | title | artist | note |
|---|---|---|---|
| `bandage-imazu` | BANDAGE | Ayumu Imazu | heavy English |
| `classic-imazu` | CLASSIC | Ayumu Imazu | heavy English |
| `blinded-eyes-imazu` | Blinded Eyes | Ayumu Imazu | mostly English |
| `dry-flower-yuuri` | ドライフラワー | 優里 | **pilot / format reference** |
| `betelgeuse-yuuri` | ベテルギウス | 優里 | |
| `mouichido-taniyuuki` | もう一度 | Tani Yuuki | |
| `hiraishin-taniyuuki` | 非lie心 | Tani Yuuki | title is a 避雷針 wordplay; official lyric video |
| `saikai-vaundy` | 再会 | Vaundy | literary; anime OP |
| `chikyugi-yonezu` | 地球儀 | 米津玄師 | Boy & the Heron theme |
| `tsukiwomiteita-yonezu` | 月を見ていた | 米津玄師 | FFXVI theme |
| `shiawase-inoue` | 幸せについて、僕が考えたこと | 井上絃 | |
| `fiesta-izone` | FIESTA (Japanese Ver.) | IZ*ONE | JP-audio art-track (no official JP MV) |

**Provenance / copyright posture (maintainer's decision this session):** these are copyrighted commercial
J-pop, curated as PUBLIC starters under the maintainer's fair-use / transformative-use stance for this
single-user deployment. This **overrides** the original SONGS.md "PD/CC only · no redistribution" posture
(that doc text is stale — see "Doc drift" below). **The lyric TEXT is maintainer-supplied** (pasted into
`~/Downloads/song-lyrics/<slug>.txt`); the furigana/EN/grammar/JLPT analysis is LLM-authored. **A future
session must NOT source/scrape/reproduce lyrics itself — only annotate text the maintainer provides.**

---

## New mechanisms shipped this session (the load-bearing ones)

### 1. Seed carries the full analysis (tokens) — `cf63d35`
The seed file's lyric line gained optional **`tokens`** (content words, in-order surfaces, no offsets) +
**`grammar`** (catalog ids) + **`section`**. `scripts/seed-songs.ts` computes UTF-16 offsets via the
**exported `offsetTokens`** from `services/songAnalyze.ts` (one routine, so a hand-authored seed token
can't drift from a model-authored runtime one). **Why it matters:** before this, public starters were
token-less → 0% coverage + empty Mine. Now they get the full Read **and** Mine experience.
Seed format contract: [`wk-enhanced-api/data/songs/README.md`](../wk-enhanced-api/data/songs/README.md).

### 2. Stanza sections — `17a8314`
A per-line optional **`section`** ("Verse 1" / "Chorus" / …), set ONLY on the first line of each stanza,
stored in the existing **`sentence_link.role`** column (already plumbed end-to-end via `compactLink` →
the served `link.role` — no schema change). `songs.js` `normalizeLine` surfaces it as `section`;
`readHtml` renders a faint stanza heading + opens the spacing. Untagged songs stay a flat list.

### 3. Forced-alignment timing pipeline — `3e96ad2` (the big one)
**`song-align/`** (repo root, the timing analog of `sentence-nlp/`) — **offline, local-only** (no Python
on prod): `yt-dlp` downloads the video's audio to a temp dir → `demucs` isolates vocals (`--no-vocals`
to skip) → **`stable-ts`** force-aligns the KNOWN curated lyric lines (`model.align(..., language='ja',
original_split=True)` → segment *i* == line ordinal *i*). Emits **`wk-enhanced-api/data/song-timing/<slug>.json`**
(a timing-only sidecar: `{lines:[{ordinal,startMs,endMs}]}`, **no lyric text**; audio discarded on exit).
`seed-songs.ts` merges the sidecar → each line's `clip_start_ms`. Sidecar contract:
[`wk-enhanced-api/data/song-timing/README.md`](../wk-enhanced-api/data/song-timing/README.md); pipeline
usage + the copyright posture: [`song-align/README.md`](../song-align/README.md). The aligner is
**swappable** (aeneas / WhisperX) — the sidecar shape is aligner-agnostic.

### 4. `deletePublicSong(extId)` — `767d327`
Curator cleanup, the inverse of `upsertPublicSong`: scoped to `created_by IS NULL` (can only touch curator
rows, never a user's private song) and **orphan-safe** (a line's sentence row is deleted only if no other
song still links it — reuse-by-hash can share a line across starters). Used to drop 故郷. Prod cleanup:
`bun -e "import('./src/db/client.ts').then(d=>d.deletePublicSong('song-furusato'))"`.

---

## ‼️ Gotchas / dead-ends — do NOT re-derive these

- **The in-app tap-to-sync `PUT /v1/songs/{id}/timing` is OWNER-SCOPED** (`created_by`). The 12 curated
  songs are PUBLIC (`created_by=NULL`), so they **cannot** be timed in-app — they must be timed via the
  **offline pipeline + seed** (`song-align/` → `data/song-timing/` → re-seed). The tap-to-sync UI (when
  built) is for **private BYO** songs only.
- **Synced highlight + per-line replay are ALREADY implemented** in `songs.js` (`highlightAt`, `playSlice`,
  `replayLine`). They were inert only for lack of `clip_start_ms`. Don't rebuild them — they light up when
  a song is timed + re-seeded. Mode #1 is effectively done.
- **`upsertPublicSong` already carries `clipStartMs`** onto the public `sentence_link` (the link is built
  before the public/private branch in `insertSongLine`). No repo change was needed for public timing.
- **Lyric sourcing boundary** (above): annotate maintainer-provided text only; never scrape/reproduce.
- **JLPT/POS subtlety:** the Mine panel + coverage only count `CONTENT_POS = {NOUN,PROPN,VERB,ADJ,ADV}`
  (`wk-enhanced-api/src/db/repos/songs.ts`). Pronoun tokens (PRON, e.g. 私/僕) are tappable but don't
  count as Mine vocab — some songs tokenized 僕/私 as NOUN to make them count; inconsistent but harmless.
- **The seed does NOT catalog-filter grammar ids** (the runtime analyzer does). A non-catalog id (e.g.
  `te-iku`, which slipped in once and was removed) would seed as a broken chip. There's a throwaway
  validator pattern in the build (`/tmp/validate-songs.mjs` — not committed) that checks furigana +
  offsets + grammar-catalog + POS across all song files at once; consider committing a version of it if
  curation continues.

---

## Validation findings still OPEN (catalogued, not yet fixed)

From the validation pass at the top of the session (the HIGH one — token-less public starters — was
fixed by `cf63d35`). Remaining, by severity:

- **MED — no client UI to edit-metadata or delete a song.** Server has `PUT /v1/songs/{id}` + `DELETE
  /v1/songs/{id}`; `songs.js` wires no edit/rename/delete action. Bites when curating/fixing.
- **MED — Add flow has no title/artist field**; relies on oEmbed (which returns the *channel*, not the
  artist), and saves "Untitled" on an oEmbed miss, unfixable in-flow.
- **LOW–MED — analyze caps at 120 lines** (`splitLyrics`) but persist allows 400 → silent truncation of
  very long songs.
- **LOW — the YouTube player remounts on every re-render** (mode switch, add-word) → re-buffers + loses
  position.
- **LOW — `goBrowseGrammar` is a dead button** (clicks the Browse tab without applying the grammar filter).

---

## What's left (prioritized)

1. **Finish timing the library** *(maintainer, local + deploy)* — `python3 song-align/align.py --all`,
   spot-check, `bun scripts/seed-songs.ts`, commit the sidecars, re-seed prod. (In progress.)
2. **Listen mode (dictation)** — SONGS.md "Listen". One mode, two difficulties via a toggle: **cloze**
   (line visible, key content words blanked — `clozeBlanks` pure helper to add in `core/songs.js`) ⇄
   **full-line** (hidden, transcribe). **Advisory grading only** (reuse `normKana`/`romajiToKana`, the
   typed-reading path); Reveal self-check; per-session correct count. Audio = the line's timed slice
   (`playSlice`) when timed, else synth (`playItem(...,'songs')`). Renders into `#sgBody`; wire a
   `mode==='listen'` branch in `songs.js` `songHtml` + enable the disabled Listen button.
3. **Shadow mode (record & compare)** — SONGS.md "Shadow". Reuse the record-compare engine verbatim with
   **reserved `SONGS_SCOPE = 80000`** + itemKey `"<extId>:<ordinal>"` (`songLineKey`, already in
   `core/songs.js`). Navbar speaking bar (`speakingBarHtml`/`wireSpeakingControls`/`initMicSelector`),
   per-line `recordControlHtml(SONGS_SCOPE, "<ext>:<ord>", '', null, false, plainText(lineJp), 'songs')`.
   Reference tiers: **TTS** (full rig) + **YouTube-slice** (by-ear, timed lines only — iframe audio can't
   be decoded, so no waveform/▶both). Saving a take → `applyPractice` (day-streak) + the `songs` blob.
   `'songs'` audio context already exists in `core/audio.js`. **Largest build.**
4. **In-app tap-to-sync editor** *(for private BYO songs)* — play the video, tap as each line begins →
   `PUT /v1/songs/{id}/timing`. Generalizes the Minna clip-marker. (Curated set is timed offline; this is
   the BYO path.)
5. **`songs` synced progress blob** — `createSyncedBlob`, app key `songs`, `{progress:{"<extId>":
   {starred,shadowed,lastMode,lastLine}}}`. Deferred to Shadow (where stars/shadowed accrue).
6. **Inline Add-review editor** — edit flagged lines before save (the flags guide a re-analyze for now).
7. **Doc drift cleanup** (below).
8. **The open validation findings** above (edit/delete UI, etc.).

---

## Doc drift to fix

- **SONGS.md** "Account-gating & copyright posture" still says **"genuinely CC / public-domain / Vocaloid"
  + "we do not redistribute copyrighted lyrics"** — now contradicted by the maintainer's public-curated
  decision. Its phase checklist also predates this session's curation + timing work. (Partially updated;
  finish it.)
- The `[ ]` boxes for Phase 4/5 in SONGS.md need the timing-pipeline + synced-highlight progress reflected.

---

## How to verify / deploy

- **Server:** `cd wk-enhanced-api && bun test` (song repo + routes + analyze + seed-token/section/timing
  pins) + `bun run typecheck`. Full suite was **297 green** at handoff.
- **Client:** `cd study-app && bun run test` (204) + `bun run build`.
- **Data integrity:** `bun scripts/seed-songs.ts` re-validates every line's furigana (`concat===text`) and
  recomputes every token offset (`slice===surface`) — it aborts on a bad line and names it. The library
  GET (`/v1/songs`, anon-OK) exposes per-song words + JLPT; `/v1/songs/{id}` exposes furigana/EN/grammar/
  tokens + `link.clip_start_ms` + `link.role` (section).
- **Preview caveat:** `:5173` is the maintainer's own running Vite — **do NOT restart it / `:3000`**
  (project rule). Drive the already-running preview, or verify via the API with `curl`/DOM `eval`.
- **Deploy:** data lives in the DB; the repo holds `data/songs/*.json` + `data/song-timing/*.json`. To
  ship to prod, re-run `bun scripts/seed-songs.ts` against the prod DB (droplet pattern), then
  `deletePublicSong('song-furusato')` on prod. No `ANTHROPIC_API_KEY` needed (curated, not runtime-analyzed).

---

## Cold-start reading order for the next session

1. **This file** — current state + what's left + gotchas.
2. [SONGS.md](SONGS.md) — the design (four modes, data model, reuse map). Note the stale posture/checklist.
3. [CLAUDE.md](CLAUDE.md) 歌/Songs dead-end + [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md)
   Songs entries — architecture + invariants (UTF-16 offsets, privacy gate, etc.).
4. Code: `wk-enhanced-api/src/db/repos/songs.ts` (+ `.test.ts`), `scripts/seed-songs.ts`,
   `services/songAnalyze.ts`; `study-app/src/features/songs.js` (+ `songs-youtube.js`),
   `src/core/songs.js`; `song-align/align.py`.
