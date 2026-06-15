# Templates → Sentence Store (design + plan)

**Status:** **Slices 1 + 2 SHIPPED.** Slice 1 = template *structure* in the DB. Slice 2 = lazy,
on-demand materialization of realizations into PUBLIC `sentence` rows so the store tooling covers the
combos people actually use. This is the authoritative context doc. The slot-swap TEMPLATE feature's
structure lives in the server `sentence_template` table (served by `GET /v1/templates`, fetched by
the client); a used combo is materialized via `POST /v1/templates/{extId}/realize`. Read this first,
then the linked files.

**Where the code is:** all merged to `main` — `selftalk-grid` (the 9 template-UI commits), Slice 1
(`be2ee94`), and Slice 2 (`d29c620`: `db.materializeTemplateRealization` + `db.getTemplate` +
`lib/realize.ts` + `POST /v1/templates/{extId}/realize` + the client `maybeMaterialize` trigger).

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

Full doc: [study-app/SELFTALK.md](../../study-app/SELFTALK.md) "Templates (slot-swap)". In brief:

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

Docs: [SENTENCE_STORE_NLP.md](../../SENTENCE_STORE_NLP.md) + `wk-enhanced-api/CLAUDE.md` "Sentence store".
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
could be hundreds of combos). Instead: **the first time a signed-in user plays/records a given config
(filler combo), the server materializes that realization as a real `sentence` row.** Same shape as the
vocab lazy-warm pattern.

- **Endpoint (SHIPPED):** `POST /v1/templates/{extId}/realize`. The body carries **ONLY the picks**
  (`{ picks: { slotId: index } }`) — decision #1 is server-RECONSTRUCTS, so the server is authoritative
  and a client can never materialize a public row whose text doesn't match the curated template. The
  server (`routes/templates.ts` + `lib/realize.ts` + `db.materializeTemplateRealization`):
  - looks up the template through the gate (`db.getTemplate`, 404 if not visible) and reads its curated
    `grammar` **server-side** (never client-trusted),
  - reconstructs the realization from the stored skeleton + picks (`lib/realize.ts` — a byte-for-byte
    port of the study-app's `realizeTemplate`/`plainText`/`rubyToSegments`, since the runtime image
    carries no `study-app/`): `text`, `furigana`, English, and a canonical `role` (`slotId:idx,…` over
    every slot),
  - re-asserts `concat(seg.t) === text` (the furigana invariant) + computes `hash = ttsTextHash(text)`,
  - upserts a PUBLIC `sentence` row (`source='template'`, `created_by=NULL` → `custom:false`), idempotent
    by hash (mirrors `seedExampleSentence`'s reuse-by-hash; a foreign example/selftalk row with identical
    text is reused untouched), linked via `sentence_link(owner_type='template', owner_id=<template
    ext_id>, role=<combo key>)` attached idempotently,
  - copies the template's curated `grammar` onto rows we own as `sentence_tag(kind='grammar')` so grammar
    search includes it **immediately** (before any NLP),
  - returns the assembled sentence carrying the template link.
