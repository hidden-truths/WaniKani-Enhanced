# 歌 / Songs — song & lyric analysis surface

The **source of truth for the 歌 / Songs surface** — the 6th tab in the study app. Where the rest
of the app trains recognition (flashcards, Browse, みんなの日本語) and output (独り言 Self-Talk),
Songs adds the **authentic-input** surface those miss: turn a real song into **listening, reading,
and speaking** practice. You bring a song (paste its lyrics + link the video), one analysis pass
turns the raw lyrics into furigana + per-line English + grammar tags + a JLPT profile, and then the
song becomes four practice modes — **Read · Listen · Shadow · Mine**.

This feature spans **both** halves of the codebase, like みんなの日本語. This doc ties them together;
the layer-specific docs point back here.

- **Frontend** (the tab): [index.html](index.html) `#panel-songs` + [src/features/songs.js](src/features/songs.js)
  + [src/features/songs-youtube.js](src/features/songs-youtube.js) + pure logic in
  [src/core/songs.js](src/core/songs.js) + Songs styles in [src/styles.css](src/styles.css).
- **Server** (song store + analysis): [../wk-enhanced-api/src/routes/songs.ts](../wk-enhanced-api/src/routes/songs.ts),
  [../wk-enhanced-api/src/services/songAnalyze.ts](../wk-enhanced-api/src/services/songAnalyze.ts),
  [../wk-enhanced-api/src/db/repos/songs.ts](../wk-enhanced-api/src/db/repos/songs.ts).
- **Closest analogs it reuses** (NOT re-implemented): 独り言 Self-Talk [SELFTALK.md](SELFTALK.md)
  (anon-readable public rows + account-gated private authoring + store rows + grammar tags + the
  reserved record-compare scope + the day-streak) and みんなの日本語 [MINNA.md](MINNA.md)
  (content tab + the clip-marker timing pattern + vocab activation + the Source facet).

> **Status (2026-06-16): All four modes shipped — Library + Add + Read + Mine + Listen + Shadow;
> a 12-song curated library + offline line-timing (synced highlight + per-line replay); and the
> `songs` synced progress blob — shadowed-line tracking → library progress ring, per-line stars, and
> last-mode resume — shipped (completes Shadow).**
> Remaining follow-ups: the in-app tap-to-sync editor (private BYO timing) + the inline Add-review
> editor. The
> current state, the shipped commits, the new mechanisms, the open gotchas, and the prioritized
> what's-left live in **[SONGS_HANDOFF.md](SONGS_HANDOFF.md)** — read it first for a cold start. The
> [Phase checklist](#phase-checklist--cross-session-tracker) at the bottom is the live tracker. The
> UX is locked by the mockups in [mockups/songs/](mockups/songs/) (open `index.html`) and the memory
> note `song-lyric-tab-design`; this doc is the **technical** source of truth.

---

## Why it exists

WaniKani + the verb trainer cover recognition; Self-Talk covers scripted output. Neither gives you
**real Japanese the way a learner actually wants to absorb it** — a song you like, heard enough times
to internalize, read closely once, then sung along to. A song is dense authentic input: colloquial
grammar, real vocabulary in context, natural prosody to shadow. Songs is the surface that turns "a
song I like" into structured listening / reading / speaking practice, with its vocabulary flowing
into the SRS deck (so a word you met in a lyric is never studied just once) and its grammar
cross-linking into Self-Talk and the example corpus.

---

## How it works (end to end)

```
 Tab click ─► renderSongs()                              [features/songs.js]
              │  GET /v1/songs            → library: your private songs + public starters
              ▼
        Library grid (song cards: coverage %, progress ring, source badge)
              │
   Add  ──────┼─► paste lyrics + YouTube URL
              │     POST /v1/songs/analyze  ──► songAnalyze.ts ──► Claude (Anthropic)
              │        per line: furigana[{t,r}] · English · grammar[catalogId] · tokens · flags
              │        server VALIDATES each line (furigana concat===text; token UTF-16 slice===surface)
              │     review/edit the flagged lines  ─►  POST /v1/songs   (persist)
              │        → song row + one `sentence` row per line (private) + links + translations
              │          + grammar tags + `sentence_annotation` tokens (provenance llm:<model>)
              ▼
        Open a song ─► GET /v1/songs/{id}   → meta + ordered lines (furigana/en/grammar/tokens/clip)
              │
   Read   ───┤  lyric viewer: furigana flip · reveal-on-tap English · tap-a-word → card/Jisho
              │   · grammar chips → grammar reference · (synced highlight once timed)
   Listen ───┤  dictation: cloze (blank key words) ⇄ full-line (hidden, transcribe) · advisory grade
   Shadow ───┤  navbar speaking bar + per-line record-and-compare (reference = TTS / YouTube-slice)
   Mine   ───┘  vocab by JLPT (known vs new) → bulk-add to SRS under Source:〈song〉; grammar points
                 with counts → reference + cross-links + "save line as a Self-Talk shadow phrase"
```

The **audio is the embedded YouTube video** (IFrame Player API) — we never re-host the master. The
**lyrics you paste are private** to your account; only the curated starter set is public.

---

## The analysis pipeline (the one genuinely new capability)

Nothing in the app turns *arbitrary* Japanese into furigana + translation + grammar at runtime today:
the GiNZA NLP that produces tap-to-lookup tokens is **offline-only** (no Python on prod), and all
existing user content is hand-authored clean ruby. Songs needs to analyze lyrics a user just pasted.
**Decision (maintainer): a server LLM endpoint using Claude.** It's the only option that yields the
English translation + catalog grammar tags + per-word JLPT the modes need, and it matches the
mockup's "full-auto analysis with a proofread step."

**`POST /v1/songs/analyze`** (account-gated) — `src/services/songAnalyze.ts`:

1. **Prompt** = the lyrics (one line per lyric line) + the generated 38-pattern grammar catalog
   (`data/grammar.json`, the SAME ids the Browse grammar facet + Self-Talk teach) + the structured
   output contract (furigana segments; UTF-16 token offsets; tag ONLY from the catalog).
2. **Model** = the latest cost-appropriate Claude (`ANTHROPIC_MODEL`, overridable), via
   `@anthropic-ai/sdk`, structured JSON / tool-use so parsing can't drift.
3. **Per line, returns:** `{ idx, text, furigana:[{t,r?}], en, grammar:[catalogId…],
   tokens:[{start,end,surface,lemma,reading,pos,jlpt}], confidence, flags:[…] }` + a song-level
   profile `{ jlpt, grammarCount, lineCount }`.
4. **Validation (server-side, reuses the store's existing invariants):** each line's furigana must
   reconstruct the text byte-for-byte (`concat(seg.t) === text`, via `assertFuriganaMatches`); each
   token's `text.slice(start,end) === surface` in **UTF-16 code units** (NOT codepoints — the
   non-BMP trap, see the offset dead-end in [../wk-enhanced-api/CLAUDE.md](../wk-enhanced-api/CLAUDE.md)).
   A line that fails validation, or that the model self-flags, gets a `flag` → surfaced in the
   review screen so the proofread is **targeted** (a few flagged lines, not all 42).
5. **Infra gate:** the endpoint needs `ANTHROPIC_API_KEY` in the server env. Built behind the key so
   it merges without one — **`503 {code:'analysis_unavailable'}`** when the key is absent — and
   "lights up" once the operator provisions it (the same rollout shape as the Siri voices). Cost is
   ~pennies per song, paid once at analyze time (an explicit user action, not per-render).

**Title & artist auto-fill** comes from a keyless **`GET /v1/songs/oembed?url=`** proxy over
YouTube's oEmbed endpoint (avoids a client CORS dance).

This is the central build. Everything downstream (Read/Listen/Shadow/Mine) consumes its output from
the store; nothing re-analyzes at render time.

---

## Data model

### Server — a song is a `song` row + one `sentence` row per line

A song's lines live in the **unified sentence store** (the same store Self-Talk phrases + card
examples use), so they render through the existing furigana / tap-a-word / grammar paths for free.
The song's *metadata* gets its own small table — mirroring `sentence_template`, which is also a
non-sentence entity.

