# grammar-n3 content contract

[points.json](points.json) is the **id registry** — the vetted 81-point manifest, one entry
per N3 point: `{ "id", "label", "read", "mean" }` (`id` = durable kebab-case slug, validated
`^[a-z0-9]+(-[a-z0-9]+)*$`; `label` = the display pattern e.g. `〜ようになる`; `read` = kana;
`mean` = short English gloss). **Never rename a shipped id** — grammar cards store it as
`grammarId`, and the wave-2 MCQ banks (below) key on it. The build cross-checks every id against
the GiNZA tagger catalog (`src/data/grammar.json`): an exact collision is an ERROR unless
the point genuinely is the same pattern (then sharing the id is deliberate); near-collisions
just warn.

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
`node tools/grammar-n3/build.mjs` from `study-app/` to validate + regenerate (run
`bun run test` after — `test/grammar-core.test.js` pins catalog invariants over the real
generated module). Content is model-drafted → validated → human-proofread before it ships —
the same generated-content status as `examples.js` / the Minna lesson fields.

## MCQ banks (wave 2 — 文法形式判断)

A point may ALSO have `mcq/<id>.json`, the fill-the-blank question bank. It's optional and
independent: a point with a content file but no bank simply isn't offered in the MCQ drill, and
the two artifacts are built and validated separately. Not every point needs one.

```json
{
  "id": "<the manifest id, filename must match>",
  "questions": [
    {
      "stem": "…<ruby>買<rt>か</rt></ruby>っ＿＿＿なのに、もう<ruby>壊<rt>こわ</rt></ruby>れてしまった。",
      "choices": ["たばかり", "たところ", "たとたん", "たまま"],
      "answer": 0,
      "why": "Why the answer is right AND why the nearest distractor is wrong — this is the teaching."
    }
  ]
}
```

Rules (enforced by [build-mcq.mjs](build-mcq.mjs)):

- **stem**: clean ruby like an example, containing the gap `＿＿＿` **exactly once**. Filled with
  the correct choice it must read as a complete sentence.
- **choices**: exactly **4**, distinct, **plain text** (no ruby/markup — they render inside a
  button). `answer` is the 0-based index. Author them in any order: the drill shuffles both the
  questions and each question's choices, so a fixed answer index teaches nothing.
- **distractors**: other N3 patterns the learner would plausibly confuse with this one
  (ことにする vs ことになる; おかげで vs せいで; たばかり vs たところ) — that confusion IS the exam
  question. A distractor that no one would pick is a wasted slot.
- **why**: ≥20 chars, and worth writing well — the reveal is the only teaching moment the drill
  has. Say why the answer fits *and* why the closest distractor doesn't.
- The build **warns** if the correct choice doesn't look like the point's own pattern (a
  conjugation-tolerant check) or if a distractor also contains it — both usually mean a
  mis-keyed answer or a bank filed under the wrong id.

Rebuild with `node tools/grammar-n3/build-mcq.mjs` → `src/data/grammar-n3-mcq.js` (a separate
lazy chunk from the catalog — see the script header for why). `test/grammar-mcq-core.test.js`
pins bank invariants over the real generated module. Same content status: model-drafted →
validated → **human-proofread before it is exam-trusted**.