- **Trigger (SHIPPED — decision #2):** the client's `maybeMaterialize(id)` fires from the ▶ play handler
  AND the take-saved hook — signed-in only (it writes the PUBLIC corpus; anon keeps playing via lazy
  TTS), deduped per session by the canonical combo key, fire-and-forget. A no-op for plain phrases.
- **Record-compare / practice keeps keying on the SKELETON id**, NOT the materialized combo's sentence
  id — so takes + the ✓/streak stay coherent across swaps. Materialization does not touch the itemKey.

### What tooling works *when* (set expectations — important)

| Tool | After lazy materialization of a combo |
|---|---|
| De-dup / export (`public_sentence`) | ✅ immediately (it's a public sentence row) |
| Grammar search | ✅ immediately — we copy the template's curated grammar tag onto the row at materialization (decision #4) |
| TTS playback (lazy synth) | ✅ already works on any text; materialization gives it a canonical key |
| TTS pre-gen (`generate-tts.ts`) | ✅ `collectTtsTexts.ts` enumerates ALL template combos (the full per-template cartesian product via `realizeTemplate`) + the Self-Talk phrases, so `generate-tts.ts` + `seed-audio-variants.ts` pre-render them locally |
| **NLP tap-to-lookup tokens** | ⏳ **LAGS** — NLP is an OFFLINE batch (no Python on prod). A freshly-materialized combo has no tokens until the next `parse.py` → `seed-annotations.ts` re-parse over the (now-larger) public corpus. Until then it **degrades to plain ruby** (the existing fallback). The offline batch *will* pick the combos up because they're public rows. |

So lazy materialization lights up most tooling promptly; **tap-to-lookup specifically lags behind the
offline NLP cycle** — that's inherent to the no-Python-on-prod constraint, not a bug to fix.

---

## Phasing (maintainer chose: structure first, then tooling)

- **Slice 1 — structure in DB. ✅ SHIPPED.** `sentence_template` table + `TEMPLATE_VIEWER_VISIBLE`
  gate (+ `public_template` view + a pinned breach test in `client.test.ts`) + `db.getTemplates` /
  `db.upsertPublicTemplate` + `seed-sentences.ts` Pass 3 + `GET /v1/templates[?source=]` +
  `routes/templates.ts` (in the `STUDY_ROUTE` CORS allowlist) + the client fetch/read-through cache
  (`jpverbs_selftalk_templates_cache`) replacing the JS import in `features/selftalk.js`. The
  slot-swap UI + `realizeTemplate` are unchanged, just DB-sourced. **Content left JavaScript.**
  Verified: 18 templates served byte-for-byte from the bundle, grid tally + slot-swap cycle/repaint
  work in-browser, 191 API + 104 study-app tests green. **Settled this slice:** route = dedicated
  `GET /v1/templates` (open Q #3); authoring = **curator-only** seed, the gate + breach test ship now,
  user-authored templates deferred (open Q #5); `slots`/`grammar` stored as opaque JSON columns parsed
  server-side so the route returns the exact UI shape (no client adapter; `id` = the skeleton ext_id).
- **Slice 2 — lazy materialization + tooling. ✅ SHIPPED.** `lib/realize.ts` (the ported pure
  realization) + `db.getTemplate` (gated single-fetch) + `db.materializeTemplateRealization`
  (reuse-by-hash, mirrors `seedExampleSentence`) + `POST /v1/templates/{extId}/realize`
  (`routes/templates.ts`, account-gated, in the `STUDY_ROUTE` allowlist) + `sentence_link`
  `owner_type='template'` + the grammar-tag copy + the client `maybeMaterialize` trigger
  (`features/selftalk.js`, fired from ▶ play + the take-saved hook). The offline NLP picks up the
  now-public combo rows on its next cycle (the tap-to-lookup lag above). **Settled this slice:** #1
  server-reconstructs (authoritative); #2 trigger on **play AND record** (signed-in, deduped per
  session); #4 **copy** the curated grammar (server-read); #6 `source='template'`, **template-link
  only** (NOT in the `ownerType=selftalk` read, so a combo never renders as a duplicate phrase card).
  Verified: 208 API + 104 study-app tests green, `bun run build` clean, and an end-to-end curl pass of
  the realize route (anon→401, materialize→200 with the reconstructed sentence + grammar + template
  link, idempotent re-POST, a distinct combo, unknown→404, and no leak into the Self-Talk read).

Each slice's open questions were settled WITH the maintainer first (propose-with-a-recommendation →
pick → build), the pattern used throughout this feature.

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

## Open questions — all RESOLVED

1. **Furigana for materialized combos:** ✅ RESOLVED (Slice 2) — **server reconstructs** from the stored
   skeleton + picks (`lib/realize.ts`, a byte-for-byte port of `realizeTemplate`/`plainText`/
   `rubyToSegments` — ported, not imported, because the runtime image carries no `study-app/`). The
   client sends ONLY the picks, so the server is authoritative; the furigana invariant + server-computed
   hash are re-asserted at the DB write.
2. **Materialization trigger:** ✅ RESOLVED (Slice 2) — on **▶ play AND record** (`maybeMaterialize`,
   fired from the play handler + the take-saved hook), signed-in only, deduped per session,
   fire-and-forget. Play is the dominant use signal; record adds high-intent combos. Anon stays on the
   lazy TTS path (no write). Tap-to-lookup was not a viable trigger (nothing to tap until the offline NLP
   annotates the combo).
3. **Route shape:** ✅ RESOLVED (Slice 1) — dedicated `GET /v1/templates`; realize is
   `POST /v1/templates/{extId}/realize` under the same router.
4. **Grammar at materialization:** ✅ RESOLVED (Slice 2) — **copy** the template's curated `grammar` onto
   the combo row (`sentence_tag(kind='grammar')`), read server-side from the template (never
   client-trusted), so grammar search includes the combo pre-NLP. It survives later re-parses because the
   offline grammar detector only rewrites `source='example'` rows.
5. **User-authored templates (private):** ✅ RESOLVED (Slice 1) — **curator-only**; the private columns
   + the mirrored read gate + breach test ship now (proven via a raw-SQL synthetic private row), but
   the authoring WRITE path (POST/PUT/DELETE + a template editor) is deferred to a later slice, mirroring
   how phrases shipped read-first.
6. **`source` value:** ✅ RESOLVED (Slice 2) — `source='template'`, linked **only** via
   `owner_type='template'` (no selftalk link). Combo rows are public (`created_by=NULL`, `custom:false`)
   so export/de-dup/NLP cover them, but they are **NOT** returned by `GET /v1/sentences?ownerType=selftalk`
   — so a combo never renders as a duplicate phrase card and record-compare's skeleton-keying is safe.
   `source='template'` also keeps the copied curator grammar (the offline grammar detector skips
   non-`example` rows).

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
