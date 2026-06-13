# Templates → Sentence Store (design + plan)

**Status:** DECIDED, not yet built. This is the authoritative context doc for the next session. The
slot-swap TEMPLATE feature currently lives as a **client-only JS bundle**; we're moving it into the
server sentence store. Read this first, then the linked files.

**Where the code is:** the template feature shipped on branch **`selftalk-grid`** (8 commits ahead of
`main`, not yet merged — confirm with the maintainer whether to branch this work from `selftalk-grid`
or from `main` after a merge).

---

## Why we're doing this

Templates are authored + stored in **JavaScript** (`study-app/src/data/selftalk-templates.js`) and never
touch the DB. The maintainer wants:

1. **Content out of JavaScript** — templates should be DB-sourced + curator-seeded like everything else
   (phrases seed from `data/selftalk.js`, examples from `data/examples.js`).
2. **The store tooling to cover template realizations** — NLP tap-to-lookup, TTS pre-gen, grammar
   search, export, de-dup all operate on `sentence` rows, and a template's realizations aren't sentence
   rows today, so none of those tools see them.

## The core tension (why a template isn't just a `sentence`)

A template is a **generator**, not a sentence: it has **no single fixed `text`/`hash`/furigana**. A
`sentence` row's load-bearing invariants are `text == plainText(jp)`, a server-computed
`hash = ttsTextHash(text)`, and structured furigana with `concat(seg.t) === text`. A skeleton with
`{slot}` markers satisfies none of those. So integration is **two pieces**: a home for the *generator
structure*, and a decision about how the *realizations* become real sentences.

---

## What exists today (the feature being migrated)

Full doc: [study-app/SELFTALK.md](study-app/SELFTALK.md) "Templates (slot-swap)". In brief:

- **Data (client-only):** `SELFTALK_TEMPLATES` in `study-app/src/data/selftalk-templates.js` — 18
  templates. A template is
  `{ id, topic, thought?, grammar:[…], en, jp, slots:[{id,label,fillers:[{jp,en}]}] }` where `jp` is the
  skeleton with `{slotId}` markers (ruby on every fixed kanji) and each filler's `jp` carries ruby too.
- **Pure realization** (`study-app/src/core/selftalk.js`): `realizeTemplate(tpl, picks)` substitutes the
  picked filler per slot then DERIVES `{jp, read, mean, text}` with the same `core/text.js` helpers a
  phrase uses (`rubyToSegments`/`segmentsToReading`/`plainText`). `text` = the plainText, which is the
  `/v1/audio/tts` key + the record-compare reference text. `cyclePick` / `templatePickIndex` too.
- **Render + UX** (`study-app/src/features/selftalk.js`): `templateCardHtml` / `templateSentenceHtml`
  (slot chips + filler menu), the cycle / ⌥-click / long-press / shuffle handlers, `repaintTemplateCard`
  (in-place patch on swap), and the grid tally (counts phrases **+** templates).
- **Audio + practice:** synth-only, on the realized plainText (lazy `/v1/audio/tts`, cached on demand).
  Record-compare keys on the **SKELETON id** (one practiceable item; the reference text tracks the
  current realization). `tplPicks` is per-session view state.
- **Tests** (`study-app/test/core.test.ts`): `realizeTemplate`/`cyclePick`, a templates-dataset
  furigana-integrity check over every realization combo, and a coverage pin (games ≥5, every thought
  cluster ≥1).

## The store we're building on

Docs: [SENTENCE_STORE_NLP.md](SENTENCE_STORE_NLP.md) + `wk-enhanced-api/CLAUDE.md` "Sentence store".
Schema: `wk-enhanced-api/src/db/schema.sql` "Unified sentence store". Key points:

- Tables: `sentence` (the invariants above), `translation`, `sentence_tag` (`kind ∈ topic|thought|
  grammar|scene(legacy)`), `sentence_link` (polymorphic `owner_type ∈ card|grammar_point|conversation|
  lesson|selftalk`), `sentence_annotation` (GiNZA tokens — **offline batch only**, no Python on prod),
  `public_sentence` VIEW.
- **The privacy choke-point:** every read goes through `db.getSentences({…, viewer})`, which ALWAYS ANDs
  `(public=1 OR created_by=:viewer)`, fail-closed. Pinned breach tests in `src/db/client.test.ts`.
- Curator content seeds via `scripts/seed-sentences.ts` (a deploy step). NLP runs OFFLINE
  (`sentence-nlp/parse.py` → `data/annotations.json` → `scripts/seed-annotations.ts`).

