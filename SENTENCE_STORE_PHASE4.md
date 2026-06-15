# Sentence Store — Phase 4 (NLP Enrichment): Status & Handoff

The detailed as-built record for **Phase 4** of the unified sentence store, plus the full plan
for **commit 3** (the remaining work). Companion to the overview/brief
[SENTENCE_STORE_NLP.md](SENTENCE_STORE_NLP.md); same family as the shipped
[SENTENCE_STORE_PHASE1.md](docs/history/SENTENCE_STORE_PHASE1.md) / [SENTENCE_STORE_PHASE2.md](docs/history/SENTENCE_STORE_PHASE2.md)
plans. If you are picking this work up cold, read the brief first, then this.

**Branch:** `sentence-store-phase4` · **Commits:** `f1e4f60` (1), `75f7972` (2), `8a20db6` (3a),
`24558f9` (3b), 3c. Commits 1/2/3a were behavior-preserving + additive; 3b/3c are the user-visible
study-app payoff (tap-a-word lookup + grammar filter). **Phase 4 is complete.**

---

## 0. TL;DR — where we are right now

- **Commit 1 (shipped):** an OFFLINE GiNZA parser project ([sentence-nlp/](sentence-nlp/)) parses the
  public sentence corpus and emits a committed JSON artifact of per-token structure (lemma / POS /
  reading / dependency) + bunsetsu spans, keyed by content hash. A Bun seed step loads it into the
  `sentence_annotation` table. The **token character offsets are UTF-16 code units** (not codepoints)
  so they line up with JS string slicing — verified empirically and gated on write.
- **Commit 2 (shipped):** a curated **~38-point N5/N4 grammar catalog** (Bunpro-grounded) is detected
  during the same parse and written to `sentence_tag(kind='grammar')` for example rows, reusing the
  study-app's existing `SELFTALK_GRAMMAR` ids so auto-detected and hand-authored grammar tags search
  one vocabulary. Every detector is pinned with positives + confusable negatives.
- **Commit 3 (in progress):** surface it in the study-app. **3a (server, ✅ shipped):** annotations
  serve on `GET /v1/sentences?annotate=1` via `getSentences({includeAnnotations})` — see §7a. **3b
  (client, ✅ shipped):** tap-a-word → lemma/POS/reading → card-or-Jisho lookup (pure `overlayTokens`
  span-wrap over the ruby + a stateless popover) — see §7b. **3c (client, ✅ shipped):** a grammar
  filter in Browse (card facet over the example tags) + a `patterns.py`-dumped label registry — §7c.
  **All of commit 3 is done; Phase 4 is complete.**
- **Grammar is ALREADY being served** (it rides `tags.grammar` on the existing `getSentences` read —
  see §5.4). Only the token **annotation** needed the new serving flag (3a). The client just doesn't
  *use* either yet (3b/3c).

The server (the $6 prod droplet) **only ever reads** this data. All parsing is an offline batch on a
maintainer machine, loaded at deploy time exactly like `seed-sentences.ts`. There is no Python in prod.

---

## 1. What this is & where it fits

The unified sentence store keeps one canonical `sentence` row per Japanese sentence; every surface
references it by id. Phase 4 layers GiNZA-derived structure on top so a user can **tap a word** in any
sentence and get its lemma / POS / a link to the matching card-or-Jisho, plus **grammar search**
("find every sentence using 〜ておく").

Phase map (full version in the brief):

| Phase | Scope | Status |
|---|---|---|
| 1 | Self-Talk phrases → store | ✅ shipped + deployed |
| 2 | Built-in vocab `examples.js` → store (public, linked to cards) | ✅ shipped + deployed |
| 2.5 | Custom-card `ex` → private rows | ⏳ deferred |
| 3 (Minna) | Minna sentences → store (`public=0`) | ⏳ deferred |
| **4 — NLP** | **GiNZA enrichment: `sentence_annotation` + grammar tags + tap UI** | **🔜 commits 1–2 done, commit 3 next** |

The NLP target is the **public corpus** (Phase 1 + 2 rows: built-in example sentences + Self-Talk
built-ins) — a bounded, curator-owned set we can parse once and re-parse on content change. Private
user sentences are out of scope for batch NLP (no offline access; live parsing needs the Python
service we ruled out).

---

## 2. Commit 1 — offline parser + `sentence_annotation` load path (`f1e4f60`)

### 2.1 The offline parser project — `sentence-nlp/`

A **standalone Python project at the repo root**, deliberately NOT inside `wk-enhanced-api/` (so it
stays out of `bun test` / `tsc` / the Docker image). It lives in the same git monorepo so it's
versioned alongside the store it feeds.

