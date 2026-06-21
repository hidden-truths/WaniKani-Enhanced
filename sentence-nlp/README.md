# sentence-nlp — offline GiNZA enrichment for the unified sentence store

The **offline batch** half of the sentence store's NLP phase (Phase 4). It parses the
**public sentence corpus** (curator-owned Self-Talk built-ins + built-in vocab example
sentences) with [GiNZA](https://megagonlabs.github.io/ginza/) and emits a JSON artifact of
per-token structure (lemma / POS / reading / dependency) + bunsetsu spans. A Bun seed step
(`wk-enhanced-api/scripts/seed-annotations.ts`) loads that artifact into the
`sentence_annotation` table.

**Why a separate project (not in `wk-enhanced-api/`):** GiNZA is a heavy Python pipeline
(spaCy + a transformer model + SudachiPy). The $6 production droplet has no Python and can't
host it — NLP runs **offline only**, on a maintainer machine, and its output is a static
artifact loaded at deploy time exactly like `seed-sentences.ts`. Keeping it out of the Bun
repo keeps it out of `bun test` / `tsc` / the Docker image. It still lives in the same git
monorepo so it's versioned alongside the store it feeds.

## The load-bearing contract: token offsets

`sentence_annotation.tokens[].{start,end}` are character offsets into `sentence.text` (the
audio-keyed canonical string), and the study-app maps a tap back to a token by slicing
`text` with them **in JavaScript**. JS slices by UTF-16 code unit; spaCy/GiNZA report
offsets by Unicode codepoint. They agree for every BMP character (all kana, kana
punctuation, and 常用漢字) but diverge by +1 per non-BMP codepoint (rare CJK-Ext-B kanji).

So `parse.py`:

1. Emits **UTF-16 code-unit offsets**, not raw `token.idx` (BMP-safe *and* non-BMP-safe).
2. Self-checks every token by slicing the text's UTF-16-LE bytes (an exact emulation of JS
   `String.prototype.slice`) and asserting it reconstructs the token surface — the artifact
   can't be written unless every offset is JS-sliceable.

The TS seed loader re-asserts `dbText.slice(start,end) === surface` against the real V8
engine before writing — three independent checks on the one contract that makes tap-to-lookup
work.

## Model + decisions

- **Model: `ja_ginza_electra`** (the transformer pipeline). Offline we can afford the heavier
  model; tokenization + lemma + reading come from SudachiPy either way, and ELECTRA adds the
  better dependency parse that the (later) grammar-pattern phase leans on. The exact
  `ginza` + model versions are recorded in the artifact's `parser` field and land in
  `sentence_annotation.parser` — the provenance a re-parse decision keys on.
- **Split mode C** (longest units) — token boundaries closest to dictionary headwords, so a
  tapped token matches the deck's card lemmas. Split-C is still per-MORPHEME, so a
  post-tokenization **merge pass** (next section) coalesces a content word + its inflectional
  tail into one tap unit on top of it.
- **Re-parse strategy: full, hash-keyed.** The corpus is tiny (~577 non-song public sentences), so
  we re-parse the whole exported corpus rather than diffing. Each annotation is keyed by
  `hash = ttsTextHash(text)`, which is environment-independent — so an artifact parsed offline
  on a Mac seeds **prod** correctly (same text → same hash → resolves the prod row). Because
  the parser parses the exact text it read from `public_sentence`, offsets are self-consistent
  with the row by construction; a re-parse can only ever change *quality*, never offset
  correctness.

## Tokenization granularity — the merge pass (SHIPPED)

Split mode C is "longest *morpheme*", not "the word a learner would look up", so the raw GiNZA tokens
fragment the unit a learner taps as ONE word. A post-tokenization **merge pass** (`merge_groups` in
[parse.py](parse.py)) fixes this: each content anchor absorbs the contiguous run of trailing bound
morphemes that inflect it, producing one tap unit per word.

| raw split-C morphemes | merged tap unit | lemma |
|---|---|---|
| 勉強(NOUN) + する(AUX) | 勉強する | 勉強する |
| 食べ + させ + られ + た | 食べさせられた | 食べる |
| 読ん + で + いる | 読んでいる | 読む |
| 説明 + し + て + ください | 説明してください | 説明する |

**The merge rule** (grounded in the actual `ja_ginza_electra` morphology, not POS n-grams): a content
anchor — UPOS ∈ {VERB, ADJ, NOUN, PROPN, PRON, ADV, NUM, INTJ} — absorbs each immediately-following,
**contiguous** token that is a bound trailing morpheme, i.e. one of:

- **UPOS `AUX`** — the する of a サ変-verb (`動詞-非自立可能`, lemma する) + the whole conjugation chain
  (させ / られ / た / ます / たい / だ / です / ない…), all `dep=aux` heading the content word;
