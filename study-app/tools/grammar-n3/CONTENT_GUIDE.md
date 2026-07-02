# grammar-n3 content contract

Each point in [points.json](points.json) gets one `content/<id>.json`:

```json
{
  "id": "<the manifest id, filename must match>",
  "explanation": "2–4 learner-facing sentences: core meaning, nuance, common contrasts/pitfalls (e.g. せいで vs おかげで), politeness notes where relevant.",
  "formation": "Concise attachment note in the 'V-dict / N の + パターン' style.",
  "examples": [ { "jp": "…", "en": "…", "blank": "…" }, "… 3–5 total, aim for 4" ]
}
```

Example rules (enforced by [build.mjs](build.mjs) — run it to check):

- **jp**: natural, everyday N3-level sentence (15–35 chars), escalating difficulty across the
  set, the pattern present in every sentence. EVERY kanji run wears well-formed furigana:
  `<ruby>漢字<rt>かんじ</rt></ruby>` — no nesting, no other tags, okurigana outside the ruby
  (`<ruby>泳<rt>およ</rt></ruby>げる`, not `<ruby>泳げる<rt>およげる</rt></ruby>`).
- **en**: natural English translation, not word-by-word.
- **blank**: the EXACT pattern span to cloze, as it appears in the PLAIN text (ruby stripped).
  Prefer the kana pattern span (e.g. `ようになった`, `わけにはいかない`); it must NOT sit inside a
  ruby base (the cloze would swallow the furigana) and should occur once in the sentence.
- Vocabulary stays ≤N3 where possible; polite/plain register may vary across examples.

Workflow: draft/fix the per-point JSON (NEVER `src/data/grammar-n3.js` — it's generated), then
`node tools/grammar-n3/build.mjs` from `study-app/` to validate + regenerate. Content is
model-drafted → validated → human-proofread before it ships (the examples.js status bar).
