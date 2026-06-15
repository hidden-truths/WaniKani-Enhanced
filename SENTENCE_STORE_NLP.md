# Unified Sentence Store + the NLP Enrichment Phase

General overview of the unified sentence store as it stands today, and the plan for the **NLP
enrichment phase** — the next stage. This is the entry doc for picking that work up.

**Reading order:** this file (overview + NLP plan) → [SENTENCE_STORE_VISION.md](docs/history/SENTENCE_STORE_VISION.md)
(original rationale + the open questions, mostly resolved) → [SENTENCE_STORE_PHASE1.md](docs/history/SENTENCE_STORE_PHASE1.md)
/ [SENTENCE_STORE_PHASE2.md](docs/history/SENTENCE_STORE_PHASE2.md) (the shipped phase plans) → **[SENTENCE_STORE_PHASE4.md](SENTENCE_STORE_PHASE4.md)
(the Phase-4 as-built record + commit-3 plan — the detailed companion to this brief; READ IT if you're
picking up Phase 4)**. The authoritative
schema is [wk-enhanced-api/src/db/schema.sql](wk-enhanced-api/src/db/schema.sql) "Unified sentence
store"; the server contract is in [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) "Cache keys /
data on disk" → Sentence store; the converged design decisions live in the `sentence-store-rearchitecture`
project memory.

---

## The idea in one paragraph

One canonical **`sentence`** row per Japanese sentence; every surface (vocab-card examples, Self-Talk
phrases, Minna grammar/conversation lines) **references** it by id instead of embedding the text
inline. That gives de-dup, cross-surface reuse, and — crucially — **one place to attach analysis**.
The NLP phase layers GiNZA-derived structure on top: a user highlights a span in any sentence and
gets its lemma / part-of-speech / a link to the matching card-or-Jisho, and "find every sentence using
〜ておく" becomes a query. The store was built first (it's the foundation); enrichment is additive and
comes second — that ordering was a deliberate decision.

## Where this fits — phase map

| Phase | Scope | Status |
|---|---|---|
| **1** | Self-Talk phrases → store (built-ins public, user phrases private) | ✅ shipped + deployed |
| **2** | Built-in vocab `examples.js` → store as public rows linked to cards (`owner_type='card'`) | ✅ shipped + deployed |
| **2.5** | Custom-card `ex`+`levels` → private store rows (render-from-store) | ✅ shipped |
| **3** | Minna sentences (grammar/conversation/lesson) → store (`public=0`) | ⏳ deferred |
| **4 — NLP** | GiNZA enrichment: populate `sentence_annotation`; interactive spans + grammar search | 🔜 **this doc** |

Phases are reversible + behavior-preserving (no flag day) — same discipline as the two-app split.
2.5 and 3 are independent of NLP and can happen in any order; NLP can start now against the public
rows that already exist (Phase 1 + 2 content).

## The store as built (what Phase 4 builds on)

Six tables (all `CREATE TABLE IF NOT EXISTS`, applied at boot — no migration step):

- **`sentence`** — `{id, ext_id, hash, text, furigana, lang, source, public, visibility, created_by,
  created_at}`. `text` = `plainText(jp)` byte-for-byte; `hash` = `ttsTextHash(text)` **computed
  server-side** — this is the audio-layer key, so it MUST match or audio linkage forks. `furigana` is
  structured JSON `[{t, r?}]` with the invariant `concat(seg.t) === text`; the full kana reading is
  DERIVED (`seg.r ?? seg.t`), never stored. `public=1, visibility='public', created_by=NULL` = curator;
  `public=0, visibility='private', created_by=<user>` = user-authored.
- **`translation`** / **`sentence_tag`** — child rows: `{sentence_id, lang, text, ordinal}` and
  `{sentence_id, kind('scene'|'grammar'|'topic'), value}`.
- **`sentence_link`** — polymorphic ownership: `{sentence_id, owner_type, owner_id?, tier?, role?,
  ordinal, clip_start_ms?, clip_end_ms?}`. `owner_type ∈ card|grammar_point|conversation|lesson|selftalk`.
  Tier/role/clip live on the LINK, so one sentence reused across cards/tiers is ONE row + N links.