**`song` table** ([../wk-enhanced-api/src/db/schema.sql](../wk-enhanced-api/src/db/schema.sql)):

| Column | Notes |
|---|---|
| `id` | PK |
| `ext_id` | stable external id — `usr-<uuid>` (private, mine) or `song-<slug>` (public starter). The record-compare itemKey prefix + the Source-facet token suffix. |
| `title`, `artist` | header; auto-filled from oEmbed, editable |
| `youtube_id` | parsed from the pasted URL; the embed source |
| `source` | `'song'` |
| `public` | 1 = export/anon eligible (starters); 0 = private (mine) |
| `visibility` | `'public'` \| `'private'` |
| `created_by` | NULL = curator (starters); `<user_id>` = private owner |
| `created_at` | epoch ms |

Plus a **`public_song`** view (`public=1 AND visibility='public'`) mirroring `public_sentence`.

**Each lyric line = one `sentence` row** linked via the existing **`sentence_link`** table:

```
sentence_link( owner_type='song', owner_id=song.ext_id, ordinal=<lineIndex>,
               clip_start_ms?, clip_end_ms? )
```

- `ordinal` = line order. `clip_start_ms`/`clip_end_ms` = **per-line timing** (already columns on
  `sentence_link` — no schema change needed for timing). End is inferred from the next line's start
  when only starts are marked.
- Furigana → `sentence.furigana` (`[{t,r?}]`). English → `translation`. Grammar →
  `sentence_tag(kind='grammar', value=<catalogId>)`. Tokens → **`sentence_annotation`**
  (`tokens` JSON, `parser='llm:<model>'`).
- The **`ownerType` enum** in [../wk-enhanced-api/src/schemas/sentences.ts](../wk-enhanced-api/src/schemas/sentences.ts)
  widens from `['selftalk','card']` to add `'song'`. `owner_type` is free TEXT in the DB, so the
  column itself doesn't change. Song-line reads go through the **`getSentences` privacy gate
  verbatim** (`(public=1 OR created_by=:viewer)`).

> **Songs are the first runtime writer of `sentence_annotation`.** Until now, annotations were
> computed only offline by GiNZA (no Python on prod) and the table was read-only in production. Song
> tokens come from the LLM at analyze time and are written with `parser='llm:<model>'`. This is a
> deliberate, **validated** extension of that posture — justified because song lines are
> private/curated rows *outside* the public GiNZA corpus, and `upsertAnnotation`'s
> `text.slice(start,end)===surface` (UTF-16) assertion still guards every offset. Don't "fix" it back
> to offline-only.

### Client — content from the store, progress in one light blob

- **Song content** (lines, furigana, timing) is **server-authoritative** — fetched from
  `GET /v1/songs/{id}`, cached read-through in `localStorage["jpverbs_songs_cache"]` (degrade-offline,
  like the Self-Talk phrase cache). Timing edits go back via `PUT /v1/songs/{id}/timing`.
