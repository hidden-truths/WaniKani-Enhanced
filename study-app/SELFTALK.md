# 独り言 Self-Talk — output/speaking-practice tab

The **source of truth for the Self-Talk surface** — the 5th tab in the study app. Where the rest
of the app trains *recognition* (flashcards, Browse, Minna), Self-Talk is **output reps**: a running
daily monologue you read aloud, hear, record, and compare to a reference voice. Built for N3-bound
speaking practice — the grammar reading-only drills miss (〜ている, 〜なきゃ/〜ないと, 〜たい,
volitional 〜よう, 〜ておく, 〜そう…).

Layer docs: module map + dead-ends in [CLAUDE.md](CLAUDE.md); card/furigana model in
[CARDS.md](CARDS.md); the shared record-and-compare engine in [NEXT_AUDIO_UNIFY.md](NEXT_AUDIO_UNIFY.md).

## What it is (and how it differs from Minna)

- **Anon-readable, account-gated authoring** (as of the unified sentence store, Phase 1). Phrases
  live in the server **sentence store** and are fetched from `GET /v1/sentences?ownerType=selftalk`
  (with a localStorage read-through cache) — built-in phrases are **public** rows everyone (incl.
  anon) can read; a signed-in user also gets their own **private** rows. Unlike みんなの日本語
  (copyright-gated), Self-Talk built-ins are original + model-authored, so anon read is fine.
  **Authoring now requires an account** (your phrases are private store rows, written via
  `POST/PUT/DELETE /v1/sentences`); so does recording (private per-user takes). The bundled
  `data/selftalk.js` is the **seed source** (→ `scripts/seed-sentences.ts`), not read at runtime.
- **Not SRS-graded.** Output reps aren't recognition — there's no Leitner box/schedule. The only
  persisted signal is a lightweight **day streak + "said today"** set.

## Files

| Concern | File |
|---|---|
| Tab glue (render/playback/record/authoring/lifecycle) | [src/features/selftalk.js](src/features/selftalk.js) |
| Pure logic (rotation, grouping, streak) | [src/core/selftalk.js](src/core/selftalk.js) |
| Built-in starter content (SEED SOURCE for the store, not read at runtime) | [src/data/selftalk.js](src/data/selftalk.js) |
| Phrase store: server sentence rows + repo (`getSentences`/`createSentence`/…) | [../wk-enhanced-api/src/db/client.ts](../wk-enhanced-api/src/db/client.ts), [routes/sentences.ts](../wk-enhanced-api/src/routes/sentences.ts) |
| Seed built-ins → public rows | [../wk-enhanced-api/scripts/seed-sentences.ts](../wk-enhanced-api/scripts/seed-sentences.ts) |
| Synced storage (practice/streak signal ONLY — phrases moved to the store) | [src/persistence/selftalk.js](src/persistence/selftalk.js) |
| Markup (nav tab, `#panel-selftalk`, `#stPhraseModal`) | [index.html](index.html) |
| Record-and-compare ENGINE (shared with Minna) | [src/features/record-compare.js](src/features/record-compare.js) |

## Data model

A **phrase** is `{ id, jp, read, mean, topic, grammar:[…], custom? }`:
- `jp` carries `<ruby>漢字<rt>かな</rt></ruby>` furigana (CARDS.md format; the global `data-furigana`
  flip toggles `<rt>`). `read` is the full kana reading (furigana-off display). **No `accent`** —
  pitch is a per-WORD property and a single drop number is meaningless over a sentence, so phrases
  rely on the furigana + the synth audio's prosody.
- `topic` is one of `SELFTALK_TAXONOMY`'s topic ids; its CATEGORY is **derived** from that registry
  (category → topics — e.g. Daily life → morning/commute/meals/chores/work/feelings/evening). Stored
  as `sentence_tag(kind='topic')`, with a legacy `scene`-tag read-fallback for pre-grid rows.
  `grammar` ⊂ `SELFTALK_GRAMMAR` (`te-iru`/`nakya`/`tai`/`volitional`/`te-oku`/`sou`).