| File | Role |
|---|---|
| [sentence-nlp/parse.py](sentence-nlp/parse.py) | The parser. Reads the `public_sentence` view, parses each sentence with `ja_ginza_electra`, emits the artifact. `--verify` mode proves the offset contract on a sample; `--limit N` parses a subset. |
| [sentence-nlp/patterns.py](sentence-nlp/patterns.py) | (commit 2) the grammar catalog + detectors. |
| [sentence-nlp/test_patterns.py](sentence-nlp/test_patterns.py) | (commit 2) the detector validation battery. |
| [sentence-nlp/requirements.txt](sentence-nlp/requirements.txt) | Pinned deps: `ginza==5.2.0`, `ja-ginza-electra==5.2.0`, `click>=8.1`. |
| [sentence-nlp/README.md](sentence-nlp/README.md) | The project's own docs (offset contract, model rationale, grammar tags, usage). |
| `sentence-nlp/.venv/` | The virtualenv (gitignored — heavy: torch + the electra model). |
| `sentence-nlp/out/` | Scratch (gitignored, e.g. `out/install.log`). |

**Model decision: `ja_ginza_electra`, split mode C.** Both `ja_ginza` and `ja_ginza_electra` tokenize
with SudachiPy and pull lemma + reading from the same Sudachi dictionary — identical for the headline
tap-to-lookup feature. ELECTRA only adds a better dependency parse, which the grammar phase leans on;
offline we can afford the transformer. Split mode C (longest units) gives token boundaries closest to
dictionary headwords, so a tapped token matches the deck's card lemmas. The exact versions are recorded
in the artifact's `parser` field: **`ja_ginza_electra/5.2.0 ginza/5.2.0 splitC`**.

> The ELECTRA transformer weights are fetched from the HuggingFace hub on the first
> `spacy.load('ja_ginza_electra')` and cached under `~/.cache/huggingface` — so the first run needs
> network; later runs are offline.

### 2.2 THE load-bearing thing: the offset contract

`sentence_annotation.tokens[].{start,end}` are character offsets into `sentence.text` (the audio-keyed
canonical plain text). The study-app maps a tap/highlight back to a token by **slicing `text` in
JavaScript**. JS slices by **UTF-16 code unit**; spaCy/GiNZA's `token.idx` is a **Unicode codepoint**
offset. They are equal for every BMP character — all kana, kana punctuation, and 常用漢字 — but diverge
by **+1 per non-BMP codepoint** (rare CJK-Ext-B kanji like 𠮟 U+20B9F, a surrogate pair in JS).

A BMP-only spot check passes and hides the bug. We verified empirically: `母は毎日料理します。` has JS
`.length` == codepoints (10 == 10), but **`𠮟られた。` is JS length 6 vs 5 codepoints** — and raw
codepoint offsets would place `。` at 4, so `text.slice(4,5)` in JS returns `た`, not `。`. A real,
silent corruption that only bites on rare kanji.

**Resolution — three independent checks on the one contract:**
1. `parse.py` emits **UTF-16 offsets** (converts via the UTF-16-LE byte length of the prefix), and
   self-checks every token by slicing the UTF-16-LE bytes (an exact emulation of JS `String.slice`)
   and asserting it reconstructs the token surface. The artifact cannot be written if any token fails.
2. The seed loader's `db.upsertAnnotation` **re-asserts `text.slice(start,end) === surface`** against
   the real V8 engine on every write — a malformed artifact throws and aborts the seed (and deploy).
3. A non-BMP **pin test** in `client.test.ts` asserts that the codepoint offsets a naive parser *would*
   emit are REJECTED.

This is recorded as a DEAD-END in [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md): *"do not
'simplify' the parser to emit `token.idx`."*

### 2.3 The artifact — `wk-enhanced-api/data/annotations.json`

Produced offline, **committed to git**, ships in the server's Docker image (like
`data/minna/lesson-*.json`). One annotation per line (compact internals, so a content change is a
one-line diff). Shape:

```jsonc
{
  "parser": "ja_ginza_electra/5.2.0 ginza/5.2.0 splitC",
  "annotations": [
    {
      "hash":  "<40-char ttsTextHash(text) — the env-independent resolution key>",
      "ext_id":"ex-<hash> | st-* | usr-*",
      "text":  "母は毎日料理します。",   // echoed so the seed can guard against a stale artifact
      "tokens":[ {"i":0,"start":0,"end":1,"surface":"母","lemma":"母","pos":"NOUN",
                  "tag":"名詞-普通名詞-一般","reading":"ハハ","dep":"nsubj","head":3}, … ],
      "bunsetsu":[ {"start":0,"end":2}, {"start":2,"end":4}, {"start":4,"end":10} ],
      "grammar":[ "te-iru", … ]        // commit 2; [] when no Tier-1 grammar matched
    }, …
  ]
}
```