- **`sentence_annotation`** — **created, currently empty — this is the Phase 4 target** (details below).
- **`public_sentence` VIEW** — `SELECT * FROM sentence WHERE public=1 AND visibility='public'`. Anon /
  export reads ONLY this view.

**The load-bearing privacy choke-point:** every read goes through `db.getSentences({ownerType,
ownerId?, viewer})`, which ALWAYS ANDs `(public=1 OR created_by=:viewer)`, fail-closed (null viewer →
public only), returning one entry per LINK. Pinned breach-prevention tests in
`wk-enhanced-api/src/db/client.test.ts` must stay green. **Any Phase-4 read path that joins
annotations MUST go through this choke-point** — never read `sentence` directly.

Served by `routes/sentences.ts`: `GET /v1/sentences?ownerType=selftalk|card[&ownerId=]` (anon-readable
public + caller's own private), `POST/PUT/DELETE /v1/sentences/{id}` (gated, ownership in SQL).

---

## Phase 4 — NLP enrichment

### Goal

Turn each sentence from opaque text into something the UI can interrogate:

1. **Tap-a-word lookup.** Highlight/tap a span in a rendered sentence → its **lemma** (dictionary
   form, so 食べた → 食べる), **part-of-speech**, reading, and a **link**: to the user's card if that
   lemma is in the deck, else out to Jisho. This is the headline feature.
2. **Grammar search.** "Show me every sentence that uses 〜ておく / the potential form / a counter" —
   backed by `sentence_tag(kind='grammar', value=…)` populated from the parse, queryable across the
   public corpus.

### The hard constraint — offline batch ONLY

GiNZA is a spaCy Japanese pipeline (Python). The production box is a **$6 droplet** running a single
Bun container — there is no Python there, and the models are heavy (`ja_ginza_electra` ~16 GB is out;
even `ja_ginza` as a hot service is too much). **Decision: NLP runs as an OFFLINE BATCH on a dev/maintainer
machine**, never live in the request path. Live parsing of arbitrary user content is deferred
indefinitely. So the pipeline is: parse offline → emit JSON → load into the prod DB as a deploy/seed
step (same shape as `seed-sentences.ts` / `seed-audio-variants.ts`). The server only ever READS
`sentence_annotation`; it never computes it.

This means the natural target is the **public corpus** (Phase 1 + 2 rows — built-in examples +
Self-Talk built-ins): a bounded, curator-owned set we can parse once and re-parse when content changes.
Private user sentences are out of scope for batch NLP (no offline access to them, and parsing-on-write
needs the Python service we've ruled out).

### The substrate — `sentence_annotation`

Already in the schema, keyed 1:1 to a sentence, populated by the batch:

```sql
CREATE TABLE sentence_annotation (
    sentence_id INTEGER PRIMARY KEY REFERENCES sentence(id) ON DELETE CASCADE,
    tokens      TEXT,   -- JSON [{i,start,end,surface,lemma,pos,tag,reading,dep,head}]
    bunsetsu    TEXT,   -- JSON [{start,end}]
    parser      TEXT,   -- e.g. 'ginza-5.x / ja_ginza'  (provenance for re-parse decisions)
    parsed_at   INTEGER -- epoch ms
);
```

- **`tokens`** — one entry per morpheme. `start`/`end` are **character offsets into `sentence.text`**
  (the plain canonical text — NOT the furigana segments, NOT the ruby). That offset is the contract
  the client uses to map a tap/highlight back to a token. `lemma` drives the card/Jisho link; `pos`/`tag`
  drive display + grammar tagging; `reading` is GiNZA's, kept for reference (the visible reading still
  comes from the stored furigana).
- **`bunsetsu`** — phrase-chunk spans (also char offsets), for phrase-level highlighting / future
  grammar-pattern matching.
- **Grammar tags** extracted from the parse get written to **`sentence_tag(kind='grammar', value=…)`**
  (not into this table) so they're independently queryable — that's the grammar-search substrate.

### Pipeline shape (proposed)

1. **Export** the public corpus to parse: `text` + `id` for every `public_sentence` row (the parser
   needs only the plain text; offsets come back relative to it).
2. **Parse offline** (maintainer machine, Python + GiNZA): for each sentence emit
   `{ext_id, tokens[], bunsetsu[], grammar_tags[], parser}`. Keep this as its own small Python project
   (NOT in the Bun repo) — its output is a JSON artifact.
3. **Load** via a new `scripts/seed-annotations.ts` (Bun, mirrors `seed-sentences.ts`): read the JSON,
   upsert `sentence_annotation` by `sentence_id` (resolve via `ext_id`/`hash`), and replace
   `sentence_tag(kind='grammar')` rows per sentence. Idempotent; **must run as a deploy step** on the
   droplet with the repo mounted (the established pattern — see deploy/README.md).
4. **Serve**: extend the `GET /v1/sentences` read so each sentence can carry its annotation (a join
   through the choke-point, opt-in via a query flag so existing callers/payloads are unaffected).
5. **Render** (study-app): a pure helper maps `tokens[].{start,end}` over the rendered sentence to make
   tappable spans; tap → resolve `lemma` against the deck (`BUILTIN_RANK_BY_JP` / custom cards) → open
   the card detail, else `jishoUrl(lemma)`. Reuse the existing furigana rendering; the annotation is an
   overlay keyed by char offset.

### Open questions — DECIDED (2026-06-12)

- **GiNZA model + version pin → `ja_ginza_electra`** (offline we can afford the transformer; tokenization
  + lemma + reading come from SudachiPy either way, electra adds the better dependency parse the grammar
  phase leans on). Split mode **C**. Recorded in `parser` as `ja_ginza_electra/5.2.0 ginza/5.2.0 splitC`.
  **Offset gotcha resolved (load-bearing):** GiNZA's `token.idx` is a *codepoint* offset; JS slicing is
  UTF-16. They diverge at non-BMP kanji (𠮟 U+20B9F). So we emit **UTF-16 offsets** and triple-check them
  (parser self-check → seed `slice===surface` re-assert → a non-BMP pin test). Verified empirically.
- **Grammar-tag taxonomy → curated hyphenated-romaji slug catalog** (`te-iru`/`te-oku`/`potential`/… ~30,
  matched over lemma/pos/tag/dep/morph — NOT raw n-grams), aligned to the existing `te-iru`/`tai`/`sou`
  slug style. **Deferred to commit 2** (commit 1 is tokens/offsets/plumbing only); the parser already
  emits `dep`/`head`/`tag` so commit 2 needs no re-parse.
- **Re-parse triggers → full, hash-keyed.** Re-parse the whole exported corpus (it's ~544 sentences);
  annotations key by `hash`, and because the parser parses the exact exported `text`, offsets are
  self-consistent with the row by construction — a re-parse only ever changes *quality*. Optional
  `--changed-only` skip later if ever needed.
- **Furigana ↔ tokens reconciliation → not unified** (confirmed). Both decompose the same `text` on
  different boundaries; the tap-target uses tokens, the visible ruby uses furigana.

### First concrete steps (a good Phase-4 commit-1)

1. ✅ **SHIPPED** — offline parser project [../sentence-nlp/](sentence-nlp/) (`ja_ginza_electra`, separate
   from the Bun repo); parses the public corpus → committed `wk-enhanced-api/data/annotations.json`.
   Offset contract verified (BMP *and* non-BMP) and self-checked at parse time.
2. ✅ **SHIPPED** — `scripts/seed-annotations.ts` + `db.upsertAnnotation` (offset gate on write) /
   `db.getAnnotation` (through the shared `VIEWER_VISIBLE` gate), with unit tests: offset-integrity, a
   non-BMP contract pin, and a privacy pin that a private row's annotation never leaks to anon.
3. ✅ **SHIPPED** — commit 2: curated 38-point N5/N4 grammar catalog ([../sentence-nlp/patterns.py](sentence-nlp/patterns.py),
   Bunpro-grounded, reusing the `SELFTALK_GRAMMAR` ids), detected in the Python parse and written to
   `sentence_tag(kind='grammar')` via `db.setGrammarTags` for `source='example'` rows (Self-Talk keeps
   its hand tags). Every detector pinned in `test_patterns.py` (positives + confusable negatives).
4. ✅ **SHIPPED** — commit 3: the `?annotate=1` serving flag on `/v1/sentences` (3a) + the study-app
   tap-to-lookup UI (3b, pure `overlayTokens` span-wrap over the ruby + a lemma→card/Jisho popover) +
   the Browse grammar-search filter (3c, card facet + a `patterns.py`-dumped label registry). **Phase 4
   is complete** — full as-built in [SENTENCE_STORE_PHASE4.md](SENTENCE_STORE_PHASE4.md).
5. ⭐ **NEXT REWORK — tokenization granularity.** The shipped tap units are GiNZA's raw morphemes
   (split mode C), which fragment する-verbs (勉強 + する) and conjugations (食べ+させ+られ+た), so a
   tapped span doesn't match "a word." The fix is a post-tokenization MERGE pass in `parse.py`
   (content word + trailing function morphemes → one token; the unconsumed `bunsetsu` spans are a natural
   basis), then a full re-parse + re-seed. Details in [SENTENCE_STORE_PHASE4.md](SENTENCE_STORE_PHASE4.md) §8.0
   + [sentence-nlp/README.md](sentence-nlp/README.md).

Keep each step shippable and behavior-preserving; nothing here changes existing playback or rendering
until the tap-to-lookup UI lands.

---

## The other deferred phases (not NLP, for completeness)

- **Phase 2.5 — custom-card examples → private store rows. ✅ SHIPPED.** A custom card's whole example
  set (the single `ex` + the N5→N1 `levels` tiers) is dual-written to the store as PRIVATE rows
  (`source='custom'`, `owner_type='card'`, `owner_id=<rank>`, `tier`, `public=0`) in ONE atomic call:
  `PUT /v1/sentences/card/{rank}` → `db.replaceUserCardExamples`, the per-user analog of
  `seedExampleSentence`'s wholesale replace, scoped to `created_by=viewer` so it can never touch a public
  built-in. Client: `pushCardExamples` on save (signed-in, fire-and-forget), `deleteCardExamples` (empty
  replace) on delete, a one-time-per-device `migrateCardExamples` backfill on sign-in. **Render needs NO
  new path** — `attachLevels` already prefers `state.exampleLevels[rank]` and `GET ?ownerType=card`
  already returns the caller's own private rows, so a signed-in user's custom cards render FROM the store
  like built-ins (the localStorage blob stays the offline/anon fallback). Decision: offline rendering is
  no longer a constraint (the app requires a server), so this is full render-unification — "the store is
  the single source for ALL example text" — not a write-only mirror. **Caveat (inherent to privacy):** the
  public-only tooling (NLP tap-to-lookup, export, de-dup, TTS pre-gen all read `public_sentence`) does NOT
  cover these private rows. Tests: 5 server (privacy/wholesale/scoping/user-scoped-id/furigana-abort) + 1
  client builder; curl + signed-in browser E2E (dual-write → render-from-store, store-wins) verified.
- **Phase 3 — Minna → store.** Grammar-point + conversation + lesson sentences become `sentence` rows
  with `public=0` (copyright-gated, same as the Minna route gate). Grammar-points and conversations get
  stable owner ids; `sentence_link.role`/`clip_*` already model speaker + per-line clip ranges. This is
  the largest content migration and the one that most exercises the polymorphic link model.

- **Templates → store (DECIDED, not yet built).** The 独り言 Self-Talk slot-swap TEMPLATES are currently a
  client-only JS bundle. A `sentence_template` table will hold the generator structure (curator-seeded +
  served), and realizations get **lazily materialized** as `sentence` rows on first request (linked via
  `sentence_link(owner_type='template')`) so this NLP pipeline + the other store tooling cover the combos
  people actually use — tap-lookup tokens lag until the next offline re-parse. Full design + plan:
  [SENTENCE_STORE_TEMPLATES.md](SENTENCE_STORE_TEMPLATES.md).

## Invariants any phase must preserve

- `text` == `plainText(jp)` byte-for-byte; `hash` == `ttsTextHash(text)`, server-computed. Break either
  and audio linkage forks.
- `furigana` invariant `concat(seg.t) === text`.
- Every read through `db.getSentences` (the privacy choke-point); anon/export through `public_sentence`.
  Keep the pinned breach-prevention tests green.
- **Sentences only.** Card definitions keep their homes (`verbs.js`, `custom-verbs` blob, Minna
  activation); only example/phrase/conversation-line *sentences* live in the store. Per-user signals
  (progress, settings, streaks, notes, clips, overlays) stay in their `user_progress` blobs — blobs =
  per-user signals, store = sentence text.
