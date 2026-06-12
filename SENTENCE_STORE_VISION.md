# Unified Sentence Store + NLP Enrichment — vision & rearchitecture brief

> **Status: VISION / not yet planned.** This is a discussion seed for a *big* rearchitecture, not a
> decided design. Everything in "Target" and "Candidate directions" is a starting point to debate,
> revise, or reject together. The goal of the next session is to **collaborate on the design**, surface
> the hard tradeoffs, and produce a phased plan — not to start coding.

## The goal

Two principles:

1. **One canonical "sentence" entity.** Every Japanese sentence on the site — vocab example sentences,
   みんなの日本語 lesson sentences, 独り言 Self-Talk phrases, conversation lines — becomes a row in one
   shared store with one shape, instead of three scattered representations.
2. **Cards REFERENCE sentences; they don't embed them.** A card (verb/noun/phrase) points at the
   sentence ids that illustrate it (with tier/level metadata on the *link*, not the sentence). A
   sentence can be reused by many cards; a card can have many sentences.

On top of that store, **integrate [GiNZA](https://github.com/megagonlabs/ginza)** (spaCy-based Japanese
NLP, Universal Dependencies) to **parse every sentence once** into structured token/phrase annotations.
That unlocks the headline feature: **a user highlights any span of a sentence and gets info about that
piece** — the verb's dictionary form + conjugation, a noun, a particle's role, a grammar/phrase unit —
with a deep-link to the matching card if it's in their deck, or to Jisho otherwise.

## Why now

Sentences are the densest learning content on the site, but today they're inert text. Normalizing +
parsing them turns every sentence into an explorable object: tap-to-understand reading practice,
cross-surface reuse (one good sentence illustrates a built-in verb *and* a Minna word), de-duplication,
and a foundation for future features (grammar-point indexing, "find sentences using 〜ておく", audio
pre-gen over one corpus, search). It also pays down the "three scattered implementations" debt.

## Where sentences live today (the scattered state)

| Surface | Text lives in | Shape | Storage |
|---|---|---|---|
| **Vocab example sentences** | `study-app/src/data/examples.js` | `EXAMPLES[rank] = { N5:[jp,en], …, N1:[jp,en] }` | Static, bundled (offline-first) |
| **みんなの日本語** | `wk-enhanced-api/data/minna/lesson-<n>.json` | lesson JSON: vocab / grammar / examples / conversation | Server JSON files, git-tracked, **account-gated** (copyright) |
| **Self-Talk** | built-ins in `study-app/src/data/selftalk.js`; user lines in the synced `selftalk` blob | `{ id, jp, read, mean, scene, grammar }` | Static bundle + opaque per-user JSON in `user_progress` |

The furigana reading is embedded as `<ruby>` markup in `jp`; the English is a sibling string; nothing is
parsed. Cards embed their examples inline. There is **no sentences table and no shared shape** — the only
real convergence today is the **unified audio layer** (`/v1/audio/*` + `playItem`/`resolveVariant`), which
keys on the sentence's plain text.

## Target (a starting point to debate)

A relational-ish model, conceptually:

- **`sentence`** — `{ id, text (plain), tokens/furigana, lang=ja, source/provenance, created_by?, hash }`.
  One row per unique sentence. `hash` (of plain text) is the natural key + the link to the audio layer.
- **`translation`** — `{ sentence_id, lang, text }` (1:N so EN now, others later).
- **`card_sentence`** (join) — `{ card_id, sentence_id, role, jlpt_tier?, ordinal }`. Tier/level lives
  HERE, not on the sentence (the same sentence could be "N3 example for card A" and "a Self-Talk phrase").
- **`sentence_annotation`** — the GiNZA output per sentence: tokens with char offsets, `lemma`, `pos`/
  `tag` (UD + Unidic), reading, `dep` (dependency), and **bunsetsu/phrase spans** (GiNZA's
  `bunsetu_spans`) for grammar-unit highlighting; optionally NER. Keyed by character ranges so a DOM
  highlight maps to tokens.

Cards reference sentences via the join; offline surfaces read a **denormalized read-model** generated
*from* the store (so `examples.js`-style bundling can survive — see the offline-first constraint).

## What GiNZA buys us (and the runtime mismatch)

GiNZA (Python ≥3.8, spaCy 3.7+, SudachiPy) gives, per token: surface, **lemma** (dictionary form),
**POS/tag** (Universal Dependencies + Unidic morphology via `token.morph`), **reading**, **dependency
arc**, and beyond tokens, **bunsetsu (phrase) spans** — exactly the unit you'd highlight for a grammar
point — plus NER. Two models: `ja_ginza` (fast, light) vs `ja_ginza_electra` (transformer, more accurate,
~16GB). CLI (`ginza`, JSON/CoNLL-U output) or the Python API.

