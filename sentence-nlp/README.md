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
  tapped token matches the deck's card lemmas. **(But see "Known limitation" below — split mode C
  is still per-MORPHEME, which fragments する-verbs and conjugations.)**
- **Re-parse strategy: full, hash-keyed.** The corpus is tiny (~544 sentences), so we re-parse
  the whole exported corpus rather than diffing. Each annotation is keyed by
  `hash = ttsTextHash(text)`, which is environment-independent — so an artifact parsed offline
  on a Mac seeds **prod** correctly (same text → same hash → resolves the prod row). Because
  the parser parses the exact text it read from `public_sentence`, offsets are self-consistent
  with the row by construction; a re-parse can only ever change *quality*, never offset
  correctness.

## ⭐ Known limitation → next rework: tokenization granularity

**The headline follow-up.** The tap-to-lookup units are GiNZA's raw morphemes, and split mode C is
"longest *morpheme*", not "the word a learner would look up" — so tapping often selects the wrong span:

- **サ変 する-verbs split:** 勉強する → `勉強`(NOUN) + `する`(VERB) — the compound isn't one tap unit.
- **Conjugations fragment:** 食べさせられた → `食べ`+`させ`+`られ`+`た` (stem resolves the lemma, but the
  inflection is several tiny aux tap-targets).
- **て-form + aux split:** 読んでいる → `読ん`+`で`+`いる` (we *detect* 〜ている as grammar, but the tap
  units stay split).

**The fix is a post-tokenization MERGE pass in `parse.py`** (then re-parse → re-seed, the usual full
hash-keyed loop): coalesce a content word + its trailing function morphemes into one token — サ変名詞+する
→ `勉強する`; verb/adj stem + inflectional aux chain → one token spanning the conjugated surface (lemma =
dictionary form); optionally te-form + auxiliary. The **`bunsetsu` spans we already emit** (content word +
its particles/aux, currently unconsumed in the client) are a natural merge basis or a coarser alternative
tap layer. The offset contract is preserved automatically — a merged token's surface is the contiguous
concat of its parts, so `text.slice(start,end) === surface` still holds and the UTF-16 self-check + seed
re-assert carry over. (Merging also changes lemmas — `勉強する` vs `勉強` — so tune tap→card matching with it.)

## Grammar tags (`patterns.py`)

`parse.py` also runs a **curated N5/N4 grammar-point catalog** ([patterns.py](patterns.py)) over each
Doc and emits the matched ids as `grammar:[…]` per sentence. These are the searchable vocabulary
written to `sentence_tag(kind='grammar')` — `te-oku`, `passive`, `cond-tara`, `counter`, … (~37
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
physically excluded, so the offline batch can never touch them) and writes one annotation per
row, keyed by `hash`. It does **not** write to the DB; the Bun seed step does.

## Deploy

The artifact (`wk-enhanced-api/data/annotations.json`) is committed to git and ships in the
server's Docker image (like `data/minna/lesson-*.json`). On deploy, after `seed-sentences.ts`,
run `seed-annotations.ts` (same `docker compose run` pattern — see
`wk-enhanced-api/deploy/README.md`). Because annotations resolve by content hash, the
prod rows match the offline parse without re-running Python on the droplet.