- `start`/`end` are **UTF-16 offsets**. `lemma` (dictionary form, 食べた→食べる) drives the card/Jisho
  link; `reading` is GiNZA's (the *visible* reading still comes from the stored `furigana`). `tag` is
  the rich UniDic POS; `dep`/`head` are the dependency parse (used by the commit-2 grammar detectors).
- `bunsetsu` = phrase-chunk spans (also UTF-16 offsets), stored now, **not yet consumed** (future
  phrase-level highlighting / pattern matching).
- Whitespace tokens are dropped (`is_space`) — never a tap target. GiNZA represents inter-word spaces
  as `token.whitespace_` metadata, not separate tokens, so offsets stay gap-correct.

Current artifact: **544 annotations, 8177 tokens.**

### 2.4 DB plumbing — [wk-enhanced-api/src/db/client.ts](wk-enhanced-api/src/db/client.ts)

- **`VIEWER_VISIBLE`** — the privacy predicate `(s.public = 1 OR s.created_by = ?)` extracted into ONE
  SQL fragment, now shared by `getSentences` AND `getAnnotation` so the gate can't drift. Binds one
  param (the viewer id; null → public only, fail-closed). This is the literal realization of the
  choke-point requirement.
- **`AnnotationToken` / `AnnotationBunsetsu` / `SentenceAnnotation`** — exported types.
- **`assertAnnotationOffsets(tokens, text)`** — the offset gate (throws on any `slice !== surface`).
- **`upsertAnnotation({sentenceId, tokens, bunsetsu, parser})`** — seed-side write by numeric id;
  validates offsets against the sentence's stored text before writing; idempotent (ON CONFLICT).
  No privacy gate on the *write* (the offline batch only annotates public rows; the gate is on reads).
- **`getAnnotation({extId, viewer})`** — gated read applying `VIEWER_VISIBLE`. Returns a private row's
  annotation only to its owner; null for anon/other-user OR for a visible-but-unparsed sentence (the
  two are indistinguishable → no existence leak).

### 2.5 The seed — [wk-enhanced-api/scripts/seed-annotations.ts](wk-enhanced-api/scripts/seed-annotations.ts)

