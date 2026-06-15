# Starter songs (歌 / Songs tab)

Curated **CC / public-domain / Vocaloid** songs seeded as PUBLIC (anon-readable) starter rows by
[`../../scripts/seed-songs.ts`](../../scripts/seed-songs.ts). One JSON file per song.

**Only genuinely free-to-redistribute lyrics belong here.** BYO copyrighted lyrics are PRIVATE
per-user rows written live via `POST /v1/songs` — never seeded here. The master audio is always the
embedded YouTube player (`youtubeId`), never a stored file.

## Format

```jsonc
{
  "extId": "song-<slug>",        // stable id; the record-compare itemKey prefix + Source-facet token
  "title": "故郷",
  "artist": "… (public domain)", // attribution; nullable
  "youtubeId": "oRdxUFDoQe0",    // embed source; null is fine (a reader-only starter)
  "lines": [
    { "jp": "<ruby>兎<rt>うさぎ</rt></ruby>…", "en": "…", "grammar": ["te-iru"] }
    // `jp` carries <ruby> furigana (CARDS.md format); the seed derives plainText + structured
    // segments via core/text.js. `en` + `grammar` (catalog ids) are optional.
  ]
}
```

Seeded lines carry **no tap-to-lookup tokens** (those come from the runtime LLM analysis, which the
seed doesn't run) — they render as plain ruby until an analysis pass annotates them. That's the same
degradation as a freshly user-authored phrase. Re-seeding is idempotent (by `extId`).

Run after editing: `bun scripts/seed-songs.ts` (from `wk-enhanced-api/`). Curation of the full
starter set is a deferred content pass — see [study-app/SONGS.md](../../../study-app/SONGS.md).