---

## The decided architecture

### Part 1 — a `sentence_template` table (the generator structure)

A **new table** holding the template structure verbatim (so the client can render the slot-swap UI),
curator-seeded + served. Illustrative sketch (the next session finalizes columns):

```sql
CREATE TABLE IF NOT EXISTS sentence_template (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ext_id      TEXT NOT NULL UNIQUE,   -- stable id, e.g. 'tpl-minecraft-gather'
    source      TEXT NOT NULL,          -- 'selftalk'
    topic       TEXT,                   -- taxonomy topic id
    thought     TEXT,                   -- optional thought-cluster id
    grammar     TEXT,                   -- JSON string[]
    en          TEXT,                   -- English skeleton with {slot} markers
    jp          TEXT,                   -- JP skeleton with {slot} markers (ruby on fixed kanji)
    slots       TEXT,                   -- JSON [{id,label,fillers:[{jp,en}]}]
    public      INTEGER NOT NULL DEFAULT 1,
    visibility  TEXT NOT NULL DEFAULT 'public',
    created_by  INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = curator
    created_at  INTEGER NOT NULL
);
-- + a public_template VIEW and a read path that MIRRORS the getSentences VIEWER_VISIBLE predicate
--   (public=1 OR created_by=:viewer), fail-closed, with its own pinned breach test.
```

- **`data/selftalk-templates.js` stays the git-tracked AUTHORING source** and becomes the **seed
  source** (exactly like `data/selftalk.js` → phrases). A new pass in `seed-sentences.ts` (or a sibling
  script) upserts the template rows. Idempotent by `ext_id`.
- **Serving:** a route returns the structures for anon (public) + the caller's own private rows through
  the mirrored choke-point. Likely a dedicated `GET /v1/templates?ownerType=selftalk` (templates aren't
  sentences, so a separate route reads cleaner than overloading `/v1/sentences`) — confirm in the next
  session.
- **Client:** replace `import { SELFTALK_TEMPLATES }` with a fetch + a read-through localStorage cache
  (mirror `jpverbs_selftalk_cache` for phrases). The realize/render code is **unchanged** — it already
  operates on the structure. This alone gets the content out of JS.

### Part 2 — lazy, on-demand materialization of realizations

Realizations are **NOT pre-generated** (avoids the combinatorial blow-up — a richly-slotted template
could be hundreds of combos). Instead: **the first time a user actually requests a given config (filler
combo), the server materializes that realization as a real `sentence` row, then serves it.** Same shape
as the vocab lazy-warm pattern.

- **Endpoint sketch:** `POST /v1/templates/{extId}/realize` with the picks (and, simplest, the realized
  `jp` + `furigana` the client already derives via `realizeTemplate`). The server:
  - validates `concat(seg.t) === plainText(jp)` (the furigana invariant),
  - computes `hash = ttsTextHash(text)` server-side,
  - inserts a PUBLIC `sentence` row (`source='template'`), idempotent by hash (re-request → existing
    row), linked via `sentence_link(owner_type='template', owner_id=<template ext_id>, role=<combo key>)`,
  - copies the template's curated `grammar` onto the row as `sentence_tag(kind='grammar')` so grammar
    search includes it **immediately** (before any NLP),
  - returns the assembled sentence (id, hash, furigana, `annotation` if one already exists).
- **When to trigger materialization** is an open question (on first ▶ play? on tap-to-lookup? on record?
  proactively for the default combo?) — see Open Questions.
- **Record-compare / practice keeps keying on the SKELETON id**, NOT the materialized combo's sentence
  id — so takes + the ✓/streak stay coherent across swaps. Don't switch the itemKey to the combo.

### What tooling works *when* (set expectations — important)