- **Per-song progress** is one synced blob, app key **`songs`** (the 6th sync trio,
  `createSyncedBlob`):
  `{ progress: { "<songExtId>": { starred:[ord…], shadowed:[ord…], lastMode } } }` —
  *progress only*, mirroring Self-Talk's `{practice}`-only blob (blobs = per-user signals; the store
  = sentence text). `shadowed` drives the library **progress ring** (`songProgress` = shadowed/lines);
  `starred` is per-line bookmarks (Read); `lastMode` is the resume cursor (`read`/`listen`/`shadow`/
  `mine`). **`lastLine` (scroll-to-line resume) was dropped** — nothing reads it; the shape is the
  three live fields. Word **coverage %** is computed live against the deck, not stored.
- **Mined vocab** lives in `jpverbs_custom` as tagged cards (the vocab-activation path), **not** in
  the songs blob — exactly as みんなの日本語 vocab lives in `custom-verbs`, not in the `minna` blob.

| Where | Key | Shape |
|---|---|---|
| server | `song` table + `sentence`/`sentence_link`/`sentence_tag`/`sentence_annotation` | the song + its lines |
| localStorage + synced app `songs` | `jpverbs_songs` | `{ progress:{ "<ext_id>": {starred,shadowed,lastMode} } }` |
| localStorage (read-through cache) | `jpverbs_songs_cache` | last-fetched library + open-song lines |
| localStorage + synced app `custom-verbs` | `jpverbs_custom` | mined vocab as tagged cards (Source:〈song〉) |

---

## Server endpoints

All are **study-app routes** (origin-scoped credentialed CORS, like `/v1/sentences`). Reads are
anon-OK for public starters + the caller's own private songs (the `getSentences` gate); writes
require an account.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/songs` | anon-OK | Library: public starters + caller's private songs (metadata + coverage inputs). |
| GET | `/v1/songs/{id}` | anon-OK (gated rows) | One song: meta + ordered lines (furigana, English, grammar, tokens via `annotate=1`, clip timing). |
| POST | `/v1/songs/analyze` | account | **The LLM pass.** Lyrics + URL → per-line furigana/English/grammar/tokens/flags + profile. `503` without `ANTHROPIC_API_KEY`. |
| GET | `/v1/songs/oembed?url=` | account | Keyless YouTube oEmbed proxy → `{ title, author }` for auto-fill. |
| POST | `/v1/songs` | account | Persist a reviewed analysis: song row + sentence rows + links + translations + grammar tags + annotations. **Upsert by `ext_id`** — re-POSTing your own song replaces its metadata + lines in place (re-save an edited analysis). |
| PUT | `/v1/songs/{id}` | owner | Edit metadata (title/artist/youtube_id) + re-saved line edits. |
| PUT | `/v1/songs/{id}/timing` | owner | Save per-line `clip_start_ms` from the tap-to-sync pass. |
| DELETE | `/v1/songs/{id}` | owner | Delete a song + its line rows (cascade). |

Recording (Shadow) reuses the existing **`/v1/audio/recordings`** routes (private takes, idempotent
upload, keep-N) with `lesson=SONGS_SCOPE`. Line synth playback reuses **`/v1/audio/tts`** keyed on
`ttsTextHash(plainText)`.

---

## The four modes

The mode switch (Read / Listen / Shadow) is a segmented control in the song header (`.mode-switch`);
Mine is reached from a "what's in this song" affordance. Each mode renders into the stable
`#songsBody` container.

### Read — the lyric viewer (foundation)
The base surface every other mode builds on. Renders the song's lines from the store:
- **Furigana** is the global `data-furigana` flip — same control as everywhere else; turn it off to
  test your reading.
- **English is hidden per line**, revealed on tap (the same spoiler-gating the flashcards use) — a
  song doubles as a comprehension check, not just a karaoke reader.
- **Tap-a-word** reuses `wireWordTaps` + `overlayTokens` ([word-lookup.js](src/features/word-lookup.js),
  [core/annotate.js](src/core/annotate.js)) over the LLM tokens (written to `sentence_annotation`,
  served via `annotate=1`): a popover with reading/meaning + **Add to deck** (vocab activation,
  Source:〈song〉) + a Jisho link.
