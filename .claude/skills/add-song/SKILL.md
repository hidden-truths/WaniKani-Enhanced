---
name: add-song
description: Add or curate songs in the 日常日本語 study app's 歌/Songs library — the curated starter pipeline (curate-song.ts, analyze → seed file → song-align timing → seed-songs.ts), the in-app Add flow, per-line timing, per-song progress, prod seeding, copyright rails. Use for ANY song or lyric content work — adding a song, fixing a song's furigana/translation/tokens/timing, a song missing on prod, Songs-tab content bugs, or "add 〜 to the song library" requests.
---

# Add or curate songs (歌 / Songs)

You are adding or fixing content in the study app's 歌/Songs tab — the authentic-input surface
that turns a real song into Read / Listen / Shadow / Mine practice. This skill keeps you on the
one-command curation pipeline, inside the copyright rails, and away from the timing and prod-seed
traps. All paths below are repo-relative from the repo root.

Status as of 2026-07: the surface is feature-complete for v1 — all four modes shipped, a 12-song
curated starter library ALL fully timed, song edit/delete + manual Add title/artist (2026-06-22),
and prod serves the full timed library (verified live 2026-07-06). Open residue lives in
`ROADMAP.html` under the `songs-` ids (see Traps).

## Before you start

1. Read `study-app/SONGS.md` — the living technical authority for the whole surface (both halves:
   study-app frontend + wk-enhanced-api server). At minimum read its status block, "Data model",
   "Account-gating & copyright posture", and "Verifying Songs changes".
2. Read `wk-enhanced-api/data/songs/README.md` — the seed-file format + the "Adding a song — one
   command" section. Don't re-derive the JSON shape; that README is the contract.
3. Curator-path preconditions (check each before running anything):
   - **Lyrics as a local `.txt` file, supplied by the maintainer.** One lyric line per text line.
     You annotate maintainer-provided text ONLY — never source, scrape, or reproduce lyrics
     yourself (see Copyright rails).
   - `ANTHROPIC_API_KEY` set in `wk-enhanced-api/.env` (the analyze step is a Claude call; without
     the key `curate-song.ts` dies with a hint).
   - For timing: the `song-align/` Python venv installed (`song-align/README.md` "Install") and a
     browser logged into YouTube for the yt-dlp cookie handoff. Timing is optional — a song seeds
     and works untimed (Read + Mine only).
   - A local DB to seed into: `wk-enhanced-api/.env`'s `DATABASE_FILE` (run the API once via
     `bun dev` if the file doesn't exist yet).

## Which path?

| Situation | Path |
|---|---|
| "Add song X to the library" (the maintainer asks; lyrics supplied) | **Curator path** below — public starter rows, visible to anon |
| A signed-in user adding their own song from the UI | **In-app Add flow** — private rows; nothing for you to run (see below) |
| Fix content in an existing starter (typo, furigana, gloss, grammar tag, section) | Edit `wk-enhanced-api/data/songs/<slug>.json` by hand → re-run `bun scripts/seed-songs.ts` → commit. No re-analysis needed |
| Fix/redo timing for an existing starter | Re-run `song-align/align.py --song <slug>` (or hand-nudge `startMs` in the sidecar) → re-seed → commit |
| Songs-tab *behavior* bug (render, player, sync) | Not this skill — `study-app-dev` for client code, `api-dev` for `/v1/songs*`, `troubleshoot` for symptoms |

## The curator path — one command

`wk-enhanced-api/scripts/curate-song.ts` chains the whole pipeline: **analyze → write seed file →
time → seed**. Run it from `wk-enhanced-api/` (so `.env` loads):

```bash
cd wk-enhanced-api
bun scripts/curate-song.ts \
  --slug gurenge-lisa --title 紅蓮華 --artist LiSA \
  --url 'https://www.youtube.com/watch?v=<id>' \
  --lyrics ~/Downloads/song-lyrics/gurenge-lisa.txt \
  --browser safari
```

- `--slug` is required, kebab-case `[a-z0-9-]+` — it becomes the file name AND the song's stable
  `ext_id` (`song-<slug>`), which keys record-compare takes and the Source-facet token. Choose it
  once, correctly; it's effectively immutable after users accrue progress against it.