**The catch:** our backend is **Bun + Hono + TypeScript**; GiNZA is **Python**. So a core decision is
*where the parsing runs* — an offline batch step, a Python sidecar service, or a hybrid (see directions).

## The hard questions (the collaborative part)

1. **Data model.** What exactly is a "sentence"? How are furigana represented — keep curated `<ruby>`, or
   derive readings from GiNZA tokens (and reconcile)? Translations 1:N? How do cards link (join shape,
   where tier/role lives)? How does de-dup work across surfaces?
2. **Storage + offline-first.** SQLite already backs the server (but only as opaque per-`(user,app)`
   blobs). Do sentences become real relational tables there? How does a *server* store coexist with the
   **offline-first** surfaces (`examples.js` + Self-Talk built-ins ship in the bundle for anon/offline)
   and the **copyright gate** (Minna must NOT ship to anon)? Likely answer: store is source-of-truth;
   generate a bundled read-model for the offline/public slice and gate the Minna slice — but that's the
   debate.
3. **Where GiNZA runs.** (a) **Offline batch** — a Python script parses the curated corpus at build/
   deploy, writes annotations into the store; bounded + reproducible, but can't parse *new* user content
   live. (b) **Live Python sidecar** — on-demand parse endpoint (a second container) for user-authored
   Self-Talk; more infra. (c) **Hybrid** — batch the curated corpus, queue/parse user content async.
   Which, and how does it fit the one-droplet / Docker-compose deploy?
4. **Annotation ⇄ markup.** How do char-offset token spans coexist with the existing `<ruby>` furigana?
   How does a browser text-selection map back to tokens (and to a card if the lemma is in the deck)?
5. **Migration path.** How to move the three sources into the store **without breaking the live app or
   offline-first** — incremental, reversible, behavior-preserving (like the two-app split was). Do we
   keep `examples.js` as a *generated* read-model, or replace it?
6. **Scope / MVP.** What's the smallest valuable slice? (e.g., parse + store + "highlight → token info"
   on ONE surface, read-model generated, before touching the others.)
7. **The highlight UX.** What does the popover show (lemma, POS, reading, conjugation, grammar note,
   links)? Stays within the no-framework / hand-rolled ethos?

## Constraints that must survive

- **Offline-first + no-framework ethos** (study-app): anon/offline surfaces still work from the bundle;
  no framework, no CDN deps (CLAUDE.md design contracts).
- **Copyright gating** for みんなの日本語 (server-gated, never shipped to anon).
- **The card schema** (CARDS.md) and the **unified audio layer** already exist — sentences link to audio
  by text hash; don't regress either.
- **Bun + SQLite backend**, one droplet, Docker-compose, minimal dependencies (wk-enhanced-api/CLAUDE.md).
  A Python NLP component is a real addition to weigh against that.
- **Model-generated content is proofread** — parsing doesn't change that; it adds a layer.

## Candidate directions (sketches to react to — not decisions)

- **Store:** new relational tables in the existing SQLite (`sentence`, `translation`, `card_sentence`,
  `sentence_annotation`), repo functions hiding SQL (like `db/client.ts`). Source-of-truth on the server.
- **Offline:** a build step emits a denormalized JSON read-model for the public/offline slice (regenerates
  today's `examples.js`/Self-Talk built-ins); Minna stays gated + fetched live.
- **NLP:** GiNZA as an **offline batch enrichment** over the curated corpus (a `scripts/parse-sentences.py`
  analog to `generate-tts.ts`), writing annotations into the store; a small **on-demand parse path** for
  user-authored Self-Talk (sidecar or queued). Pick `ja_ginza` vs `electra` by accuracy/footprint.
- **Client:** a highlight handler that maps a selection to token offsets → a popover; reuses the existing
  Jisho deep-link + card lookup.

## Suggested reading for the planning session (in order)

1. This doc.
2. [study-app/CARDS.md](study-app/CARDS.md) — the card schema + furigana/example formats (the thing that
   stops embedding sentences).
3. [study-app/CLAUDE.md](study-app/CLAUDE.md) — module map, design-system + offline-first contracts,
   dead-ends; [study-app/SELFTALK.md](study-app/SELFTALK.md) + [study-app/MINNA.md](study-app/MINNA.md) —
   the three sentence sources.
4. [wk-enhanced-api/CLAUDE.md](wk-enhanced-api/CLAUDE.md) — the DB tables, the storage layer, the
   opaque-`user_progress` model, the unified `/v1/audio/*` surface, deploy shape.
5. `study-app/src/data/examples.js`, `wk-enhanced-api/data/minna/lesson-23.json`,
   `study-app/src/data/selftalk.js` — the three concrete shapes to unify.
6. GiNZA: <https://github.com/megagonlabs/ginza> (capabilities, models, `bunsetu_spans`).