- **Grammar chips** per line from the catalog; tap one → the grammar reference (below).
- **Synced highlight + per-line replay** light up once the song is **timed** (Shadow's timing pass);
  untimed songs just scroll + read.

### Listen — dictation (foundation+1)
One mode, two difficulties via a toggle (the maintainer's "both, switchable" choice):
- **Cloze** (easier): the line stays visible with key content words **blanked**; you hear it and fill
  the gaps. `clozeBlanks` (pure, `core/songs.js`) picks which tokens to blank.
- **Full line** (harder): lyrics hidden — you transcribe the whole line you hear.
- **Advisory grading** only (`normKana` + `romajiToKana`, the typed-reading path) — it's practice,
  not SRS, so over-permissiveness is harmless; Reveal self-checks; a per-session correct count.
- Audio is the line's timed slice (or by-ear / synth when untimed); a slow replay reuses the
  compare-player speed control.

### Shadow — record & compare (foundation+2)
Per-line speaking practice, reusing the **record-and-compare engine verbatim**:
- The **navbar-docked speaking bar** ([record-compare/view.js](src/features/record-compare/view.js)
  `speakingBarHtml`/`wireSpeakingControls`/`initMicSelector`) — toggle + mic picker + speed + you⟷ref
  balance, exactly as Minna/Self-Talk. Per-line record controls render only while speaking mode is on;
  the mic auto-releases on tab-leave.
- Per line: `recordControlHtml(SONGS_SCOPE, "<ext_id>:<ord>", '', null, false, plainText(lineJp),
  'songs')` — the **synth-reference** call (the same one Self-Talk uses): full rig (▶ you / reference /
  →you / both / loop, dual waveform, speech-window alignment, volume normalization).
- **Reference tiers** (the picker generalizes "reference = any voice"):
  - **TTS** (default, **full rig**) — synth of the line text via the `songs` audio context. Decodable,
    so the whole overlay rig works.
  - **YouTube slice** (**by-ear**, timed lines only) — drive the IFrame player `seekTo(start)→pause(end)`,
    hear it, record, play your take back. **An iframe's audio can't be decoded**, so there's NO
    waveform / ▶both / level-matching here — by design.
  - **Upload** (full rig) — a decodable file you own. **Deferred** (needs an upload route + private
    reference storage); specced here, not in the foundation.
- Saving a take marks the **day-streak** (reuses Self-Talk's `applyPractice` — one "spoke today"
  signal) and records the line as shadowed in the `songs` blob (feeds the library progress ring).

### Mine — vocabulary & grammar (foundation)
Turn the song into study material (the "what's in this song" panel):
- **Words by JLPT, known vs new** — every content word the analyzer found, bucketed by level
  (`bucketByJlpt`) and cross-checked against your deck (`knownNew`: a word is *known* once it's in a
  Leitner box). **Bulk "Add N new words"** + per-word add → tagged dictionary-form custom cards under
  **`Source:〈song〉`** (vocab activation; see below).
- **Grammar points + counts** — each catalog pattern with how many lines use it; tap → the grammar
  reference. (See [Mining wiring](#mining-wiring).)
- **Coverage %** ("you know 68%") = known content words / total — shown on the library card too, so a
  song advertises its difficulty before you open it.

---

## Mining wiring

**Vocab → SRS (reuses vocab-activation, NOT a new data path).** Like みんなの日本語, each mined word
becomes a **dictionary-form custom card** via `loadCustom`/`saveCustom` + `seq`
([custom-cards.js](src/features/custom-cards.js)), tagged `歌` + `song-<id>` and marked
`{ song:true, songKey, songId }`. So a mined word joins the unified deck (Flashcards/SRS/Browse/Stats),
**syncs for free** under `custom-verbs`, and is **idempotent + self-updating** via a stable `songKey`
(mirroring `minnaKey`). The **Source facet** gains a `歌 / Songs` token + per-song `song-<id>` tokens
(routed to the `source` facet by `tokenFacet`, exactly like `mnn-l<n>`), so you can study "just this
song's words" from the normal deck — the same way you study "just Lesson 24."

**Grammar → reference + cross-links + save-as-phrase (NO new SRS card type — rejected as too heavy).**
A grammar chip (Read) or a grammar row (Mine) opens a **reference panel**: the pattern + structure +
JLPT + explanation from the generated catalog (`grammarLabel`/`grammarJlpt`, [data/grammar.js](src/data/grammar.js))
+ the song's own lines that use it. Plus:
- **Cross-links** — jump to the Self-Talk phrases + example sentences that already teach this pattern
  (the store's grammar tags + the Browse grammar facet already index these). The song becomes a
  discovery surface into practice you already have.
- **"Save this line as a shadow phrase"** — a memorable lyric line (it already carries furigana + the
  grammar tag + an English) becomes a **Self-Talk phrase** via the existing `POST /v1/sentences`
  (`owner_type='selftalk'`, private). Reuses the phrase + record-compare path; no new card type.

---

## Record-and-compare reuse (scope + reference)

- **`SONGS_SCOPE = 80000`** — the engine's opaque numeric partition → the server's `lesson` query
  param. **Reserved**; never reuse for a みんなの日本語 lesson (1–50) or Self-Talk (90000).
- **itemKey = `"<songExtId>:<lineOrdinal>"`** — stable per line; keys recordings + waveforms.
- **Audio context `'songs'`** added to `AUDIO_CONTEXTS` + `DEFAULT_AUDIO_PREFS` (synth-first; songs
  have no per-line native clip) in [core/audio.js](src/core/audio.js). Voice priority is editable in
  Settings → Voice priority like every other context.
- Everything else — capture, trim, takes, keep-N, the compare player, windowing, normalization,
  waveform canvas, the speaking-mode lifecycle (mic auto-release on tab/browser-tab change, the
  `visibilitychange` guard on `#panel-songs` being active) — is the engine **verbatim**.

---

## YouTube integration + line timing

- **Embed, never re-host.** [songs-youtube.js](src/features/songs-youtube.js) lazy-loads the YouTube
  **IFrame Player API** (`https://www.youtube.com/iframe_api`) on first Songs-tab open and wraps one
  player: `seekTo` / `playVideo` / `pauseVideo` / `getCurrentTime`. A poll loop drives the synced
  highlight + per-line replay (stop at the next line's start). The IFrame API is a **necessary**
  external dependency (embedding is the copyright posture) and degrades gracefully — Read + Mine work
  even if it fails to load; only audio sync is lost. Don't add a *hard* dependency on it.
- **`youtube_id`** is parsed from the pasted URL (`parseYouTubeId`, pure: handles `watch?v=`,
  `youtu.be/`, `embed/`, `shorts/`).
- **Per-line timing is optional + resumable** (the tap-to-sync pass — Shadow phase). Play the video
  and tap as each line begins (generalizing みんなの日本語's clip-marker to a whole song); each tap
  writes that line's `clip_start_ms`. End = the next line's start. Stored on `sentence_link`, synced
  via `PUT /v1/songs/{id}/timing`. A song's **timed coverage** = lines-with-start / line-count, shown
  as the `not timed yet` / `synced · N lines` badge in the library. Timing unlocks synced highlight,
  per-line replay, dictation-by-slice, and by-ear shadowing; an **untimed song still reads + mines**.

---

## Account-gating & copyright posture (mirrors Self-Talk)

- **Starter set = PUBLIC rows, anon-readable** (`public=1, created_by=NULL`), seeded by
  `scripts/seed-songs.ts`. **As of 2026-06 the starter set is a 12-song curated J-pop library** — the
  maintainer's fair-use / transformative-use call for this single-user deployment, **superseding** the
  original "genuinely CC / public-domain / Vocaloid only" framing. **The lyric TEXT is maintainer-supplied**
  (pasted in, never scraped); the furigana / English / grammar / per-word-JLPT analysis + per-line timing
  are the transformative layer. **A contributor annotates maintainer-provided text only — it must never
  source, scrape, or reproduce lyrics itself.** The curation toolchain is a **single command** —
  [`wk-enhanced-api/scripts/curate-song.ts`](../wk-enhanced-api/scripts/curate-song.ts) chains
  analyze → write `data/songs/<slug>.json` → `song-align/` timing → `seed-songs.ts` (docs:
  [data/songs/README.md](../wk-enhanced-api/data/songs/README.md) "Adding a song — one command"). Full
  state + provenance: [SONGS_HANDOFF.md](SONGS_HANDOFF.md).
- **BYO songs = PRIVATE rows; authoring requires an account.** Paste/analyze/save gate on `account`
  (anon sees a sign-in nudge); your lyrics are private store rows (`created_by`, `visibility=private`),
  never public. This is the same posture as Self-Talk authoring + custom-card examples.
- **Recording (Shadow) + progress sync require an account** (private takes; the `songs` blob).
- **No re-hosting:** lyrics are BYO-private; master audio is the **embedded** YouTube player, not a
  stored file. The only audio we store is your own takes (private) + cached TTS of the line text.

---

## Reuse map (what Songs assembles, and from where)

| Need | Reuse | Where |
|---|---|---|
| Line = a sentence (furigana/tokens/grammar/translation, privacy gate) | sentence store | [../wk-enhanced-api/src/db/repos/sentences.ts](../wk-enhanced-api/src/db/repos/sentences.ts) |
| Tap-a-word on ruby | `wireWordTaps`, `overlayTokens` | [word-lookup.js](src/features/word-lookup.js), [core/annotate.js](src/core/annotate.js) |
| Furigana segments ⇄ ruby ⇄ reading; plainText | `rubyToSegments`/`segmentsToReading`/`segmentsToRuby`/`plainText` | [core/text.js](src/core/text.js) |
| Record + compare (full rig) | `recordControlHtml`/`wireRecordCompare`/`paintCompareWaveforms`/`speakingBarHtml`/`loadRecordings`/`setOnTakeSaved` | [record-compare/*](src/features/record-compare/) |
| Unified audio + per-context voices | `playItem(item,'songs',btn)`, `resolveVariant` | [audio.js](src/features/audio.js), [core/audio.js](src/core/audio.js) |
| Vocab activation + Source facet | `saveVerb`/`saveCustom`/`rebuildData`, `tokenFacet`/`passes`, `annotateSourceChips` | [custom-cards.js](src/features/custom-cards.js), [core/facets.js](src/core/facets.js), [a11y.js](src/features/a11y.js) |
| Grammar catalog | `grammarLabel`/`grammarJlpt`/`orderGrammar`/`GRAMMAR_CATALOG` | [data/grammar.js](src/data/grammar.js) |
| Day-streak | `applyPractice`/`practiceStreak` | [core/selftalk.js](src/core/selftalk.js) |
| Synced blob | `createSyncedBlob` + register sites (cloud.js/sync-bus.js/pullCloud/flushQueue) | [synced-blob.js](src/features/synced-blob.js), [cloud.js](src/features/cloud.js) |
| Tab + lifecycle (mic auto-release) | `initTabs` `songs`/`leaveSongs`; `visibilitychange` guard | [chrome.js](src/features/chrome.js) |
| Clip-timing pattern | みんなの日本語 clip marker (`[startSec,endSec]`, store-wins) | [MINNA.md](MINNA.md) |
| TTS clip cache | `resolveTts`, `ttsTextHash` | [../wk-enhanced-api/src/services/tts.ts](../wk-enhanced-api/src/services/tts.ts) |
| Private takes | `minna_recordings` + `/v1/audio/recordings` | [../wk-enhanced-api/src/routes/audio.ts](../wk-enhanced-api/src/routes/audio.ts) |

---

## Things that look like bugs but aren't (dead-ends)

- **Songs are the first RUNTIME writer of `sentence_annotation`** (LLM tokens, `parser='llm:*'`). A
  deliberate, validated extension of the "annotations are offline-only" posture — song lines are
  private/curated rows outside the public GiNZA corpus, and the UTF-16 `slice===surface` assertion
  still guards every offset. Don't revert it to offline-only.
- **The YouTube iframe's audio CANNOT be decoded.** Shadow's full waveform / ▶both / level-matched
  rig needs a *decodable* reference (TTS or an uploaded file); the **YouTube-slice reference is
  by-ear only** (seek + play the slice, no overlay). This is the central Shadow constraint.
- **`SONGS_SCOPE = 80000` is reserved.** Never reuse for a Minna lesson (1–50) or Self-Talk (90000).
  One scope holds all songs' takes (itemKey encodes song+line), like Self-Talk's single 90000.
- **The IFrame API script is a NECESSARY external dep** (embedding is the copyright posture), loaded
  lazily on the Songs tab. It degrades gracefully — Read + Mine must work if it never loads. Don't
  make it a hard dependency, and don't try to decode its audio.
- **The analysis endpoint is gated on `ANTHROPIC_API_KEY`** and returns `503
  {code:'analysis_unavailable'}` without it (so the feature merges + ships before the key is
  provisioned). The Add flow shows a "analysis isn't available yet" state, not an error. Reading
  existing songs + the starter set never needs the key.
- **Song content is server-authoritative; the `songs` blob holds progress only.** Don't put line
  text/furigana/timing in the blob — timing is a `PUT /v1/songs/{id}/timing`, content is the store.
  (Same split as Self-Talk: phrases in the store, `{practice}` in the blob.)
- **Mined vocab lives in `custom-verbs`, not the `songs` blob** — exactly like みんなの日本語 vocab.
  The `song-<id>` Source token + `songKey` idempotency are the whole mechanism; no parallel song-card
  list.
- **LLM furigana/tokens are MODEL-GENERATED** — validated for the byte-exact furigana + UTF-16 token
  invariants, but naturalness/accuracy still wants the proofread step (that's what the confidence
  flags + the review screen are for). Same status caveat as `examples.js` / Self-Talk content.

---

## Files

| Concern | File |
|---|---|
| Tab glue (library/add/read/listen/shadow/mine + lifecycle) | [src/features/songs.js](src/features/songs.js) |
| YouTube IFrame loader + player wrapper | [src/features/songs-youtube.js](src/features/songs-youtube.js) |
| Pure logic (parseYouTubeId, coverage, bucketByJlpt, knownNew, clozeBlanks, songProfile, lineTimingState) | [src/core/songs.js](src/core/songs.js) |
| Synced progress blob (signal only) | [src/persistence/songs.js](src/persistence/songs.js) + [src/features/cloud.js](src/features/cloud.js) |
| Markup (nav tab, `#panel-songs`, sprite glyphs) | [index.html](index.html) |
| Styles (ported from mockups/songs/mock.css) | [src/styles.css](src/styles.css) |
| Song store + repo | [../wk-enhanced-api/src/db/repos/songs.ts](../wk-enhanced-api/src/db/repos/songs.ts), [../wk-enhanced-api/src/db/schema.sql](../wk-enhanced-api/src/db/schema.sql) |
| Routes + schemas | [../wk-enhanced-api/src/routes/songs.ts](../wk-enhanced-api/src/routes/songs.ts), [../wk-enhanced-api/src/schemas/songs.ts](../wk-enhanced-api/src/schemas/songs.ts) |
| The LLM analysis pass | [../wk-enhanced-api/src/services/songAnalyze.ts](../wk-enhanced-api/src/services/songAnalyze.ts) |
| Starter-set seed mechanism | [../wk-enhanced-api/scripts/seed-songs.ts](../wk-enhanced-api/scripts/seed-songs.ts) |
| One-command curation (analyze→write→time→seed) | [../wk-enhanced-api/scripts/curate-song.ts](../wk-enhanced-api/scripts/curate-song.ts) (+ `.test.ts`) |
| Offline forced-alignment timing | [../song-align/align.py](../song-align/align.py) |

---

## Phase checklist — cross-session tracker

Each phase is independently shippable + reviewable (one logical change per commit). Update the boxes
as work lands. `[ ]` = todo, `[x]` = done, `[~]` = in progress.

### Phase 0 — this design doc
- [x] `study-app/SONGS.md` (this file) — all four modes specced for cross-session tracking.

### Phase 1 — Server: song store + CRUD (no LLM) ✅
- [x] `song` table + `public_song` view in `schema.sql`. (ownerType enum widens in Phase 2 with the analyze/persist path; song-line READS reuse `getSentences` directly, no enum change needed for CRUD.)
- [x] `db/repos/songs.ts`: createSong / getSongs(list, gated) / getSong(one + ordered lines) / updateSong / updateSongTiming / deleteSong / upsertPublicSong (starter seed, reuse-by-hash) / countUserSongs.
- [x] `routes/songs.ts` + `schemas/songs.ts`: `GET/POST/PUT/DELETE /v1/songs`, `PUT /v1/songs/{id}/timing`; mounted + in the study-app CORS allowlist.
- [x] `scripts/seed-songs.ts` + `data/songs/` (one genuinely-PD starter: 故郷; curated picks deferred).
- [x] Tests: 16 repo tests incl. the privacy-gate breach pins (private lyrics never leak to anon/another user). Full suite green (262), typecheck clean, routes smoke-tested live.
- Note: `AnnotationToken` gained optional `jlpt`/`gloss` (LLM-sourced, Songs) + the GiNZA-only `tag`/`dep`/`head` became optional, so one token shape serves both producers. Line **ordinal = array index** (lines are server-sorted + contiguous; `compactLink` omits a falsy 0, but the DB stores correct 0-based ordinals for timing).
- Follow-up hardening (post-Phase-1): the library `getSongs` is **two gated queries**, not a per-line assembly (it was O(total lines) round-trips on every no-store load); `createSong`/`upsertPublicSong`/`deleteSong`/`updateSongTiming` are **transactional** (no partial songs); and **`POST /v1/songs` is an upsert** (`replaceSongLines`) — re-POSTing your own song replaces its metadata + lines in place, so an edited analysis re-saves under the same `ext_id` (line ext_ids stay stable, the record-compare itemKey is preserved). The Add-review screen's *client-side* inline edit is still deferred; the server path now supports it.

### Phase 2 — Server: analysis endpoint ✅
- [x] `@anthropic-ai/sdk` dep + `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` (default `claude-opus-4-8`) in `config.ts` + `.env.example`; grammar catalog copied to `wk-enhanced-api/data/grammar.json` (runtime image carries no `study-app/`, so the seed-script import path can't be used at runtime).
- [x] `services/songAnalyze.ts`: forced tool-use + streaming Claude call; the model returns furigana + tokens (in order, **no offsets**) and the **server computes UTF-16 offsets** by walking the line, so `text.slice(start,end)===surface` holds by construction; furigana validated + flagged; grammar catalog-filtered; 503 (`AnalysisUnavailableError`) when no key.
- [x] `POST /v1/songs/analyze` (account-gated, 503 graceful) + `GET /v1/songs/oembed` (keyless YouTube title/artist + SSRF-guarded id parse).
- [x] `POST /v1/songs` (Phase 1) already persists a reviewed analysis atomically — the Add flow's save target; no change needed.
- [x] 7 unit tests for the pure `assembleAnalysis` (offset computation, furigana validation, flagging, grammar filter) — mock-free per the service-layer test convention; the live Claude call is integration-only. Full suite green (269), typecheck clean, routes smoke-tested (anon 401 / 503 paths, `/{id}` not shadowed).
- Decision: model returns linguistics, **server does the offset bookkeeping** — never trust an LLM to count UTF-16 code units. Live analyze verifies once `ANTHROPIC_API_KEY` is provisioned (the Add flow shows a "not available yet" state until then).

### Phase 3 — Client: Library + Add + Read + Mine (foundation) ✅
- [x] Tab (`歌`/`#i-music`) + `#panel-songs` (`#sgHead`/`#sgBody`) + 6 new sprite glyphs (music/eye/eyeoff/headphones/back/tag) in `index.html`.
- [x] `core/songs.js` pure helpers (parseYouTubeId, songWords, knownHeadwords, coverage, bucketByJlpt, wordStatus[known/added/new], songLevel, lineTimingState, songGrammar, songLineKey) + 12 tests.
- [x] `features/songs.js`: Library grid (filters, coverage ring, source/level badges); Add flow (paste + YouTube → analyze → review w/ flags → save, oEmbed title/artist auto-fill, graceful 503); Read viewer (furigana flip, reveal-on-tap EN, tap-a-word via overlayTokens+wireWordTaps, grammar chips → reference panel, per-line replay = synth or YouTube slice); Mine (vocab by JLPT known/added/new + per-word/bulk add under Source:歌, grammar points + counts, grammar reference + save-line-as-shadow-phrase).
- [x] `features/songs-youtube.js`: lazy IFrame loader + player wrapper (embed + synced-highlight poll + playSlice).
- [x] Source facet `song`/`song-<id>` routing (`core/facets.js` tokenFacet/TOKEN_FACET/oneGroup/DECK_LABEL) + `annotateSourceChips` extension (`a11y.js`, hide-until-Minna **or**-songs) + a `歌` chip in both pickers.
- [x] `'songs'` audio context (`core/audio.js`).
- [x] Song CSS ported from `mock.css` into `styles.css` (reusing existing chip/frow/word-pop/ex-gram-chip/speak-btn primitives).
- [x] `main.js` boot + `chrome.js`/`initTabs` `songs`/`leaveSongs` wiring.
- [x] 204 core tests + `bun run build` green; **verified live in the preview** (Library, Read furigana+reveal+tap-word, Mine word-rows+activation→ADDED, Source `歌` chip, Add→Analyze→503 graceful). Screenshots captured.
- DEVIATION: the **`songs` synced blob is deferred to the Shadow phase** (Phase 5), where stars + shadowed-lines actually accrue. The foundation needs none — song content is server-authoritative and coverage is computed live; mined vocab syncs under `custom-verbs`. Library/Read/Mine all work without it.
- DEFERRED to follow-ups: inline edit in the Add-review screen (flags guide a re-analyze for now); per-song `song-<id>` chips in the picker (the master `歌` chip + the per-song tags ship; dynamic chip injection is later); the grammar-reference cross-link COUNTS (save-line-as-phrase + a Browse deep-link ship).

### Phase 3.5 — Curated library + offline line-timing ✅ (2026-06-16) — see [SONGS_HANDOFF.md](SONGS_HANDOFF.md)
- [x] **12-song curated J-pop library** (public starters; the 故郷 placeholder dropped). Full per-line
  analysis (furigana/EN/grammar/JLPT) authored from maintainer-supplied lyrics, validated (furigana concat
  + token offsets) + seeded. Pilot ドライフラワー (`80d3074`); the other 11 via parallel subagents (`e168565`).
- [x] **Seed carries the analysis** (`cf63d35`): seed-file `tokens`/`grammar`/`section`; UTF-16 offsets via
  the shared `offsetTokens` (exported from `songAnalyze.ts`) → public starters get Mine/coverage, not just plain ruby.
- [x] **Stanza sections** (`17a8314`): per-line `section` stored in `sentence_link.role` → Read viewer spacing.
- [x] **`deletePublicSong`** (`767d327`): curator cleanup (orphan-safe, scoped to `created_by IS NULL`).
- [x] **Offline forced-alignment timing pipeline** (`3e96ad2`): `song-align/` (yt-dlp → demucs → stable-ts
  forced-align of the known lyrics) → `data/song-timing/<slug>.json` sidecar → `seed-songs.ts` merges →
  `clip_start_ms`. **Synced highlight + per-line replay (already wired in `songs.js`) now light up once a
  song is timed.** ‼️ `PUT /timing` is owner-scoped → the PUBLIC curated set is timed via this offline
  pipeline, NOT in-app.
- [x] **Whole library timed (2026-06-16):** all 12 sidecars (`large-v3` + vocals) committed + seeded
  locally — every song is `N/N` timed, so highlight / per-line replay / Listen-slice / Shadow "▶ original"
  work library-wide. (yt-dlp needed `--cookies-from-browser` for the bot check + `yt-dlp-ejs` +
  `--js-runtimes node` for the player JS challenge — captured in `song-align/README.md`.) **Prod re-seed
  is the one remaining step.**

### Phase 4 — Listen (dictation) ✅ (2026-06-16)
- [x] A per-line **stepper** ("Line N of M · K correct") with a **Cloze ⇄ Full-line** difficulty toggle,
  Play + Replay-slower cues, and Check / Reveal / Next — `mode==='listen'` in `features/songs.js`,
  rendered into a new stable `#sgContent` wrapper so a step re-render (`renderListen`) never re-mounts
  the YouTube player.
- [x] **Cloze**: pure `clozeBlanks` (content-POS tokens, capped) + `clozeLineParts` (the offset-slicing
  render plan — a blank token can sit MID plain furigana run, e.g. じゃなくて|いい|ね) in `core/songs.js`,
  both unit-tested. Each gap is an `<input>` graded against the token reading.
- [x] **Full-line**: one input for the whole-line reading (`segmentsToReading`).
- [x] **Advisory grading** via the typed-reading path (`normKana`/`romajiToKana`); Reveal self-check
  (answer block w/ furigana + EN, and Check hidden after Reveal so the count can't be gamed); per-session
  correct count via a `done` Set (re-check / step-back can't double-count).
- [x] **Line audio** = the timed YouTube slice (`playSlice`, now with a SEPARATE slice timer so a start
  from a paused player can't clobber the stop, + a `rate` arg for the slow replay), else synth
  (`playItem(…,'songs')`). In Listen the video is **masked** (kept playing for audio, covered visually) so
  a lyric-burned MV doesn't spoil the dictation.
- Verified live against the timed ドライフラワー (47/47): cloze offset-slicing, romaji grading, full-line,
  Reveal, count, the mask, and Read/Mine regression. Tests 208 + build green.

### Phase 5 — Shadow + line timing — ✅ Shadow shipped (2026-06-16); tap-to-sync still a follow-up
- [x] **Synced highlight + per-line replay** — implemented in `songs.js` (`highlightAt`/`playSlice`/`replayLine`); unlocked by the Phase-3.5 timing pipeline.
- [x] **Shadow** speaking bar (`speakingBarHtml`/`wireSpeakingControls`/`initMicSelector` in `#navExtra`,
  shadow-mode + signed-in only) + per-line `recordControlHtml(SONGS_SCOPE, songLineKey(extId,ord), '',
  null, false, plainText(lineJp), 'songs')` — the **TTS reference / full rig** (▶you/▶ref/→you/both/loop
  + dual waveforms). **YouTube-slice by-ear** reference = a per-line "▶ original" `playSlice` on TIMED
  lines (iframe audio can't be decoded → no waveform/overlay). `setOnTakeSaved` (now **multi-listener**,
  filtered to `SONGS_SCOPE` so it doesn't clobber Self-Talk's) → the shared day-streak (`applyPractice`
  on `state.selftalkStore.practice`). Speaking-mode lifecycle reused verbatim (mic auto-release on
  tab-leave via `onSongsHidden`, browser-tab `visibilitychange` guarded on `#panel-songs`). **Upload
  reference deferred.** Verified live (signed-in render, by-ear slice, mode transitions, no console
  errors); the mic-gated record/compare flow is the Self-Talk/Minna engine verbatim (a headless mic is
  `NotAllowedError`, so the capture step itself wasn't exercised live).
- [x] **`songs` progress blob** (2026-06-16) — the 6th `createSyncedBlob` trio (app key `songs`,
  `{progress:{"<extId>":{starred,shadowed,lastMode}}}`, modeled on the Self-Talk blob). `markShadowed`
  now records shadowed ordinals → the library **progress ring** = shadowed-lines % (`songProgress`);
  per-line **stars** in Read; **last-mode resume** on reopen. `mergeSongs` (union starred/shadowed
  sets, local-wins `lastMode`) + `songProgress` are pure + unit-tested; the server `/v1/progress/{app}`
  enum widened to accept `songs`. `lastLine` (scroll-to-line resume) deferred — nothing reads it.
- [ ] **In-app tap-to-sync** for PRIVATE BYO songs (generalize the clip-marker; `PUT /v1/songs/{id}/timing`). (The curated public set is timed offline via `song-align/`.)

### Phase 6 — Docs + memory (rolling)
- [~] SONGS_HANDOFF.md added + `song-lyric-tab-design` memory updated (2026-06-16); this checklist current.
  TODO: refresh `README.md` / `NEXT_STEPS.md` / the CLAUDE.md Songs dead-ends with the curation + timing surface.

---

## Verifying Songs changes
- `cd study-app && bun run test` (core suite incl. `core/songs.js`) + `bun run build` green.
- `cd wk-enhanced-api && bun test` green (song repo + routes + analyze with a **mocked** Anthropic client — no live key in CI).
- **Drive the already-running preview — do NOT restart :5173 / :3000** (the NEXT_STEPS warning). The
  preview reloads the tab on capture, so assert transient state (active mode, open song, applied
  filters) via DOM `eval`, not a follow-up screenshot.
- Analyze: no key → graceful `503` + the "not available yet" Add state; with a key (or a mocked
  response) → a pasted song produces validated furigana/English/grammar/tokens and renders from the
  store with tap-a-word + grammar chips working.