Mirrors `seed-sentences.ts`. Reads the committed artifact, resolves each annotation to its sentence
**by content `hash`** (`getPublicSentenceByHash`) — which is environment-independent, so a Mac-parsed
artifact seeds **prod** correctly (same text → same hash → resolves the prod row). Guards against a
stale artifact (DB text must equal the artifact's echoed text). `upsertAnnotation` re-asserts the
offset contract, so a bad artifact aborts. **Must run as a deploy step AFTER `seed-sentences.ts`**
(the sentence rows must exist first).

### 2.6 Tests (commit 1)

In [wk-enhanced-api/src/db/client.test.ts](wk-enhanced-api/src/db/client.test.ts), describe block
*"sentence_annotation (NLP enrichment) — offset contract + privacy"*:
- offset-integrity (slice === surface enforced on write),
- **non-BMP contract pin** (codepoint offsets across 𠮟 are REJECTED; UTF-16 accepted),
- **privacy pin** (a private row's annotation is owner-only, never anon/other-user),
- idempotency + round-trip, null cases, FK cascade.

---

## 3. Commit 2 — N5/N4 grammar-tag catalog (`75f7972`)

### 3.1 The catalog — [sentence-nlp/patterns.py](sentence-nlp/patterns.py)

A curated **38-point N5/N4 catalog**, grounded in Bunpro's
[N5](https://bunpro.jp/decks/nn10ai/Bunpro-N5-Grammar) /
[N4](https://bunpro.jp/decks/m7omkx/bunpro-n4-grammar) decks, **N5/N4-weighted** per the maintainer's
priority. Each entry = `{id, label, jlpt, detect(doc)->bool}`. The `id`s **reuse the study-app's
existing `SELFTALK_GRAMMAR` ids** (`te-iru` / `te-oku` / `tai` / `volitional` / `sou` / `nakya`) so
GiNZA-detected example tags and hand-authored Self-Talk tags search through one vocabulary.

Detection is a **conservative pattern list matched off the parse** (lemma / POS / UniDic tag /
inflection), NOT raw POS n-grams. The Python parse owns it because it has full Doc/morph access (e.g.
the fused godan volitional 行こう needs the inflection feature).

The 38 ids (catalog/display order), with form and JLPT:

| Group | ids (`〜form`, JLPT) |
|---|---|
| て-compounds | `te-iru`(〜ている N5) `te-oku`(〜ておく N4) `te-shimau`(〜てしまう N4) `te-miru`(〜てみる N4) `te-kudasai`(〜てください N5) `te-mo-ii`(〜てもいい N5) `te-wa-ikenai`(〜てはいけない N5) |
| voice / aux | `passive`(〜れる・られる N4) `causative`(〜せる・させる N4) `potential`(可能 N4) `tai`(〜たい N5) `volitional`(〜よう N4) `sugiru`(〜すぎる N5) |
| desire / obligation / ability | `hoshii`(〜がほしい N4) `nakya`(〜なきゃ/なければ N4) `hou-ga-ii`(〜ほうがいい N5) `ta-koto-ga-aru`(〜たことがある N5) `koto-ga-dekiru`(〜ことができる N4) `tsumori`(〜つもり N5) |
| conditionals | `cond-ba`(〜ば N4) `cond-tara`(〜たら N4) `cond-to`(〜と N4) `cond-nara`(〜なら N4) |
| evidential / modal | `sou`(〜そう N4) `you-da`(〜ようだ N4) `rashii`(〜らしい N4) `hazu`(〜はずだ N4) `kamoshirenai`(〜かもしれない N4) `to-omou`(〜と思う N4) |
| connectives / scope | `kara-reason`(〜から理由 N5) `node`(〜ので N5) `noni`(〜のに N4) `nagara`(〜ながら N4) `tari`(〜たり N5) `shi`(〜し N4) `counter`(数+助数詞 N5) `shika-nai`(〜しか〜ない N4) `dake`(〜だけ N5) |

`sou` is kept **unified** (not split into 様態/伝聞) to match the existing id. `detect_grammar(doc)`
returns the matched ids in catalog order.

### 3.2 Detection learnings / dead-ends (validated against the live model + real corpus)

These are the non-obvious traps. **Don't re-derive them — they're encoded in `test_patterns.py`
negatives.**

- **passive vs potential can't be split.** れる/られる are ONE morpheme in GiNZA (no passive/potential
  distinction in UniDic; the difference is syntactic/semantic). Decision: `passive` tags れる/られる
  (most textbook uses ARE passive); `potential` tags only the unambiguous periphrastic forms
  (ことができる / 見える / 聞こえる / できる). A ことができる sentence gets both `potential` and
  `koto-ga-dekiru` (correct — it is a potential expressed via ことができる).
- **Particle senses split on the UniDic tag, not the lemma.** から reason vs source, と conditional vs
  case, が contrastive vs subject — all share a lemma but differ by tag (`助詞-接続助詞` vs
  `助詞-格助詞`). Confirmed on the corpus: から reason 45 / source 44; と cond 43 / case 97.
- **The voiced te-form connective is で〔接続助詞〕, not て** (読ん**で**いる). `_is_te` accepts て OR で
  with the 接続助詞 tag — distinct from で〔格助詞〕(at/in/by) and the で in ので.
- **〜すぎる fuses under split mode C** (食べ過ぎ → one token, lemma `食べ過ぎる`, tag 非自立可能). Match
  a lemma *ending* in 過ぎる/すぎる with 非自立可能 (which excludes the standalone 過ぎる "to pass").
- **The volitional morph path must EXCLUDE the presumptive copula.** 行こう is a single godan verb in
  意志推量形 (the morph win), but だろう/でしょう share that form / the う AUX and are NOT volitional
  (lemma だ/です). Excluding them dropped the count 75 → 68.
- **ようだ must exclude ように / ような.** The に in ように and the な in ような are BOTH the copula だ's
  連用形 / 連体形 (lemma `だ`!), so a naive `lemma in {だ,です}` check mis-fires on ようにする/ようになる.
  Excluding orth `に` + `な` dropped the count **44 → 1** (the survivor is a legit ようでは). This was
  the most important catch.
- **ので / のに = `の〔準体助詞〕` + で/に**, not 接続助詞. **たり/だり = `副助詞`** (voiced だり after
  ん-stems). **たら/なら** tokenize as single tokens (surface たら lemma た; surface なら lemma だ).

### 3.3 Validation — [sentence-nlp/test_patterns.py](sentence-nlp/test_patterns.py)

A self-contained battery (no pytest dep; loads the model once, exits non-zero on any miss): **one+
positive sentence per id** (the slug MUST fire) + **10 confusable negatives** (source-から ≠ reason;
case-と ≠ cond; てほしい ≠ hoshii; なければ ≠ cond-ba; らしい接尾辞 ≠ 推量; だろう/でしょう ≠
volitional; ような/ように ≠ you-da). All 38 detectors + 10 negatives green.

### 3.4 Wiring — `setGrammarTags` + the no-clobber scope

- **`db.setGrammarTags(sentenceId, values)`** ([client.ts](wk-enhanced-api/src/db/client.ts)) — replaces
  ONLY `kind='grammar'` rows for a sentence (scene/topic preserved), idempotent (delete-then-insert).
- `parse.py` emits `grammar:[ids]` per sentence; `seed-annotations.ts` writes them via `setGrammarTags`
  **for `source='example'` rows only**. Self-Talk rows keep their curated **hand-authored** grammar
  tags (the artifact computes grammar for them too, but the seed skips writing it — no provenance
  column, so we don't clobber curator intent).
- Token annotations (`upsertAnnotation`) are written for **all** public rows (tap-to-lookup should work
  on Self-Talk sentences too); only the grammar *sentence_tag* write is scoped to examples.

### 3.5 Corpus results (current dev DB)

- 544 sentences parsed → **409/544 tagged** with ≥1 grammar id, **656 total tags**, 35/38 ids present
  in this corpus.
- Seeded to DB: **597 grammar tags on 366 example rows** (source='example'); Self-Talk's 44 rows / 53
  hand tags untouched.
- 3 ids (`rashii`, `kamoshirenai`, `shi`) are **validated but absent in this corpus** — they'll fire on
  appropriate content (Self-Talk, future Minna). Not a gap.
- Top ids: passive 81, te-iru 74, volitional 68, te-shimau 47, kara-reason 45, you-da 1(post-fix),
  cond-to 43, node 43, cond-ba 36, tai 28, …

---

## 4. Architecture / data flow

```
                          OFFLINE (maintainer Mac, Python 3.10 venv)        |   PROD ($6 droplet, Bun only)
                                                                            |
 public_sentence view ──read──► parse.py (ja_ginza_electra, split C)        |
   (id, ext_id, hash, text)        │  per sentence:                         |
                                   │   • tokens[] (UTF-16 offsets, self-checked)
                                   │   • bunsetsu[]                          |
                                   │   • grammar[]  (patterns.py)            |
                                   ▼                                         |
                       data/annotations.json  ──commit to git──►  ships in Docker image
                       (keyed by content hash)                              │
                                                                            ▼
                                                          seed-annotations.ts (deploy step, after seed-sentences.ts)
                                                            • resolve row by hash (getPublicSentenceByHash)
                                                            • upsertAnnotation  → sentence_annotation  (offset gate re-asserts)
                                                            • setGrammarTags    → sentence_tag(kind='grammar')  [example rows]
                                                                            │
                                                                            ▼
                                            server READS only:  getSentences (tags.grammar rides along)
                                                                getAnnotation (VIEWER_VISIBLE gate)
                                                                            │
                                                                            ▼
                                                         study-app  ──(commit 3: tap UI + grammar filter)──►  user
```

---

## 5. Invariants & contracts (any future change must preserve)

1. **Offset contract.** `tokens[].{start,end}` are UTF-16 offsets into `sentence.text`; every token
   reconstructs its surface under JS slicing. Enforced at parse time + on every DB write. Never emit
   raw codepoint `token.idx`.
2. **Privacy choke-point.** Every annotation/sentence read shares the `VIEWER_VISIBLE` predicate
   (`public=1 OR created_by=:viewer`, fail-closed). The pinned breach tests in `client.test.ts` must
   stay green. Any commit-3 serving path must ride this gate.
3. **Hash-keyed seeding.** Annotations resolve to rows by `hash = ttsTextHash(text)`, environment-
   independent. `text` must stay `plainText(jp)` byte-for-byte and `hash` server-computed, or audio +
   annotation linkage forks.
4. **Re-parse = full + hash-keyed.** On any content change, re-run `parse.py` over the whole exported
   corpus (it's ~544 sentences). Because the parser parses the exact exported text, offsets are self-
   consistent with the row by construction — a re-parse only ever changes *quality*.
5. **No-clobber.** Grammar `sentence_tag` is written for `source='example'` rows only; Self-Talk keeps
   its hand-authored tags.
6. **Grammar already rides `getSentences`.** `assembleSentenceRow` reads `sentence_tag`, and
   `ARRAY_TAG_KINDS` includes `'grammar'`, so every `getSentences` result already carries
   `tags.grammar: string[]`. The example fetch (`GET /v1/sentences?ownerType=card`) therefore *already*
   returns grammar to the client — commit 3's grammar filter is a *client*-side feature; no new server
   read is needed for grammar (only for the token annotation).

---

## 6. Operational runbook

### 6.1 Environment specifics (this machine)
- **Python:** `/opt/homebrew/bin/python3.10` (3.10.x). The system `python3` is 3.14 — too new for the
  spaCy/torch wheels; **use 3.10 for the venv.**
- **venv:** `sentence-nlp/.venv` (already created, gitignored). Recreate from `requirements.txt` if
  missing. Note `click>=8.1` is pinned explicitly (typer 0.26.x doesn't pull it but spaCy imports it).
- **Dev DB:** `wk-enhanced-api/dev-data/wk-vocab.sqlite` (NOT the `wk-enhanced-api.sqlite` the parity
  table names — the actual `DATABASE_FILE` in `.env` is `wk-vocab.sqlite`). 544 public_sentence rows.
- **Running servers:** dev API on `:3000` and Vite on `:5173` are usually already up. **Don't kill
  them.** The seed scripts use SQLite WAL (concurrent-safe with the running server).
- **Gotcha:** the Bash tool's cwd persists between calls — always `cd` explicitly before
  `.venv/bin/python …` (in `sentence-nlp/`) vs `bun …` (in `wk-enhanced-api/`).

### 6.2 Re-parse + re-seed (after any catalog or corpus change)
```bash
# 1) (re)parse offline → regenerate the committed artifact
cd sentence-nlp
.venv/bin/python test_patterns.py     # gate: all detectors green (only if patterns changed)
.venv/bin/python parse.py             # → ../wk-enhanced-api/data/annotations.json
python3 patterns.py                   # → ../study-app/src/data/grammar.json (id→label catalog; no venv
                                      #    needed — ginza is lazy). Re-run after ANY CATALOG change so
                                      #    the study-app's grammar-filter labels can't drift.

# 2) load into the DB (dev: the running server's sqlite; prod: a deploy step)
cd ../wk-enhanced-api
bun scripts/seed-annotations.ts       # writes sentence_annotation + sentence_tag(grammar) for examples
```
`parse.py --verify` proves the offset contract on a built-in sample without touching the DB.

### 6.3 Deploy (prod)
Same pattern as `seed-sentences.ts` (see [wk-enhanced-api/deploy/README.md](wk-enhanced-api/deploy/README.md)):
the artifact ships in the image; on deploy run `seed-sentences.ts` THEN `seed-annotations.ts` against
the prod sqlite (`docker compose run -v /opt/wk-enhanced-api:/repo …`). No Python needed on the droplet.

### 6.4 Gates before any commit (in `wk-enhanced-api/`)
```bash
bun test           # currently 185 pass
bun run typecheck  # tsc --noEmit, clean
```
One logical change → one commit. Commit at the end of a feature without being asked. Fix stale nearby
comments in the same commit.

---

## 7. Commit 3 — serve + study-app UI (NEXT, not started)

The remaining, user-visible work. Bigger than 1–2 because it touches the **study-app frontend** and is
browser-verified. Recommend splitting into **3a (server) → 3b (tap UI) → 3c (grammar filter)** with the
open decisions settled with the user first (same collaborative pattern as commits 1–2).

### 7a. Serving the token annotation (server-only) — ✅ SHIPPED
- **`getSentences`** gained an opt-in `includeAnnotations` ([client.ts](wk-enhanced-api/src/db/client.ts)):
  it `LEFT JOIN sentence_annotation a ON a.sentence_id = s.id` **inside** the existing
  `VIEWER_VISIBLE`-gated query (the literal route-through the choke-point) and attaches `annotation?`
  to each `AssembledSentence` only when the row is parsed. Off by default → existing payloads byte-identical.
  Grammar needed no work — it already rides `tags.grammar`.
- **Route** [routes/sentences.ts](wk-enhanced-api/src/routes/sentences.ts): `GET /v1/sentences?annotate=1`
  (a plain optional string → `=== '1'`, so any other value is just "off", never a 400).
- **Schema** [schemas.ts](wk-enhanced-api/src/schemas.ts): `AnnotationToken`/`AnnotationBunsetsu`/
  `SentenceAnnotation` schemas + an optional `annotation` field on `SentenceSchema`.
- **Test** ([client.test.ts](wk-enhanced-api/src/db/client.test.ts)): a breach pin — the join never leaks
  a private row's annotation to anon/another-user, the owner sees their own, no `annotation` field
  without the flag, and a visible-but-unparsed row carries none (no existence leak). `bun test` 186 pass,
  `typecheck` clean; curl-verified on dev (`毎日…` → 6 tokens w/ UTF-16 offsets; no flag → no field).

### 7b. Tap-to-lookup UI (study-app) — ✅ SHIPPED
- **Fetch:** `features/examples.js` + Self-Talk now request `?annotate=1`. The adapters carry the new
  data: `sentencesToLevels` ([core/examples.js](study-app/src/core/examples.js)) puts a THIRD tuple
  element `meta = { furigana, tokens?, grammar? }` on `state.exampleLevels[rank][tier] = [jp, en, meta]`
  (old `[0]/[1]` readers + a stale `jpverbs_examples_cache` are unaffected → plain ruby fallback;
  Decision 4, no key bump); `sentenceToPhrase` ([core/selftalk.js](study-app/src/core/selftalk.js))
  adds `furigana` + `tokens`.
- **The hard part — span-wrap over ruby (Decision 2).** Pure `overlayTokens(furiganaSegments, tokens)`
  ([core/annotate.js](study-app/src/core/annotate.js)): a `<span class="extok" data-lemma data-pos
  data-reading>` per tappable token, ruby kept WHOLE inside the token covering its start (readings are
  indivisible), plain runs sliced only at token boundaries (valid UTF-16 boundaries → 𠮟 never torn),
  everything escaped (safe on the user-authored Self-Talk path), punctuation left bare. Pinned in
  `test/core.test.ts`: ruby-inside-token, non-BMP, gap, empty, escaping, and a strip-spans round-trip.
- **Interaction:** `wireWordTaps` ([features/word-lookup.js](study-app/src/features/word-lookup.js)) —
  a stateless delegated tap on a stable container reads lemma/POS/reading off the span and shows a
  popover; resolves the LEMMA against `state.BUILTIN_RANK_BY_JP` + `state.DATA` → `openVerbDetail`,
  else `jishoUrl(lemma)`. `plainText` extended to strip the spans so `#exSpeak`/`#exCopy` still read
  the bare sentence (TTS key from span-free curated text unchanged).
- **Renders on:** flashcard answer side, Browse detail modal, Self-Talk built-ins (user-authored
  private phrases aren't parsed offline → plain ruby). The example stays answer-side only.
- **Verified:** `bun run test` 93 pass; production build clean (the browse⇄word-lookup runtime cycle
  resolves); browser-checked via preview (injected a real annotated example through the live module
  graph) — overlay renders 5 aligned spans with ruby + 。 unwrapped, popover shows 日本語/にほんご/Noun →
  Jisho, する/Verb → "Open card →" opens the する card. See the study-app/CLAUDE.md dead-end.

### 7c. Grammar-search filter (study-app) — ✅ SHIPPED
- **Surface (Decision 3 → card facet in Browse).** A `Grammar` chip row in Browse
  ([browse.js](study-app/src/features/browse.js) `renderGrammarChips`) narrows the grid to cards whose
  EXAMPLE sentences use the selected point(s) — `cardGrammar(v)` / `cardMatchesGrammar(v, ids)` (pure,
  core/examples.js) union a card's per-tier `meta.grammar` and OR the selection; the grid filter ANDs
  it with `passes(v, bcfg)`. Chips render only the ids present in the deck (ordered N5-first), the row
  hides when none, and the recap line gains a `grammar: …` part. Detail-modal examples also show their
  grammar points as read-only chips (`#dExGram`) for discoverability. Reuses `.chip`/roving (the boot
  `.chips` pass covers the row); a delegated click on the stable container survives chip rebuilds.
- **id→label registry (committed catalog JSON, the chosen no-drift option).** `patterns.py` gained a
  `dump_catalog()` + a `__main__` so `python3 patterns.py` writes
  [study-app/src/data/grammar.json](study-app/src/data/grammar.json) (`[{id,label,jlpt}]`×38) — `ginza`
  is now lazy-imported so the dump needs NO venv. [data/grammar.js](study-app/src/data/grammar.js)
  imports it (`grammarLabel`/`grammarJlpt`/`orderGrammar`/`GRAMMAR_CATALOG`), and `SELFTALK_GRAMMAR` is
  re-expressed as the 6 teaching ids deriving their labels from the catalog — so Self-Talk chips,
  auto-detected example tags, and the Browse filter are ONE vocabulary that can't drift from the detectors.
- **Verified:** `bun run test` 95 pass; build clean; browser-checked via preview — the row shows
  〜ている/〜ておく/volitional, picking 〜ておく narrows the grid to the tagged card + recap reads
  "Filtering: grammar: 〜ておく", detail chips render. (A real bug surfaced here: `filterSummary` returns
  an array of parts, not a string — fixed.)

### 7d. Open decisions — ALL SETTLED (with the user, 2026-06-13)
1. **Serving flag shape** → `includeAnnotations` on `getSentences` + `?annotate=1` (3a).
2. **Tap-render approach** → span-wrap each token over the ruby (3b).
3. **Grammar-filter surface** → card facet in Browse; **registry** → committed catalog JSON dumped by
   `patterns.py` (3c).
4. **Cache busting** → tolerant readers, NO key bump — the new data is optional (`meta`/`tokens`), old
   `[jp,en]` / cached phrases stay valid and the next online boot repopulates the enriched shape (3b).

---

## 8. Deferred / future

### 8.0 ⭐ MAJOR NEXT STEP — tokenization granularity (the tap units don't match "a word")
**Status: the headline follow-up; the maintainer flagged the current parse as not behaving as wanted.**
The tap-to-lookup units come straight from GiNZA's morphemes (split mode C). C was chosen so a token's
lemma sits near a dictionary headword (good for tap→card) — but "longest *morpheme*" still fragments the
units a learner thinks of as ONE word, so tapping a word often selects the wrong span:
- **サ変 する-verbs split:** 勉強する → `勉強`(NOUN) + `する`(VERB). Tapping the compound gets the bare
  noun or the generic する, never 勉強する. (The canonical complaint.)
- **Conjugations fragment:** an inflected form becomes stem + an auxiliary chain — 食べさせられた →
  `食べ`+`させ`+`られ`+`た`. The stem resolves the lemma, but the inflection is several tiny aux tap-
  targets and the visible word isn't one unit.
- **て-form + aux split:** 読んでいる → `読ん`+`で`+`いる`. We DETECT 〜ている as grammar, but the *tap*
  units are still split.

**The rework (a `parse.py` change → re-parse → re-seed; offsets self-consistent by construction):** add a
post-tokenization **merge pass** that coalesces a content word + its trailing function morphemes into one
tap unit — merge サ変名詞+する → one `勉強する` token; merge a verb/adj stem + its inflectional aux chain
into one token spanning the whole conjugated surface (lemma = dictionary form); optionally merge the
て-form + auxiliary (coordinated with the grammar detectors). We **already store `bunsetsu` spans**
(currently unconsumed) — a bunsetsu (content word + its particles/aux) is close to the learner's "word/
phrase" unit and is a natural basis for the merge, or a coarser *alternative* tap layer. The offset
contract still holds (a merged token's surface is the contiguous concat of its parts → `slice===surface`),
and the UTF-16 self-check + the seed re-assert carry over unchanged.
**Interaction:** merging changes lemmas (`勉強する` vs `勉強`), which feeds tap→card resolution — tune the
lemma→card matching alongside it, but tokenization is the lead. Re-run is the full hash-keyed loop in §6.2.

### 8.x Other deferred (not commit 3)
- **Tier-2 grammar** (detectable, lower priority, omitted from the N5/N4 set): `causative-passive`,
  `tagaru`, `nasai`, `imperative`, `te-aru`/`te-iku`/`te-kuru`/`te-hoshii`, benefactives
  (`te-ageru`/`kureru`/`morau` + bare `ageru`/`kureru`/`morau`), `yotei`, `mitai`, `darou`, `temo`,
  `kedo`, `toki`, `mae-ni`, `ato-de`, `you-ni-naru`, `you-ni-suru`, keigo
  (`keigo-sonkei`/`kenjou`/`teinei`). A natural commit-2.x expansion.
- **Self-Talk grammar enrichment** — currently Self-Talk keeps hand tags only. Merging GiNZA tags would
  need a provenance strategy (no column today).
- **bunsetsu consumption** — phrase-level highlighting / grammar-pattern matching over bunsetsu spans.
- **`ja_ginza` vs electra revisit** — provenance is recorded; swapping models is a re-run.
- Independent of NLP: **Phase 2.5** (custom-card `ex` → private rows), **Phase 3** (Minna → store). When
  Minna lands as public-ish rows, it can be added to the parse corpus (note its bunsetsu spaces in
  `text`).

---

## 9. Key file index

| Path | What |
|---|---|
| [SENTENCE_STORE_NLP.md](SENTENCE_STORE_NLP.md) | Overview/brief (read first) |
| **SENTENCE_STORE_PHASE4.md** | **this file — Phase 4 as-built + commit-3 plan** |
| [sentence-nlp/parse.py](sentence-nlp/parse.py) | offline parser (`--verify`, `--limit`) |
| [sentence-nlp/patterns.py](sentence-nlp/patterns.py) | grammar catalog + detectors (38 ids); `python3 patterns.py` dumps the label registry |
| [sentence-nlp/test_patterns.py](sentence-nlp/test_patterns.py) | detector validation battery |
| [sentence-nlp/README.md](sentence-nlp/README.md) | parser project docs |
| [wk-enhanced-api/data/annotations.json](wk-enhanced-api/data/annotations.json) | committed artifact (544) |
| [study-app/src/data/grammar.json](study-app/src/data/grammar.json) | generated id→label→jlpt catalog (38) — the client grammar registry |
| [study-app/src/core/annotate.js](study-app/src/core/annotate.js) | `overlayTokens` — tappable spans over ruby (3b) |
| [study-app/src/features/word-lookup.js](study-app/src/features/word-lookup.js) | tap popover + lemma→card/Jisho (3b) |
| [wk-enhanced-api/scripts/seed-annotations.ts](wk-enhanced-api/scripts/seed-annotations.ts) | deploy-time loader |
| [wk-enhanced-api/src/db/client.ts](wk-enhanced-api/src/db/client.ts) | `VIEWER_VISIBLE`, `upsertAnnotation`, `getAnnotation`, `setGrammarTags` |
| [wk-enhanced-api/src/db/client.test.ts](wk-enhanced-api/src/db/client.test.ts) | annotation + grammar tests/pins |
| [wk-enhanced-api/src/db/schema.sql](wk-enhanced-api/src/db/schema.sql) | `sentence_annotation` table |
| [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) | server docs + the offset-contract dead-end |
| [study-app/CLAUDE.md](study-app/CLAUDE.md) | frontend module map / design system (commit 3 lands here) |

Project memory `sentence-store-rearchitecture` carries the converged decisions + commit 1–2 status.