- `--url` is required if you want timing (the align step dies without it); `--browser
  safari|chrome|firefox|...` passes yt-dlp `--cookies-from-browser` for YouTube's bot check.
- Useful flags: `--dry-run` (validate + print plan, no writes) · `--no-align` / `--no-seed` (skip a
  step) · `--no-vocals` (skip demucs; faster, rougher alignment) · `--force` (re-analyze +
  overwrite an existing seed file — without it an existing `data/songs/<slug>.json` is REUSED, so
  re-timing/re-seeding never re-pays for analysis).

What it does, step by step (each step is also runnable standalone):

1. **Analyze** — `analyzeLyrics` (`wk-enhanced-api/src/services/songAnalyze.ts`) sends the lines to
   Claude with forced tool-use; per line it gets furigana segments, English, grammar-catalog ids,
   and content-word tokens. The model returns tokens IN ORDER with NO offsets — the server computes
   UTF-16 offsets itself (never trust an LLM to count code units). Lines failing the furigana
   byte-exact check or self-flagged by the model come back flagged. **Analyze caps at 120 lines**
   (`MAX_LINES` in `songAnalyze.ts`, as of 2026-07) — see Traps for long songs.
2. **Write** — the pure `analyzedToSeedFile` writes `wk-enhanced-api/data/songs/<slug>.json` in the
   seed format (ruby `jp`, optional `en`/`grammar`/`tokens` per line). This is the git-tracked
   authoring artifact; the DB is derived from it.
3. **PROOFREAD** — the CLI prints every flagged line (`‼ N line(s) flagged — PROOFREAD these`).
   This is the CLI analog of the Add-flow review screen. Fix the flagged lines in the seed file
   directly. The analysis is model-generated: the maintainer expects flagged lines checked by a
   human before the content is study-trusted — say so in your summary, and spot-check a few
   UNflagged lines too (validation catches structure, not naturalness).
4. **Time** — shells `song-align/align.py --song <slug>` (yt-dlp audio → demucs vocal isolation →
   stable-ts FORCED alignment of the known lyrics, one segment per line) → writes the sidecar
   `wk-enhanced-api/data/song-timing/<slug>.json` (`{lines:[{ordinal,startMs,endMs}]}`; `endMs` is
   advisory — the app infers a line's end from the next line's start). Alignment failure is
   NON-fatal: curate-song warns and the song seeds untimed; fix cookies/JS-runtime per
   `song-align/README.md` and re-run (the existing seed file is reused).
5. **Seed** — runs `bun scripts/seed-songs.ts`, which loads EVERY `data/songs/*.json`, validates
   each line (furigana concat === plainText; token offsets computed via the SAME `offsetTokens`
   the runtime analyzer uses), merges any timing sidecar, and upserts via `db.upsertPublicSong`
   (idempotent by `ext_id`, reuse-by-hash per line). Logs
   `seeded N starter song(s) (M lines, K timed)`.
6. **Optional polish** — stanza `section` labels ('Verse'/'Chorus'/…) are NOT auto-detected;
   hand-add `"section"` on the FIRST line of each stanza in the seed file for Read-viewer spacing,
   then re-seed.

Then verify (below), and commit BOTH artifacts — `wk-enhanced-api/data/songs/<slug>.json` +
`wk-enhanced-api/data/song-timing/<slug>.json` — as one logical change (see `land-a-change`).

## What the pipeline produces (data model in brief)

