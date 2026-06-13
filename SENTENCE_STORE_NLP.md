# Unified Sentence Store + the NLP Enrichment Phase

General overview of the unified sentence store as it stands today, and the plan for the **NLP
enrichment phase** — the next stage. This is the entry doc for picking that work up.

**Reading order:** this file (overview + NLP plan) → [SENTENCE_STORE_VISION.md](SENTENCE_STORE_VISION.md)
(original rationale + the open questions, mostly resolved) → [SENTENCE_STORE_PHASE1.md](SENTENCE_STORE_PHASE1.md)
/ [SENTENCE_STORE_PHASE2.md](SENTENCE_STORE_PHASE2.md) (the shipped phase plans). The authoritative
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
| **2.5** | Custom-card `ex` → private store rows (+ blob migration) | ⏳ deferred |
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

### Open questions to settle first

- **GiNZA model + version pin.** `ja_ginza` (lighter) vs `ja_ginza_electra` (better, heavier) for the
  OFFLINE parse — offline we can afford electra; pick one and record it in `parser` for re-parse
  decisions. Confirm the tokenizer's offsets are codepoint offsets that line up with JS string indexing
  over `sentence.text` (normalization/width gotchas — verify on a kanji+kana+punctuation sample).
- **Grammar-tag taxonomy.** What `value`s does `sentence_tag(kind='grammar')` use? A curated pattern
  list (〜ておく, 〜てしまう, potential, passive, …) matched off the dependency parse, vs. raw POS
  n-grams. Start small + curated; it's the searchable vocabulary.
- **Re-parse triggers.** When a curator edits `examples.js` and re-seeds, the sentence row changes →
  its annotation is stale. Decide: re-run the whole batch on any content change (simple, the corpus is
  small), or diff by `hash`.
- **Furigana ↔ tokens reconciliation.** Both decompose the same `text` but on different boundaries
  (reading segments vs morphemes). They don't need to align; the tap-target uses tokens, the visible
  ruby uses furigana. Confirm we don't try to unify them.

### First concrete steps (a good Phase-4 commit-1)

1. Stand up the offline parser project (Python + GiNZA) separate from the Bun repo; parse a handful of
   public sentences; eyeball that `tokens[].start/end` line up with `sentence.text` in JS.
2. Write `scripts/seed-annotations.ts` + a small `db.upsertAnnotation` / `db.getAnnotation` pair (the
   latter through the choke-point), with unit tests (offset-integrity + a privacy pin that a private
   row's annotation never leaks to an anon viewer).
3. THEN the serving flag + the study-app tap-to-lookup UI.

Keep each step shippable and behavior-preserving; nothing here changes existing playback or rendering
until the tap-to-lookup UI lands.

---

## The other deferred phases (not NLP, for completeness)

- **Phase 2.5 — custom-card `ex` → private store rows.** Today user custom cards still render examples
  from the `custom-verbs` blob via `exampleForLevel`'s `v.ex` fallback. Moving them into private
  `sentence` rows (+ a one-time blob migration on sign-in, mirroring Self-Talk Phase 1) makes the store
  the single source for ALL example text. User-confirmed deferral; built-ins were the clean public slice
  to ship first.
- **Phase 3 — Minna → store.** Grammar-point + conversation + lesson sentences become `sentence` rows
  with `public=0` (copyright-gated, same as the Minna route gate). Grammar-points and conversations get
  stable owner ids; `sentence_link.role`/`clip_*` already model speaker + per-line clip ranges. This is
  the largest content migration and the one that most exercises the polymorphic link model.

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
