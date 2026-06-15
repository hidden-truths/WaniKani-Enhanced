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

> **Status: under construction.** Build order is **foundation first** (server schema + the analysis
> endpoint + **Read + Mine**), then **Listen**, then **Shadow + line timing**. The
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
  `{ progress: { "<songExtId>": { starred:[ord…], shadowed:[ord…], lastMode, lastLine } } }` —
  *progress only*, mirroring Self-Talk's `{practice}`-only blob (blobs = per-user signals; the store
  = sentence text). Word **coverage %** is computed live against the deck, not stored.
- **Mined vocab** lives in `jpverbs_custom` as tagged cards (the vocab-activation path), **not** in
  the songs blob — exactly as みんなの日本語 vocab lives in `custom-verbs`, not in the `minna` blob.

| Where | Key | Shape |
|---|---|---|
| server | `song` table + `sentence`/`sentence_link`/`sentence_tag`/`sentence_annotation` | the song + its lines |
| localStorage + synced app `songs` | `jpverbs_songs` | `{ progress:{ "<ext_id>": {starred,shadowed,lastMode,lastLine} } }` |
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
| POST | `/v1/songs` | account | Persist a reviewed analysis: song row + sentence rows + links + translations + grammar tags + annotations. Idempotent by `ext_id`. |
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

- **Starter set = PUBLIC rows, anon-readable.** A small curated **genuinely CC / public-domain /
  Vocaloid** set (`public=1, created_by=NULL`), seeded by `scripts/seed-songs.ts`. Anon visitors can
  Read / Listen / Mine them, so the tab is useful on day one. (Curation of the actual song picks is a
  deferred content pass — the seeding *mechanism* ships; we do **not** redistribute copyrighted
  lyrics.)
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

### Phase 2 — Server: analysis endpoint
- [ ] `@anthropic-ai/sdk` dep + `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` in `.env.example`.
- [ ] `services/songAnalyze.ts`: prompt (lyrics + catalog + contract), Claude call, per-line validation + flags, 503 if no key.
- [ ] `POST /v1/songs/analyze` + `GET /v1/songs/oembed`.
- [ ] `POST /v1/songs` persists the reviewed analysis atomically (rows + links + translations + tags + annotations).
- [ ] Tests mock the Anthropic client.

### Phase 3 — Client: Library + Add + Read + Mine (foundation)
- [ ] Tab + `#panel-songs` + sprite glyphs in `index.html`.
- [ ] `core/songs.js` pure helpers + tests.
- [ ] `features/songs.js`: Library grid; Add flow (paste→analyze→review/edit→save); Read viewer; Mine panel.
- [ ] `features/songs-youtube.js`: IFrame loader + player wrapper (embed; sync arrives with timing).
- [ ] Source facet `歌`/`song-<id>` routing (`core/facets.js`) + `annotateSourceChips` extension (`a11y.js`).
- [ ] `songs` synced blob (`state.js`, `persistence/songs.js`, `cloud.js`, `sync-bus.js`, pullCloud, flushQueue).
- [ ] `'songs'` audio context (`core/audio.js`).
- [ ] Port song CSS from `mockups/songs/mock.css` into `styles.css`.
- [ ] `main.js` boot + `initTabs` `songs`/`leaveSongs` wiring.
- [ ] `bun run test` + `bun run build` green; preview screenshots vs mockups.

### Phase 4 — Listen (dictation) — follow-up
- [ ] Cloze ⇄ full-line toggle; advisory grading (`normKana`/`romajiToKana`); reveal self-check; per-session count; line replay (slice/by-ear/synth).

### Phase 5 — Shadow + line timing — follow-up
- [ ] Tap-to-sync timing (generalize the clip-marker; `PUT /v1/songs/{id}/timing`); synced highlight + per-line replay unlock.
- [ ] Shadow speaking bar + per-line `recordControlHtml(SONGS_SCOPE,…, 'songs')` (TTS full rig); YouTube-slice by-ear reference; `setOnTakeSaved` → streak + shadowed-line. **Upload reference deferred.**

### Phase 6 — Docs + memory (rolling)
- [ ] Keep this checklist current; update `README.md`, `NEXT_STEPS.md`, `CLAUDE.md` (+ server `CLAUDE.md`) with the surface/routes/dead-ends; update the `song-lyric-tab-design` memory (architecture resolved + shipped phases).

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