A song is a `song` table row (metadata: `ext_id`, title, artist, `youtube_id`, public/visibility)
plus **one sentence-store row per lyric line** — `sentence_link(owner_type='song',
owner_id=<ext_id>, ordinal=<line index>, clip_start_ms)`. Furigana lives on the sentence row,
English in `translation`, grammar ids in `sentence_tag(kind='grammar')`, tap-word tokens in
`sentence_annotation` (`parser='llm:<model>'` — songs are the store's first RUNTIME annotation
writer; deliberate, don't revert to offline-only). Starters: `public=1, created_by=NULL`. Reads go
through the `getSentences` privacy gate like everything else in the store.

Client split you must preserve: **content is server-authoritative** (fetched from
`GET /v1/songs/{id}`); the synced `songs` blob carries PROGRESS ONLY
(`{progress:{"<extId>":{starred,shadowed,lastMode}}}`, 409-merged by union via `mergeSongs`).
Never put line text/furigana/timing in the blob. Mined vocab lives in `custom-verbs` as tagged
cards, not in the songs blob.

Server endpoints (all under the study-app credentialed CORS; verify against
`wk-enhanced-api/src/routes/songs.ts`): `GET /v1/songs` and `GET /v1/songs/{id}` (anon-OK, gated
rows) · `POST /v1/songs/analyze` (account; **503 `{code:'service_unavailable'}`** without
`ANTHROPIC_API_KEY`) · `GET /v1/songs/oembed?url=` (account; title/artist auto-fill) ·
`POST /v1/songs` (account; upsert by ext_id) · `PUT /v1/songs/{id}` + `PUT /v1/songs/{id}/timing`
+ `DELETE /v1/songs/{id}` (owner-scoped).

## The in-app Add flow (the user path — for context)

Paste lyrics + a YouTube URL → `POST /v1/songs/analyze` → review flagged lines →
`POST /v1/songs` persists a PRIVATE song (`usr-<uuid>` ext_id, `created_by=<user>`). Same
analysis code path as the curator CLI; the difference is visibility (private vs public) and the
review UI (inline editing there is still an open item, `songs-inline-add-review`). BYO private
songs are timed IN-APP via the tap-to-sync editor — which is itself still an open item
(`songs-byo-timing-editor`), so as of 2026-07 only the offline pipeline produces timing.

## What your content feeds (the four modes + mining)

- **Read** — lyric viewer: global furigana flip, per-line reveal-on-tap English, tap-a-word over
  the tokens, grammar chips; synced highlight + per-line replay light up once timed.
- **Listen** — per-line dictation stepper, cloze ⇄ full-line, advisory grading; audio is the timed
  YouTube slice (or synth when untimed); the video is masked so a lyric-burned MV can't spoil it.
- **Shadow** — record-and-compare engine verbatim: `SONGS_SCOPE = 80000` (reserved — never reuse
  for a Minna lesson 1–50 or Self-Talk 90000), itemKey `songLineKey(extId, ordinal)`
  (`study-app/src/core/songs.js`). TTS reference = full rig; YouTube-slice reference = by-ear only
  (an iframe's audio can't be decoded — no waveform/overlay, by design). A saved take marks the
  line shadowed (library progress ring) + the shared day-streak.
- **Mine** — vocab by JLPT, known vs new, per-word/bulk add → dictionary-form custom cards via
  `buildSongCard` (tags `['歌','song-<extId>','custom']`, `song:true`), deduped by
  `songCardKey(songExtId, lemma)`; grammar points + counts → the grammar reference.

Mine/coverage/tap-a-word all need line `tokens`; a line without tokens still seeds and renders
plain ruby but contributes nothing to Mine. The curated analyze step always produces tokens.

## Copyright rails (non-negotiable)

- **The lyric TEXT is maintainer-supplied, pasted in — never scraped.** A contributor/agent
  annotates provided text only. If you're asked to add a song and no lyrics file exists, ask for
  one; do not fetch lyrics from the web.
- Starter set = public rows: the maintainer's fair-use / transformative-use call for this
  single-user deployment (furigana/EN/grammar/JLPT/timing are the transformative layer). This
  superseded the earlier "PD/CC only" framing — don't re-litigate either way; it's a recorded
  decision in `study-app/SONGS.md` "Account-gating & copyright posture".
- BYO songs are PRIVATE per-user rows; authoring/recording/progress require an account.
- **No re-hosting**: master audio is always the embedded YouTube player. `song-align` downloads
  audio to a temp dir, aligns, and DISCARDS it; the committed sidecar is timing-only (ordinals +
  milliseconds, no lyric text). The only stored audio is the user's private takes + cached TTS.

## TTS reality for song lines (verified, don't claim otherwise)

`wk-enhanced-api/scripts/collectTtsTexts.ts` — the single enumeration behind TTS pre-generation +
the voice-variants manifest — does **NOT** enumerate song lines (as of 2026-07 it covers card
readings, built-in/Minna examples, Self-Talk phrases + template combos, and N3 grammar examples;
confirm with `grep -in song wk-enhanced-api/scripts/collectTtsTexts.ts`). So song lines have no
pre-generated Siri clips: Shadow's TTS reference and untimed-Listen synth resolve lazily through
`GET /v1/audio/tts` → Google TTS, persisted to storage on first play. There is no "TTS seed step"
for songs — don't invent one. (Extending the enumeration to song lines would be a
`collectTtsTexts.ts` change + a regen/manifest pass — a roadmap item, not a quick fix.)