- **`dep == fixed`** — a multiword auxiliary component: the verb of 〜ている / 〜ておく / 〜てくる, or 〜てください;
- **the 接続助詞 て/で** (`助詞-接続助詞`) — so it bridges a content verb to its auxiliary (読ん+**で**+いる)
  and a bare て-form (食べて) merges too.

Case/binding particles (は / を / が / に, location-で — UPOS `ADP`, `助詞-格助詞`/`係助詞`) and the
non-て connectives (ながら, から) are NOT bound morphemes, so they break the unit and stay their own
(gap) tokens.

**Lemma** = the anchor's lemma, which is already the dictionary form for verbs/adjectives (食べ→食べる,
高く→高い). A サ変 noun keeps its bare-noun lemma even when it heads the verb (GiNZA marks it `pos=VERB`),
so we append する to recover the dictionary form (勉強 → 勉強する). **Reading** is the concat of the
parts' readings (タベサセラレタ for 食べさせられた).

**The offset contract survives a merge for free:** a group is contiguous by construction, so the merged
surface is exactly `text[anchor.start:last.end]` — `js_slice === surface` still holds, the UTF-16
self-check (`--verify`, incl. a non-BMP sample) passes on merged tokens, and `seed-annotations.ts`'s V8
re-assert carries over. Effect on the corpus: ~24% fewer tap units (8177 → 6224 on the shared rows),
and the provenance string becomes `…splitC+merge`.

**Scope note:** `parse.py` excludes `source='song'` rows — song lines are RUNTIME LLM-annotated
(`parser='llm'`, carrying jlpt/gloss the Mine UI needs) and live outside the offline GiNZA corpus, so
the artifact must never re-seed GiNZA tokens over them. Deferred (acceptable, GiNZA-parse-inherent, not
regressions): 〜たくない splits at the negative adjective (行きたく | ない); かもしれない and other
leading-function-word MWEs aren't absorbed; 〜てくる is inconsistent (空いてきた merges, 持って+きた doesn't).
Each still resolves the content word's correct lemma. The stored **`bunsetsu`** spans remain a possible
coarser *alternative* tap layer (still unconsumed in the client).

## Grammar tags (`patterns.py`)

`parse.py` also runs a **curated N5/N4 grammar-point catalog** ([patterns.py](patterns.py)) over each
Doc and emits the matched ids as `grammar:[…]` per sentence. These are the searchable vocabulary
written to `sentence_tag(kind='grammar')` — `te-oku`, `passive`, `cond-tara`, `counter`, … (38
points). The ids **reuse the study-app's existing `SELFTALK_GRAMMAR` ids** (`te-iru` / `te-oku` /
`tai` / `volitional` / `sou` / `nakya`) so GiNZA-detected tags on example sentences and hand-authored
Self-Talk tags search through one vocabulary.

Detection is a conservative pattern list matched off the parse (lemma / POS / UniDic tag /
inflection), **not** raw POS n-grams. Every detector is pinned in [test_patterns.py](test_patterns.py)
with hand-written positives + confusable negatives (e.g. source-から ≠ reason-から; ように ≠ ようだ
since に is the copula's 連用形; だろう ≠ volitional). Run it after any catalog edit:

```bash
.venv/bin/python test_patterns.py   # all detectors fire on positives, resist negatives
```

The Python parse owns the catalog (full Doc / morph access — e.g. the fused godan volitional 行こう
needs the inflection feature). `seed-annotations.ts` writes the ids to `sentence_tag` for **example**
rows only; Self-Talk keeps its hand-authored grammar tags.

## Usage

```bash
# one-time: create the venv + install (heavy — torch + the electra model)
python3.10 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m spacy validate   # optional: confirm ja_ginza_electra is installed

# verify the offset contract on a small kanji+kana+punctuation (+ non-BMP) sample
.venv/bin/python parse.py --verify

# parse the whole public corpus → the committed artifact the Bun seed reads
.venv/bin/python parse.py \
  --db ../wk-enhanced-api/dev-data/wk-vocab.sqlite \
  --out ../wk-enhanced-api/data/annotations.json
```

`parse.py` reads the `public_sentence` VIEW (public rows only — private user sentences are
physically excluded, so the offline batch can never touch them), minus `source='song'` rows (those
carry runtime LLM annotations the GiNZA artifact must not clobber — see the merge-pass scope note),
and writes one annotation per row, keyed by `hash`. It does **not** write to the DB; the Bun seed
step does.

## Deploy

The artifact (`wk-enhanced-api/data/annotations.json`) is committed to git and ships in the
server's Docker image (like `data/minna/lesson-*.json`). On deploy, after `seed-sentences.ts`,
run `seed-annotations.ts` (same `docker compose run` pattern — see
`wk-enhanced-api/deploy/README.md`). Because annotations resolve by content hash, the
prod rows match the offline parse without re-running Python on the droplet.
