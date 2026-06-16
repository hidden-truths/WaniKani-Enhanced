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

## Adding a song — one command

[`scripts/curate-song.ts`](../../scripts/curate-song.ts) runs the whole pipeline end to end:
**analyze → write this seed file → time → seed.** You supply the lyric TEXT (a file) + the metadata;
it annotates — it never sources or scrapes lyrics.

```bash
# from wk-enhanced-api/ (so .env loads: ANTHROPIC_API_KEY for analyze, DATABASE_FILE for seed)
bun scripts/curate-song.ts \
  --slug betelgeuse-yuuri --title ベテルギウス --artist 優里 \
  --url 'https://www.youtube.com/watch?v=cbqvxDTLMps' \
  --lyrics ~/Downloads/song-lyrics/betelgeuse-yuuri.txt \
  --browser safari            # cookies for the yt-dlp timing step (see ../../../song-align/README.md)
```

What it does, in order:
1. **Analyze** the lyrics with the Claude pass (`services/songAnalyze.ts`) → per-line furigana /
   English / grammar / JLPT tokens. **Flagged lines are printed — proofread them** in the written file
   (the CLI analog of the Add-flow review step). Needs `ANTHROPIC_API_KEY`.
2. **Write** `data/songs/<slug>.json` in the format above (the pure, unit-tested `analyzedToSeedFile`).
3. **Time** it — shells `song-align/align.py --song <slug>` → `data/song-timing/<slug>.json` (needs the
   song-align venv + YouTube cookies; pass `--browser` / it degrades to UNTIMED on failure).
4. **Seed** — `bun scripts/seed-songs.ts` merges lyrics + timing into the DB.

Then spot-check the song in the app and **commit** `data/songs/<slug>.json` + `data/song-timing/<slug>.json`.

Useful flags: `--dry-run` (validate + print the plan, no writes) · `--no-align` / `--no-seed` (skip a
step) · `--no-vocals` (faster, rougher alignment) · `--force` (re-analyze + overwrite an existing seed
file; otherwise an existing one is reused so you can re-time/re-seed without paying for analysis again).

Notes: stanza `section` headings aren't auto-detected — hand-add them to the seed file if you want
Verse/Chorus spacing (optional). To curate straight against **prod**, point `DATABASE_FILE` at the prod
sqlite for the seed step (same pattern as the other seed scripts).