## Verify

Lifted from `study-app/SONGS.md` "Verifying Songs changes" + the curator additions:

1. Seed output: `seeded 13 starter song(s) (… lines, … timed)` — your song's lines counted, timed
   count matching the sidecar (starter count derives live: `ls wk-enhanced-api/data/songs/*.json |
   wc -l`, 12 before your add as of 2026-07).
2. `cd wk-enhanced-api && bun test` green (song repo + routes + analyze run against a MOCKED
   Anthropic client — no live key needed) and, if you touched client code,
   `cd study-app && bun run test && bun run build` green.
3. In the running app (`./dev.sh` from repo root, or the `.claude/launch.json` `study-app` +
   `wk-enhanced-api` configs): the library shows the song with a coverage % and a
   `synced · N lines` badge (`not timed yet` if you skipped alignment). **Drive the
   already-running preview — do NOT restart :5173/:3000** (standing rule); the preview reloads on
   capture, so assert transient state (open song, active mode) via DOM eval, not a follow-up
   screenshot.
4. Spot-check timing against the video: open the song, play a few lines — the highlight should
   land on the sung line. Sung vocals, long held notes, and English hooks are where alignment
   drifts; re-run with `--model large-v3` / toggle vocals, or hand-nudge `startMs` in the sidecar,
   then re-seed (`song-align/README.md` "Workflow").
5. Read renders furigana + reveal-on-tap EN; Mine lists words by JLPT; tap-a-word pops.

## Prod

Local seeding never touches prod. To ship the song: commit the two data files, then on the droplet
pull + re-run the seed. The exact invocation is in `wk-enhanced-api/deploy/README.md` "歌/Songs
starter library" — route to the `deploy-prod` skill for the full runbook. Two things that bite:

- **`seed-songs.ts` on the droplet REQUIRES `-e NODE_PATH=/app/node_modules`** on the
  `docker compose run` (it transitively imports `@anthropic-ai/sdk` via `offsetTokens` from
  `songAnalyze.ts`; the mounted host repo has no `node_modules`, so the bare
  seed-sentences-style invocation fails with "Cannot find module '@anthropic-ai/sdk'"). Plus the
  usual `ENV_FILE`/`DATA_DIR` env-prefix gotcha — without them you'd seed the WRONG DB.
- Run it AFTER `seed-sentences.ts` and BEFORE `seed-annotations.ts` in a full seed sequence.

Verify prod with a plain GET: `curl -s https://api.wkenhanced.dev/v1/songs` should list the
starters with `lineCount`/`timedCount`, and the apex `https://wkenhanced.dev` library should
render them. (Verified 2026-07-06: prod serves all 12 starters fully timed — if a roadmap record
still says a songs prod re-seed is pending, re-probe before acting on it.)

## Traps

- **`PUT /v1/songs/{id}/timing` is OWNER-scoped, and starters have no owner** (`created_by=NULL`)
  — the public curated set can NEVER be timed in-app. Offline pipeline + re-seed is the only
  timing path for starters. Don't burn time trying to make the tap-to-sync UI do it.
- **yt-dlp gates**: "Sign in to confirm you're not a bot" → pass `--browser <b>`
  (`--cookies-from-browser`; Safari's cookie file is TCC-protected, so the terminal needs Full
  Disk Access). "Requested format is not available" → the player JS challenge; needs `yt-dlp-ejs`
  + a JS runtime (`align.py` passes `--js-runtimes node` by default; `brew install deno` or
  Node ≥22). Keep `yt-dlp`/`yt-dlp-ejs` current — countermeasures shift. Full detail:
  `song-align/README.md`.