- Phrases now live in the **sentence store**: built-ins are public rows (seeded from
  `data/selftalk.js`), **user-authored** phrases (`custom:true`) are private rows
  (`created_by`, `visibility='private'`). The store keeps furigana as structured `[{t,r?}]`
  segments; the client converts via `rubyToSegments`/`segmentsToRuby`/`segmentsToReading`
  (`core/text.js`) and adapts a store sentence → the phrase shape with `sentenceToPhrase`
  (`core/selftalk.js`). The fetched set is cached in `localStorage["jpverbs_selftalk_cache"]`
  (read-through; degrade-don't-break offline). **Invariant:** the phrase `id` is the store's
  `ext_id` (`st-<slug>` / `usr-<uuid>`), preserved verbatim — it's the record-compare itemKey +
  practice key.

**Synced blob** (`localStorage["jpverbs_selftalk"]`, app key `selftalk` — the 5th sync trio):
`{ practice:{ lastDay:'YYYY-MM-DD'|null, streak, doneToday:[id…] } }` — the practice/streak signal
ONLY (per "blobs = per-user signals; store = sentence text"). Pre-store phrases in an old blob are
migrated into the store once on sign-in, then dropped from the blob. Server enum already includes
`selftalk` ([../wk-enhanced-api/src/routes/progress.ts](../wk-enhanced-api/src/routes/progress.ts)).

## Structure (three organizers)

- **Topic groups** — collapsible `<details>` per topic (Daily life's are the time-of-day arc). First
  topic open, rest collapsed. *(Being reworked into a category→topic grid + drill-in — P1b.)*
- **Today's focus** — a `<button data-sttoday>` toggle that narrows the visible phrases to a
  deterministic daily rotation (`todaysSet`, seeded by `localDay()` via an FNV-1a hash — stable
  within a day, rotates across days). It's a **filter, not a duplicated section**, so each phrase
  (and its record control) renders exactly once.
- **Grammar-tier filter** — a chip row over the present grammar tokens; a phrase matches if it
  carries ANY selected token (empty = all). View-only (not synced).

## Audio + record-and-compare (reuses the shared engine)

- **Playback:** the ▶ on each phrase calls `playItem({ text: plainText(jp) }, 'selftalk', btn)` —
  the unified player with the **`selftalk`** per-context voice priority (Settings → Voice priority).
  ⌥/⇧-click cycles voices. `plainText` strips ruby to the exact string `/v1/audio/tts` keys on.
- **Record + compare:** Self-Talk feeds the generic engine (`record-compare.js`) a **reserved
  numeric scope** `SELFTALK_SCOPE = 90000` (the engine's opaque partition → the server's `lesson`
  query param; Minna uses 1–50, so they never collide) + the phrase id as the itemKey + a
  **synth-only reference** (`recordControlHtml(SCOPE, id, '', null, false, text, 'selftalk')` — no
  native clip, so ▶ reference resolves to a Siri/Google voice from the phrase text). You get the full
  rig: ▶ you / ▶ reference / →you / both / loop, dual waveform, volume normalization, speed control.
- **Speaking bar** lives in the navbar `#navExtra` slot (`renderNavSpeaking`, built from the engine
  primitives `speakingBarHtml`/`initMicSelector`/`wireSpeakingControls`) — gated on account +
  `RECORD_SUPPORTED`. Per-phrase record controls render only `if (isSpeakingMode())`.

## Practice signal (streak)

Pure helpers in `core/selftalk.js`: `applyPractice` (mark a phrase said on a day — new day → streak
+1 if yesterday, else reset to 1; same day → add to `doneToday`), `practiceStreak` (the displayed
streak — alive if practiced today/yesterday, else 0), `donePhraseIds` (today's set, for the per-card
✓). A phrase is marked practiced either by the **"✓ I said it"** button (works offline/anonymous) or
automatically when you **save a recording** (the engine's `setOnTakeSaved` host hook, filtered to
`SELFTALK_SCOPE`). The streak chip is in the tab head.

## Lifecycle (mic never lingers)

Mirrors Minna: `onSelftalkHidden()` (chrome.js `leaveSelftalk` → main.js) exits speaking mode + clears
the nav bar on tab switch; a `visibilitychange` handler releases the mic on browser-tab hide — **guarded
on `#panel-selftalk` being active** so it doesn't fight Minna's handler (both call the idempotent
`exitSpeakingMode`). The speaking-mode singletons (`speakingMode`/`liveStream`) are shared with Minna —
fine, since only one tab is active at a time.

## Proofread caveat

The built-in phrases + furigana are **model-generated** → worth a grammar/furigana proofread (same
status as `examples.js`/Minna). Fixes are plain-data edits in `data/selftalk.js`.

## Backlog / ideas

- Pre-generate the Self-Talk phrases into the `generate-tts.ts` corpus (optional operator step;
  first play Google-synths + caches regardless) so the Siri reference is instant.
- A copy-sentence button on phrases (mirror the example-row copy button).
- Per-phrase "favorite" / hide-from-rotation; a larger curated starter set.