| Tool | After lazy materialization of a combo |
|---|---|
| De-dup / export (`public_sentence`) | ✅ immediately (it's a public sentence row) |
| Grammar search | ✅ immediately, **if** we copy the template's grammar tag onto the row at materialization |
| TTS playback (lazy synth) | ✅ already works on any text; materialization gives it a canonical key |
| TTS pre-gen (`generate-tts.ts`) | ⚠️ extend it to enumerate template combos (or the materialized set) — text-addressed, optional |
| **NLP tap-to-lookup tokens** | ⏳ **LAGS** — NLP is an OFFLINE batch (no Python on prod). A freshly-materialized combo has no tokens until the next `parse.py` → `seed-annotations.ts` re-parse over the (now-larger) public corpus. Until then it **degrades to plain ruby** (the existing fallback). The offline batch *will* pick the combos up because they're public rows. |

So lazy materialization lights up most tooling promptly; **tap-to-lookup specifically lags behind the
offline NLP cycle** — that's inherent to the no-Python-on-prod constraint, not a bug to fix.

---

## Phasing (maintainer chose: structure first, then tooling)

- **Slice 1 — structure in DB.** `sentence_template` table + privacy gate (+ `public_template` view +
  breach test) + a seed pass + `GET /v1/templates` + the client fetch/cache replacing the JS import. The
  slot-swap UI is unchanged, just DB-sourced. **Content leaves JavaScript.** Verify the UI still works.
- **Slice 2 — lazy materialization + tooling.** `POST /v1/templates/{id}/realize` + `sentence_link`
  `owner_type='template'` + the client requesting materialization at the right moment + the grammar-tag
  copy + the offline NLP picking up materialized combos. Tools light up (with the NLP lag above).

Settle each slice's open questions WITH the maintainer first (propose-with-a-recommendation → pick →
build in slices), the same pattern used throughout this feature.

## Invariants to preserve

- `text == plainText(jp)` byte-for-byte; `hash == ttsTextHash(text)` **server-computed**; furigana
  `concat(seg.t) === text`.
- A template read path that **mirrors the `getSentences` `VIEWER_VISIBLE` predicate** (`public=1 OR
  created_by=:viewer`), fail-closed, with its **own pinned breach test** (don't let a private template
  leak to anon).
- Self-Talk stays **anon-readable, account-gated** for authoring/recording.
- Record-compare keys on the **SKELETON id** (templates) — unchanged by materialization.
- `ext_id`s immutable; built-in content model-generated → **proofread**.
- Design system (no framework, inline SVG `<symbol>` icons, `.frow`/`.chips`/roving, modals scroll);
  `core/*` stays DOM-free + unit-tested.

## Open questions to settle next session

1. **Furigana for materialized combos:** client-sends-`{jp,furigana}`-and-server-validates (recommended —
   reuses `realizeTemplate`'s output) vs. server-reconstructs-from-structure+picks (needs `core/text.js`
   server-side; the seed already imports it).
2. **Materialization trigger:** on first ▶ play / tap-to-lookup / record, or proactively for the default
   combo? (Cheapest: trigger when the client first needs a canonical sentence — i.e., on tap-to-lookup or
   record — and otherwise keep playing via the lazy TTS path.)
3. **Route shape:** dedicated `GET /v1/templates` (recommended) vs. overloading `/v1/sentences`.
4. **Grammar at materialization:** copy the template's curated `grammar` tag onto the combo row so grammar
   search works pre-NLP (recommended).
5. **User-authored templates (private):** defer to a later slice, or build the private path now? (Curator-
   only first mirrors how phrases shipped.)
6. **`source` value** for materialized combo rows (`'template'`?) and whether they should appear in the
   Self-Talk `GET /v1/sentences?ownerType=selftalk` set or only via the template owner link.

## Key files

- **Server:** `wk-enhanced-api/src/db/schema.sql` (new table + view), `src/db/client.ts` (repo fns +
  mirrored choke-point + breach test), `src/routes/` (new template route + realize endpoint),
  `scripts/seed-sentences.ts` (template seed pass).
- **Client:** `study-app/src/features/selftalk.js` (fetch templates instead of import; request
  materialization), `study-app/src/data/selftalk-templates.js` (becomes the seed source),
  `study-app/src/core/selftalk.js` (realize helpers — likely unchanged).
- **Docs:** `study-app/SELFTALK.md`, this file, the `SENTENCE_STORE_*.md` family,
  `wk-enhanced-api/CLAUDE.md` "Sentence store".

## Gates / env

- Dev API on `:3000` + Vite on `:5173` are usually already running — **DON'T kill them**. Dev DB:
  `wk-enhanced-api/dev-data/wk-vocab.sqlite` (re-seed after content/seed changes).
- study-app: `bun run test` + browser-verify via the preview tooling. wk-enhanced-api: `bun test` +
  `bun run typecheck`.
- One logical change → one commit; commit at the end of each slice without being asked; update
  `SELFTALK.md` + the `SENTENCE_STORE_*` docs + fix stale nearby comments in the same commit.
