# Song timing sidecars (歌 / Songs)

One JSON file per song, **named to match its `data/songs/<slug>.json`**, holding the per-line video
timing that the seed merges into each lyric line's `clip_start_ms`. Timing is kept **separate** from the
curated lyrics because it's machine-generated, video-specific, and re-derivable — while the lyrics are
hand-curated.

- **Produced by** the offline forced-alignment pipeline [`../../../song-align/`](../../../song-align/)
  (`python3 align.py --song <slug>`), which runs locally (no Python on prod).
- **Consumed by** [`../../scripts/seed-songs.ts`](../../scripts/seed-songs.ts): for each song it loads the
  matching sidecar and sets each line's `clipStartMs` by `ordinal` (via `upsertPublicSong`, which writes
  it onto the public `sentence_link`). A missing sidecar → the song seeds **untimed** (Read + Mine still
  work; synced highlight / per-line replay stay off until timed).

## Format

```jsonc
{
  "extId":   "song-dry-flower-yuuri",   // sanity ref (the seed keys off the filename)
  "videoId": "kzZ6KXDM1RI",             // which video this timing is for
  "model":   "large-v3",                // provenance
  "alignedAt": "2026-06-16T…Z",
  "lines": [
    { "ordinal": 0, "startMs": 12000, "endMs": 15500 }
    // ordinal = the line's 0-based index in data/songs/<slug>.json `lines`.
    // startMs = video position (ms) where the line begins → clip_start_ms.
    // endMs   = advisory only; the app infers a line's end from the next line's start.
  ]
}
```

**No lyric text** lives here — only ordinals + milliseconds. Re-deriving (re-running the aligner) is
always safe; hand-nudging a `startMs` is fine for a line the aligner placed badly. Re-seed after any
change (`bun scripts/seed-songs.ts`), then deploy by re-seeding prod.
