# Starter songs (歌 / Songs tab)

Curated songs seeded as PUBLIC (anon-readable) starter rows by
[`../../scripts/seed-songs.ts`](../../scripts/seed-songs.ts). One JSON file per song.

The master audio is **always** the embedded YouTube player (`youtubeId`) — never a stored file.
Each starter is curated **study material**: the pasted lyric text is turned into furigana + a
per-line English gloss + grammar tags + per-word JLPT tokens, alongside the embedded original video.
Curate only lyrics you're entitled to publish on your deployment; BYO copyrighted lyrics for the
general case are PRIVATE per-user rows written live via `POST /v1/songs`, never seeded here.

## Format

```jsonc
{
  "extId": "song-<slug>",        // stable id; the record-compare itemKey prefix + Source-facet token
  "title": "故郷",
  "artist": "…",                 // attribution; nullable
  "youtubeId": "oRdxUFDoQe0",    // embed source; null is fine (a reader-only starter)
  "lines": [
    {
      "jp": "<ruby>兎<rt>うさぎ</rt></ruby>…",   // <ruby> furigana (CARDS.md format); seed derives plainText + segments
      "en": "…",                                  // per-line English (optional)
      "grammar": ["te-iru"],                      // grammar-catalog ids (optional; data/grammar.json)
      "tokens": [                                  // curated analysis (optional) → Mine vocab + coverage + tap-to-lookup
        { "surface": "兎", "lemma": "兎", "reading": "うさぎ", "pos": "NOUN", "jlpt": "N3", "gloss": "rabbit" }
        // CONTENT words only, in left-to-right order, NO offsets — the seed computes UTF-16 offsets
        // via the SAME offsetTokens the runtime analyzer uses (so text.slice(start,end)===surface).
        // pos ∈ UD coarse tags; NOUN/PROPN/VERB/ADJ/ADV are the studiable ones the Mine panel shows.
      ]
    }
  ]
}
```

A line's `tokens` are the analysis the live Add flow would produce — authored once and seeded, so a
public starter gets the full Read **and** Mine experience (per-word JLPT, coverage %, tap-to-lookup).
A line **without** `tokens` still seeds and renders plain ruby (Read works), but contributes no Mine
vocabulary or coverage. A file with an empty `lines: []` is a **scaffold** (verified metadata, lyrics
not yet filled) and is skipped by the seed until its lines are added.

Re-seeding is idempotent (by `extId`). Run after editing: `bun scripts/seed-songs.ts` (from
`wk-enhanced-api/`). Curation status is tracked in [study-app/SONGS.md](../../../study-app/SONGS.md).