- **Analyze caps at 120 lines but persist allows 400** (`songAnalyze.ts` vs
  `wk-enhanced-api/src/schemas/songs.ts` `MAX_LINES`, as of 2026-07) — a known mismatch, open as
  `songs-analyze-line-cap` in `ROADMAP.html`. A >120-line song can't be analyzed in one pass;
  don't "fix" the cap ad hoc — check the record first.
- **A seed file with `lines: []` is a scaffold** — seed-songs skips it (logged
  `skip <file>: no lines yet`). If a song "won't seed", check for empty lines first.
- **Line `ordinal` = array index**, and the wire format (`compactLink`) drops a falsy ordinal 0 —
  consumers must default absent → 0. Never reorder lines in a seed file of a shipped song
  casually: ordinals key timing, stars, shadowed-line progress, and record-compare takes.
- **The furigana invariant is byte-exact**: `concat(seg.t) === plainText(jp)`. Hand-editing ruby
  in a seed file and breaking it aborts the seed with the offending file+line named. Token
  surfaces must appear in-order in the line text or the seed aborts likewise.
- **The YouTube IFrame API is a necessary external dep that degrades gracefully** — Read + Mine
  must work if it never loads; don't add a hard dependency. Its audio is undecodable (Shadow's
  by-ear constraint). Known open wart: the player re-mounts on Read⇄Mine switches
  (`songs-youtube-remount`, partial); Listen/Shadow deliberately re-render into the stable
  `#sgContent` wrapper so the player survives stepping — don't "tidy" that.
- **Songs client glue drops stale async opens on purpose** — `S.nav` (a navigation epoch in
  `study-app/src/features/songs/state.js`, bumped by `bumpNav()` on every view change) is compared
  when an in-flight `openById` resolves; a mismatch silently discards the result. If a song "fails
  to open" after fast navigation, that's the epoch working, not a bug. Same package convention:
  Listen/Shadow re-render `#sgContent` only, the shared `S` is mutated in place — read the songs
  dead-end block in `study-app/CLAUDE.md` before touching `features/songs/`.
- **Model-generated content wants human proofread** — furigana/token validation is structural,
  not semantic. Flag your additions for the maintainer's review in your summary (same posture as
  the grammar catalog; see `content-gap-audit` for the proofread ethos).
- Residue by design (check `ROADMAP.html` before building): `songs-byo-timing-editor` (in-app
  tap-to-sync for private songs), `songs-inline-add-review` (edit lines in the Add review
  screen), `songs-upload-reference` (blocked), `songs-section-labels` (idea). Recording new
  follow-ups goes through the `roadmap` skill — never a new status .md.

## Ground truth (re-verify here before updating this skill)

- `study-app/SONGS.md` — the living authority: architecture, data model, modes, copyright
  posture, dead-ends, phase record, "Verifying Songs changes".
- `wk-enhanced-api/data/songs/README.md` — seed-file format + the one-command walkthrough;
  `wk-enhanced-api/data/song-timing/README.md` — sidecar format.
- `song-align/README.md` — timing-pipeline install/use/yt-dlp gotchas; `song-align/align.py`.
- Scripts: `wk-enhanced-api/scripts/curate-song.ts` (+ `.test.ts`),
  `wk-enhanced-api/scripts/seed-songs.ts`, `wk-enhanced-api/scripts/collectTtsTexts.ts`.
- Server: `wk-enhanced-api/src/routes/songs.ts`, `src/schemas/songs.ts`,
  `src/services/songAnalyze.ts`, `src/db/repos/songs.ts`; client:
  `study-app/src/features/songs/` + `study-app/src/core/songs.js`; tests:
  `study-app/test/songs-render.test.js`, the three server `songs*`/`songAnalyze` test files.
- `wk-enhanced-api/deploy/README.md` "歌/Songs starter library" (prod seed command);
  `ROADMAP.html` `songs-*` records (open items + shipped record).
- As-of-2026-07 facts baked in above: 12 starters all timed; prod fully seeded (probed
  2026-07-06); analyze cap 120 / persist cap 400; collectTtsTexts has no song enumeration.
